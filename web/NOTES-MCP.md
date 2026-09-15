# MCP endpoint

- Added `/mcp`: stateless, read-only Streamable HTTP using the official TypeScript SDK.
- Tools: search_records, get_document, get_page, browse_collection, get_changes.
- Existing search/Postgres reads reused; no migrations or new secrets.
- Removed records blocked before retrieval; search results checked against the catalog.
- Bounded requests/results, best-effort per-process rate/concurrency limits, Origin validation.
- Citations use direct canonical HTTPS URLs, independent of proxy headers.
- Added `@modelcontextprotocol/sdk` dependency, required for protocol/client compatibility.
- Documentation and generic connection configuration: `lib/mcp/README.md`.
- Verification: five official-client fixture tests; TypeScript; real local Next route and all
  five tools exercised against existing services using `node lib/mcp/smoke.mjs`.
- No browser UI changed; protocol checks exercise the actual HTTP endpoint.
- Release: 0.16.0. Pushing main triggers the existing deployment workflow.
- Existing `/page/` redirect bug is unchanged; MCP citations avoid that redirect.
