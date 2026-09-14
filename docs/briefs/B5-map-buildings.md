# Brief B5 — building map and building pages

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

## Routes

1. `/map` — MapLibre GL (add `maplibre-gl` to package.json; note it in your report) with
   OpenFreeMap's free vector tiles (`https://tiles.openfreemap.org/styles/positron`) as the
   basemap; our footprints as a fill layer coloured by *what exists* (has test results / has
   inspections / mentioned only), the WTC site outline as a reference polygon labelled
   "approximate"; controls: substance, month range slider (Sept 2001 → 2003), record type,
   "only buildings with results"; clicking a building opens the side panel described in the
   design: address/label, records and pages count, a timeline of tests (date, substance, value +
   unit, lab, stated above/below limit when the page says so), each row linking to
   `/doc/<doc>/p/<page>`, related memos. The panel data comes from a server route
   `/api/place/[id]` reading `place_pages`. Works at 390 px (panel becomes a bottom sheet).
   Everything drawn from `places` is marked machine-extracted; the panel says readings are
   candidates extracted by machine and links to verify.
2. `/building/[bin]` (also resolve `/building/[id]` for non-BIN places by `places.id`) — the
   building file: everything about one address across all boxes: counts, date span, tests table
   (same rows as the panel, sortable by date/substance), documents grouped by agency and box,
   related buildings on the same block (by `places.key` prefix / block-lot) — never households.
   `generateMetadata` with the address in the title. Add these URLs to the sitemap hook.
3. `components/map/BuildingsForDoc.tsx` — a drop-in server component for the viewer (props
   `{doc}`) listing the buildings a document mentions with links; write `web/NOTES-B5.md` saying
   where to mount it.

Do not fetch anything from the internet except the tile style at runtime in the browser.
