#!/usr/bin/env node
// extract_text.mjs — pdftotext -layout over every downloaded PDF.
//
// Node 20+, no npm dependencies; needs poppler's `pdftotext` (brew install poppler).
// Local CPU only — never touches the portal.
//
// For each manifest row whose PDF is complete (its download sidecar exists):
//   data/text/<agency>/<volume>/<bates_start>.txt          whole document, pages separated by \f
//   data/text/<agency>/<volume>/<bates_start>.pages.jsonl  {page, bates, chars, text} one line per page
// Skips documents whose .txt is newer than the PDF. Safe to run while download.mjs is running.
//
// Usage: node scripts/extract_text.mjs [--jobs 4] [--force]
//        node scripts/extract_text.mjs --quality [N]   score N extracted documents (counts only, no text printed)

import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { DATA, REPO } from './lib/portal.mjs';

const run = promisify(execFile);
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt; };
const JOBS = Number(opt('--jobs', 4)) || 4;
const FORCE = args.includes('--force');
const exists = (p) => stat(p).then((s) => s, () => null);

async function manifest() {
  const text = await readFile(join(DATA, 'manifest.jsonl'), 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function batesAt(row, pageIndex) {
  const m = /^(.*?)(\d+)$/.exec(row.bates_start);
  if (!m) return null;
  return m[1] + String(Number(m[2]) + pageIndex).padStart(m[2].length, '0');
}

async function extractOne(row) {
  const pdf = join(REPO, row.local_pdf);
  const [p, side] = await Promise.all([exists(pdf), exists(`${pdf}.json`)]);
  if (!p || !side) return 'not-downloaded';
  const txt = join(REPO, row.local_text);
  const t = await exists(txt);
  if (t && !FORCE && t.mtimeMs >= p.mtimeMs) return 'up-to-date';
  await mkdir(dirname(txt), { recursive: true });
  const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], { maxBuffer: 2 * 1024 ** 3, encoding: 'utf8' });
  const pages = stdout.split('\f');
  if (pages.length > 1 && pages.at(-1).trim() === '') pages.pop();
  const jsonl = pages.map((text, i) => JSON.stringify({ page: i + 1, bates: batesAt(row, i), chars: text.length, text })).join('\n') + '\n';
  await writeFile(`${txt}.tmp`, stdout);
  await writeFile(txt.replace(/\.txt$/, '.pages.jsonl'), jsonl);
  await rename(`${txt}.tmp`, txt);
  return 'extracted';
}

async function extractAll() {
  const rows = await manifest();
  const counts = {};
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const row = rows[i++];
      let r;
      try { r = await extractOne(row); } catch (e) { r = 'error'; console.error(`error ${row.key}: ${e.message.split('\n')[0]}`); }
      counts[r] = (counts[r] ?? 0) + 1;
      if (r === 'extracted' && counts.extracted % 250 === 0) console.error(`extracted ${counts.extracted}…`);
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  console.log(JSON.stringify(counts));
}

// OCR quality as counts only. A "word" is a purely alphabetic token of >= 3
// letters; "dictionary rate" is the share of those found in /usr/share/dict/words
// (case-insensitive). "Junk" is a token with no letters or digits, or with 3+
// consecutive non-alphanumerics inside it. No text is ever printed.
async function quality(n) {
  const dict = new Set((await readFile('/usr/share/dict/words', 'utf8').catch(() => '')).split('\n').map((w) => w.toLowerCase()));
  const rows = await manifest();
  const have = [];
  for (const r of rows) if (await exists(join(REPO, r.local_text))) have.push(r);
  if (!have.length) { console.log('no extracted text yet'); return; }
  // Stratify: spread picks across volumes, then across sizes within the pool.
  const byVol = new Map();
  for (const r of have) (byVol.get(r.production_volume) ?? byVol.set(r.production_volume, []).get(r.production_volume)).push(r);
  const picks = [];
  const vols = [...byVol.keys()].sort();
  for (let k = 0; picks.length < Math.min(n, have.length); k++) {
    const pool = byVol.get(vols[k % vols.length]).sort((a, b) => a.pdf_size - b.pdf_size);
    const cand = pool[Math.floor(((k * 7919) % 100) / 100 * pool.length)];
    if (!picks.includes(cand)) picks.push(cand);
    if (k > n * 50) break;
  }
  const out = [];
  for (const r of picks) {
    const text = await readFile(join(REPO, r.local_text), 'utf8');
    const tokens = text.split(/\s+/).filter(Boolean);
    let words = 0, inDict = 0, numeric = 0, junk = 0;
    for (const t of tokens) {
      const bare = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!/[\p{L}\p{N}]/u.test(t) || /[^\p{L}\p{N}]{3,}/u.test(bare)) { junk++; continue; }
      if (/\d/.test(bare)) { numeric++; continue; }
      if (/^\p{L}{3,}$/u.test(bare)) { words++; if (dict.has(bare.toLowerCase())) inDict++; }
    }
    const pages = text.split('\f').filter((p, i, a) => i < a.length - 1 || p.trim()).length;
    const blankPages = text.split('\f').filter((p) => !p.trim()).length;
    out.push({ key: r.key, volume: r.production_volume, agency: r.agency, manifest_pages: r.page_count, text_pages: pages,
      blank_pages: blankPages, chars: text.length, tokens: tokens.length, words_3plus: words, numeric_tokens: numeric, junk_tokens: junk,
      junk_rate: tokens.length ? +(junk / tokens.length).toFixed(3) : null,
      dictionary_rate: words ? +(inDict / words).toFixed(3) : null,
      chars_per_page: pages ? Math.round(text.length / pages) : null });
  }
  console.log(JSON.stringify(out, null, 2));
}

if (args.includes('--quality')) await quality(Number(opt('--quality', 3)) || 3);
else await extractAll();
