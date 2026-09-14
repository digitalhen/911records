# 9/11 Document Portal — reconnaissance

Recon run 2026-09-13 (portal launched 2026-09-08) against
`https://sept11documents.cityofnewyork.us/`. About 140 HTTP requests to the portal
in total (plus two short browser sessions), all sequential at ≤2 req/s with UA
`sept11-docs-research/0.1 (contact: digitalhen@gmail.com)`. Four PDFs were
downloaded (three distinct documents). Raw responses are under `data/samples/`
(gitignored). No personal names appear in this document; documents are
referred to by Bates number only.

## TL;DR

- **Product: Mindbreeze InSpire** (a SaaS enterprise-search product). The
  backend is `https://nyc.mindbreeze.com/search/september-11/` (server
  26.5.3.402), reverse-proxied at the city hostname. The client is the
  Mindbreeze "Workplace" SPA (25.3.2.318) rendered into a shadow root. There is
  **no dtSearch**: the boolean/NEAR/`^` syntax is Mindbreeze's query language.
- **The API is open JSON, with no auth, cookies or tokens required.**
  `POST /api/v2/search` returns results, metadata and facets.
- **Downloads:** `GET /apps/content/September11_MD/<title>` returns the
  original PDF.
- **Enumeration is feasible: YES**, with one caveat. Each request returns at
  most 100 results, and offset paging stops working somewhere between offsets
  30,000 and 39,900. A plain match-all walk (48,872 index records) therefore
  cannot reach the tail. Filtering to `extension:pdf` (24,436 records) is fully
  pageable, and was verified to the exact last record. Partitioning by
  `production_volume` (at most 7,559 PDFs per volume) keeps every walk short.
- **Corpus:** **24,436 documents** (PDFs), each with an OCR-markdown twin in the
  index. There are an estimated **~152k pages**; the city says ~170k, and the
  highest Bates number seen is 166,488. The corpus is roughly **~41 GB**; the
  largest single PDF is 377 MB.
- **OCR text:** every PDF carries an ABBYY FineReader Engine 12 text layer, so
  the full text comes from `pdftotext`. The index's markdown twin is **not**
  downloadable; the API returns only a snippet of it.

## 1. What the site is

| Layer | Finding |
|---|---|
| Outer page `/` | Serves the Mindbreeze Workplace bootstrap HTML directly: `workplace/scripts/workplace.js?25.3.2.318`, `Mindbreeze.require(...)`, app rendered into `#designer-container` shadow root. The Google Translate bar and the header tabs (FAQs, Disclaimers, How to Search, …) are app fragments inside that shadow root. There is no separate iframe document at a different origin. |
| Config | `GET /apps/workplace-config/index.json`. It lists the modules `main.Welcome.html`, `base/base.Welcome.html` and `modules/base-search-qa.html`, plus the custom JS files `base/base.Welcome.js`, `js/search-watch.js` and `js/downloadlink.js`. |
| Source info | `GET /api/v2/sourceinfo`. It advertises the services `search`, `suggest`, `sourceinfo`, `preview`, `personalization`, `persistedresources`, `persistedcollections` and `mindbreeze.chat.v1beta`, all rooted at `https://nyc.mindbreeze.com/search/september-11/api/v2/…`. |
| Data source | One datasource, `september11 Connector:September11_MD`. |
| Provenance in the PDFs | `/Creator (ABBYY FineReader Engine 12)` and `/Producer (iText 5.5.12 … Nuix Pty Ltd; licensed version)`. This is an **eDiscovery production**: Nuix processed it, ABBYY did the OCR, and each document is Bates-stamped `NYC-WTC_#########` across production volumes `NYC-WTC0001…0007`. |
| robots / sitemap | `/robots.txt` returns **404** and `/sitemap.xml` returns **404**, so there is no robots policy. |
| Caching / edge | Responses carry `X-Cache-Status` (nginx-style cache). Content has `Cache-Control: public, max-age=3600` and `ETag: W/"<bytes>-<mtime ms>"`. No WAF challenge, CAPTCHA or 429 was seen at this rate. A `JSESSIONID` cookie is set, but no request needed it. |

