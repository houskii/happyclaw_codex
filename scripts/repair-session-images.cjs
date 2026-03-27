#!/usr/bin/env node
/**
 * Session Image Repair Script
 *
 * Scans session JSONL files for invalid image blocks (e.g., API error responses
 * saved as .png files) and replaces them with text blocks describing the error.
 *
 * Background: When curl saves an API error response as a .png file, the SDK's
 * Read tool embeds it as a base64 "image" in conversation history. On session
 * resume, the Claude API rejects with "Could not process image", permanently
 * breaking the session.
 *
 * Usage:
 *   node scripts/repair-session-images.cjs [--dry-run] [--session <id>]
 *
 * Options:
 *   --dry-run     Report issues without fixing them
 *   --session     Only check a specific session ID (otherwise checks all)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

// PNG/JPEG/GIF/WebP magic bytes
const IMAGE_SIGNATURES = [
  { name: 'PNG',  bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'JPEG', bytes: [0xff, 0xd8, 0xff] },
  { name: 'GIF',  bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'WebP', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
  { name: 'BMP',  bytes: [0x42, 0x4d] },
];

function isValidImageBase64(base64Data) {
  try {
    const buf = Buffer.from(base64Data.slice(0, 100), 'base64');
    if (buf.length < 4) return false;

    for (const sig of IMAGE_SIGNATURES) {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buf[i] !== sig.bytes[i]) { match = false; break; }
      }
      if (match) return true;
    }

    // TIFF
    if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
        (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)) {
      return true;
    }

    // AVIF
    if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buf.toString('ascii', 8, 12);
      if (brand === 'avif' || brand === 'avis') return true;
    }

    return false;
  } catch {
    return false;
  }
}

function decodePreview(base64Data) {
  try {
    return Buffer.from(base64Data.slice(0, 100), 'base64').toString('utf-8').slice(0, 80);
  } catch {
    return '(decode error)';
  }
}

function findAndFixInvalidImages(obj, fixes) {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (item && typeof item === 'object' && item.type === 'image' &&
          item.source && item.source.type === 'base64' && typeof item.source.data === 'string') {
        if (!isValidImageBase64(item.source.data)) {
          const preview = decodePreview(item.source.data);
          fixes.push({
            mediaType: item.source.media_type,
            dataLen: item.source.data.length,
            preview,
          });
          // Replace image block with text block
          obj[i] = {
            type: 'text',
            text: `[Invalid image removed by repair script: media_type=${item.source.media_type}, ` +
                  `base64_len=${item.source.data.length}, content_preview="${preview}"]`,
          };
        }
      } else {
        findAndFixInvalidImages(item, fixes);
      }
    }
    return;
  }

  for (const value of Object.values(obj)) {
    findAndFixInvalidImages(value, fixes);
  }
}

function processJsonlFile(filePath, dryRun) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let totalFixes = 0;
  const fixedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      fixedLines.push(line);
      continue;
    }

    try {
      const obj = JSON.parse(line);
      const fixes = [];
      findAndFixInvalidImages(obj, fixes);

      if (fixes.length > 0) {
        totalFixes += fixes.length;
        for (const fix of fixes) {
          console.log(`  Line ${i}: Invalid image (${fix.mediaType}, ${fix.dataLen} base64 chars)`);
          console.log(`    Preview: "${fix.preview}"`);
        }
        fixedLines.push(JSON.stringify(obj));
      } else {
        fixedLines.push(line);
      }
    } catch {
      fixedLines.push(line);
    }
  }

  if (totalFixes > 0 && !dryRun) {
    // Backup original
    const backupPath = filePath + '.bak';
    fs.copyFileSync(filePath, backupPath);
    console.log(`  Backup: ${backupPath}`);

    // Write fixed version
    fs.writeFileSync(filePath, fixedLines.join('\n'));
    console.log(`  Fixed ${totalFixes} invalid image block(s)`);
  } else if (totalFixes > 0) {
    console.log(`  [DRY RUN] Would fix ${totalFixes} invalid image block(s)`);
  }

  return totalFixes;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sessionIdx = args.indexOf('--session');
  const targetSession = sessionIdx >= 0 ? args[sessionIdx + 1] : null;

  console.log(`Session Image Repair${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`Sessions dir: ${SESSIONS_DIR}`);
  console.log('');

  if (!fs.existsSync(SESSIONS_DIR)) {
    console.error('Sessions directory not found');
    process.exit(1);
  }

  let totalFixed = 0;
  let filesScanned = 0;

  // Walk sessions/<folder>/.claude/projects/<project>/*.jsonl
  const sessionFolders = fs.readdirSync(SESSIONS_DIR);
  for (const folder of sessionFolders) {
    const projectsDir = path.join(SESSIONS_DIR, folder, '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) continue;

    const projects = fs.readdirSync(projectsDir);
    for (const project of projects) {
      const projectDir = path.join(projectsDir, project);
      if (!fs.statSync(projectDir).isDirectory()) continue;

      const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const sessionId = file.replace('.jsonl', '');
        if (targetSession && sessionId !== targetSession) continue;

        const filePath = path.join(projectDir, file);
        filesScanned++;

        // Quick check: does the file contain "image" at all?
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (!raw.includes('"type":"image"') && !raw.includes('"type": "image"')) continue;

        console.log(`Scanning: ${folder}/${sessionId}`);
        const fixed = processJsonlFile(filePath, dryRun);
        totalFixed += fixed;
      }
    }
  }

  console.log('');
  console.log(`Scanned ${filesScanned} session file(s), fixed ${totalFixed} invalid image block(s)`);
  if (dryRun && totalFixed > 0) {
    console.log('Re-run without --dry-run to apply fixes');
  }
}

main();
