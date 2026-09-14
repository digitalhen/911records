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
  const pagesOf = (text) => { const p = text.split('\f'); if (p.length > 1 && p.at(-1).trim() === '') p.pop(); return p; };

  // Corpus-wide over everything extracted: how many documents have no usable text layer at all?
  let noText = 0, sparse = 0, totalPages = 0, blankPagesAll = 0;
  for (const r of have) {
    const p = pagesOf(await readFile(join(REPO, r.local_text), 'utf8'));
    const chars = p.reduce((s, x) => s + x.trim().length, 0);
    totalPages += p.length; blankPagesAll += p.filter((x) => !x.trim()).length;
    if (chars === 0) noText++; else if (chars / p.length < 50) sparse++;
  }
  console.log(JSON.stringify({ extracted_documents: have.length, no_text_layer: noText, under_50_chars_per_page: sparse,
    pages: totalPages, blank_pages: blankPagesAll }));

  // Samples: typical documents, not the smallest — one per volume where possible,
  // each the document closest to the median size of that volume's extracted pool.
  const byVol = new Map();
  for (const r of have) (byVol.get(r.production_volume) ?? byVol.set(r.production_volume, []).get(r.production_volume)).push(r);
  const vols = [...byVol.keys()].sort((a, b) => byVol.get(b).length - byVol.get(a).length);
  const picks = [];
  for (let k = 0; picks.length < Math.min(n, have.length) && k < n * 10; k++) {
    const pool = byVol.get(vols[k % vols.length]).filter((r) => !picks.includes(r)).sort((a, b) => a.pdf_size - b.pdf_size);
    if (pool.length) picks.push(pool[Math.floor(pool.length / 2)]);
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
    const pageTexts = pagesOf(text);
    const pages = pageTexts.length;
    const blankPages = pageTexts.filter((p) => !p.trim()).length;
    out.push({ key: r.key, volume: r.production_volume, pdf_bytes: r.pdf_size, manifest_pages: r.page_count, text_pages: pages,
      blank_pages: blankPages, chars: text.length, tokens: tokens.length, words_3plus: words, numeric_tokens: numeric, junk_tokens: junk,
      junk_rate: tokens.length ? +(junk / tokens.length).toFixed(3) : null,
      dictionary_rate: words ? +(inDict / words).toFixed(3) : null,
      chars_per_page: pages ? Math.round(text.length / pages) : null });
  }
  console.log(JSON.stringify(out, null, 2));
}

if (args.includes('--quality')) await quality(Number(opt('--quality', 3)) || 3);
else await extractAll();
