#!/usr/bin/env bash
# publish_seed.sh — maintainer job: add this week's new and changed data to the seed and upload it
# to Google Drive, so new and existing deployments pick it up (sync_seed.sh / fetch_seed.py).
#
#   scripts/seed/publish_seed.sh            # run from cron (weekly; see docs/SELF-HOSTING.md)
#
# Takes the daily refresh's lock (data/refresh.lock) so it never packs half-written data, waiting
# up to SEED_LOCK_WAIT_MIN (default 240) minutes for a running refresh to finish. Then
# pack_seed.py --update (new update shards + a fresh core) and `rclone copy` (uploads only what is
# new or changed; never deletes on Drive).
#
# Env: SEED_DIR (default ~/911records-seed, must hold the full seed packed earlier),
#      SEED_REMOTE (default gdrive:911records-seed), RCLONE (default: rclone on PATH).
set -uo pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SEED_DIR="${SEED_DIR:-$HOME/911records-seed}"
REMOTE="${SEED_REMOTE:-gdrive:911records-seed}"
RCLONE="${RCLONE:-rclone}"
PY="$([ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)"
LOCK=data/refresh.lock
log() { echo "$(date -u +%FT%TZ) publish_seed: $*"; }

[ -f "$SEED_DIR/SEED-MANIFEST.json" ] || { log "no seed in $SEED_DIR; pack the full seed first"; exit 1; }

waited=0
until mkdir "$LOCK" 2>/dev/null; do
  pid=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    log "removing stale lock (pid $pid)"; rm -rf "$LOCK"; continue
  fi
  if [ "$waited" -ge "${SEED_LOCK_WAIT_MIN:-240}" ]; then log "refresh still running after ${waited} min; giving up"; exit 1; fi
  sleep 60; waited=$((waited + 1))
done
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM HUP

log "packing updates into $SEED_DIR"
"$PY" scripts/seed/pack_seed.py --out "$SEED_DIR" --update || { log "pack failed"; exit 1; }
rm -rf "$LOCK"; trap - EXIT INT TERM HUP   # data no longer read; let a refresh start

log "uploading to $REMOTE"
"$RCLONE" copy "$SEED_DIR" "$REMOTE" --transfers 4 --drive-chunk-size 256M --stats-one-line --stats 5m \
  || { log "upload failed"; exit 1; }
log "done"
