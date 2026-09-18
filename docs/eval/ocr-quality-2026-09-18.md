# OCR experiment — September 18, 2026

Status: complete. Better OCR accepted for 2,536 pages across 788 documents; embeddings, tagging, derived data, database publication, and search refresh completed. Final audit: zero failures.

The existing fallback already uses Tesseract 5.5.2, English, `--psm 6` on the
110-DPI viewer images. It retries only `empty` and `ocr` pages. The initial database
contained 164,353 `ok`, 2,173 `ocr`, 3,916 `junk`, and 2,095 `empty` pages.

## Comparison

A fixed-seed pilot selected three pages from each existing status (12 total),
including numeric laboratory tables, handwriting, photographs, sparse covers,
a typed agreement, and a sideways asbestos report. Alternatives were original
PDF extraction; current viewer-image Tesseract; 300-DPI Tesseract with PSM 6,
PSM 3, PSM 1 (orientation detection), and the larger `tessdata_best` English model;
and local Apple Vision accurate text recognition with language correction off.
All high-resolution inputs were rendered directly from the original PDFs. Median pilot
OCR times (excluding rendering) were 0.39 s for the current setting, 1.04 s for
300-DPI Tesseract with orientation, 1.50 s for the larger English model, and
0.40 s for Apple Vision. These are small-sample local timings, not corpus estimates.

A visually checked set of **32 phrases and values on three pages** gives this
retrieval-oriented check. It normalizes case, whitespace, and most punctuation while retaining
decimal points and token boundaries (so `196.0` cannot count as `96.0`). It is **not a word-error rate or a corpus accuracy estimate**.
The pilot is too small to conclude one engine is best for every document type.

| Method | Checked phrases/values recovered |
| --- | ---: |
| Existing PDF extraction | 14 / 32 |
| Tesseract, viewer image, PSM 6 | 15 / 32 |
| Tesseract, 300 DPI, PSM 6 | 16 / 32 |
| Tesseract, 300 DPI, PSM 3 | 13 / 32 |
| Tesseract, 300 DPI, PSM 1 | 22 / 32 |
| Tesseract best English, 300 DPI, PSM 1 | 22 / 32 |
| Apple Vision, 300 DPI | 28 / 32 |

The checked pages were NYC-WTC_000123166 p2 (agreement), NYC-WTC_000061549 p2
(lab result), and NYC-WTC_000102313 p1 (sideways asbestos report).
Neither engine reliably retained all table values. For example, automatic layout
segmentation omitted the 96.0 result on the small lab page; that page's original
text is retained. Handwritten notes remained unreliable and were not automatically
accepted merely because the engine returned more text. PSM 6 also produced words
from a photograph's texture; both alternatives correctly found only sparse text.

Controlled 90°, 180°, and 270° rotations of the agreement: PSM 1 and Apple Vision
recovered the `LICENSE AGREEMENT` heading at all three angles; PSM 6 did not at
any angle. This verifies orientation handling on that document, not universal
rotation detection or arbitrary-angle deskewing. Word boxes were visually checked
against actual sideways reports for both engines and remain in original image
coordinates. The existing viewer prefers PDF word boxes where present; this data
run does not change or deploy its highlight-box selection logic.

## Selective rerun

The broader comparison screens 23,236 suspect pages: 15,052 poor existing text
layers, 2,173 fallback-OCR pages, 2,095 sparse/empty pages, and 3,916 pages classified
as junk. This is a heuristic screen, not a claim that all those pages need replacement.
Each gets 300-DPI Apple Vision and Tesseract PSM 1 alternatives. Large inputs may
fail or time out; those must be resolved before applying the staged manifest.

Automatic replacements require a substantial gain in dictionary-recognized words
or a material reduction in nonwords, enough substantive text, and a readable-word
ratio of at least 0.65, and at least ten substantive dictionary words corroborated
by the other engine. This is a conservative screening rule, **not an accuracy
score**. Existing decimal readings must all survive when the original is reasonably
readable or has at least five decimal readings. A visually checked sideways
report and two photographs explicitly select Vision. Sparse disagreements are held for
visual review: handwriting can look sparse too, so fewer recognized words alone
is not treated as proof that the old text was noise. Original PDFs and `.pages.jsonl` files are unchanged.

