/**
 * Pure utility functions extracted from index.ts for testability.
 * These functions have zero module-level state dependencies.
 */

import type { MessageCursor, RegisteredGroup } from './types.js';

export const EMPTY_CURSOR: MessageCursor = Object.freeze({ timestamp: '', id: '' });

// ── Cursor Utilities ──────────────────────────────────

export function isCursorAfter(candidate: MessageCursor, base: MessageCursor): boolean {
  if (candidate.timestamp > base.timestamp) return true;
  if (candidate.timestamp < base.timestamp) return false;
  return candidate.id > base.id;
}

export function normalizeCursor(value: unknown): MessageCursor {
  if (typeof value === 'string') {
    return { timestamp: value, id: '' };
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { timestamp?: unknown }).timestamp === 'string'
  ) {
    const maybeId = (value as { id?: unknown }).id;
    return {
      timestamp: (value as { timestamp: string }).timestamp,
      id: typeof maybeId === 'string' ? maybeId : '',
    };
  }
  return { ...EMPTY_CURSOR };
}

// ── XML Utilities ─────────────────────────────────────

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── JID Filename Encoding ─────────────────────────────

export function encodeJidForFilename(jid: string): string {
  return Buffer.from(jid).toString('base64url');
}

export function decodeJidFromFilename(filename: string): string {
  const name = filename.endsWith('.txt') ? filename.slice(0, -4) : filename;
  return Buffer.from(name, 'base64url').toString();
}

// ── Reply Builders ────────────────────────────────────

export function buildInterruptedReply(
  partialText: string,
  thinkingText?: string,
): string {
  const trimmed = partialText.trimEnd();
  const trimmedThinking = thinkingText?.trimEnd();
  const parts: string[] = [];
  if (trimmedThinking) {
    parts.push(
      `<details>\n<summary>💭 Reasoning (已中断)</summary>\n\n${trimmedThinking}\n\n</details>`,
    );
  }
  if (trimmed) {
    parts.push(trimmed);
  }
  parts.push('---\n*⚠️ 已中断*');
  return parts.join('\n\n');
}

export function buildOverflowPartialReply(partialText: string): string {
  const trimmed = partialText.trimEnd();
  return trimmed
    ? `${trimmed}\n\n---\n*⚠️ 上下文压缩中，稍后自动继续*`
    : '*⚠️ 上下文压缩中，稍后自动继续*';
}

// ── Cross-Group Permissions ───────────────────────────

/**
 * Check whether a source group is allowed to send a message to a target group.
 * - Admin home group can send to any group.
 * - Any group can send to groups in the same folder.
 * - Member home groups can send to groups created by the same user.
 */
export function canSendCrossGroupMessage(
  isAdminHome: boolean,
  isHome: boolean,
  sourceFolder: string,
  sourceGroupEntry: RegisteredGroup | undefined,
  targetGroup: RegisteredGroup | undefined,
): boolean {
  if (isAdminHome) return true;
  if (targetGroup && targetGroup.folder === sourceFolder) return true;
  if (
    isHome &&
    targetGroup &&
    sourceGroupEntry?.created_by != null &&
    targetGroup.created_by === sourceGroupEntry.created_by
  )
    return true;
  return false;
}
