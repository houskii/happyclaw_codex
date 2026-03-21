/**
 * Safety Hooks — Automatic risk detection and stuck-loop recovery.
 *
 * 1. PreToolUse: High-risk operation gatekeeper
 *    - Local rule engine scores risk before tool execution
 *    - High-risk operations get GPT "intent-action consistency" check
 *    - Can block dangerous operations or inject safety guidance
 *
 * 2. PostToolUse: Stuck/loop recovery coach
 *    - Tracks recent tool call fingerprints
 *    - Detects repetitive patterns (same command retried, same error recurring)
 *    - Calls GPT to suggest alternative approaches when stuck
 */

import type {
  HookCallback,
  PreToolUseHookInput,
  PostToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';

// ─── Constants ─────────────────────────────────────────────

const GATEKEEPER_TIMEOUT_MS = 10_000;

const CODEX_API_URL = 'https://chatgpt.com/backend-api/codex/responses';
const CHAT_COMPLETIONS_API_URL = 'https://api.openai.com/v1/chat/completions';

// ─── Gatekeeper: Risk Patterns ─────────────────────────────

/** Bash commands that warrant GPT review before execution */
const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-\w*r\w*f/,             // rm -rf variants
  /\bgit\s+reset\s+--hard/,       // git reset --hard
  /\bgit\s+clean\s+-\w*f/,        // git clean -f
  /\bgit\s+push\s+.*--force/,     // git push --force
  /\bgit\s+branch\s+-\w*D/,       // git branch -D
  /\bDROP\s+(TABLE|DATABASE)/i,    // SQL DROP
  /\bTRUNCATE\s+TABLE/i,          // SQL TRUNCATE
  /\bDELETE\s+FROM\b(?!.*WHERE)/i, // DELETE without WHERE
  /\bmkfs\b/,                      // format filesystem
  /\bdd\s+if=/,                    // raw disk write
  /\bchmod\s+777\b/,              // world-writable permissions
  /\bkill\s+-9\b/,                // force kill
  /\bcurl\b.*\|\s*(ba)?sh/,       // pipe to shell
  /\bwget\b.*\|\s*(ba)?sh/,       // pipe to shell
  /\bsudo\b/,                      // sudo
];

/** Files that require extra caution when modified */
const SENSITIVE_FILE_PATTERNS = [
  /\.env/i,
  /authorized_keys/i,
  /sshd_config/i,
  /\.gnupg\//i,
  /Dockerfile/i,
  /docker-compose/i,
  /\.github\/workflows/i,
  /ci\/.*\.ya?ml/i,
  /deploy/i,
  /migration/i,
  /\.pem$/i,
  /\.key$/i,
  /secrets?\./i,
  /credentials?\./i,
];

interface RiskAssessment {
  score: number;       // 0-100
  reasons: string[];
  needsGptCheck: boolean;
}

function assessBashRisk(command: string): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;

  for (const pattern of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push(`危险命令模式: ${pattern}`);
      score += 40;
    }
  }

  // Multi-pipe chains with side effects
  if ((command.match(/\|/g) || []).length >= 3) {
    reasons.push('复杂管道链');
    score += 10;
  }

  // Commands targeting root/system paths
  if (/\s\/(?:etc|usr|var|root|boot)\b/.test(command)) {
    reasons.push('涉及系统目录');
    score += 20;
  }

  return {
    score: Math.min(score, 100),
    reasons,
    needsGptCheck: score >= 30,
  };
}

function assessEditWriteRisk(filePath: string, content?: string): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;

  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      reasons.push(`敏感文件: ${filePath}`);
      score += 30;
      break;
    }
  }

  if (content) {
    // Check for secrets being written
    if (/(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i.test(content)) {
      reasons.push('可能在写入硬编码凭据');
      score += 40;
    }
  }

  return {
    score: Math.min(score, 100),
    reasons,
    needsGptCheck: score >= 30,
  };
}

// ─── Gatekeeper: GPT Check ────────────────────────────────

