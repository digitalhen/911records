# City data linkage plan — resolving portal documents to buildings

Researched 2026-09-13. Scope: how to join the entities `scripts/embed/entities.py`
already extracts (BIN, block/lot, free-text address) to a canonical building
record, a footprint/point for mapping, and to NYC/federal datasets that add
value for 9/11 families, the sick, and their lawyers — starting from "the
building I lived or worked in."

Method: dataset IDs verified live against the Socrata catalog
(`api.us.socrata.com/api/catalog/v1`, domain `data.cityofnewyork.us`) and each
dataset's own metadata/query endpoint, `User-Agent:
sept11-docs-research/0.1 (contact: digitalhen@gmail.com)`, sequential, ~30
requests total, no bulk downloads. A few federal/DCP facts came from web
search rather than Socrata (there is no catalog to query) and are marked
**verified (web)** rather than **verified (Socrata)**. Everything else is
**unverified** and flagged as such.

Prospect (`~/Code/prospect`) was read (code + docs), not queried — no
connection was made to its dev or production database, and its pipeline
scripts were not run.

---

## 0. Top-line answer

**Yes — and Prospect has already solved the hard half of this (the address ↔
BBL ↔ BIN ↔ footprint resolver) for lower Manhattan specifically.** The
fastest path is not "go get NYC Open Data," it's "reuse Prospect's building
identity layer and normalizer, then layer 9/11-relevant tables on top of the
same BBL/BIN keys." Five joins, in priority order, are in §5.

---

## 1. What Prospect already has that this project can reuse

Prospect is a NYC residential-property tool scoped mostly to Manhattan
(`BOROS` defaults to `1` in most of its import scripts, expandable
borough-by-borough). It already solved building identity, address
normalization, and several of the exact datasets this project needs. Nothing
below was queried live — this is a read of `~/Code/prospect`'s code and
`docs/DATA-SOURCES.md`.

| Prospect table / module | Built by | Keyed on | What it gives this project |
|---|---|---|---|
| `properties` | the DOF tax-roll pipeline | `parid` (10-digit BBL for houses/condo units; `<building BBL>-U####` synthetic for co-op units) | The base building/unit universe for Manhattan, with `address`, `housenum_lo`, `street_name`, `zip_code` — i.e. a pre-built, pre-normalized address→BBL table for the exact borough where nearly all the DEP folders in this portal sit. |
| `lib/address/normalize.ts` (`normalizeStreet()`, `streetCandidates()`, `splitLine1()`, `addressQueryForms()`) | pure TS module, issue #505 | free text ↔ canonical street string | **Directly reusable as-is** (it is deliberately dependency-free — "no `./db`, no `next`") to turn an OCR'd address like `130 LIBERTY ST` or `WEST STREET` into the same canonical form the roll uses, and to generate every spelling variant (`ST`/`STREET`, ordinal/no-ordinal, directional abbreviations) a 2001-era memo might use. This is the single biggest time-saver available: rebuilding this table correctly took Prospect several issues (#424, #489, #504, #505) to get right, including the Queens `58 STREET`/`58 AVENUE`/`58 ROAD` grid trap that a naive "drop the street type" normalizer gets wrong. |
| `scripts/lib/emit_address_sql.ts` | generated from the TS module | same | If matching runs in SQL/OpenSearch analyzers rather than in a Node process, this script shows the pattern for emitting the identical normalization as a function rather than hand-porting it (avoids a second, drifting copy — CLAUDE.md's "keep-in-sync pairs" doctrine). |
| `acris_addresses` / `lib/acrisAddress.ts` | `scripts/build_acris_addresses.sh` | `bbl` | A derived house-number-from-deed-filings table for the ~28,095 citywide parcels (9,411 Queens) the roll files with a street and no number — same technique this project would need for any lower-Manhattan lot whose roll record is thin. Ships with an explicit provenance/confidence model (documents-agree vs. plurality-only) worth copying: **"how many filings agree" is exactly the kind of confidence signal a 9/11-era address match should carry too.** Note the discipline modeled here: it is presented as a *read*, never silently merged into the address of record. |
| `unit_bridge` (`scripts/build_unit_bridge.sh`) | NYC Building Footprints (`5zhs-2jue`) + PLUTO (`64uk-42ks`) | `(parid, bin)`, plus `billing_bbl` | **This is the BIN↔BBL bridge, already built**, exactly the join §2 below needs. It resolves a condo unit's own lot to its building's footprint (`base_bbl`/`mappluto_bbl` match; a condo unit lot itself isn't in the footprints file, so it falls back to nearest-footprint-on-block within ~60m using footprint centroids). Read `scripts/build_unit_bridge.sh` before rebuilding this from scratch. |
| `pluto_lots` | same script | `bbl` | `numfloors`, `unitsres`, `unitstotal`, `yearbuilt`, `bldgarea`, `numbldgs` per lot — useful for "how big is this building" context on a document page, and for sanity-checking whether an address plausibly matches a residential building at all. |
| `map_buildings` (footprints layer) | `scripts/import_footprints.sh`, `5zhs-2jue` | `bin` (+ `base_bbl`, `mappluto_bbl`) | **Directly answers Henry's map request.** Citywide (~1.08M polygons, WGS84), geometry simplified server-side (~0.5m tolerance) and packed by `scripts/footprints_pack.mjs` into a compact delta-encoded format (decoder in `lib/buildings.ts`) purely to keep payload size down — the packing is a size optimization, not a semantic transform, so an unpacked GeoJSON pull straight from `5zhs-2jue` is equally valid input for this project and doesn't require adopting Prospect's decoder. Carries `height_roof` (feet). **Important limit: this is a *current-day snapshot*.** It does not, by itself, show a building the way it looked in 2001 — see §3 below for the historic-footprints layer that does. Prospect's own build script cites `map_dots.gid`/`dot_members` (its own tier-coloring logic) as the only "which record wins" rule layered on top of raw footprints, which this project has no use for and should not carry over. |
| `map_buildings` seed dump (`buildings.dump`) | `scripts/dump_seed.sh` | — | **Committed to git in `prospect`, restorable read-only without touching production**: `pg_restore -d <db> --no-owner --no-acl data/seed/buildings.dump` against a local scratch Postgres gives the footprint polygons (`bin`, `base_bbl`, `mappluto_bbl`, geometry, `height_roof`) with **no live query against Prospect's database** — satisfying "read-only, no production access" while reusing real, already-cleaned geometry instead of re-fetching and re-simplifying 1.08M polygons from Socrata. Confirm the dump's actual borough scope before relying on it (Prospect's import script is written citywide, but a committed seed dump may have been captured at a narrower scope — check row count by borough after restoring, don't assume). |
| `lib/mapStyle.ts` / `lib/mapColorModes.ts` / `lib/mapPalette.ts` and the map rendering approach | frontend | — | Out of scope for this report by explicit instruction (a separate agent is inventorying Prospect's map *code*); noted here only so this document doesn't duplicate that work. |
| `parcel_nta` | `scripts/build_parcel_nta.sh` | `parid` → NTA name | Point-in-polygon assignment to DCP's **2020** Neighborhood Tabulation Areas, done in numpy (no PostGIS available). Reusable pattern for "which named area is this address/building in," but see §4: 2020 NTAs are the wrong geography to describe 2001 exposure — use 2000 census tracts instead (§2, §4). |
| `docs/DATA-SOURCES.md` | research doc | — | Already vets ACRIS, PLUTO, DOB permits/violations/C-of-O, HPD violations/complaints, 311, abatements, LPC-adjacent building facts, and Census/ACS for the same municipal-data universe this project needs, with measured join rates and known pitfalls (e.g., `tccode` space-padding gotchas, HPD violation apartment-string match rates). Read it before re-deriving any of those coverage numbers. |
| `lib/complaints311.ts` / `bldg_complaints` | `scripts/import_311.sh` | `bbl` | The 311 building-relevant complaint types Prospect already filters to (noise, elevator, scaffold, construction). Not useful for 2001-2002 (§2/§4 — 311 doesn't exist that far back), but the filtering *pattern* — pull only the complaint types that say something about the building, not tenant-maintenance noise — is worth copying for whatever complaint-shaped data this project does use (HPD violations, DOB violations, ECB).
| ACRIS pipeline (`import_acris.sh`, `build_sales.sh`) | — | BBL / `-U` co-op parid | Building **ownership** at any date since 1966 (pre-2003 admits tenure-only, no price — see CLAUDE.md's `$LEGACY_END` note). Relevant to lawyers establishing who owned/controlled a building in 2001-2002 (an entity-level fact, not a private individual's — see §6). Prospect's hard-won distinction — **ACRIS `recorded_borough` is the recording office, not the parcel's borough; always scope through `acris_legals`** — is a direct, non-obvious trap this project would otherwise hit fresh. |

**What Prospect does *not* have and this project would need to build new:**
DEP/DOHMH environmental or asbestos data, DOB C-of-O/permits/violations
*from 2001-2003 specifically* (Prospect's own C-of-O/permit sources don't
reach back that far either — see §2), any federal EPA/CDC/VCF data, and any
document/OCR-text search index. Prospect's `unit_facts` (broker-entered)
pattern — a runtime table for facts no government dataset carries — is a
reasonable model for capturing anything a family or lawyer contributes (e.g.,
"I worked on floor 9 of this building in Sept 2001") that isn't a matter of
public record, with the same care Prospect takes to never treat
broker/user-entered facts as if they were roll data.

---

## 2. Join keys: resolving an extracted entity to a canonical building

### 2.1 The keys available and what resolves them

| Key | Source of truth | Verified | Notes |
|---|---|---|---|
| **BIN** (7-digit Building Identification Number) | DOB Building Information System | — | The stable building identity DOB, DOB NOW, ECB, and (via footprints) the footprint geometry all key on. **A BIN is not permanently retired when a building is demolished** — DOB keeps issuing new BINs for new construction; a demolished building's old BIN persists in historical records (see §3) but its footprint disappears from the *current* layer. |
| **BBL** (borough-block-lot) | DOF tax roll / Digital Tax Map | — | The parcel identity ACRIS, PLUTO, and the DOF roll key on. **Lots merge, subdivide, and get renumbered** — a BBL valid today is not guaranteed to be the BBL that existed in 2001 for the same footprint (§3). |
| **Free-text street address** | as OCR'd | — | Ambiguous without a borough/ZIP hint and needs normalization (abbreviations, ordinals, street-type — exactly what `lib/address/normalize.ts` solves). Lower Manhattan is small and dense; several addresses in the extracted entities (Liberty, Cedar, Pine, Beaver, Gold Streets) are common street names that also exist in other boroughs, so any address-only match must be constrained to Manhattan block ranges or corroborated by a nearby BIN/block-lot in the same document/page. |
| **Property Address Directory (PAD)** | DCP | **verified (Socrata) — `bc8t-ecyu`**, "Property Address Directory," updated 2026-05-26 | Maps address ↔ BBL ↔ BIN, including alias addresses. **Confirmed still a `blobby`/file-attachment dataset in the Socrata catalog, not a queryable table** (`$select` against `resource/bc8t-ecyu.json` and `.columns` both come back empty/`blob`) — matching Prospect's own note in `scripts/build_unit_bridge.sh` that PAD "is a file attachment... and was not used." To use it you download the ASCII fixed-width/CSV files from DCP's "Bytes of the Big Apple" (`nyc.gov/planning`) and parse locally; there is no REST query. |
| **Geoclient / Geosupport** | DCP, via NYC's API Developer Portal | **verified (web)** — `api.nyc.gov/geoclient/v1/doc/`, portal at `api-portal.nyc.gov` | A free geocoding API that is the *authoritative* address→BBL/BIN resolver (it wraps DCP's own Geosupport engine) and, importantly, **can also normalize alias/historical addresses that PAD and the roll disagree on**. **Requires an API key**: register at `api-portal.nyc.gov`, create a project, subscribe to "Geoclient v1" (or add a subscription and read the key from your portal profile) — free, but not anonymous/keyless like most Socrata reads. Best use here: a small number of ambiguous OCR'd addresses per document, not bulk geocoding of the whole corpus (rate-limited free tier). |
| **Building footprints (current)** | `5zhs-2jue` "BUILDING" | **verified (Socrata)**, updated 2026-09-13, fields include `bin`, `base_bbl`, `mappluto_bbl`, `height_roof`, geometry | BIN → polygon + a `base_bbl`/`mappluto_bbl` cross-reference. This is what Prospect's `map_buildings`/`unit_bridge` already load (§1). |
| **Building footprints — historic** | `x7wt-jhdr` "Building Footprints Historic (Map)" | **verified (Socrata catalog entry)**; field list **verified (web)** via the dataset's own linked metadata doc (`github.com/CityOfNewYork/nyc-geo-metadata`, `Metadata_BuildingHistoric.md`) | Carries **BIN, construction year, demolition year, alteration year, BASE_BBL, MAPPLUTO_BBL, and geometry** for buildings that have been demolished or significantly altered — i.e., the layer that can show a 2001-era building's footprint even though it's gone today. Updated daily; NYC-wide. **Unverified: whether its historical reach actually extends back to capture the original Twin Towers, the original 7 World Trade Center, or the Deutsche Bank Building as they stood pre-collapse/pre-demolition** — the Socrata resource endpoint for this ID returned empty rows to a direct query (it may be ArcGIS-FeatureServer-backed rather than a queryable Socrata table, like PAD). Confirm by requesting the ArcGIS layer directly (`nycmaps-nyc.hub.arcgis.com`, tag `building`) before relying on it for the WTC-site buildings specifically; digital footprint capture in NYC is LIDAR-flight-based (2010, 2014, 2017 waves are documented publicly) and may not reach back to 2001 at all, in which case the *only* remaining source for those specific footprints is historical aerial imagery / DCP's PLUTO archive polygons (below), not this layer. |
| **PLUTO (current)** | `64uk-42ks` "Primary Land Use Tax Lot Output" | **verified (Socrata)**, updated 2026-08-24 | BBL → lot centroid/lot-line polygon (via MapPLUTO, `f888-ni5f`, also verified live) plus `numfloors`, `yearbuilt`, `unitsres`, etc. — what Prospect's `pluto_lots` already loads. |
| **PLUTO archives (historical, e.g. 2002)** | DCP, "Bytes of the Big Apple" | **verified (web)** — multiple independent sources (NYC Planning's own PLUTO README, `github.com/NYCPlanning/db-pluto`) state DCP has released PLUTO annually **back to 2002** and that "all previously released versions... are available on the DCP Website: BYTES of the BIG APPLE" (`nyc.gov/planning`) | **Not on Socrata** — static annual ZIP releases, not a live catalog entry. This is the correct source for "what BBL/lot shape existed here in 2002," which is the historically honest answer for the WTC site and any subsequently-subdivided or merged lot, rather than reading today's BBL backward onto 2001. |
| **PLUTO Change File** | `qt5r-nqxp` | **verified (Socrata)**, fields `bbl, field, old_value, new_value, type, reason, version` | Tracks DCP's own field-level *corrections* to PLUTO, not lot merge/subdivision history — **does not** answer "which BBLs merged since 2001." For that, diff two PLUTO archive years directly (2002 vs. current) rather than relying on this file. |

### 2.2 The resolution pipeline (proposed)

For each extracted entity mention (BIN, block/lot, or address), in priority
order:

1. **BIN present and 7 digits** → look up directly against current
   `5zhs-2jue` footprints for a live polygon; if absent (demolished/retired),
   check `x7wt-jhdr` historic footprints (pending the ArcGIS-reach
   verification above) for the historical polygon and its `demolition_year`.
2. **Block/lot present** (borough usually implied as Manhattan/1 by the
   document population) → compose a BBL (`1` + block×10000 + lot, matching
   Prospect's own `pluto_lots` construction in `build_unit_bridge.sh`) and
   resolve via current PLUTO/footprints; if the modern BBL doesn't exist or
   its lot shape looks wrong for the era, fall back to the nearest **2002
   PLUTO archive** BBL for the same block/lot before assuming a match.
3. **Address only** → run through `lib/address/normalize.ts`'s
   `splitLine1()`/`streetCandidates()` (reused as a library, not
   re-implemented) to get every roll-spelling variant, then match against
   `properties.address` (Prospect's roll-derived table, restorable read-only
   from the committed `mrow.dump`) constrained to Manhattan house-number
   ranges plausible for the named street; corroborate against any BIN/block-lot
   found elsewhere **on the same page or document** before trusting a bare
   address match, the same "confidence ladder" idea behind
   `acris_addresses`'s document-agreement scoring (§1).
4. **Geoclient as arbiter**, not bulk pass: when 1–3 disagree or return
   nothing, submit the specific OCR'd string to Geoclient (with the API key)
   and take its BBL/BIN as the tie-break, logging that it was Geoclient-
   resolved (a fact worth keeping alongside the match, per Prospect's
   "provenance travels with the number" discipline in `acrisAddress.ts`).
5. Every resolution carries a **confidence label** (exact BIN; block/lot
   composed BBL; address-matched; Geoclient-arbitrated) rather than being
   silently normalized into "the" building — mirroring
   `acrisAddress.ts`/`leadsHeading()`'s "a coin flip does not get to be the
   heading" rule.

---

## 3. Geometry and the map: BIN/BBL → footprint → point, including buildings that no longer exist

**Best source per key** (see §2.1 for verification detail):

- **BIN → polygon (today):** `5zhs-2jue` Building Footprints — verified, has `bin`, `base_bbl`, `mappluto_bbl`, `height_roof`, geometry. Same source Prospect's `map_buildings`/`unit_bridge` already load.
- **BIN → polygon (demolished/altered):** `x7wt-jhdr` Building Footprints Historic — verified to exist and carry `bin`, `construction_year`, `demolition_year`, `alteration_year`, `base_bbl`, `mappluto_bbl`, geometry (per its linked metadata doc); **its reach back to 2001 is unverified** and should be checked directly against the ArcGIS FeatureServer before committing to it for the WTC-site buildings (§2.1).
- **Address/BBL → BIN:** PAD (`bc8t-ecyu`) is the authoritative *source*, but it's a downloadable file, not an API — parse locally. Geoclient is the live-query alternative and needs a free API key (`api-portal.nyc.gov`).
- **BBL → lot centroid/polygon:** current MapPLUTO (`f888-ni5f`) or tabular PLUTO (`64uk-42ks`) for today; the 2002+ DCP PLUTO archive (static ZIPs, not Socrata) for the lot shape as it existed historically.
- **Does Geoclient need a key?** Yes — confirmed above; it is free but requires registration, unlike the anonymous Socrata reads used everywhere else in this plan.

### 3.1 Historical cases — what a 2001 BIN/BBL resolves to today

These are the hard cases named in the brief, researched at a level suitable
for wiring an app, not for legal certainty. **Do not hardcode specific BIN/BBL
numbers into product code from this report** — resolve each one live through
the pipeline in §2.2 and record what it actually returns, because:

- **World Trade Center site.** The original WTC superblock was largely a
  small number of very large tax lots. Post-2001, the site was substantially
  **re-subdivided** as it was rebuilt (1 WTC, 4 WTC, the Memorial, transit
  hub, etc. each now sit on distinct, newer lots) and the parcels are
  publicly documented as under Empire State Development / Port Authority
  control through the WTC redevelopment program (`esd.ny.gov/wtc-site-5` —
  **verified (web)**, current as of this research). A **2001-era BBL for a
  point on the WTC site will very likely not equal today's BBL for that same
  point** — the honest join is address/BIN-of-record at the time (from the
  document itself or from a 2002 PLUTO archive lookup), displayed with a note
  that the modern parcel differs, not silently resolved to whatever BBL
  covers that ground today.
- **Deutsche Bank Building, 130 Liberty Street.** **Verified (web,
  Wikipedia + `esd.ny.gov`):** closed after 9/11 due to contamination from
  the South Tower collapse, acquired by the Lower Manhattan Development
  Corporation in 2004, deconstructed 2007–2011. The site is now "World Trade
  Center Site 5," still in active redevelopment planning as of the most
  recent source found. Its original BIN/footprint is a textbook case for the
  historic-footprints layer (if verified to reach back that far) or for a
  2002 PLUTO archive lookup — the current footprints layer will show either
  nothing or a different building.
- **Fiterman Hall (30 West Broadway) and WTC 7.** Both were damaged/destroyed
  and later **rebuilt on the same or an adjacent footprint** — unverified in
  this pass whether the rebuilt structure kept its old BIN or was assigned a
  new one (DOB's practice varies; a straightforward "did the BIN change"
  query against DOB's BIN status/history isn't exposed as a simple Socrata
  field). **Action item, not answered here:** resolve each specific address
  through the pipeline in §2.2 and record whether the returned BIN's
  `construction_year` (from current footprints, if present) postdates 2001 —
  that is the signal that a rebuild occurred on the same address under a
  possibly-different BIN.
- **General rule to state in the product, not just this doc:** a building
  identity displayed for a document dated 2001–2003 should carry a visible
  "as of [document date]" / "today" toggle or a plain-language note when the
  resolved footprint's `construction_year` (or its absence from the historic
  layer) implies the building shown did not exist, or existed differently, in
  2001. This is the geometry-layer version of the temporal-validity rule in
  §4.

### 3.2 Reference outlines (site/zone boundaries)

- **A single official "WTC site boundary" GeoJSON was not found** in the
  Socrata catalog under searches for "World Trade Center boundary" /
  redevelopment (searched, no relevant hits returned — see command log).
  **Unverified / likely does not exist as an open-data layer**; the WTC site
  footprint would have to be assembled from the current BBLs under Port
  Authority/ESD control (via PLUTO ownership fields) or traced from the
  Building Footprints layer's own polygons for 1/4/7 WTC etc.
- **WTC Health Program "New York City disaster area"** — **verified (web,
  CDC `cdc.gov/wtc/define.html` plus corroborating legal-practice sources):**
  defined in the program's governing text as Manhattan **south of Houston
  Street**, plus any Brooklyn block wholly or partly within a **1.5-mile
  radius of the former WTC site**; the **responder** eligibility boundary
  (as opposed to survivor) sits further south, at **Canal Street**. CDC
  publishes official maps at the URL above — that page, not this report, is
  the source to screen-scrape or hand-digitize a boundary polygon from if one
  is needed for display; no GeoJSON of it was found on Socrata.
- **VCF "NYC Exposure Zone"** — **verified (web)**, and explicitly **narrower
  than and different from** the WTC Health Program's disaster area: Lower
  Manhattan **south of Canal Street / Clinton Street** (a materially smaller
  area than "south of Houston"). Multiple 9/11-law-firm explainer pages
  converge on this distinction independently, which is itself a sign the
  distinction is well-established and worth surfacing prominently in-product
  — a family or lawyer who only sees one boundary drawn will misjudge
  eligibility for the other program. **No official VCF GeoJSON found**;
  same recommendation as above (digitize from the official description/map
  rather than inventing a boundary).
- **Recommendation:** treat both boundaries as **reference overlays worth
  hand-tracing once** from the authoritative text/maps above (a few dozen
  vertices each, not a data-pull), tagged clearly as "WTC Health Program
  disaster area" vs. "VCF NYC Exposure Zone" so the product never conflates
  them — echoing the multiple 9/11-law-firm pages that exist specifically
  because families confuse the two today.

### 3.3 Recommended local output shape

A single **`buildings.geojson`**, `FeatureCollection`, one `Feature` per
building record encountered in the corpus (current or historic), each with:

```jsonc
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [...] },  // or Point if only a centroid is available
  "properties": {
    "bin": "1001234",                 // string, preserves leading structure; null if unresolved
    "bbl": "1001167501",              // string; the BBL used TODAY to resolve this record
    "bbl_as_of": "2002",              // "current" | a PLUTO archive year, when a historical BBL was used instead
    "address_norm": "130 LIBERTY STREET",   // canonical form via lib/address/normalize.ts logic
    "source": "footprints_current | footprints_historic | pluto_archive_2002 | geoclient | address_match",
    "match_confidence": "bin_exact | blocklot_exact | address_matched | geoclient_arbitrated",
    "construction_year": 1974,        // from footprints/historic layer, nullable
    "demolition_year": 2011,          // nullable; present only for historic-layer records
    "height_roof_ft": 566,            // nullable
    "doc_ids": ["DEP-00123", "DEP-00456"],   // Bates/portal doc identifiers that named this building
    "mention_count": 14
  }
}
```

Keying by **both** `bin` and `bbl` (rather than either alone) matters because
some sources in this plan only carry one of the two per record (e.g., legacy
DOB Violations carries `boro/block/lot` but not always a real `bin`; ACRIS
carries BBL, never BIN). Keep both fields present-but-nullable rather than
picking one canonical key, and let the resolution pipeline in §2.2 fill in
whichever it found. For the OpenSearch page/document index (§7), each page
document should carry the **same** `bin`/`bbl` pair (nullable) as a filterable
field, so "show me every page that mentions this building" and "show me this
building's footprint" are two views over the same join key, not two separate
identity systems that can drift apart.

---

## 4. Candidate datasets

Grouped as requested. "Adds" is written for the target audience (families,
the sick, lawyers), not for a generic data-catalog description.

### 4.1 Property / ownership

| Dataset | Publisher | ID/URL | Coverage | Key fields | Join key | Cadence | Adds |
|---|---|---|---|---|---|---|---|
| ACRIS Real Property Master/Legals/Parties | DOF | `bnx9-e6tj` / `8h5j-fqxa` / `636b-3b5g` (all pre-verified in `prospect/scripts/import_acris.sh`, not re-verified here since Prospect's own header cites the exact ids and a 2026-08 measurement) | 1966 → present | doc type/date/amount; BBL+unit; party names+mailing address | BBL (via legals, never master's `recorded_borough`) | daily (Prospect pulls nightly/weekly deltas) | Who owned/controlled a building in 2001-2002 — **entity owners only, see §6** — and the deed chain since, useful for a lawyer identifying a defendant/respondent. |
| DOF roll / PLUTO (current) | DOF/DCP | `64uk-42ks`, `f888-ni5f` | today | units, floors, year built, land use | BBL | annual | Present-day building facts; **not** 2001 facts (§4.4 below is the caution). |
| PLUTO archives (2002+) | DCP, "Bytes of the Big Apple" | not on Socrata — `nyc.gov/planning` static ZIPs | annual snapshots since 2002 | same fields, as filed that year | BBL (that year's) | annual, historical | The historically correct BBL/lot shape/use for a document dated 2001-2003, and the only clean way to detect a lot merge/subdivision since (§2, §3.1). |
| Condo/co-op declaration structure | via PLUTO `condo_number`, ACRIS legals unit strings | — | ongoing | unit enumeration | building BBL + unit | — | Whether a named apartment/office suite is a condo unit (own BBL) or a co-op/rental unit (no separate deed) — governs how far ownership research can go per unit (co-ops have no deed; see Prospect's own `docs/DATA-SOURCES.md` structural note). |

### 4.2 Buildings

| Dataset | Publisher | ID | Coverage | Key fields | Join key | Cadence | Adds |
|---|---|---|---|---|---|---|---|
| Building Footprints (current) | DCP/DOITT (OTI) | `5zhs-2jue` | today | bin, base_bbl, mappluto_bbl, height_roof, geometry | BIN/BBL | daily | Map base layer (§3). |
| Building Footprints Historic | OTI | `x7wt-jhdr` | demolished/altered buildings, reach-back **unverified** | bin, construction/demolition/alteration year, base/mappluto BBL, geometry | BIN/BBL | daily | 2001-era buildings that no longer exist — **verify reach before relying on it for WTC-site structures** (§2.1, §3.1). |
| DOB Certificate of Occupancy (legacy, BIS) | DOB | **verified (Socrata)** `bs8b-p36w` | `c_o_issue_date` min **2012-07-12** in this table | job#, BIN, issue type | BIN/BBL | — | **Does not reach 2001-2003.** No open-data C-of-O record exists for the post-9/11 reoccupancy period; if a building's reoccupancy certificate from that era matters, it will only exist inside the portal's own DOB documents, not in open data. State this limit plainly rather than implying coverage. |
| DOB NOW Certificate of Occupancy | DOB | `pkdm-hqz6` | modern (DOB NOW era, ~2016+) | — | BIN | daily | Same limit — too recent to help. |
| DOB Violations (legacy BIS) | DOB | **verified (Socrata)** `3h2n-5cm9` | issue_date back to at least **1988**; **47,939 Manhattan (`boro='1'`) rows with `issue_date` starting `2001` or `2002`, confirmed by direct query** | boro/block/lot, bin (often `0000000` in older rows — confirmed in sample), issue_date (raw `YYYYMMDD` string, needs parsing), violation_type, description | block/lot → BBL (BIN often unreliable pre-2000s, sample confirmed) | — (static/legacy) | **The one DOB compliance dataset that actually covers 2001-2002.** Filed against a building, it can corroborate "this building had open violations/inspections around 9/11" — a fact potentially relevant to occupancy/reoccupancy questions, though not a substitute for the portal's own DOB records. |
| DOB Permit Issuance (current) | DOB | `ipu4-2q9a` | filing_date min **2007-01-01** (queried live) | — | BIN/BBL | daily | Too recent for 2001-2003 filings. |
| Historical DOB Permit Issuance | DOB | **verified (Socrata)** `bty7-2jhb` | filing_date **1989-05-11 → 2013-11-26**; **85,198 Manhattan rows with `filing_date` starting `2001`/`2002`, confirmed by direct query** | BIN, block/lot, job/permit type, work_type, filing/issuance dates, owner name/business fields | BIN/BBL | frozen (superseded, but still queryable) | **Covers demolition and reoccupancy-era permit filings for 2001-2003** — the single best DOB source in open data for "what permit work happened at this address right after 9/11" (demolition permits, alteration/reoccupancy work). Column names carry inconsistent underscores between this and the current dataset (e.g. `bin` here vs. `bin__` in `ipu4-2q9a`) — do not assume identical schemas when unioning the two. |
| ECB Violations | DOB/OATH | `6bgk-3dad` | — (not date-range-checked this pass; Prospect's own header cites it as OATH-adjudicated, "ACTIVE only" for their use, but the underlying table itself is not filtered) | BIN, boro/block/lot, hearing/issue/served dates, respondent name+address, penalty | BIN/BBL | — | Whether a building had adjudicated code violations; respondent name may be an entity (management co.) — see §6 before ever surfacing a name from this table. |
| DOB Safety Violations | DOB | `855j-jady` | current-era ("Active only" per Prospect's own use) | — | BIN | — | Modern only; not useful for 2001-2003. |
| LPC Permit Application Information | Landmarks Preservation Commission | **verified (Socrata)** `dpm2-m9mq` | `issue_date` **1900-01-26 → 2026-09-04** (queried live; long tail, likely thin in the earliest years) | docket, address, block/lot, applicant/owner name+address, worktypes, issue/expiration dates | block/lot (address also present) | — | Whether a building is landmarked and what work was permitted on it — relevant context for several DEP-documented lower-Manhattan buildings that sit inside historic districts (the South Street Seaport / lower Manhattan historic districts run through this exact area). Owner-name fields here can be individuals — apply §6. |
| Individual Landmark / Historic District layers | LPC | `7mgd-s57w`, `xbvj-gfnw`, `ts56-fkf5` (all appear as Map-type/`viewType: geo`, catalog-verified, not row-level-verified) | current designations | address/BBL, district name | BBL | — | Static context layer: "is this building landmarked" for building-detail pages. |

### 4.3 Environmental / asbestos

| Dataset | Publisher | ID | Coverage | Key fields | Join key | Cadence | Adds |
|---|---|---|---|---|---|---|---|
| DEP Asbestos Control Program (ACP7) | DEP | **verified (Socrata)** `vq35-j9qm` | `start_date` min **2017-11-11** (queried live) — **confirmed zero rows for Manhattan between 2001-09-01 and 2003-01-01** | bin, block/lot, bbl, address, `acm_type`/`acm_amount`, abatement_type, building_owner_name, contractor_name | BIN/BBL/block-lot (all present as real columns — this is the best-keyed asbestos dataset if it covered the right years) | — | **Does not cover 2001-2002.** ACP7 filings only digitized once DEP's e-filing system (ARTS) went live; the paper ACP7 forms from the actual WTC-area abatement wave of 2001-2002 are **not in open data at all** — they exist, if anywhere in structured/scanned form, inside this portal's own DEP "68 boxes" release. This is the single most important negative finding in this report: **the modern open-data asbestos table cannot answer "which lower-Manhattan buildings had asbestos abatement filed in 2001-2002" — only the portal's own documents can**, which is exactly the extraction this project is already doing. Its *schema* (bin/block/lot/bbl/address/contractor/owner/acm_type/amount) is nonetheless the right target schema to normalize the portal's OCR'd ACP7-style filings into, since it's DEP's own field set for the same form. |
| EPA WTC environmental/indoor-air data (2001-2003) | EPA (federal) | not on Socrata; per `sept11-docs/docs/CONTEXT.md`'s existing research: Yale Avalon Project HTML pages (`avalon.law.yale.edu/sept11`), EPA OIG report 2003-P-00012, EPA OIG survey 2003-P-00014, GAO-07-1091/GAO-07-806T | Sept–Dec 2001 daily summaries (Avalon); reports through 2007 | narrative/tabular by location in text, not structured lat/lon or BIN | none — addresses named in prose, would need manual geocoding | static | Contemporary public-facing federal statements to set against the portal's internal DEP/DOHMH memos (already flagged as a strong product angle in `docs/CONTEXT.md` §5's "internal-memo vs. press-release diff view"). **Not structured data** — this is a manual/LLM-assisted extraction project of its own, already scoped in the existing CONTEXT.md rather than something this report re-derives. |
| DOHMH environmental/health data | DOHMH | not searched this pass (out of scope for the 3-question dataset list; DOHMH is one of the agencies the City has only promised "going forward," per CONTEXT.md §1) | — | — | — | — | Flagged as promised-but-not-yet-released; revisit once/if DOHMH records land in the portal itself. |
| EPA's 2002-2003 indoor-cleaning/testing program data | EPA (federal) | Referenced in CONTEXT.md's GAO reports; **not separately verified this pass as a downloadable structured dataset** — the GAO reports describe/critique the program's methodology and results narratively | 2002-2003 | — | — | static | Likely exists only as report tables inside the GAO/EPA OIG PDFs already catalogued in CONTEXT.md, not as an open, queryable file. Treat as **unverified structured availability** — a follow-up task, not assumed here. |

### 4.4 Complaints

| Dataset | Publisher | ID | Coverage | Key fields | Join key | Cadence | Adds |
|---|---|---|---|---|---|---|---|
| 311 Service Requests | DSNY/DoITT | `erm2-nwe9` (2020→), `76ig-c548` (2010-2019), plus yearly archives `sqcr-6mww` (2004), `hy4q-igkk` (2006), `sxmw-f24h` (2005), `aiww-p3af` (2007), `uzcy-9puk` (2008), `3rfa-3xsf` (2009) — all **verified (Socrata) to exist**, earliest archive found is **2004** | 2004 → present across the archives found | BBL, complaint type, dates | BBL | daily/annual | **Does not and cannot cover 2001-2002** — 311 itself launched March 2003, and even the earliest per-year open-data archive found is 2004. No amount of searching will find 311 data for the 9/11 window; say so plainly rather than silently omitting the years. |
| HPD Housing Maintenance Code Violations | HPD | `wvxf-dwi5` (per Prospect's own use, already loaded as `hpd_violations`) | `novissueddate` back to **1959-04-27** (per Prospect's docs; not independently re-verified this pass, but is the one dataset here already vetted end-to-end by Prospect with a measured apartment-string match rate — see `docs/DATA-SOURCES.md`) | BBL, apartment string, class (A/B/C), issue/certify dates | BBL (+ weak apartment-string match) | daily | **The one HPD dataset that reaches 2001-2002.** Building-level distress signal usable for "was this residential building already flagged for maintenance problems going into/coming out of 9/11" — a fact potentially relevant to habitability/reoccupancy narratives. Prospect's own measured caveat applies here too: apartment-string→unit resolution is weak (~2-3%), so treat any hit as building-level evidence, not proof about a specific unit. |
| HPD complaints (`ygpa-z7cr`) | HPD | per Prospect's docs, this replaced older retired complaint IDs | daily-updated, large (16.26M rows per Prospect's count) | BBL + apartment | BBL | daily | Same era question as violations above — **not independently date-checked this pass**; if used, verify its own back-to-2001-2002 reach before citing it as coverage (do not assume from the violations dataset's coverage). |

### 4.5 Geography / people

| Dataset | Publisher | ID | Coverage | Key fields | Join key | Cadence | Adds |
|---|---|---|---|---|---|---|---|
| 2020 Neighborhood Tabulation Areas | DCP | **verified (Socrata)** `9nt8-h7nd` | current (2020 boundaries) | NTA code/name, geometry | point-in-polygon | static (redrawn per census) | Aggregation geography for **today's** boundaries — what Prospect's `parcel_nta` already uses. **Wrong geography for 2001** (§4.6 below) — 2020 NTAs did not exist as drawn in 2001, and some boundaries changed materially between the 2000/2010/2020 tabulation area redraws. |
| 2000/2010 Census tracts | Census Bureau (federal) | not searched this pass on Socrata (Census geography isn't a `data.cityofnewyork.us` catalog entry); Prospect already imports ACS tract data via `import_acs_tracts.sh` per its own docs | contemporary to 2001 (2000 tract boundaries) | tract geoid, boundary | lat/lon or BBL→tract | decennial | **The temporally correct small-area geography for 2001 events** — use 2000 Census tract boundaries, not 2020 NTAs, when aggregating exposure/health-adjacent facts to avoid identifying individuals while still being geographically honest about "what area, as drawn at the time." |
| Community Districts | DCP | **verified (Socrata)** `5crt-au7u` | current | CD number, geometry | point-in-polygon | static | Coarser, more stable alternative to NTA — Manhattan's Community District 1 (Battery Park City/Financial District/Tribeca) covers almost exactly the DEP-documented zone and, being a much older and more stable geography than NTAs, changes shape far less often — worth considering as the *primary* display geography for this reason alone. |
| WTC Health Program catchment | CDC/NIOSH (federal) | `cdc.gov/wtc/define.html` — **verified (web)**, see §3.2 for the exact boundary text | current program definition | boundary description (Houston St / Canal St / 1.5mi Brooklyn radius) | none published as GIS | — | Eligibility-relevant boundary to display **as its own labeled overlay**, not merged with the VCF zone (§3.2). No microdata is public — CDC publishes only aggregate quarterly enrollment/claims summaries (already in CONTEXT.md). |
| VCF "NYC Exposure Zone" | DOJ (federal, administers VCF) | see §3.2 | current program definition | boundary description (south of Canal/Clinton) | none published as GIS | — | Same treatment as above; **must be shown distinctly from** the WTC Health Program boundary given how often lawyers' own explainer pages note the public confuses the two. |

### 4.6 Explicit note on the WTC Health Program / VCF non-public data

Per the brief's question: **what is public vs. not.** The eligibility *zone
definitions* are public (CDC publishes the legal/plain-language boundary; DOJ
publishes VCF's). Individual **enrollment, exposure certification, and claims
records are not public and this project must never attempt to infer or
reconstruct them** — CDC's own public output is aggregate quarterly summaries
only (enrollment counts, claim category counts), already catalogued in
`docs/CONTEXT.md`. Nothing in this plan proposes touching anything beyond
that aggregate layer.

---

## 5. Temporal validity — what NOT to read as a 2001 fact

Datasets in this plan fall into three temporal buckets; the product must
visibly distinguish them, not just document the distinction here:

1. **Current-snapshot datasets that must NEVER be read as describing 2001:**
   PLUTO (current), Building Footprints (current), the DOF roll/current
   ownership, DOB Certificate of Occupancy (both editions — neither reaches
   before 2012), DOB Permit Issuance (current, 2007+), DOB Safety Violations,
   DEP ACP7 (2017+), 2020 NTAs. Any UI surface built from these must say
   "as of today" plainly next to the fact (Prospect's own release-standards
   rule — "never phrase a claim more broadly than the value the condition
   tested" — applies directly: a current owner name is not "the owner," it
   is "the owner today").
2. **Datasets that genuinely reach back to 2001-2003 and can be shown as
   period facts, with their own caveats:** Historical DOB Permit Issuance
   (85,198 Manhattan 2001-2002 rows, verified), legacy DOB Violations
   (47,939 Manhattan 2001-2002 rows, verified — but many older rows carry
   `bin='0000000'`, so resolve via block/lot, not BIN, for this table),
   HPD Housing Maintenance Code Violations (1959→ per Prospect, unverified
   here independently), ACRIS (1966→, with the pre-2003 "tenure-only, no
   price" caveat Prospect already documents and this project should copy
   verbatim rather than re-derive), and PLUTO archive years 2002+ (a genuine
   period snapshot, distinct from "PLUTO" meaning "today").
3. **Datasets with no 2001-2003 data at all, where the honest UI move is to
   say so rather than show an empty state that reads as "nothing happened":**
   311 (predates its own 2003 launch), DEP ACP7, both Certificate-of-Occupancy
   sources. Prospect's own release-standards doctrine on this exact failure
   mode — "an unbuilt list rendering as 'no units match'" (#454) and "nothing
   on the record ranks this unit" being too broad a claim (#464) — is the
   right template: a page for a 2001-era building should say **"311 records
   do not exist before 2003 — this is not evidence nothing was reported,"**
   never render a silent empty complaints panel.

For any building-detail page, the correct pattern (borrowed directly from
Prospect's `acrisAddress.ts` provenance-note style) is: **state what is
known, state which dataset it came from, and state the years that dataset
can and cannot speak to**, right next to the fact — not in a separate methods
page.

---

## 6. Privacy rule

**Proposed rule, directly adapted from Prospect's own inverted-privacy
posture (per this project's design brief) and from the project's stated
target audience of people seeking their own compensation, not people
building a public dossier on private individuals:**

- **Building-level and entity-owner facts are surfaced freely.** A
  corporation, LLC, city agency, contractor firm, laboratory, or government
  official acting in an official/professional capacity may be named — this
  mirrors the project's existing `entities.py` design ("people are only ever
  searchable as a role on a record, in an official capacity") and Prospect's
  own precedent of naming entity owners (never individuals) on `unit_features`.
- **No individual unit owner, tenant, resident, or worker is ever named**,
  even where a source dataset (ACRIS parties, DOB owner fields, ECB
  respondent fields, LPC applicant/owner fields — all flagged inline in §4
  where this applies) carries a private person's name. Filter these at
  ingest, the same way `entities.py` already tags every person mention
  `pii=1` and withholds captured text on its own PII screen.
  - A residential co-op or condo unit's owner-of-record, specifically, is a
    private individual by default and must never be surfaced as "who lived
    here" — this needs stating explicitly because it's the one place a
    property dataset (ACRIS/PLUTO/roll) most directly tempts a building page
    into naming a resident.
  - `owner_entity`-style detection (LLC/Corp/Inc./Trust name patterns, which
    Prospect already implements in `lib/ownerEntity.ts` /
    `scripts/build_unit_features.sh`) is the right mechanical filter for
    "is this name safe to show" — reuse the *test*, not necessarily the code,
    since Prospect's version is tuned for real-estate deed data specifically.
- **Aggregation windows use entity/geography, never a named individual**, per
  §4.5 — 2000 Census tract or Community District counts, not "who lived in
  unit 4B."
- **Every example printed in this report is already entity-level or
  anonymized** — no name from ACRIS, ECB, DOB, or LPC party/owner/respondent
  fields appears above, by design, in keeping with the project's own rule.

---

## 7. OpenSearch note (per Henry's search-engine choice)

Because the search engine is now OpenSearch, every dataset recommended above
that a family or lawyer might want to filter *documents* by (which building,
which era) should be joinable into the page/document index as **filterable
keyword fields alongside the Bates page key**, not as a separate lookup a
user has to cross-reference by hand:

```jsonc
// one OpenSearch document per extracted page, indexed today
{
  "bates_id": "DEP-000123",
  "doc_id": "...",
  "page": 4,
  "text": "...",
  "bin": "1001234",          // nullable, from the resolution pipeline in §2.2
  "bbl": "1001167501",       // nullable
  "bbl_as_of": "2002",       // "current" | archive year
  "match_confidence": "bin_exact",
  "nta_2020": "...",         // for today's-geography filtering
  "tract_2000": "...",       // for period-correct geography (§4.5)
  "date_mentioned": ["2001-10-06", ...],   // from entities.py's date extraction
  "agencies": ["DEP", "DOHMH"],
  "contaminants": ["asbestos"]
}
```

`bin`/`bbl` as **keyword** (not text) fields makes "every page about this
building" and "every building mentioned near this date" both simple term/range
queries, and lets the map (§3.3's `buildings.geojson`) and the document search
share one join key instead of two identity systems that can drift. This is
additive to the resolution pipeline in §2.2 — OpenSearch doesn't change what
needs resolving, only confirms the resolved keys should live as first-class
indexed fields rather than being computed at query time.

---

## 8. Fastest path — phased plan

Ranked by value-to-effort for the stated audience (families starting from "a
building I lived or worked in"), and stating plainly which datasets Prospect
already holds vs. what needs fresh fetching.

**Phase 1 — building identity + map (reuse Prospect, ~1-2 days of engineering):**
1. Vendor `lib/address/normalize.ts` (or call it directly if this project can
   share the module rather than fork it) for address canonicalization — zero
   new research, it's a finished, well-tested module.
2. Restore `buildings.dump` (map_buildings footprints) from Prospect's
   committed seed into a local scratch Postgres/GeoJSON export — gives the
   current-day footprint/BIN/BBL layer for the whole city with no live query
   against Prospect and no new Socrata pull for the base layer.
3. Build the BIN/BBL/address resolution pipeline (§2.2) against the extracted
   `mentions` table in `entities.sqlite`, writing results (with confidence
   labels) into a new local table/`buildings.geojson` (§3.3).
4. Pull `x7wt-jhdr` (historic footprints) fresh from Socrata (small,
   citywide) and verify its 2001 reach directly (§2.1) before wiring it in as
   the "how did this look then" layer.

**Phase 2 — the one asbestos join that matters (fresh fetch, small):**
5. Fetch `vq35-j9qm` (ACP7) schema-only (it has zero 2001-2002 rows) purely
   to reuse its **field names** (`acm_type`, `acm_amount`, `abatement_type`,
   `procedure_name`, `building_owner_name`→entity-filtered) as the target
   schema for normalizing the portal's own OCR'd ACP7-style asbestos filings
   — this turns "asbestos mentions" from free text into a structured,
   filterable fact per building, which is squarely the DEP-documents-are-
   organized-by-building strength this corpus already has.

**Phase 3 — period-correct building history (fresh fetch, small-medium):**
6. Fetch `bty7-2jhb` (Historical DOB Permit Issuance) and `3h2n-5cm9` (legacy
   DOB Violations) scoped to Manhattan, 2001-2003 — both verified live above
   with real 2001-2002 Manhattan row counts (85,198 and 47,939 respectively)
   — to show "what permit/violation activity happened at this building right
   around 9/11" on a building page. Small enough to fetch in full rather than
   delta-sync.
7. One-time pull of the **2002 DCP PLUTO archive** (static ZIP, not Socrata)
   to resolve any WTC-area BBL that has since merged/subdivided, and to give
   a period-correct "what this lot was" fact distinct from today's.

**Phase 4 — ownership context for lawyers (reuse Prospect's pattern, medium):**
8. A scoped ACRIS pull (lower Manhattan only, `since=1990` is more than
   enough) using Prospect's own `import_acris.sh` approach — legals-scoped,
   never trusting `recorded_borough` — to establish **entity** ownership
   chains for named buildings. Entity-name filtering (§6) is a hard
   requirement before this ships, not a follow-up.

**Deliberately deferred / not worth building now:**
- 311 and the current-era DOB/ECB/DEP tables: verified to add nothing for
  2001-2003 (§4.4, §4.2, §4.3) — don't build these joins now, and say so in
  the product rather than silently omitting them.
- EPA/federal environmental data beyond what `docs/CONTEXT.md` already
  scoped: real content, but unstructured (prose/PDF), and a separate
  extraction effort in its own right, not a "join a table" task.
- A hand-built WTC/VCF boundary GeoJSON: worth doing once real estate is
  needed for a map overlay, but it's manual digitization from an official
  description/map image, not a data-pull — sequence it whenever the map
  actually needs it, not before.

---

## Sources consulted

Socrata catalog and dataset endpoints queried directly (`api.us.socrata.com`,
`data.cityofnewyork.us/api/views/*.json`, `data.cityofnewyork.us/resource/*.json`)
for every ID cited above as "verified (Socrata)." Web sources for
non-Socrata/federal facts:

- https://api.nyc.gov/geoclient/v1/doc/ · https://api-portal.nyc.gov/
- https://www.cdc.gov/wtc/define.html
- https://www.911victimlawyer.com/blog/what-is-the-911-nyc-exposure-zone/ (cross-checked against `wtc911lawyer.com` and `post911attorneys.com` explainer pages — independent convergence on the same Houston/Canal/Clinton boundary distinction)
- https://en.wikipedia.org/wiki/Deutsche_Bank_Building
- https://www.esd.ny.gov/wtc-site-5
- https://www.nyc.gov/assets/planning/download/pdf/data-maps/open-data/pluto-readme.pdf (and corroborating `github.com/NYCPlanning/db-pluto`) for the "PLUTO archives since 2002" claim
- https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingHistoric.md
- `~/Code/prospect`: `CLAUDE.md`, `docs/DATA-SOURCES.md`, `lib/address/normalize.ts`, `lib/acrisAddress.ts`, `scripts/build_unit_bridge.sh`, `scripts/import_footprints.sh`, `scripts/import_acris.sh`, `scripts/import_dob_violations.sh`, `scripts/import_dob_jobs.sh`, `scripts/import_311.sh`, `scripts/import_hpd_violations.sh`, `scripts/build_parcel_nta.sh`, `scripts/dump_seed.sh` (read-only; no database queried, no pipeline run)
- `~/Code/sept11-docs`: `docs/CONTEXT.md`, `scripts/embed/entities.py` (read-only)
