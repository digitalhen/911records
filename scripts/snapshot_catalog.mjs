#!/usr/bin/env node
// snapshot_catalog.mjs — take today's catalog snapshot, and nothing else.
//
// Node 20+, no dependencies. ONE POST to the catalog export on the Mindbreeze backend host
// (scripts/lib/catalog.mjs; the city hostname answers 404 for that path) and writes:
//   data/catalog/<YYYY-MM-DD>.csv            the export verbatim (America/New_York date), immutable;
//                                            an identical same-day export reuses the file, a different
//                                            one is kept beside it as <YYYY-MM-DD>T<HHMMSS>.csv
//   data/catalog/<same stem>.summary.json    sha256, docs/pages/bytes, per agency/volume/source,
//                                            boxes/folders, Bates gaps, accepted/quarantined, diff counts
//                                            vs the previous accepted snapshot
// It does not touch the manifest — enumerate.mjs does that (and also snapshots).
//
// Quarantine: zero rows, duplicate Bates numbers, or > 5% fewer documents than the last
// accepted snapshot -> kept, but accepted:false (exit 2), so nothing downstream trusts it.
//
// Usage: node scripts/snapshot_catalog.mjs          exit 0 ok, 2 quarantined, 3 stopped by portal, 1 error

import { PortalStop, makeClient } from './lib/portal.mjs';
import {
  catalogStats, diffCatalogs, exportCatalog, listSnapshots, loadSnapshot, parseCatalog, quarantineReasons, saveSnapshot,
  writeSnapshotSummary,
} from './lib/catalog.mjs';

try {
  const client = makeClient({ minGapMs: 1000 });
  const fetchedAt = new Date();
  const e = await exportCatalog(client);
  const { rows } = parseCatalog(e.text);
  const stats = catalogStats(rows);

  const accepted = (await listSnapshots()).filter((s) => s.summary?.accepted);
  const snap = await saveSnapshot(e.text, { fetchedAt });
  const prev = accepted.filter((s) => s.name !== snap.name).at(-1) ?? null;
  const earlier = snap.reused ? accepted.find((s) => s.name === snap.name)?.summary : null;
  const reasons = quarantineReasons(stats, prev?.summary?.stats);

  let diff = null;
  if (prev) {
    const d = diffCatalogs((await loadSnapshot(prev.path)).rows, rows);
    diff = { against: prev.name, ...d.counts, by_volume: d.by_volume };
  }
  await writeSnapshotSummary(snap.name, {
    name: snap.name, sha256: snap.sha256, origin: 'export', fetched_at: fetchedAt.toISOString(), date: snap.date,
    reused_existing_file: snap.reused, export: { bytes: e.bytes, seconds: e.seconds, content_type: e.contentType },
    accepted: reasons.length === 0, quarantined: reasons.length > 0, quarantine_reasons: reasons, stats,
    facet_check: earlier?.facet_check ?? null, diff_vs_previous: diff,
    ...(earlier?.notes ? { notes: earlier.notes } : {}),
  });

  const gb = (b) => (b / 1e9).toFixed(2);
  console.log(`${snap.name}${snap.reused ? ' (identical to existing, reused)' : ''} sha256 ${snap.sha256.slice(0, 12)}… ` +
    `${e.bytes} B in ${e.seconds}s`);
  console.log(`documents ${stats.documents}, pages ${stats.pages}, ${gb(stats.pdf_bytes)} GB, boxes ${stats.boxes}, folders ${stats.folders}, max Bates ${stats.max_bates_end}`);
  for (const [k, v] of Object.entries(stats.by_agency)) console.log(`  ${k}: ${v.documents} docs, ${v.pages} pages, ${gb(v.bytes)} GB`);
  for (const [k, v] of Object.entries(stats.by_volume)) console.log(`  ${k}: ${v.documents} docs, ${v.pages} pages, ${gb(v.bytes)} GB`);
  if (diff) console.log(`vs ${prev.name}: +${diff.added} −${diff.removed} ~${diff.changed} (net pages ${diff.net_pages}) — details: node scripts/diff_catalog.mjs ${prev.name} ${snap.name}`);
  if (reasons.length) { console.log(`QUARANTINED: ${reasons.join('; ')}`); process.exit(2); }
} catch (err) {
  console.error(err instanceof PortalStop ? `STOPPED: ${err.message} ${JSON.stringify(err.detail)}` : err.stack);
  process.exit(err instanceof PortalStop ? 3 : 1);
}
