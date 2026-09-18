# Runbook

Operational notes for the pipeline that feeds the app: the daily refresh, `site.sqlite`, the
central Postgres, OpenSearch, and what to check when something looks wrong. See `README.md` for
the individual mirror scripts and `docs/PLAN.md` for the architecture and the `site.sqlite` schema
contract.

**The app is HA across two hosts**, so it never reads `site.sqlite` directly — it reads the `site`
schema in the central Postgres (loaded from `site.sqlite` by `load_site_pg.py`) and OpenSearch.
`site.sqlite` stays the local intermediate / dev convenience: sqlite3 CLI access, quick local
queries, and the source `load_site_pg.py` loads from.

## Daily refresh

`scripts/refresh_daily.sh`, installed as a launchd LaunchDaemon at 03:30 local time
(`docs/launchd/nyc.911records.refresh.plist`). One run at a time (atomic lock at
`data/refresh.lock`, reclaimed if the pid holding it is gone). Every run appends timestamped
lines to `data/refresh.log`; launchd's own stdout/stderr go to `data/refresh.launchd.{out,err}`
(should normally be empty — everything real goes through `refresh.log`).

Order: catalog snapshot and diff → download new/changed PDFs → extract PDF text →
render viewer images → fallback OCR → **300-DPI Apple Vision and Tesseract comparison** →
page embeddings → entities and canonical names → related records, topics, places and document
types → summaries and facts → build `site.sqlite` → load Postgres → build downloads → index
OpenSearch → suggested-question checks and reading seeds.

Both the daily refresh and `scripts/embed/loop.sh` run the stronger comparison before page
embeddings and entities. Every active PDF page is eligible, including readable extracted text.
The existing quality, cross-engine corroboration and decimal-preservation checks decide whether
to replace text. Original PDFs and `.pages.jsonl` extractions remain untouched. Approved OCR
is preserved while its source PDF stamp matches. Failed pages retain their current text.

Review state lives in `data/ocr-auto/state.sqlite`. Unchanged completed comparisons are reused;
a changed PDF or effective text requeues a page. Failures retry after one hour, doubling to a
24-hour maximum. Per-run candidates, decisions and original-sidecar backups are under
`data/ocr-auto/runs/`; `progress.json` and `last-run.json` report progress and the final counts.
A restarted run resumes from saved comparisons. The comparison requires macOS, Swift/Apple
Vision, Poppler and Tesseract on PATH. Bump the review policy version when changing its rules.

Daily cycles default to four workers, 500 pages and 900 seconds, checked between waves of up
to eight pages per worker. A running wave may exceed that time allowance. Configure
`OCR_AUTO_JOBS`, `OCR_AUTO_MAX_PAGES` and `OCR_AUTO_MAX_SECONDS` to adjust these limits.
Outstanding pages carry over to later cycles. For a complete backfill, without the cycle caps:

```bash
OCR_AUTO_JOBS=12 scripts/refresh_daily.sh --reprocess-all-ocr
```

This finishes the current unreviewed page queue, then reruns the downstream stages and
publication. Previously approved pages and matching completed comparisons count as reviewed.
Inspect error/deferred counts: a finished queue does not mean every engine call succeeded.
The full run uses a two-hour allowance for each summary/fact stage; facts still have a $3 model
budget. These model stages are non-fatal, so inspect their completion before claiming all
model-derived data is current. Embeddings and entity stages must succeed before publication.

Flags:
- `--reprocess-all-ocr` — full OCR backfill and downstream refresh, without contacting the portal.
- `--reprocess-ocr DIR` — apply a staged, reviewed OCR set with backups and rerun downstream stages.
- `--publish-only` — publish already-computed derived data without rerunning extraction or tagging.
- `--index-only` — skip catalog/download/loop stages, but rerun discovery, summaries and facts before publication.
- `--no-download` — run a normal refresh but skip PDF downloads.

