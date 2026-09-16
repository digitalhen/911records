// Local-only iframe host and browser checks. No database, secrets, or production calls.
// node --import tsx scripts/preview-mcp-reader.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readerHtml } from '../lib/mcp/reader/generated.ts';
const directory = new URL('../lib/mcp/reader/test/', import.meta.url);
const port = Number(process.env.MCP_READER_PREVIEW_PORT || 3138);
const live = process.argv.includes('--live');
const client = new Client({ name: 'reader-local-preview', version: '1' });
if (live) await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3139/mcp')));
createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/tool' && live) {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.origin !== `http://127.0.0.1:${port}`) { res.writeHead(403); res.end('{}'); return; }
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16384) { res.writeHead(413); res.end('{}'); return; } }
    try { const { name, args } = JSON.parse(body); if (!['search_records','get_page','get_document','browse_collection','get_changes'].includes(name)) throw new Error('Unknown tool'); res.end(JSON.stringify(await client.callTool({ name, arguments: args }))); }
    catch { res.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: 'Local MCP request failed.' }] })); }
    return;
  }
  if (req.method === 'POST' && req.url === '/report') {
    let body = ''; for await (const chunk of req) body += chunk;
    console.log(body); res.end('ok'); return;
  }
  const file = req.url === '/host.js' ? 'host.js' : 'host.html';
  res.setHeader('Content-Type', req.url === '/host.js' ? 'text/javascript' : 'text/html');
  res.setHeader('Cache-Control', 'no-store');
  res.end(req.url === '/reader' ? readerHtml : await readFile(new URL(file, directory)));
}).listen(port, '127.0.0.1', () => console.log(`Reader browser checks: http://127.0.0.1:${port}`));
