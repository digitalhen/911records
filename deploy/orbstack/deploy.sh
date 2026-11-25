#!/usr/bin/env bash
# 911records deploy loop for StudioMac's OrbStack Docker. Replaces Dokploy's
# GitHub autodeploy of the web app. Run every minute by launchd
# (deploy/orbstack/com.sept11.orb-deploy.plist); safe to run by hand.
#
#   deploy.sh            deploy origin/$DEPLOY_REF if it moved
#   deploy.sh --force    rebuild and redeploy the current ref
#   deploy.sh <sha>      deploy that exact commit (rollback; must be on origin)
#
# Layout (SEPT11_ORB_DIR, default ~/sept11-orb):
#   src/          clone of digitalhen/911records over a READ-ONLY deploy key
#   *.env         secrets, chmod 600 (see compose.yml)
#   deployed      the commit currently serving
#   deploy.log    this script's log
#
# A deploy builds the web image tagged by commit, starts it, and waits for the
# container to be healthy AND for /api/health to report the primary database
# and the site schema. If either never happens, the previous image is put back
# and the run fails loudly.
#
# Only web (and the tunnel) is ever recreated here. opensearch and files hold
# data and are started once, by hand (README.md); a deploy never restarts them.
# Processing runs natively on the host (README.md), so there is no worker to
# swap and a deploy can never interrupt a refresh.
set -uo pipefail
ORB="${SEPT11_ORB_DIR:-$HOME/sept11-orb}"
REF="${DEPLOY_REF:-main}"
DOCKER="${DOCKER_BIN:-$HOME/.orbstack/bin/docker}"
export PATH="$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# This file lives in the checkout this script moves between commits, and bash
# reads a script as it runs: run from a private copy so a checkout can never
# rewrite the lines still to execute.
if [ "${SEPT11_DEPLOY_COPY:-}" != "1" ]; then
  cp "$0" "$ORB/.deploy-run.sh" && SEPT11_DEPLOY_COPY=1 exec bash "$ORB/.deploy-run.sh" "$@"
  exit 1
fi
LOCK="$ORB/.deploy.lock"
cd "$ORB/src" || { echo "no checkout at $ORB/src" >&2; exit 1; }
mkdir "$LOCK" 2>/dev/null || exit 0          # another tick is still deploying
trap 'rmdir "$LOCK"' EXIT
log() { echo "$(date '+%F %T') $*" | tee -a "$ORB/deploy.log"; }
dc() { SEPT11_ORB_DIR="$ORB" "$DOCKER" --context orbstack compose -p sept11 -f "$ORB/src/deploy/orbstack/compose.yml" --env-file "$ORB/compose.env" "$@"; }
WEB_PORT=$(grep -E '^WEB_PORT=' "$ORB/compose.env" 2>/dev/null | cut -d= -f2); WEB_PORT="${WEB_PORT:-3120}"

git fetch -q origin "$REF" || { log "fetch failed"; exit 1; }
if [ $# -gt 0 ] && [ "$1" != "--force" ]; then
  target=$(git rev-parse --verify "$1^{commit}") || { log "unknown commit $1"; exit 1; }
else
  target=$(git rev-parse "origin/$REF")
fi
current=$(cat "$ORB/deployed" 2>/dev/null || true)
if [ "$target" = "$current" ] && [ "${1:-}" != "--force" ]; then exit 0; fi

log "deploying ${target:0:12} (was ${current:0:12})"
git checkout -q --detach "$target" && git clean -qfdx -e node_modules
export GIT_SHA="$target" WEB_TAG="$target"
if ! dc build web >>"$ORB/deploy.log" 2>&1; then
  log "BUILD FAILED for ${target:0:12}; still serving ${current:0:12}"; exit 1
fi
# A failed `up` leaves the OLD container serving and healthy, so it must not
# fall through to the health wait below.
up_ok=1
dc up -d --no-deps web >>"$ORB/deploy.log" 2>&1 || up_ok=""

# Healthy container, serving THIS commit (the old one is healthy too), with a
# body that proves it can serve records: the health route answers 200 even
# with the database down, so the status alone is not a gate.
healthy=""
for _ in $(seq 1 60); do
  [ -n "$up_ok" ] || break
  st=$("$DOCKER" --context orbstack inspect -f '{{.State.Health.Status}}' sept11-web-1 2>/dev/null)
  if [ "$st" = "healthy" ]; then
    body=$(curl -fsS --max-time 10 "http://127.0.0.1:$WEB_PORT/api/health" 2>/dev/null || true)
    if echo "$body" | grep -q "\"commit\":\"$target\"" \
       && echo "$body" | grep -q '"primary":true' && echo "$body" | grep -q '"schemaReady":true'; then healthy=1; break; fi
  fi
  sleep 5
done
if [ -z "$healthy" ]; then
  log "WEB UNHEALTHY or not started on ${target:0:12} (up_ok=${up_ok:-0}); rolling back to ${current:0:12}"
  if [ -n "$current" ]; then WEB_TAG="$current" GIT_SHA="$current" dc up -d --no-deps web >>"$ORB/deploy.log" 2>&1; fi
  exit 1
fi
echo "$target" > "$ORB/deployed"
"$DOCKER" --context orbstack tag "sept11-web:$target" sept11-web:current
log "web healthy on ${target:0:12}"

# Tunnel (if configured) after web is healthy; compose's depends_on enforces it too.
[ -f "$ORB/tunnel.env" ] && dc --profile tunnel up -d --no-deps tunnel >>"$ORB/deploy.log" 2>&1

# Keep the last five commits' images for rollback.
"$DOCKER" --context orbstack images sept11-web --format '{{.Tag}} {{.CreatedAt}}' | grep -v '^current ' | sort -k2 -r | tail -n +6 | awk '{print $1}' \
  | while read -r t; do "$DOCKER" --context orbstack rmi "sept11-web:$t" >/dev/null 2>&1 || true; done
