# Perf pass (issue #13)

Measured against `npm run dev -p 3118` (Postgres standby role `sept11_ro`, live OpenSearch,
live Ollama, live files service — all real, only the app runs unbuilt). Corpus mirrored so far:
24,436/24,436 documents catalogued, 26,584/172,537 pages rendered (~15%) — absolute numbers below
will move as the mirror fills in; the *relative* wins (index use, cache hit vs miss, query shape)
don't. **`next dev` is not representative of the standalone production build** (no minification,
no route-level code splitting maturity, React Refresh overhead) — COMMON-web.md forbids `npm run
build` in a shared worktree, so treat every absolute millisecond below as directional, not a
production SLO measurement. Content/ranking was verified unchanged for every change (browser
checks below, and the OpenSearch section documents one change that was *rejected* specifically
because it altered ranking).

## 1. HTTP p50/p95 (30 req/route, `scripts/perf/bench.mjs`, warm)

| Route | Before p50/p95 | After p50/p95 | What changed |
|---|---|---|---|
| `/` | 180 / 211 ms | 82 / 93 ms | map places + suggestions cached |
| `/entities` | 163 / 176 ms | 41 / 45 ms | panel grid cached |
| `/topics` | 316 / 485 ms | 156 / 177 ms | topic tree cached |
| `/building/1000836` | 52 / 60 ms | 38 / 41 ms | place file cached |
| `/doc/NYC-WTC_000094375` | 60 / 118 ms | 58 / 64 ms | untouched (p95 jitter down) |
| `/search?q=asbestos` | 306 / 363 ms | 297 / 351 ms | untouched — see §4, change rejected |

## 2. Database — indexes added to `scripts/embed/load_site_pg.py` (next swap only; live `site`
schema was never touched — every number below came from a scratch copy of the live tables in an
isolated `perf_test` schema, created from the primary, dropped when done)

**Real bug, not just missing indexes**: `web/lib/info/catalog.ts`'s `filters()` (browse) and
`web/lib/site.ts`'s `getNextInFolder` built `col IS NOT DISTINCT FROM $n` so an untagged
agency/volume/box/folder still matched. Postgres's planner **never** turns `IS NOT DISTINCT FROM`
into a btree index condition — verified with EXPLAIN, it stays a post-scan `Filter` — so every
`/browse` page and the cover-sheet "folder's records follow" banner did a full `Seq Scan` on
`site.documents` regardless of any index that existed. Rewrote both to `col = $n` / `col IS NULL`
per field (exactly equivalent since each path segment is null or a literal, never ambiguous) and
added one composite index that covers every prefix length:

| Query | Before | After |
|---|---|---|
| browse filter (agency+volume+box) | Seq Scan, cost 1516, 12.9 ms | Index Scan `documents_browse`, cost 2.65, 0.9 ms |
| `getNextInFolder` | Seq Scan, cost 1699, 4.5 ms | Index Scan `documents_browse`, cost 2.64, 0.08 ms |

New indexes (added to `INDEX_STATEMENTS`, applied on the next build-then-swap):
- `documents(agency, volume, box, folder, doc)` — the fix above; also serves any browse prefix.
- `documents(doc_type)` — doc-type filter/facet was a Seq Scan (4.5 ms → 0.12 ms, Bitmap Index Scan).
- `doc_topics(topic, prob DESC NULLS LAST)` — `topicDocuments` avoids sorting the whole per-topic
  set (Incremental Sort instead of Sort): 6.8 ms → 1.8 ms.
- `place_pages USING GIN (contaminants)` — the map's substance filter (`pp.contaminants ? $1`) was
  a Seq Scan; now a Bitmap Index Scan (9.4 ms → 3.5 ms at today's ~3.7k rows; the win grows with
  the corpus — GIN lookup stays ~flat, Seq Scan is linear).

The rest of the requested lookup paths (`entity_pages` by entity_id/doc, `signatory_pages`/`related`
by doc, `pages`/`page_text` by doc) already had covering indexes from B1 — checked with EXPLAIN,
confirmed Index Scan, nothing to add.

## 3. App caching — `unstable_cache`, keyed by `site.meta.built_at`

`lib/site.ts` adds `buildVersion()`: a 60s-TTL cached read of `built_at`, used as a cache-key
argument (not a fixed TTL) on every read below — a schema swap mints a fresh cache entry within
that 60s window rather than waiting out an unrelated long TTL, and nothing serves a value computed
from an older `built_at` than `buildVersion()` would report right now. `getMeta()` itself is left
**uncached** — `/api/health` and the deploy-verification step must always see live truth (Prospect's
replica-skew rule).

Cached: `getTopics`, `panelGrid` (discovery), `getMapPlaces` (default filters only — `/api/map`'s
filtered queries stay live), `getSuggestions`, `getPlaceFile` (map/building), `getDocumentCount`,
`getLatestSnapshot`, `getSnapshots` (site), `snapshots()` (catalog/changes). Two rows
(`snapshots`/`latest snapshot`) carry a pg `DATE` — pre-formatted to `'YYYY-MM-DD'` string before
entering the cache, because `unstable_cache` round-trips through JSON and a raw `Date` would come
back as a full ISO timestamp on a cache hit, silently changing rendered text between cold/warm
cache. Verified byte-identical output in Chrome (`/changes`, `/browse/…`) and via `get_page_text`.

