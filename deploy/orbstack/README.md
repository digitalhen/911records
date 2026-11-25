# 911records on OrbStack Docker (StudioMac)

This replaces the Dokploy apps on StudioMac and MonsterMac with one Compose
project, `sept11`, on StudioMac's built-in OrbStack Docker engine
(`docker --context orbstack`). The site runs on this one host only. The
MonsterMac copy is retired, not kept as a standby: autodeploy off, containers
stopped, `restart=no`. It follows the same pattern as Prospect
(`~/Code/prospect/deploy/orbstack`).

| Service | Role | Secrets | Started by |
|---|---|---|---|
| `web` | Next.js app on port 3000 (host `127.0.0.1:${WEB_PORT}`, default 3120) | `web.env` | `deploy.sh` |
| `opensearch` | search index on the existing volume `sept11-docs_opensearch-host-data` (profile `data`) | `opensearch.env` | by hand, once |
| `files` | nginx over `data/{pdf,pages,text,downloads}` plus the `/ollama/` proxy (profile `data`) | none | by hand, once |
| `tunnel` | cloudflared on a 911records-only tunnel to `web:3000` (profile `tunnel`) | `tunnel.env` | `deploy.sh`, once web is healthy |

## Web and processing are separate
`web` holds only web secrets. It shares three things with processing, all of
them datastores: Postgres, OpenSearch and the files mirror. To move web (and
`tunnel`) to AWS later, set `DATABASE_URL`, `OPENSEARCH_*` and
`WEB_FILES_URL` to the new endpoints. Nothing else in web depends on this Mac.

Processing is not a container. `scripts/refresh_daily.sh` has three
dependencies that rule one out:
- Apple Vision OCR, built from `scripts/eval/ocr_vision.swift` with `swiftc`;
- waking the PC GPU over Wake-on-LAN and SSH (`scripts/pc.sh`);
- the 209 GB `data/` tree in `~/Code/sept11-docs`.

So it stays on StudioMac's crontab, unchanged:
- `refresh_daily.sh` at 03:30;
- `publish_seed.sh` on Sundays, which needs rclone's Google Drive config.

It runs in `~/Code/sept11-docs` and pulls `main` before it starts. It reaches
OpenSearch at `127.0.0.1:9200` and Postgres at `:5433`. Both addresses are the
same before and after the cutover.

## Host layout (`~/sept11-orb`, override with `SEPT11_ORB_DIR`)
- `src/`: a clone of digitalhen/911records over a read-only deploy key
- `web.env`, `opensearch.env`, `tunnel.env`, `compose.env`: chmod 600, never committed
- `deployed`: the commit currently serving
- `deploy.log`: the deploy log

`compose.env` keys:
- `SEPT11_ORB_DIR`, `SEPT11_DATA_DIR` (the `data/` directory `files` serves),
  `FILES_NGINX_CONF` (absolute path to `files/nginx.conf`; today the one in
  `~/Code/sept11-docs`, the file the old container used);
- `NEXT_PUBLIC_SITE_URL`, `WEB_PORT`;
- `DATA_BIND`: the address that `opensearch` and `files` publish on (default
  `127.0.0.1`). Set it to `0.0.0.0` only while the old Dokploy app still reads
  them over the LAN during cutover;
- optional `WEB_OPENSEARCH_URL` / `WEB_FILES_URL` / `WEB_OLLAMA_URL`. These
  point web at datastores outside the project. They are set while staging and
  removed at cutover.

## Deploys
`deploy.sh` runs every minute through launchd (`com.sept11.orb-deploy.plist`).
When `origin/main` moves, it does four things:
1. builds `sept11-web:<sha>`;
2. recreates `web` only;
3. waits for the container to be healthy **and** for `/api/health` to report
   `"primary":true` and `"schemaReady":true`;
4. if either check fails, puts the previous image back.

A deploy never touches `opensearch` or `files`. Rolling back means running
`deploy.sh <sha>`. The deploy loop keeps the five newest images.

### Why main auto-deploys
Pushing to `main` has always deployed this site: both Dokploy apps have
autodeploy on. The deploy loop keeps that and adds a health gate and an
automatic rollback.

TailOdds is different. There, a merge publishes data products straight to
users. Here, the risk of a merge is limited to the web build, and that is
exactly what the gate checks. Data publication is a separate step: the host
refresh, not a deploy.

## Restart safety
Every service has `restart: unless-stopped`, and the tunnel waits for a
healthy `web`. After an OrbStack or host restart, nothing needs starting by
hand. Still check that it all came back:

```
docker --context orbstack compose -p sept11 ps
```