## 2. The search API

### Request (minimal, proven with curl)

```http
POST https://sept11documents.cityofnewyork.us/api/v2/search
Content-Type: application/json

{
  "user": { "query": { "and": [ { "unparsed": "extension:pdf" } ] } },
  "count": 100,
  "max_page_count": 1,
  "properties": [ { "name": "title", "formats": ["VALUE"] }, { "name": "agency", "formats": ["VALUE"] } ],
  "facets": [ { "name": "agency", "count": 100 } ],
  "orderby": "mes:size", "order_direction": "DESCENDING"
}
```

- **`formats: ["VALUE"]` is required** to get typed values (`{"str":…}` /
  `{"num":…}`). Without it the data items carry no `value` key.
- **`count` is capped at 100.** Asking for 200 or 1000 returns 100 results with
  `termination_cause: COUNT_LIMIT`.
- `estimated_count` is rounded: it reports 24,500 for 24,436. Use facet counts
  for exact totals.
- `orderable`: `mes:relevance` (default), `mes:date`, `mes:size`. Ordering by
  `mes:size` DESCENDING was verified monotone over the top 300.
- Facets are truncated at 150 values (`folder_name` covered only 16,084 of
  48,872 records).

The real browser request (captured in Chrome) adds `name: "sept11search"`,
`count: 10`, `max_page_count: 10`, `content_sample_length: 300`, `facets:
[index_hierarchy]` and a `query_context`. None of those are required.

### Paging (offsets)

The first response with `max_page_count ≥ 1` returns
`resultset.result_pages.qeng_ids`. To get any later page, repeat the same
request with:

```json
"result_pages": {
  "qeng_ids": [ …copied from the first response… ],
  "pages": [ { "starts": [OFFSET], "counts": [100], "page_number": OFFSET/100, "current_page": true } ]
}
```

These results were measured with `*` (48,872 records):

- Offsets 100, 1,000, 10,000, 10,100, 15,000, 20,000 and 30,000 each return 100
  results, with no overlap with page 0.
- Offset 39,900 and 40,000 returned an empty resultset. The ceiling lies
  somewhere in (30,000, 39,900]; it was not pinned further.

These results were measured with `extension:pdf` (24,436 records):

- Offset 24,300 returns 100 results, offset 24,400 returns 36, and offset
  24,436 returns 0. **All records were reached** (24,400 + 36 = 24,436).
- The same page requested twice returned an identical ID list.
- Adjacent pages overlapped by 0.
- **Caveat:** within a match-all page every result has the same relevance
  `order` value, so the walk is ordered by ties. It was stable across repeats
  here, but stability over a whole walk while the index changes is not proven.
  The ingest must dedupe on `mes:key` and reconcile against facet counts.

`paging_states` and `order_next_result` (keyset-style fields in the response)
were tried as request fields. They are silently ignored and page 0 comes back.

### Query syntax (partitioning)

`unparsed` accepts `field:value` constraints:

| Query | estimated_count (records) |
|---|---|
| `*`, empty, `ALL` | 48,900 (exact 48,872) |
| `extension:pdf` / `extension:md` | 24,500 each (exact 24,436 each) |
| `production_volume:NYC-WTC0005` | 42 |
| `box_name:"DEP Box 57"` | 768 |
| `agency:"Buildings, Dept. of"` | 6 |
| `agency:DOB` | 0 (the full label is required) |
| `title:NYC-WTC_000058160.pdf` | 2 (the PDF and its md twin) |
| `title:NYC-WTC_00005816*` | no resultset (field wildcards are not supported) |

Queries can be ANDed as multiple `unparsed` entries, for example
`[{unparsed:"title:X"},{unparsed:"extension:md"}]`.

## 3. Counts (from facets on `*`, 2026-09-13)

Every document appears twice in the index (`extension:pdf` and
`extension:md`), so the documents column is records ÷ 2.

