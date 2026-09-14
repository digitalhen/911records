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
