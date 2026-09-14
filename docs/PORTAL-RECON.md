# 9/11 Document Portal — reconnaissance

Recon ran on 2026-09-13 against `https://sept11documents.cityofnewyork.us/`; the
portal launched 2026-09-08. About 150 HTTP requests were made to the portal and its
Mindbreeze backend, all sequential at ≤2 req/s with UA
`sept11-docs-research/0.1 (contact: digitalhen@gmail.com)`, plus two short
browser sessions. Five PDFs were downloaded (four distinct). Raw responses live
under `data/samples/` (gitignored). This document names no private individuals;
documents are referred to by Bates number only.

## TL;DR

- **Product.** The portal runs on **Mindbreeze InSpire**, a SaaS enterprise-search
  appliance. The backend is `https://nyc.mindbreeze.com/search/september-11/`
  (server 26.5.3.402), reverse-proxied at the city hostname. The boolean, NEAR
  and `^` operators are Mindbreeze query syntax, not dtSearch. The API is
  anonymous JSON; no auth, cookies or tokens are needed.
- **Enumeration: YES, trivially.** A single `POST
  https://nyc.mindbreeze.com/search/september-11/api/v2/export` returns the
  entire catalog as CSV: 24,436 rows, 8.06 MB, 24 s, verified 2026-09-13. The
  city hostname returns 404 for that path, so the Mindbreeze host is required.
  This was learned from prior art (§0) and confirmed live. Paged search also
  works, via offsets (a ceiling somewhere between 30k and 39.9k) or cursor
  `paging_states`.
- **Corpus (exact, 2026-09-13).** 24,436 documents, 172,537 pages and
  36,282,050,090 bytes (36.3 GB) of PDFs. Every PDF also has an OCR-markdown twin
  in the index. The largest file is 377 MB and the longest document is 620 pages.
- **Documents.** `GET https://sept11documents.cityofnewyork.us/apps/content/September11_MD/<Bates>.pdf`
  returns the original PDF.
- **Text.** Every PDF carries an ABBYY FineReader text layer, so `pdftotext` or
  pypdf yields the full text. The index's markdown twin is not downloadable;
  search returns only a snippet of it.
- **The corpus already changes.** Between the prior-art snapshot on 09-09 and
  today it lost 5 documents and 762 pages. A mirror must be versioned.

## 0. Prior art: `pranava0x0/sept11documents-mcp`

<https://github.com/pranava0x0/sept11documents-mcp> is cloned read-only at
`vendor/sept11documents-mcp` (gitignored), commit `3d96199`, 2026-09-11. It is an MCP
server and toolkit over the same portal, and it had already reverse-engineered
the API. The files that matter:

| File | What it gives us |
|---|---|
| `sept11/adapters/portal.py` | The whole client. `search` with `paging_states` plus `paging:{direction:"NEXT"}` cursor paging; **`/api/v2/export`** CSV catalog export; `facets` with `max_entries`; the PDF URL pattern; a CSV parser and summarizer. Etiquette is an honest UA, ≥1 s between requests, retry only on 429/5xx, check the `%PDF-` magic and the size against the catalog, and refuse redirects. |
| `sept11/core/citations.py` | `CONTENT_PATH = /apps/content/September11_MD/{bates}.pdf`; `normalize_bates()` strips `NYC-WTC0003/SPDF/PDF001/…`, `.pdf`, `_MD` and `.pdf_MD` down to `NYC-WTC_#########`. |
| `scripts/export_catalog.py`, `scripts/watchdog.py`, `sept11/storage/snapshots.py`, `sept11/core/catalog.py` | Daily snapshot of the export (`catalog_<date>_pdf.csv` plus a summary JSON with sha256). Snapshots are immutable and written once, with an accept/quarantine rule for >5% drops, and diffed by Bates into added/removed/changed plus page deltas. |
| `scripts/fetch_sources.py` | Text extraction via pypdf, written as `===== PAGE n =====` blocks. |
| `docs/data/catalog-summary.json` | Their 2026-09-09 baseline: 24,441 docs, 173,299 pages, 36,568,326,274 bytes, 74 boxes, 4,173 folders. |

**What was confirmed live on 2026-09-13, and what differs:**

