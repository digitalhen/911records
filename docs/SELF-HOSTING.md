# Running your own copy of 911records

This guide is for someone deploying the site somewhere other than 911records.org's own servers:
a single cloud machine (AWS is the worked example), a VPS, or a workstation. The production
setup (two Dokploy replicas, host services on StudioMac) is in `docs/RUNBOOK.md` and is untouched
by anything here.

## What a deployment is made of

| Piece | What it holds | Self-hosted as |
|---|---|---|
| **app** (`web/`, Next.js) | the website, Ask, the MCP endpoint | `deploy/docker-compose.yml` → `app` |
| **Postgres 16** | schema `site`: documents, pages, page text, entities, facts. Schema `app`: Ask answers, short links (created by the app itself) | `postgres`, or RDS |
| **OpenSearch 2.x** | one search document per page, keyword + vector (hybrid) search | `opensearch`, or Amazon OpenSearch Service |
| **files** | the PDFs, page images (`.webp`) and text/word-box files, served by path | `files` (nginx over `data/`), or S3 + CloudFront |
| **embedding model** | turns a search query into a vector | `ollama` with `nomic-embed-text` |
| **Ask model** (optional) | the AI question box | Anthropic, Bedrock, OpenAI or a local model: `docs/MODELS.md` |

The data to fill Postgres, OpenSearch and the files service comes from the **seed** (next
section). Regenerating it from the City's portal takes days of OCR (Apple Vision, so a Mac),
rendering, and local-model summarising. The seed skips all of that.

## 1. Get the seed

The seed is ~68 GB of tar shards plus `SEED-MANIFEST.json` (sizes and sha256 for each shard):

| Shards | Contents | Size |
|---|---|---|
| `core-*.tar` | manifest, latest catalog, `site.sqlite`, page vectors, summaries, facts, entities | 2.7 GB |
| `text-*.tar` | page text, OCR sidecars, word boxes | 4.3 GB |
| `pages-*.tar` | rendered page images | 20 GB |
| `pdf-*.tar` | the original PDFs | 40.5 GB |

`core` and `text` are enough to load the database and the search index. Add `pages` and `pdf`
for the document reader and downloads.

It includes the documents the City later **removed** from its portal, still marked as removed
(`removed_from_portal` in `SEED-MANIFEST.json`). Treat them with the care that implies.

**From Google Drive** (how 911records shares it). Ask the maintainer for the seed folder link.
If it is shared as "Anyone with the link", no Google account or extra tools are needed:

```sh
python3 scripts/seed/fetch_seed.py 'https://drive.google.com/drive/folders/<FOLDER_ID>' --out ./911records-seed
python3 scripts/seed/fetch_seed.py '<link>' --out ./911records-seed --kinds core,text   # search only, ~7 GB
```