Refresh holds both `data/refresh.lock` and `data/embed/loop.lock` through publication. An active
ingestion owner stops an overlapping refresh; it does not publish from data being changed.
Required-stage failures stop the run. Summary/fact and suggested-question failures are logged
and non-fatal. Check `data/refresh.log` for completion and exceptions.

### Install the launchd daemon

```bash
cp docs/launchd/nyc.911records.refresh.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/nyc.911records.refresh.plist
```

(Or `launchctl load -w` on older macOS.) The plist sets `WorkingDirectory` to the repo and a
Homebrew-inclusive `PATH` — launchd does not source your shell profile, so `node`, `.venv/bin/python`
and `pdftotext` must be reachable through that explicit PATH. Edit the plist first if the repo or
Homebrew live somewhere else, then `launchctl bootout gui/$(id -u)/nyc.911records.refresh` +
`bootstrap` again to pick up the change.

To run it by hand right now instead of waiting for 03:30:

```bash
launchctl kickstart -k gui/$(id -u)/nyc.911records.refresh
tail -f data/refresh.log
```

To uninstall: `launchctl bootout gui/$(id -u)/nyc.911records.refresh` then remove the plist copy
from `~/Library/LaunchAgents/`.

## Rebuilding `site.sqlite` by hand

```bash
.venv/bin/python scripts/embed/build_site_db.py
```

Reads `data/manifest.jsonl`, `data/catalog/*.summary.json` + `diff-*.json`,
`data/embed/{pages,entities,related,places}.sqlite`, and `data/pages/**/pages.json` (if A1's
renderer has produced any yet — it's treated as optional and everything still builds without it,
just with `image_ready=0` everywhere). Writes `data/site/site.sqlite.tmp`, adds indexes, `VACUUM`s,
then atomically `os.replace()`s it over `data/site/site.sqlite` — a reader never sees a half-built
file. Prints a JSON summary of row counts per table; takes well under a second on the current
corpus (24,436 documents) and is designed to stay well under a minute at the full 24k
documents / 172k pages scale. The app in `web/` should reopen its connection whenever this file's
mtime changes (poll it, or reopen per request — `better-sqlite3` is cheap to open).