| agency | records | documents |
|---|---:|---:|
| Environmental Protection, Dept. of | 42,784 | 21,392 |
| Citywide Administrative Services, Dept. of | 5,830 | 2,915 |
| Fire Department | 192 | 96 |
| Records and Information Services, Dept. of | 42 | 21 |
| Design and Construction, Dept. of | 18 | 9 |
| Buildings, Dept. of | 6 | 3 |
| **total** | **48,872** | **24,436** |

| production_volume | records | | source | records |
|---|---:|---|---|---:|
| NYC-WTC0004 | 15,118 | | DEP Hard Copies (68 Boxes) | 42,784 |
| NYC-WTC0006 | 10,694 | | WTC 7 (DCAS+FDNY+DDC+DOB) | 6,046 |
| NYC-WTC0002 | 9,996 | | DORIS Giuliani | 42 |
| NYC-WTC0003 | 6,710 | | | |
| NYC-WTC0007 | 6,046 | | | |
| NYC-WTC0001 | 266 | | | |
| NYC-WTC0005 | 42 | | | |

`box_name` has 73 values, the largest holding 5,830 records. The DEP source is
the "68 Boxes".

**Pages:** the `page_count` facet is truncated, so it is unusable for totals.
The page estimate combines the exact top 300 PDFs by size (22,446 pages) with a
random sample of 963 other PDFs (mean 5.39 pages each), giving **≈152,400
pages**. That sits against the city's "approximately 170,000 pages" and the
highest Bates end seen, 166,488. Bates numbers run contiguously within
volumes, so `max(production_end)` from a full listing is the exact answer.

## 4. Document identifiers and URLs

| Identifier | Example | Stability |
|---|---|---|
| `title` | `NYC-WTC_000058160.pdf` | Stable. It is the Bates start and the download filename. |
| `production_end` | `NYC-WTC_000058162` | Stable (Bates end). Pages = end − start + 1, which matches `page_count`. |
| `mes:key` (datasource key) | `NYC-WTC0003/SPDF/PDF001/NYC-WTC_000058160.pdf`, with the md twin at `…pdf_MD` | Stable, but **the format varies by volume**: some volumes key without `.pdf` (`NYC-WTC_000165863`, `NYC-WTC_000136391_MD`). Treat it as opaque. |
| result `id` | `september11 Connector:September11_MD:<mes:key>:` | Derived from `mes:key`. |
| `mes:docid` / preview `docid=` | `4645570810203938549` / `2` | Per-index and per-query. **Do not store as an identity.** |