Each decision retains the original text, both candidates, word boxes, runtimes,
PDF revision stamp, acceptance decision, and original text hash under the ignored
`data/ocr-eval/2026-09-18/` directory. `ocr_finalize.py` reapplies the final policy
without repeating OCR. `ocr_apply.py` refuses incomplete manifests or changed
source PDFs/text, backs up existing sidecars, and publishes boxes before text.

The final staging pass reported 3,741 seconds (about 62 minutes), including cached
results from initial batches. Final policy version 5
accepted 2,536 replacements: 1,399 Tesseract and 1,137 Apple Vision, including
three visual-review overrides. It retained 20,700 pages, including 639 sparse
disagreements held for manual review. Accepted pages by prior status: 2,256 `ok`,
212 `ocr`, 51 `junk`, and 17 `empty`. One photograph timed out
in Tesseract under both PSM 1 and PSM 3; visual inspection and a successful Vision
retry resolved it before application. All 23,236 manifest entries have a result.
Twenty derived-store snapshots and per-document sidecar backups are preserved
under `data/ocr-eval/2026-09-18/backup/`.

An additional fixed-seed visual spot check of four applied pages (recorded in
`spot-checks.json`) found four sideways scans with substantially recovered printed
text. The dust report retained its six percentage readings, but its field identifier
was partly lost. The chain-of-custody form recovered printed labels while handwritten
entries remained unreliable. This confirms useful recovery, not perfect transcription.

## Pipeline fixes

`page_text.py` supplies one selection rule to embeddings, entities, document types,
summaries, facts, related-record topic terms, Postgres, and OpenSearch. Previously,
several stages ignored fallback OCR or selected it only for the wrong page status.
Replacements carry an explicit acceptance marker and are invalidated when their
source PDF changes. Legacy OCR cannot overwrite an accepted high-resolution result.

Embedding batches now commit at page boundaries, avoiding a partially committed
long page after a model failure. A rerun also repairs missing chunk vectors instead
of treating a text hash alone as proof embedding finished. Regression tests cover
selection, identical consumer text, source-PDF invalidation, decimal retention,
long-page commits, failed embedding rollback, backed-up/idempotent application,
numeric-boundary scoring, independent-engine corroboration, summary response IDs, and complete fact dates.
All eleven regression tests pass.

`scripts/refresh_daily.sh --reprocess-ocr <staged-dir>` takes scheduler locks,
backs up derived stores, applies the approved OCR, reruns page embeddings and
entity extraction/canonicalization, then runs the usual discovery, tagging,
summaries, facts, database publication, downloads, and search-index stages.
It does not enumerate or download anything from the City portal. In this mode,
summaries refresh changed inputs without retrying unrelated pre-existing missing
titles. Model-dependent stages allow two hours each in OCR reprocess mode, unless
`SOFT_STAGE_SECS` overrides it; daily runs retain their usual 15-minute limit.
Recent daily logs showed fact extraction repeatedly reaching that shorter timeout
before publishing its output.

During the downstream run, repeated missing summary rows exposed a pre-existing
ID mismatch: batch prompts used zero-based IDs, while the local-model handler
shifted responses to one-based IDs. This could associate a summary with the next
document. Publication was paused; this run's summary outputs and cache were
restored from the pre-run backup. Prompts now use one-based IDs, and response
alignment preserves actual prompt IDs, including sparse retries. Only complete
contiguous renumberings can be remapped. Ambiguous IDs are not assigned by position.
The corrected rerun completed in 1,582.4 seconds: 1,620 model-processed documents
and 11 rule-based updates, with all 1,631 changed input hashes refreshed. Forty-seven
new titles were rejected after privacy retries: 35 existing titles were retained,
and 12 changed records remain untitled. No model calls failed or hit a budget cap.
Unchanged
pre-existing summaries are outside this rerun and have not been re-audited here.

Fact extraction completed in 2,150 seconds, producing 24,937 facts (12,282 rule-based
and 12,655 model-extracted). It processed 402 new page inputs in 201 calls and reused
926 cached inputs. The normal budget threshold stopped further model work at
$3.002437; unprocessed model candidates remain for future runs.

