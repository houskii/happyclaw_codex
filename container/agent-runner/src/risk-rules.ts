/**
 * Shared risk detection rules and redaction utilities.
 *
 * Single source of truth for:
 * - Dangerous command patterns
 * - Sensitive file patterns
 * - Risk content keywords
 * - Risk assessment functions
 * - Content redaction before external LLM calls
 */

// ─── Dangerous Bash Patterns ──────────────────────────────

/** Bash commands that warrant scrutiny before execution */
export const DANGEROUS_BASH_PATTERNS = [
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

// ─── Sensitive File Patterns ──────────────────────────────

/** Files whose content should NEVER be sent to external APIs */
export const SENSITIVE_FILE_PATTERNS = [
  /\.env/i,
  /authorized_keys/i,
  /sshd_config/i,
  /\.gnupg\//i,
  /\.pem$/i,
  /\.key$/i,
  /\.netrc/i,
  /secrets?\./i,
  /credentials?\./i,
  /password/i,
  /token/i,
  /config\/production/i,
  /id_rsa/i,
  /kubeconfig/i,
];

/** Files that indicate higher risk when modified (superset of sensitive) */
export const RISK_PATH_PATTERNS = [
  /auth/i,
  /payment/i,
  /security/i,
  /crypto/i,
  /migration/i,
  /schema/i,
  /permission/i,
  /secret/i,
  /credential/i,
  /\.env/,
  /config\/production/i,
  /Dockerfile/i,
  /docker-compose/i,
  /\.github\/workflows/i,
  /ci\/.*\.ya?ml/i,
  /deploy/i,
];

/** Content keywords that indicate risky operations */
export const RISK_CONTENT_KEYWORDS = [
  'DELETE FROM',
  'DROP TABLE',
  'rm -rf',
  'exec(',
  'eval(',
  'dangerouslySetInnerHTML',
  'innerHTML',
  'process.exit',
  '--force',
  'sudo ',
];

// ─── Risk Assessment ──────────────────────────────────────

export interface RiskAssessment {
  score: number;       // 0-100
  reasons: string[];
  needsGptCheck: boolean;
}

export function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some((p) => p.test(filePath));
}

export function isRiskPath(filePath: string): boolean {
  return RISK_PATH_PATTERNS.some((p) => p.test(filePath));
}

export function assessBashRisk(command: string): RiskAssessment {
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

export function assessEditWriteRisk(filePath: string, content?: string): RiskAssessment {
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

export function detectContentRiskSignals(content: string, filePath: string): string[] {
  const signals: string[] = [];
  for (const keyword of RISK_CONTENT_KEYWORDS) {
    if (content.includes(keyword)) {
      signals.push(`内容风险: "${keyword}" in ${filePath}`);
    }
  }
  return signals;
}

// ─── Redaction ────────────────────────────────────────────

/** Redact secrets from arbitrary text (for error snippets, fingerprints, etc.) */
export function redactSecrets(text: string): string {
  return text
    // Authorization: Bearer ... (must come before generic key-value to avoid partial match)
    .replace(/((?:"|')?authorization(?:"|')?\s*[:=]\s*(?:"|')?Bearer\s+)\S+/gi, '$1[REDACTED]')
    // Standalone Bearer tokens
    .replace(/(Bearer\s+)\S+/g, '$1[REDACTED]')
    // Key-value pairs with optional JSON quotes: "token": "abc", api_key=xyz, etc.
    .replace(/((?:"|')?(?:api[_-]?key|secret|password|token)(?:"|')?\s*[:=]\s*)(["']?)([^"'\s,}]+)\2/gi, '$1$2[REDACTED]$2');
  // Note: no generic base64 regex — too many false positives on SHA hashes, object IDs, etc.
}

/** Redact tool input before sending to external LLM */
export function redactToolInput(toolName: string, toolInput: unknown): string {
  if (typeof toolInput === 'string') return redactSecrets(toolInput.slice(0, 2000));
  const input = toolInput as Record<string, unknown> | null;
  if (!input) return '{}';

  const filePath = (input.file_path as string) || (input.path as string) || '';
  const isSensitive = isSensitivePath(filePath);

  if (isSensitive && (toolName === 'Edit' || toolName === 'Write')) {
    const redacted = { ...input };
    if (redacted.new_string) redacted.new_string = '[REDACTED: sensitive file content]';
    if (redacted.old_string) redacted.old_string = '[REDACTED: sensitive file content]';
    if (redacted.content) redacted.content = '[REDACTED: sensitive file content]';
    return JSON.stringify(redacted, null, 2).slice(0, 2000);
  }

  if (toolName === 'Bash') {
    let cmd = (input.command as string) || '';
    cmd = redactSecrets(cmd);
    return JSON.stringify({ ...input, command: cmd }, null, 2).slice(0, 2000);
  }

  return redactSecrets(JSON.stringify(input, null, 2).slice(0, 2000));
}

// ─── Bash File-Write Detection ────────────────────────────

/** Patterns that indicate a Bash command writes/modifies files */
const BASH_FILE_WRITE_PATTERNS = [
  /(?:^|[;&|\s])(?:\d*>>?)\s*(?!\/dev\/|&\d)[\w/.~-]+/,  // redirect to real file (excludes /dev/null, &1, etc.)
  /\btee\s+/,                       // tee file
  /\bsed\s+-i/,                     // sed in-place
  /\bcp\s+/,                        // copy
  /\bmv\s+/,                        // move/rename
  /\binstall\s+-/,                  // install command
  /\bgit\s+apply/,                  // git apply
  /\bgit\s+checkout\s+--/,          // git checkout -- (restore files)
  /\bpatch\s+/,                     // patch
  /\bpython[23]?\s+-c\b.*(?:open|write)/i,  // python inline file write
  /\bnode\s+-e\b.*(?:writeFile|appendFile)/i, // node inline file write
  /\bperl\s+-[pi]/,                 // perl in-place
  /\bawk\s+-i/,                     // awk in-place
];

/** Check if a Bash command likely writes to files */
export function bashCommandWritesFiles(command: string): boolean {
  return BASH_FILE_WRITE_PATTERNS.some((p) => p.test(command));
}

/** Try to extract affected file paths from a Bash command (best effort) */
export function extractBashAffectedPaths(command: string): string[] {
  const paths: string[] = [];

  // Redirect targets: > /path or >> /path (exclude /dev/*, fd redirects like &1)
  const redirects = command.matchAll(/(?:\d*>{1,2})\s*(?!\/dev\/)(?!&\d)([^\s;|&]+)/g);
  for (const m of redirects) {
    if (m[1]) paths.push(m[1]);
  }

  // sed -i target files
  const sedMatch = command.match(/\bsed\s+-i[^\s]*\s+(?:'[^']*'|"[^"]*"|[^\s]+)\s+(.+)/);
  if (sedMatch) {
    const files = sedMatch[1].split(/\s+/).filter((f) => !f.startsWith('-'));
    paths.push(...files);
  }

  // cp/mv destination (last arg)
  const cpMvMatch = command.match(/\b(?:cp|mv)\s+.*\s+([^\s;|&]+)\s*(?:[;|&]|$)/);
  if (cpMvMatch) paths.push(cpMvMatch[1]);

  // tee targets
  const teeMatch = command.match(/\btee\s+(?:-a\s+)?([^\s;|&]+)/);
  if (teeMatch) paths.push(teeMatch[1]);

  return paths.filter((p) => p.length > 0 && !p.startsWith('-'));
}
