# sept11-docs

A local mirror of the City of New York's **9/11 Document Portal**
(<https://sept11documents.cityofnewyork.us/>, launched 2026-09-08). It keeps a
daily record of the portal's catalog, the original PDFs, and the text of their
OCR layer. It exists for research and, eventually, a better way to explore
the documents.

The portal runs Mindbreeze InSpire. One request to its catalog export returns
the whole catalog as CSV. The Download link serves each original PDF.
`docs/PORTAL-RECON.md` records how that was established and every API detail
the scripts rely on. `docs/CONTEXT.md` covers the release and external sources.
The prior art, [`pranava0x0/sept11documents-mcp`](https://github.com/pranava0x0/sept11documents-mcp),
found the export and cursor-paging endpoints first.

There is no UI and no search index here yet.

## Scripts

All scripts need Node 20+ and no npm dependencies. Run them from the repo
root.

| Step | Command | What it does |
|---|---|---|
| 1. Catalog | `node scripts/enumerate.mjs` | One `POST` to the catalog export on the Mindbreeze backend host (about 8 MB, about 25 s), plus one facet request to cross-check the counts. The CSV is saved as an **immutable dated snapshot**, `data/catalog/<YYYY-MM-DD>.csv` (New York date), with a `.summary.json` holding sha256, stats, the facet check and the diff against the previous snapshot. The script then rebuilds `data/manifest.jsonl`. If the export fails, it falls back to walking paged search volume by volume, which is also available as `--search`. `--seed <csv> --date D` imports an export captured elsewhere. Exit codes: `0` ok, `2` quarantined or a facet mismatch, `3` stopped by the portal. |
| 2. Diff | `node scripts/diff_catalog.mjs [A] [B]` | Compares two snapshots by Bates number (default: the two most recent). Reports documents added, removed and changed, page and byte deltas, per-volume counts, and whether we still hold each removed document. `--list` prints every Bates number; `--json out.json` saves the full report. Local only. |
| 3. Download | `node scripts/download.mjs` | Mirrors every present PDF to `data/pdf/<agency>/<volume>/<bates_start>.pdf`, smallest first. Each file gets a `.pdf.json` sidecar with its ETag, Last-Modified, bytes and sha256. The script is resumable. Options: `--limit N`, `--order size\|manifest`, and `--revalidate`, which sends a conditional GET for every stored ETag to catch re-redactions. |
| 4. Verify | `node scripts/verify_pdfs.mjs [--sha]` | Checks every downloaded PDF's size against the catalog's `pdf_size` and its sidecar, and checks the `%PDF-` header (with `--sha`, the content hash too). Counts removed documents we still hold and superseded copies. Writes `data/verify.json` (Bates numbers only). Local only, and safe to run during a download. |
| 5. Text | `node scripts/extract_text.mjs` | Runs `pdftotext -layout` on every completed PDF. Writes `data/text/<same path>.txt` (pages separated by `\f`) and `.pages.jsonl` (one line per page, with its Bates number). Local only and safe during a download. `--quality N` scores N documents with counts only. Needs poppler (`brew install poppler`). **One runner at a time.** The embedding work currently owns periodic runs. |

`scripts/fetch_sample.mjs` is the recon's one-document proof. It has search and
`--export` modes.

Run a long download detached:

```bash
nohup node scripts/download.mjs > data/download.out 2>&1 &
cat data/download.progress.json      # done/total, bytes, errors, throughput, ETA
tail -f data/download.log            # one line per document
kill "$(cat data/download.pid)"      # stops after the current document; re-run to resume
```

The downloader refuses to start while another live one holds `data/download.pid`.
Failures are appended to `data/download.errors.jsonl` and retried on the next
run. The downloader reads the manifest once, at start, so restart it after a
catalog update to pick up newly added documents.

Daily routine: `enumerate.mjs`, then `diff_catalog.mjs`, then `download.mjs`
(which finds only new documents), then `verify_pdfs.mjs`.

## The corpus changes, and removals are never deleted

The city removes documents as well as adding them. Removals are probably PII
takedowns. Before this mirror started, the catalog went from 24,441 documents
(09-09) to 24,437 (09-11) to 24,436 (09-13).
`data/catalog/known_removed_before_mirror.json` lists what is known: four
Bates numbers taken from the prior art's watchdog, plus one 7-page document
that nobody identified. We hold none of them.

From our first snapshot onward:

- **Snapshots are immutable.** A second export on the same day with different
  content is saved alongside as `<date>T<HHMMSS>.csv`. An identical export
  reuses the existing file.
- **Quarantine.** A snapshot with duplicate Bates numbers, zero rows, or more
  than 5% fewer documents than the last accepted one is kept for inspection.
  It does not touch the manifest.
- **Removed documents stay in the manifest** with `status: "removed"`,
  `removed_at` and `held_locally`. `download.mjs` skips them, and the PDF and
  text files are **never deleted**. A document that returns gets
  `reappeared_at`. A metadata change sets `changed_at` and `changed_fields`.
- A document the city re-serves with different bytes (found with
  `--revalidate`) keeps its old copy as `*.superseded-<ts>.pdf`.

## Polite-scraping rules

The portal publishes no robots.txt and no terms on automated access. The
city's only statement is that everything "may be viewed and downloaded free of
charge". The scripts behave as a considerate guest anyway, and
`scripts/lib/portal.mjs` enforces this in one place:

- The User-Agent is `sept11-docs-mirror/0.1 (contact: digitalhen@gmail.com)`.
- **Never parallel.** Each request waits for the previous one to finish.
  Don't run `enumerate.mjs` while `download.mjs` is downloading if you want a
  strict single connection. The export is one request, but it is a second
  connection.
- Search requests start at least 600 ms apart (under 2 req/s). Download
  starts are at least 1 s apart, over one connection.
- A 5xx or network error is retried with exponential backoff (5 s, 15 s,
  45 s, …).
- **A 429, a 401/403, or any non-JSON/non-CSV/non-PDF body stops the run**
  (exit 3) and records why. Don't raise the rates or loop on a block; tell a
  human.
- The export is preferred because it is one request instead of about 250. The
  paged-search fallback always partitions by volume, because offset paging dies
  past about 30k results.

## Personal information

The city redacted PII before release. It also says an inadvertent disclosure
may occur, and it runs a "Notify Us About Personal Information" form for
misses. Our stance:

- **We never publish names or other personal details from these files without
  human review.** Summaries, commits, issues and reports refer to documents by
  Bates number and describe text by counts, never by quoting people.
- **`folder_name` is hand-labelled and can contain personal names.**
  `diff_catalog.mjs` reports a folder change as a field name only and never
  prints its value.
- A missed redaction we find is reported to the city through the portal form.
- A document the city removes or re-redacts stays flagged locally for audit,
  and **must never be republished**.

## Where the data lives

Everything fetched or derived lives under `data/`, which is **gitignored** and
never committed.

```
data/catalog/<date>.csv + .summary.json       immutable daily catalog snapshots (~8 MB each)
data/catalog/known_removed_before_mirror.json removals before our first snapshot (Bates only)
data/manifest.jsonl, manifest.summary.json    current manifest (present + removed) built from the latest accepted snapshot
data/pdf/<agency>/<volume>/<bates>.pdf(.json) originals + fetch sidecars (~36 GB)
data/text/<agency>/<volume>/<bates>.txt       pdftotext -layout
data/text/<agency>/<volume>/<bates>.pages.jsonl
data/verify.json                              last verify_pdfs.mjs result
data/download.{log,progress.json,errors.jsonl,pid,out}
data/samples/, data/sample_fetch/             recon captures
```

`vendor/` (prior-art checkouts) and `.venv/` are gitignored too.

## Snapshot 2026-09-13

- **Documents:** 24,436. By agency: DEP 21,392, DCAS 2,915, FDNY 96, DORIS 21,
  DDC 9 and DOB 3. The export, the search facets and a full paged-search walk
  all agree exactly. The snapshot's sha256 is `33319629…4d657`.
- **Volumes and boxes:** 7 production volumes, `NYC-WTC0001` to `NYC-WTC0007`.
  There are 73 named boxes plus 21 documents with a blank box, and 4,171 named
  folders plus 1,091 documents with a blank folder. The prior art counts blank
  as a value, which gives 74 and 4,172.
- **Pages and bytes:** 172,537 pages. The declared sizes sum to 36.28 GB,
  which is a **lower bound** (see below). The median PDF is 315 KB, p99 15 MB,
  the largest 377 MB, and 23 exceed 100 MB.
- **Bates range:** `NYC-WTC_000000001` to `NYC-WTC_000174150`, with 18 gaps
  totalling 1,613 numbers. Those are withheld, removed or never produced.
- **Dates:** there is **no document date.** The export's `Date` column is the
  index time.
- **`pdf_size` understates some small files.** In the first 613 verified
  downloads, 23 were served larger than the catalog declares (for example 54 B
  declared, 241,635 B served, or 2 KB declared, 1.8 MB served). None were
  smaller. The true byte total comes from the sidecars. The downloader treats
  "a sidecar records a finished download of this size" as complete, so these
  rows don't re-download.
- **Not every PDF has a text layer.** Some are image-only: a different
  producer, no ABBYY OCR, and zero characters when extracted. Among the first
  196 extracted, 20 were like this.
