# 911records.nyc — build plan

Plan of record, written 2026-09-13 (ET) so work can resume cold after a session reset.
Owner: Henry. Repo: `github.com/digitalhen/911records` (private), local `~/Code/sept11-docs`.

---

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

## 2. Decisions locked (Henry, 2026-09-13)

| Decision | Choice |
|---|---|
| Domain | **911records.nyc**. `www` redirects to the apex. Cloudflare DNS + tunnel. |
| Hosting | Dokploy on **both** StudioMac (.51) and MonsterMac (.52), HA with no affinity, the same pattern as Henry's other sites. |
| Repo | `digitalhen/911records` (private). Pushes to `main` redeploy the watched paths. |
| Search | **OpenSearch in production.** Hybrid BM25 + vectors, facets, highlighting and saved-search percolation. |
| PDFs | **Serve our local mirror**, not links to the City's copies. The City's URL stays alongside as the official citation. |
| Logo | Revision 2 (`design/logo/`): `mark.svg` + `lockup.svg` for identity, `mark-compact.svg` + `lockup-horizontal.svg` for favicon and header. |
| Ads | Google AdSense, tasteful: one labelled unit per page below the content, never inside a document or an answer. Publisher `ca-pub-9961054735948902`. |
| Search UX | One **Ask anything** box that takes a question, keywords or a Bates number, plus entity search. |
| Discovery | Embeddings, topics, related records "filed elsewhere", near-duplicates, and a building map linked to tests. |
| People | Officials and professionals are searchable only **as a role on a record** (signed, approved, analyzed, inspected). Private individuals are never surfaced. |

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
5. **A written, visible personal-information policy** with a fast takedown path. Our own PII check
   runs on top of the City's redactions. The City's redactions fail by composition, e.g. a name
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

## 4. Where things stand at the reset (2026-09-13 ~23:10 ET)

**Live:**
- **The site:** `https://911records.nyc` serves the **holding page** (`site/holding/`: static nginx,
  `/privacy`, `/ads.txt`, security headers) from both Dokploy instances.
  - Dokploy project **"Sept11 Records"**, app **"Holding page"**, on StudioMac and MonsterMac.
  - Dockerfile build, path `/site/holding`, watch path `site/holding/**`.
  - Domains `911records.nyc` and `www.911records.nyc`, HTTP port 80. TLS terminates at Cloudflare.
- **AdSense:**
  - Site added and verified via ads.txt; review requested, status "Getting ready".
  - Display unit `4391479569` ("911records.nyc display") is on the holding page.
  - Check whether the EU consent message exists for the new site (Privacy & messaging).

**Running on StudioMac:**
- **Mirror download** (`scripts/download.mjs`, owned by teammate `mirror-build`).
  - Progress file: `data/download.progress.json`. At the reset it stood at 4,787 / 24,436 documents,
    0.5% of bytes, 0 errors, with an ETA of about 1 pm ET 09-14. Large files come last, so expect
    longer.
  - Resumable; the pidfile is `data/download.pid`.
- **Text/embedding/entity loop** (`scripts/embed/loop.sh 1200`).
  - Lock: `data/embed/loop.lock`. Log: `data/embed/loop.log`.
  - Every 20 min it runs `extract_text.mjs --jobs 2`, then `pages.py` (nomic-embed-text via Ollama),
    then `entities.py` (regex).
  - At the reset: 4,214 docs with text; pages 3,217 ok / 1,643 empty (image-only) / 14 junk; 2,259
    role mentions, 353 of them official.
- **OpenSearch 2.19.2** container `sept11-opensearch`.
  - Dev only: 127.0.0.1, security plugin off.
  - The index `sept11-pages-v1` holds only **588** pages and is **not** reindexed automatically.
- **Ollama** with `nomic-embed-text`. The GLiNER model is installed in `.venv` but untested.

**Built but not productised:**
- `scripts/embed/`: `related.py` (doc vectors, filed-elsewhere, near-dupes, topics), `search.py`
  (SQLite hybrid prototype), `places.py` (BIN/BBL/address → buildings, GeoJSON),
  `entities.py` (labs, contractors, roles).
- `scripts/search/opensearch.py`: index mapping, bulk indexer, hybrid query.
- `data/geo/`: lower-Manhattan footprints from NYC Open Data `5zhs-2jue` (4,764 buildings) and
  `bin_lookup.csv`.

