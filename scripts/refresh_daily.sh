#!/usr/bin/env bash
# refresh_daily.sh — the daily cadence, end to end: catalog snapshot -> diff -> download ->
# one embedding-loop cycle -> site.sqlite -> OpenSearch index.
#
# Order:
#   1. enumerate.mjs        snapshot + diff + rebuild manifest.jsonl (contacts the portal)
#   2. diff_catalog.mjs     writes the full data/catalog/diff-<A>-to-<B>.json report
#   3. download.mjs         mirror new/changed PDFs (contacts the portal); SKIPPED if
#                           data/download.pid names a live process, or with --no-download
#   4. one loop.sh cycle's worth of stages (extract_text.mjs, and — once A1 lands them —
#      render_pages.mjs and ocr_pages.py — then pages.py, entities.py); SKIPPED if
#      scripts/embed/loop.sh's own lock (data/embed/loop.lock) is held by a live process —
#      loop.sh is already running these on its own interval, so refresh_daily.sh just logs
#      and moves on rather than racing it
#   5. build_site_db.py     data/site/site.sqlite (build-then-swap)
#   6. load_site_pg.py      the same tables, plus page_text, into the central Postgres (the app is
#                           HA across two hosts, so site.sqlite alone isn't enough for it to read —
#                           schema-level build-then-swap, into `site_new` then swapped for `site`)
#   7. opensearch.py setup + index
#   8. suggestions:check    (B15) every suggested question/search the app can show still returns
#                           results against the just-refreshed index/db — NON-FATAL: logged, never
#                           stops the run (data growth changing what a suggestion returns is a
#                           product bug to notice, not a reason to fail the whole day's refresh)
#
# Flags:
#   --index-only    skip 1-4; just rebuild site.sqlite, load Postgres and (re)index OpenSearch —
#                   for a fresh deploy, or after fixing an indexing/loading bug, without touching
#                   the portal or the embedding pipeline
#   --no-download   run 1, 2, 4-7 but skip 3 (e.g. the mirror is already fully downloaded for the
#                   day, or you want catalog/entities/site/index refreshed without a fetch)
#
# One instance at a time: an atomic mkdir lock at data/refresh.lock (holds the pid), reclaimed
# if stale, same pattern as scripts/embed/loop.sh. Logs to data/refresh.log with UTC timestamps.
# Exits non-zero (and stops immediately) on the first failed stage.
#
# Env passed through to the stages it runs: OPENSEARCH_URL, OPENSEARCH_USER, OPENSEARCH_PASSWORD
# (opensearch.py); PGHOST, PGPORT, PGUSER, PGDATABASE (load_site_pg.py — default the central
# Homebrew Postgres at 127.0.0.1:5433, database sept11, user sept11; the password always comes
# from ~/.pgpass via libpq, never from an env var or a file in this repo). OLLAMA_URL-equivalent
# is hardcoded to localhost in pages.py/opensearch.py today.
#
# Stage 8's env is resolved differently, because it runs the web app's own lib/ code (web/lib/db.ts,
# web/lib/opensearch.ts), which speaks a single DATABASE_URL/DATABASE_READ_URL connection string,
# not the pipeline's PGHOST/PGPORT/PGUSER/PGDATABASE — this script builds that URL from the same
# PG* vars/defaults used above, with NO password in it, so node-postgres falls through to the same
# ~/.pgpass lookup libpq uses (matched by host:port:database:user — see client.js's pgpass call);
# nothing here reads or writes a password. OPENSEARCH_* pass through unchanged (same var names on
# both sides). ANTHROPIC_API_KEY is whatever's already exported below for topics.py (from
# .claudekey, if present) — suggestions:check simply skips its model-path checks when unset.
#
# Usage: scripts/refresh_daily.sh [--index-only] [--no-download]
#        (launchd plist: docs/launchd/nyc.911records.refresh.plist, installed per docs/RUNBOOK.md)
set -uo pipefail
cd "$(dirname "$0")/.."
# cron runs with a bare PATH (node/npm/psql live under Homebrew); the first cron run failed with exit 127.
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/bin:$PATH"
# Host service credentials (OpenSearch basic auth for docker-compose.host.yml); gitignored under data/.
if [ -f data/host.env ]; then set -a; . data/host.env; set +a; fi

LOG=data/refresh.log
LOCK=data/refresh.lock
INDEX_ONLY=false
NO_DOWNLOAD=false
for a in "$@"; do
  case "$a" in
    --index-only) INDEX_ONLY=true ;;
    --no-download) NO_DOWNLOAD=true ;;
    *) echo "refresh_daily.sh: unknown flag $a" >&2; exit 64 ;;
  esac
done

mkdir -p data
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