| Claim in the repo | Live result |
|---|---|
| Export at `{base}/api/v2/export`, with base defaulting to the city host (`FRONT`) | **Only on the backend host.** The city host returns 404. The same body POSTed to `https://nyc.mindbreeze.com/search/september-11/api/v2/export` returns `200 text/csv` with header `Mindbreeze Key;Name;source;agency;box_name;folder_name;page_count;pdf_size;production_volume;production_end;related_document;Date;Search for "<query>"`. A partition test (`production_volume:NYC-WTC0005`) returned 21 rows and 1,588 pages; the full export returned 24,436 rows with 24,436 distinct names. Their `captured_at` note says the baseline was a "manual curl export" against `api_base: nyc.mindbreeze.com`, which is consistent. |
| Cursor paging with `paging_states` plus `paging:{direction:"NEXT"}` | **Works.** Page 1 and page 2 returned 100 results each with 0 overlap and `next_avail: true`. My own earlier attempt sent `paging_states` without the `paging` field, and **that** is what the server silently ignored. |
| `facets: [{name, max_entries}]` | Works, but `folder_name` is still truncated at 150 entries. Use the export for folder totals. |
| PDF at `/apps/content/September11_MD/{bates}.pdf` | Confirmed; see §4. |
| Counts | Their 09-09 figures were 24,441 / 173,299 / 36.57 GB. Today's are 24,436 / 172,537 / 36.28 GB: DEP −3, DDC −2, volume 0004 −3, volume 0007 −2. The removed Bates list could be recovered by diffing against their CSV, but they do not commit the CSV (it contains folder labels), only its sha256. |

## 1. What the site is

| Layer | Finding |
|---|---|
| Outer page `/` | Serves the Mindbreeze Workplace bootstrap HTML directly (`workplace/scripts/workplace.js?25.3.2.318`, `Mindbreeze.require(...)`). The app renders into the `#designer-container` shadow root. The Google Translate bar and the header tabs (FAQs, Disclaimers, How to Search, …) are fragments inside that root. There is no separate iframe document. |
| Config | `GET /apps/workplace-config/index.json` lists the modules `main.Welcome.html`, `base/base.Welcome.html` and `modules/base-search-qa.html`, plus the custom JS `base/base.Welcome.js`, `js/search-watch.js` and `js/downloadlink.js`. |
| Source info | `GET /api/v2/sourceinfo` lists the services search, suggest, sourceinfo, preview, personalization, persistedresources, persistedcollections and `mindbreeze.chat.v1beta`, all under `https://nyc.mindbreeze.com/search/september-11/api/v2/…`. |
| Data source | One source: `september11 Connector:September11_MD`. |
| PDF provenance | `/Creator (ABBYY FineReader Engine 12)` and `/Producer (iText 5.5.12 … Nuix Pty Ltd; licensed version)`. This is an eDiscovery production: processed in Nuix, OCRed with ABBYY, Bates-stamped `NYC-WTC_#########`, in volumes `NYC-WTC0001…0007`. |
| robots / sitemap | Both `/robots.txt` and `/sitemap.xml` return 404. |
| Edge | Responses carry `X-Cache-Status`. Content is served with `Cache-Control: public, max-age=3600` and `ETag: W/"<bytes>-<mtime ms>"`. No WAF challenge or 429 was seen. A `JSESSIONID` cookie is set but never required. |

## 2. APIs

### 2a. Catalog export (the enumeration path)

```http
POST https://nyc.mindbreeze.com/search/september-11/api/v2/export
Content-Type: application/json
Accept: text/csv

{ "search_request": {
    "count": 100,
    "properties": [ {"name":"mes:key","formats":["VALUE"]}, {"name":"title","formats":["VALUE"]},
                    {"name":"source",…}, {"name":"agency",…}, {"name":"box_name",…}, {"name":"folder_name",…},
                    {"name":"page_count",…}, {"name":"pdf_size",…}, {"name":"production_volume",…},
                    {"name":"production_end",…}, {"name":"related_document",…}, {"name":"mes:date",…} ],
    "user": { "query": { "and": [ { "unparsed": "ALL extension:pdf", "id": "query" } ] }, "constraints": [] },
    "source_context": { "constraints": [ { "unparsed": "ALL", "id": "view_base" } ] } },
  "export_format": "text/csv", "batch_size": 1000, "allow_duplicate": false, "groupby_properties": [] }
```

The response is a UTF-8 BOM followed by semicolon-delimited, RFC 4180-quoted CSV.
The last header column echoes the query, and `related_document` holds quoted
multi-line text. The full run took 8,062,370 bytes and 24.2 s, sha256
`33319629…4d657`, and the file is saved as `data/samples/catalog_2026-09-13_pdf.csv`.

### 2b. Search

```http
POST https://sept11documents.cityofnewyork.us/api/v2/search     (also works on the backend host)
{ "user": { "query": { "and": [ { "unparsed": "extension:pdf" } ] } },
  "count": 100, "max_page_count": 1,
  "properties": [ { "name": "title", "formats": ["VALUE"] } ],
  "facets": [ { "name": "agency", "max_entries": 100 } ],
  "orderby": "mes:size", "order_direction": "DESCENDING" }
```

