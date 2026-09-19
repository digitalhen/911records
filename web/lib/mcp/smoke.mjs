import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = process.argv[2] || 'http://127.0.0.1:3111/mcp';
const client = new Client({ name: '911records-smoke', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 5);
  for (const tool of tools) assert.equal(tool.outputSchema?.type, 'object', `${tool.name} outputSchema missing`);
  console.log('PASS initialize and discover five tools');
  const cases = [
    ['get_document', { doc: 'NYC-WTC_000140827' }],
    ['get_page', { doc: 'NYC-WTC_000140827', page: 1 }],
    ['browse_collection', { limit: 2 }],
    ['get_changes', { limit: 2 }],
    ['search_records', { query: 'Cedar Street', limit: 2 }],
  ];
  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
    const data = result.structuredContent;
    assert.ok(data);
    if (name === 'get_page') {
      assert.equal(data.bates, 'NYC-WTC_000140827');
      assert.match(data.text, /clearinghouse/i);
      assert.equal(data.url, 'https://911records.org/doc/NYC-WTC_000140827');
    }
    if (name === 'search_records') assert.ok(data.hits.length > 0);
    if (name === 'browse_collection') assert.equal(data.documents.length, 2);
    console.log(`PASS ${name}`);
  }
} finally { await client.close(); }
