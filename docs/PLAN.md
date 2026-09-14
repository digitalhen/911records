# Plan: ship 911records.nyc

Written 2026-09-14 (New York time, late on the 13th). Henry's decisions, given in this session:

- **Scope: everything in the Astra round 2 design** (`design/astra/`): Ask anything, search,
  document viewer, browse, changes, entities, signatories, topics, related and versions, building
  map and building pages, case folder, personal-information policy, mobile.
- **Ask uses Haiku, and only when OpenSearch cannot answer on its own.** Model it on Prospect's
  Ask (`~/Code/prospect/docs/CHAT-AGENT.md`): one constrained call that emits a plan, retrieval done
  deterministically, rows never pass through the model unless an answer must be written.
- **Serve from here, HA like prospect.nyc.** The mirror and the pipeline stay on StudioMac. The app
  runs on BOTH Dokploy instances (StudioMac .51 and MonsterMac .52) behind the one Cloudflare
  tunnel, and Dokploy auto-deploys from `main`. Derived data lives in the central Postgres
  (database `sept11` on .51:5433, standby on .52:5433; roles `sept11` rw and `sept11_ro`,
  credentials in StudioMac's `~/.pgpass`). Files (PDFs, page images, word boxes) and OpenSearch are
  served from StudioMac's host Docker on the LAN IP, the way Prospect's central Postgres is.
- **Run it like prospect.nyc**: scheduled refresh on StudioMac, build-then-swap for derived data,
  a health endpoint, one PR per change once live.
- **PII: serve the City's records as-is and keep pulling updates from the City.** No redaction of
  our own for v1. The report form, the removal handling and the policy page stay, but the policy
  says what we actually do.
- **Live as soon as possible**, fully deployed, with SEO.
- Operator: **Cleartext Labs** (footer, about, privacy, JSON-LD publisher). Independent; not affiliated with the City.
- Ads: AdSense, one labelled unit per page below the content, never inside a document or an
  answer (publisher `ca-pub-9961054735948902`, unit `4391479569`). `ads.txt` and `/privacy` carry over.
- Sub-agents on cheaper models; Codex (`codex exec`, gpt-6-astra) for the large porting jobs.

## Architecture

```
StudioMac host (.51)                                  Dokploy VMs on .51 AND .52 (HA, one tunnel)
----------------------------------------------------  -------------------------------------------
data/pdf, data/text (+boxes), data/pages (webp)       app (Next.js 15, standalone), env only:
docker-compose.host.yml on the host's Docker:           DATABASE_URL → .51:5433 (writes, runtime tables)
  files  nginx  192.168.200.51:8911 (/files/pdf,        DATABASE_READ_URL → .52:5433 (reads)
         /files/page, /files/text, /ollama proxy)       OPENSEARCH_URL → 192.168.200.51:9200 (auth)
  opensearch 2.19  192.168.200.51:9200, security on     FILES_URL → 192.168.200.51:8911
central Postgres sept11: schema site (derived,          OLLAMA_URL → files service /ollama proxy
  build-then-swap) + schema app (answers, reports)     ANTHROPIC_API_KEY, ASK_MODEL, caps, GIT_SHA
scripts/refresh_daily.sh (launchd 03:30): enumerate →
  diff → download → extract/render/OCR/embed/entities →
  build_site_db → load_site_pg → opensearch index
```

- **Read data** comes from two places only: OpenSearch (search, facets, per-document page lists,
  entity fields) and Postgres schema `site` (catalog, pages and page text, changes, entities,
  roles, related, topics, places), read through the standby. The pipeline builds
  `data/site/site.sqlite` locally, then `load_site_pg.py` loads it into schema `site_new` and swaps
  schemas in one transaction (build-then-swap, Prospect's rule).
- **Write data** (answers with permalinks, PII reports, saved-search alerts) goes to schema `app`
  on the primary.
- **Files.** PDFs, page images and word boxes are served by the `files` nginx on StudioMac's host
  Docker, reached through Next rewrites at `/files/…`; both app replicas point at it.
- **Vectors at query time.** The app embeds queries with nomic-embed-text through the files
  service's `/ollama/` proxy to Ollama on StudioMac, the same model the pipeline uses.
- **Ask.** `lib/ask/route.ts` decides without a model: a Bates number opens the document; a
  short keyword string runs a search. Anything else goes to Haiku once for a `AskPlan`
  (`kind: search | question | refuse`, terms, filters). Retrieval is OpenSearch hybrid. Only
  `question` makes a second Haiku call, given ≤12 page excerpts with their Bates page ids, and
  must return sentences each with citations; the app drops any sentence whose citations are not
  in the retrieved set, and renders "not established" and follow-ups. `refuse` covers attempts to
  identify redacted or private people. Env: `ANTHROPIC_API_KEY`, `ASK_MODEL` (default
  `claude-haiku-4-5`), `ASK_DAILY_USD_CAP`, per-IP rate limit. With no key, Ask degrades to search.

## URL scheme (stable; citations depend on it)

| Path | What |
|---|---|
| `/` | Ask + search, collection summary, recent changes |
| `/search?q=&agency=&box=&contaminant=…` | results with facets and snippets |
| `/ask?q=` → `/a/<id>` | answer, permalinked with citations frozen |
| `/doc/<bates_start>` and `/doc/<bates_start>/p/<n>` | document viewer; page image beside OCR text |
| `/page/<bates_page>` | redirect to the document and page that carries that Bates stamp |
| `/browse`, `/browse/<agency>/<volume>/<box>/<folder>` | physical order |
| `/changes`, `/changes/<date>` | snapshot history: added, removed, changed |
| `/entities`, `/entity/<type>/<slug>` | labs, agencies, contractors, substances, addresses |
| `/signatory/<slug>` | people in official capacity only, role on a record |
| `/topics`, `/topics/<id>` | topic map |
| `/doc/<bates_start>/versions` | near-duplicates and copies |
| `/map`, `/building/<bin>` | buildings and tests |
| `/case` | case folder, browser-local |
| `/personal-information`, `/privacy`, `/about`, `/ads.txt`, `/robots.txt`, `/sitemap.xml` | |
| `/api/health` | build sha, index counts, site.sqlite mtime, last refresh |

## Schema `site` (contract between pipeline and app; built as `data/site/site.sqlite`, loaded to Postgres)

```
documents(doc PK, bates_end, agency, source, volume, box, folder, page_count, pdf_size, status,
          first_seen, removed_at, reappeared_at, changed_at, changed_fields, held_locally,
          pages_ok, pages_empty, pages_ocr, topic, n_related_cross, official_url)
pages(doc, page, bates, chars, ocr_status, ocr_source, image_ready, PRIMARY KEY(doc,page))
snapshots(date PK, documents, pages, bytes, added, removed, changed, sha256)
changes(date, doc, kind, fields)                       kind ∈ added|removed|changed|reappeared
entities(id PK, type, slug, label, n_docs, n_pages, first_date, last_date)
entity_pages(entity_id, doc, page, role, confidence)
signatories(id PK, slug, name, title, org, n_docs, first_date, last_date)
signatory_pages(id, doc, page, action, confidence)
related(doc, rank, other, score, cross)     near_dupes(doc, other, score)
topics(id PK, parent, label, size_docs, size_pages, terms, boxes, agencies)   doc_topics(doc, topic, prob)
places(id PK, kind, key, label, n_docs, n_pages, n_test_pages, first_date, last_date, lat, lon)
place_pages(place_id, doc, page, has_test, contaminants, units, dates, labs, confidence)
page_text(doc, page, text, source)                     source ∈ pdftotext|ours (Postgres only)
meta(key PK, value)                                     built_at, snapshot_date, counts
```

Word boxes for highlighting live beside the text: `data/text/<agency>/<volume>/<bates>.boxes.jsonl`,
one line per page, `{page, words:[[x0,y0,x1,y1,"word"],…], w, h}` in page-image pixel space.
Page images: `data/pages/<agency>/<volume>/<bates>/<n>.webp` (about 110 dpi) and `<n>.t.webp`
(thumbnail). OCR we run ourselves is marked `ocr_source = 'ours'` and shown as such.

## Workstreams

| Id | Work | Owner | Depends on |
|---|---|---|---|
| A1 | Pipeline: `render_pages.mjs` (pdftoppm → webp + thumb, incremental), `-bbox-layout` word boxes in `extract_text.mjs`, `ocr_pages.py` (tesseract for `empty` pages, text + boxes), `loop.sh` runs them | Codex | — |
| A2 | Pipeline: `build_site_db.py` (schema above, build-then-swap), `opensearch.py` gains `image_ready`, `ocr_source`, doc-level fields, basic-auth env, `--host`; `refresh_daily.sh` + launchd plist; `docs/RUNBOOK.md` | Sonnet | A1 file layout |
| B1 | App foundation: `web/` Next.js 15 + TS, design system ported from `design/astra/style.css`, layout and nav, `lib/siteDb.ts`, `lib/opensearch.ts`, `lib/embed.ts`, search results with facets, document viewer with page image, OCR text, hit highlighting from boxes, Bates redirects, `/files` rewrites, `/api/health`, Dockerfile, `docker-compose.yml` (app, files, opensearch), `robots.txt`, sitemap index | Sonnet | schema above |
| B2 | Home, browse, changes, personal-information, privacy, about, mobile frames | Codex | B1 |
| B3 | Ask: router, Haiku plan, hybrid retrieval, cited answer, refusal, permalinks, spend cap | Sonnet | B1 |
| B4 | Entities, signatory, topics, related panel on document, versions | Codex | B1, A2 |
| B5 | Map (MapLibre + OpenFreeMap tiles + our footprints GeoJSON) and building pages | Codex | B1, A2 |
| B6 | Case folder (browser-local, export, suggestions), saved-search alerts (copy link, no email in v1), SEO pass (metadata, JSON-LD, canonical, OG, sitemaps for documents, entities, buildings, topics) | Sonnet | B1–B5 |
| C | Deploy: Dokploy app on `ubuntu-production` replacing the holding page, env, bind mount, OpenSearch credentials, first full index, DNS check, `/api/health` green | main session | A2, B1 |
| D | QA: design fidelity against `design/astra/`, privacy rules (no private names in entity pages or suggestions), citation check on Ask, mobile | Sonnet, one pass | all |

Sequencing: A1, A2 and B1 start together. B2–B5 start when B1's scaffold is merged, each on its
own branch and its own routes, never editing shared files (layout, nav, `lib/*`) without saying
so in the report. B6 and D last. C runs as soon as A2 and B1 exist, with whatever data has been
mirrored by then; the index refills as the download finishes (about 13 hours from now).

## Deployment steps (C)

1. Host services on StudioMac: `docker compose -f docker-compose.host.yml up -d` (files nginx and
   OpenSearch with security on, both on 127.0.0.1 and 192.168.200.51 only). Cut the indexer over
   to basic auth; retire `docker-compose.opensearch.yml`.
2. Load Postgres: `scripts/refresh_daily.sh --index-only --no-download` (site.sqlite → schema
   `site` → OpenSearch index). Install the launchd daemon.
3. Dokploy, both instances (project "Sept11 Records"): a Compose application on this repo,
   `docker-compose.yml`, watch path `web/**` + `docker-compose.yml` + `Dockerfile`, domains
   `911records.nyc` and `www` (301), environment per the block above with `REPLICA_NAME` set to
   `studiomac` / `monstermac` and `GIT_SHA` per Prospect's rule. Then retire the "Holding page"
   application on both.
4. Verify on each replica: `/api/health` (commit, replica, db, opensearch, files), `/doc/NYC-WTC_000000001`,
   `/search?q=asbestos`, `/sitemap.xml`, `www` redirect, `/ads.txt`.

## SEO

Server-rendered document pages with title `<box or folder> · NYC-WTC_… · 9/11 City Records`,
a description from the first non-empty page, canonical URLs, Open Graph, `Dataset` and
`DigitalDocument` JSON-LD, breadcrumbs, a sitemap index (documents, entities, buildings, topics,
changes; page-level URLs stay out of the sitemap), `robots.txt` allowing everything except
`/ask`, `/a/`, `/case`, `/api/`. Removed documents return 410 with a notice and safe metadata.

## Out of scope for v1

Accounts, email alerts, our own redaction pass, City data joins beyond the building footprints
(`docs/research/city-data-linkage.md` phases 2–4), and anything outside the City's 9/11 records.

---

# Carried over from the plan of record (2026-09-13 23:13)

## 1. What we are building

An independent explorer over the City of New York's 9/11 Document Portal release. The release came
from the NYC Law Department on 2026-09-08 and more arrives monthly: **24,436 PDFs and 172,537
Bates-numbered pages** (catalog export, 2026-09-13).

The City's own portal is a bare full-text box: no browsing, no dates, no bulk access, and removals
happen without notice.

**Who it is for:**
- 9/11 families.
- Families of people who got sick and are pursuing compensation (WTC Health Program, VCF).
- The lawyers who represent them.
- Journalists and researchers, as a secondary audience.

**What they come to do:**
- Find what was measured, where and when: asbestos, lead, dust and air readings by building and
  date.
- Find what the City knew and when.
- Find records that support a claim.
- Keep up as records are added, removed or re-redacted.

**Tone:** a serious records instrument. Not a memorial trinket and not sensational. The design
direction is the Astra "records desk" (`design/astra/`).

## 3. Non-negotiable rules

Sources: `docs/research/epstein-explorers.md` and the .nyc policy addendum in
`docs/research/domain-names.md`.

1. **Citation discipline.**
   - Every AI-written sentence cites a Bates page, or it is not shown.
   - The server validates that each cited page was in the retrieved set.
   - Uncited sentences are dropped, not rendered.
2. **Never claim the AI can't be wrong.** Say that it can misread scans and that the page is the
   authority.
3. **No private individuals as entities.**
   - No people browser, no co-mention ("who appears with whom") search, no network graph of people.
   - Identity questions ("who is behind this redaction") get a refusal.
4. **Roles beside names.** Where an official appears, show why: author, recipient, cc, signatory,
   inspector of record.
5. **A written, visible personal-information policy** with a fast takedown path. (Henry, 09-14:
   v1 serves the City's records as-is; our own PII check is deferred.) The City's redactions fail by composition, e.g. a name
   hidden in one document and shown in another.
6. **Removed-by-the-City documents are not served publicly.** Removals are most likely PII takedowns.
   - We keep the files privately, as the mirror already does.
   - The public change log lists the Bates range, date and page count, never the content.
   - Re-redacted PDFs are served in their newest version only.
7. **Hard-walled corpus.** City 9/11 records only. No mixing with other document sets, no "cover-up"
   framing.
8. **Derived is labelled.**
   - Dates, types, addresses, readings and titles extracted by machine carry a "machine-extracted"
     label, a confidence and a link to the page.
   - Present-day city datasets (PLUTO, footprints, DOB today) are never shown as 2001 facts.
9. **Legal use of the product** (flagged for NY ethics-counsel review before any firm feature).
   - Allowed: flat-fee research subscriptions, advertising by place and date, and intake initiated
     by families.
   - Never: lead lists of individuals, selling family activity, or per-lead fees.
10. **Politeness toward the City's servers.**
    - ≤1 req/s with a descriptive UA.
    - One export request a day.
    - Stop on 429/403.

## 6. Build stages

Each stage ships to 911records.nyc through PRs, with evidence in the PR (Prospect's release
standards).

**Team shape**, following Henry's model budget:
- **Opus:** architect and brief-writer, plus implementers for security- and data-sensitive work.
- **Sonnet:** mechanical work and QA.
- **Human decision:** anything marked ⚑.

### Stage 0 — finish the corpus (no app yet; start immediately)

1. **Mirror.** Let the download complete, then run `verify_pdfs.mjs --sha`. Record the true byte
   total; `pdf_size` is a lower bound.
2. **OCR pass for image-only pages.**
   - Tooling: `pdftoppm` + `tesseract` (installed). Add `ocrmypdf` if a searchable-PDF output is
     wanted.
   - Store text per page with `source = city_layer | project_ocr` and a quality score.
   - Measure the real blank-page rate: 35% of early pages versus 3.9% of documents so far.
3. **Daily catalog job** as launchd on StudioMac: snapshot → diff → download new → extract. Log a
   status row and alert on quarantine or failure.
4. **Postgres `sept11` schema** plus a loader from manifest, snapshots, `pages.jsonl`, entities,
   places, related and topics. Replace the SQLite stores as the source of truth.
5. **Document type + one-line description** per document ("what it is": lab result, letter, air
   test, sign-in sheet…).
   - Built with a local model or batched Claude calls over the first pages.
   - Labelled machine-derived.
   - Measure accuracy on a hand-checked sample of 200.
6. **GLiNER test** on 500 pages versus regex. Keep it only if precision on labs, contractors and
   roles improves.

**Accept when:**
- 24,436 PDFs are verified.
- Every page has text or a recorded "unreadable".
- Postgres counts match the catalog.
- The daily job ran on two consecutive days.

### Stage 1 — real catalog site (replaces the holding page)

1. Next.js app skeleton on Dokploy, both hosts: records-desk styles and the revision-2 logo.
   `site/holding` is retired once this is live.
2. **Browse** the physical order: collection → box → folder → documents, with City-provided
   metadata.
3. **Document page.**
   - pdf.js viewer on the local mirror.
   - Per-page OCR text beside it.
   - Bates permalinks (`/doc/NYC-WTC_000058160`, `/page/NYC-WTC_000058161`).
   - "Cite this page": our permalink plus the City's official URL.
   - Report personal information.
4. **Search v1.** OpenSearch BM25 over page text + metadata.
   - Facets: collection, agency, box, folder, volume, doc type.
   - Hit highlighting; exact-Bates short-circuit.
   - Boolean, phrase and proximity syntax for lawyers.
5. **Change log** from snapshots: added, removed (listed without content) and changed.
6. **Personal-information policy page** plus a report form that writes to `redaction_reports` and
   emails Henry. A reported page is restricted within 24 h.
   - ⚑ The public contact address is Henry's call, and it must not be his personal email.
7. **Privacy page, ads.txt, one AdSense unit per page**, carried over. Check the CMP.
8. **OpenSearch production nodes** on both hosts: security on, reindex from Postgres, parity
   readiness.

**Accept when:**
- Every document is reachable by browse and by Bates.
- Search p95 is under 500 ms on both hosts.
- Removed documents are not served.
- Lighthouse accessibility ≥ 95.
- Both replicas serve the same build: verify via `/api/health` `buildId` inside each container, not
  the public URL (Prospect's skew rule).

### Stage 2 — discovery

1. **Hybrid search.** BM25 + nomic vectors via an OpenSearch search pipeline; "more like this
   page"; "more like this passage".
2. **Related records** on every document, with a **filed elsewhere** group for records from a
   different box, agency or collection. The reason is shown: same building, substance, week or lab
   method.
3. **Topic map.** Topics from `related.py` (UMAP/HDBSCAN) with name-safe labels, zoomable from topic
   to sub-topic to documents.
4. **Near-duplicates and versions.** Collapse copies in results and compare them side by side. Tune
   the similarity threshold; 0.97 over-matches templated forms.
5. Curated **threads**: a few editor-written entry points, each quote verified against its page.
   Plus a **work-type-by-month** chart; see what sept11docs.com does well in
   `docs/research/…`.

**Accept when:**
- Related records are precise on a 100-document hand check.
- No private names appear in topic labels, checked by an automated scan plus a manual review of
  every label.

### Stage 3 — Ask anything

1. Retrieval → Claude → sentence-level citations → server-side validation → a frozen answer with a
   permalink.
2. States: reading records; insufficient evidence ("these records are not enough to answer that");
   identity-question refusal.
3. "What these records do not establish" and "You might not know to look for": semantically close
   records the answer didn't use.
4. Cost and abuse controls: per-IP rate limit, daily cap, no answers about named private
   individuals.

**Accept when:**
- On a 50-question eval set, 100% of shown sentences cite pages that support them (human-graded).
- Identity questions are refused.
- There are zero uncited sentences.

### Stage 4 — buildings, map and entities

1. **Place resolution.** Extracted BIN / block-lot / address → canonical BBL+BIN through Prospect's
   address normalizer and join, each with a confidence. See
   `docs/research/city-data-linkage.md` §2–3.
2. **Test extraction.** Page-level test records: substance + value + unit + date + lab + stated
   limit, labelled machine-extracted.
3. **Map** (MapLibre from Prospect).
   - Buildings coloured by record type, with a panel showing a timeline of tests and each reading
     linked to its highlighted page.
   - Filters: substance, date and record type.
   - Reference outlines for the WTC site, drawn and labelled approximate.
4. **Building pages**: everything about one address across all boxes. They are building files, never
   household profiles.
5. **Entity search and pages** for labs, agencies/offices, contractors, substances and
   **signatories by role** (official capacity only).
6. **City data joins.** DOB historical permits (85,198) and legacy violations (47,939) for 2001–02
   context, shown with dates. Present-day datasets are labelled as present-day.
7. ⚑ **Historical geometry** for buildings lost in 2001 (WTC 1/2/7, 90 West, Deutsche Bank,
   Fiterman): digitise by hand or find a source.

### Stage 5 — case folders, alerts, Spanish

1. **Case folder / binder.** Saved pages, notes, exhibit order and an exhibit-list export (Bates
   ranges + URLs + our permalinks). Stored in the browser first.
   - ⚑ Accounts or sync only if Henry wants them; they bring a privacy policy update and data
     handling.
2. **Saved-search alerts** via the OpenSearch percolator plus a monthly email digest.
   - ⚑ Needs accounts or email capture, and a mail provider.
3. ⚑ **Spanish UI.** Recommended, because immigrant day laborers who cleaned downtown apartments are
   a core affected group (a lesson from sept11docs.com).
4. ⚑ **Law-firm features** (subscription research tier, family-initiated intake), gated on NY
   ethics review. See `docs/research/…` and §3 rule 9.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The City locks down the Mindbreeze export or the tenant host | Paged-search fallback already exists (`enumerate.mjs --search`); the local mirror survives. |
| PII in served PDFs | Our own detector on OCR text before a page is public; fast restriction; removed docs never served; a report form on every page. |
| .nyc registry (the City) acts against the domain | Hold `911records.org` as a fallback; keep a nexus evidence pack; no PII republication; independent labelling. See `docs/research/domain-names.md`. |
| Nexus complaint with a 10-day window | Register through a business with an NYC street address; watch the registrant email. |
| AdSense rejects a thin site ("low value content") | Stage 1 content fixes it; re-request review after Stage 1. |
| Cloudflare large-file serving terms | Check before launch; a PDF subdomain with its own cache rules, or R2 if needed. |
| AI answer hallucination | Sentence-level citation validation, uncited sentences dropped, eval set gating Stage 3. |
| Two-host HA skew (chunk errors, index mismatch) | Prospect's rules: identical build args on both hosts, per-host readiness, `buildId` compared inside containers. |
| Scale of image-only OCR | Measure the blank rate first; batch Tesseract on StudioMac overnight; record quality. |

## 8. Open decisions for Henry ⚑

1. A public contact address for personal-information reports and press.
2. Whether and when to buy `911records.org` as the fallback domain.
3. Accounts (for alerts and synced case folders) versus browser-only.
4. Spanish UI in Stage 1 or Stage 5.
5. Law-firm features and ethics review.
6. A Claude API monthly cost cap for Ask.
7. Historical building geometry: hand-digitise or skip.

## 9. Resume checklist (first 10 minutes of a new session)

1. **Read this file**, then §4 of `README.md` (mirror scripts) and `docs/research/city-data-linkage.md`
   §8.
2. **Check the mirror:**
   `cat ~/Code/sept11-docs/data/download.progress.json`. Is the download still running? Check with
   `ps -axo pid,command | grep "[n]ode scripts/download"`; never `pgrep -f`.
3. **Check the loop:** `tail ~/Code/sept11-docs/data/embed/loop.log`. If the loop died, restart it
   with `nohup scripts/embed/loop.sh 1200 &` from the repo root.
4. **Check the site:**
   `curl -sI https://911records.nyc/`, `curl -s https://911records.nyc/ads.txt`, and
   `curl -sI https://www.911records.nyc/x` (expect a 301).
5. **Check AdSense:** approval status at
   `https://adsense.google.com/adsense/u/0/pub-9961054735948902/sites/list`.
6. **Start Stage 0.** Items 2–6 run while the download finishes. Brief an architect (Opus) with this
   plan, §5 and the Stage 1 acceptance criteria before any app code.
