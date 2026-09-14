# web/ — 911records.nyc app

Next.js 15 (App Router, TypeScript). This is workstream B1 of `docs/PLAN.md`: the
foundation — layout, design system ported from `design/astra/`, search, the
document viewer, `/api/health`, `robots.txt`/sitemap, and the Docker/compose
setup. Later workstreams (B2–B6) add the home page's remaining sections, Ask,
entities/topics/versions, the building map, and the case folder — those routes
are linked from the nav already and will 404 until built.

## Dev setup

You need, running locally (none of this touches the City's portal):

- **Data.** `DATA_DIR` (default `../data`, i.e. the repo's `data/`) — the
  mirrored PDFs, OCR text and, once the pipeline has run, `site/site.sqlite`.
  If `data/site/site.sqlite` doesn't exist yet, run `npm run fixture-db` to
  build a stand-in from `data/manifest.jsonl` and `data/embed/*.sqlite` (see
  `scripts/fixture-site-db.mjs`). It gets out of the way the moment the real
  pipeline output appears — the script refuses to overwrite an existing file
  without `--force`.
- **OpenSearch**, for search and facets: `docker compose -f
  ../docker-compose.opensearch.yml up -d` (security disabled, localhost only —
  see that file). Index with `scripts/search/opensearch.py setup` then `index`
  from the repo root.
- **Ollama**, for semantic (hybrid) search: any local Ollama with
  `nomic-embed-text` pulled. Search still works keyword-only without it — the
  results page says so.
- **Files.** PDFs and page images are served by a separate origin
  (`/files/pdf/<bates>.pdf`, `/files/page/<bates>/<n>.webp`), proxied by a
  Next rewrite (see `next.config.ts`) to `FILES_URL`. In dev, run `npm run
  files` (a small Node static server, `scripts/files-dev-server.mjs`) instead
  of the production `files` nginx service.

Then:

```bash
npm install
npm run files &     # dev file server on :8911
npm run dev          # Next dev server, picks a free port if 3000 is busy
```

## Env vars

| Var | Default | What |
|---|---|---|
| `DATA_DIR` | `../data` | Root of the mirrored data tree |
| `FILES_URL` | `http://127.0.0.1:8911` | Origin for `/files/*` rewrites |
| `OPENSEARCH_URL` | `http://127.0.0.1:9200` | OpenSearch base URL |
| `OPENSEARCH_USER` / `OPENSEARCH_PASSWORD` | unset | Basic auth (unset = no auth, matches the local dev compose) |
| `OPENSEARCH_INDEX` | `sept11-pages-v1` | Must match `scripts/search/opensearch.py`'s `INDEX` |
| `OPENSEARCH_PIPELINE` | `sept11-hybrid` | Must match that script's `PIPELINE` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | For query embedding (hybrid search) |
| `GIT_SHA` | unset | Reported by `/api/health`; set at build time in Docker |
| `NEXT_PUBLIC_SITE_URL` | `https://911records.nyc` | Canonical origin for metadata/sitemaps |

## How the pieces connect

```
app (Next.js)
 ├─ lib/siteDb.ts     better-sqlite3, read-only, reopens on data/site/site.sqlite mtime change
 ├─ lib/opensearch.ts search/facets/exact-Bates lookup against OpenSearch (scripts/search/opensearch.py's index)
 ├─ lib/embed.ts      query embedding via Ollama for hybrid search; degrades to keyword-only if unreachable
 ├─ lib/textFiles.ts  reads OCR text + word boxes straight from data/text/*.pages.jsonl / *.boxes.jsonl
 └─ /files/*  →  FILES_URL (nginx in prod, scripts/files-dev-server.mjs in dev) → data/pdf, data/pages
```

`docker-compose.yml` (repo root) runs `app` + `files` + `opensearch` for a
production-shaped deploy; see `docs/PLAN.md` for the Dokploy specifics.

## Verify

```bash
npx tsc --noEmit
npm run build
npm run dev
curl "http://localhost:3000/api/health" | jq
open "http://localhost:3000/search?q=asbestos"
open "http://localhost:3000/doc/<a bates_start with a downloaded PDF from data/manifest.jsonl>"
```

## Known gaps (for B2–B6 and QA)

- **410 for removed documents.** The document viewer detects
  `documents.status = 'removed'` and renders a removal notice, but the HTTP
  status stays 200 — Next's App Router page components can't set an arbitrary
  status code without becoming a Route Handler that renders HTML by hand. Not
  exercised yet (the current snapshot has zero removed documents). Worth
  revisiting alongside B6's SEO pass.
- **Word-box highlighting** on the document viewer only triggers from a
  `?hl=` query param (typed into the "find within this page" box, or a link
  from search results later). It has no client-side "find next" — that's a
  reasonable B2/B6 polish item, not a foundation gap.
- **Facet counts** reflect the query, not the currently-selected filters
  (a simplification: they're computed before `post_filter` is applied). Good
  enough for v1; an exact per-facet "counts excluding this facet's own
  selection" would need per-facet filtered aggregations.
- **OpenSearch over TLS in production.** `docker-compose.yml`'s `opensearch`
  service runs with the security plugin on and its demo self-signed cert; the
  `app` service is given `NODE_TLS_REJECT_UNAUTHORIZED=0` to talk to it over
  the compose-internal network. Fine for a single-host bridge network:
  revisit before this network is anything else.
- Home page is intentionally minimal (search box + collection summary) —
  suggestions, recent releases and the "reading these records" note are B2's.
