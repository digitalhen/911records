# 911records.nyc: How it works

From City PDFs to searchable, page-cited evidence.

**Flow:** City PDFs → Extract + OCR → Tags + vectors → Publish → Search + Ask

## The website: explore and verify

911records.nyc is an independent research site for the City's September 11 records. Readers can browse documents, explore a building map, filter searches, follow related records, and ask questions. The viewer connects readable text to the original scan and its Bates page number; links and PDF downloads let readers check the evidence.

## Ingestion: keep the collection current

A daily job compares the City's catalog with the previous snapshot, records additions, changes and withdrawals, and downloads new or changed PDFs. It extracts embedded text and renders page images. Saved source stamps and text hashes let unchanged work be reused; changed inputs trigger another pass. Source PDFs and original text extractions are preserved.

## OCR: recover hard-to-read text

After basic Tesseract fallback, the stronger pass renders original PDF pages at 300 DPI and compares Apple Vision with Tesseract, including orientation handling for rotated scans. Every page is eligible. Readability, cross-engine agreement and decimal-preservation checks govern replacements. Candidates and backups are retained. Valid completed comparisons are reused; failed pages keep their text and retry.

## Tags: describe what the records contain

Rules extract substances, dates, measurements, agencies, labs, contractors and addresses. Name and address matching combines lookup tables with model-assisted cleanup. Separate rules classify document types, such as lab reports or letters. Local Qwen generates titles and summaries; selected cloud-model steps help with topic names and structured facts. Tags, summaries and embeddings are separate outputs from the selected text.

## Embeddings: represent meaning

Ollama runs nomic-embed-text locally, converting text into 768-number vectors. Pages are split into 3,000-character chunks with 300-character overlap. Chunk vectors are averaged into page vectors for search and document vectors for related records, topic groups and near-duplicates. Search questions use the same model. Changed OCR regenerates affected vectors. These are text embeddings, not image or layout embeddings.

## Search and Ask: retrieve, then explain

OpenSearch combines keyword relevance (BM25) with vector similarity, alongside metadata filters. Hybrid ranking blends normalized keyword and semantic scores at 40% / 60%; keyword search remains available if embeddings are unavailable. Ask retrieves records and uses Claude Haiku for supported explanations with page citations. Citation checks validate page references; readers still need to check whether the evidence supports each claim.

## Serving and refreshing the site

The Next.js website runs on two hosts behind Cloudflare. A Mac runs ingestion and local models; shared Postgres serves metadata and page text, and OpenSearch serves search. The refresh updates derived data, publishes it, and runs checks. Cached work, backups and pipeline locks support safe reruns.

*As of September 18, 2026: 24,436 documents / 172,537 pages. The full stronger-OCR backfill is underway; new text and tags publish after downstream processing. OCR and AI can misread records. Original scans remain the source of evidence.*

Implementation: `scripts/refresh_daily.sh`, `scripts/embed/{ocr_auto,pages,entities,doctypes}.py`, `scripts/search/opensearch.py`, and `web/lib/ask/`.