if ! mkdir "$LOCK" 2>/dev/null; then
  old=$(cat "$LOCK/pid" 2>/dev/null || echo "")
  if [ -n "$old" ] && ps -p "$old" >/dev/null 2>&1; then
    log "another refresh (pid $old) holds $LOCK; exiting"
    exit 1
  fi
  log "reclaiming stale lock (pid ${old:-?})"
  rm -rf "$LOCK"
  mkdir "$LOCK" || { log "could not acquire $LOCK"; exit 1; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM HUP

log "start pid $$ index_only=$INDEX_ONLY no_download=$NO_DOWNLOAD"

pid_is_live() { [ -f "$1" ] && ps -p "$(cat "$1" 2>/dev/null)" >/dev/null 2>&1; }

# Runs one stage, appending its output to $LOG between timestamped markers. Exits the whole
# script (non-zero) on the first failure, after removing the lock (the EXIT trap does that).
run_stage() {
  local name="$1"; shift
  log "== $name: $* =="
  if "$@" >> "$LOG" 2>&1; then
    log "-- $name ok --"
  else
    local rc=$?
    log "-- $name FAILED (exit $rc) --"
    exit "$rc"
  fi
}

if ! $INDEX_ONLY; then
  run_stage enumerate node scripts/enumerate.mjs
  run_stage diff_catalog node scripts/diff_catalog.mjs

  if pid_is_live data/download.pid; then
    log "skip download: data/download.pid live (pid $(cat data/download.pid))"
  elif $NO_DOWNLOAD; then
    log "skip download: --no-download"
  else
    run_stage download node scripts/download.mjs
  fi

  if pid_is_live data/embed/loop.lock/pid; then
    log "skip loop-cycle stages: scripts/embed/loop.sh lock held (pid $(cat data/embed/loop.lock/pid)); it runs these on its own interval"
  else
    run_stage extract_text node scripts/extract_text.mjs --jobs 2
    if [ -f scripts/render_pages.mjs ]; then
      run_stage render_pages node scripts/render_pages.mjs --jobs 3 --max-seconds 900
    else
      log "skip render_pages: scripts/render_pages.mjs not present yet (A1)"
    fi
    if [ -f scripts/embed/ocr_pages.py ]; then
      run_stage ocr_pages .venv/bin/python scripts/embed/ocr_pages.py
    else
      log "skip ocr_pages: scripts/embed/ocr_pages.py not present yet (A1)"
    fi
    run_stage pages_py .venv/bin/python scripts/embed/pages.py
    run_stage entities_py .venv/bin/python scripts/embed/entities.py
    run_stage canonicalise .venv/bin/python scripts/embed/entities.py --canonicalise --llm
  fi
else
  log "--index-only: skipping enumerate/diff/download/loop-cycle stages"
fi

# Discovery layer: document vectors, related records, near-duplicates (related.py), then the
# human-readable topic hierarchy (topics.py, Haiku-named, cached; needs ANTHROPIC_API_KEY from
# .claudekey), then buildings/places for the map. All local except the topic naming calls.
if [ -f .claudekey ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then export ANTHROPIC_API_KEY="$(tr -d '\n\r ' < .claudekey)"; fi
run_stage related_py .venv/bin/python scripts/embed/related.py
run_stage topics_py .venv/bin/python scripts/embed/topics.py --write-to data/embed/related-topics.sqlite
run_stage places_py .venv/bin/python scripts/embed/places.py
run_stage doctypes_py .venv/bin/python scripts/embed/doctypes.py
run_stage summaries_py .venv/bin/python scripts/embed/summaries.py
run_stage build_site_db .venv/bin/python scripts/embed/build_site_db.py --related data/embed/related-topics.sqlite
run_stage load_site_pg .venv/bin/python scripts/embed/load_site_pg.py
run_stage opensearch_setup .venv/bin/python scripts/search/opensearch.py setup
run_stage opensearch_index .venv/bin/python scripts/search/opensearch.py index

# Stage 8 (B15) — non-fatal by design: see the header comment above `run_stage`'s definition and
# the env-resolution note near the top of this file. Never uses run_stage, which would exit the
# whole script on failure; a suggestion going stale after today's data growth is worth noticing in
# the log, not worth failing the day's refresh over.
log "== suggestions_check: npm run suggestions:check =="
db_url="postgres://${PGUSER:-sept11}@${PGHOST:-127.0.0.1}:${PGPORT:-5433}/${PGDATABASE:-sept11}"
if (cd web && DATABASE_URL="$db_url" DATABASE_READ_URL="$db_url" npm run suggestions:check) >> "$LOG" 2>&1; then
  log "-- suggestions_check ok --"
else
  rc=$?
  log "-- suggestions_check FAILED (exit $rc) -- non-fatal, continuing (see the table above in this log)"
fi

# Stage 9 (B22, "What others are reading", issue #36) — non-fatal, same reasoning and env
# resolution as suggestions_check above: a stale reading-seed list is worth noticing, not worth
# failing the day's refresh over.
log "== seed_reading: npm run seed:reading -- --refresh =="
if (cd web && DATABASE_URL="$db_url" DATABASE_READ_URL="$db_url" npm run seed:reading -- --refresh) >> "$LOG" 2>&1; then
  log "-- seed_reading ok --"
else
  rc=$?
  log "-- seed_reading FAILED (exit $rc) -- non-fatal, continuing (see the table above in this log)"
fi

log "done"
