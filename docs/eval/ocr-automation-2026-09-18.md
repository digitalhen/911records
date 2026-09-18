# Automatic full-page OCR comparison

The daily refresh and ingestion loop now run the existing 300-DPI Apple Vision / Tesseract
comparison before embeddings and entity extraction. The scope is every active PDF page,
including readable original text. Selection thresholds and numeric-preservation checks are
unchanged from the earlier evaluated recovery pass.

A persistent review queue reuses completed comparisons for the same PDF stamp, effective text
and policy. Source changes requeue pages. Approved OCR remains selected while its source stamp
matches. Failed pages keep their text and retry with exponential backoff. Candidate text,
provenance, decisions and sidecar backups are retained. Shared ingestion locking prevents a
refresh from publishing while another ingestion process is changing its inputs.

Validation: all 17 OCR regression tests pass. The six new tests cover readable-page inclusion
without an embedding database, active-document filtering, completed-review reuse and source
invalidation, approved-text preservation, retry backoff, stale-result rejection and lock
exclusion. Both shell entry points pass `bash -n`.

The prior 23,236 reviewed pages imported successfully: 2,536 approved replacements and 20,700
retained originals. The current collection has 172,537 pages, leaving 149,301 comparisons for
the full backfill. This is a launch record, not a claim that the full backfill is complete.

Run `OCR_AUTO_JOBS=12 scripts/refresh_daily.sh --reprocess-all-ocr` to drain the queue, rerun
derived stages and publish. Live progress is in `data/refresh.log` and
`data/ocr-auto/progress.json`; final OCR counts are in `data/ocr-auto/last-run.json`. The
2026-09-18 backfill supervisor additionally writes `data/ocr-auto/full-backfill.status` and
runs `ocr_verify.py` after publication. Check its exit status and verification report before
claiming the new text is published consistently.

Summary and fact model stages retain their existing non-fatal behavior and budget limits;
completion of publication alone is not proof that every model-derived field was refreshed.
This automation change does not itself add a visitor-facing feature or change the OCR
selection policy, so it does not bump the application version.
