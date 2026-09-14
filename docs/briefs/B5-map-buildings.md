# Brief B5 — the home page IS the map (3D), plus building pages

Read `docs/briefs/COMMON-web.md` first. Dev port: **3103**.

Design sources: `design/astra/map.html` + `map.js` (the SVG prototype with filters and the side
panel), `building.html`, and item 12 of `design/BRIEF-2-astra-research.md` (the rules: colour by
what records exist, never a health verdict; every reading marked machine-extracted with a link;
residences are buildings, never households; reference outlines labelled approximate).
Data: schema `site` tables `places` (id, kind, key, label, n_docs, n_pages, n_test_pages,
first_date, last_date, lat, lon), `place_pages` (place_id, doc, page, has_test, contaminants,
units, dates, labs, confidence), `documents`, `pages`. Footprints: `data/geo/lm_buildings.geojson`
(4,764 lower-Manhattan footprints with BIN) and `data/embed/buildings.geojson` (our resolved
buildings with counts) — copy what the map needs into `web/public/geo/` at build time via a small
script `web/scripts/geo.mjs` (run it once now; document it), keeping the published file under
~3 MB (simplify coordinates to 6 decimals, drop unneeded properties).

Henry's direction (09-14): **the home page `/` opens on the map**, full viewport, with the
Ask/search bar over the top, "so people can explore, and for the wow factor" — the way
prospect.nyc's home works. Read `~/Code/prospect/components/HomeView.tsx`,
`components/MapExplorer.tsx` (search `fill-extrusion` for its 3D mode), `components/SearchBox.tsx`,
`lib/territory.ts` (`territorySuggestions`: the starter suggestions under the search box),
`lib/mapStyle.ts` and `lib/mapPalette.ts` — Henry's own code, reuse freely. Prospect draws **no
external tiles**: a blank canvas with hairline outlines and its own footprints, so the map is fast,
private and distinctive. Do the same here. Specifically:

- **3D.** Render the footprints as `fill-extrusion` using `height_roof` from
  `data/geo/lm_buildings.geojson` (properties: `bin`, `base_bbl`, `mappluto_bbl`, `height_roof`),
  with a pitched opening camera over lower Manhattan (WTC site centred), a toggle to flat, and a
  flat fallback on devices without WebGL. Buildings lost in 2001 are absent from today's
  footprints: draw the WTC site outline (labelled approximate) so the gap reads as the site.
- **Impacted buildings highlighted, distinctly.** Buildings that appear in the records (joined by
  BIN to `site.places`) are lit — colour by *what exists*: has test results / has inspections /
  mentioned only, three clearly separable tones from `design/astra/style.css` — and every other
  building is a dim, desaturated ground mass. The difference must read instantly at the opening
  zoom. Never a red "danger" heat map; never a health verdict (colour by record type or by the
  record's own stated above/below-limit, with the limit's source shown).
- **Search bar over the map** with starter suggestions under it in Prospect's manner: three to
  five data-driven chips — a building with the most test pages, a substance, and one or two
  questions ("What was measured at <address> in October 2001?") drawn from `site.places` and
  `site.entities`, never a person. The form posts to `/search?q=` / `/ask?q=` exactly as the
  current `web/app/page.tsx` does; that placeholder page is replaced by yours.
- **Side panel.** Default state renders `components/home/HomePanel.tsx` from brief B2 if it exists
  in your worktree, else a placeholder `<div id="home-panel">` (say so in your notes). Clicking a
  building swaps in the building panel described below. On phones the panel is a bottom sheet.

## Routes

1. `/` (and `/map` as an alias rendering the same page) — MapLibre GL (add `maplibre-gl` to
   package.json; note it in your report), no external tile server; footprints, hairlines and the
   WTC outline from `web/public/geo/` produced by `web/scripts/geo.mjs` (simplify to 6 decimals,
   keep only `bin`, `height_roof` and our counts; stay under ~3 MB). Controls: substance, month
   range slider (Sept 2001 → 2003), record type, "only buildings with results", 3D/flat. The
   building panel: address/label, records and pages count, a timeline of tests (date, substance,
   value + unit, lab, stated above/below limit when the page says so), each row linking to
   `/doc/<doc>/p/<page>`, related memos; data from a server route `/api/place/[id]` reading
   `place_pages`. Everything drawn from `places` is marked machine-extracted; the panel says
   readings are candidates extracted by machine and links to verify.
2. `/building/[bin]` (also resolve `/building/[id]` for non-BIN places by `places.id`) — the
   building file: everything about one address across all boxes: counts, date span, tests table
   (same rows as the panel, sortable by date/substance), documents grouped by agency and box,
   related buildings on the same block (by `places.key` prefix / block-lot) — never households.
   `generateMetadata` with the address in the title. Add these URLs to the sitemap hook.
3. `components/map/BuildingsForDoc.tsx` — a drop-in server component for the viewer (props
   `{doc}`) listing the buildings a document mentions with links; write `web/NOTES-B5.md` saying
   where to mount it.

Do not fetch anything from the internet at runtime; the map must work fully offline from `web/public/geo/`.
