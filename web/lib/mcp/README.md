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

## Embedded records reader

The five published tool names, descriptions, annotations, input schemas, output schemas,
`/mcp` endpoint are unchanged. Server instructions separate background research from display. Only `get_document` advertises
`ui://911records/reader.html` via standard MCP Apps UI metadata and ChatGPT compatibility
aliases. The resource is self-contained `text/html;profile=mcp-app`: no CDN scripts,
Next.js chunk URLs, new API credentials, or additional tools. It is a small vanilla widget
adapted from the documented MCP Apps bridge example, within the existing server.

Opening a document renders its page list. The reader also supports search, browse and changes lists when navigated within an existing panel. Selecting a record calls
the existing `get_document` / `get_page` tools. The compact reader shows scans and extracted
text, page navigation, zoom, exact-phrase finding, match navigation, citations, and links to
the full PDF and City's source. Search queries seed the phrase field; directly opened pages
start with a Find field. These are literal text matches, not model-selected conclusions.
Mobile uses a source selector; supported hosts can expand the reader. Host themes are honored.

Existing text and `structuredContent` results remain available to non-UI clients. Widget-only
result `_meta.reader` adds originating tool/arguments and, on page results, the document title,
page count, PDF URL and validated word boxes. Geometry is obtained through the existing files
service, after checking removal status. Missing/malformed/oversized boxes do not fail text
retrieval. Scan highlights require a compatible image aspect ratio, complete OCR, matching
normalized text/box content and unambiguous occurrence counts; otherwise only text is highlighted.
Long OCR remains explicitly paginated with the existing `next_offset` contract.

The widget initializes through `ui/initialize`, uses `tools/call`, and accepts tool-result and
host-context notifications from its parent only. `window.openai` provides compatibility for
older hosts. User-opened record IDs/page URLs update model context without sending full OCR.
New requests clear old evidence, late responses are ignored, and errors/removals clear source
previews. Retrieved strings are inserted as text nodes, never HTML. Resource CSP permits only
first-party scan assets; no nested frames or direct browser API connections are required.
External source links use the host's open-link mechanism.

### Editing and verification

From `web/`:

```sh
node scripts/build-mcp-reader.mjs
node scripts/build-mcp-reader.mjs --check
npx tsc --noEmit
node --import tsx --test lib/mcp/mcp.test.ts
node --import tsx scripts/preview-mcp-reader.mjs
```

Edit `lib/mcp/reader/client.ts`, `style.css`, and `shell.html`; regenerate and include
`generated.ts` in the same change. The committed generated HTML is bundled into the MCP
server, so production does not depend on filesystem tracing or a separate build step.
`tool-contract.json` captures the pre-reader published descriptors; tests exclude only the
new `_meta` and require every other descriptor field to match exactly. Do not regenerate
that baseline to accommodate an accidental tool-contract change.

Open `http://127.0.0.1:3138` and click **Run browser checks**. The local harness exercises the
actual generated widget with clearly labeled fixtures and a simulated MCP Apps parent.
Its fixture scan is deliberately substituted locally; it is never shipped in the resource.
It checks literal matching, scan alignment and zoom, escaping, tool pagination, long OCR,
removal and stale-response handling, parent validation, mobile layout, host themes and
fullscreen acknowledgement. This is not a substitute for ChatGPT's own sandbox test.

For real-record inspection, start `npm run dev -- -p 3139`, then run
`MCP_READER_PREVIEW_PORT=3140 node --import tsx scripts/preview-mcp-reader.mjs --live`.
Open `http://127.0.0.1:3140/?live` (or append `&doc=NYC-WTC_000140827` to open a page).
The local-only host forwards the five read-only calls to the local Next.js `/mcp` endpoint.
The development harness is not an application route and is not exposed in production.

### Rollout

Keep this resource URI stable for compatible UI updates. Preserve the existing published
contract while UI metadata is being reviewed. Current official guidance says UI references,
CSP and tool `_meta` changes undergo continuous automated review, while compatible resource
content at the same URI can update without a new version submission. This is not a promise
that the UI becomes available immediately after deployment.

Before release, connect a ChatGPT developer-mode app to the HTTPS development endpoint,
refresh descriptors, verify scan loading under the declared CSP, host tool calls, actual
fullscreen and external links, and then check the published integration after automated review.
No submission, publishing, deployment, or endpoint-origin change is performed by this patch.

References checked 2026-09-16:
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/apps-sdk/reference
- https://developers.openai.com/plugins/deploy/app-review#how-published-mcp-metadata-versions-work
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

Proposed release note at merge: “Read cited documents directly in connected AI apps, view
scans beside extracted text, highlight matching phrases, and copy exact page citations.”

### Rendering policy

Only `get_document` advertises the reader template. Search, page reads (including OCR pagination), collection browsing, and changes are data-only calls; they remain callable from the mounted reader. Server instructions prefer a concise cited answer and, when useful or requested, one final document reader. This is model guidance, not a server-enforced per-turn cap: the stateless endpoint cannot reliably identify answer boundaries. No tool names, schemas, or result fields changed. Refresh connector metadata and start a new chat after deployment.
