#!/usr/bin/env bash
# refresh_daily.sh — the daily cadence, end to end: catalog snapshot -> diff -> download ->
# one embedding-loop cycle -> site.sqlite -> OpenSearch index.
#
# Order:
#   1. enumerate.mjs        snapshot + diff + rebuild manifest.jsonl (contacts the portal)
#   2. diff_catalog.mjs     writes the full data/catalog/diff-<A>-to-<B>.json report
#   3. download.mjs         mirror new/changed PDFs (contacts the portal); SKIPPED if
#                           data/download.pid names a live process, or with --no-download
#   4. extract -> render -> fallback OCR -> 300-DPI Vision + Tesseract review -> embeddings
#      and entities. The ingestion lock is held through publication; overlapping runs stop.
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
#   --reprocess-all-ocr  compare every unreviewed PDF page, then refresh derived data and publish.
#   --publish-only  resume database/index publication from completed derived data; no model calls.
#   --reprocess-ocr DIR  apply staged OCR with backups, then rerun embeddings, tagging
#                        and all publication stages without contacting the City portal.
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
# Usage: scripts/refresh_daily.sh [--index-only | --publish-only | --reprocess-ocr DIR | --reprocess-all-ocr] [--no-download]
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
PUBLISH_ONLY=false
FULL_OCR=false
NO_DOWNLOAD=false
REPROCESS_OCR=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --index-only) INDEX_ONLY=true ;;
    --publish-only) INDEX_ONLY=true; PUBLISH_ONLY=true ;;
    --reprocess-all-ocr) FULL_OCR=true ;;
    --no-download) NO_DOWNLOAD=true ;;
    --reprocess-ocr)
      [ "$#" -ge 2 ] || { echo "--reprocess-ocr requires a staged directory" >&2; exit 64; }
      REPROCESS_OCR="$2"; shift ;;
    *) echo "refresh_daily.sh: unknown flag $1" >&2; exit 64 ;;
  esac
  shift
done

if { $FULL_OCR && { $INDEX_ONLY || [ -n "$REPROCESS_OCR" ]; }; } || { [ -n "$REPROCESS_OCR" ] && $INDEX_ONLY; }; then
  echo "Choose only one refresh mode" >&2; exit 64
fi

# Bulk OCR processing needs more time for changed summaries and facts than a daily increment.
if [ -n "$REPROCESS_OCR" ] || $FULL_OCR; then
  SOFT_STAGE_SECS="${SOFT_STAGE_SECS:-7200}"
fi

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

log "start pid $$ index_only=$INDEX_ONLY no_download=$NO_DOWNLOAD publish_only=$PUBLISH_ONLY"

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

# Hold both scheduler locks throughout application and all derived-data stages.
mkdir -p data/embed
loop_lock=data/embed/loop.lock
if [ -e "$loop_lock/pid" ] && pid_is_live "$loop_lock/pid"; then
  log "cannot refresh while another ingestion process is active"; exit 1
fi
if [ -d "$loop_lock" ]; then
  [ -s "$loop_lock/pid" ] || { log "ingestion lock has no owner; inspect before retrying"; exit 1; }
  rm -rf "$loop_lock"
fi
mkdir "$loop_lock" || exit 1
echo $$ > "$loop_lock/pid"
trap 'rm -rf "$LOCK" "$loop_lock"' EXIT INT TERM HUP

# Model inference (embeddings, summaries, facts, topic naming, canonicalisation) runs on the PC's
# GPU, not this Mac (Henry, 2026-11-21: a local qwen run maxed the Mac and filled swap). Every
# stage reaches Ollama through scripts/embed/llm.py, which honours OLLAMA_URL/EMBED_URL. If the PC
# can't be reached the run stops: the site keeps serving yesterday's data rather than loading the
# Mac. PC_OLLAMA=0 opts out (runs against the Mac's Ollama). We suspend the PC afterwards only
# if we were the ones who woke it, so a PC someone is using stays on. Called just before the first
# model stage (idempotent), so a run that has nothing to do never wakes the PC.
pc_ready=false
use_pc() {
  $pc_ready && return 0
  [ "${PC_OLLAMA:-1}" = 0 ] && { pc_ready=true; log "PC_OLLAMA=0: model inference on this Mac"; return 0; }
  local pc_was_up=false
  scripts/pc.sh status 2>/dev/null | grep -q '^ollama: {' && pc_was_up=true
  if ! scripts/pc.sh wake >> "$LOG" 2>&1; then log "PC Ollama unreachable; stopping (PC_OLLAMA=0 to run on the Mac)"; exit 1; fi
  scripts/pc.sh hold >> "$LOG" 2>&1
  local url; url=$(scripts/pc.sh url 2>>"$LOG") || { log "PC Ollama unreachable (no LAN or tunnel); stopping"; exit 1; }
  export OLLAMA_URL="$url" EMBED_URL="$url"
  log "model inference on PC: $OLLAMA_URL (pc_was_up=$pc_was_up)"
  if $pc_was_up; then pc_done='scripts/pc.sh release'; else pc_done='scripts/pc.sh sleep'; fi
  trap 'rm -rf "$LOCK" "$loop_lock"; $pc_done >> "$LOG" 2>&1' EXIT INT TERM HUP
  pc_ready=true
}