## 4. OpenSearch — investigated, one change rejected, everything else already reasonable

`_source` is already trimmed to 9 fields, highlight is 1 fragment/220 chars, facet size 15/field —
all reasonable for this corpus. The dominant cost in `/search`'s hybrid query is
**`pagination_depth`**: `web/lib/opensearch.ts` sets `Math.max(1000, from + pageSize)`
unconditionally, even on page 1. Direct OpenSearch timing (`_search?search_pipeline=…`, same body):

- `pagination_depth: 1000` (current): `took: 186 ms`, top hits `[…153319@0.903, …153317@0.870,
  …095044@0.678, …156163@0.629, …142600@0.562]`
- `pagination_depth: 20` (from+pageSize, the documented minimum): `took: 29 ms` (6.4x) but rank 4
  changes (`…149431@0.4` swaps in ahead of `…156163@0.364`) — `min_max` score normalization is
  computed over the candidates `pagination_depth` keeps, so a smaller pool changes relative scores
  and can reorder results. **Left unchanged** — the task requires identical results, and this
  wasn't provably safe at every query. Flagging for a follow-up with the team: either accept the
  reorder risk at a smaller depth, or keep 1000 and treat ~180ms as the OpenSearch floor for a
  hybrid query on this corpus.
- Tried `request_cache=true` as a cheap, ranking-safe win: **breaks** — the hybrid search pipeline's
  normalization processor 500s on cache lookups (`NullPointerException: searchHit is null`,
  confirmed with a direct request). Do not enable per-request caching on the hybrid path.

## 5. Files / page images

`app/files/[...path]/route.ts` already forwards `etag`, `last-modified`, `cache-control`,
`accept-ranges`, `content-range` from the upstream files nginx, and forwards `range` /
`if-none-match` / `if-modified-since` from the browser — conditional GETs and PDF range requests
already work end to end. No code change needed here.

`files/nginx.conf` origin TTLs (`/pdf` 1h, `/page` 24h, `/text` 1h) were **not** extended to
`immutable`/a long TTL: `docs/PLAN.md` — "re-redacted PDFs are served in their newest version
only" — means the same Bates path can legitimately change content if the City re-issues a
redaction. A long-lived immutable cache at the edge risks serving an under-redacted page past the
point it should have been replaced; the current origin TTLs are the right conservative choice.

**Proposed Cloudflare Cache Rule** (not applied — out of scope for this pass): a Cache Rule
scoped to `/files/pdf/*` and `/files/page/*` with "Eligible for cache: yes" and Edge TTL "respect
origin headers". These are served through a Next.js route handler (not a static asset path), so
depending on the zone's default Cache Level they may not be getting Cloudflare's automatic
extension-based caching today — worth confirming via `cf-cache-status` on a production request
before assuming the origin's `Cache-Control` is already doing edge-cache work. This gets real CDN
benefit without changing the origin's re-redaction-safe TTLs.

## 6. Lighthouse (`next dev`, headless Chrome, one pass — directional only, see caveat above)

| Route | Performance | Accessibility | Notes |
|---|---|---|---|
| `/` | 61 | 100 | TBT 1.48s dominated by dev-mode `main-app.js` (1.7MB unminified); maplibre-gl (756KB) confirmed **not** loaded on `/search` or `/doc` — already correctly code-split to map/building pages only |
| `/search?q=asbestos` | 75 | 100 | |
| `/doc/NYC-WTC_000094375` | 53 | 93 | `color-contrast` and `definition-list` a11y findings — pre-existing markup issues in the document-viewer components, outside this pass's file scope (not touched, flagging for the owning workstream) |

No cheap image/font win found: the page-image `<img>` on `/doc` is a 6KB webp already, and the
map bundle is already excluded from non-map routes. The real lever for Lighthouse's performance
score here is the production build (minification + route-level chunking), which this pass
couldn't run per COMMON-web.md.

## Verification

- `npx tsc --noEmit`: clean.
- Chrome (not just curl): `/`, `/entities`, `/topics`, `/building/1000836`,
  `/browse/Environmental Protection, Dept. of/NYC-WTC0001/DEP Box 04`, `/changes` — no console
  errors, content spot-checked against pre-change values (browse folder counts, changes' snapshot
  date format).
- No DDL run against the live `site`/`site_new` schema — index verification used a throwaway
  `perf_test` schema copied from the primary, dropped after use.

## Proposed release note

No visible feature change — this is a backend latency pass (indexes land on the next scheduled
refresh; caching and the browse-filter fix are live once merged). Suggested if a note is wanted:
*"Pages that show the same information to everyone — the home map, entity index, topic map and
building pages — now load noticeably faster."*
