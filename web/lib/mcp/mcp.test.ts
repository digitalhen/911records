import assert from 'node:assert/strict';
import test from 'node:test';
import { documentShortUrl } from '../shortlinks/paths';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHandler } from './http';
import type { Backend } from './backend';
import type { DocumentRow, PageRow } from '../site';
import type { SearchHit } from '../opensearch';

const doc = 'NYC-WTC_000161243';
const removed = 'NYC-WTC_000000001';
function data(response: Awaited<ReturnType<Client['callTool']>>) {
  assert.ok(response.structuredContent && typeof response.structuredContent === 'object');
  return response.structuredContent as Record<string, unknown>;
}
function fixture(): Backend {
  return {
    async getDocument(key) { return { doc: key, status: key === removed ? 'removed' : 'present', agency: 'Environmental Protection, Dept. of', volume: 'NYC-WTC0006', box: 'Box 1', page_count: 11, official_url: 'https://example.org/original.pdf', title: 'Machine title', summary: 'Machine summary' } as DocumentRow; },
    async getPage(key, page) { return { doc: key, page, bates: 'NYC-WTC_000161247', ocr_source: 'pdf' } as PageRow; },
    async getPageText(key, page) { return { doc: key, page, source: 'pdf', text: 'a'.repeat(22000) }; },
    async search() { return { hits: [{ doc, page: 5, batesPage: 'NYC-WTC_000161247', agency: null, docTitle: 'Machine title' }, { doc: removed, page: 1, docTitle: 'Never disclose' }] as SearchHit[], total: 51, tookMs: 1, facets: {}, semantic: false }; },
    async availableDocuments() { return [{ doc }]; },
    async browse() { return [{ doc, agency: 'DEP', volume: 'NYC-WTC0006', box: 'Box 1', page_count: 11 }, { doc: 'NYC-WTC_000161254', agency: 'DEP', volume: 'NYC-WTC0006', box: 'Box 1', page_count: 1 }]; },
    async changes() { return [{ doc: removed, date: '2026-09-15', kind: 'removed' }, { doc, date: '2026-09-14', kind: 'added' }]; },
  };
}
async function connect(db = fixture()) {
  const handle = createHandler(db);
  const ip = crypto.randomUUID();
  const client = new Client({ name: 'mcp-tests', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3111/mcp'), {
    fetch: async (input, init) => {
      const req = new Request(input, init);
      req.headers.set('cf-connecting-ip', ip);
      return handle(req);
    },
  });
  await client.connect(transport);
  return client;
}

test('official client discovers and calls all five tools over stateless HTTP', async () => {
  const client = await connect();
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 5);
    for (const tool of tools) assert.equal(tool.outputSchema?.type, 'object', `${tool.name} must declare its output`);
    const search = await client.callTool({ name: 'search_records', arguments: { query: 'Cedar Street', limit: 1 } });
    const s = search.structuredContent as { hits: { url: string }[]; next_page: number };
    assert.equal(s.hits.length, 1);
    assert.equal(s.hits[0]?.url, `https://911records.org/doc/${doc}/p/5`);
    assert.equal(s.next_page, 2);
    assert.ok(!JSON.stringify(search).includes('Never disclose'));
    const document = await client.callTool({ name: 'get_document', arguments: { doc, start_page: 5, limit: 2 } });
    assert.equal(data(document).next_page, 7);
    assert.equal(data(document).machine_extracted_title, 'Machine title');
    assert.ok(!JSON.stringify(document).includes('0.0.0.0'));
    const page = await client.callTool({ name: 'get_page', arguments: { doc, page: 5, max_chars: 20000 } });
    assert.equal(data(page).short_url, documentShortUrl(doc, 5));
    assert.equal(data(page).bates, 'NYC-WTC_000161247');
    assert.equal(data(page).next_offset, 20000);
    const rest = await client.callTool({ name: 'get_page', arguments: { doc, page: 5, offset: 20000 } });
    assert.equal((data(rest).text as string).length, 2000);
    assert.equal(data(rest).next_offset, null);
    const browse = await client.callTool({ name: 'browse_collection', arguments: { limit: 1 } });
    assert.equal(data(browse).next_after, doc);
    const changes = await client.callTool({ name: 'get_changes', arguments: { since: '2026-09-14', limit: 1 } });
    assert.equal(data(changes).next_offset, 1);
    assert.deepEqual(data(changes).changes, [{ doc: removed, date: '2026-09-15', kind: 'removed', url: `https://911records.org/doc/${removed}`, short_url: documentShortUrl(removed) }]);
  } finally { await client.close(); }
});