if [ -n "$REPROCESS_OCR" ] || $PUBLISH_ONLY || $FULL_OCR; then
  if $FULL_OCR; then
    run_stage extract_text node scripts/extract_text.mjs --jobs 2
    run_stage render_pages node scripts/render_pages.mjs --jobs 3 --max-seconds 900
    run_stage ocr_pages .venv/bin/python scripts/embed/ocr_pages.py
    run_stage ocr_auto .venv/bin/python scripts/embed/ocr_auto.py --lock-owner "$$" --drain
  elif ! $PUBLISH_ONLY; then
    run_stage ocr_finalize .venv/bin/python scripts/eval/ocr_finalize.py --staged "$REPROCESS_OCR"
    run_stage ocr_backup .venv/bin/python scripts/eval/ocr_backup.py --out "$REPROCESS_OCR/../backup"
    run_stage ocr_apply .venv/bin/python scripts/eval/ocr_apply.py --staged "$REPROCESS_OCR" --backup "$REPROCESS_OCR/../backup"
  fi
  if ! $PUBLISH_ONLY; then
    use_pc
    run_stage pages_py .venv/bin/python scripts/embed/pages.py
    run_stage entities_py .venv/bin/python scripts/embed/entities.py
    run_stage canonicalise .venv/bin/python scripts/embed/entities.py --canonicalise --llm
  fi
elif ! $INDEX_ONLY; then
  run_stage enumerate node scripts/enumerate.mjs
  run_stage diff_catalog node scripts/diff_catalog.mjs

  # Nothing new from the City portal -> nothing to do (Henry, 2026-11-21: the catalog sat unchanged
  # 2026-11-05..19 yet every day re-ran ~1.5 h of OCR, model and publication stages). A model
  # backlog (summaries/facts) is drained by a deliberate run, e.g. `--no-download`, not daily.
  # FORCE_REFRESH=1 runs the full pipeline anyway.
  latest_diff=$(ls -t data/catalog/diff-*.json 2>/dev/null | head -1)
  changes=$( [ -n "$latest_diff" ] && python3 -c 'import json,sys; c=json.load(open(sys.argv[1]))["counts"]; print(c["added"]+c["removed"]+c["changed"])' "$latest_diff" 2>/dev/null || echo unknown)
  # data/catalog/unpublished marks changes a run picked up but never published (a later stage
  # failed). The next day's diff is against that day's snapshot, so it shows 0 changes; without
  # the marker the skip above would drop those documents for good (2026-11-22: 818 new
  # documents, pages_py failed, 11-23 and 11-24 skipped). Cleared only by a full run's "done".
  if [ "$changes" = 0 ] && [ "${FORCE_REFRESH:-0}" != 1 ] && [ ! -e data/catalog/unpublished ]; then
    log "no catalog changes ($(basename "$latest_diff")); nothing to do"
    log "done"
    exit 0
  fi
  if [ -e data/catalog/unpublished ]; then
    log "unpublished changes from an earlier run: $(cat data/catalog/unpublished)"
  fi
  [ "$changes" != 0 ] && echo "$(basename "${latest_diff:-none}") ($changes)" >> data/catalog/unpublished
  log "catalog changes: $changes ($(basename "${latest_diff:-none}"))"

  if pid_is_live data/download.pid; then
    log "skip download: data/download.pid live (pid $(cat data/download.pid))"
  elif $NO_DOWNLOAD; then
    log "skip download: --no-download"
  else
    run_stage download node scripts/download.mjs
  fi

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
  run_stage ocr_auto .venv/bin/python scripts/embed/ocr_auto.py --lock-owner "$$"
  use_pc
  run_stage pages_py .venv/bin/python scripts/embed/pages.py
  run_stage entities_py .venv/bin/python scripts/embed/entities.py
  run_stage canonicalise .venv/bin/python scripts/embed/entities.py --canonicalise --llm

else
  log "--index-only: skipping enumerate/diff/download/loop-cycle stages"
fi

