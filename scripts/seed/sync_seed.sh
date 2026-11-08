#!/usr/bin/env bash
# sync_seed.sh — the `seed` service in deploy/docker-compose.yml: get the documents on first start,
# then keep them current. Runs in the pipeline image with the repo at /repo and DATA_DIR at
# /repo/data.
#
#   1. If EMBED_PROVIDER=ollama, pull the embedding model into the ollama service (once).
#   2. Fetch and extract the core and text shards from SEED_URL (only new or changed ones; see
#      fetch_seed.py), and if any arrived, or Postgres/OpenSearch are empty, run load_seed.sh.
#   3. Mark the deployment ready (data/.seed-ready): the app waits for this.
#   4. Fetch the remaining kinds (page images, PDFs). These are served straight off disk, so the
#      site is already up while they download.
#      With BUILD_DOWNLOADS=1, then build the per-box ZIP downloads (needs all PDFs on disk).
#   5. If FILES_S3 is set, copy text, page images, PDFs and downloads to that bucket in the URL
#      layout the app expects (pdf/, page/, text/, downloads/), for FILES_URL via CloudFront.
#      FILES_S3_PRUNE_LOCAL=1 then deletes the local PDFs and page images (S3 has them).
#   6. Sleep SEED_UPDATE_HOURS and repeat from 2. SEED_UPDATE_HOURS=0 stops after one pass;
#      SEED_EXIT_WHEN_DONE=1 makes it exit instead of idling (a scheduled ECS task, a cron job).
#
# Env: SEED_URL (Drive folder link, s3://bucket/prefix or https:// base URL; empty = manual mode:
#      load the data yourself, docs/SELF-HOSTING.md), SEED_KINDS (default core,text,pages,pdf;
#      core and text are always included), SEED_UPDATE_HOURS (default 24), plus the PG*,
#      OPENSEARCH_URL, OLLAMA_URL and EMBED_* the pipeline service already gets.
set -uo pipefail
cd "$(dirname "$0")/../.."
PY="${PYTHON:-python3}"
READY=data/.seed-ready
LOADED=data/.seed-loaded
SEED_URL="${SEED_URL:-}"
HOURS="${SEED_UPDATE_HOURS:-24}"
EXTRA=$(echo "${SEED_KINDS:-core,text,pages,pdf}" | tr ',' '\n' | grep -vxE 'core|text|' | paste -sd, -)
log() { echo "$(date -u +%FT%TZ) seed: $*"; }
mkdir -p data
rm -f "$READY"

if [ "${EMBED_PROVIDER:-ollama}" = ollama ]; then
  model="${EMBED_MODEL:-nomic-embed-text}"
  url="${EMBED_URL:-${OLLAMA_URL:-http://ollama:11434}}"
  for i in $(seq 1 30); do curl -fs "$url/api/tags" >/dev/null && break; sleep 5; done
  if curl -fs "$url/api/tags" | grep -q "\"$model"; then
    log "embedding model $model present"
  else
    log "pulling embedding model $model into $url"
    curl -fsS "$url/api/pull" -d "{\"model\":\"$model\",\"stream\":false}" >/dev/null \
      || log "WARNING: could not pull $model; semantic search will fall back to keyword search"
  fi
fi

# Postgres has the site schema and OpenSearch has pages: the data is actually loaded (a fresh
# database volume next to an old data dir must be reloaded).
stores_loaded() {
  "$PY" - <<'PY' 2>/dev/null
import json, os, sys, urllib.request
import psycopg
with psycopg.connect() as c:
    n = c.execute("select count(*) from information_schema.tables where table_schema='site'").fetchone()[0]
os_url = os.environ.get("OPENSEARCH_URL", "http://opensearch:9200")
req = urllib.request.Request(f"{os_url}/_cat/indices?format=json")
if os.environ.get("OPENSEARCH_USER"):
    import base64
    tok = base64.b64encode(f"{os.environ['OPENSEARCH_USER']}:{os.environ.get('OPENSEARCH_PASSWORD', '')}".encode())
    req.add_header("Authorization", f"Basic {tok.decode()}")
try:
    docs = json.load(urllib.request.urlopen(req, timeout=10))
    pages = sum(int(i.get("docs.count") or 0) for i in docs if not i["index"].startswith("."))
except Exception:
    pages = 0
sys.exit(0 if n > 0 and pages > 0 else 1)
PY
}

# Mirror the served files to S3 in the URL layout of deploy/files.nginx.conf.
publish_s3() {
  local dest="${FILES_S3%/}" rc=0
  for pair in pdf:pdf pages:page text:text downloads:downloads; do
    src="data/${pair%%:*}"; [ -d "$src" ] || continue
    log "syncing $src to $dest/${pair##*:}/"
    aws s3 sync "$src" "$dest/${pair##*:}/" --only-show-errors --exclude '.*' --exclude '*/.*' || rc=1
  done
  if [ "$rc" = 0 ] && [ "${FILES_S3_PRUNE_LOCAL:-0}" = 1 ]; then
    log "pruning local PDFs and page images (now in S3)"
    find data/pdf data/pages -type f -delete 2>/dev/null || true
  fi
  return $rc
}

# What has been loaded: the core and text shards currently unpacked.
state() { grep -E '^(core|text)-' data/.seed-unpacked 2>/dev/null | sort | sha256sum | cut -c1-16; }

while true; do
  if [ -z "$SEED_URL" ]; then
    log "SEED_URL is empty: manual mode (load a seed with scripts/seed/load_seed.sh)"
    touch "$READY"
    exec sleep infinity
  fi

  log "checking $SEED_URL for core and text shards"
  if "$PY" scripts/seed/fetch_seed.py "$SEED_URL" --extract --kinds core,text; then
    if [ "$(state)" != "$(cat "$LOADED" 2>/dev/null)" ] || ! stores_loaded; then
      log "loading Postgres and OpenSearch"
      if BUILD_DOWNLOADS=0 scripts/seed/load_seed.sh; then state > "$LOADED"; else log "load failed; will retry"; fi
    else
      log "already loaded and up to date"
    fi
  else
    log "fetch failed (see above); will retry"
  fi

  if [ -f data/manifest.jsonl ] && stores_loaded; then
    [ -f "$READY" ] || log "ready: the site can serve search and documents"
    touch "$READY"
    if [ -n "$EXTRA" ]; then
      log "fetching $EXTRA (served from disk; the site is up meanwhile)"
      "$PY" scripts/seed/fetch_seed.py "$SEED_URL" --extract --kinds "$EXTRA" || log "fetch of $EXTRA failed; will retry"
    fi
    # Per-box ZIP downloads need every PDF on disk, so they are built here, after the PDFs arrive
    # (not inside load_seed.sh). build.py skips archives that are already current.
    if [ "${BUILD_DOWNLOADS:-0}" = 1 ] && [ -d data/pdf ]; then
      log "building ZIP downloads"
      "$PY" scripts/downloads/build.py || log "downloads build failed; will retry"
    fi
    if [ -n "${FILES_S3:-}" ]; then publish_s3 || log "S3 sync failed; will retry"; fi
    if [ "${SEED_EXIT_WHEN_DONE:-0}" = 1 ]; then log "done"; exit 0; fi
    [ "$HOURS" = 0 ] && { log "SEED_UPDATE_HOURS=0: done"; exec sleep infinity; }
    log "next update check in ${HOURS}h"
    sleep "$((HOURS * 3600))"
  else
    [ "${SEED_EXIT_WHEN_DONE:-0}" = 1 ] && { log "failed"; exit 1; }
    log "not ready yet; retrying in 10 min"
    sleep 600
  fi
done