Entity types are `agency`, `lab`, `contractor`, `substance` (contaminant mentions), `address` —
drawn from `data/embed/entities.sqlite`'s `mentions` table. **No person is ever an entity.** The
only people ever surfaced anywhere are `signatories`, built strictly from `roles WHERE official=1`
(a title/org attached, or a certifying action — see `entities.py`'s docstring for exactly which).
If that filter ever looks wrong, fix it in `entities.py`'s `official` computation, not here —
`build_site_db.py` trusts `official=1` as already-decided and never re-derives it.

## Loading Postgres (what the app actually reads)

```bash
.venv/bin/python scripts/embed/load_site_pg.py
```

Reads `data/site/site.sqlite` (run `build_site_db.py` first if it's missing or stale) and loads
every one of its tables into the central Postgres, database `sept11`, plus one table Postgres
alone holds: `page_text(doc, page, text, source)` — built straight from
`data/text/**/<bates>.pages.jsonl` (`source='pdftotext'`), overridden per-page by
`data/text/**/<bates>.ocr.jsonl` through the shared `page_text.py` selector (`source='ours'`). Valid approved OCR takes
precedence; rejected or source-stale OCR does not. Legacy fallback applies only to short
original extractions with sufficient OCR text. `site.sqlite` itself carries no page text — the app
reads it from Postgres so both HA hosts see the same thing regardless of which one last ran the
pipeline.

**Build-then-swap at the schema level**, same idea as `site.sqlite`'s own build-then-swap: every
table is created and `COPY`-loaded into a fresh `site_new` schema, indexed there, and only then —
in one transaction — `site` is renamed to `site_old`, `site_new` is renamed to `site`, `SELECT` is
(re-)granted on the new `site` to `sept11_ro` (`ALTER DEFAULT PRIVILEGES` only ever covered
`public` here, so this grant is redone on every swap rather than relied on to persist), and
`site_old` is dropped. A reader never sees a half-loaded schema, and a run that dies partway
through leaves the previous `site` schema exactly as it was (only a leftover `site_new` to clean
up, which the next run drops itself before starting).

**Connection**: host/port/user/database default to `127.0.0.1:5433`, `sept11`, `sept11` — the
central Homebrew Postgres, the same one prospect.nyc and the other `*_ro`-paired databases live
on. The password is never read, held, or written by this script or by `refresh_daily.sh`: libpq
picks it up from `~/.pgpass` (matched by host:port:database:user) the same way plain `psql` does.
Override host/port/user/database with `PGHOST` / `PGPORT` / `PGUSER` / `PGDATABASE` — e.g. to load
from a different box, or as a different Postgres user that also has a `~/.pgpass` line and `CREATE`
on the database.

Verify counts directly:

```bash
psql -h 127.0.0.1 -p 5433 -U sept11 -d sept11 -c "select count(*) from site.documents;"
psql -h 127.0.0.1 -p 5433 -U sept11 -d sept11 -c "select count(*) from site.page_text;"
# from the read-only replica, as the read-only role, to confirm replication:
psql -h 192.168.200.52 -p 5433 -U sept11_ro -d sept11 -c "select count(*) from site.documents;"
```

If `sept11_ro` ever can't see the `site` schema after a swap (e.g. someone ran the loader as a
different Postgres user that isn't the schema owner and whose `GRANT` silently no-ops), re-run
`load_site_pg.py` as the `sept11` owner, or by hand:
`GRANT USAGE ON SCHEMA site TO sept11_ro; GRANT SELECT ON ALL TABLES IN SCHEMA site TO sept11_ro;`

## Re-indexing OpenSearch

```bash
.venv/bin/python scripts/search/opensearch.py setup            # idempotent; creates the index if missing,
                                                                 # else PUTs a compatible mapping update
.venv/bin/python scripts/search/opensearch.py index             # incremental, by content hash
.venv/bin/python scripts/search/opensearch.py index --limit 20  # smoke test: only the first 20 documents
.venv/bin/python scripts/search/opensearch.py stats
.venv/bin/python scripts/search/opensearch.py query "asbestos Liberty Street" --k 10
```

`index` is safe to re-run: each page document's `content_hash` is compared against what's already
indexed, so nothing is re-sent unless its content actually changed. **Adding a field to the
document shape changes every page's hash**, so the run right after a schema change (like this
one — `image_ready`, `ocr_source`, `doc_status`, `first_seen`) re-sends every document once, then
goes back to being cheap.

To point at a different node (the production OpenSearch in the Dokploy VM, say):

```bash
OPENSEARCH_URL=http://<vm-lan-ip>:9200 OPENSEARCH_USER=admin OPENSEARCH_PASSWORD=... \
  .venv/bin/python scripts/search/opensearch.py setup
OPENSEARCH_URL=http://<vm-lan-ip>:9200 OPENSEARCH_USER=admin OPENSEARCH_PASSWORD=... \
  .venv/bin/python scripts/search/opensearch.py index
```

`refresh_daily.sh` picks up the same three env vars for its own `setup`/`index` stages — export
them in the shell that runs it, or add them under the launchd plist's `EnvironmentVariables`.

**Reindex from scratch** (mapping change that isn't additive, or the index looks corrupted):
`opensearch.py setup --recreate` drops and recreates the index, then a plain `index` run repopulates
it from `data/text/**/*.pages.jsonl` — there is no separate backing store for page documents, so
this is always safe, just slow at full scale (172k pages).

The index name is `sept11-pages-v1`. Bump it (edit `INDEX` in `scripts/search/opensearch.py`) only
if a mapping change is genuinely incompatible (a field's type needs to change, not just a field
being added) — `setup` prefers an in-place mapping update specifically to avoid that.

## `/api/health` is unhappy — what to check

1. **`site.sqlite` missing or stale.** `sqlite3 data/site/site.sqlite "select * from meta"` — check
   `built_at` and `snapshot_date`. If it's missing entirely or clearly old, run
   `.venv/bin/python scripts/embed/build_site_db.py` by hand and check its summary line for errors.
   (The app itself doesn't read this file — it's the input to the next step — but a health check
   comparing "what's on disk" to "what the app sees" starts here.)
2. **Postgres schema `site` missing, stale, or not visible to the app.** This is what the app
   actually reads, on both HA hosts.
   `psql -h 127.0.0.1 -p 5433 -U sept11 -d sept11 -c "select value from site.meta where key='built_at'"`
   — compare against `site.sqlite`'s own `meta.built_at`; they should match the last successful
   `load_site_pg.py` run. If the schema is missing or very old, run
   `.venv/bin/python scripts/embed/load_site_pg.py` by hand. If only one of the two app hosts is
   unhappy, check that host's `PGHOST`/`PGPORT` env and that it can reach 127.0.0.1:5433 or the
   standby at 192.168.200.52:5433 — and that `sept11_ro` still has `SELECT` on `site` (see the
   Postgres section above for the one-liner if not).
3. **OpenSearch unreachable or the wrong node.** `curl -s $OPENSEARCH_URL/_cluster/health`; confirm
   `OPENSEARCH_URL`/`_USER`/`_PASSWORD` are what the app process actually has (`docker compose`
   env, or the launchd plist / shell that started the app). `opensearch.py stats` against the same
   URL should show a nonzero `docs` count and field coverage roughly tracking `site.sqlite`'s
   `pages` count in `meta`.
4. **Refresh hasn't run, or failed.** `tail -50 data/refresh.log` for the most recent run and
   whether it ended in `done` or a `FAILED` line — note which stage failed (`build_site_db`,
   `load_site_pg`, `opensearch_setup`, `opensearch_index`, ...). `launchctl list | grep 911records`
   should show the daemon loaded; `launchctl print gui/$(id -u)/nyc.911records.refresh` shows its
   last exit code.
5. **A stale lock is blocking every run.** `ls data/refresh.lock` — if it exists and
   `cat data/refresh.lock/pid` names a process that isn't running (`ps -p <pid>`), it's safe to
   `rm -rf data/refresh.lock` and re-run by hand.
6. **The download or embed loop looks stuck.** `cat data/download.progress.json` (status/ETA) and
   `tail data/embed/loop.log`. Neither blocks `refresh_daily.sh --index-only` from working, since
   that flag never touches them.

## Environment variables

| Var | Used by | Default | Notes |
|---|---|---|---|
| `OPENSEARCH_URL` | `opensearch.py`, `refresh_daily.sh` | `http://127.0.0.1:9200` | Point at the VM's LAN IP in production. |
| `OPENSEARCH_USER` | `opensearch.py` | unset (no auth) | Set together with the password; local dev has security disabled. |
| `OPENSEARCH_PASSWORD` | `opensearch.py` | unset | |
| `PGHOST` | `load_site_pg.py`, `refresh_daily.sh` | `127.0.0.1` | The standby is `192.168.200.52` (read-only, `sept11_ro` only). |
| `PGPORT` | `load_site_pg.py` | `5433` | |
| `PGUSER` | `load_site_pg.py` | `sept11` | Must own the `site` schema (or be superuser) to `CREATE SCHEMA` / rename it. |
| `PGDATABASE` | `load_site_pg.py` | `sept11` | |
| *(no password env)* | `load_site_pg.py` | — | Always resolved from `~/.pgpass` by libpq; never set, read, or logged by any script here. |
| `NEXT_PUBLIC_SITE_URL`, `OLLAMA_URL`, `ANTHROPIC_API_KEY`, `ASK_MODEL`, `ASK_DAILY_USD_CAP`, `GIT_SHA` | the app (`web/`) | — | See `docs/PLAN.md`'s deployment steps; not consumed by the pipeline scripts in this document. |

## Maintenance page during deploys (Cloudflare Worker, 2026-09-14)
`cloudflare/maintenance/` is a Worker on the `911records.nyc/*` route. It passes every response
through untouched except Traefik's deploy-time plain-text "404 page not found" and HTML/plain
5xx or tunnel errors, which become a 503 maintenance page that reloads itself every 15 s.
Deploy changes with `npx wrangler deploy` in that directory (Wrangler OAuth login as
digitalhen@gmail.com). The zone is on Cloudflare's Free plan: the Workers free tier allows
100,000 requests a day, and beyond that Cloudflare answers with its own error page until the
day resets — upgrade to Workers Paid ($5/month) in the dashboard before a traffic spike.

## Titles and summaries pipeline (local qwen, no LLM session needed) — added 2026-09-14

All document titles/summaries come from `qwen3.5:35b-a3b` on Ollama (Henry: "skip haiku entirely").
`scripts/embed/summaries_pipeline.sh` runs the whole thing detached and resumable, one Ollama job at a
time with a memory watchdog:

```
scripts/embed/summaries_pipeline.sh start    # runs: summarise → publish → qa-screen → qa-review → qa-apply → publish
scripts/embed/summaries_pipeline.sh status   # stage, counts (titled / by qwen / still by Haiku), QA verdicts, last log lines
scripts/embed/summaries_pipeline.sh stop     # clean stop; progress is checkpointed every 100 documents; `start` resumes
```

Log `data/embed/logs/summaries-pipeline.log`; completed stages in `…/summaries-pipeline.state` (delete a
line to re-run that stage). The QA report lands in `docs/eval/summaries-qa-report.md`. The daily refresh's
summaries stage also uses the Ollama backend now (`SUMMARIES_BACKEND=ollama`), so new documents get qwen
titles the next morning without any API spend. If the watchdog stops a stage for memory, just `start` again.

## Bulk downloads (StudioMac only)

Original PDFs and all ZIP archives live on **StudioMac**. MonsterMac's app holds no
copy: both app replicas stream from StudioMac's existing `FILES_URL` origin. The
download page is `/downloads`; archives are in `data/downloads/`. No external
storage account or second archive server is required. Downloads are unavailable
if StudioMac's file service is offline, even if the other web replica is healthy.

The daily refresh now runs `scripts/downloads/build.py` after loading Postgres.
It verifies every current PDF, builds ZIP64 archives for the full collection and
for each `(agency, volume, box)` group (including missing box labels), and publishes
`index.json` atomically only when everything is complete. PDFs are stored without
recompression. Budget roughly twice the PDF collection size for current ZIPs,
plus up to another two times that size during a replacement build. Unchanged
archives are reused; obsolete archives are deleted after publication.

The public handler checks `site.meta.built_at` on the **primary** database for each
request. A catalog swap immediately stops offering old downloads until a matching
index is published. Missing PDFs, unchecked changed records, build failures, or
unavailable dependencies fail closed. The raw `/files/downloads/*` path is blocked;
only files listed in the current index can pass `/api/downloads/<name>`, and a
valid CAPTCHA grant is required for every GET/HEAD/range request (including JSON inventories). Responses
use `Cache-Control: private, no-store`; do not override that with an edge cache rule.
Already-running responses and downloaded copies cannot be recalled.

Deployment order (coordinator):

1. Install the code, then run `node scripts/download.mjs` on StudioMac. Catalog-marked
   changes now trigger conditional revalidation even if the byte size is unchanged;
   failed downloads return nonzero. Old copies stay out of the public archives.
2. Run `python3 scripts/downloads/build.py` against the `data/site/site.sqlite` that
   was last loaded into Postgres. Do not rebuild the SQLite catalog alone before
   this step; its `built_at` must match the published database. Previously built,
   verified archives for this exact catalog can be copied into `data/downloads`.
3. Configure the CAPTCHA variables on both apps, then deploy the web change with
   its release version/notes. Verify both replicas block `/files/downloads/*` and
   require verification at `/api/downloads/*` before exposing archives on the origin.
   During this first deployment the new download page will show archives unavailable.
4. Recreate only the host files service under the OrbStack Docker context to add its
   downloads mount and nginx location:
   `docker --context orbstack compose --env-file data/host.env -f docker-compose.host.yml up -d --no-deps files`.
5. Check `/downloads`, the CAPTCHA gate, `/api/health` on both replicas, the release
   page, and an authorized byte-range request against a listed ZIP.

Manual build: `python3 scripts/downloads/build.py --data data`. It makes no network
requests. A per-output-directory advisory lock prevents competing builds. The
builder does not mutate the PDFs or database. It exports only catalog identifiers,
agencies, volumes, box/source labels, page counts, paths, sizes, and checksums;
private folder labels and derived text are not copied into inventory metadata.

`/api/downloads/index.json` describes the current archives and ZIP checksums.
`/api/downloads/manifest.json` lists current PDFs with SHA-256 hashes, and known
removed document identifiers/dates. Users compare paths and hashes to identify
additions, replacements and removals. An individual-box ZIP has an inventory for
that box only; compare the same agency/volume/box in the full inventory. The download
page explains that the ZIPs contain original PDFs, not OCR, page images, or search
indexes. `/changes` remains the human-readable history. Capture dates describe our
observations, not necessarily when the City acted.

Catalog-based refresh cannot detect an unannounced, same-size PDF replacement
when the City leaves its catalog entry unchanged. A separate operator-triggered
`node scripts/download.mjs --revalidate` checks all current URLs conditionally;
servers without ETags are fetched again. Schedule such an audit only with an
appropriate request budget for the City's portal (24,000+ requests). Do not claim
that a catalog refresh is a byte-level audit of every City PDF.


### CAPTCHA before downloads

Cloudflare Turnstile gates `/api/downloads/*` downloads. Unverified GETs redirect
to `/downloads/verify?file=…`; unverified HEADs return 403. POST
`/api/downloads/verify` checks the token at Cloudflare Siteverify, requires the
`bulk_download` action and `911records.nyc` hostname, and issues a signed,
HttpOnly, SameSite=Lax cookie scoped to `/api/downloads` for 12 hours. Production
cookies are Secure. Validation is same-origin, size-limited, time-limited and
rate-limited. Invalid/replayed/expired tokens never grant access. Every authorized
file request still checks the current catalog, so CAPTCHA does not bypass removals.

Configure the following **runtime environment variables on both Dokploy apps**
(`dokploy.cleartextlabs.com` and `dokploy2.cleartextlabs.com`), with identical values:

- `TURNSTILE_SITE_KEY`: widget site key; public in the widget only.
- `TURNSTILE_SECRET_KEY`: private Siteverify key; never sent to the client.
- `DOWNLOAD_SESSION_SECRET`: independently generated secret of at least 32
  characters, shared across replicas so downloads can resume through either app.
  Generate with `openssl rand -hex 32`; preserve it across deploys. Rotation revokes
  all existing download grants.

The compose file passes these through at runtime. Missing configuration disables
downloads rather than skipping CAPTCHA. Production rejects Cloudflare test keys
and ignores `TURNSTILE_TEST_MODE`. Restrict the widget to `911records.nyc` in
Cloudflare. No secret belongs in committed files or release notes.

Local preview only: set `TURNSTILE_TEST_MODE=1` plus a local session secret to use
Cloudflare's official test widget/verification credentials. The page explicitly
labels test mode; test grants are signed with a separate audience and cannot be
accepted in production even if the signing secret is accidentally shared. The
widget's script loads directly from `challenges.cloudflare.com`. Do not proxy it.
Production testing must use the real domain, not a production widget restricted
to a different hostname. Verification failures should be retried through the
widget, never by accepting arbitrary client-side success.

Clients that fetch inventories programmatically now need the verification cookie
as well. The browser can fetch all boxes and resume range downloads during the
12-hour grant; after expiry, complete another challenge. In-flight responses are
not interrupted when the grant expires. Cloudflare's processing and the essential
cookie are described on `/privacy`.

Implementation references:
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- https://developers.cloudflare.com/turnstile/troubleshooting/testing/
