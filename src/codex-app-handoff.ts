import fs from 'fs';
import path from 'path';

import Database from './sqlite-compat.js';
import { markdownToPlainText } from './im-utils.js';
import { codexQuery } from './codex-query.js';
import { sdkQuery } from './sdk-query.js';
import type { ThinkingEffort, WorkspaceLlmProvider } from './types.js';

export const APP_BINDING_FILE = 'app_binding.json';
export const APP_CONTEXT_SUMMARY_FILE = 'app_context_summary.md';
export const APP_THREAD_TRANSCRIPT_FILE = 'app_thread_transcript.jsonl';
export const APP_CONTEXT_INDEX_FILE = 'app_context_index.json';

export type AppBindingStatus = 'active' | 'syncing' | 'synced' | 'failed';

export interface CodexRecentThread {
  id: string;
  title: string;
  displayTitle: string;
  updatedAt: number;
  updatedAtIso: string;
  cwd: string;
  source: string;
  rolloutPath: string;
  firstUserMessage: string;
  latestUserMessage: string;
}

export interface AppBindingRecord {
  sourceThreadId: string;
  sourceThreadTitle: string;
  sourceThreadCwd: string;
  sourceThreadRolloutPath: string;
  sourceThreadSource: string;
  importedAt: string;
  importMode: 'handoff';
  status: AppBindingStatus;
  workspaceJid: string;
  workspaceFolder: string;
  sourceChatJid: string;
  restoreWorkspaceJid: string | null;
  restoreAgentId: string | null;
}

export interface AppContextMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  text: string;
}

export interface AppContextChunk {
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  text: string;
  normalizedText: string;
}

type ThreadRow = {
  id: string;
  title: string;
  updated_at: number;
  cwd: string;
  source: string;
  rollout_path: string;
  first_user_message: string;
};

type SessionIndexRow = {
  id: string;
  thread_name: string;
  updated_at: string;
};

export function getCodexHomeDir(): string {
  const homeDir = process.env.HOME || '/root';
  return process.env.CODEX_HOME || path.join(homeDir, '.codex');
}

export function getCodexThreadsDbPath(): string {
  return path.join(getCodexHomeDir(), 'state_5.sqlite');
}

export function getCodexSessionIndexPath(): string {
  return path.join(getCodexHomeDir(), 'session_index.jsonl');
}

function epochSecondsToIso(value: number): string {
  return new Date(value * 1000).toISOString();
}

function readSessionIndexMap(): Map<string, SessionIndexRow> {
  const indexPath = getCodexSessionIndexPath();
  const map = new Map<string, SessionIndexRow>();
  if (!fs.existsSync(indexPath)) return map;

  for (const line of fs.readFileSync(indexPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as SessionIndexRow;
      if (parsed.id) map.set(parsed.id, parsed);
    } catch {
      // ignore malformed line
    }
  }
  return map;
}

