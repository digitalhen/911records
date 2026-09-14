# Brief A1 — page images, word boxes, OCR for image-only pages

Repo: `/Users/henry/Code/sept11-docs` (read `README.md` and `docs/PLAN.md` first; the plan's
"site.sqlite" section names the file layout you must produce). Work only in `scripts/` and read
`data/` as needed. Do not commit. Do not contact the portal (`sept11documents.cityofnewyork.us`
or its Mindbreeze host): everything here is local. Print a short report at the end: files
changed, how each was verified, anything left undone.

Two processes are running and must not be disturbed: `node scripts/download.mjs` (pid in
`data/download.pid`) and `scripts/embed/loop.sh` (pid in `data/embed/loop.lock/pid`). Never kill
them. **Never edit `scripts/embed/loop.sh` in place** — bash reads a running script by offset.
Write the new version to `scripts/embed/loop.sh.new` and `mv` it over the old path (new inode).
Henry's session restarts the loop afterwards.

## 1. `scripts/render_pages.mjs` (Node 20+, no npm deps; poppler `pdftoppm` is installed)

For every completed PDF under `data/pdf/<agency>/<volume>/<bates>.pdf` (a completed download has
a `.pdf.json` sidecar with a sha256 and the file is present), render every page to
`data/pages/<agency>/<volume>/<bates>/<n>.webp` (n is 1-based, about 110 dpi, quality ~70) and a
thumbnail `<n>.t.webp` (long edge 240 px). Use `pdftoppm -r 110 -webp` if this poppler supports
webp output (check `pdftoppm -h`); otherwise render PNG and convert with `cwebp` if present, else
`sips`, else fall back to JPEG with the same names but `.jpg` and say so in the report. Also write
`data/pages/<agency>/<volume>/<bates>/pages.json`: `{pages: n, w: [...], h: [...], dpi, rendered_at}`
with per-page pixel sizes.

Incremental: skip a document whose `pages.json` exists and whose page count matches the
sidecar's / catalog's. `--jobs N` (default 4) documents in parallel, `--limit N`, `--force`,
`--order size|manifest` (small first by default, like `download.mjs`). Print a one-line JSON
summary at the end like `extract_text.mjs` does. Safe to run while the download runs (only
touches completed PDFs). Large PDFs (some are 100–377 MB) must not be loaded into memory: let
pdftoppm write files.

## 2. Word boxes in `scripts/extract_text.mjs`

Alongside the existing `-layout` extraction, run `pdftotext -bbox-layout` and write
`data/text/<agency>/<volume>/<bates>.boxes.jsonl`: one line per page,
`{page, w, h, words: [[x0, y0, x1, y1, "word"], …]}` where w/h are the page size in PDF points
and the coordinates are in those points (the app scales them to the image using `pages.json`).
Keep the existing `.txt` and `.pages.jsonl` outputs byte-identical to today's. Incremental: a
document with `.pages.jsonl` but no `.boxes.jsonl` gets only the boxes pass on the next run
(cheap catch-up over the ~4,000 documents already extracted). The `--jobs` and `--force` flags
keep working. The `-bbox-layout` XHTML output can be large; parse it streaming or in one string
with a generous maxBuffer, never with a DOM library.

## 3. `scripts/embed/ocr_pages.py` (python: `.venv/bin/python`; tesseract 5 is installed)

For pages whose status in `data/embed/pages.sqlite` is `empty` (image-only scans, see
`scripts/embed/pages.py` for the schema and thresholds), OCR the rendered page image from step 1
with tesseract (`--psm 6` default, English, TSV output for word boxes). Write:
- `data/text/<agency>/<volume>/<bates>.ocr.jsonl` — one line per OCR'd page:
  `{page, bates, chars, text, source: "tesseract", conf}` (mean word confidence);
- and merge its word boxes into a companion `<bates>.ocr.boxes.jsonl` with the same shape as
  step 2, in **image pixel** space with `w`/`h` the image size (state that in the line: `space: "px"`).
Do not modify the pdftotext outputs. Incremental by (doc, page) and image mtime; `--limit N`,
`--jobs N`. Skip a page if its image does not exist yet. Print a JSON summary. Then extend
`scripts/embed/pages.py` minimally so that, when a page is `empty` and an `.ocr.jsonl` line
exists for it with `chars >= MIN_CHARS`, that text is embedded instead and the row's status
becomes `ocr` (add that value to the status set; document it in the module docstring). Keep the
existing incremental hash logic; the text hash should be over the OCR text in that case.

## 4. Loop integration

New `loop.sh` cycle order: extract (unchanged flags) → `render_pages.mjs --jobs 3` →
`ocr_pages.py` → `pages.py` → `entities.py`. Log each stage's summary line as today. Because
rendering 172k pages takes hours, the render stage must cap its own runtime per cycle: add
`--max-seconds N` to `render_pages.mjs` (default unlimited; the loop passes 900) so a cycle
never blocks the embedding stages for long.

## Verification

Run each script with `--limit 5` on real data and show the outputs exist and are well formed
(`file`, `ls -la`, one parsed line). Confirm `extract_text.mjs` still produces identical
`.pages.jsonl` for one document (`shasum` before and after). Run `.venv/bin/python
scripts/embed/pages.py --limit-docs 3` after step 3 and show the summary. Do not run anything
over the whole corpus.
