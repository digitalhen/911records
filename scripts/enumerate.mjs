#!/usr/bin/env node
// enumerate.mjs — list every PDF on the 9/11 Document Portal into a manifest.
//
// Node 20+, no dependencies. Walks the Mindbreeze v2 search API one
// production_volume at a time with `extension:pdf` (skipping the OCR-markdown
// twins, and keeping every walk far below the ~30k deep-offset ceiling),
// dedupes, and reconciles against the facet counts the API itself reports.
//
// Output:
//   data/manifest.jsonl          one line per document, every metadata field + download URL + local paths
//   data/manifest.summary.json   counts/bytes/pages per agency, volume and source vs the API's facet counts
//
// Politeness: strictly sequential, >= 600 ms between request starts (< 2 req/s),
// retry with backoff on 5xx, stop on 429/403/non-JSON. See scripts/lib/portal.mjs.
//
// Usage: node scripts/enumerate.mjs            (exit 0 = reconciled, 2 = mismatch, 3 = stopped by portal)

import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, PortalStop, contentUrl, docStem, flatten, makeClient, search } from './lib/portal.mjs';

const PAGE = 100;
const PROPS = ['title', 'extension', 'agency', 'source', 'box_name', 'folder_name', 'production_volume',
  'production_end', 'page_count', 'pdf_size', 'full_filename', 'related_document', 'mes:key', 'mes:size', 'mes:date'];
const FACETS = ['production_volume', 'agency', 'source', 'extension'];

const client = makeClient({ minGapMs: 600 });
const t0 = Date.now();
const say = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

async function facetCounts(query) {
  const d = await search(client, {
    user: { query: { and: [{ unparsed: query }] } },
    count: 1,
    facets: FACETS.map((name) => ({ name, count: 1000 })),
  });
  const out = {};
  for (const f of d.facets ?? []) {
    out[f.id] = { truncated: !!f.entries_truncated, incomplete: !!f.incomplete, counts: {} };
    for (const e of f.entries ?? []) out[f.id].counts[e.value?.str ?? e.html] = e.count;
  }
  return out;
}

/** One full offset walk of `extension:pdf AND production_volume:V`. */
async function walkVolume(volume, into) {
  const base = {
    user: { query: { and: [{ unparsed: 'extension:pdf' }, { unparsed: `production_volume:${volume}` }] } },
    count: PAGE,
    max_page_count: 1,
    properties: PROPS.map((name) => ({ name, formats: ['VALUE'] })),
  };
  const first = await search(client, base);
  const qeng = first.resultset?.result_pages?.qeng_ids;
  let rows = (first.resultset?.results ?? []).map(flatten);
  let seen = 0, added = 0, pages = 1;
  const take = (batch) => {
    for (const r of batch) {
      seen++;
      const k = r['mes:key'] ?? r.id;
      if (!into.has(k)) { into.set(k, r); added++; }
    }
  };
  take(rows);
  for (let start = PAGE; qeng && rows.length === PAGE; start += PAGE) {
    const d = await search(client, {
      ...base,
      result_pages: { qeng_ids: qeng, pages: [{ starts: [start], counts: [PAGE], page_number: start / PAGE, current_page: true }] },
    });
    rows = (d.resultset?.results ?? []).map(flatten);
    pages++;
    take(rows);
  }
  return { seen, added, pages, hadQeng: !!qeng };
}