export function listRecentCodexThreads(limit = 10): CodexRecentThread[] {
  const dbPath = getCodexThreadsDbPath();
  if (!fs.existsSync(dbPath)) return [];

  const sessionIndexMap = readSessionIndexMap();
  const db = new Database(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT id, title, updated_at, cwd, source, rollout_path, first_user_message
         FROM threads
         WHERE archived = 0
           AND source = 'vscode'
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as ThreadRow[];

    return rows.map((row) => {
      const displayTitle =
        sessionIndexMap.get(row.id)?.thread_name?.trim()
        || row.title
        || row.first_user_message
        || '(无标题线程)';
      return {
        id: row.id,
        title: row.title,
        displayTitle,
        updatedAt: row.updated_at,
        updatedAtIso: epochSecondsToIso(row.updated_at),
        cwd: row.cwd,
        source: row.source,
        rolloutPath: row.rollout_path,
        firstUserMessage: row.first_user_message || '',
        latestUserMessage:
          readLatestUserMessage(row.rollout_path) || row.first_user_message || '',
      };
    });
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export function getCodexThreadById(threadId: string): CodexRecentThread | null {
  const dbPath = getCodexThreadsDbPath();
  if (!fs.existsSync(dbPath)) return null;

  const sessionIndexMap = readSessionIndexMap();
  const db = new Database(dbPath);
  try {
    const row = db
      .prepare(
        `SELECT id, title, updated_at, cwd, source, rollout_path, first_user_message
         FROM threads
         WHERE id = ?`,
      )
      .get(threadId) as ThreadRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      displayTitle:
        sessionIndexMap.get(row.id)?.thread_name?.trim()
        || row.title
        || row.first_user_message
        || '(无标题线程)',
      updatedAt: row.updated_at,
      updatedAtIso: epochSecondsToIso(row.updated_at),
      cwd: row.cwd,
      source: row.source,
      rolloutPath: row.rollout_path,
      firstUserMessage: row.first_user_message || '',
      latestUserMessage:
        readLatestUserMessage(row.rollout_path) || row.first_user_message || '',
    };
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export function getThreadPreviewText(thread: CodexRecentThread): string {
  const raw = (thread.latestUserMessage || thread.firstUserMessage || '').trim();
  if (!raw) return '无额外摘要';
  const plain = markdownToPlainText(raw)
    .replace(/\s+/g, ' ')
    .trim();
  return plain || '无额外摘要';
}

function readLatestUserMessage(rolloutPath: string): string {
  if (!fs.existsSync(rolloutPath)) return '';

  const lines = fs.readFileSync(rolloutPath, 'utf-8').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i]?.trim();
    if (!trimmed) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (parsed?.type !== 'response_item') continue;
    const payload = parsed.payload;
    if (payload?.type !== 'message' || payload.role !== 'user') continue;
    const text = extractMessageText(payload.content);
    if (text) return text;
  }
  return '';
}

export function readCodexThreadMessages(
  rolloutPath: string,
): AppContextMessage[] {
  if (!fs.existsSync(rolloutPath)) return [];

  const lines = fs.readFileSync(rolloutPath, 'utf-8').split('\n');
  const messages: AppContextMessage[] = [];
  let seq = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (parsed?.type !== 'response_item') continue;
    const payload = parsed.payload;
    if (payload?.type !== 'message') continue;
    if (payload.role !== 'user' && payload.role !== 'assistant') continue;

    const text = extractMessageText(payload.content);
    if (!text) continue;

    messages.push({
      id: `m-${String(seq).padStart(4, '0')}`,
      role: payload.role,
      timestamp: typeof parsed.timestamp === 'string'
        ? parsed.timestamp
        : new Date().toISOString(),
      text,
    });
    seq += 1;
  }

  return messages;
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const typed = item as Record<string, unknown>;
    if (typed.type === 'input_text' || typed.type === 'output_text') {
      const text = typeof typed.text === 'string' ? typed.text.trim() : '';
      if (text) parts.push(text);
    }
  }
  return parts.join('\n\n').trim();
}

export async function buildHandoffSummary(
  thread: CodexRecentThread,
  messages: AppContextMessage[],
  options?: {
    provider?: WorkspaceLlmProvider;
    model?: string;
    thinkingEffort?: ThinkingEffort;
  },
): Promise<string> {
  const recentWindow = messages.slice(-20);
  const transcript = recentWindow
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`)
    .join('\n\n');

  const prompt = [
    '请为一次 Codex App -> HappyClaw 的任务交接生成简洁中文 handoff summary。',
    '输出格式必须包含以下标题：',
    '1. 当前任务',
    '2. 已确认约束',
    '3. 关键决策',
    '4. 未完成事项',
    '5. 最近关键上下文',
    '',
    '要求：',
    '- 不要逐条翻译',
    '- 缺失的信息写“未明确”',
    '- 保持面向后续接手执行',
    '',
    `线程标题：${thread.displayTitle || thread.title}`,
    `工作目录：${thread.cwd}`,
    thread.firstUserMessage ? `首条用户消息：${thread.firstUserMessage}` : '',
    '',
    '最近消息窗口：',
    transcript || '（无可用消息）',
  ]
    .filter(Boolean)
    .join('\n');

  const provider = options?.provider ?? 'openai';
  const result = provider === 'claude'
    ? await sdkQuery(prompt, {
      timeout: 45_000,
      model: options?.model,
    })
    : await codexQuery(prompt, {
      timeout: 45_000,
      cwd: thread.cwd,
      model: options?.model,
      reasoningEffort: options?.thinkingEffort,
    });
  if (result) {
    return [
      `# App Context Summary`,
      '',
      `- Thread ID: ${thread.id}`,
      `- Title: ${thread.displayTitle || thread.title}`,
      `- CWD: ${thread.cwd}`,
      `- Imported At: ${new Date().toISOString()}`,
      '',
      result.trim(),
    ].join('\n');
  }

  const recentContext = recentWindow.length > 0
    ? recentWindow
      .map((m) => `- ${m.role === 'user' ? '用户' : '助手'} @ ${m.timestamp}: ${truncate(m.text, 240)}`)
      .join('\n')
    : '- 无可用消息';

  return [
    '# App Context Summary',
    '',
    `- Thread ID: ${thread.id}`,
    `- Title: ${thread.title}`,
    `- CWD: ${thread.cwd}`,
    `- Imported At: ${new Date().toISOString()}`,
    '',
    '## 当前任务',
    thread.firstUserMessage || '未明确',
    '',
    '## 已确认约束',
    '未明确',
    '',
    '## 关键决策',
    '未明确',
    '',
    '## 未完成事项',
    '需要由接手的 HappyClaw 工作区继续确认。',
    '',
    '## 最近关键上下文',
    recentContext,
  ].join('\n');
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