test('removed documents never reach page readers; failures do not leak service details', async () => {
  const db = fixture();
  db.getPageText = async () => { throw new Error('SECRET_DATABASE_PASSWORD'); };
  db.getPage = async () => { throw new Error('Should never read removed page'); };
  const client = await connect(db);
  try {
    for (const name of ['get_document', 'get_page']) {
      const response = await client.callTool({ name, arguments: { doc: removed, page: 1 } });
      assert.equal(response.isError, true);
      assert.match(JSON.stringify(response), /removed/);
    }
    const failed = await client.callTool({ name: 'get_page', arguments: { doc, page: 1 } });
    assert.equal(failed.isError, true);
    assert.ok(!JSON.stringify(failed).includes('SECRET'));
    assert.ok(!JSON.stringify(failed).includes('Should never'));
    for (const args of [{ doc: '../../etc/passwd', page: 1 }, { doc, page: -1 }]) {
      assert.equal((await client.callTool({ name: 'get_page', arguments: args })).isError, true);
    }
    assert.equal((await client.callTool({ name: 'get_changes', arguments: { since: '2026-02-31' } })).isError, true);
  } finally { await client.close(); }
});

test('missing OCR is explicit and backend failure cannot expose stale search hits', async () => {
  const db = fixture();
  db.getPageText = async () => null;
  db.availableDocuments = async () => { throw new Error('Database offline'); };
  const client = await connect(db);
  try {
    const page = await client.callTool({ name: 'get_page', arguments: { doc, page: 1 } });
    assert.equal(data(page).text_available, false);
    const search = await client.callTool({ name: 'search_records', arguments: { query: 'asbestos' } });
    assert.equal(search.isError, true);
    assert.ok(!JSON.stringify(search).includes('Machine title'));
  } finally { await client.close(); }
});

test('HTTP rejects disallowed origins, oversized chunked bodies and malformed JSON', async () => {
  const handle = createHandler(fixture());
  const request = (body: string, extra: Record<string, string> = {}) => new Request('http://localhost:3111/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': crypto.randomUUID(), ...extra }, body });
  assert.equal((await handle(request('{}', { origin: 'https://untrusted.example' }))).status, 403);
  assert.equal((await handle(request('x'.repeat(17000)))).status, 413);
  assert.equal((await handle(request('{'))).status, 400);
  assert.equal((await handle(new Request('http://localhost:3111/mcp'))).status, 405);
});

test('per-process request limit returns a retry interval', async () => {
  const handle = createHandler(fixture());
  const ip = crypto.randomUUID();
  for (let i = 0; i < 60; i++) await handle(new Request('http://localhost:3111/mcp', { method: 'POST', headers: { 'cf-connecting-ip': ip } }));
  const response = await handle(new Request('http://localhost:3111/mcp', { method: 'POST', headers: { 'cf-connecting-ip': ip } }));
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});

