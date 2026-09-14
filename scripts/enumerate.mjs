#!/usr/bin/env node
// enumerate.mjs — snapshot the portal's catalog and (re)build data/manifest.jsonl from it.
//
// Node 20+, no dependencies.
//
// Primary path: ONE POST to the catalog export (scripts/lib/catalog.mjs), stored as an
// immutable dated snapshot data/catalog/<YYYY-MM-DD>.csv (+ .summary.json). Fallback, if
// the export fails (or with --search): the paged-search walk, one production_volume at a
// time with extension:pdf, serialized into the same CSV shape so everything downstream is
// identical. A 429/403/challenge page never falls back — it stops the run.
//
// Then:
//   - cross-check counts per volume/agency/source against the search API's facets (1 request);
//   - QUARANTINE a snapshot with duplicate Bates numbers, zero rows, or > 5% fewer documents
//     than the last accepted snapshot: it is kept for inspection but the manifest is untouched;
//   - diff against the last accepted snapshot (counts land in the snapshot summary;
//     scripts/diff_catalog.mjs prints the detail);
//   - merge into the manifest. Documents that left the catalog are KEPT with
//     status "removed" + removed_at (+ held_locally) and are never deleted; first_seen /
//     last_seen / changed_at are carried across runs.
//
// Output: data/catalog/<date>.csv + .summary.json, data/manifest.jsonl, data/manifest.summary.json
//
// Usage: node scripts/enumerate.mjs [--search] [--no-facets]
//        node scripts/enumerate.mjs --seed <export.csv> --date YYYY-MM-DD   (import an export captured elsewhere, no export request)
// Exit: 0 ok, 2 quarantined or facet mismatch, 3 stopped by the portal, 1 error.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DATA, PortalStop, REPO, contentUrl, docStem, flatten, makeClient, search } from './lib/portal.mjs';
import {
  DIFF_FIELDS, batesNum, catalogStats, diffCatalogs, exportCatalog, listSnapshots, loadSnapshot, nyDate, parseCatalog,
  saveSnapshot, toCsv, writeSnapshotSummary,
} from './lib/catalog.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const FORCE_SEARCH = args.includes('--search');
const NO_FACETS = args.includes('--no-facets');
const SEED = opt('--seed');
const SEED_DATE = opt('--date');
const QUARANTINE_DROP = 0.05;
const MANIFEST = join(DATA, 'manifest.jsonl');

const client = makeClient({ minGapMs: 600 });
const t0 = Date.now();
const say = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const exists = (p) => stat(p).then(() => true, () => false);

// ---------- paged-search fallback ----------

const PAGE = 100;
const SEARCH_PROPS = ['title', 'extension', 'agency', 'source', 'box_name', 'folder_name', 'production_volume',
  'production_end', 'page_count', 'pdf_size', 'mes:key', 'mes:date'];

async function facetCounts(query) {
  const d = await search(client, {
    user: { query: { and: [{ unparsed: query }] } },
    count: 1,
    facets: ['production_volume', 'agency', 'source'].map((name) => ({ name, max_entries: 1000 })),
  });
  const out = {};
  for (const f of d.facets ?? []) {
    out[f.id] = { truncated: !!f.entries_truncated, counts: {} };
    for (const e of f.entries ?? []) out[f.id].counts[e.value?.str ?? e.html] = e.count;
  }
  return out;
}

async function walkVolume(volume, into) {
  const base = {
    user: { query: { and: [{ unparsed: 'extension:pdf' }, { unparsed: `production_volume:${volume}` }] } },
    count: PAGE, max_page_count: 1,
    properties: SEARCH_PROPS.map((name) => ({ name, formats: ['VALUE'] })),
  };
  const first = await search(client, base);
  const qeng = first.resultset?.result_pages?.qeng_ids;
  let rows = (first.resultset?.results ?? []).map(flatten);
  const take = (batch) => { for (const r of batch) { const k = r['mes:key'] ?? r.id; if (!into.has(k)) into.set(k, r); } };
  take(rows);
  for (let start = PAGE; qeng && rows.length === PAGE; start += PAGE) {
    const d = await search(client, {
      ...base,
      result_pages: { qeng_ids: qeng, pages: [{ starts: [start], counts: [PAGE], page_number: start / PAGE, current_page: true }] },
    });
    rows = (d.resultset?.results ?? []).map(flatten);
    take(rows);
  }
}

