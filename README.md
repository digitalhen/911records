# sept11-docs

A local mirror of the City of New York's **9/11 Document Portal**
(<https://sept11documents.cityofnewyork.us/>, launched 2026-09-08): the full
listing of every published document, the original PDFs, and the text of their
OCR layer, for research and eventually a better way to explore them.

The portal runs Mindbreeze InSpire. Its search API is open JSON and its
Download link serves the original PDF. `docs/PORTAL-RECON.md` has how that was
established and every API detail the scripts rely on. `docs/CONTEXT.md` covers
the release itself and external sources.

There is no UI or search index here yet.

## Scripts

All scripts run on Node 20+ with no npm dependencies. Run them from the repo
root.

| Step | Command | What it does |
|---|---|---|
| 1. List | `node scripts/enumerate.mjs` | Walks every `production_volume` with `extension:pdf` (about 250 requests, about 4 minutes). Writes `data/manifest.jsonl` (one line per document with every metadata field, the download URL and the local paths) and `data/manifest.summary.json` (counts, bytes and pages per agency, volume and source, reconciled against the API's own facet counts). Exit `0` means reconciled, `2` a count mismatch, `3` that the portal pushed back. |
| 2. Download | `node scripts/download.mjs` | Mirrors every PDF to `data/pdf/<agency>/<volume>/<bates_start>.pdf`, smallest first, with a `.pdf.json` sidecar holding the ETag, Last-Modified, bytes and sha256. Resumable, so re-run it at any time. Options: `--limit N`, `--order size\|manifest`, `--revalidate` (conditional GET on every stored ETag, to catch re-redactions). |
| 3. Text | `node scripts/extract_text.mjs` | Runs `pdftotext -layout` on every completed PDF and writes `data/text/<same path>.txt` (pages separated by `\f`) plus `.pages.jsonl` (one line per page, with its Bates number). It is local only and safe to run while downloading. `--quality N` scores N documents with counts only. Needs poppler (`brew install poppler`). |

`scripts/fetch_sample.mjs` is the original one-document proof from the recon.

A long download should be run detached:

```bash
nohup node scripts/download.mjs > data/download.out 2>&1 &
cat data/download.progress.json      # done/total, bytes, errors, throughput, ETA
tail -f data/download.log            # one line per document
kill "$(cat data/download.pid)"      # stops after the current document; re-run to resume
```

The downloader refuses to start while another live one holds `data/download.pid`.
Failures are appended to `data/download.errors.jsonl` and retried on the next
run.

## Polite-scraping rules

The portal publishes no robots.txt and no terms on automated access. The
city's only statement is that everything "may be viewed and downloaded free of
charge". The scripts still behave as a considerate guest, and
`scripts/lib/portal.mjs` enforces that in one place:

- The User-Agent is `sept11-docs-mirror/0.1 (contact: digitalhen@gmail.com)`.
- **Never parallel.** Every request waits for the previous one to finish.
- Search requests are paced at ≥ 600 ms between starts (under 2 req/s).
  Download starts are ≥ 1 s apart, over one connection.
- A 5xx or network error is retried with exponential backoff (5 s, 15 s, 45 s,
  and so on).
- **A 429, 401/403, or any non-JSON/non-PDF body stops the run** (exit 3) and
  records why. Do not raise the rates or loop on a block; tell a human.
- Offset paging dies past about 30k results, so walks are always partitioned
  by volume.

## Personal information

The city redacted PII before release. It also says an inadvertent disclosure
may occur, and it runs a "Notify Us About Personal Information" form for
misses. Our stance:

- **We never publish names or other personal details from these files without
  human review.** Summaries, commits, issues and reports refer to documents by
  Bates number and describe text by counts, never by quoting people.
- If we find a missed redaction, we report it to the city through the portal
  form.
- Re-sync with `--revalidate`. A document the city re-redacts changes its
  ETag. The old copy is kept locally as `*.superseded-<ts>.pdf` so the change
  is auditable. It must never be republished.

## Where the data lives

Everything fetched or derived lives under `data/`, which is **gitignored**. It
is never committed.

```
data/manifest.jsonl, manifest.summary.json   listing (24,436 docs on 2026-09-13)
data/pdf/<agency>/<volume>/<bates>.pdf(.json) originals + fetch sidecars (~36 GB)
data/text/<agency>/<volume>/<bates>.txt       pdftotext -layout
data/text/<agency>/<volume>/<bates>.pages.jsonl
data/download.{log,progress.json,errors.jsonl,pid,out}
data/samples/, data/sample_fetch/             recon captures
```

`vendor/` (prior-art checkouts) is gitignored too.

## Snapshot (enumeration of 2026-09-13)

- 24,436 documents: DEP 21,392, DCAS 2,915, FDNY 96, DORIS 21, DDC 9 and DOB
  3. These match the API facets exactly.
- 7 production volumes, `NYC-WTC0001` to `NYC-WTC0007`.
- 172,537 pages. The declared `pdf_size` sums to 36.3 GB, which is a
  **lower bound** (see below). The largest PDF is 377 MB, and 23 exceed
  100 MB.
- Bates `NYC-WTC_000000001` to `NYC-WTC_000174150`, with 18 gaps totalling
  1,613 numbers (presumably withheld or unpublished).
- **`pdf_size` is unreliable at the small end.** Among the first ~100 downloads
  (smallest declared first), 20 were served larger than declared: 16 declared
  under 2 KB/page and 4 declared 2–5 KB but served 1–2 MB. It has not been seen
  wrong in the other direction. The true byte total comes from the sidecars,
  not the manifest. The downloader treats "a sidecar records a finished
  download of this size" as complete, so these rows do not re-download.
- **Not every PDF has a text layer.** The recon's "every PDF carries ABBYY OCR"
  held for its samples, not for the corpus. Some documents extract to zero
  characters. `extract_text.mjs --quality` reports how many.