**Download (what the portal's own "Download" link does):**

```
GET https://sept11documents.cityofnewyork.us/apps/content/September11_MD/<title>
→ 200 application/pdf, Content-Length = pdf_size, Content-Disposition: inline,
  ETag: W/"472025-1785932768000", Last-Modified: Wed, 05 Aug 2026 12:26:08 GMT
```

The page's JS builds the link as `../apps/content/September11_MD/<title>`.
`js/downloadlink.js` has a fallback that rewrites the preview URL's path to
`/content`; that path also works, but it serves a re-serialized copy:

```
GET /content?key=<mes:key urlencoded>&category=september11+Connector&category_instance=September11_MD
    &category_class=default&query_service_location=https%3A%2F%2Flocalhost%3A23301&disposition=false&fetch_from_index=true
→ 200 application/pdf (476,243 B for the 472,025 B original; same 3 pages, same text layer)
```

The preview action is
`https://nyc.mindbreeze.com/search/september-11/apps/pdfviewer/index.html?docid=…&key=…`,
a pdf.js viewer over the same content.

**OCR text:**
- `…/September11_MD/<title>.md` and `…/<title>_MD` both return **404**.
- `/content?key=…pdf_MD` returns the PDF, not the markdown.
- The search `content` property returns only a hit-highlighted snippet, about
  1.8k characters of HTML, even with `content_sample_length: 100000`.
- The markdown twin's `mes:size` (6,685 B for the 3-page sample) shows it is
  small, but it is not exposed.
- **Use the PDF text layer** (`pdftotext -layout`).

## 5. Metadata per document

These fields are present on every sampled record: `title`, `agency`,
`source`, `box_name`, `folder_name` (the richest descriptor — a
hand-labelled folder name, e.g. `GCMS X 3/2/02 A 3/27/02`), `production_volume`,
`production_end`, `page_count` (string), `pdf_size` (bytes), `full_filename`,
`mes:key`, `extension`, `mes:size`, `contenttype` (`markdown` on the twin),
`related_document` (null in every sample) and the `actions` (Open / Preview).

**Absent:** document date, document type, author/recipient and a descriptive
title. `mes:date` is the *index* date (identical, 2026-09-08, on every record),
not a document date. The PDF's `/ModDate` is the production date
(2026-06-17), not a record date. Dates and types would have to be derived from
the OCR text and `folder_name`.

## 6. OCR quality (one sample, counts only)

For `NYC-WTC_000058160.pdf` (DEP lab data sheets, 3 pages, 472 KB),
`pdftotext -layout` gave 478 tokens: 181 purely alphabetic words, 232 tokens
containing digits (tabular lab results) and 8 junk tokens (~1.7%), from 7,797
characters. The text is usable for full-text search. Layout-heavy forms come
through as whitespace-aligned columns. The Disclaimers tab says the city also ran a
handwriting-to-text pass. Whether that text is in the PDF layer or only in the
index's markdown twin is **unverified**. Compare `pdftotext` with the search
snippet on a handwritten page before relying on the PDF layer alone.
The 1-page sample from volume 0007 gave 41 words. One sample is not a quality
survey; score a stratified sample per volume before trusting it.

## 7. Size and time estimate

| Quantity | Value | Basis |
|---|---|---|
| Documents | 24,436 | Exact, from facets |
| Bytes, top 300 PDFs | 13.41 GB | Exact (`orderby mes:size`); largest 377,056,038 B, 300th 12.9 MB |
| Bytes, other 24,136 | ≈27.3 GB | Random sample of 963: mean 1.13 MB, median 416 KB |
| **Total bytes** | **≈41 GB** (plausible range 30–50 GB) | Heavy-tailed; a full metadata listing gives the exact sum of `pdf_size` |
| Pages | ≈152k (city: ~170k) | As above |
| Listing cost | ≈245 requests for PDFs (100 each), about 2 min at 2 req/s; ≈250 more to list the md twins, which is unnecessary | |
| Download cost | 24,436 GETs; at 1 req/s that is ≥6.8 h of request slots, and bandwidth dominates: 41 GB at 5 MB/s ≈ 2.3 h | Throughput was not measured. Plan on an overnight run with resume. |

## 8. Terms, robots, reuse

- `robots.txt`: none (404).
- Welcome message (base.Welcome.html, Corporation Counsel):
  "All documents available through this portal may be viewed and downloaded
  free of charge."
- The same message says PII was redacted but that "an inadvertent disclosure
  may occur". The portal has a "Notify Us About Personal Information" tab for
  reporting it.
- **Disclaimers tab** (read in the browser; it renders from the app fragment
  `main.Disclaimers`, which is not a standalone file). It contains only
  accuracy caveats, paraphrased here:
  - search relies on OCR, and on a separate handwriting-to-text conversion;
  - neither process is fully accurate, handwriting especially;
  - previewing downloads the whole PDF, and some PDFs are very large.

  It says **nothing** about copyright, reuse, redistribution, automated access
  or scraping.

- **FAQ tab** (the `main.FAQ` fragment, read in the browser; paraphrased).
  - **Contents:** DEP paper records found in August 2025, City Hall records
    held by DORIS, a WTC 7 set, and records collected from other agencies.
    Most were held until recently by the World Trade Center Captive Insurance
    Company.
  - **Size and schedule:** more than 170,000 pages at launch, with further
    documents posted on a rolling basis over the next year. Review of a large
    additional set of agency records is ongoing.
  - **Withheld:** only PII is named.
  - **Reuse:** a keyword scan of the whole FAQ for copyright, reuse,
    redistribution, permission, terms of use, bulk, automated, scraping,
    public domain and licence found **0 matches**.
- **Net:** there is no robots file, no terms of use, and no stated restriction
  on reuse or automated retrieval. The city's only statement on access is the
  free view-and-download line above. Politeness is still the right default: a
  descriptive UA, 1 req/s, backoff, off-peak runs, and a courtesy note to the
  Law Department before a full mirror. Redistributing the files ourselves
  deserves a PII-takedown process, because the city itself expects missed
  redactions.

## 9. `scripts/fetch_sample.mjs` (end-to-end proof)

Node 20+ with no dependencies; `pdftotext` is optional and used for the OCR
text. It lists N results through `/api/v2/search` with offset paging, writes
`listing.json`, and downloads the smallest listed PDF along with its metadata
JSON, its `pdftotext` OCR text and the md-twin snippet.

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

Box names are elided from the transcript. Note that relevance order for
`extension:pdf` differs from `*` (it starts in volume 0007, not 0003).

## 10. Open risks

1. **The deep-offset ceiling** (somewhere in 30k–39.9k) blocks a match-all
   walk. Partition by `production_volume` (at most 7,559 PDFs per volume)
   and by `extension:pdf`.
2. **Tie-ordered paging.** Relevance ties mean order is not guaranteed if the
   index is re-sorted mid-walk, for example while a new agency drop lands.
   Dedupe on `mes:key`, assert that the per-volume count equals the facet
   count, and re-walk any partition that falls short.
3. **New monthly drops.** New volumes (`NYC-WTC0008…`) and new agencies
   (NYPD, DOHMH and EDC are announced) will appear. Detect them from the
   `production_volume` facet. Re-redaction may replace existing PDFs, which
   is detectable through the `ETag`/`Last-Modified` change and `pdf_size`.
   Keep old versions.
4. **Rate limiting / WAF.** None was observed over ~130 sequential requests.
   The origin is Mindbreeze SaaS, where an unannounced limit is possible.
   Back off on any 429/5xx and send a descriptive UA.
5. **Session tokens.** None are needed today. `qeng_ids` carries a digest
   that changes with the index, so do not persist it; re-fetch page 0 per
   partition run.
6. **Huge files.** The largest PDF is 377 MB. Stream to disk and verify the
   byte count against `pdf_size`. HTTP Range support was not tested.
7. **ID format drift.** `mes:key` shape already differs across volumes, so key
   the local store on `title` (the Bates start) plus `production_volume`.
8. **PII.** Un-redacted names may exist. The explorer needs a takedown path
   that mirrors the city's Notify-Us corrections: re-fetch changed ETags and
   drop removed keys.

## 11. Recommended ingest design

```
1. GET /api/v2/search facets(production_volume, agency, extension) on "*"  → partition list + expected counts.
2. For each volume V: walk "extension:pdf" AND production_volume:V in pages of 100 via result_pages offsets
   (fresh qeng_ids per walk), properties = all §5 fields (formats VALUE); dedupe on mes:key.
3. Assert walked count == facet count/2 for V; if short, re-walk once, else flag the partition.
4. Upsert into SQLite `docs(title PK, mes_key, volume, agency, source, box, folder, bates_end,
   page_count, pdf_size, first_seen, last_seen, etag, last_modified, sha256, removed_at)`.
5. Download queue ordered small→large: GET /apps/content/September11_MD/<title>, 1 req/s, stream to
   data/pdf/<volume>/<title>.tmp, verify size == pdf_size, sha256, rename; If-None-Match on re-sync.
6. Extract text: pdftotext -layout per page (split on \f) → docs_pages(title, page_no, bates, text) + FTS5.
7. Nightly/weekly: repeat 1–3 (cheap: ~250 requests); new volume/agency → enqueue; missing keys →
   mark removed_at (don't hard-delete; hide in explorer); changed ETag/size → re-download + keep old sha.
8. Log every run (requests, 4xx/5xx, bytes) and stop on sustained 429/403 rather than retry-storm.
```