/** Redact sensitive content from tool input before sending to external LLM */
function redactToolInput(toolName: string, toolInput: unknown): string {
  if (typeof toolInput === 'string') return toolInput.slice(0, 2000);
  const input = toolInput as Record<string, unknown> | null;
  if (!input) return '{}';

  // For Edit/Write on sensitive files, redact the actual content
  const filePath = (input.file_path as string) || (input.path as string) || '';
  const isSensitive = SENSITIVE_FILE_PATTERNS.some(p => p.test(filePath));

  if (isSensitive && (toolName === 'Edit' || toolName === 'Write')) {
    const redacted = { ...input };
    if (redacted.new_string) redacted.new_string = '[REDACTED: sensitive file content]';
    if (redacted.old_string) redacted.old_string = '[REDACTED: sensitive file content]';
    if (redacted.content) redacted.content = '[REDACTED: sensitive file content]';
    return JSON.stringify(redacted, null, 2).slice(0, 2000);
  }

  // For Bash commands, redact inline secrets (env vars, tokens in args)
  if (toolName === 'Bash') {
    let cmd = (input.command as string) || '';
    cmd = cmd.replace(/((?:api[_-]?key|secret|password|token|bearer)\s*[=:]\s*)\S+/gi, '$1[REDACTED]');
    return JSON.stringify({ ...input, command: cmd }, null, 2).slice(0, 2000);
  }

  return JSON.stringify(input, null, 2).slice(0, 2000);
}

async function gptIntentCheck(
  toolName: string,
  toolInput: unknown,
  risk: RiskAssessment,
): Promise<{ allow: boolean; guidance?: string }> {
  const accessToken = process.env.CROSSMODEL_OPENAI_ACCESS_TOKEN;
  const apiKey = process.env.CROSSMODEL_OPENAI_API_KEY;
  if (!accessToken && !apiKey) return { allow: true };

  const inputStr = redactToolInput(toolName, toolInput);

  const prompt = `Agent 即将执行以下操作，请判断是否安全：

工具：${toolName}
输入：
${inputStr}

风险信号：
${risk.reasons.map(r => `- ${r}`).join('\n')}

请回答：
1. 该操作是否存在不可逆的破坏性风险？(是/否)
2. 是否有更安全的替代方案？(有：说明 / 无)
3. 结论：放行 / 需要确认 / 阻止

只回答以上三点，每点一行。`;

  try {
    const text = accessToken
      ? await callApi(CODEX_API_URL, prompt, accessToken, true)
      : await callApi(CHAT_COMPLETIONS_API_URL, prompt, apiKey!, false);

    const lower = text.toLowerCase();
    if (lower.includes('阻止') || lower.includes('block')) {
      return { allow: false, guidance: text };
    }
    if (lower.includes('需要确认') || lower.includes('confirm')) {
      // Inject guidance but allow — Claude should ask the user
      return { allow: true, guidance: `⚠️ GPT 安全检查建议确认：\n${text}` };
    }
    return { allow: true };
  } catch {
    // GPT unavailable — don't block, just let it through
    return { allow: true };
  }
}

async function callApi(url: string, prompt: string, token: string, isCodex: boolean): Promise<string> {
  const body = isCodex
    ? {
        model: 'gpt-5.4-mini',
        instructions: '你是安全审计员。简洁回答，不要废话。',
        input: [{ role: 'user', content: prompt }],
        reasoning: { effort: 'medium' },
        stream: false,
      }
    : {
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: '你是安全审计员。简洁回答，不要废话。' },
          { role: 'user', content: prompt },
        ],
        reasoning_effort: 'medium',
      };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GATEKEEPER_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`API ${response.status}`);

  const data = await response.json() as any;
  if (isCodex && data.output) {
    for (const item of data.output) {
      if (item.type === 'message' && item.content) {
        for (const block of item.content) {
          if (block.type === 'output_text') return block.text;
        }
      }
    }
    throw new Error('No text in response');
  }
  return data.choices?.[0]?.message?.content || '';
}

