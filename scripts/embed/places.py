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

**Folder-level attribution** (issue #19 follow-up, Henry 2026-09-14: "documents should
automatically get pulled into that building's records — on the map it shouldn't be 1 document, it
should be all the documents under that cover page"). The City files documents by physical box and
folder, and a folder's OWN label routinely carries the building's BIN/Block-Lot/address even when
most of the folder's individual pages don't repeat it (real example: DEP Box 46's folder "345 SOUTH
END AVENUE Block: 16 Lot: 100 BIN: 1083378 365 South End Avenue, Building #300" — 7 documents, 79
pages, most with no BIN/address mention of their own). After the per-page pass above, every
(box, folder) group whose folder resolves to a BIN, BBL or roll-matched address (see
`resolve_folder_place()`) gets a place_pages row, `source='folder'`, `confidence=0.95`, for every
page of every one of its documents that did NOT already get a page-level (`source='page'`) row —
the stronger per-page resolution is never overwritten. `places.n_docs`/`n_pages`/`n_test_pages`
include these. **A folder label that reads as a bare person's name is never resolved to a place**
(`looks_like_person_name()`) — a DEP claims box files its folders by claimant name, and those must
never become "buildings"; the folder resolvers also all require a leading house number and (for
the address fallback) a recognised street-type word, which structurally excludes a name-shaped
label on its own, so this is belt-and-suspenders, not the only guard.

  places(place_id, kind, key, label, n_docs, n_pages, n_test_pages, first_date, last_date, lat, lon)
  place_pages(place_id, doc, page, has_test, contaminants, units, dates, labs, confidence, source)
                                                                        source IN ('page','folder')

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
GAZETTEER_CSV = EMB / "gazetteer-prospect.csv"
DOCTYPES_JSONL = EMB / "p3-doctypes.jsonl"
NEAR_CHARS = 400  # contaminant and measurement within this many characters count as "together"

sys.path.insert(0, str(Path(__file__).resolve().parent))
import canonical  # normalize_street/split_house_street/gazetteer helpers — issue #19 folder attribution

SUFFIX = {"ST": "STREET", "ST.": "STREET", "AVE": "AVENUE", "AVE.": "AVENUE", "PL": "PLACE", "PL.": "PLACE",
          "BLVD": "BOULEVARD", "BLVD.": "BOULEVARD", "RD": "ROAD"}


def norm_address(a: str) -> str:
    toks = re.sub(r"[^\w\s\-]", " ", a.upper()).split()
    if toks and toks[-1] in SUFFIX:
        toks[-1] = SUFFIX[toks[-1]]
    return " ".join(toks)


# --------------------------------------------------------- folder-level attribution (issue #19) ---
# Folder-label formats actually seen in data/manifest.jsonl's folder_name (checked against DEP Box
# 46 and neighbours): "<addr> Block: N Lot: M BIN: NNNNNNN [more AKAs]" (labeled), "<addr> NNNNNNN,
# B/L" (terse — a bare BIN then block/lot, no keywords), "<addr> BIN: N" / "BIN# N" (BIN only, no
# Block/Lot), or a bare address with none of the above ("90 South Street"). BIN wins over Block/Lot
# when both are present, matching the per-page priority above.
RE_FOLDER_BIN = re.compile(r"\bBIN\s*[:#\-]?\s*(\d{6,7})\b", re.I)
RE_FOLDER_TERSE_BIN = re.compile(r"\b(\d{7}),\s*\d+\s*/\s*\d+\b")
RE_FOLDER_BLOCKLOT = re.compile(r"\bBlock\s*:?\s*(\d+)\W{1,4}Lot\s*:?\s*(\d+)\b", re.I)

# Cover-sheet PAGE text is OCR'd (noisier than a hand-typed folder label), so its regexes mirror
# doctypes.py's OCR-tolerant character classes (RE_BLOCK_LOT/RE_BIN there) but WITH capture groups,
# which doctypes.py's presence-only versions don't have.
RE_PAGE_BIN = re.compile(r"\bBIN\s*[:\-]?\s*(\d{6,7})", re.I)
RE_PAGE_BLOCKLOT = re.compile(r"\bB[l1Ii]ock\W{0,4}(\d+)\W{1,4}L[oO0][tTlLiI1]\W{0,4}(\d+)", re.I)

# A folder label's leading address, for the roll-gazetteer fallback: house number, then a street
# name ending before two+ spaces / "Block" / "BIN" / end of string (the label often runs straight
# into Block/Lot/BIN/AKA text with no punctuation). Requires a digit-led house number — the same
# requirement that keeps a bare person's name out of every path here.
RE_FOLDER_LEADING_ADDR = re.compile(
    r"^\s*(\d{1,4}(?:-\d{1,4})?)\s+([A-Za-z][A-Za-z0-9 .'\-]*?)(?=\s{2,}|\s+Block\b|\s+BIN\b|$)", re.I)

# "First Last" / "First M. Last" / "Last, First" with no digits anywhere — a DEP claims box files
# folders by claimant name (docs/PLAN.md open item #30). Deliberately narrow (2-3 Title Case words,
# no address vocabulary) since the digit/street-type requirements above already exclude it from
# ever resolving; this is a second, explicit gate specifically because Henry named it as a MUST.
RE_NAME_LIKE = re.compile(
    r"^[A-Z][a-z'\-]+,?\s+(?:[A-Z]\.?\s+)?[A-Z][a-z'\-]+(?:\s+(?:Jr|Sr|II|III|IV)\.?)?$")


def looks_like_person_name(label: str) -> bool:
    s = (label or "").strip()
    return bool(s) and not any(ch.isdigit() for ch in s) and bool(RE_NAME_LIKE.match(s))


def parse_folder_label(label: str) -> tuple[str, str] | None:
    """(kind, key) straight from a folder_name string, or None if it carries neither a BIN nor a
    Block/Lot. Never falls back to a bare address here — that needs the gazetteer, done separately
    in `resolve_folder_place()` so this function stays a pure string parse."""
    if not label:
        return None
    m = RE_FOLDER_BIN.search(label)
    if m:
        return ("bin", m.group(1))
    m = RE_FOLDER_TERSE_BIN.search(label)
    if m:
        return ("bin", m.group(1))
    m = RE_FOLDER_BLOCKLOT.search(label)
    if m:
        block, lot = int(m.group(1)), int(m.group(2))
        return ("bbl", f"1{block:05d}{lot:04d}")
    return None


def parse_cover_sheet_text(text: str) -> tuple[str, str] | None:
    """Same idea as `parse_folder_label()`, against a cover-sheet page's OCR'd text."""
    if not text:
        return None
    m = RE_PAGE_BIN.search(text)
    if m:
        return ("bin", m.group(1))
    m = RE_PAGE_BLOCKLOT.search(text)
    if m:
        block, lot = int(m.group(1)), int(m.group(2))
        return ("bbl", f"1{block:05d}{lot:04d}")
    return None


def resolve_address_fallback(label: str, gazetteer: dict, manhattan_streets: set) -> tuple[str, str] | None:
    """Last resort: the folder label's own leading address, matched against the Prospect roll
    (exact or fuzzy, reusing canonical.py's own matcher) — requires a real street-TYPE word
    (STREET/AVENUE/...), which a person's name never has."""
    m = RE_FOLDER_LEADING_ADDR.match(label or "")
    if not m:
        return None
    house = m.group(1).upper()
    street = canonical.normalize_street(m.group(2))
    stype = canonical.street_type_of(street)
    if stype is None:
        return None
    sname = canonical.street_name_of(street)
    best = None
    for ge in gazetteer.get(house, ()):
        if canonical.street_type_of(ge.street_norm) != stype:
            continue
        t = canonical._match_tier(sname, canonical.street_name_of(ge.street_norm))
        if t is not None and (best is None or t < best[0]):
            best = (t, ge.bbl)
    return ("bbl", best[1]) if best else None


def resolve_folder_place(folder_label: str, cover_sheet_text: str | None,
                          gazetteer: dict, manhattan_streets: set) -> tuple[str, str] | None:
    """(kind, key) for one (box, folder) group, or None if it can't be resolved (including: it
    looks like a bare person's name). Order: folder label (BIN/Block-Lot) -> cover-sheet page text
    (BIN/Block-Lot) -> folder label's own address against the roll gazetteer."""
    if looks_like_person_name(folder_label):
        return None
    return (parse_folder_label(folder_label) or parse_cover_sheet_text(cover_sheet_text)
            or resolve_address_fallback(folder_label, gazetteer, manhattan_streets))


def load_doctypes() -> dict:
    """doc -> (doc_type, confidence) from data/embed/p3-doctypes.jsonl (doctypes.py). Optional: an
    empty dict if the file doesn't exist yet — folder resolution just skips the cover-sheet tier."""
    out: dict = {}
    if not DOCTYPES_JSONL.exists():
        return out
    with DOCTYPES_JSONL.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            out[r["doc"]] = (r.get("doc_type"), r.get("confidence") or 0.0)
    return out


def read_page1_text(local_text: str | None) -> str | None:
    """Page 1 of a document's OCR text, from the <bates>.pages.jsonl sibling of manifest's
    `local_text`. Falls back to the first \\f-separated section of the plain .txt if the sibling is
    missing. Local only — never touches the PDF or the portal."""
    if not local_text:
        return None
    pages_path = REPO / (local_text[:-len(".txt")] + ".pages.jsonl") if local_text.endswith(".txt") else None
    if pages_path and pages_path.exists():
        with pages_path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                r = json.loads(line)
                if int(r.get("page", 0)) == 1:
                    return r.get("text") or ""
        return None
    txt_path = REPO / local_text
    if txt_path.exists():
        return txt_path.read_text(errors="replace").split("\f", 1)[0]
    return None


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
    page_has_place: set = set()  # (doc,page) already resolved at the page level — folder pass skips these
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
        page_has_place.add((doc, page))
        rows.append((f"{kind}:{key}", doc, page, int(has_test), json.dumps(sorted({c for _, c in cont})),
                     json.dumps(sorted({u for _, u in meas})), json.dumps(dates),
                     json.dumps(sorted({l for _, l in f["lab"]})), confidence, "page"))

    # ---- folder-level attribution (issue #19 follow-up) ----
    doctypes = load_doctypes()
    gazetteer = canonical.load_gazetteer(GAZETTEER_CSV) if GAZETTEER_CSV.exists() else {}
    manhattan_streets = canonical.gazetteer_street_names(gazetteer) if gazetteer else set()
    folders: dict[tuple, list] = collections.defaultdict(list)
    for r in meta.values():
        if r.get("status") == "present" and r.get("box_name") and r.get("folder_name"):
            folders[(r["box_name"], r["folder_name"])].append(r)

    n_folders_resolved = n_folders_seen = n_folders_skipped_name = 0
    n_folder_docs = n_folder_pages = 0
    for (box, folder), docs in folders.items():
        n_folders_seen += 1
        if looks_like_person_name(folder):
            n_folders_skipped_name += 1
            continue
        # Cover-sheet text only read lazily, and only if the label itself didn't resolve — reading
        # every folder's cover sheet unconditionally would mean opening thousands of files this
        # pipeline stage has never needed to touch before.
        resolved = parse_folder_label(folder)
        if resolved is None:
            best_cover = max(
                (d for d in docs if doctypes.get(d["bates_start"], (None, 0))[0] == "cover_sheet"),
                key=lambda d: doctypes[d["bates_start"]][1], default=None)
            if best_cover is not None:
                resolved = parse_cover_sheet_text(read_page1_text(best_cover.get("local_text")))
        if resolved is None:
            resolved = resolve_address_fallback(folder, gazetteer, manhattan_streets)
        if resolved is None:
            continue
        kind, key = resolved
        p = places.setdefault((kind, key), {"docs": set(), "pages": 0, "tests": 0, "dates": [], "label": folder})
        folder_docs_attributed: set = set()
        for d in docs:
            doc = d["bates_start"]
            for page in range(1, (d.get("page_count") or 0) + 1):
                if (doc, page) in page_has_place:
                    continue
                fpg = per_page.get((doc, page), {})
                cont, meas = fpg.get("contaminant", []), fpg.get("measurement", [])
                has_test = bool(cont and meas)  # same "co-occur on the page" rule as the page-level pass
                dates = sorted({dd for _, dd in fpg.get("date", [])})
                p["docs"].add(doc)
                p["pages"] += 1
                p["tests"] += int(has_test)
                p["dates"] += dates
                page_has_place.add((doc, page))
                folder_docs_attributed.add(doc)
                n_folder_pages += 1
                rows.append((f"{kind}:{key}", doc, page, int(has_test),
                             json.dumps(sorted({c for _, c in cont})), json.dumps(sorted({u for _, u in meas})),
                             json.dumps(dates), json.dumps(sorted({l for _, l in fpg.get("lab", [])})),
                             0.95, "folder"))
        if folder_docs_attributed:
            n_folders_resolved += 1
            n_folder_docs += len(folder_docs_attributed)

    tmp = EMB / "places.sqlite.tmp"
    if tmp.exists():
        tmp.unlink()
    out = sqlite3.connect(tmp)
    out.executescript("""
    CREATE TABLE places(place_id TEXT PRIMARY KEY, kind TEXT, key TEXT, label TEXT, n_docs INT, n_pages INT,
                        n_test_pages INT, first_date TEXT, last_date TEXT, lat REAL, lon REAL);
    CREATE TABLE place_pages(place_id TEXT, doc TEXT, page INT, has_test INT, contaminants TEXT, units TEXT,
                             dates TEXT, labs TEXT, confidence REAL, source TEXT);
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
    out.executemany("INSERT INTO place_pages VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
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
        "borough_classification_available": has_borough,
        "folders_seen": n_folders_seen, "folders_skipped_name_like": n_folders_skipped_name,
        "folders_with_attributions": n_folders_resolved, "folder_attributed_docs": n_folder_docs,
        "folder_attributed_pages": n_folder_pages, "doctypes_available": bool(doctypes),
        "gazetteer_available": bool(gazetteer), "seconds": round(time.time() - t0, 1),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
