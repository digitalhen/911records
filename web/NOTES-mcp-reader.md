# MCP reader implementation — 2026-09-16

- Preserves `/mcp` and the five published tools; descriptor snapshot tests enforce unchanged contracts except new UI metadata.
- Adds a self-contained MCP Apps resource, compact reader, source lists, scans/text, phrase matching, zoom, citations, dark/mobile layouts and host bridge.
- Reuses existing files/word boxes through optional backend enrichment; boxes stay in widget-only result metadata.
- No new dependencies, credentials or production routes. Release prepared as v0.19.0.
- Local checks: TypeScript, generated-resource freshness, 8 MCP tests, 15 Chrome iframe checks passed; no uncaught browser errors.
- Local Next.js at http://127.0.0.1:3139/mcp passed all five real-data smoke calls.
- Real records inspected in Chrome at http://127.0.0.1:3140/?live; “Clearinghouse” aligns on the scan and text of NYC-WTC_000140827; mismatched text/geometry falls back to text. Desktop, mobile and dark views checked.
- ChatGPT developer-mode testing, real host CSP/fullscreen/external links and published metadata review remain release checks.
- Rebuild resource after source edits: `node scripts/build-mcp-reader.mjs` from web/. See `lib/mcp/README.md`.
- Proposed release note: “Read cited documents directly in connected AI apps, view scans beside extracted text, highlight matching phrases, and copy exact page citations.”
- Release: v0.19.0, dated 2026-09-16; user-facing note added to `web/lib/releases.ts`.