// ─── Loop Detection ────────────────────────────────────────

interface ToolFingerprint {
  toolName: string;
  argsHash: string;
  exitCode?: number;
  timestamp: number;
  errorSnippet?: string;
}

const MAX_FINGERPRINTS = 15;
const LOOP_THRESHOLD = 3; // same fingerprint N times = stuck
const ERROR_REPEAT_THRESHOLD = 2; // same error N times = stuck
const COACH_COOLDOWN_MS = 60_000; // don't coach more than once per minute

let recentFingerprints: ToolFingerprint[] = [];
let lastCoachTime = 0;

function hashArgs(toolName: string, toolInput: unknown): string {
  // Simple hash: tool name + first 200 chars of stringified input
  const inputStr = typeof toolInput === 'string'
    ? toolInput.slice(0, 200)
    : JSON.stringify(toolInput || '').slice(0, 200);
  // djb2 hash
  let hash = 5381;
  const str = `${toolName}:${inputStr}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash.toString(36);
}

function extractErrorSnippet(toolResponse: unknown): string | undefined {
  const str = typeof toolResponse === 'string'
    ? toolResponse
    : JSON.stringify(toolResponse || '');
  // Look for common error patterns
  const errorMatch = str.match(/(?:error|Error|ERROR|failed|FAILED|panic|PANIC)[^\n]{0,150}/);
  return errorMatch?.[0];
}

function extractExitCode(toolResponse: unknown): number | undefined {
  const str = typeof toolResponse === 'string'
    ? toolResponse
    : JSON.stringify(toolResponse || '');
  const match = str.match(/exit code[:\s]+(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

interface LoopDetection {
  isStuck: boolean;
  reason?: string;
  fingerprints?: ToolFingerprint[];
}

function detectLoop(newFp: ToolFingerprint): LoopDetection {
  recentFingerprints.push(newFp);
  if (recentFingerprints.length > MAX_FINGERPRINTS) {
    recentFingerprints = recentFingerprints.slice(-MAX_FINGERPRINTS);
  }

  // Check 1: Same command repeated N times
  const sameHash = recentFingerprints.filter(fp => fp.argsHash === newFp.argsHash);
  if (sameHash.length >= LOOP_THRESHOLD) {
    return {
      isStuck: true,
      reason: `同一命令已重复执行 ${sameHash.length} 次`,
      fingerprints: sameHash,
    };
  }

  // Check 2: Same error message repeated
  if (newFp.errorSnippet) {
    const sameError = recentFingerprints.filter(
      fp => fp.errorSnippet && fp.errorSnippet === newFp.errorSnippet
    );
    if (sameError.length >= ERROR_REPEAT_THRESHOLD) {
      return {
        isStuck: true,
        reason: `同一错误已出现 ${sameError.length} 次: ${newFp.errorSnippet?.slice(0, 80)}`,
        fingerprints: sameError,
      };
    }
  }

  // Check 3: High failure rate in recent calls
  const recent5 = recentFingerprints.slice(-5);
  const failures = recent5.filter(fp => fp.exitCode && fp.exitCode !== 0);
  if (recent5.length >= 5 && failures.length >= 4) {
    return {
      isStuck: true,
      reason: `最近 5 次调用中 ${failures.length} 次失败`,
      fingerprints: failures,
    };
  }

  return { isStuck: false };
}

async function getCoachAdvice(detection: LoopDetection): Promise<string | null> {
  const now = Date.now();
  if (now - lastCoachTime < COACH_COOLDOWN_MS) return null;

  const accessToken = process.env.CROSSMODEL_OPENAI_ACCESS_TOKEN;
  const apiKey = process.env.CROSSMODEL_OPENAI_API_KEY;
  if (!accessToken && !apiKey) return null;

  lastCoachTime = now;

  const recentCalls = recentFingerprints.slice(-8).map(fp =>
    `  ${fp.toolName} (${fp.exitCode !== undefined ? `exit=${fp.exitCode}` : 'ok'})${fp.errorSnippet ? `: ${fp.errorSnippet.slice(0, 80)}` : ''}`
  ).join('\n');

  const prompt = `Agent 似乎陷入了循环，需要换一个思路。

卡住原因：${detection.reason}

最近工具调用：
${recentCalls}

请给出 2-3 个具体的替代方案建议。要求：
- 每个建议一行
- 给出具体可执行的操作（不是"试试别的"这种空话）
- 如果看起来是环境/依赖问题，建议先诊断再修复`;

  try {
    const text = accessToken
      ? await callApi(CODEX_API_URL, prompt, accessToken, true)
      : await callApi(CHAT_COMPLETIONS_API_URL, prompt, apiKey!, false);
    return text;
  } catch {
    return null;
  }
}

// ─── Hook Factories ────────────────────────────────────────

/**
 * PreToolUse: High-risk operation gatekeeper.
 * Scores risk locally, calls GPT only for high-risk operations.
 */
export function createGatekeeperHook(log: (msg: string) => void): HookCallback {
  return async (input, _toolUseId, _options) => {
    const hookInput = input as PreToolUseHookInput;
    const { tool_name, tool_input } = hookInput;

    // Skip subagent operations for non-Bash tools (Bash is too dangerous to skip)
    if (hookInput.agent_id && tool_name !== 'Bash') return {};

    let risk: RiskAssessment | null = null;

    if (tool_name === 'Bash') {
      const command = (tool_input as any)?.command || '';
      risk = assessBashRisk(command);
    } else if (tool_name === 'Edit' || tool_name === 'Write') {
      const filePath = (tool_input as any)?.file_path || (tool_input as any)?.path || '';
      const content = (tool_input as any)?.new_string || (tool_input as any)?.content || '';
      risk = assessEditWriteRisk(filePath, content);
    }

    if (!risk || !risk.needsGptCheck) return {};

    log(`[gatekeeper] Risk score ${risk.score} for ${tool_name}: ${risk.reasons.join(', ')}`);

    const result = await gptIntentCheck(tool_name, tool_input, risk);

    if (!result.allow) {
      log(`[gatekeeper] BLOCKED ${tool_name}: ${result.guidance?.slice(0, 100)}`);
      return {
        decision: 'block' as const,
        reason: result.guidance || '高风险操作被安全检查阻止',
      };
    }

    if (result.guidance) {
      log(`[gatekeeper] Advisory for ${tool_name}`);
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          additionalContext: result.guidance,
        },
      };
    }

    return {};
  };
}

/**
 * PostToolUse: Stuck/loop recovery coach.
 * Tracks tool call patterns and detects repetitive failures.
 */
export function createLoopRecoveryHook(log: (msg: string) => void): HookCallback {
  return async (input, _toolUseId, _options) => {
    const hookInput = input as PostToolUseHookInput;

    // Skip subagent operations
    if (hookInput.agent_id) return {};

    // Only track tools that can indicate stuck behavior
    const trackable = ['Bash', 'Edit', 'Write', 'Grep', 'Glob', 'Read'];
    if (!trackable.includes(hookInput.tool_name)) return {};

    const fingerprint: ToolFingerprint = {
      toolName: hookInput.tool_name,
      argsHash: hashArgs(hookInput.tool_name, hookInput.tool_input),
      exitCode: extractExitCode(hookInput.tool_response),
      timestamp: Date.now(),
      errorSnippet: extractErrorSnippet(hookInput.tool_response),
    };

    const detection = detectLoop(fingerprint);

    if (!detection.isStuck) return {};

    log(`[loop-coach] Stuck detected: ${detection.reason}`);

    const advice = await getCoachAdvice(detection);
    if (!advice) return {};

    log(`[loop-coach] Injecting recovery advice`);
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse' as const,
        additionalContext: `⚠️ **循环检测**: ${detection.reason}\n\nGPT 建议换个思路：\n${advice}`,
      },
    };
  };
}
