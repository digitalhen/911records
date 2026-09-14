# Ground zero GIS layer — what exists, what doesn't

Researched 2026-09-14, for the "Ground zero GIS layer" issue (find/assemble a
GIS layer of the WTC site as it stood 2001-09-11 for the building map).
Starting points: `docs/research/city-data-linkage.md` §2.1/§3 (historic
footprints dataset `x7wt-jhdr`, PLUTO archives, the "no official WTC boundary
GeoJSON found" note in §3.2) and `design/BRIEF-2-astra-research.md` item 12
("show the WTC site and the zones named in the records as reference
outlines").

Method: `User-Agent: sept11-docs-research/0.1 (contact: digitalhen@gmail.com)`,
sequential requests, ~40 total. Output: `data/geo/wtc-2001.geojson`
(gitignored, not committed — regenerate with this doc + the commands below).

## 0. Top-line answer

**No official polygon geometry for the 1973–2001 WTC buildings exists in any
open dataset I could find or query** — not NYC Open Data, not a federal
agency, not OpenStreetMap. `x7wt-jhdr` (Building Footprints Historic) is
**confirmed, by direct query, not to reach back to 2001** (below). What *does*
exist, and what `wtc-2001.geojson` contains, is a small set of **sourced
Point locations** for the seven WTC buildings plus the plaza, drawn from
Wikipedia/Wikidata infobox coordinates — building-level to city-block
precision, not survey-grade, and explicitly not footprint polygons. No
"frozen zone," EPA/DEP sampling-zone, or FEMA 403 damage-classification
**polygon** exists publicly either; those are documented in prose/maps only
(§4). Nothing in the output file was invented — everything left out is
flagged here as a gap, per the brief.

## 1. `x7wt-jhdr` / Building Footprints Historic — confirmed does not reach 2001

`city-data-linkage.md` §2.1 flagged this as **unverified**. Now verified:

- The Socrata resource endpoint (`data.cityofnewyork.us/resource/x7wt-jhdr.json`)
  returns empty rows — it's a `blobby` map-type entry, not a queryable table
  (same pattern as PAD). Its real backing service is an ArcGIS FeatureServer:
  `https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/BUILDING_HISTORIC_view/FeatureServer/0`
  (org `maps.nyc.data`, i.e. NYC DoITT/OTI's own ArcGIS Hub — the correct
  live source, fields match the linked metadata doc exactly: `BIN`,
  `CONSTRUCTION_YEAR`, `DEMOLITION_YEAR`, `BASE_BBL`, `MAPPLUTO_BBL`, etc.)
- Queried a ~1.1km bbox around the WTC site: **80 features returned, earliest
  `DEMOLITION_YEAR` is 2002** (a small building at 115 Nassau St, unrelated
  to the WTC), and the bulk are 2004–2026 demolitions. **Zero features with
  `DEMOLITION_YEAR` = 2001.**
- Queried directly by guessed BINs for the towers/annexes (1000323–1000329,
  the range used in some public 9/11 civic-tech references): **zero results**
  — not proof those are the right BINs, but consistent with the layer simply
  not carrying them.
- **Conclusion, stated plainly for the product:** this layer's reach starts
  around 2002 (matches its LIDAR-flight-based capture history noted in
  `city-data-linkage.md`), so it can never answer "what did the WTC towers'
  footprints look like" — don't wire the map's WTC-era rendering to this
  dataset, even opportunistically.

## 2. PLUTO 2002 archive — not fetched, and why

The 2002 (or nearest early) DCP PLUTO/MapPLUTO archive would carry the actual
**tax-lot polygons** for the WTC superblock as they stood right after 9/11
(the physical lots weren't re-subdivided until redevelopment years later —
see `city-data-linkage.md` §3.1) — the best remaining path to a real
"site/superblock boundary" polygon. I did not fetch it:

- DCP's "Bytes of the Big Apple" archive page
  (`nyc.gov/site/planning/data-maps/open-data/bytes-archive.page`) is
  JS-rendered; no stable, guessable direct-download URL for the 2002/2003
  archive was found in a few search/fetch attempts (tried `s-media.nyc.gov`
  asset-path guesses, all 404).
- Even found, it ships as a **whole-borough/citywide shapefile ZIP**, not a
  queryable API — pulling one to extract ~5–10 lots is the "bulk download"
  this task told me to avoid, so I stopped rather than guess further.
- **Action item, not done here:** locate the actual 2002 (or earliest)
  MapPLUTO Manhattan archive URL (check `github.com/NYCPlanning/db-pluto`
  releases/changelog for a pinned link, or ask DCP's listed GitHub-issue
  contact), download once, clip to tax block 58 (the WTC block), and trace
  the lot boundary — that's real, sourceable geometry, just not one I could
  reach in this pass.

## 3. What's in `data/geo/wtc-2001.geojson`

8 `Point` features (WGS84), all `kind: "building"` except the plaza
(`kind: "site"`):

| Feature | Coordinates (lon, lat) | Source |
|---|---|---|
| 1 WTC (North Tower) | -74.013139, 40.712083 | [en.wikipedia.org/wiki/1_World_Trade_Center_(1970–2001)](https://en.wikipedia.org/wiki/1_World_Trade_Center_(1970%E2%80%932001)) |
| 2 WTC (South Tower) | -74.013056, 40.710944 | [en.wikipedia.org/wiki/2_World_Trade_Center_(1971–2001)](https://en.wikipedia.org/wiki/2_World_Trade_Center_(1971%E2%80%932001)) |
| 3 WTC (Marriott) | -74.014028, 40.711389 | [en.wikipedia.org/wiki/Marriott_World_Trade_Center](https://en.wikipedia.org/wiki/Marriott_World_Trade_Center) |
| 4 WTC | -74.0125, 40.710556 | [en.wikipedia.org/wiki/4_World_Trade_Center_(1975–2001)](https://en.wikipedia.org/wiki/4_World_Trade_Center_(1975%E2%80%932001)) |
| 5 WTC | -74.011389, 40.711944 | [en.wikipedia.org/wiki/5_World_Trade_Center_(1972–2001)](https://en.wikipedia.org/wiki/5_World_Trade_Center_(1972%E2%80%932001)) |
| 6 WTC (US Customs House) | -74.013333, 40.712778 | [en.wikipedia.org/wiki/6_World_Trade_Center_(1974–2001)](https://en.wikipedia.org/wiki/6_World_Trade_Center_(1974%E2%80%932001)) |
| 7 WTC (original) | -74.0119, 40.7133 | [en.wikipedia.org/wiki/7_World_Trade_Center_(1987–2001)](https://en.wikipedia.org/wiki/7_World_Trade_Center_(1987%E2%80%932001)) |
| Austin J. Tobin Plaza | -74.0125, 40.711667 | [en.wikipedia.org/wiki/Austin_J._Tobin_Plaza](https://en.wikipedia.org/wiki/Austin_J._Tobin_Plaza) |

Fetched via Wikipedia's REST summary API
(`en.wikipedia.org/api/rest_v1/page/summary/<title>`), cross-checked against
each building's Wikidata item (coordinate statement is the same value,
confirming it's not a page-rendering artifact). All 8 land within 55–236m of
the design brief's target `[-74.0134, 40.7115]` — the two towers themselves
land within ~70m, as required. **7 WTC's point is corroborated independently**:
it's within ~15m of the *current*, DOITT-verified footprint for the rebuilt
7 WTC (`data.cityofnewyork.us` `5zhs-2jue`, BIN 1086510), since the new
building sits on the old footprint — the one place I could cross-check a
historical point against a hard modern source.

**Licence:** Wikidata coordinate statements are CC0; Wikipedia article text
(descriptions, existence dates in the `note` field) is CC BY-SA 4.0 —
attribution to Wikipedia is required if that text is displayed verbatim.

**Every feature's `note` property says explicitly**: this is a point, not a
footprint; precision is city-block-to-building level (~10–200m), not
survey-grade; and (for 4/5/6 WTC) the building was damaged 9/11 and
demolished over the following weeks/months rather than destroyed instantly,
per each Wikidata item's own end-date.

## 4. Zones — none have public geometry (confirms `city-data-linkage.md` §3.2)

Re-searched, not just re-cited:

- **"Frozen zone"/restricted perimeter** (evolved daily, Sept–Oct 2001, south
  of Canal→Chambers→Houston depending on date): no shapefile/GeoJSON found
  anywhere; only prose descriptions and period news maps.
- **EPA/DEP dust or indoor-air sampling zones**: EPA's own WTC response
  archive and OIG reports describe sampling **sites** (up to ~60 locations,
  point-like) and **methodology**, not zone polygons; nothing downloadable
  as GIS.
- **FEMA 403** (Building Performance Study): a PDF report with damage-
  classification maps as figures, not a released GIS layer.
- Per the existing doc, the two eligibility boundaries that *are* officially
  defined in text — CDC's WTC Health Program "disaster area" (south of
  Houston St + 1.5mi Brooklyn radius) and the VCF "NYC Exposure Zone" (south
  of Canal/Clinton St) — still have no official GeoJSON either.

**None of these are in `wtc-2001.geojson`.** Per the brief ("never invent
geometry... if a feature cannot be sourced, leave it out and say so"), I did
not hand-trace them. If the map needs them, `city-data-linkage.md` §3.2's
recommendation stands: hand-digitize once from the official text/maps above,
tag each with its exact source and "approximate, hand-traced" — a deliberate
follow-up task, not something to fold into this "verified sources only" file.

## 5. How the map should render this

- Render the 7 buildings + plaza as **labeled point markers** (not filled
  building outlines) at a "1973–2001, destroyed 9/11" map layer, distinct
  from the current/rebuilt buildings layer — with a visible caveat ("marker,
  not footprint; approximate location") on hover/click, echoing the temporal-
  validity rule in `city-data-linkage.md` §5.
- **Replace nothing yet in `web/public/geo/reference.geojson`** — that
  prototype quad (a 5-point closed polygon, no properties, already labeled
  "approximate" per the brief) is a rough site outline; this file is a
  different, complementary kind of feature (named points, not a boundary) and
  is more precisely sourced per-point than the quad is as a whole. Swapping
  the quad out for something real still needs the §2 PLUTO/tax-lot work.
- Do **not** render the current Building Footprints layer's WTC-area
  polygons (1 WTC, 2 WTC, 4 WTC, 7 WTC, the Oculus — all real, queryable,
  confirmed above) as if they were the 2001 site; they're the rebuilt
  buildings on a redrawn street grid (Greenwich St reopened through the
  site) and would misrepresent 2001 if used silently.
- Leave a visible "zones not shown — see docs" note rather than omitting
  silently, so a future contributor doesn't assume none exist.

## Sources consulted

- `data.cityofnewyork.us` Socrata: `x7wt-jhdr` (metadata only), `5zhs-2jue`
  (current footprints, queried live)
- ArcGIS FeatureServer `services6.arcgis.com/yG5s3afENB5iO9fj/.../BUILDING_HISTORIC_view`
  (queried live, bbox + BIN lookups)
- `en.wikipedia.org/api/rest_v1/page/summary/*` and `wikidata.org/wiki/Special:EntityData/*`
  for the 8 point features
- `overpass-api.de` (OpenStreetMap) — confirmed no historical (pre-2001) WTC
  geometry exists in OSM, only the current rebuilt buildings
- USGS OFR 01-429 / `usgs.gov` WTC environmental studies pages, EPA WTC
  response archive, FEMA 403 (web search only — no GIS downloads exist)
- `nyc.gov/site/planning/data-maps/open-data/bytes-archive.page` (PLUTO
  archive page, not successfully resolved to a direct 2002 download)
