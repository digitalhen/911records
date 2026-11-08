#!/usr/bin/env bash
# unpack_seed.sh — verify and extract a seed made by pack_seed.py into this checkout's data/.
#
#   scripts/seed/unpack_seed.sh /path/to/911records-seed [kind ...]
#
# Kinds default to all of core text pages pdf. Every shard's sha256 is checked against
# SEED-MANIFEST.json before it is extracted; a mismatch stops the run (re-download that shard).
# Extracted shards are recorded in data/.seed-unpacked so a re-run skips them.
set -euo pipefail
cd "$(dirname "$0")/../.."
SEED="${1:?usage: unpack_seed.sh <seed dir> [core text pages pdf]}"; shift || true
KINDS="${*:-core text pages pdf}"
[ -f "$SEED/SEED-MANIFEST.json" ] || { echo "no SEED-MANIFEST.json in $SEED" >&2; exit 1; }
mkdir -p data; touch data/.seed-unpacked
python3 - "$SEED" $KINDS <<'PY' | while read -r name sha; do
import json, sys
seed, kinds = sys.argv[1], sys.argv[2:]
m = json.load(open(f"{seed}/SEED-MANIFEST.json"))
for name, s in sorted(m["shards"].items()):
    if s["kind"] in kinds:
        print(name, s["sha256"])
PY
  if grep -qx "$name" data/.seed-unpacked; then echo "$name: already unpacked"; continue; fi
  [ -f "$SEED/$name" ] || { echo "$name: missing from $SEED" >&2; exit 1; }
  echo -n "$name: verifying... "
  got=$( (command -v sha256sum >/dev/null && sha256sum "$SEED/$name" || shasum -a 256 "$SEED/$name") | cut -d' ' -f1)
  [ "$got" = "$sha" ] || { echo "CHECKSUM MISMATCH (got $got)" >&2; exit 1; }
  echo -n "extracting... "
  tar -xf "$SEED/$name"
  echo "$name" >> data/.seed-unpacked
  echo ok
done
echo "done: $(wc -l < data/.seed-unpacked | tr -d ' ') shard(s) unpacked into $(pwd)/data"