test('reader metadata preserves the published five-tool contract and exposes a self-contained resource', async () => {
  const { default: contract } = await import('./reader/tool-contract.json');
  const { READER_URI, READER_MIME } = await import('./reader/metadata');
  const client = await connect();
  try {
    const tools = (await client.listTools()).tools;
    const legacy = tools.map(({ _meta, ...tool }) => {
      if (tool.name !== 'get_document') return tool;
      const { evidence, ...properties } = tool.inputSchema.properties!;
      assert.ok(evidence);
      assert.ok(!tool.inputSchema.required?.includes('evidence'));
      return { ...tool, inputSchema: { ...tool.inputSchema, properties } };
    });
    assert.deepEqual(legacy, contract);
    for (const tool of tools) {
      assert.deepEqual(tool._meta?.ui, tool.name === 'get_document'
        ? { resourceUri: READER_URI, visibility: ['model', 'app'] }
        : { visibility: ['model', 'app'] });
      assert.equal(tool._meta?.['openai/outputTemplate'], tool.name === 'get_document' ? READER_URI : undefined);
      assert.equal(tool._meta?.['openai/widgetAccessible'], true);
    }
    assert.equal((await client.listResources()).resources[0]?.uri, READER_URI);
    const resource = (await client.readResource({ uri: READER_URI })).contents[0]!;
    assert.equal(resource.mimeType, READER_MIME);
    assert.ok('text' in resource && resource.text.includes('ui/initialize'));
    assert.ok('text' in resource && !resource.text.includes('src="http'));
    const ui = resource._meta?.ui as { csp: Record<string, unknown> };
    assert.deepEqual(ui.csp, { connectDomains: [], resourceDomains: ['https://911records.org', 'https://911records.nyc'] });
  } finally { await client.close(); }
});

test('word geometry is widget-only, optional, bounded, and never fetched for removed records', async () => {
  const db = fixture(); let reads = 0;
  const boxes = { page: 5, w: 100, h: 200, words: [[1, 2, 20, 10, 'word']] as [number, number, number, number, string][] };
  db.getPageBoxes = async () => { reads++; return boxes; };
  const client = await connect(db);
  try {
    const page = await client.callTool({ name: 'get_page', arguments: { doc, page: 5 } });
    assert.equal(reads, 1);
    const reader = page._meta?.reader as Record<string, unknown>;
    assert.deepEqual(reader.boxes, boxes);
    assert.equal(reader.pageCount, 11);
    assert.equal(reader.summary, 'Machine summary');
    db.getDocument = async key => ({ ...await fixture().getDocument(key), summary: null } as DocumentRow);
    const withoutSummary = await client.callTool({ name: 'get_page', arguments: { doc, page: 5 } });
    assert.equal((withoutSummary._meta?.reader as Record<string, unknown>).summary, null);
    // Restore removed-record handling for the following privacy checks.
    db.getDocument = fixture().getDocument;
    reads = 1;
    assert.ok(!JSON.stringify(page.structuredContent).includes('words'));
    assert.ok(!JSON.stringify(page.content).includes('words'));
    await client.callTool({ name: 'get_page', arguments: { doc: removed, page: 5 } });
    assert.equal(reads, 1);
    boxes.words[0]![2] = 1000;
    const invalid = await client.callTool({ name: 'get_page', arguments: { doc, page: 5 } });
    assert.equal((invalid._meta?.reader as Record<string, unknown>).boxes, null);
    db.getPageBoxes = async () => { throw new Error('internal files server secret'); };
    const unavailable = await client.callTool({ name: 'get_page', arguments: { doc, page: 5 } });
    assert.equal((unavailable._meta?.reader as Record<string, unknown>).boxes, null);
    assert.equal(data(unavailable).text_available, true);
    assert.ok(!JSON.stringify(unavailable).includes('secret'));
  } finally { await client.close(); }
});

test('invalid geometry cannot produce misleading scan overlays', async () => {
  const { readerBoxes } = await import('./reader/metadata');
  const valid = { page: 1, w: 100, h: 100, words: [[1, 1, 5, 5, 'word']] as [number, number, number, number, string][] };
  assert.equal(readerBoxes(valid, 2), null);
  assert.equal(readerBoxes({ ...valid, w: NaN }, 1), null);
  assert.equal(readerBoxes({ ...valid, words: Array(8001).fill(valid.words[0]) }, 1), null);
  assert.equal(readerBoxes({ ...valid, words: [[-1, 0, 5, 5, 'word']] }, 1), null);
  assert.equal(readerBoxes({ ...valid, words: [[1, 1, Infinity, 5, 'word']] }, 1), null);
  assert.equal(readerBoxes(valid, 1), valid);
});