async function searchCatalog(facets) {
  const volumes = Object.keys(facets.production_volume?.counts ?? {}).sort();
  if (!volumes.length) throw new Error('no production_volume facet values — API shape changed?');
  const all = new Map();
  for (const v of volumes) {
    const expected = facets.production_volume.counts[v];
    const m = new Map();
    await walkVolume(v, m);
    if (m.size < expected) await walkVolume(v, m);
    say(`search ${v}: ${m.size} distinct (facet ${expected})`);
    for (const [k, r] of m) all.set(k, r);
  }
  return [...all.values()].map((r) => ({
    mes_key: r['mes:key'], title: r.title, source: r.source, agency: r.agency, box_name: r.box_name, folder_name: r.folder_name,
    page_count: r.page_count, pdf_size: r.pdf_size, production_volume: r.production_volume, bates_end: r.production_end,
    related_document: '', index_date: typeof r['mes:date'] === 'number' ? new Date(r['mes:date']).toISOString() : r['mes:date'],
  }));
}

// ---------- manifest ----------

function manifestRow(r) {
  const row = {
    key: `${r.production_volume}/${r.bates_start}`,
    title: r.title,
    bates_start: r.bates_start,
    bates_end: r.bates_end,
    bates_pages: batesNum(r.bates_end) != null ? batesNum(r.bates_end) - batesNum(r.bates_start) + 1 : null,
    page_count: r.page_count,
    pdf_size: r.pdf_size,
    production_volume: r.production_volume,
    agency: r.agency,
    source: r.source,
    box_name: r.box_name,
    folder_name: r.folder_name,
    mes_key: r.mes_key,
    index_date: r.index_date,
    download_url: contentUrl(r.title || `${r.bates_start}.pdf`),
  };
  const s = docStem(row);
  row.local_pdf = join('data', 'pdf', `${s}.pdf`);
  row.local_text = join('data', 'text', `${s}.txt`);
  return row;
}