# Summaries and facts run on OpenAI's cheapest model (Henry, 2026-11-21: "cheapest model"; tested:
# gpt-5-nano with minimal reasoning, ~$0.08 per 1,000 summaries, 96% accepted by the name filter).
# The key lives outside the repo in ~/openai.key. Without it they fall back to Ollama (the PC).
if [ -z "${OPENAI_API_KEY:-}" ] && [ -s "$HOME/openai.key" ]; then export OPENAI_API_KEY="$(tr -d '\n\r ' < "$HOME/openai.key")"; fi
if [ -n "${OPENAI_API_KEY:-}" ]; then
  : "${LLM_PROVIDER:=openai}"
  export SUMMARIES_LLM_MODEL="${SUMMARIES_LLM_MODEL:-gpt-5-nano}" FACTS_LLM_MODEL="${FACTS_LLM_MODEL:-gpt-5-nano}"
  export LLM_REASONING_EFFORT="${LLM_REASONING_EFFORT:-minimal}"
  export SUMMARIES_PRICE_IN_PER_MTOK=0.05 SUMMARIES_PRICE_OUT_PER_MTOK=0.40 FACTS_PRICE_IN_PER_MTOK=0.05 FACTS_PRICE_OUT_PER_MTOK=0.40
fi

# The publication-only suggestion checks can also need the model credential.
if [ -f .claudekey ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then export ANTHROPIC_API_KEY="$(tr -d '\n\r ' < .claudekey)"; fi

if ! $PUBLISH_ONLY; then
# Discovery layer: document vectors, related records, near-duplicates (related.py), then the
# human-readable topic hierarchy (topics.py, named by the local qwen model via Ollama since
# 2026-11-05, cached), then buildings/places for the map. All local except the topic naming calls.
# Document types first: topics.py gives doctypes.py's lab_count_sheet records their own topic.
use_pc
run_stage doctypes_py .venv/bin/python scripts/embed/doctypes.py
run_stage related_py .venv/bin/python scripts/embed/related.py
run_stage topics_py .venv/bin/python scripts/embed/topics.py --write-to data/embed/related-topics.sqlite
run_stage places_py .venv/bin/python scripts/embed/places.py
# Model-dependent stages: non-fatal — a model outage or API usage cap must not stop the site build.
# Summaries run on the local qwen model via Ollama, one worker (Henry, 2026-09-14: "skip haiku
# entirely, do it all in qwen"); the daily increment is small enough for the time box below.
summary_scope=""
if [ -n "$REPROCESS_OCR" ] || $FULL_OCR; then summary_scope="--changed-only"; fi
for soft in "summaries_py env SUMMARIES_BACKEND=${SUMMARIES_BACKEND:-${LLM_PROVIDER:-ollama}} SUMMARIES_BATCH=20 .venv/bin/python scripts/embed/summaries.py --workers 1 $summary_scope" "facts_py env FACTS_BACKEND=${FACTS_BACKEND:-${LLM_PROVIDER:-ollama}} FACTS_MAX_SECONDS=${SOFT_STAGE_SECS:-3600} .venv/bin/python scripts/embed/facts.py"; do
  set -- $soft; name=$1; shift
  log "== $name (non-fatal): $* =="
  # Time-boxed (SOFT_STAGE_SECS, default 3600 s): a capped API made summaries.py retry for ages.
  # 900 s was too short once the summary backlog grew (every daily run timed out from 2026-10-12);
  # an hour per stage still ends a 03:30 run well before morning. Unfinished work resumes next day.
  # facts.py also gets the time box itself (FACTS_MAX_SECONDS) and stops its model calls 10 min early,
  # so it always writes its outputs; the kill below is only a backstop.
  "$@" >> "$LOG" 2>&1 & soft_pid=$!
  ( sleep "${SOFT_STAGE_SECS:-3600}"; kill "$soft_pid" 2>/dev/null ) & watchdog=$!
  if wait "$soft_pid"; then log "-- $name ok --"; else log "-- $name FAILED or timed out (exit $?) -- non-fatal, continuing"; fi
  kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null
done
fi
run_stage build_site_db .venv/bin/python scripts/embed/build_site_db.py --related data/embed/related-topics.sqlite
run_stage load_site_pg .venv/bin/python scripts/embed/load_site_pg.py
# Publishing the catalog first immediately invalidates old downloads, including withdrawals.
# Only complete ZIP sets become available; a failed build leaves downloads unavailable.
run_stage build_downloads .venv/bin/python scripts/downloads/build.py
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

# Everything through publication succeeded: the catalog changes picked up so far are live.
$INDEX_ONLY || rm -f data/catalog/unpublished
log "done"
