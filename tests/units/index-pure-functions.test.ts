/**
 * Tests for pure functions extracted to src/pure-utils.ts
 * These functions have no module-level state dependencies.
 *
 * Note: The same logic exists in src/index.ts but importing that file triggers
 * main() side effects (port binding etc.). Testing via pure-utils.ts avoids that.
 * Phase 3 will unify these into a single source.
 */
import { describe, it, expect } from 'vitest';
import {
  isCursorAfter,
  normalizeCursor,
  buildInterruptedReply,
  buildOverflowPartialReply,
  encodeJidForFilename,
  decodeJidFromFilename,
  escapeXml,
  canSendCrossGroupMessage,
} from '../../src/pure-utils.js';
import type { MessageCursor, RegisteredGroup } from '../../src/types.js';

// ── isCursorAfter ─────────────────────────────────────

describe('isCursorAfter', () => {
  it('later timestamp is after', () => {
    const candidate: MessageCursor = { timestamp: '2024-01-02', id: '' };
    const base: MessageCursor = { timestamp: '2024-01-01', id: '' };
    expect(isCursorAfter(candidate, base)).toBe(true);
  });

  it('earlier timestamp is not after', () => {
    const candidate: MessageCursor = { timestamp: '2024-01-01', id: '' };
    const base: MessageCursor = { timestamp: '2024-01-02', id: '' };
    expect(isCursorAfter(candidate, base)).toBe(false);
  });

  it('same timestamp: higher id wins', () => {
    const candidate: MessageCursor = { timestamp: '2024-01-01', id: 'bbb' };
    const base: MessageCursor = { timestamp: '2024-01-01', id: 'aaa' };
    expect(isCursorAfter(candidate, base)).toBe(true);
  });

  it('same timestamp: lower id loses', () => {
    const candidate: MessageCursor = { timestamp: '2024-01-01', id: 'aaa' };
    const base: MessageCursor = { timestamp: '2024-01-01', id: 'bbb' };
    expect(isCursorAfter(candidate, base)).toBe(false);
  });

  it('identical cursor is not after', () => {
    const c: MessageCursor = { timestamp: '2024-01-01', id: 'aaa' };
    expect(isCursorAfter(c, c)).toBe(false);
  });

  it('empty strings compare correctly', () => {
    const candidate: MessageCursor = { timestamp: '', id: '' };
    const base: MessageCursor = { timestamp: '', id: '' };
    expect(isCursorAfter(candidate, base)).toBe(false);
  });
});

// ── normalizeCursor ───────────────────────────────────

describe('normalizeCursor', () => {
  it('parses string into { timestamp, id: "" }', () => {
    expect(normalizeCursor('2024-01-01T00:00:00Z')).toEqual({
      timestamp: '2024-01-01T00:00:00Z',
      id: '',
    });
  });

  it('parses object with timestamp and id', () => {
    expect(normalizeCursor({ timestamp: 't1', id: 'i1' })).toEqual({
      timestamp: 't1',
      id: 'i1',
    });
  });

  it('parses object with timestamp but no id', () => {
    expect(normalizeCursor({ timestamp: 't1' })).toEqual({
      timestamp: 't1',
      id: '',
    });
  });

  it('returns empty cursor for null', () => {
    expect(normalizeCursor(null)).toEqual({ timestamp: '', id: '' });
  });

  it('returns empty cursor for undefined', () => {
    expect(normalizeCursor(undefined)).toEqual({ timestamp: '', id: '' });
  });

  it('returns empty cursor for number', () => {
    expect(normalizeCursor(123)).toEqual({ timestamp: '', id: '' });
  });

  it('returns empty cursor for object without timestamp', () => {
    expect(normalizeCursor({ foo: 'bar' })).toEqual({ timestamp: '', id: '' });
  });

  it('ignores non-string id in object', () => {
    expect(normalizeCursor({ timestamp: 't1', id: 123 })).toEqual({
      timestamp: 't1',
      id: '',
    });
  });
});

// ── JID filename encoding ─────────────────────────────

describe('JID filename encoding', () => {
  it('round-trip: dingtalk group JID', () => {
    const jid = 'dingtalk:group:conv123';
    expect(decodeJidFromFilename(encodeJidForFilename(jid))).toBe(jid);
  });

  it('round-trip: web JID', () => {
    const jid = 'web:main';
    expect(decodeJidFromFilename(encodeJidForFilename(jid))).toBe(jid);
  });

  it('round-trip: JID with special characters', () => {
    const jid = 'feishu:ou_xxxx/chat_xxxx';
    expect(decodeJidFromFilename(encodeJidForFilename(jid))).toBe(jid);
  });

  it('round-trip: empty string', () => {
    expect(decodeJidFromFilename(encodeJidForFilename(''))).toBe('');
  });

  it('strips .txt extension when decoding', () => {
    const jid = 'qq:c2c:openid123';
    const encoded = encodeJidForFilename(jid);
    expect(decodeJidFromFilename(encoded + '.txt')).toBe(jid);
  });
});

