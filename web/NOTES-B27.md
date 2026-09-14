# B27 (summaries everywhere + favicon + SEO audit) — shared-file note

`docs/briefs/COMMON-web.md` scopes agents to `web/app/<your routes>`, `web/components/<your
feature>/` and `web/lib/<your feature>/`. Two things in this brief don't fit that scoping cleanly;
flagging both rather than assuming it's fine to have gone outside it silently.

## Favicon files at `web/app/` root

The brief asked for the favicon set wired via Next's `icons`/`manifest` metadata, but
`web/app/layout.tsx` is on the do-not-edit list. Used Next 15's file-convention metadata instead,
which needs no import in `layout.tsx` at all:

- `web/app/favicon.ico` — 16/32 ICO (hand-packed embedded-PNG directory; no ico-writer dependency
  added).
- `web/app/icon.svg` — the SVG favicon (Next auto-serves `app/icon.*` as the `<link rel="icon">`).
- `web/app/apple-icon.png` — 180×180 (Next auto-serves `app/apple-icon.*` as the apple-touch-icon).
- `web/app/manifest.ts` — Next's manifest file convention (auto-linked `<link rel="manifest">`),
  name "911records.nyc", `theme_color` from `--blue` (#214fbb), icons at `web/public/icon-192.png`
  and `web/public/icon-512.png`.

All four were rasterized from `design/logo/mark-compact.svg` on a white ground with `sharp`
(already a dependency; no new package added). Verified: `curl` 200s on `/favicon.ico`, `/icon.svg`,
`/apple-icon.png`, `/manifest.webmanifest`, and the rendered `<head>` carries all four `<link>`
tags plus the manifest link (checked in Chrome on `/search`, `/doc/...`, `/topics/35`, a `/browse`
folder page, `/reading`).

## `web/lib/reading/store.ts` and `web/lib/discovery/moreLikeThis.ts`

Both are shared files other workstreams (B22/B25's "what others are reading", B4's discovery
layer) own, not new files under a B27-owned directory. Changes are additive only, same shape as
P5's `web/lib/opensearch.ts` precedent:

- `store.ts`: added `summary` (from `site.documents.summary`, schema-first gated the same way
  `title` already is) to `ReadingItem` and `AlsoRead`, and to every SQL `SELECT`/`GROUP BY` that
  builds them. No existing field or behavior changed.
- `moreLikeThis.ts`: the "more like this page" lookup only ever returned `{doc, page, score}` — no
  title, unlike every other discovery section — so it was bare Bates numbers by design, not a
  regression. Added a second batched `site.documents` join (title/summary/box), gated on
  `documentsHaveTitles()`.

`npx tsc --noEmit` is clean with both changes.

Coordinator: keep these as-is, or fold differently — same ask as P5's note.

## Follow-up round (branch `B27b` — the original `B27` worktree was merged/removed mid-task)

Three additions from Henry after the first merge (0.14.0): hide folder cover sheets from search
results and every discovery list by default; list a cover sheet's folder inline; fix the missing
gap under the cover-sheet banner. Continued in a fresh worktree (`../sept11-wt/B27b`, branch
`B27b`) since `B27` no longer existed by the time these arrived — same repo state otherwise
(built on `main` at the 0.14.0 release).

- **`web/lib/opensearch.ts`** (do-not-edit list): `search()` gets an `includeCoverSheets` option
  (default `false`) — cover sheets are excluded from `hits`/`total`/the facet aggregations via a
  `must_not` baked into the query itself (not `post_filter`, so aggregations reflect the
  hidden-by-default universe too), instead of only the pre-existing 0.5x ranking penalty. A new
  `hiddenCoverSheets` count (keyword-only approximation, documented as such — an exact figure would
  need the hybrid query run twice) powers the /search facet toggle. Ask's retrieval
  (`lib/ask/retrieve.ts`, `lib/ask/answer.ts`) calls `search()` too; leaving `includeCoverSheets`
  defaulted to `false` for them as well is intentional, not overlooked — `retrieve.ts` already
  post-filtered cover sheets out of `search()`'s hits by hand (issue #28, "nothing on the page to
  answer a question from"), so this just moves that exclusion earlier and makes it free.
- **`web/lib/discovery/data.ts`, `RelatedRecords.tsx`, `moreLikeThis.ts`, `lib/reading/store.ts`**:
  each gets a `d.doc_type IS DISTINCT FROM 'cover_sheet'` clause (unguarded — `lib/ask/listExec.ts`
  already references `d.doc_type` by name elsewhere, so the column is stable, unlike `title`/
  `summary` which are still schema-first gated per PLAN.md).
- **`components/discovery/FolderRecords.tsx`** (new): the cover-sheet banner's "so where is the
  rest" list — every other document in the same agency/volume/box/folder, Bates order, index-
  friendly clause shape (matches `lib/site.ts`'s `getNextInFolder` comment on why `IS NOT DISTINCT
  FROM` defeats the `documents_browse` index). Date span comes from `site.place_pages.dates`
  aggregated per doc; most documents have no place match and show no date span, which is correct
  (nothing extracted), not a bug.
- **Cover-sheet banner spacing**: `.note` (only used for this banner) never got a `margin-bottom`
  the way `.removed-note` right above it already has (24px, in `web/app/globals.css`) — can't fix
  the shared rule directly (do-not-edit), so `DocumentViewer.tsx` sets it inline
  (`style={{ marginBottom: 'var(--space-6)' }}`) matching `.removed-note`'s value. Worth folding
  into `.note` itself in `globals.css` since it's a one-line, single-call-site fix.

Verified: `npx tsc --noEmit` clean; Chrome on `/search?q=asbestos` (cover sheets absent by default,
toggle present, `?covers=1` brings them back), `/doc/NYC-WTC_000117718` (a cover sheet — folder
list renders, gap fixed), `/doc/NYC-WTC_000073594` (regression check, unaffected), `/topics/35` —
no console errors.