- `formats: ["VALUE"]` is required to get typed values. `count` is capped at 100.
  `estimated_count` is rounded (24,500 for 24,436).
- The sortable fields are `mes:relevance`, `mes:date` and `mes:size`. Descending
  `mes:size` was verified monotone over 300 results.
- **Offset paging.** Send `result_pages: {qeng_ids: <from the first response>,
  pages: [{starts:[offset], counts:[100], page_number, current_page:true}]}`.
  With `*` (48,872 records including the markdown twins), offset 30,000 works and
  39,900 returns an empty result. With `extension:pdf`, every record up to the
  exact last one (24,436) was reached, and a repeated page came back identical.
  Results tie on relevance, so this path requires dedupe.
- **Cursor paging** (prior art, confirmed live). Send `paging_states:
  [per_service_dataset[].paging_state]` and `paging: {direction: "NEXT"}`.
- `unparsed` accepts `field:value`: `production_volume:NYC-WTC0005`,
  `box_name:"DEP Box 57"`, `agency:"Buildings, Dept. of"`,
  `title:NYC-WTC_000058160.pdf`. Terms are ANDed by listing several `unparsed`
  entries. Wildcards inside a field value fail, and short labels such as
  `agency:DOB` return 0 results.
- The browser's own request (captured in Chrome) is `name:"sept11search"`,
  `count:10`, `max_page_count:10`, `content_sample_length:300`, `facets:[index_hierarchy]`.

## 3. Counts — exact, from the 2026-09-13 export

| agency | docs | | production_volume | docs | | source | docs |
|---|---:|---|---|---:|---|---|---:|
| Environmental Protection, Dept. of | 21,392 | | NYC-WTC0001 | 133 | | DEP Hard Copies (68 Boxes) | 21,392 |
| Citywide Administrative Services, Dept. of | 2,915 | | NYC-WTC0002 | 4,998 | | WTC 7 | 3,023 |
| Fire Department | 96 | | NYC-WTC0003 | 3,355 | | DORIS Giuliani | 21 |
| Records and Information Services, Dept. of | 21 | | NYC-WTC0004 | 7,559 | | | |
| Design and Construction, Dept. of | 9 | | NYC-WTC0005 | 21 | | | |
| Buildings, Dept. of | 3 | | NYC-WTC0006 | 5,347 | | | |
| **total** | **24,436** | | NYC-WTC0007 | 3,023 | | | |

The corpus has 74 boxes and 4,172 folders.

**Pages:** Σ `page_count` = **172,537**, which exactly equals Σ(`production_end` −
Bates start + 1). The highest Bates end is 174,150, so 1,613 Bates numbers are
not in the portal (withheld or removed, or never produced).

Correction: my pre-export estimates (≈152k pages, ≈41 GB, from sampling) were
low on pages and high on bytes. The exact figures above supersede them.

## 4. Identifiers and URLs

| Identifier | Example | Notes |
|---|---|---|
| Bates start (`Name`/`title`) | `NYC-WTC_000058160.pdf` | Stable. It is the document ID and the download filename, and all 24,436 names end in `.pdf`. |
| `production_end` | `NYC-WTC_000058162` | Pages = end − start + 1, which holds for every row. |
| `mes:key` | `NYC-WTC0003/SPDF/PDF001/NYC-WTC_000058160.pdf`, or `NYC-WTC_000165863` in some volumes | Its shape varies by volume, so reduce it with `normalize_bates()`. |
| `related_document` | `header { key: "<own key>.pdf_MD" … kind: REFERENCE }` | Every one of the 24,436 rows points at **its own** markdown twin. It is not a cross-document relation. |
| `Date` (export) / `mes:date` | `2026-08-05 12:27:22` | The crawl/index time, not a document date. |
| `mes:docid`, preview `docid=` | `4645570810203938549` / `2` | Assigned per index or per query. Never store these. |

**PDF.** `GET https://sept11documents.cityofnewyork.us/apps/content/September11_MD/<Bates>.pdf`
returns `200 application/pdf` with `Content-Length = pdf_size`,
`Content-Disposition: inline`, an ETag and a Last-Modified header. The same URL
is what the portal's Download link builds (`js/downloadlink.js`). A fallback,
`/content?key=<mes:key>&category=september11+Connector&category_instance=September11_MD&category_class=default&query_service_location=https%3A%2F%2Flocalhost%3A23301&disposition=false&fetch_from_index=true`,
serves a re-serialized copy: 476,243 B against the original's 472,025 B, with
the same pages and text.