function toManifestRow(r, enumeratedAt) {
  const title = r.title;
  const batesStart = String(title).replace(/\.pdf$/i, '');
  const num = (s) => { const m = /(\d+)$/.exec(s ?? ''); return m ? Number(m[1]) : null; };
  const row = {
    key: `${r.production_volume}/${batesStart}`,
    title,
    bates_start: batesStart,
    bates_end: r.production_end ?? null,
    bates_pages: num(r.production_end) != null && num(batesStart) != null ? num(r.production_end) - num(batesStart) + 1 : null,
    page_count: r.page_count != null && r.page_count !== '' ? Number(r.page_count) : null,
    pdf_size: r.pdf_size != null ? Number(r.pdf_size) : null,
    production_volume: r.production_volume ?? null,
    agency: r.agency ?? null,
    source: r.source ?? null,
    box_name: r.box_name ?? null,
    folder_name: r.folder_name ?? null,
    full_filename: r.full_filename ?? null,
    related_document: r.related_document ?? null,
    extension: r.extension ?? null,
    mes_key: r['mes:key'] ?? null,
    mes_size: r['mes:size'] ?? null,
    mes_date: typeof r['mes:date'] === 'number' ? new Date(r['mes:date']).toISOString() : r['mes:date'] ?? null,
    result_id: r.id,
    download_url: contentUrl(title),
    enumerated_at: enumeratedAt,
  };
  const stem = docStem(row);
  row.local_pdf = join('data', 'pdf', `${stem}.pdf`);
  row.local_text = join('data', 'text', `${stem}.txt`);
  return row;
}

const tally = (rows, field) => {
  const out = {};
  for (const r of rows) {
    const k = r[field] ?? '(null)';
    const t = (out[k] ??= { documents: 0, bytes: 0, pages: 0 });
    t.documents++; t.bytes += r.pdf_size ?? 0; t.pages += r.page_count ?? 0;
  }
  return out;
};

