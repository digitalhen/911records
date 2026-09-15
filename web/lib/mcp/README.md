# 911records MCP

Read-only MCP endpoint: `https://911records.nyc/mcp` after deployment.
Transport: stateless Streamable HTTP, JSON responses. No API key or session
affinity required. GET/DELETE return 405; clients must use Streamable HTTP,
not the legacy SSE transport. No additional database or indexing job.

## Connect

In a client supporting remote MCP, add `https://911records.nyc/mcp` as the
server URL with HTTP transport. Example generic client configuration
(the exact configuration file varies by client):

```json
{"mcpServers":{"911records":{"url":"https://911records.nyc/mcp","type":"http"}}}
```

Try: "Search for 125 Cedar Street, read the relevant pages, and give me a
timeline with exact Bates citations. Distinguish proposals from completed work."

## Tools

- `search_records`: query plus optional agency/volume/box/folder/address/
  contaminant/lab/year filters, page and limit. Search reuses the website's
  hybrid search (local query embeddings where available), with no answer-model call.
- `get_document`: doc, start_page, limit; metadata, PDF URL, page links.
- `get_page`: doc, page, offset, max_chars; OCR text, Bates stamp, scan URL.
- `browse_collection`: optional agency/volume/box/folder, after, limit;
  catalog documents in Bates order. Exact filter values come from catalog
  metadata; folder labels are not returned because some contain private names.
- `get_changes`: optional since (inclusive YYYY-MM-DD), offset, limit;
  capture dates, identifiers, change types only. Removed text is never returned.

All lists are bounded and paginated. Search counts are indexed pages, not
unique documents, and can lag removals. Search results are checked against
Postgres before returning any metadata. Retrieval checks document status
before reading text. Source text is the City's published OCR/our OCR, not
an authoritative transcription. Titles and summaries are labelled machine-extracted.

## Operations and checks

Uses existing DATABASE_URL/DATABASE_READ_URL, OPENSEARCH and OLLAMA settings.
No new secrets. Public citation URLs always use https://911records.nyc;
they do not depend on internal proxy host headers or the /page redirect.
This does not fix the existing /page redirect itself.

60 requests per minute per IP, max 12 concurrent requests per process,
16 KiB request-body limit with a 10-second read deadline, maximum 50 list results and 20,000 OCR characters
per response. Rate limits are best effort per process (double across two
replicas, reset on restart); the deployment must strip/overwrite client IP
headers at its trusted Cloudflare/proxy boundary. Apply shared edge quotas
if needed for higher traffic. Requests with unapproved Origin headers are
rejected; server-to-server clients normally omit Origin. No browser CORS
integration is advertised. All responses disable caching.

Run `node --import tsx --test lib/mcp/mcp.test.ts` and `npx tsc --noEmit`
from web/. Tests use the official MCP client over the actual HTTP handler
with a fixture backend; they do not require the production database.
For live smoke tests run `npm run dev -- -p 3111` and connect an MCP client
to `http://localhost:3111/mcp`.
Run `node lib/mcp/smoke.mjs` to check all five tools against the local server
and real records, or pass a deployed endpoint URL as the first argument.