export function buildContextIndex(messages: AppContextMessage[]): AppContextChunk[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    timestamp: message.timestamp,
    text: message.text,
    normalizedText: normalizeForSearch(message.text),
  }));
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function writeThreadSnapshotFiles(opts: {
  workspaceDir: string;
  binding: AppBindingRecord;
  summary: string;
  transcriptSourcePath: string;
  index: AppContextChunk[];
}): void {
  fs.mkdirSync(opts.workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(opts.workspaceDir, APP_BINDING_FILE),
    JSON.stringify(opts.binding, null, 2) + '\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(opts.workspaceDir, APP_CONTEXT_SUMMARY_FILE),
    `${opts.summary.trim()}\n`,
    'utf-8',
  );
  fs.copyFileSync(
    opts.transcriptSourcePath,
    path.join(opts.workspaceDir, APP_THREAD_TRANSCRIPT_FILE),
  );
  fs.writeFileSync(
    path.join(opts.workspaceDir, APP_CONTEXT_INDEX_FILE),
    JSON.stringify({ version: 1, chunks: opts.index }, null, 2) + '\n',
    'utf-8',
  );
}

export function readAppBinding(workspaceDir: string): AppBindingRecord | null {
  const filePath = path.join(workspaceDir, APP_BINDING_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AppBindingRecord;
  } catch {
    return null;
  }
}

export function writeAppBinding(
  workspaceDir: string,
  binding: AppBindingRecord,
): void {
  fs.writeFileSync(
    path.join(workspaceDir, APP_BINDING_FILE),
    JSON.stringify(binding, null, 2) + '\n',
    'utf-8',
  );
}

export function syncResultBackToCodexThread(
  threadId: string,
  message: string,
): { ok: true } | { ok: false; error: string } {
  const thread = getCodexThreadById(threadId);
  if (!thread) {
    return { ok: false, error: `Codex thread not found: ${threadId}` };
  }
  if (!fs.existsSync(thread.rolloutPath)) {
    return { ok: false, error: `Codex transcript missing: ${thread.rolloutPath}` };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const appendLines = [
    JSON.stringify({
      timestamp: nowIso,
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        message,
        phase: 'final_answer',
        memory_citation: null,
      },
    }),
    JSON.stringify({
      timestamp: nowIso,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: message }],
        phase: 'final_answer',
      },
    }),
  ].join('\n') + '\n';

  try {
    fs.appendFileSync(thread.rolloutPath, appendLines, 'utf-8');
    updateThreadUpdatedAt(threadId, Math.floor(now.getTime() / 1000));
    updateSessionIndex(threadId, thread.title, nowIso);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function updateThreadUpdatedAt(threadId: string, updatedAt: number): void {
  const dbPath = getCodexThreadsDbPath();
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(updatedAt, threadId);
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

function updateSessionIndex(
  threadId: string,
  threadName: string,
  updatedAtIso: string,
): void {
  const indexPath = getCodexSessionIndexPath();
  const rows: SessionIndexRow[] = [];

  if (fs.existsSync(indexPath)) {
    for (const line of fs.readFileSync(indexPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as SessionIndexRow;
        rows.push(parsed);
      } catch {
        // keep going
      }
    }
  }

  let updated = false;
  for (const row of rows) {
    if (row.id === threadId) {
      row.thread_name = row.thread_name || threadName;
      row.updated_at = updatedAtIso;
      updated = true;
    }
  }
  if (!updated) {
    rows.push({
      id: threadId,
      thread_name: threadName,
      updated_at: updatedAtIso,
    });
  }
  rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const tmpPath = `${indexPath}.tmp`;
  fs.writeFileSync(
    tmpPath,
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'utf-8',
  );
  fs.renameSync(tmpPath, indexPath);
}
