# P5 (issue #37: document titles and summaries) — shared-file change

`web/lib/opensearch.ts` is on COMMON-web.md's do-not-edit list, but threading `doc_title` (the new
OpenSearch field from `scripts/search/opensearch.py`'s mapping, P5) into search results and
"more like this page" requires it — there is no way to surface a document's title on `/search`
otherwise. The change is small and purely additive:

- `SearchHit.docTitle: string | null` added to the interface.
- `'doc_title'` added to the `_source` field list in `search()` and `moreLikePage()`.
- `docType?: string` sibling `doc_title?: string` added to the internal `OsHit` type.
- `docTitle: h._source.doc_title ?? null` added alongside the existing `docType` mapping in both
  functions.

No existing field, query shape or behavior changed. `npx tsc --noEmit` is clean. Verified with the
dev server against the live (pre-P5-data) index/DB: `/search?q=asbestos` renders 200 with no
`doc_title` present anywhere yet (field absent in the index → `undefined` → `null`, never an
error), so this degrades correctly before `scripts/search/opensearch.py index` has been rerun.

Coordinator: keep this change, or fold it in however you'd rather structure it — flagging per the
brief's rule rather than assuming it's fine to have touched a protected file silently.
