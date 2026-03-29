/**
 * Shared IM utilities extracted from qq.ts / dingtalk.ts / wechat.ts
 * to eliminate code duplication.
 *
 * Phase 2 of the optimization plan.
 */

// ── Markdown → Plain Text ────────────────────────────────

export function markdownToPlainText(md: string): string {
  let text = md;

  // Code blocks: keep content, remove fences
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  });

  // Inline code: remove backticks
  text = text.replace(/`([^`]+)`/g, '$1');

  // Links: [text](url) → text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Bold: **text** or __text__ → text
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/__(.+?)__/g, '$1');

  // Strikethrough: ~~text~~ → text
  text = text.replace(/~~(.+?)~~/g, '$1');

  // Italic: *text* → text
  text = text.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1');

  // Headings: # text → text
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  return text;
}

// ── Text Chunking ──────────────────────────────────────

export function splitTextChunks(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf('\n\n', limit);
    if (splitIdx < limit * 0.3) {
      splitIdx = remaining.lastIndexOf('\n', limit);
    }
    if (splitIdx < limit * 0.3) {
      splitIdx = remaining.lastIndexOf(' ', limit);
    }
    if (splitIdx < limit * 0.3) {
      splitIdx = limit;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
