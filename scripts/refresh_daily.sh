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
# Usage: scripts/refresh_daily.sh [--index-only] [--no-download]
#        (launchd plist: docs/launchd/nyc.911records.refresh.plist, installed per docs/RUNBOOK.md)
set -uo pipefail
cd "$(dirname "$0")/.."

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
  fi
else
  log "--index-only: skipping enumerate/diff/download/loop-cycle stages"
fi

run_stage build_site_db .venv/bin/python scripts/embed/build_site_db.py
run_stage load_site_pg .venv/bin/python scripts/embed/load_site_pg.py
run_stage opensearch_setup .venv/bin/python scripts/search/opensearch.py setup
run_stage opensearch_index .venv/bin/python scripts/search/opensearch.py index

log "done"