It resumes interrupted downloads, checks every shard's sha256 and skips shards you already have.
Google limits anonymous downloads of heavily downloaded files. If the script reports a quota
or "virus scan" page, wait (up to 24 h) and re-run, or use rclone with your own Google account:
install [rclone](https://rclone.org/install/), `rclone config` a remote named `gdrive` of type
`drive`, then

```sh
rclone copy gdrive: ./911records-seed --drive-root-folder-id <FOLDER_ID> --progress --transfers 4
```

On EC2, download straight onto the instance's data volume. Inbound transfer is free on AWS.

**Unpack** into the checkout's `data/` (or wherever `DATA_DIR` points). Every shard is verified
against its checksum first:

```sh
scripts/seed/unpack_seed.sh ./911records-seed            # all kinds
scripts/seed/unpack_seed.sh ./911records-seed core text  # just enough for search
```

## 2. Run it on one machine

Needs Docker with Compose v2, about 16 GB RAM and about 150 GB of disk (data + database + index).

```sh
cd deploy
cp .env.example .env        # set POSTGRES_PASSWORD, SITE_URL, OPERATOR_NAME, CONTACT_EMAIL, SEED_URL
docker compose up -d --build
docker compose logs -f seed # watch the first start
curl -s localhost:3000/api/health
```

**The first start fetches the documents by itself.** The `seed` service
(`scripts/seed/sync_seed.sh`):

1. pulls the search embedding model into Ollama;
2. downloads the `core` and `text` shards from `SEED_URL` (~7 GB), extracting each and deleting
   the tar as it goes, so it needs only one shard (~4.5 GB) of scratch space;
3. loads Postgres and OpenSearch (`load_seed.sh`: the same publication stages as the
   production daily refresh, with no model calls and no contact with the City's portal);
4. marks itself healthy, and **the app starts** (`docker compose up` waits for this; on a fresh
   machine the whole first start takes roughly 30-90 minutes, mostly indexing);
5. downloads the page images and PDFs (~60 GB) while the site is already up;
6. checks `SEED_URL` for updates every `SEED_UPDATE_HOURS` (default 24) and loads them.

Restarts are quick: shards already extracted are recorded in `data/.seed-unpacked` and skipped,
and nothing is reloaded unless new data arrived or the database volumes are empty.

`SEED_URL` can be the Google Drive folder link (no Google account needed), an S3 copy
(`s3://bucket/prefix`, read with the instance's IAM role) or any `https://` URL that serves the
seed files. On AWS, an S3 copy in the same region is faster and avoids Google's anonymous
download limits. Make one once from any machine with rclone (a Drive remote and an S3 remote):

```sh
rclone copy gdrive: s3:my-bucket/911records-seed --drive-root-folder-id <FOLDER_ID> --transfers 8
```

and re-run it to pick up seed updates. Leave `SEED_URL` empty to load data by hand instead:
section 1, then `docker compose run --rm pipeline scripts/seed/load_seed.sh`. Set
`BUILD_DOWNLOADS=1` on that command to also build the per-box ZIP downloads (needs the `pdf`
shards and roughly 80 GB more disk).

The app listens on `APP_PORT` (3000). Put TLS in front of it with Caddy, nginx, or an AWS
load balancer.

## 3. AWS

### Simplest: one EC2 instance

Everything from section 2 on one machine, databases included.

- **Instance:** `m7i.xlarge` (4 vCPU, 16 GB) or `r7i.large` (2 vCPU, 16 GB), Amazon Linux 2023 or
  Ubuntu 24.04. Graviton (`m7g.xlarge`) works too: every image used is multi-arch.
- **Disk:** a 200 GB gp3 volume for the checkout and `data/`.
- **Network:** a security group allowing 443 (and 22 for you). Put an Application Load
  Balancer with an ACM certificate in front, or run Caddy on the box.
- **IAM role:** `s3:GetObject` + `s3:ListBucket` on the seed bucket if `SEED_URL` is S3, and
  `bedrock:InvokeModel` on your Claude model for Ask on Bedrock (`LLM_PROVIDER=bedrock`,
  `AWS_REGION`; enable the model in the Bedrock console). No keys on the box.
- **Cost (us-east-1, on-demand, rough):** instance ~$140-150/month, disk ~$16/month, ALB
  ~$20/month, plus model usage. Ask on Haiku 4.5 costs about half a cent per question; the
  daily cap (`ASK_DAILY_USD_CAP`) bounds it.

### Production: autoscaling on managed services (Terraform)

`deploy/aws/` stands up the whole thing with Terraform: the app on ECS Fargate behind a load
balancer, scaling between 2 and 10 copies on CPU; RDS for PostgreSQL 16; Amazon OpenSearch
Service; the documents in S3 behind CloudFront; query embeddings on ECS; and a daily seed task
that loads and updates everything. **Follow [deploy/aws/README.md](../deploy/aws/README.md).**
It is four commands plus a domain, and costs about $315/month before traffic and Ask.

What makes it scale (each is an app setting the Terraform sets; all are off by default, so a
single machine and 911records.org's own replicas behave as before):

| Setting | Effect |
|---|---|
| `FILES_PUBLIC_URL` | `/files/*` redirects readers to the CDN, so PDFs and page images never pass through an app copy |
| `DOWNLOADS_S3` | ZIP downloads are served from S3 on 15-minute presigned links after the captcha check |
| `RATE_LIMIT_STORE=postgres` | per-visitor limits (Ask, verification, short links, MCP) are shared by all copies |
| `DATABASE_READ_URL` | reads go to an RDS read replica, falling back to the primary |

**Without Terraform** (EC2 with docker compose, managed databases): remove
`COMPOSE_PROFILES=local-db` from `.env`, then fill in its database block. RDS for PostgreSQL 16
requires TLS: use
`DATABASE_URL=postgres://sept11:PASSWORD@<endpoint>:5432/sept11?sslmode=no-verify` (encrypted;
the app's driver does not trust Amazon's CA by default), or mount Amazon's
[global bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) and use
`?sslmode=verify-full&sslrootcert=/certs/global-bundle.pem`. The pipeline uses `PGHOST` and
`PGSSLMODE=require`. For Amazon OpenSearch Service, enable fine-grained access control with an
internal master user and set `OPENSEARCH_URL`, `OPENSEARCH_USER`, `OPENSEARCH_PASSWORD`. Set
`FILES_S3` (and `FILES_URL` / `FILES_PUBLIC_URL` to a CloudFront distribution on that bucket) to
serve the documents from S3. No manual database setup is needed: `load_seed.sh` creates the
read-only role itself.

## 4. Make it yours: name, operator, contact

Everything that identifies the site lives in `web/lib/brand.ts` and is set at build time
(`deploy/.env`, passed to the image as `NEXT_PUBLIC_*` build args). Unset values default to
911records.org's own; `off` turns a thing off.

| `deploy/.env` | Default for a self-hosted build | Used for |
|---|---|---|
| `SITE_URL` | required | canonical links, sitemaps, short links, MCP citations, origin checks |
| `OPERATOR_NAME`, `CONTACT_EMAIL` | **required** | footer, About, Privacy, Terms, report forms |
| `SITE_NAME` | the host of `SITE_URL` | logo, titles, citations ("Mirrored by …") |
| `SITE_ALIASES` | `www.<host>` | extra hostnames that 308-redirect to `SITE_URL` |
| `SITE_SLUG` | first label of the host | download filenames, MCP server name |
| `ISSUES_URL`, `DONATE_URL`, `FORMER_HOST` | off | About page issue link, header donate link, privacy page's former address |
| `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_ADS` (+ `ADSENSE_CLIENT`, `ADSENSE_SLOT`) | off | your own analytics and ads |

Change any of these, then rebuild: `docker compose up -d --build app`. `CONTACT_EMAIL` is also
sent to the City's portal as the scraper's contact (`MIRROR_CONTACT`) if you run the pipeline.

The Privacy and Terms pages name your operator and contact, but their wording describes
911records.org's own practices (Cloudflare, Anthropic for Ask, retention periods). Read them and
edit `web/app/privacy/page.tsx` and `web/app/terms/page.tsx` to match how you run your copy.
The release history (`/releases`) is the original project's.

## 5. Keeping it current (optional)

The seed is a snapshot. Two ways to follow the City's later releases:

1. Follow seed updates. The `seed` service already does this every `SEED_UPDATE_HOURS`. The
   maintainer publishes weekly update shards (only new and changed files, plus a fresh `core`)
   to the same folder. If you load by hand, re-run `fetch_seed.py`, `unpack_seed.sh` and
   `load_seed.sh`; each does only the new work.
2. Run the pipeline yourself. `scripts/refresh_daily.sh` does the whole cadence (README.md). New
   pages need text extraction (poppler), and the summarise/facts stages need a model
   (`docs/MODELS.md`). The fallback OCR stage needs macOS (Apple Vision).

---

## For the 911records maintainer: making and sharing the seed

```sh
# 1. Pack (about 70 GB free needed; resumable; reads the main checkout's data/)
python3 scripts/seed/pack_seed.py --repo ~/Code/sept11-docs --out ~/911records-seed
#    --exclude-removed leaves out documents the City took down

# 2. Upload to Google Drive (one-time setup: brew install rclone && rclone config -> remote "gdrive")
rclone copy ~/911records-seed gdrive:911records-seed --progress --transfers 4 --drive-chunk-size 256M

# 3. Share the 911records-seed folder in the Drive web UI and send people the folder URL.
#    "Anyone with the link" lets fetch_seed.py download without a Google account; anyone who
#    gets the link can then download everything, removed documents included.
```

**Updating it** is automatic: `scripts/seed/publish_seed.sh` runs weekly from cron on the
maintainer's Mac (Sunday 10:00, after the daily refresh):

```
0 10 * * 0 cd ~/Code/sept11-docs && /bin/bash scripts/seed/publish_seed.sh >> data/publish_seed.log 2>&1
```

It takes the refresh lock (waiting for a running refresh), runs `pack_seed.py --update`, then
`rclone copy`s to `gdrive:911records-seed`. Keep `~/911records-seed` (at least its
`SEED-MANIFEST.json` and `PACKED-FILES.tsv`) between runs. By hand:

```sh
python3 scripts/seed/pack_seed.py --repo ~/Code/sept11-docs --out ~/911records-seed --update [--dry-run]
rclone copy ~/911records-seed gdrive:911records-seed --progress --transfers 4 --drive-chunk-size 256M
```

`--update` repacks `core` (about 3 GB) and puts only new or changed text, page and PDF files
into new `<kind>-u<timestamp>-NNN.tar` shards. The base shards are never rewritten, so rclone
uploads only the new shards, `core-000.tar` and the manifest. Use `rclone copy`, not
`rclone sync`, so a deleted local shard is never removed from Drive. If the update shards pile
up (more than ~25% of the seed), pack a fresh full seed into a new folder and share that
instead. Google Drive accepts 750 GB of uploads per account per day.
