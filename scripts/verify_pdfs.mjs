#!/usr/bin/env node
// verify_pdfs.mjs — check every downloaded PDF against the catalog and its fetch sidecar.
//
// Local only; safe while download.mjs runs (a PDF without a sidecar that changed in the
// last 60 s counts as in flight). For each manifest row:
//   ok                          on-disk size == catalog pdf_size == sidecar bytes, starts %PDF-
//   size_differs_from_catalog   file matches its sidecar (a complete download) but the catalog
//                               declares a different pdf_size — the catalog is wrong, or the
//                               document changed after the snapshot
//   sidecar_mismatch            on-disk size != sidecar bytes (truncated or altered on disk)
//   bad_magic                   does not start with %PDF-
//   no_sidecar                  a PDF with no sidecar (download never finished cleanly)
//   sha_mismatch                (--sha only) content hash != sidecar sha256
// Plus: not_downloaded, removed_held (documents the city removed that we still hold),
// removed_not_held, superseded copies kept beside re-downloaded documents.
//
// Output: data/verify.json (Bates keys only) and a count summary on stdout.
// Usage: node scripts/verify_pdfs.mjs [--sha]

import { createReadStream } from 'node:fs';
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DATA, REPO } from './lib/portal.mjs';

const SHA = process.argv.includes('--sha');
const rows = (await readFile(join(DATA, 'manifest.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const st = (p) => stat(p).then((s) => s, () => null);

const counts = { manifest_rows: rows.length, checked: 0, ok: 0, size_differs_from_catalog: 0, sidecar_mismatch: 0, bad_magic: 0,
  no_sidecar: 0, in_flight: 0, sha_mismatch: 0, not_downloaded: 0, removed_held: 0, removed_not_held: 0, superseded_copies: 0,
  bytes_on_disk: 0 };
const lists = { size_differs_from_catalog: [], sidecar_mismatch: [], bad_magic: [], no_sidecar: [], sha_mismatch: [], removed_held: [] };

for (const r of rows) {
  const p = join(REPO, r.local_pdf);
  const s = await st(p);
  if (!s) {
    if (r.status === 'removed') counts.removed_not_held++; else counts.not_downloaded++;
    continue;
  }
  if (r.status === 'removed') { counts.removed_held++; lists.removed_held.push({ key: r.key, removed_at: r.removed_at }); }
  const sc = JSON.parse(await readFile(`${p}.json`, 'utf8').catch(() => 'null'));
  if (!sc) {
    if (Date.now() - s.mtimeMs < 60_000) counts.in_flight++;
    else { counts.no_sidecar++; lists.no_sidecar.push(r.key); }
    continue;
  }
  counts.checked++;
  counts.bytes_on_disk += s.size;
  let fine = true;

  const fh = await open(p, 'r');
  const head = Buffer.alloc(5);
  await fh.read(head, 0, 5, 0);
  await fh.close();
  if (head.toString('latin1') !== '%PDF-') { counts.bad_magic++; lists.bad_magic.push(r.key); fine = false; }

  if (s.size !== sc.bytes) {
    counts.sidecar_mismatch++; lists.sidecar_mismatch.push({ key: r.key, on_disk: s.size, sidecar: sc.bytes }); fine = false;
  } else if (s.size !== r.pdf_size) {
    counts.size_differs_from_catalog++;
    lists.size_differs_from_catalog.push({ key: r.key, catalog: r.pdf_size, on_disk: s.size,
      direction: s.size > r.pdf_size ? 'larger' : 'smaller', etag: sc.etag });
    fine = false;
  }

  if (SHA && sc.sha256) {
    const h = createHash('sha256');
    for await (const chunk of createReadStream(p)) h.update(chunk);
    if (h.digest('hex') !== sc.sha256) { counts.sha_mismatch++; lists.sha_mismatch.push(r.key); fine = false; }
  }
  if (fine) counts.ok++;
}

async function countSuperseded(dir) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await countSuperseded(full);
    else if (/\.superseded-\d+\.pdf$/.test(e.name)) counts.superseded_copies++;
  }
}
await countSuperseded(join(DATA, 'pdf'));

const larger = lists.size_differs_from_catalog.filter((x) => x.direction === 'larger').length;
const out = { checked_at: new Date().toISOString(), sha_checked: SHA, counts,
  size_differs_from_catalog_by_direction: { larger, smaller: lists.size_differs_from_catalog.length - larger }, ...lists };
await writeFile(join(DATA, 'verify.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ ...counts, size_differs_larger: larger, size_differs_smaller: counts.size_differs_from_catalog - larger }));
