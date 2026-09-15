#!/bin/bash
# Titles and summaries, end to end, on the local qwen model — runs on its own, no LLM session needed.
#
#   scripts/embed/summaries_pipeline.sh start     # run every remaining stage, detached (survives closing the terminal)
#   scripts/embed/summaries_pipeline.sh status    # what stage is running, counts, last log lines
#   scripts/embed/summaries_pipeline.sh stop      # stop cleanly (progress is checkpointed; `start` resumes)
#   scripts/embed/summaries_pipeline.sh run       # same as start but in the foreground (for a terminal you keep open)
#
# Stages, each resumable and skipped when already complete:
#   1. summarise   every untitled document, and every document whose title was written by Haiku,
#                  through qwen3.5:35b-a3b via Ollama — one worker, batches of 20 (summaries.py)
#   2. publish     rebuild the site database and search index (refresh_daily.sh --no-download)
#   3. qa-screen   heuristic flags over every title (summaries_qa.py screen)
#   4. qa-review   qwen reads each document's text next to its title and fixes poor ones (summaries_qa.py review)
#   5. qa-apply    write accepted fixes + docs/eval/summaries-qa-report.md (summaries_qa.py apply)
#   6. publish     again
#
# Rules it enforces (Henry, 2026-09-14): one Ollama consumer at a time (lock file + refuses to start while
# another summaries process runs), a memory watchdog that stops the model stage if free memory drops under
# 8% (start again later — nothing is lost), and caffeinate so the Mac does not sleep mid-run.
# Log: data/embed/logs/summaries-pipeline.log   State: data/embed/logs/summaries-pipeline.state
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/bin:$PATH"
export SUMMARIES_BACKEND=ollama SUMMARIES_OLLAMA_MODEL="${SUMMARIES_OLLAMA_MODEL:-qwen3.5:35b-a3b}" SUMMARIES_BATCH="${SUMMARIES_BATCH:-20}"
LOGDIR="$REPO/data/embed/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/summaries-pipeline.log"; STATE="$LOGDIR/summaries-pipeline.state"; LOCK="$LOGDIR/summaries-pipeline.lock"
PY="$REPO/.venv/bin/python"
MIN_FREE_PCT="${MIN_FREE_PCT:-8}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
stage_done() { grep -qx "done $1" "$STATE" 2>/dev/null; }
mark_done() { echo "done $1" >> "$STATE"; }
other_running() { pgrep -f "scripts/embed/summaries(_qa)?\.py" >/dev/null 2>&1; }

# Run a model stage under the memory watchdog. Returns the stage's exit code; 99 if the watchdog stopped it.
guarded() {
  "$@" >> "$LOG" 2>&1 & local pid=$!
  local stopped=0
  while kill -0 "$pid" 2>/dev/null; do
    local pct; pct=$(memory_pressure 2>/dev/null | awk -F': ' '/free percentage/{gsub(/%/,"",$2); print $2}')
    if [ -n "$pct" ] && [ "$pct" -lt "$MIN_FREE_PCT" ]; then
      log "MEMORY LOW (${pct}% free): stopping the model stage; run 'start' again later, it resumes"
      kill "$pid"; stopped=1; break
    fi
    sleep 30
  done
  wait "$pid"; local rc=$?
  [ "$stopped" = 1 ] && return 99
  return $rc
}

count_titles() {
  "$PY" - <<'EOF' 2>/dev/null
import json
from pathlib import Path
p = Path("data/embed/p5-summaries.jsonl")
rows = [json.loads(l) for l in p.open()] if p.exists() else []
titled = sum(1 for r in rows if r.get("title"))
haiku = sum(1 for r in rows if r.get("title") and str(r.get("model") or "").startswith("claude"))
qwen = sum(1 for r in rows if r.get("title") and str(r.get("model") or "").startswith("qwen"))
print(f"documents {len(rows)}: titled {titled}, untitled {len(rows)-titled}, by qwen {qwen}, still by Haiku {haiku}")
q = Path("data/embed/p5-summaries-qa.jsonl")
if q.exists():
    from collections import Counter
    recs = [json.loads(l) for l in q.open()]
    v = Counter(r.get("verdict") or "not reviewed" for r in recs)
    print("quality review: " + ", ".join(f"{k} {n}" for k, n in v.most_common()))
EOF
}

