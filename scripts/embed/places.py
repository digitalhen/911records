#!/usr/bin/env python3
"""places.py — buildings in the records and the tests found on their pages (feeds the map).

Local only. Reads data/embed/entities.sqlite (mentions from entities.py) and data/manifest.jsonl;
writes data/embed/places.sqlite and, when a geometry lookup exists, data/embed/buildings.geojson.

A *place* is resolved per page, strongest key first: BIN (7 digits) > block/lot (Manhattan
assumed unless the page names another borough) > normalised street address. A *test record* is a
page that carries a place AND at least one contaminant AND at least one measurement (optionally a
date and a lab); it is a candidate, not a verified reading — confidence reflects how many of those
signals co-occur on the page and how close they sit to each other.

An address-kind page is SKIPPED entirely (no place, no entry in `places`/`place_pages`) when
entities.py's classify_addresses() tagged its representative address mention
`canonical_address_role='organisation'` or `canonical_borough` other than 'Manhattan' (issue #19
follow-up, Henry 2026-09-14: "59-17 Junction Blvd -> this is in Queens; it's a testing center" — a
lab's own outside-Manhattan mailing address was showing up as a sampling-site building on the map
and in Ask's buildings_by_substance). The address stays reachable as an ordinary entity
(`/entity/address/<slug>`); it just never becomes a `places` row. Optional: an entities.sqlite from
before that pass (no canonical_borough/canonical_address_role columns) excludes nothing, unchanged
from before.

  places(place_id, kind, key, label, n_docs, n_pages, n_test_pages, first_date, last_date, lat, lon)
  place_pages(place_id, doc, page, has_test, contaminants, units, dates, labs, confidence)

Geometry: optional file data/geo/bin_lookup.csv with columns bin,bbl,lat,lon[,address] (from
building footprints / PAD / PLUTO — see docs/research/city-data-linkage.md). Places without a
lookup keep NULL coordinates and are simply not drawn.

Privacy: addresses are buildings, not households; no person names are read or written here. The
GeoJSON carries counts, substances, units and date ranges per building — never page text.

Usage: .venv/bin/python scripts/embed/places.py
"""
from __future__ import annotations

import collections
import csv
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EMB = REPO / "data" / "embed"
GEO = REPO / "data" / "geo" / "bin_lookup.csv"
NEAR_CHARS = 400  # contaminant and measurement within this many characters count as "together"

SUFFIX = {"ST": "STREET", "ST.": "STREET", "AVE": "AVENUE", "AVE.": "AVENUE", "PL": "PLACE", "PL.": "PLACE",
          "BLVD": "BOULEVARD", "BLVD.": "BOULEVARD", "RD": "ROAD"}


def norm_address(a: str) -> str:
    toks = re.sub(r"[^\w\s\-]", " ", a.upper()).split()
    if toks and toks[-1] in SUFFIX:
        toks[-1] = SUFFIX[toks[-1]]
    return " ".join(toks)


