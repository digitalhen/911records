#!/usr/bin/env bash
# loop.sh — keep text, page embeddings and entities current while the mirror downloads.
#
# Every INTERVAL seconds (default 1200): extract_text.mjs --jobs 2 → embed/pages.py → embed/entities.py.
# Each stage is incremental, so a cycle over nothing new takes seconds. Local only: none of these
# stages contacts the portal (download.mjs, owned by the mirror, is the only thing that does).
#
# One instance at a time: an atomic mkdir lock at data/embed/loop.lock (holds the pid). A stale
# lock whose pid is gone is reclaimed. Stops on its own when the download has finished AND a
# cycle found nothing new. Log: data/embed/loop.log.
#
# Usage: scripts/embed/loop.sh [INTERVAL_SECONDS]        (run with nohup / in the background)
set -uo pipefail
cd "$(dirname "$0")/../.."
INTERVAL="${1:-1200}"
LOCK=data/embed/loop.lock
LOG=data/embed/loop.log
mkdir -p data/embed

if ! mkdir "$LOCK" 2>/dev/null; then
  old=$(cat "$LOCK/pid" 2>/dev/null || echo "")
  if [ -n "$old" ] && ps -p "$old" >/dev/null 2>&1; then
    echo "loop.sh: another loop (pid $old) holds $LOCK; exiting" >&2; exit 1
  fi
  echo "$(date -u +%FT%TZ) reclaiming stale lock (pid ${old:-?})" >> "$LOG"
  rm -rf "$LOCK"; mkdir "$LOCK" || exit 1
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM HUP

log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
log "start pid $$ interval ${INTERVAL}s"

while true; do
  before=$(find data/text -name '*.pages.jsonl' 2>/dev/null | wc -l | tr -d ' ')
  ext=$(node scripts/extract_text.mjs --jobs 2 2>&1 | tail -1)
  log "extract: $ext"
  after=$(find data/text -name '*.pages.jsonl' 2>/dev/null | wc -l | tr -d ' ')
  log "pages.py: $(.venv/bin/python scripts/embed/pages.py 2>&1 | tail -1)"
  ent=$(.venv/bin/python scripts/embed/entities.py 2>&1 | grep -E '"run"' -A3 | tr -d '\n' | tr -s ' ')
  log "entities.py: $ent"
  status=$(python3 -c "import json;print(json.load(open('data/download.progress.json')).get('status',''))" 2>/dev/null || echo "")
  log "text docs $before -> $after; download status: ${status:-unknown}"
  if [ "$status" = "finished" ] || [ "$status" = "done" ] || [ "$status" = "complete" ]; then
    if [ "$before" = "$after" ]; then log "download finished and nothing new; exiting"; exit 0; fi
  fi
  sleep "$INTERVAL"
done