// ── escapeXml ─────────────────────────────────────────

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('a&b')).toBe('a&amp;b');
  });

  it('escapes less-than', () => {
    expect(escapeXml('a<b')).toBe('a&lt;b');
  });

  it('escapes greater-than', () => {
    expect(escapeXml('a>b')).toBe('a&gt;b');
  });

  it('escapes double quotes', () => {
    expect(escapeXml('a"b')).toBe('a&quot;b');
  });

  it('escapes all special chars together', () => {
    expect(escapeXml('<>&"')).toBe('&lt;&gt;&amp;&quot;');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeXml('hello world 123')).toBe('hello world 123');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });
});

// ── buildInterruptedReply ─────────────────────────────

describe('buildInterruptedReply', () => {
  it('partial text only', () => {
    const result = buildInterruptedReply('some text');
    expect(result).toContain('some text');
    expect(result).toContain('⚠️ 已中断');
    expect(result).not.toContain('💭');
  });

  it('partial text with thinking', () => {
    const result = buildInterruptedReply('response', 'reasoning');
    expect(result).toContain('response');
    expect(result).toContain('💭');
    expect(result).toContain('reasoning');
    expect(result).toContain('⚠️ 已中断');
  });

  it('thinking only, no text', () => {
    const result = buildInterruptedReply('  ', 'reasoning');
    expect(result).toContain('💭');
    expect(result).toContain('⚠️ 已中断');
  });

  it('empty text and no thinking', () => {
    const result = buildInterruptedReply('');
    expect(result).toContain('⚠️ 已中断');
  });
});

// ── buildOverflowPartialReply ─────────────────────────

describe('buildOverflowPartialReply', () => {
  it('includes partial text when present', () => {
    const result = buildOverflowPartialReply('partial content');
    expect(result).toContain('partial content');
    expect(result).toContain('上下文压缩中');
  });

  it('only warning when no text', () => {
    const result = buildOverflowPartialReply('');
    expect(result).toContain('上下文压缩中');
  });

  it('trims trailing whitespace', () => {
    const result = buildOverflowPartialReply('text   ');
    expect(result).toContain('text');
  });
});

// ── canSendCrossGroupMessage ──────────────────────────

describe('canSendCrossGroupMessage', () => {
  const baseGroup: RegisteredGroup = {
    jid: 'web:home-user1',
    folder: 'home-user1',
    is_home: true,
    is_admin_home: false,
    execution_mode: 'container',
    created_by: 'user1',
  } as RegisteredGroup;

  it('admin home can always send', () => {
    expect(canSendCrossGroupMessage(true, false, 'main', baseGroup, undefined)).toBe(true);
  });

  it('same folder always allowed', () => {
    const target = { ...baseGroup, folder: 'home-user1' } as RegisteredGroup;
    expect(canSendCrossGroupMessage(false, true, 'home-user1', baseGroup, target)).toBe(true);
  });

  it('home group can send to groups with same owner', () => {
    const target = {
      jid: 'dingtalk:group:xxx',
      folder: 'home-user1-sub',
      created_by: 'user1',
    } as RegisteredGroup;
    expect(canSendCrossGroupMessage(false, true, 'home-user1', baseGroup, target)).toBe(true);
  });

  it('home group cannot send to different owner', () => {
    const target = {
      jid: 'dingtalk:group:yyy',
      folder: 'home-user2-sub',
      created_by: 'user2',
    } as RegisteredGroup;
    expect(canSendCrossGroupMessage(false, true, 'home-user1', baseGroup, target)).toBe(false);
  });

  it('non-home non-admin cannot send cross-group', () => {
    expect(canSendCrossGroupMessage(false, false, 'some-folder', baseGroup, undefined)).toBe(false);
  });

  it('undefined target is rejected for non-admin', () => {
    expect(canSendCrossGroupMessage(false, true, 'home-user1', baseGroup, undefined)).toBe(false);
  });

  it('undefined source group entry prevents same-owner check', () => {
    const target = {
      jid: 'dingtalk:group:xxx',
      folder: 'home-user1-sub',
      created_by: 'user1',
    } as RegisteredGroup;
    expect(canSendCrossGroupMessage(false, true, 'home-user1', undefined, target)).toBe(false);
  });
});
