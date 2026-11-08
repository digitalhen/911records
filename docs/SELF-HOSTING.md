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

Needs Docker with Compose v2, about 16 GB RAM and about 150 GB of disk (seed + database + index).

```sh
cd deploy
cp .env.example .env        # set POSTGRES_PASSWORD, SITE_URL; pick an Ask block or leave Ask off
docker compose up -d --build
docker compose exec ollama ollama pull nomic-embed-text
docker compose run --rm pipeline scripts/seed/load_seed.sh   # Postgres + OpenSearch, ~15-30 min
curl -s localhost:3000/api/health
```

`load_seed.sh` runs the same publication stages as the production daily refresh
(`load_site_pg.py`, then `opensearch.py setup` and `index`) with no model calls and no contact
with the City's portal. Re-run it any time the data changes. Set `BUILD_DOWNLOADS=1` to also
build the per-box ZIP downloads; that needs the `pdf` shards and roughly 80 GB more disk.

The app listens on `APP_PORT` (3000). Put TLS in front of it with Caddy, nginx, or an AWS
load balancer.

## 3. AWS

### Simplest: one EC2 instance

- **Instance:** `m7i.xlarge` (4 vCPU, 16 GB) or `r7i.large` (2 vCPU, 16 GB), Amazon Linux 2023 or
  Ubuntu 24.04. Graviton (`m7g.xlarge`) works too: every image used is multi-arch.
- **Disk:** a 200 GB gp3 volume for the checkout and `data/`.
- **Network:** a security group allowing 443 (and 22 for you). Put an Application Load
  Balancer with an ACM certificate in front, or run Caddy on the box.
- **Ask on Bedrock:** give the instance an IAM role with `bedrock:InvokeModel` on the Claude
  model you choose, enable that model in the Bedrock console, then set `LLM_PROVIDER=bedrock` and
  `AWS_REGION`. No API keys on the box.
- **Cost (us-east-1, on-demand, rough):** instance ~$140-150/month, disk ~$16/month, ALB
  ~$20/month, plus model usage. Ask on Haiku 4.5 costs about half a cent per question; the
  daily cap (`ASK_DAILY_USD_CAP`) bounds it.

Then follow sections 1 and 2 on the instance.

### Managed services (more moving parts, less to babysit)

| Piece | AWS service | Notes |
|---|---|---|
| app | ECS Fargate (or App Runner), image built from `Dockerfile` with context `web/` | env as in `deploy/docker-compose.yml`'s `app` service |
| Postgres | RDS for PostgreSQL 16 | run `deploy/postgres-init.sql` once, then `load_seed.sh` from any machine with the seed, `PG*` env pointing at RDS |
| OpenSearch | Amazon OpenSearch Service 2.11+ | k-NN and the hybrid-search normalization processor are built in. Basic auth: `OPENSEARCH_USER` / `OPENSEARCH_PASSWORD` |
| files | S3 + CloudFront | Mirror the URL layout: `aws s3 sync data/pdf s3://BUCKET/pdf/`, `data/pages` to **`page/`**, `data/text` to `text/`. Set `FILES_URL` to the CloudFront origin. The app fetches through it server-side, so the bucket can stay private behind Origin Access Control. |
| embeddings | an `ollama/ollama` ECS service with `nomic-embed-text` (CPU is fine) | set `EMBED_URL` to it |
| Ask | Bedrock with the task role | as above |

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

1. Follow seed updates. The maintainer adds small update shards (only new and changed files,
   plus a fresh `core`) to the same folder. Re-run the same three commands; each one does only
   the new work:

   ```sh
   python3 scripts/seed/fetch_seed.py '<link>' --out ./911records-seed   # downloads only new/changed shards
   scripts/seed/unpack_seed.sh ./911records-seed                         # extracts only those
   docker compose run --rm pipeline scripts/seed/load_seed.sh            # reload Postgres + index
   ```
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

**Updating it** (whenever you like, e.g. monthly or after a big City release). Keep
`~/911records-seed` (or at least its `SEED-MANIFEST.json` and `PACKED-FILES.tsv`) between runs:

```sh
python3 scripts/seed/pack_seed.py --repo ~/Code/sept11-docs --out ~/911records-seed --update
rclone copy ~/911records-seed gdrive:911records-seed --progress --transfers 4 --drive-chunk-size 256M
```

`--update` repacks `core` (about 3 GB) and puts only new or changed text, page and PDF files
into new `<kind>-u<timestamp>-NNN.tar` shards. The base shards are never rewritten, so rclone
uploads only the new shards, `core-000.tar` and the manifest. Add `--dry-run` first to see the size.
Use `rclone copy`, not `rclone sync`, so a deleted local shard is never removed from Drive.
If the update shards pile up (more than ~25% of the seed), pack a fresh full seed into a new
folder and share that instead. Google Drive accepts 750 GB of uploads per account per day.