run_pipeline() {
  if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
    echo "already running (pid $(cat "$LOCK")); use 'status' or 'stop'"; exit 1
  fi
  if other_running; then
    echo "another summaries process is running outside this pipeline (one Ollama job at a time):"; pgrep -fl "scripts/embed/summaries(_qa)?\.py"; exit 1
  fi
  echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
  [ -f data/host.env ] && { set -a; . data/host.env; set +a; }
  log "== pipeline start (pid $$) =="

  if ! stage_done summarise; then
    log "-- 1/6 summarise: untitled + Haiku rows through $SUMMARIES_OLLAMA_MODEL --"
    guarded "$PY" -u scripts/embed/summaries.py --workers 1 --redo-models claude,none; rc=$?
    if [ $rc -ne 0 ]; then log "summarise stopped (exit $rc); run 'start' again to resume"; exit $rc; fi
    mark_done summarise; log "summarise complete: $(count_titles | head -1)"
  fi
  if ! stage_done publish1; then
    log "-- 2/6 publish --"
    scripts/refresh_daily.sh --no-download >> "$LOG" 2>&1 && mark_done publish1 || { log "publish failed (see above); fix and run 'start' again"; exit 1; }
  fi
  if ! stage_done qa-screen; then
    log "-- 3/6 qa-screen --"
    "$PY" -u scripts/embed/summaries_qa.py screen >> "$LOG" 2>&1 && mark_done qa-screen || { log "qa-screen failed"; exit 1; }
  fi
  if ! stage_done qa-review; then
    log "-- 4/6 qa-review: every title read against its page text --"
    guarded "$PY" -u scripts/embed/summaries_qa.py review; rc=$?
    if [ $rc -ne 0 ]; then log "qa-review stopped (exit $rc); run 'start' again to resume"; exit $rc; fi
    mark_done qa-review
  fi
  if ! stage_done qa-apply; then
    log "-- 5/6 qa-apply --"
    "$PY" -u scripts/embed/summaries_qa.py apply >> "$LOG" 2>&1 && mark_done qa-apply || { log "qa-apply failed"; exit 1; }
  fi
  if ! stage_done publish2; then
    log "-- 6/6 publish --"
    scripts/refresh_daily.sh --no-download >> "$LOG" 2>&1 && mark_done publish2 || { log "publish failed; fix and run 'start' again"; exit 1; }
  fi
  log "== pipeline complete: $(count_titles | tr '\n' ' ') =="
}

case "${1:-}" in
  run) run_pipeline ;;
  start)
    if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then echo "already running (pid $(cat "$LOCK"))"; exit 1; fi
    (nohup caffeinate -i "$0" run > /dev/null 2>&1 &)
    sleep 2; echo "started; follow with: scripts/embed/summaries_pipeline.sh status   (log: $LOG)" ;;
  stop)
    if [ -e "$LOCK" ]; then pid=$(cat "$LOCK"); pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; fi
    pkill -f "scripts/embed/summaries(_qa)?\.py" 2>/dev/null; sleep 2; rm -f "$LOCK"
    echo "stopped; progress is checkpointed — 'start' resumes" ;;
  status)
    if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then echo "RUNNING (pid $(cat "$LOCK"))"; else echo "not running"; fi
    echo "stages done: $([ -f "$STATE" ] && tr '\n' ' ' < "$STATE")"
    count_titles
    echo "memory free: $(memory_pressure 2>/dev/null | awk -F': ' '/free percentage/{print $2}')"
    echo "-- last log lines --"; tail -n 6 "$LOG" 2>/dev/null | cut -c1-160 ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
