# B5 — map home and building files

## Implemented
- `/` replaces the scaffold with a viewport map; `/map` is the same page, canonical `/`.
- `/api/map` filters active source pages by substance, candidate dates, record type and results-only.
- `/api/place/[id]` and `/building/[bin]` accept a BIN or the full `places.id` (URL encoded).
- `/building/sitemap.xml` serves canonical URLs for places with available documents.
- `components/map/BuildingsForDoc.tsx` is a server component with `{ doc: string }` props.
- MapLibre uses only bundled GeoJSON, no tiles, glyph service, external styles, or runtime internet requests. A local SVG fallback supports pan/zoom and the same building selector when WebGL is unavailable.
- Current footprint BIN/BBL joins support both highlighting and same-block links; they are labelled present-day. Static counts never determine live highlights. Removed documents are excluded from every data projection and sitemap.

## Asset refresh and dependency
Run from `web/`, before packaging either replica:
```
node scripts/geo.mjs /Users/henry/Code/sept11-docs/data /Users/henry/Code/prospect
```
This reads the mirrored footprints, resolved building counts and Prospect's street geometry. It writes four files under `public/geo/`: 4,764 footprints; 2,021,163 bytes total (plus final newlines). Coordinates are rounded to six decimals. Roof heights stay in feet in the asset and convert to metres for extrusion. The WTC outline comes from the Astra prototype and is labelled approximate; no fictional sampling zones are copied. Outputs are committed assets for deployment; no production data-directory mount is needed. Rerun when the footprints change.

Added `maplibre-gl` ^6.0.0 to package.json and its dependency closure to package-lock.json. Registry access was blocked; these exact lock entries and installed packages were reused from the read-only Prospect checkout. The lockfile dependency versions satisfy their declared ranges. No other dependency was added. Coordinator should run `npm ci` normally before deployment.

## Shared integration patches for coordinator
1. `components/home/HomePanel.tsx` does not exist in this worktree. `components/map/HomeMap.tsx` passes a `<div id="home-panel">` placeholder as the client component's server-rendered `homePanel` slot. Replace that JSX with B2's `<HomePanel />` and import it after merging B2.
2. The README's sitemap hook is the comment in `app/sitemap.xml/route.ts`; it has no pluggable registry. Append `<sitemap><loc>${SITE_URL}/building/sitemap.xml</loc></sitemap>` to that index. B5 supplies the endpoint; the protected shared index was not edited.
3. Mount `<BuildingsForDoc doc={doc} />` in the non-removed branch of `components/DocumentViewer.tsx`, below the source/document details. Import its default export from `@/components/map/BuildingsForDoc`. No viewer or shared CSS/nav edits were made.

## Extraction limits
- The current `place_pages.units` contains units only, not numeric values. The selected building query reads `site.page_text` and projects only bounded numeric+unit regex matches; raw text is never returned to the browser. All values remain unpaired page candidates, not established substance/sample/date/lab relationships.
- Inspection candidates require an explicit “inspection report”, “inspection date”, “date of inspection”, or “building inspection” cue. They carry a machine-extracted label and source link. Memos and re-occupancy decisions have no structured classifier, so other building pages are listed without claiming a decision.
- The schema has no structured stated-limit field. The table says to verify the source page, rather than inventing above/below-limit status. A pipeline extraction of sample-level readings and stated limits is still needed for verified pairings.
- Full-range filters include undated/out-of-range pages; narrowing either month excludes those without a candidate date in range. This is stated beside the controls. The selected panel explicitly shows all available building pages independently of map filters.

## Verification
- `npx tsc --noEmit` in `web/` passed. No build or commit was run.
- Asset generator ran successfully; geometry properties, six-decimal precision and total size checked locally. All 23 MapLibre dependency lock entries satisfy their dependency ranges.
- Numeric projection checks passed for signed values, inequalities, decimals, scientific notation, deduplication, null input, and exclusion of non-measurement text.
- `npm run dev -- -p 3103` attempted; sandbox denied `listen 0.0.0.0:3103` with EPERM. PostgreSQL read connection also denied with EPERM. Live queries and browser rendering remain unverified in this environment.
- Curl attempted against `http://localhost:3103/`, `/map`, `/api/map`, `/api/map?from=28`, `/api/place/bin%3A1001015`, `/building/1001015`, `/building/bbl%3A1000130001`, `/building/sitemap.xml`, `/geo/buildings.geojson`; all returned connection failure because the dev server could not bind.
- Once the sandbox permits serving: use `/building/1000807`, `/building/bin%3A1000807`, `/building/bbl%3A1000130001`, `/api/place/bin%3A1000807` for mirror-backed identifiers; verify live availability against Postgres. Check filters, stale request cancellation, removed-only place 404, 400 invalid filters, mobile sheet, 3D/flat, disabled-WebGL fallback, and same-origin-only network requests.