**OCR text.**
- The markdown twin is not served. `<Bates>.pdf.md` and `<Bates>.pdf_MD` both
  return 404, and `/content?key=…_MD` returns the PDF.
- The search `content` property is only a snippet (about 1.8k characters of
  HTML), even with `content_sample_length: 100000`.
- **Extract text from the PDF layer instead**, using `pdftotext -layout` or pypdf
  as the prior art does.

## 5. Metadata per document

The metadata fields are: Bates start/end, source, agency, box_name, folder_name
(a hand-labelled folder, e.g. `GCMS X 3/2/02 A 3/27/02`, and the richest
descriptor), production_volume, page_count, pdf_size and the index date.

**Absent:** document date, document type, author/recipient and a descriptive
title. These must be derived from the OCR text and folder labels, and labelled
as derived.

## 6. OCR quality (one sample, counts only)

Sample: `NYC-WTC_000058160.pdf`, DEP lab data sheets, 3 pages. `pdftotext
-layout` produced 478 tokens: 181 alphabetic, 232 containing digits (tabular
results) and 8 junk (~1.7%). A one-page sample from volume 0007 gave 41 words.

The text is usable for full-text search, and layout-heavy forms come out as
whitespace-aligned columns. The Disclaimers tab says the city also ran a
handwriting-to-text pass. Whether that text is in the PDF layer or only in the
markdown twin is **unverified**; compare `pdftotext` with the search snippet on
a handwritten page. One sample is not a survey, so score a stratified sample
per volume.

## 7. Size and time

| | Value |
|---|---|
| Metadata | 1 request, 8.06 MB, 24 s |
| PDFs | 24,436 files, 36.28 GB (exact, from the export). Median 315 KB, p90 2.8 MB, p99 15.0 MB. 23 files exceed 100 MB and the largest is 377 MB. The top 300 files hold 13.41 GB (37%). Files of 10 MB or less hold 59.5% of the bytes. |
| Text | Estimate ~0.5–1.5 GB of plain text (172k pages at 3–9 KB/page, unmeasured) |
| Download time | Request slots at 1 req/s are ≥6.8 h, but bandwidth dominates: 36 GB at 5 MB/s ≈ 2 h, at 1 MB/s ≈ 10 h. Plan on one overnight run with resume. Throughput was not measured. |

## 8. Terms, robots, reuse

- **robots.txt:** none (404).
- **Welcome message** (`base.Welcome.html`, Corporation Counsel): "All
  documents available through this portal may be viewed and downloaded free of
  charge." It also says PII was redacted but inadvertent disclosure may occur,
  and points readers to the "Notify Us About Personal Information" tab.
- **Disclaimers tab** (`main.Disclaimers` fragment, read in the browser;
  paraphrased). It contains accuracy caveats only: search relies on OCR and a
  handwriting-to-text conversion, neither is fully accurate, and previews
  download the whole PDF, some of which are very large. It says **nothing** about
  copyright, reuse, redistribution, automated access or scraping.
- **FAQ tab** (`main.FAQ`, paraphrased).
  - **Contents:** DEP paper records found in August 2025, DORIS City Hall
    records, a WTC 7 set, and records from other agencies, most of them until
    recently held by the World Trade Center Captive Insurance Company.
  - **Size and schedule:** more than 170,000 pages at launch, with more posted
    on a rolling basis over the next year.
  - **Withheld:** only PII is named as withheld.
  - **Reuse:** a keyword scan for copyright, reuse, redistribution, permission,
    terms of use, bulk, automated, scraping, public domain and licence found
    **0 matches**.
- **Net:** there is no robots file, no terms of use, and no stated restriction
  on reuse or automated retrieval. Stay polite anyway: descriptive UA, 1 req/s,
  backoff, off-peak. Before a full mirror, send a courtesy note to the Law
  Department. Republishing needs a PII takedown path, because the city itself
  expects missed redactions.

## 9. `scripts/fetch_sample.mjs` (end-to-end proof)

Node 20+, no dependencies; `pdftotext` is optional. It lists N documents,
either with paged search (default) or with the catalog export (`--export`),
writes `listing.json`, and downloads the smallest listed PDF along with its
metadata JSON, the `pdftotext` OCR text and the markdown-twin snippet.

Search mode (run 2026-09-13):