def main() -> int:
    t0 = time.time()
    meta = {r["bates_start"]: r for r in map(json.loads, (REPO / "data" / "manifest.jsonl").open())}
    ent = sqlite3.connect(EMB / "entities.sqlite")
    # Issue #19 follow-up (Henry, 2026-09-14: "59-17 Junction Blvd -> this is in Queens; it's a
    # testing center") — entities.py's classify_addresses() (--canonicalise) tags every address
    # mention with canonical_borough/canonical_address_role; pull them for address rows only (both
    # columns are optional — an entities.sqlite from before that pass simply has neither) so this
    # loop can skip a lab/contractor's own outside-Manhattan mailing address rather than turning it
    # into a "place" (a building on the map / an Ask buildings_by_substance row).
    ent_cols = {r[1] for r in ent.execute("PRAGMA table_info(mentions)")}
    has_borough = "canonical_borough" in ent_cols
    borough_sel = "canonical_borough" if has_borough else "NULL"
    role_sel = "canonical_address_role" if has_borough else "NULL"
    n_excluded_org = n_excluded_borough = 0
    per_page: dict[tuple, dict] = collections.defaultdict(lambda: collections.defaultdict(list))
    for doc, page, start, label, norm, borough, role in ent.execute(
            f"SELECT doc, page, start, label, norm, {borough_sel}, {role_sel} FROM mentions "
            "WHERE source='regex' AND label IN "
            "('bin','block_lot','address','contaminant','measurement','date','lab')"):
        if label == "address":
            per_page[(doc, page)][label].append((start, norm, borough, role))
        else:
            per_page[(doc, page)][label].append((start, norm))

    geo = {}
    if GEO.exists():
        for r in csv.DictReader(GEO.open()):
            geo[("bin", r["bin"])] = (float(r["lat"]), float(r["lon"]))
            if r.get("bbl"):
                geo[("bbl", r["bbl"])] = (float(r["lat"]), float(r["lon"]))

    places: dict[tuple, dict] = {}
    rows = []
    for (doc, page), f in per_page.items():
        if f["bin"]:
            kind, key = "bin", f["bin"][0][1]
        elif f["block_lot"]:
            b, l = f["block_lot"][0][1].split("/")
            kind, key = "bbl", f"1{int(b):05d}{int(l):04d}"
        elif f["address"]:
            _, addr_norm, addr_borough, addr_role = f["address"][0]
            if addr_role == "organisation":
                n_excluded_org += 1
                continue
            if addr_borough is not None and addr_borough != "Manhattan":
                n_excluded_borough += 1
                continue
            kind, key = "address", norm_address(addr_norm)
        else:
            continue
        cont, meas = f["contaminant"], f["measurement"]
        near = any(abs(c[0] - m[0]) <= NEAR_CHARS for c in cont for m in meas)
        has_test = bool(cont and meas)
        confidence = round(min(1.0, 0.4 * has_test + 0.3 * near + 0.15 * bool(f["date"]) + 0.15 * bool(f["lab"])), 2)
        dates = sorted({d for _, d in f["date"]})
        p = places.setdefault((kind, key), {"docs": set(), "pages": 0, "tests": 0, "dates": [],
                                            "label": f["address"][0][1] if f["address"] else key})
        p["docs"].add(doc)
        p["pages"] += 1
        p["tests"] += int(has_test)
        p["dates"] += dates
        rows.append((f"{kind}:{key}", doc, page, int(has_test), json.dumps(sorted({c for _, c in cont})),
                     json.dumps(sorted({u for _, u in meas})), json.dumps(dates),
                     json.dumps(sorted({l for _, l in f["lab"]})), confidence))

    tmp = EMB / "places.sqlite.tmp"
    if tmp.exists():
        tmp.unlink()
    out = sqlite3.connect(tmp)
    out.executescript("""
    CREATE TABLE places(place_id TEXT PRIMARY KEY, kind TEXT, key TEXT, label TEXT, n_docs INT, n_pages INT,
                        n_test_pages INT, first_date TEXT, last_date TEXT, lat REAL, lon REAL);
    CREATE TABLE place_pages(place_id TEXT, doc TEXT, page INT, has_test INT, contaminants TEXT, units TEXT,
                             dates TEXT, labs TEXT, confidence REAL);
    """)
    feats = []
    for (kind, key), p in places.items():
        ll = geo.get((kind, key))
        d = sorted(p["dates"])
        out.execute("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (f"{kind}:{key}", kind, key, p["label"], len(p["docs"]), p["pages"], p["tests"],
                     d[0] if d else None, d[-1] if d else None, ll[0] if ll else None, ll[1] if ll else None))
        if ll:
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [ll[1], ll[0]]},
                          "properties": {"place_id": f"{kind}:{key}", "label": p["label"], "docs": len(p["docs"]),
                                         "pages": p["pages"], "test_pages": p["tests"],
                                         "first_date": d[0] if d else None, "last_date": d[-1] if d else None}})
    out.executemany("INSERT INTO place_pages VALUES (?,?,?,?,?,?,?,?,?)", rows)
    out.commit()
    out.close()
    os.replace(tmp, EMB / "places.sqlite")
    if feats:
        (EMB / "buildings.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))

    kinds = collections.Counter(k for k, _ in places)
    print(json.dumps({
        "pages_with_place": len(rows), "places": len(places), "places_by_key": dict(kinds),
        "test_pages": sum(r[3] for r in rows), "places_with_tests": sum(1 for p in places.values() if p["tests"]),
        "geocoded_places": len(feats), "geometry_lookup": GEO.exists(),
        "pages_excluded_organisation_address": n_excluded_org,
        "pages_excluded_non_manhattan_address": n_excluded_borough,
        "borough_classification_available": has_borough, "seconds": round(time.time() - t0, 1),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
