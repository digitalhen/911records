# Brief B2 — home, browse, changes, policy and information pages

Read `docs/briefs/COMMON-web.md` first. Dev port: **3101**.

Design sources: `design/astra/home.html`, `browse.html`, `changes.html`,
`personal-information.html`, `mobile.html` (for the phone layouts of home). Also
`site/holding/privacy.html` and `site/holding/index.html` (the current live holding page whose
`/privacy` and `/ads.txt` must carry over).

## Routes

1. `/` — replace the placeholder home with the design's home: the Ask anything field (a plain
   form posting to `/ask?q=` — B3 builds `/ask`; for now it may 302 to `/search?q=` if `/ask` is
   absent), what the collection is (live counts from `site.meta` and `site.snapshots`), suggested
   questions for families and for lawyers (copy from the design), entry points into browse, map,
   topics and entities, and "recent releases and changes" (last 5 rows of `site.changes` grouped
   by date). Describe coverage plainly: how many pages are image-only scans and that we OCR them
   (`documents.pages_empty`, `pages_ocr` sums).
2. `/browse` and `/browse/[agency]/[volume]/[box]/[folder]` (each level optional, URL-encoded):
   the physical order, collection → agency → volume → box → folder → documents, with counts of
   documents and pages at every level, City-provided metadata only. Folder names are the City's
   labels; render them as given. Document rows link to `/doc/<doc>`; removed documents show as
   "removed by the City on <date>" without a link.
3. `/changes` and `/changes/[date]`: every snapshot (`site.snapshots`) with documents, pages,
   bytes, added, removed, changed; per date the list of changes (`site.changes`) — added and
   changed documents link to the viewer, removed ones show the Bates range, agency and page count
   only, never a folder name or content. Include the "known removed before the mirror" note from
   README.md and the capture date semantics. Saved-search alerts are a copy-this-link affordance
   only (B6 wires persistence).
4. `/personal-information`: port the design's policy page, but the copy must state what v1
   actually does (Henry's decision): we serve the City's records as the City publishes them,
   including its redactions; we do not run our own redaction pass yet; how to report (a form that
   POSTs to `/api/report` with Bates page + location + note, storing to table `app.reports` via
   the helper in `web/lib/db.ts` — if there is no runtime-table helper yet, write the insert
   with a `CREATE TABLE IF NOT EXISTS app.reports (...)` at first use); response standard as in
   the design; identity questions are refused; appearance in a record implies nothing.
5. `/privacy` (carry the holding page's privacy text over, adapted for the app: no accounts,
   no analytics beyond what the page says, AdSense as configured), `/about` (what this is, who
   runs it — Cleartext Labs, independent, not affiliated with the City of New York; sources; how
   to cite; contact), `/ads.txt` (static, same content as `site/holding/ads.txt`).
6. AdSense: one labelled display unit below the main content on `/`, `/browse*` and `/changes*`
   only (publisher `ca-pub-9961054735948902`, unit `4391479569`, copy the snippet from
   `site/holding/index.html`), rendered by a small `components/ads/AdUnit.tsx` that renders
   nothing when `NEXT_PUBLIC_ADS=off`. Never on document, answer or policy pages.

Mobile: every route works at 390 px wide; check the `mobile.html` frames for the home layout.