async function readManifest() {
  const text = await readFile(MANIFEST, 'utf8').catch(() => null);
  return text ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

function compareFacets(stats, facets) {
  if (!facets) return null;
  const out = { mismatches: 0 };
  for (const [field, statKey] of [['production_volume', 'by_volume'], ['agency', 'by_agency'], ['source', 'by_source']]) {
    const f = facets[field]?.counts ?? {};
    const ours = stats[statKey];
    const keys = [...new Set([...Object.keys(f), ...Object.keys(ours)])].sort();
    out[field] = Object.fromEntries(keys.map((k) => {
      const a = ours[k]?.documents ?? 0, b = f[k] ?? 0;
      if (a !== b) out.mismatches++;
      return [k, { catalog: a, facet: b, delta: a - b }];
    }));
  }
  return out;
}

async function main() {
  await mkdir(DATA, { recursive: true });
  const fetchedAt = new Date();
  let text, origin, exportInfo = null;

  const facets = NO_FACETS && !FORCE_SEARCH ? null : await facetCounts('extension:pdf');

  if (SEED) {
    text = await readFile(SEED, 'utf8');
    origin = `seed:${basename(SEED)}`;
    say(`seeding from ${SEED}`);
  } else if (!FORCE_SEARCH) {
    try {
      say('POST catalog export');
      const e = await exportCatalog(client);
      text = e.text; origin = 'export'; exportInfo = { bytes: e.bytes, seconds: e.seconds, content_type: e.contentType };
      say(`export: ${e.bytes} bytes in ${e.seconds}s`);
    } catch (err) {
      if (err instanceof PortalStop) throw err;
      say(`export failed (${err.message}); falling back to paged search`);
    }
  }
  if (!text) {
    const rows = await searchCatalog(facets ?? await facetCounts('extension:pdf'));
    text = toCsv(rows);
    origin = 'search';
  }

  const { rows } = parseCatalog(text);
  const stats = catalogStats(rows);
  const previous = (await listSnapshots()).filter((s) => s.summary?.accepted);
  const snap = await saveSnapshot(text, { date: SEED_DATE, fetchedAt });
  const prev = previous.filter((s) => s.name !== snap.name).at(-1) ?? null;
  const prevDocs = prev?.summary?.stats?.documents ?? null;

  const reasons = [];
  if (!rows.length) reasons.push('zero rows');
  if (stats.duplicates) reasons.push(`${stats.duplicates} duplicate Bates numbers`);
  if (prevDocs && stats.documents < prevDocs * (1 - QUARANTINE_DROP)) reasons.push(`documents fell ${prevDocs} -> ${stats.documents} (> ${QUARANTINE_DROP * 100}%)`);
  const quarantined = reasons.length > 0;

  let diffCounts = null;
  if (prev) {
    const d = diffCatalogs((await loadSnapshot(prev.path)).rows, rows);
    diffCounts = { against: prev.name, ...d.counts, by_volume: d.by_volume };
  }
  const facetCheck = compareFacets(stats, facets);

  await writeSnapshotSummary(snap.name, {
    name: snap.name, sha256: snap.sha256, origin, fetched_at: SEED ? null : fetchedAt.toISOString(), date: snap.date,
    reused_existing_file: snap.reused, export: exportInfo, accepted: !quarantined, quarantined, quarantine_reasons: reasons,
    stats, facet_check: facetCheck, diff_vs_previous: diffCounts,
  });
  say(`snapshot ${snap.name}${snap.reused ? ' (identical, reused)' : ''} sha256 ${snap.sha256.slice(0, 12)}…: ` +
    `${stats.documents} docs, ${stats.pages} pages, ${(stats.pdf_bytes / 1e9).toFixed(2)} GB, ${stats.boxes} boxes, ${stats.folders} folders`);
  if (diffCounts) say(`vs ${prev.name}: +${diffCounts.added} −${diffCounts.removed} ~${diffCounts.changed} (net pages ${diffCounts.net_pages})`);
  if (facetCheck) say(`facet check: ${facetCheck.mismatches} mismatches`);

  if (quarantined) {
    say(`QUARANTINED: ${reasons.join('; ')} — manifest NOT rebuilt`);
    process.exit(2);
  }

  // ---- merge into the manifest ----
  const old = await readManifest();
  const oldByBates = new Map(old.map((r) => [r.bates_start, r]));
  const day = snap.date;
  const out = [];
  const recon = { previous_rows: old.length, same_path: 0, path_changed: 0, new: 0, changed: 0, reappeared: 0, newly_removed: 0, still_removed: 0 };
  const seen = new Set();
  for (const r of rows) {
    const m = manifestRow(r);
    const p = oldByBates.get(r.bates_start);
    seen.add(r.bates_start);
    m.status = 'present';
    m.first_seen = p?.first_seen ?? (p?.enumerated_at ? nyDate(new Date(p.enumerated_at)) : day);
    m.last_seen = day;
    m.catalog_snapshot = snap.name;
    if (!p) recon.new++;
    else {
      if (p.local_pdf === m.local_pdf) recon.same_path++; else { recon.path_changed++; m.previous_local_pdf = p.local_pdf; }
      if (p.status === 'removed') { recon.reappeared++; m.reappeared_at = day; m.previously_removed_at = p.removed_at; }
      const fields = DIFF_FIELDS.filter((f) => f in p && (p[f] ?? null) !== (m[f] ?? null));
      if (fields.length) { recon.changed++; m.changed_at = day; m.changed_fields = fields; }
      else if (p.changed_at) { m.changed_at = p.changed_at; m.changed_fields = p.changed_fields; }
    }
    out.push(m);
  }
  for (const p of old) {
    if (seen.has(p.bates_start)) continue;
    const wasRemoved = p.status === 'removed';
    wasRemoved ? recon.still_removed++ : recon.newly_removed++;
    out.push({ ...p, status: 'removed', removed_at: p.removed_at ?? day, held_locally: await exists(join(REPO, p.local_pdf)) });
  }
  out.sort((a, b) => (a.production_volume ?? '').localeCompare(b.production_volume ?? '') || a.bates_start.localeCompare(b.bates_start));

  await writeFile(`${MANIFEST}.tmp`, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await rename(`${MANIFEST}.tmp`, MANIFEST);

  const present = out.filter((r) => r.status === 'present');
  const removed = out.filter((r) => r.status === 'removed');
  const manifestSummary = {
    built_at: new Date().toISOString(),
    catalog_snapshot: snap.name, catalog_sha256: snap.sha256, origin,
    totals: {
      present: present.length, removed: removed.length, removed_held_locally: removed.filter((r) => r.held_locally).length,
      pages: stats.pages, pdf_bytes: stats.pdf_bytes, max_bates_end: stats.max_bates_end,
      bates_gaps: stats.bates_gaps, bates_gap_numbers: stats.bates_gap_numbers,
    },
    reconciliation_with_previous_manifest: recon,
    facet_check: facetCheck,
    diff_vs_previous_snapshot: diffCounts,
    stats,
  };
  await writeFile(join(DATA, 'manifest.summary.json'), JSON.stringify(manifestSummary, null, 2) + '\n');
  say(`manifest: ${present.length} present, ${removed.length} removed (${manifestSummary.totals.removed_held_locally} held locally); ` +
    `reconciliation ${JSON.stringify(recon)}; requests ${client.stats.requests}`);

  process.exit(facetCheck?.mismatches ? 2 : 0);
}

main().catch((err) => {
  console.error(err instanceof PortalStop ? `STOPPED: ${err.message} ${JSON.stringify(err.detail)}` : err.stack);
  process.exit(err instanceof PortalStop ? 3 : 1);
});
