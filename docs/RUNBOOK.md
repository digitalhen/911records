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

Order: `enumerate.mjs` (catalog snapshot + manifest) → `diff_catalog.mjs` (writes the
`data/catalog/diff-<A>-to-<B>.json` report `changes` is built from) → `download.mjs` (skipped, with
a log line, if `data/download.pid` names a live process, or with `--no-download`) → one cycle's
worth of `scripts/embed/loop.sh`'s stages — `extract_text.mjs`, then (once A1 lands them)
`render_pages.mjs` and `ocr_pages.py`, then `pages.py`, `entities.py` — skipped, with a log line,
if `loop.sh`'s own lock (`data/embed/loop.lock`) is held by a live process, since loop.sh is
already running them on its own interval and refresh_daily.sh has no reason to race it → **`
build_site_db.py`** → **`load_site_pg.py`** (loads `site.sqlite` into the central Postgres) →
**`opensearch.py setup` + `index`**.

Flags:
- `--index-only` — skip everything through the loop cycle; just rebuild `site.sqlite`, load
  Postgres and (re)index OpenSearch. Use this for a fresh deploy, after fixing a loading/indexing
  bug, or to point a new OpenSearch node or Postgres at data that's already on disk. It never
  touches the portal.
- `--no-download` — run the catalog/loop/build/load/index stages but skip the PDF download.

Any failed stage stops the run immediately (non-zero exit); `refresh_daily.sh` does not continue
past a failure, so the log always ends with either `done` or a `FAILED` line naming the stage.

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
`data/text/**/<bates>.ocr.jsonl` when `site.sqlite` says that page's `ocr_status='empty'` and an
OCR line exists for it (`source='ours'`). `site.sqlite` itself carries no page text — the app
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