async function main() {
  await mkdir(DATA, { recursive: true });
  const enumeratedAt = new Date().toISOString();

  say('facets on "*" and on "extension:pdf"');
  const allFacets = await facetCounts('*');
  const pdfFacets = await facetCounts('extension:pdf');
  const volumes = Object.keys(pdfFacets.production_volume?.counts ?? {}).sort();
  if (!volumes.length) throw new Error('no production_volume facet values — API shape changed?');
  say(`volumes: ${volumes.map((v) => `${v}=${pdfFacets.production_volume.counts[v]}`).join(' ')}`);

  const byKey = new Map();
  const walks = {};
  for (const v of volumes) {
    const expected = pdfFacets.production_volume.counts[v];
    const volMap = new Map();
    let w = await walkVolume(v, volMap);
    say(`${v}: walked ${w.seen} results over ${w.pages} pages, ${volMap.size} distinct (facet ${expected})`);
    let rewalked = false;
    if (volMap.size < expected) {
      rewalked = true;
      const w2 = await walkVolume(v, volMap);
      say(`${v}: re-walk added ${w2.added}; now ${volMap.size} distinct (facet ${expected})`);
      w = { ...w, rewalk: w2 };
    }
    walks[v] = { expected, distinct: volMap.size, rewalked, ...w };
    for (const [k, r] of volMap) byKey.set(k, r);
  }

  const rows = [...byKey.values()].map((r) => toManifestRow(r, enumeratedAt))
    .sort((a, b) => (a.production_volume ?? '').localeCompare(b.production_volume ?? '') || a.bates_start.localeCompare(b.bates_start));

  // Stable-key collisions (title+volume) and non-PDF leakage are both worth failing on.
  const keyCounts = new Map();
  for (const r of rows) keyCounts.set(r.key, (keyCounts.get(r.key) ?? 0) + 1);
  const duplicateKeys = [...keyCounts].filter(([, n]) => n > 1).map(([k, n]) => ({ key: k, n }));
  const nonPdf = rows.filter((r) => r.extension !== 'pdf').length;
  const pageMismatch = rows.filter((r) => r.bates_pages != null && r.page_count != null && r.bates_pages !== r.page_count).length;
  const missingSize = rows.filter((r) => !r.pdf_size).length;
  // pdf_size is wrong for a few dozen rows (e.g. 54 B declared, 241,635 B served);
  // mes:size is 0 on those. Count both so a growing problem is visible.
  const implausibleSize = rows.filter((r) => r.pdf_size && r.page_count && r.pdf_size / r.page_count < 2000).length;
  const mesSizeDiffers = rows.filter((r) => typeof r.mes_size === 'number' && r.mes_size !== r.pdf_size).length;

  const tmp = join(DATA, 'manifest.jsonl.tmp');
  await writeFile(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await rename(tmp, join(DATA, 'manifest.jsonl'));

  const compare = (field) => {
    const ours = tally(rows, field);
    const pdf = pdfFacets[field]?.counts ?? {};
    const all = allFacets[field]?.counts ?? {};
    const keys = [...new Set([...Object.keys(ours), ...Object.keys(pdf)])].sort();
    return Object.fromEntries(keys.map((k) => [k, {
      manifest_documents: ours[k]?.documents ?? 0,
      facet_pdf: pdf[k] ?? null,
      facet_all_records_half: all[k] != null ? all[k] / 2 : null,
      delta_vs_facet_pdf: (ours[k]?.documents ?? 0) - (pdf[k] ?? 0),
      bytes: ours[k]?.bytes ?? 0,
      pages: ours[k]?.pages ?? 0,
    }]));
  };

  const maxBatesEnd = rows.reduce((m, r) => { const n = Number(/(\d+)$/.exec(r.bates_end ?? '')?.[1] ?? 0); return n > m ? n : m; }, 0);
  const largest = rows.reduce((m, r) => (r.pdf_size ?? 0) > (m?.pdf_size ?? 0) ? r : m, null);
  const expectedTotal = Object.values(pdfFacets.extension?.counts ?? {}).length
    ? pdfFacets.extension.counts.pdf : volumes.reduce((s, v) => s + pdfFacets.production_volume.counts[v], 0);

  const summary = {
    enumerated_at: enumeratedAt,
    elapsed_seconds: Math.round((Date.now() - t0) / 1000),
    requests: client.stats,
    totals: {
      documents: rows.length,
      expected_facet_pdf: expectedTotal,
      expected_recon_2026_09_13: 24436,
      delta_vs_facet: rows.length - expectedTotal,
      delta_vs_recon: rows.length - 24436,
      bytes: rows.reduce((s, r) => s + (r.pdf_size ?? 0), 0),
      pages: rows.reduce((s, r) => s + (r.page_count ?? 0), 0),
      max_bates_end: maxBatesEnd,
      largest_pdf: largest ? { key: largest.key, pdf_size: largest.pdf_size, page_count: largest.page_count } : null,
    },
    checks: { duplicate_keys: duplicateKeys, non_pdf_rows: nonPdf, bates_vs_page_count_mismatch: pageMismatch, missing_pdf_size: missingSize,
      implausible_pdf_size_under_2kb_per_page: implausibleSize, mes_size_differs_from_pdf_size: mesSizeDiffers },
    walks,
    by_agency: compare('agency'),
    by_volume: compare('production_volume'),
    by_source: compare('source'),
    facets_raw: { all: allFacets, pdf: pdfFacets },
  };
  await writeFile(join(DATA, 'manifest.summary.json'), JSON.stringify(summary, null, 2) + '\n');

  const gb = (b) => (b / 1e9).toFixed(2);
  say(`manifest: ${rows.length} documents (facet ${expectedTotal}, recon 24436), ${gb(summary.totals.bytes)} GB, ${summary.totals.pages} pages, max Bates ${maxBatesEnd}`);
  for (const [a, c] of Object.entries(summary.by_agency)) say(`  ${a}: ${c.manifest_documents} (facet ${c.facet_pdf}, delta ${c.delta_vs_facet_pdf})`);
  say(`checks: dup keys ${duplicateKeys.length}, non-pdf ${nonPdf}, bates/page mismatch ${pageMismatch}, missing size ${missingSize}; requests ${client.stats.requests}`);

  const bad = rows.length !== expectedTotal || duplicateKeys.length || nonPdf
    || Object.values(walks).some((w) => w.distinct !== w.expected);
  process.exit(bad ? 2 : 0);
}

main().catch((err) => {
  console.error(err instanceof PortalStop ? `STOPPED: ${err.message} ${JSON.stringify(err.detail)}` : err.stack);
  process.exit(err instanceof PortalStop ? 3 : 1);
});