Publication then rejected one model fact with a month-only date, `2001-10`. The
complete-date validator now records an unknown day as null, rather than inventing
a date. The original extraction remains in the model cache and
`partial-fact-dates.json`. Rebuilding facts from cache retained all 24,937 facts
and made zero new model calls. `--publish-only` resumes database/index publication
from completed derived data without repeating the extraction or model stages.

## Final publication and verification

Publication finished at **2026-09-18 21:49:54 UTC**. The two encountered problems
(summary-ID mismatch and one partial fact date) were corrected and their stages
rerun successfully before final verification. No original PDF or raw extraction
was modified. The data refresh completed before the code release. Release `1.2.4` packages
the OCR and workflow fixes with their regression tests and release notes.

- Embedding refresh: 2,538 page-state updates and 2,692 generated chunks. This
  includes all 2,536 replacements and two legacy fallbacks reclassified as empty.
- Entity extraction/canonicalization, related records, topics, places, document
  types, summaries, and facts completed. Model-dependent coverage is subject to
  the privacy and budget limits described above.
- Database: 24,436 documents, 172,537 page texts, and 24,937 facts published.
- Search: 155,108 pages reindexed, 17,429 unchanged; total 172,537 pages.
- Downloads: 24,436 documents across 78 boxes validated; existing PDFs retained.
- Suggested-search checks: 10/10 passed (model-path results reused the check cache).
  Reading seeds refreshed: 38.
- `backup/verification.json`: all **4,495** selected OCR pages checked, including
  existing fallback OCR and every newly applied page. Local text hashes, chunk
  counts, entity input hashes, Postgres text/source, OpenSearch text/source,
  **4,493 embedding vectors**, and contaminant/date/measurement search tags match.
  **Zero failures**. Two sparse reviewed photographs have no embedding, as intended.
- Live page API: `NYC-WTC_000102313` p1 now reports `ocr_source=ours` and contains
  the recovered asbestos-analysis heading. A direct search for `AIRBORNE ASBESTOS`
  retrieves that page. Public health reports the database, index, model server,
  and files reachable. Evidence: `live-page.json`, `live-search.json`, `live-health.json`.

The improvements support finding and reading these pages; they do not certify
transcriptions or measurements. Handwriting, table structure, and some digits
remain imperfect, and 639 sparse disagreements were deliberately retained.

## Reproduction and artifacts

- `scripts/eval/ocr_score.py`: phrase/value scoring with numeric boundary checks.
- `scripts/eval/ocr_benchmark.py`: engine/configuration comparison.
- `scripts/eval/ocr_vision.swift`: local Apple Vision comparator and word boxes.
- `scripts/eval/ocr_select.py`: deterministic suspect-page selection.
- `scripts/eval/ocr_upgrade.py`: resumable corpus staging and candidate decisions.
- `scripts/eval/ocr_finalize.py`, `ocr_apply.py`, `ocr_backup.py`: finalize/apply/rollback evidence.
- `data/ocr-eval/2026-09-18/sample.json`: original deterministic pilot selection.
- `data/ocr-eval/2026-09-18/ground-truth.json`: visually checked phrases/values.
- `data/ocr-eval/2026-09-18/results/`: pilot images, text, TSVs, versions, model checksum and timings.
- `data/ocr-eval/2026-09-18/rotation-results.json`: controlled rotation results.
- `data/ocr-eval/2026-09-18/staged/`: corpus manifest, alternatives and decisions.

Dependencies: existing Tesseract/Poppler, the macOS Vision framework compiled with
`swiftc`, Python standard library, and `/usr/share/dict/words` for screening.
The production pipeline retains its existing Python dependencies. Pillow was
installed only in a separate evaluation environment to inspect images.

Tesseract's documentation recommends at least 300 DPI and explains layout and
orientation modes: [image quality](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).
The larger model's documented tradeoff is slower inference for potential accuracy
gains, which did not improve this pilot's phrase score:
[trained data](https://tesseract-ocr.github.io/tessdoc/Data-Files.html).

Release `1.2.4` notes describe the recovered pages and corrected record-title assignment.
