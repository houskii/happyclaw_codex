/**
 * AppContextPlugin — context_search tool for App-imported workspaces.
 *
 * Searches the imported Codex App transcript snapshot stored in the workspace.
 */

import fs from 'fs';
import path from 'path';
import type {
  ContextPlugin,
  PluginContext,
  ToolDefinition,
} from '../plugin.js';

const APP_BINDING_FILE = 'app_binding.json';
const APP_CONTEXT_INDEX_FILE = 'app_context_index.json';

interface AppContextChunk {
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  text: string;
  normalizedText: string;
}

export class AppContextPlugin implements ContextPlugin {
  readonly name = 'app_context';

  isEnabled(ctx: PluginContext): boolean {
    return fs.existsSync(path.join(ctx.workspaceGroup, APP_BINDING_FILE))
      && fs.existsSync(path.join(ctx.workspaceGroup, APP_CONTEXT_INDEX_FILE));
  }

  getTools(ctx: PluginContext): ToolDefinition[] {
    return [
      {
        name: 'context_search',
        description:
          'Search detailed context from the App-imported thread bound to the current workspace. '
          + 'Only use this tool when the user explicitly asks to look back, search previous context, '
          + 'or recover details that were compressed out of the default handoff summary. '
          + 'This tool only searches the single App thread bound to the current workspace.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural-language query or keywords to search for in the bound App thread context.',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of matches to return. Defaults to 5.',
            },
          },
          required: ['query'],
        },
        execute: async (args: Record<string, unknown>) => {
          const query = getOptionalStringArg(args, 'query');
          if (!query) {
            return { content: 'query is required.', isError: true };
          }

          const maxResultsRaw = args.max_results;
          const maxResults = typeof maxResultsRaw === 'number'
            && Number.isFinite(maxResultsRaw)
            && maxResultsRaw > 0
            ? Math.min(Math.floor(maxResultsRaw), 10)
            : 5;

          const indexPath = path.join(ctx.workspaceGroup, APP_CONTEXT_INDEX_FILE);
          const chunks = readChunks(indexPath);
          if (chunks.length === 0) {
            return { content: '当前工作区没有可搜索的 App 上下文快照。', isError: true };
          }

          const matches = searchChunks(chunks, query, maxResults);
          if (matches.length === 0) {
            return { content: `未找到与“${query}”相关的历史上下文。` };
          }

          const lines = matches.map(
            (chunk, index) =>
              `[${index + 1}] ${chunk.role === 'user' ? '用户' : '助手'} @ ${chunk.timestamp}\n${chunk.text}`,
          );

          return {
            content:
              `已从当前绑定的 App 线程中找到 ${matches.length} 条相关上下文：\n\n`
              + lines.join('\n\n---\n\n'),
          };
        },
      },
    ];
  }

  getSystemPromptSection(_ctx: PluginContext): string {
    return [
      '## App Context',
      '',
      '当前工作区来自一个已绑定的 App 线程导入，默认上下文只保留了 handoff summary。',
      '当且仅当用户明确要求“去翻一下 / 找一下之前上下文 / 恢复之前细节”时，才可以调用 `context_search`。',
      '`context_search` 只允许查询当前工作区绑定的那一条 App 线程，不能跨线程扩散搜索。',
    ].join('\n');
  }
}

function getOptionalStringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readChunks(indexPath: string): AppContextChunk[] {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as {
      chunks?: AppContextChunk[];
    };
    return Array.isArray(raw.chunks) ? raw.chunks : [];
  } catch {
    return [];
  }
}

function searchChunks(
  chunks: AppContextChunk[],
  query: string,
  maxResults: number,
): AppContextChunk[] {
  const tokens = normalize(query)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: Array<{ chunk: AppContextChunk; score: number }> = [];

  for (const chunk of chunks) {
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      if (!chunk.normalizedText.includes(token)) {
        matched = false;
        break;
      }
      score += 1;
    }
    if (matched) {
      scored.push({ chunk, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.chunk.timestamp.localeCompare(a.chunk.timestamp);
  });

  return scored.slice(0, maxResults).map((entry) => entry.chunk);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
