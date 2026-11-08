#!/usr/bin/env bash
# load_seed.sh — publish an unpacked seed (unpack_seed.sh) into Postgres and OpenSearch: the same
# publication stages scripts/refresh_daily.sh runs, without contacting the City portal or calling
# any language model.
#
# Env: PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD (standard libpq; the database must have a
#      `sept11_ro` role, see deploy/postgres-init.sql), OPENSEARCH_URL [OPENSEARCH_USER
#      OPENSEARCH_PASSWORD]. PYTHON defaults to .venv/bin/python, else python3.
#      Set BUILD_DOWNLOADS=1 to also build the per-box ZIP downloads (needs the pdf shards and
#      about as much free disk again as data/pdf).
set -euo pipefail
cd "$(dirname "$0")/../.."
PY="${PYTHON:-$([ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)}"
for f in data/manifest.jsonl data/site/site.sqlite data/embed/pages.sqlite; do
  [ -f "$f" ] || { echo "missing $f: unpack at least the core and text shards first" >&2; exit 1; }
done
step() { echo "== $* ($(date -u +%H:%M:%S))"; "$@"; }
step "$PY" scripts/embed/load_site_pg.py
if [ "${BUILD_DOWNLOADS:-0}" = 1 ]; then step "$PY" scripts/downloads/build.py; fi
step "$PY" scripts/search/opensearch.py setup
step "$PY" scripts/search/opensearch.py index
echo "loaded. Check: $PY scripts/search/opensearch.py stats"
