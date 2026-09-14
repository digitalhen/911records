#!/bin/sh
# Generates /etc/nginx/maps/bates.map from data/manifest.jsonl, then starts
# nginx. Regenerated on every container start/restart — a `docker compose
# restart files` after a manifest refresh is how this map picks up newly
# downloaded documents until A2's build-then-swap pipeline gets its own
# reload hook.
set -eu
MAP=/etc/nginx/maps/bates.map
mkdir -p "$(dirname "$MAP")"

{
  echo 'map $bates $batesdir {'
  echo '    default "";'
  if [ -f /data/manifest.jsonl ]; then
    # One awk process over the whole file (not a shell loop) — 24k+ lines
    # would be painfully slow spawning a sed per line.
    awk -F'"' '
      {
        bates=""; localpdf="";
        for (i=1; i<=NF; i++) {
          if ($i=="bates_start") bates=$(i+2);
          if ($i=="local_pdf") localpdf=$(i+2);
        }
        if (bates=="" || localpdf=="") next;
        sub(/^data\/pdf\//, "", localpdf);
        sub("/" bates "\\.pdf$", "", localpdf);
        printf "    \"%s\" \"%s\";\n", bates, localpdf;
      }
    ' /data/manifest.jsonl
  else
    echo "  # /data/manifest.jsonl not found at container start; no PDFs will resolve until it exists" 1>&2
  fi
  echo '}'
} > "$MAP"

echo "[files] wrote $(grep -c '\";$' "$MAP" || true) Bates path mappings to $MAP"
exec nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
