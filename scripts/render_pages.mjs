#!/usr/bin/env node
// Local-only page rendering. Intermediates stay on disk; a deadline aborts only our children.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, stat, readdir, open } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile), ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function number(flag, fallback) { const i = args.indexOf(flag); const n = i < 0 ? fallback : Number(args[i + 1]); if (!Number.isFinite(n) || n < 0 || (flag !== '--max-seconds' && !Number.isInteger(n))) throw Error(`Invalid ${flag}`); return n; }
const jobs = number('--jobs', 4), limit = number('--limit', 0), seconds = number('--max-seconds', 0);
if (!jobs) throw Error('--jobs must be positive');
const order = args.includes('--order') ? args[args.indexOf('--order') + 1] : 'size';
if (!['size', 'manifest'].includes(order)) throw Error('Invalid --order');
const deadline = seconds ? Date.now() + seconds * 1000 : Infinity;
async function command(cmd, argv) { const left = deadline - Date.now(); if (left <= 0) throw Error('deadline'); return run(cmd, argv, { timeout: Number.isFinite(left) ? Math.max(1, Math.ceil(left)) : 0, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 ** 2 }); }
const exists = p => stat(p).catch(() => null);
async function dimensions(path) {
  const f = await open(path, 'r'); const b = Buffer.alloc(65536); let bytesRead;
  try { ({ bytesRead } = await f.read(b)); } finally { await f.close(); }
  if (b.toString('ascii', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('ascii', 8, 12) === 'WEBP') {
    const type = b.toString('ascii', 12, 16);
    if (type === 'VP8 ') return [b.readUInt16LE(26) & 16383, b.readUInt16LE(28) & 16383];
    if (type === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (type === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 16383) + 1, ((v >>> 14) & 16383) + 1]; }
  }
  for (let i = 2; i + 9 < bytesRead;) { if (b[i++] !== 255) break; const marker = b[i++]; if ([192,193,194].includes(marker)) return [b.readUInt16BE(i + 5), b.readUInt16BE(i + 3)]; i += b.readUInt16BE(i); }
  throw Error('Unsupported image header');
}
const help = await command('pdftoppm', ['-h']);
const native = /-webp\b/.test(help.stdout + help.stderr);
let converter = null;
if (!native) {
  try { await command('cwebp', ['-version']); converter = 'cwebp'; } catch {
    try { const r = await command('sips', ['--formats']); if (/webp.*(writable|read\/write)/i.test(r.stdout)) converter = 'sips'; } catch {}
  }
}
const ext = native || converter ? 'webp' : 'jpg';
const summary = { rendered: 0, 'up-to-date': 0, errors: 0, timed_out: false, format: ext };
const manifest = (await readFile(join(ROOT, 'data/manifest.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const catalog = new Map(manifest.map(r => [resolve(ROOT, r.local_pdf), r]));
const rows = [];
async function walk(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.pdf.json') && !e.name.includes('.superseded-')) { const pdf = p.slice(0, -5); try { const side = JSON.parse(await readFile(p, 'utf8')), s = await exists(pdf); if (side.sha256 && s) rows.push({ pdf, size: s.size, count: Number(side.page_count ?? side.pages ?? catalog.get(pdf)?.page_count) }); } catch {} } } }
await walk(join(ROOT, 'data/pdf'));
if (order === 'size') rows.sort((a,b) => a.size - b.size || a.pdf.localeCompare(b.pdf));
else { const rank = new Map([...catalog.keys()].map((p,i) => [p,i])); rows.sort((a,b) => (rank.get(a.pdf) ?? Infinity) - (rank.get(b.pdf) ?? Infinity)); }
let cursor = 0, started = 0;
async function worker() {
  while (cursor < rows.length && (!limit || started < limit)) {
    if (Date.now() >= deadline) { summary.timed_out = true; return; }
    const row = rows[cursor++];
    const dest = join(ROOT, 'data/pages', relative(join(ROOT, 'data/pdf'), row.pdf).slice(0,-4));
    const meta = await readFile(join(dest, 'pages.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!args.includes('--force') && meta && meta.pages === row.count) { summary['up-to-date']++; continue; }
    // Reserve work before the next await so --limit holds with parallel workers.
    if (limit && started >= limit) return;
    started++;
    let tmp;
    try {
      await mkdir(dest, { recursive: true }); tmp = await mkdtemp(join(dest, '.render-'));
      const mode = native ? ['-webp'] : converter ? ['-png'] : ['-jpeg', '-jpegopt', 'quality=70'];
      await command('pdftoppm', ['-r', '110', ...mode, row.pdf, join(tmp, 'page')]);
      const inputExt = native ? 'webp' : converter ? 'png' : 'jpg';
      const files = (await readdir(tmp)).filter(f => f.endsWith(`.${inputExt}`)).sort((a,b) => Number(a.match(/-(\d+)\./)[1]) - Number(b.match(/-(\d+)\./)[1]));
      if (!files.length) throw Error('No pages rendered');
      const w = [], h = [];
      for (const [i, file] of files.entries()) {
        const src = join(tmp, file), out = join(tmp, `${i+1}.${ext}`);
        const [width, height] = await dimensions(src); w.push(width); h.push(height);
        if (converter === 'cwebp') await command('cwebp', ['-quiet', '-q', '70', src, '-o', out]);
        else if (converter === 'sips') await command('sips', ['-s', 'format', 'webp', '-s', 'formatOptions', '70', src, '--out', out]);
        else await rename(src, out);
        const thumb = join(tmp, `${i+1}.t.${ext}`);
        if (converter === 'cwebp') await command('cwebp', ['-quiet', '-q', '70', '-resize', String(width >= height ? 240 : 0), String(height > width ? 240 : 0), out, '-o', thumb]);
        else if (converter === 'sips') await command('sips', ['-Z', '240', out, '--out', thumb]);
        else await command('pdftoppm', ['-f', String(i+1), '-l', String(i+1), '-singlefile', '-scale-to', '240', ...mode, row.pdf, thumb.slice(0, -(ext.length+1))]);
        await rename(out, join(dest, `${i+1}.${ext}`)); await rename(thumb, join(dest, `${i+1}.t.${ext}`));
        if (converter) await rm(src);
      }
      await writeFile(join(tmp, 'pages.json'), JSON.stringify({ pages: files.length, w, h, dpi: 110, rendered_at: new Date().toISOString() }) + '\n');
      await rename(join(tmp, 'pages.json'), join(dest, 'pages.json')); summary.rendered++;
    } catch (e) { if (Date.now() >= deadline) summary.timed_out = true; else { summary.errors++; console.error(`render ${row.pdf}: ${e.message.split('\n')[0]}`); } }
    finally { if (tmp) await rm(tmp, { recursive: true, force: true }); }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log(JSON.stringify(summary));
if (summary.errors) process.exitCode = 1;