test('one document call hydrates curated evidence without changing model results', async () => {
  const db = fixture(); db.getPageText = async (doc, page) => ({ doc, page, text: 'Building exteriors cleaned. 205 PEARL STREET    Completed', source: 'pdf' });
  const client = await connect(db);
  try {
    const brief = { doc, page: 5, label: 'Pearl Street entries', claim: 'Cleanup recorded.', explanation: 'The list marks this address Completed.', limitation: 'Not a sample result.', quote: '205 PEARL STREET Completed' };
    const response = await client.callTool({ name: 'get_document', arguments: { doc, evidence: [brief, { ...brief, page: 6 }] } });
    assert.equal(response.isError, undefined);
    const reader = response._meta?.reader as { evidence: { source: { structuredContent: Record<string, unknown> }; claim: string }[] };
    assert.equal(reader.evidence.length, 2);
    assert.equal(reader.evidence[0]!.source.structuredContent.page, 5);
    assert.equal(reader.evidence[0]!.source.structuredContent.url, `https://911records.org/doc/${doc}/p/5`);
    assert.equal(reader.evidence[0]!.claim, brief.claim);
    assert.ok(!JSON.stringify(response.structuredContent).includes('Cleanup recorded'));
    assert.ok(!JSON.stringify(response.content).includes('Cleanup recorded'));
    const legacy = await client.callTool({ name: 'get_document', arguments: { doc, start_page: 2 } });
    assert.equal(((legacy._meta?.reader as typeof reader).evidence[0]!.source.structuredContent.page), 2);
    assert.deepEqual(Object.keys(data(response)).sort(), Object.keys(data(legacy)).sort());
  } finally { await client.close(); }
});

test('evidence rejects invented quotes, removed or invalid pages and excessive inputs', async () => {
  const db = fixture(); const calls: string[] = [];
  db.getPageText = async (key, page) => { calls.push(key); return { doc: key, page, text: 'Cleaning is proposed.', source: 'pdf' }; };
  const client = await connect(db);
  try {
    const brief = { doc, page: 1, label: 'Proposal', claim: 'Cleaning proposed', explanation: 'A proposal.' };
    for (const evidence of [
      [{ ...brief, quote: 'Cleaning completed.' }], [brief, { ...brief, doc: removed }],
      [{ ...brief, page: 99 }], [brief, brief], Array(4).fill(brief),
      [{ ...brief, url: 'https://untrusted.example' }], [{ ...brief, explanation: 'x'.repeat(501) }],
      [{ ...brief, doc: '../../etc/passwd' }], [{ ...brief, doc: 'NYC-WTC_000000002' }],
    ]) {
      const r = await client.callTool({ name: 'get_document', arguments: { doc, evidence } });
      assert.equal(r.isError, true); assert.equal(r._meta, undefined); assert.equal(r.structuredContent, undefined);
    }
    assert.ok(!calls.includes(removed));
    const valid = await client.callTool({ name: 'get_document', arguments: { doc, evidence: [{ ...brief, quote: 'Cleaning is proposed.' }] } });
    assert.equal(valid.isError, undefined);
  } finally { await client.close(); }
});


test('legacy document metadata survives unavailable preview enrichment', async () => {
  const db = fixture(); db.getPage = async () => { throw new Error('private backend detail'); };
  const client = await connect(db);
  try {
    const r = await client.callTool({ name: 'get_document', arguments: { doc } });
    assert.equal(r.isError, undefined); assert.equal(data(r).doc, doc);
    assert.deepEqual((r._meta?.reader as { evidence: unknown[] }).evidence, []);
    assert.ok(!JSON.stringify(r).includes('private backend detail'));
  } finally { await client.close(); }
});
