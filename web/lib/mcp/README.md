# 911records MCP

Read-only MCP endpoint: `https://911records.org/mcp` after deployment.
Transport: stateless Streamable HTTP, JSON responses. No API key or session
affinity required. GET/DELETE return 405; clients must use Streamable HTTP,
not the legacy SSE transport. No additional database or indexing job.

## Connect

In a client supporting remote MCP, add `https://911records.org/mcp` as the
server URL with HTTP transport. Example generic client configuration
(the exact configuration file varies by client):

```json
{"mcpServers":{"911records":{"url":"https://911records.org/mcp","type":"http"}}}
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
No new secrets. Public citation URLs always use https://911records.org;
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

## Evidence panel

Only `get_document` advertises `ui://911records/reader.html`. Research calls stay data-only. The tool adds one optional `evidence` array (1–3 items); all existing names, descriptions, required inputs, output schemas, annotations and text results remain compatible. A refreshed developer connection is required to expose this optional field. No app-store submission is changed by deploying this code; schema changes can be subject to published-app metadata review.

After researching with search_records and get_page, ChatGPT may call get_document once with the selected pages and question-specific interpretations:

```json
{"doc":"NYC-WTC_000150782","evidence":[{"doc":"NYC-WTC_000150782","page":11,"label":"Pearl Street entries","claim":"Cleanup is recorded at five Pearl Street addresses.","explanation":"The list marks 205, 211, 212, 213 and 215 Pearl Street Completed.","limitation":"This is a cleanup record, not an asbestos sample result.","quote":"205 PEARL STREET"}]}
```

The first source belongs to `doc`; later sources can be other documents. Quotes are optional, contiguous source wording, verified with NFKC/whitespace normalization against the first 20,000 characters of the page. Mismatches, duplicate pages, unavailable or removed sources reject the entire panel. Interpretations are model-authored and labelled accordingly; quote validation does not validate the model’s conclusions. No model API or extra credentials are used on the server.

Widget-only metadata carries the selected briefs and canonical page data. URLs, scans, Bates identifiers and geometry come from the records backend, never caller-provided URLs. Selecting another source rereads it using get_page so a removal or failure clears the panel. Changed text that no longer supports a quotation also drops that source’s interpretation. No answer-specific data is stored or shared across users. The at-most-one-panel policy is model guidance, not a hard cross-call server cap.

Old get_document calls open start_page alongside the existing document summary, explicitly labelled as a whole-document summary. No summary is fabricated if it is absent. Non-UI clients still get the original structured document result.

The approved design is `design/mcp-evidence/`. Production has one compact brand bar, source buttons, relevance and optional limitation next to a scan, optional quotation disclosure, exact-page full-record link, scan enlargement, copy citation, collapse and responsive/dark layouts. Full OCR/page browsing lives on the site. ChatGPT owns the surrounding answer and citations; native citations link to the site, while only in-panel source controls switch the widget.

Scan highlights require validated geometry, matching full-page normalized text and image aspect ratio. Otherwise the quotation remains available with an explicit no-overlay fallback. The prototype’s manually placed highlights are not used in production.

### Validation and preview

From web/:

```
node scripts/build-mcp-reader.mjs
node scripts/build-mcp-reader.mjs --check
npx tsc --noEmit
node --import ./scripts/lib/register-server-only-stub.mjs --import tsx --test lib/mcp/mcp.test.ts
MCP_READER_PREVIEW_PORT=3143 node --import tsx scripts/preview-mcp-reader.mjs
```

Open the preview in Chrome and run its 15 browser checks. Use `--live` with local Next.js at 3139 and visit `?live&doc=NYC-WTC_000150782` for the real Pearl Street example. Preview scripts are local-only, not production routes.

After deployment, refresh the developer connection’s metadata and start a new conversation. Check that only get_document has a template and that its optional evidence input is present. Test a normal research request as well as a deterministic evidence payload. No new tool name or endpoint is needed.

Official guidance used:
- https://developers.openai.com/plugins/build/chatgpt-ui#separate-data-processing-from-ui-rendering
- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/reference#tool-results
