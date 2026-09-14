#!/usr/bin/env node
// fetch_sample.mjs — prove the 9/11 Document Portal ingest path end to end.
//
// Node 20+, no dependencies. Lists the first N documents for a query through the
// portal's Mindbreeze InSpire v2 search API (paging with result_pages offsets),
// then downloads ONE document: its PDF, its metadata as JSON, and its OCR text.
//
// OCR text: the PDFs carry an ABBYY FineReader text layer, so the full text is
// `pdftotext -layout` of the PDF (run automatically if poppler is installed).
// The index also holds a markdown twin per PDF (extension:md) whose `content`
// property returns only a hit-highlighted snippet — saved alongside as snippet.
//
// Usage: node scripts/fetch_sample.mjs [query] [N] [outDir]
//   defaults: query "extension:pdf", N 25, outDir data/sample_fetch

import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const HOST = 'https://sept11documents.cityofnewyork.us';
const SEARCH = `${HOST}/api/v2/search`;
const CONTENT = (title) => `${HOST}/apps/content/September11_MD/${encodeURIComponent(title)}`;
const UA = 'sept11-docs-research/0.1 (contact: digitalhen@gmail.com)';
const PAGE = 100;          // server caps count at 100 per request
const DELAY_MS = 600;      // <= 2 req/s

const PROPS = ['title', 'extension', 'agency', 'source', 'box_name', 'folder_name',
  'production_volume', 'production_end', 'page_count', 'pdf_size', 'full_filename',
  'related_document', 'mes:key', 'mes:size', 'mes:date'];

const [query = 'extension:pdf', nArg = '25', outDir = 'data/sample_fetch'] = process.argv.slice(2);
const N = Math.max(1, Number(nArg) || 25);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(body) {
  const res = await fetch(SEARCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  return res.json();
}

// Flatten Mindbreeze's properties[{id,data:[{value:{str|num}}]}] into a plain object.
function flatten(result) {
  const out = { id: result.id };
  for (const p of result.properties ?? []) {
    const vals = (p.data ?? []).map((d) => d.value?.str ?? d.value?.num ?? d.html ?? null);
    out[p.id] = vals.length <= 1 ? vals[0] ?? null : vals;
  }
  return out;
}

async function list(q, n) {
  const base = {
    user: { query: { and: [{ unparsed: q }] } },
    count: Math.min(PAGE, n),
    max_page_count: 1,
    properties: PROPS.map((name) => ({ name, formats: ['VALUE'] })),
    content_sample_length: 300,
  };
  const first = await search(base);
  const qeng = first.resultset?.result_pages?.qeng_ids;
  const rows = (first.resultset?.results ?? []).map(flatten);
  console.error(`query=${JSON.stringify(q)} estimated_count=${first.estimated_count}`);
  for (let start = rows.length; rows.length < n && qeng; start += PAGE) {
    await sleep(DELAY_MS);
    const d = await search({
      ...base,
      count: Math.min(PAGE, n - rows.length),
      result_pages: { qeng_ids: qeng, pages: [{ starts: [start], counts: [PAGE], page_number: start / PAGE, current_page: true }] },
    });
    const got = (d.resultset?.results ?? []).map(flatten);
    if (!got.length) break;
    rows.push(...got);
  }
  return rows.slice(0, n);
}

async function download(row, dir) {
  const title = row.title;
  const url = CONTENT(title);
  await sleep(DELAY_MS);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`content HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const pdfPath = join(dir, title);
  await writeFile(pdfPath, buf);

  // markdown twin snippet (index-side OCR, snippet only)
  await sleep(DELAY_MS);
  const md = await search({
    user: { query: { and: [{ unparsed: `title:${title}` }, { unparsed: 'extension:md' }] } },
    count: 1,
    properties: [{ name: 'content', formats: ['HTML'] }, { name: 'mes:size' }, { name: 'mes:key' }],
    content_sample_length: 100000,
  });
  const mdRow = md.resultset?.results?.[0];
  const snippet = mdRow?.properties?.find((p) => p.id === 'content')?.data?.[0]?.html ?? null;

  let ocrWords = null;
  try {
    const txt = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 512 * 1024 * 1024 }).toString();
    await writeFile(`${pdfPath}.txt`, txt);
    ocrWords = txt.split(/\s+/).filter(Boolean).length;
  } catch {
    console.error('pdftotext not available or failed; OCR text not extracted');
  }
  const meta = { ...row, content_url: url, http: { status: res.status, content_type: res.headers.get('content-type'),
    content_length: Number(res.headers.get('content-length')), etag: res.headers.get('etag'), last_modified: res.headers.get('last-modified') },
    bytes_written: buf.length, md_twin_key: mdRow?.id ?? null, md_snippet_chars: snippet?.length ?? null, ocr_words: ocrWords,
    fetched_at: new Date().toISOString() };
  await writeFile(`${pdfPath}.json`, JSON.stringify(meta, null, 2));
  if (snippet) await writeFile(`${pdfPath}.snippet.html`, snippet);
  return meta;
}

const rows = await list(query, N);
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'listing.json'), JSON.stringify(rows, null, 2));
const ids = new Set(rows.map((r) => r.id));
console.log(`listed ${rows.length} (distinct ${ids.size}) -> ${join(outDir, 'listing.json')}`);
for (const r of rows.slice(0, 5)) {
  console.log(`  ${r['mes:key']}  vol=${r.production_volume} pages=${r.page_count} bytes=${r.pdf_size} box=${r.box_name}`);
}
// download the smallest listed PDF to keep the proof cheap
const pdfs = rows.filter((r) => r.extension === 'pdf' && r.pdf_size).sort((a, b) => a.pdf_size - b.pdf_size);
if (!pdfs.length) { console.log('no pdf rows to download'); process.exit(0); }
const meta = await download(pdfs[0], outDir);
console.log(`downloaded ${meta.title}: ${meta.bytes_written} bytes (declared pdf_size ${meta.pdf_size}), ` +
  `pages=${meta.page_count}, ocr_words=${meta.ocr_words}, md_snippet_chars=${meta.md_snippet_chars}, etag=${meta.http.etag}`);
