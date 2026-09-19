# web/ — 911records.org app

Next.js 15 (App Router, TypeScript). This is workstream B1 of `docs/PLAN.md`: the
foundation — layout, design system ported from `design/astra/`, search, the
document viewer, `/api/health`, `robots.txt`/sitemap, and the Docker/compose
setup. Later workstreams (B2–B6) add the home page's remaining sections, Ask,
entities/topics/versions, the building map, and the case folder — those routes
are linked from the nav already and will 404 until built.

## Architecture (HA, no bind mount)

This app runs on **two** Dokploy instances (StudioMac and MonsterMac) behind
one Cloudflare tunnel, auto-deployed from `main` — like prospect.nyc. That
rules out a shared bind mount to `data/`, so every dependency is a network
call:

```
app (this Next.js app, x2 replicas, no local data at all)
 ├─ lib/db.ts       Postgres: DATABASE_URL (primary) + DATABASE_READ_URL (standby, optional)
 │                  schema `site` = pipeline-derived data (A2 owns it)
 │                  schema `app`  = this app's own runtime tables (bootstrapped at boot)
 ├─ lib/opensearch.ts / lib/embed.ts   search + query embedding, over HTTP
 └─ /files/*  →  FILES_URL  →  the `files` service (PDFs, page images, word-box files)
```

`docker-compose.yml` (repo root) is the Dokploy-deployed piece: the `app`
service **only**, matching `~/Code/prospect/docker-compose.yml`'s
external-services shape. `docker-compose.host.yml` (also repo root) is a
**separate** compose that runs on StudioMac's own host docker (not Dokploy):
`files` (nginx serving `data/pdf`, `data/pages`, `data/text` off StudioMac's
disk, plus an `/ollama/` proxy) and `opensearch` (security plugin on, for
once the LAN cutover happens — see that file's header comment; the existing
dev-only `docker-compose.opensearch.yml`, security off, 127.0.0.1-only, stays
as it is and is not touched by this).

## Dev setup

You need, running locally (none of this touches the City's portal):

- **Postgres.** Copy the two lines from `data/sept11-db.env`
  (`DATABASE_URL`, `DATABASE_READ_URL`) into `web/.env.local` — gitignored,
  never commit it. Schema `site` is built by the pipeline (workstream A2);
  if it's not there yet, pages that read it degrade (empty collection
  summary, `/api/health`'s `site.schemaReady: false`) rather than 500.
- **OpenSearch**, for search and facets: `docker compose -f
  ../docker-compose.opensearch.yml up -d` (security disabled, localhost only).
  Index with `scripts/search/opensearch.py setup` then `index` from the repo
  root.
- **Ollama**, for semantic (hybrid) search: any local Ollama with
  `nomic-embed-text` pulled. Search still works keyword-only without it — the
  results page says so.
- **Files.** PDFs, page images and word-box files are served by a separate
  origin (`/files/pdf/<agency>/<volume>/<bates>.pdf`,
  `/files/page/<agency>/<volume>/<bates>/<n>.webp`,
  `/files/text/<agency>/<volume>/<bates>.boxes.jsonl`), proxied by a Next
  rewrite (`next.config.ts`) to `FILES_URL`. In dev, run `npm run files` (a
  small Node static server + Ollama proxy, `scripts/files-dev-server.mjs`)
  instead of the production `files` nginx service.

Then:

```bash
npm install
npm run files &     # dev file server on :8911
npm run dev          # Next dev server, picks a free port if 3000 is busy
```

## Env vars

| Var | Default | What |
|---|---|---|
| `DATABASE_URL` | — (required) | Primary Postgres connection string |
| `DATABASE_READ_URL` | unset | Optional standby for reads; falls back to primary on error |
| `FILES_URL` | `http://127.0.0.1:8911` | Origin for `/files/*` rewrites and server-side fetches |
| `OPENSEARCH_URL` | `http://127.0.0.1:9200` | OpenSearch base URL |
| `OPENSEARCH_USER` / `OPENSEARCH_PASSWORD` | unset | Basic auth (unset = no auth, matches the local dev compose) |
| `OPENSEARCH_INDEX` | `sept11-pages-v1` | Must match `scripts/search/opensearch.py`'s `INDEX` |
| `OPENSEARCH_PIPELINE` | `sept11-hybrid` | Must match that script's `PIPELINE` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Query embedding; in prod, route through `FILES_URL/ollama` |
| `REPLICA_NAME` | unset | This instance's name, reported by `/api/health` |
| `GIT_SHA` | unset | Reported by `/api/health`; set at build time in Docker |
| `NEXT_PUBLIC_SITE_URL` | `https://911records.org` | Canonical origin for metadata/sitemaps |

## How the pieces connect

```
app (Next.js)
 ├─ lib/db.ts         pg Pool(s): DATABASE_URL primary, optional DATABASE_READ_URL standby
 ├─ lib/site.ts       typed reads against Postgres schema `site` (documents, pages, page_text, snapshots, changes, meta)
 ├─ lib/runtimeSchema.ts  bootstraps schema `app` at boot (instrumentation.ts) for B3/B6's runtime tables
 ├─ lib/opensearch.ts / lib/embed.ts   search/facets/exact-Bates lookup + query embedding, over HTTP
 ├─ lib/files.ts       builds /files/... (public, browser-facing) and FILES_URL/... (server-side fetch) URLs
 ├─ lib/boxes.ts       fetches + LRU-caches word-box JSONL from the files service
 └─ /files/*  →  FILES_URL (nginx in prod, scripts/files-dev-server.mjs in dev) → data/pdf, data/pages, data/text
```

## Verify

```bash
npx tsc --noEmit
npm run build
npm run dev
curl "http://localhost:3000/api/health" | jq
open "http://localhost:3000/search?q=asbestos"
open "http://localhost:3000/doc/<a bates_start from site.documents that has a downloaded PDF>"
```

## Known gaps (for B2–B6 and QA)

- **410 for removed documents.** The document viewer detects
  `documents.status = 'removed'` and renders a removal notice, but the HTTP
  status stays 200 — Next's App Router page components can't set an arbitrary
  status code without becoming a Route Handler that renders HTML by hand. Not
  exercised yet (the current snapshot has zero removed documents).
- **Word-box highlighting** on the document viewer only triggers from a
  `?hl=` query param. No client-side "find next" yet — reasonable B2/B6
  polish, not a foundation gap.
- **Facet counts** reflect the query, not the currently-selected filters
  (computed before `post_filter` is applied). Good enough for v1.
- **OpenSearch auth in production.** `docker-compose.host.yml`'s `opensearch`
  runs with the security plugin ON but `plugins.security.ssl.http.enabled`
  OFF — plain HTTP with basic auth on a LAN-only service, deliberately, so
  the app never needs a `NODE_TLS_REJECT_UNAUTHORIZED` workaround for a
  self-signed demo cert. Not yet cut over from the dev instance (see that
  file's header comment for the steps). `scripts/search/opensearch.py`
  doesn't read basic-auth env yet either — that's part of A2's listed
  `--host`/basic-auth work.
- **`site.page_text`** is read directly by `lib/site.ts`; word boxes still
  come from files (`lib/boxes.ts`) since they're geometry tied to a specific
  rendered image, not something that belongs in a text column.
- Home page is intentionally minimal (search box + collection summary) —
  suggestions, recent releases and the "reading these records" note are B2's.
- `lib/runtimeSchema.ts` only creates schema `app` and a placeholder
  `runtime_migrations` table — the actual runtime tables (answer permalinks
  for B3, PII reports and saved-search alerts for B6) belong in that same
  file, added by the workstream that reads and writes them.
