#!/usr/bin/env node
// diff_catalog.mjs — what changed between two catalog snapshots, by Bates number.
//
// Local only. Compares data/catalog/<A>.csv and <B>.csv (names, dates or paths;
// default: the two most recent snapshots) and reports documents added, removed and
// changed, with page and byte deltas and a per-volume breakdown. Removed documents are
// cross-referenced with data/pdf/ so we know which removals we still hold a copy of —
// those copies are flagged in the manifest by enumerate.mjs, never deleted.
//
// PII: folder_name is hand-labelled and can contain personal names, so a change to it is
// reported as a field name only; its values are never printed or written.
//
// Writes the full report to data/catalog/diff-<A>-to-<B>.json (or --json path).
//
// Usage: node scripts/diff_catalog.mjs [A] [B] [--json out.json] [--list]
//   A, B: snapshot names ("2026-09-13"), file names, or paths to any export-shaped CSV
//   --list   print every added/removed/changed Bates number (default: first 50 of each)

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { DATA, REPO } from './lib/portal.mjs';
import { diffCatalogs, listSnapshots, loadSnapshot } from './lib/catalog.mjs';

const argv = process.argv.slice(2);
const jsonAt = argv.indexOf('--json');
const jsonOut = jsonAt >= 0 ? argv.splice(jsonAt, 2)[1] : null;
const LIST = argv.includes('--list');
const positional = argv.filter((a) => !a.startsWith('--'));

const snaps = await listSnapshots();
let [a, b] = positional;
if (!a || !b) {
  if (snaps.length < 2) { console.error(`need two snapshots in data/catalog (have ${snaps.length}); pass paths explicitly`); process.exit(1); }
  if (!a) [a, b] = [snaps.at(-2).name, snaps.at(-1).name];
  else b = snaps.at(-1).name;
}
const resolve = (x) => snaps.find((s) => s.name === x || s.name === `${x}.csv` || s.date === x)?.path ?? x;

const [A, B] = await Promise.all([loadSnapshot(resolve(a)), loadSnapshot(resolve(b))]);
const d = diffCatalogs(A.rows, B.rows);

// Which removed documents do we still hold? Read paths from the manifest when available.
const manifest = new Map((await readFile(join(DATA, 'manifest.jsonl'), 'utf8').catch(() => ''))
  .split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.bates_start, r]; }));
for (const r of d.removed) {
  const m = manifest.get(r.bates);
  r.held_locally = m ? await stat(join(REPO, m.local_pdf)).then(() => true, () => false) : false;
}

const report = { old: { path: A.path, sha256: A.sha256 }, new: { path: B.path, sha256: B.sha256 }, generated_at: new Date().toISOString(), ...d };
const stemOf = (p) => basename(p).replace(/\.csv$/, '');
const outPath = jsonOut ?? join(DATA, 'catalog', `diff-${stemOf(A.path)}-to-${stemOf(B.path)}.json`);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2) + '\n');

const c = d.counts;
const cap = (xs) => (LIST ? xs : xs.slice(0, 50));
console.log(`${A.path.split('/').at(-1)} -> ${B.path.split('/').at(-1)}   (full report: ${outPath})`);
console.log(`documents ${c.old_documents} -> ${c.new_documents} (net ${c.net_documents >= 0 ? '+' : ''}${c.net_documents}), net pages ${c.net_pages}`);
console.log(`added ${c.added} (${c.pages_added} pages, ${c.bytes_added} B)  removed ${c.removed} (${c.pages_removed} pages, ${c.bytes_removed} B)  changed ${c.changed} (page delta ${c.pages_changed_delta})`);
for (const [v, x] of Object.entries(d.by_volume)) console.log(`  ${v}: +${x.added} −${x.removed} ~${x.changed}`);
if (d.removed.length) {
  console.log('removed:');
  for (const r of cap(d.removed)) console.log(`  ${r.bates}  ${r.volume}  pages=${r.pages}  bytes=${r.pdf_size}  held_locally=${r.held_locally}`);
}
if (d.added.length) {
  console.log('added:');
  for (const r of cap(d.added)) console.log(`  ${r.bates}  ${r.volume}  pages=${r.pages}  bytes=${r.pdf_size}`);
}
if (d.changed.length) {
  console.log('changed:');
  for (const x of cap(d.changed)) console.log(`  ${x.bates}  fields=${x.fields.join(',')}  pages${x.page_delta >= 0 ? '+' : ''}${x.page_delta}  bytes${x.size_delta >= 0 ? '+' : ''}${x.size_delta}`);
}
if (!LIST && Math.max(d.added.length, d.removed.length, d.changed.length) > 50) console.log('(truncated at 50 per list; --list or --json for all)');