**Design:**
- Astra round 2 prototype: `design/astra/`, published at
  `https://claude.ai/code/artifact/c8f2af42-99f4-4109-8843-430d826def18`. The fixtures are fictional:
  `NYC-WTC_9…` Bates numbers, but invented readings on a real address, so never ship them.
- Logo: `design/logo/`.

**Research:**
- `docs/PORTAL-RECON.md`: API, export endpoint, counts.
- `docs/CONTEXT.md`: the release and outside sources.
- `docs/research/epstein-explorers.md`: design and privacy lessons.
- `docs/research/city-data-linkage.md`: BIN/BBL joins, DOB 2001–02 data, reuse of Prospect.
- `docs/research/domain-names.md`: domains and the .nyc policy.

## 5. Architecture

```
City portal ──(daily export + polite download)──► StudioMac pipeline (~/Code/sept11-docs)
                                                   │ catalog snapshots, diff, PDFs, text, OCR,
                                                   │ embeddings, entities, places, topics
                                                   ▼
                          Postgres `sept11` (central .51:5433, replica .52)   ← source of truth
                          PDF mirror (StudioMac) ──rsync──► MonsterMac copy    ← served files
                                                   │
                         build_index ──► OpenSearch node per Dokploy host      ← search/discovery
                                                   ▼
             Next.js app (Dokploy, both hosts) ── Claude API (Ask) ── AdSense ── Cloudflare tunnel
```

- **App.** Next.js (App Router) + TypeScript, the same stack as Prospect. Reuse Prospect's
  MapLibre setup (`lib/maplibre.ts`, `lib/mapPalette.ts`, `lib/buildings.ts`, the footprint
  pipeline), its address normalizer (`lib/address/normalize.ts`) and its env/compose discipline.
  Server components read Postgres and OpenSearch; there is no client-side database access.
- **Source of truth.** A new database `sept11` on the central Postgres (.51:5433) with the existing
  read replica (.52). Tables:
  - `documents`, `pages`
  - `snapshots`, `changes`
  - `entities`, `roles`
  - `places`, `place_pages`
  - `topics`, `doc_topics`, `related`
  - `redaction_reports`
  - `answers` (frozen answers with citations, for permalinks)

  The pipeline writes it and the app only reads. Report submissions go through a narrow API.
- **Search.** One OpenSearch single-node cluster **per Dokploy host**, the same per-host pattern
  Prospect chose for Typesense.
  - Security plugin ON, TLS, internal network only.
  - Built by the pipeline from Postgres, one document per page: text, vector, facets and
    officially-acting roles.
  - Readiness = document-count parity with Postgres. The app falls back to Postgres FTS when a node
    is not ready.
  - A percolator index for saved-search alerts (stage 5).
- **PDFs.**
  - The canonical mirror is on StudioMac (`data/pdf/…`), rsynced nightly to MonsterMac.
  - Each Dokploy host mounts it read-only into an nginx sidecar at `/pdf/<Bates>.pdf` with HTTP
    Range and long cache headers. The browser viewer is pdf.js.
  - A generated deny-list blocks removed or restricted documents.
  - Cloudflare caches public PDFs. That allows Cloudflare's CDN terms for large files: check them
    before launch, or serve PDFs from a subdomain with caching rules.
- **AI answers.** The server retrieves (hybrid) and calls the Claude API with only the retrieved
  pages. The model is chosen at build time per the `claude-api` reference.
  - Output is structured as sentences, each with cited page IDs.
  - The server drops any sentence whose citations aren't in the retrieved set, and refuses identity
    questions.
  - Answers are stored with frozen citations and a permalink.
  - Rate limits, a monthly cost cap and an API key in the env (both compose files, per Prospect's
    env rule).
- **Map.** MapLibre 2D and 3D from Prospect. Lower-Manhattan footprints plus `places` from the
  pipeline.
  - Colour shows *what records exist* (lab result / inspection / mention), never a health verdict.
  - Buildings lost in 2001 need a separate, hand-digitised layer.
- **Change log.** Daily `enumerate.mjs` → `diff_catalog.mjs` → `download.mjs` (new documents) →
  extract/OCR/embed/entities → Postgres → reindex. Run by launchd on StudioMac with a status row
  and alerting.

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