```
$ node scripts/fetch_sample.mjs 'extension:pdf' 25 data/sample_fetch
query="extension:pdf" estimated_count=24500
listed 25 (distinct 25) -> data/sample_fetch/listing.json
  NYC-WTC_000165863  vol=NYC-WTC0007 pages=1 bytes=42798
  NYC-WTC_000165890  vol=NYC-WTC0007 pages=2 bytes=114314
  NYC-WTC_000165898  vol=NYC-WTC0007 pages=2 bytes=102235
  NYC-WTC_000165927  vol=NYC-WTC0007 pages=11 bytes=702274
  NYC-WTC_000165864  vol=NYC-WTC0007 pages=1 bytes=23074
downloaded NYC-WTC_000165864.pdf: 23074 bytes (declared pdf_size 23074), pages=1, ocr_words=41, md_snippet_chars=387, etag=W/"23074-1786501332000"
```

Export mode (run 2026-09-13; one request lists the whole partition):

```
$ node scripts/fetch_sample.mjs --export 'ALL extension:pdf production_volume:NYC-WTC0005' 25 data/sample_fetch_export
export query="ALL extension:pdf production_volume:NYC-WTC0005" rows=21 bytes=6287
listed 21 (distinct 21) -> data/sample_fetch_export/listing.json
  NYC-WTC_000136542  vol=NYC-WTC0005 pages=128 bytes=9243745
  NYC-WTC_000136819  vol=NYC-WTC0005 pages=78 bytes=2512839
  NYC-WTC_000136990  vol=NYC-WTC0005 pages=123 bytes=4580519
  NYC-WTC_000137249  vol=NYC-WTC0005 pages=2 bytes=22380
  NYC-WTC_000137282  vol=NYC-WTC0005 pages=24 bytes=588971
downloaded NYC-WTC_000137249.pdf: 22380 bytes (declared pdf_size 22380), pages=2, ocr_words=49, md_snippet_chars=320, etag=W/"22380-1786046068000"
```

Box names are elided from the transcripts.

## 10. Open risks

1. **The corpus mutates.** It lost 5 documents and 762 pages between 09-09 and
   09-13, and new volumes and agencies (NYPD, DOHMH, EDC) are announced. Diff a
   daily export by Bates. Never overwrite a PDF whose ETag or size changed; keep
   both versions.
2. **The export depends on the Mindbreeze tenant host.** The city could lock
   down `nyc.mindbreeze.com` or the export service at any time. Keep the paged
   search path, capped at 100 per request, working as a fallback, and snapshot
   the CSV every run.
3. **Paging.** Offset paging has a ceiling between 30k and 39.9k and returns
   results in tie order, so partition by volume and dedupe. Cursor paging is
   verified for only two pages here; assert that no Bates repeats, as the prior
   art does.
4. **Rate limiting and WAF.** None was seen over ~150 sequential requests. The
   origin is Mindbreeze SaaS, so back off on 429/5xx and stop on sustained
   403s. Because nyc.gov answers 403 to bare clients (per the prior art's
   notes), keep sending a descriptive UA.
5. **Huge files.** Stream to disk and verify size against `pdf_size` and the
   `%PDF-` magic. Range requests were not tested.
6. **Handwriting text.** It may exist only in the index's markdown twin, which
   we cannot download (§6).
7. **PII.** Unredacted names may exist. The explorer needs a takedown path that
   mirrors the city's corrections: when a document disappears or changes, hide
   ours.

## 11. Recommended ingest design

```
1. Daily: POST backend /api/v2/export ("ALL extension:pdf") → store catalog_<date>.csv immutably + sha256.
   Parse with normalize_bates(); quarantine a snapshot that drops >5% (prior-art rule); diff vs last accepted.
2. Upsert SQLite docs(bates PK, source, agency, box, folder, volume, bates_end, page_count, pdf_size,
   first_seen, last_seen, removed_at); added → download queue; removed → removed_at (hide, never hard-delete).
3. Download worker: 1 req/s, GET /apps/content/September11_MD/<bates>.pdf → .tmp, verify %PDF- + size ==
   pdf_size, sha256, rename into data/pdf/<volume>/; store ETag/Last-Modified; size/ETag change → new version.
4. Text: pdftotext -layout, split on \f → pages(bates, page_no, bates_page, text) + SQLite FTS5 (or Typesense).
5. Derive (labelled "derived"): dates, addresses/buildings, sampling results, entity mentions per page.
6. Serve PDFs from our mirror (survives removal for audit, but honour takedowns) or link to the city URL.
7. Fallback if export is blocked: paged search per production_volume, dedupe on Bates, assert counts.
8. Log per run: requests, 4xx/5xx, bytes; stop on sustained 429/403. Courtesy note to the Law Dept first.
```
