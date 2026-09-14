#!/usr/bin/env python3
"""build_site_db.py — build data/site/site.sqlite, the one file the app reads for everything
except full-text/vector search (which lives in OpenSearch).

Local only; touches no network. Stdlib only (python3, sqlite3, json, re, hashlib).

Schema (docs/PLAN.md, "site.sqlite" section — this file must match it exactly):

  documents(doc PK, bates_end, agency, source, volume, box, folder, page_count, pdf_size, status,
            first_seen, removed_at, reappeared_at, changed_at, changed_fields, held_locally,
            pages_ok, pages_empty, pages_ocr, topic, n_related_cross, official_url)
  pages(doc, page, bates, chars, ocr_status, ocr_source, image_ready, PRIMARY KEY(doc,page))
  snapshots(date PK, documents, pages, bytes, added, removed, changed, sha256)
  changes(date, doc, kind, fields)                       kind IN added|removed|changed|reappeared
  entities(id PK, type, slug, label, n_docs, n_pages, first_date, last_date, variants, bbl, bin)
  entity_pages(entity_id, doc, page, role, confidence, raw)
  signatories(id PK, slug, name, title, org, n_docs, first_date, last_date)
  signatory_pages(id, doc, page, action, confidence)
  related(doc, rank, other, score, cross)     near_dupes(doc, other, score)
  topics(id PK, parent, label, size_docs, size_pages, terms, boxes, agencies, title, description,
         name_confidence)   doc_topics(doc, topic, prob)
  places(id PK, kind, key, label, n_docs, n_pages, n_test_pages, first_date, last_date, lat, lon)
  place_pages(place_id, doc, page, has_test, contaminants, units, dates, labs, confidence)
  building_facts(bbl PK, bin, address, zip, year_built, num_floors, units_res, units_total,
                  bldg_area, bldg_class, num_bldgs, source)   present-day PLUTO-derived facts ONLY,
                  never owner/sales/people. `address` is Title Case "<housenum> <street>" straight
                  off the roll (never a machine-extracted/OCR address) — the building page's title
                  falls back to it ahead of anything OCR-derived.
  meta(key PK, value)                                     built_at, snapshot_date, counts

Sources:
  data/manifest.jsonl (+ .summary.json)         one row per document, current state — see enumerate.mjs.
                                                 `doc` IS the Bates start (already stable/ASCII/unique;
                                                 no separate slug needed for documents).
  data/catalog/*.summary.json                   one row per catalog snapshot -> `snapshots`.
  data/catalog/diff-*.json                      day-over-day deltas (diff_catalog.mjs) -> `changes`
                                                 (added/removed/changed). `reappeared` instead comes
                                                 from manifest.jsonl's own reappeared_at (enumerate.mjs
                                                 already distinguishes a reappearance from a plain add).
  data/embed/pages.sqlite    pages(doc,page,bates,chars,status)      status: ok|empty|junk|ocr
  data/embed/entities.sqlite mentions(...), roles(...)               roles.official=1 only ever surfaces
  data/embed/related.sqlite  related, near_dupes, topics, doc_topics (--related to point elsewhere,
                             e.g. data/embed/p2-related.sqlite; topics.title/description/
                             name_confidence are read only if the source file has those columns —
                             related.sqlite's older schema without them loads as NULL)
  data/embed/places.sqlite   places, place_pages
  data/embed/gazetteer-prospect.csv  one-time Prospect property-roll export (GAZETTEER_CSV,
                             export_prospect_gazetteer.py, operator-run) -> entities.bbl/bin for
                             roll-matched addresses (via mentions.canonical_bbl/bin) and the whole
                             of `building_facts`. Optional: build runs fine without it.
  data/pages/**/pages.json   {pages:n, w:[...], h:[...], dpi, rendered_at} -> image_ready per page
                             (written by A1's render_pages.mjs; may not exist yet — treated as optional)

Entities are five types, drawn from entities.sqlite `mentions` where source='regex':
  substance (mentions.label='contaminant'), agency, lab, contractor, address.
Dates/measurements/bin/block_lot are not entities (bin/block_lot/address feed `places` too, via
places.py). A person is NEVER an entity; the only people ever surfaced are `signatories`, built
from `roles` WHERE official=1 (a title or org attached, or the role is a certifying action) — see
entities.py's docstring. No other mention of a person is written anywhere in this database.

Address/lab/contractor mentions carry OCR-canonicalisation (entities.py --canonicalise, issue #19,
scripts/embed/canonical.py): entities of these three types group by `mentions.canonical_key` when
it is set (falls back to `type:norm` for agency/substance, and for any address/lab/contractor row
that hasn't been canonicalised yet), so "295 Lafayette Street" and its five OCR misreads become one
entity instead of six. `entities.label`/`entities.variants` and `entity_pages.raw` are how a raw
OCR spelling stays visible: `label` is the canonical Title Case form, `variants` is a JSON object
of {raw spelling: mention count} (every raw spelling ever seen for that entity, most-frequent
first, capped at 20), and `entity_pages.raw` is the exact raw text found on that one page.

Usage: .venv/bin/python scripts/embed/build_site_db.py [--out PATH] [--related PATH]
Build-then-swap: writes data/site/site.sqlite.tmp, indexes, VACUUMs, then os.replace()s over
data/site/site.sqlite. Prints a one-line JSON summary of row counts and timing.
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"
EMB = DATA / "embed"
SITE_DIR = DATA / "site"
OUT_PATH = SITE_DIR / "site.sqlite"
# One-time export of Prospect's property roll (export_prospect_gazetteer.py, operator-run; this
# script never connects to the Prospect database — see that script's docstring). TODO(coordinator,
# on merge to main): rename off the p1- prefix if this stays the permanent path — same note as
# entities.py's GAZETTEER_CSV, which must point at the same file.
GAZETTEER_CSV = EMB / "gazetteer-prospect.csv"

RE_BATES_NUM = re.compile(r"(\d+)$")
RE_LEADING_DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def bates_num(b: str | None) -> int | None:
    if not b:
        return None
    m = RE_BATES_NUM.search(b)
    return int(m.group(1)) if m else None


def slugify(s: str, maxlen: int = 80) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", s.strip()).strip("-").lower()
    s = re.sub(r"-{2,}", "-", s)
    return (s or "x")[:maxlen]


def unique_slug(base: str, taken: set[str]) -> str:
    slug = base
    i = 2
    while slug in taken:
        slug = f"{base}-{i}"
        i += 1
    taken.add(slug)
    return slug


# ---------------------------------------------------------------- manifest --

def load_manifest() -> list[dict]:
    path = DATA / "manifest.jsonl"
    rows = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


# ---------------------------------------------------------------- catalog ---

def load_snapshots() -> list[dict]:
    """One row per calendar date from data/catalog/<date>[...].summary.json (accepted only).
    A second, differing same-day snapshot overwrites the first — `snapshots.date` is the PK."""
    out: dict[str, dict] = {}
    cat_dir = DATA / "catalog"
    if not cat_dir.exists():
        return []
    for p in sorted(cat_dir.glob("*.summary.json")):
        try:
            s = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if not s.get("accepted"):
            continue
        date = s.get("date") or (RE_LEADING_DATE.match(p.name).group(1) if RE_LEADING_DATE.match(p.name) else None)
        if not date:
            continue
        stats = s.get("stats") or {}
        diff = s.get("diff_vs_previous") or {}
        out[date] = {
            "date": date,
            "documents": stats.get("documents"),
            "pages": stats.get("pages"),
            "bytes": stats.get("pdf_bytes"),
            "added": diff.get("added", 0),
            "removed": diff.get("removed", 0),
            "changed": diff.get("changed", 0),
            "sha256": s.get("sha256"),
        }
    return sorted(out.values(), key=lambda r: r["date"])


def load_changes(manifest_by_doc: dict[str, dict]) -> list[tuple]:
    """(date, doc, kind, fields_json) from data/catalog/diff-*.json (added/removed/changed) plus
    manifest.jsonl's reappeared_at (an 'added' bates that the manifest recognises as a comeback)."""
    rows: list[tuple] = []
    cat_dir = DATA / "catalog"
    for p in sorted(cat_dir.glob("diff-*.json")) if cat_dir.exists() else []:
        try:
            d = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        new_path = (d.get("new") or {}).get("path") or ""
        m = RE_LEADING_DATE.match(Path(new_path).name)
        date = m.group(1) if m else (d.get("generated_at") or "")[:10]
        if not date:
            continue
        for r in d.get("added", []):
            doc = r.get("bates")
            man = manifest_by_doc.get(doc)
            kind = "reappeared" if man and man.get("reappeared_at") == date else "added"
            rows.append((date, doc, kind, None))
        for r in d.get("removed", []):
            rows.append((date, r.get("bates"), "removed", None))
        for r in d.get("changed", []):
            rows.append((date, r.get("bates"), "changed", json.dumps(r.get("fields"))))
    # De-duplicate identical (date, doc, kind) rows a re-run might reproduce.
    return sorted(set(rows))


# ------------------------------------------------------------- pages.sqlite -

def load_page_status() -> dict[tuple, dict]:
    """(doc, page) -> {bates, chars, status} from data/embed/pages.sqlite, if it exists yet."""
    path = EMB / "pages.sqlite"
    out: dict[tuple, dict] = {}
    if not path.exists():
        return out
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    for doc, page, bates, chars, status in con.execute("SELECT doc, page, bates, chars, status FROM pages"):
        out[(doc, page)] = {"bates": bates, "chars": chars, "status": status}
    con.close()
    return out


def page_status_counts(page_status: dict[tuple, dict]) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = collections.defaultdict(lambda: collections.defaultdict(int))
    for (doc, _page), v in page_status.items():
        counts[doc][v["status"] or "unknown"] += 1
    return counts


def pages_by_doc(page_status: dict[tuple, dict]) -> dict[str, set]:
    out: dict[str, set] = collections.defaultdict(set)
    for doc, page in page_status:
        out[doc].add(page)
    return out


# ------------------------------------------------------------ page images ---

def local_pdf_to_pages_dir(local_pdf: str) -> Path | None:
    """data/pdf/<agency>/<volume>/<bates>.pdf -> data/pages/<agency>/<volume>/<bates>/ (A1's layout)."""
    if not local_pdf or not local_pdf.startswith("data/pdf/") or not local_pdf.endswith(".pdf"):
        return None
    rel = local_pdf[len("data/pdf/"):-len(".pdf")]
    return REPO / "data" / "pages" / rel


def load_image_ready(manifest: list[dict]) -> dict[str, int]:
    """doc -> rendered page count, from data/pages/<...>/<bates>/pages.json (A1's render_pages.mjs).
    Optional: the directory may not exist at all yet."""
    out: dict[str, int] = {}
    for r in manifest:
        d = local_pdf_to_pages_dir(r.get("local_pdf") or "")
        if d is None:
            continue
        pj = d / "pages.json"
        if not pj.exists():
            continue
        try:
            info = json.loads(pj.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        n = info.get("pages")
        if isinstance(n, int) and n > 0:
            out[r["bates_start"]] = n
    return out


# ---------------------------------------------------------- entities.sqlite -

ENTITY_TYPE = {"contaminant": "substance", "agency": "agency", "lab": "lab", "contractor": "contractor",
               "address": "address"}


def load_doc_date_range(entities_con: sqlite3.Connection | None) -> dict[str, tuple[str, str]]:
    """doc -> (min_date, max_date) from mentions(label='date'), used for entities'/signatories'
    first_date/last_date (there is no direct date on a mention/role otherwise)."""
    out: dict[str, tuple[str, str]] = {}
    if entities_con is None:
        return out
    acc: dict[str, list[str]] = collections.defaultdict(list)
    for doc, norm in entities_con.execute("SELECT doc, norm FROM mentions WHERE label='date'"):
        acc[doc].append(norm)
    for doc, dates in acc.items():
        out[doc] = (min(dates), max(dates))
    return out


MAX_VARIANTS = 20


def build_entities(entities_con: sqlite3.Connection | None, doc_dates: dict[str, tuple[str, str]]):
    """entities + entity_pages rows from mentions (source='regex', label in ENTITY_TYPE).

    Groups by `mentions.canonical_key` when set (address/lab/contractor after entities.py
    --canonicalise; issue #19) so OCR misreads of one address/org collapse to one entity, falling
    back to `type:norm` for agency/substance (never canonicalised — their gazetteer match already
    fixes the spelling) and for any address/lab/contractor row not yet canonicalised. The entity's
    `label` is the canonical_label when every row in the group agrees on one (picks the
    highest-confidence, most-frequent one otherwise); `variants` is every raw spelling seen with
    its count, most-frequent first, capped at MAX_VARIANTS. `entity_pages.raw` carries the exact
    raw spelling found on that page. `entities.bbl`/`bin` come from `canonical_bbl`/`canonical_bin`
    (set only for address mentions the Prospect property-roll gazetteer matched — entities.py
    --canonicalise, issue #19 follow-up) so `places.py`/the building page can resolve a building
    straight from an address entity, no separate address-matching pass needed there."""
    entities: list[tuple] = []
    entity_pages: list[tuple] = []
    if entities_con is None:
        return entities, entity_pages
    display: dict[tuple, collections.Counter] = collections.defaultdict(collections.Counter)
    canon_label: dict[tuple, collections.Counter] = collections.defaultdict(collections.Counter)
    pages_seen: dict[tuple, set] = collections.defaultdict(set)
    docs_seen: dict[tuple, set] = collections.defaultdict(set)
    rows_by_key: dict[tuple, list] = collections.defaultdict(list)
    bbl_by_key: dict[tuple, str] = {}
    bin_by_key: dict[tuple, str] = {}
    q = ("SELECT doc, page, label, text, norm, canonical_key, canonical_label, canonical_bbl, canonical_bin "
         "FROM mentions WHERE source='regex' AND label IN ({})").format(",".join("?" * len(ENTITY_TYPE)))
    for doc, page, label, text, norm, ckey, clabel, cbbl, cbin in entities_con.execute(q, list(ENTITY_TYPE)):
        etype = ENTITY_TYPE[label]
        key = (etype, ckey or norm)
        display[key][text] += 1
        if clabel:
            canon_label[key][clabel] += 1
        if cbbl and key not in bbl_by_key:
            bbl_by_key[key] = cbbl
        if cbin and key not in bin_by_key:
            bin_by_key[key] = cbin
        docs_seen[key].add(doc)
        pages_seen[key].add((doc, page))
        rows_by_key[key].append((doc, page, text))

    taken_slugs: dict[str, set] = collections.defaultdict(set)
    for (etype, ckey), pages in pages_seen.items():
        docs = docs_seen[(etype, ckey)]
        variants = display[(etype, ckey)]
        label = (canon_label[(etype, ckey)].most_common(1)[0][0] if canon_label[(etype, ckey)]
                  else variants.most_common(1)[0][0])
        base_slug = slugify(label)
        slug = unique_slug(base_slug, taken_slugs[etype])
        eid = f"{etype}:{slug}"
        dr = [doc_dates[d] for d in docs if d in doc_dates]
        first_date = min((d[0] for d in dr), default=None)
        last_date = max((d[1] for d in dr), default=None)
        variants_json = json.dumps(dict(variants.most_common(MAX_VARIANTS)))
        entities.append((eid, etype, slug, label, len(docs), len(pages), first_date, last_date, variants_json,
                          bbl_by_key.get((etype, ckey)), bin_by_key.get((etype, ckey))))
        # `role` has no extra information beyond the entity's own `type` for a regex mention (there
        # is no sense of e.g. "subject of the test" vs "mentioned in passing" yet) — it is set to
        # `etype` so the column is never NULL and stays meaningful if a future extractor adds a
        # real distinction. `confidence` is 1.0 for every regex mention (entities.py doesn't score
        # them); only `gliner` mentions carry a real score, and gliner output isn't used here.
        seen_page: set = set()
        for doc, page, text in rows_by_key[(etype, ckey)]:
            if (doc, page) in seen_page:
                continue  # entity_pages is one row per (entity, doc, page); keep the first raw text
            seen_page.add((doc, page))
            entity_pages.append((eid, doc, page, etype, 1.0, text))
    return entities, entity_pages


def build_signatories(entities_con: sqlite3.Connection | None, doc_dates: dict[str, tuple[str, str]]):
    """signatories + signatory_pages from roles WHERE official=1 — people in an official/professional
    capacity ONLY (entities.py already decides `official`; this never re-derives it)."""
    signatories: list[tuple] = []
    signatory_pages: list[tuple] = []
    if entities_con is None:
        return signatories, signatory_pages
    docs_seen: dict[str, set] = collections.defaultdict(set)
    pages_seen: dict[str, set] = collections.defaultdict(set)
    titles: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    orgs: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    names: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    rows_by_name: dict[str, list] = collections.defaultdict(list)
    for doc, page, role, name, name_norm, title, org in entities_con.execute(
            "SELECT doc, page, role, name, name_norm, title, org FROM roles WHERE official=1"):
        docs_seen[name_norm].add(doc)
        pages_seen[name_norm].add((doc, page))
        names[name_norm][name] += 1
        if title:
            titles[name_norm][title] += 1
        if org:
            orgs[name_norm][org] += 1
        rows_by_name[name_norm].append((doc, page, role))

    taken_slugs: set = set()
    for name_norm, docs in docs_seen.items():
        name = names[name_norm].most_common(1)[0][0]
        title = titles[name_norm].most_common(1)[0][0] if titles[name_norm] else None
        org = orgs[name_norm].most_common(1)[0][0] if orgs[name_norm] else None
        slug = unique_slug(slugify(name), taken_slugs)
        sid = slug
        dr = [doc_dates[d] for d in docs if d in doc_dates]
        first_date = min((d[0] for d in dr), default=None)
        last_date = max((d[1] for d in dr), default=None)
        signatories.append((sid, slug, name, title, org, len(docs), first_date, last_date))
        for doc, page, role in rows_by_name[name_norm]:
            signatory_pages.append((sid, doc, page, role, 1.0))
    return signatories, signatory_pages


# ---------------------------------------------------------- related.sqlite --

def load_related(related_path: Path):
    """Reads related/near_dupes/topics/doc_topics from `related_path` (default
    data/embed/related.sqlite; pass --related data/embed/p2-related.sqlite to read topics.py's
    output instead — see topics.py). topics.title/description/name_confidence are optional
    columns: read if present, else every topic gets title=description=None, name_confidence=None,
    which is exactly what related.py's older topics table (no naming step) produces."""
    related, near_dupes, topics, doc_topics = [], [], [], []
    topic_of_doc: dict[str, int] = {}
    cross_of_doc: dict[str, int] = collections.defaultdict(int)
    if not related_path.exists():
        return related, near_dupes, topics, doc_topics, topic_of_doc, cross_of_doc
    con = sqlite3.connect(f"file:{related_path}?mode=ro", uri=True)
    for doc, rank, other, score, cross in con.execute("SELECT doc, rank, other, score, cross FROM related"):
        related.append((doc, rank, other, score, cross))
        if cross:
            cross_of_doc[doc] += 1
    for doc, other, score in con.execute("SELECT doc, other, score FROM near_dupes"):
        near_dupes.append((doc, other, score))
    topic_cols = {r[1] for r in con.execute("PRAGMA table_info(topics)")}
    has_names = {"title", "description", "name_confidence"} <= topic_cols
    name_select = ", title, description, name_confidence" if has_names else ""
    for row in con.execute(f"SELECT topic, parent, size_docs, size_pages, terms, boxes, agencies{name_select} FROM topics"):
        topic, parent, size_docs, size_pages, terms, boxes, agencies = row[:7]
        title, description, name_confidence = row[7:10] if has_names else (None, None, None)
        try:
            term_list = json.loads(terms) if terms else []
        except json.JSONDecodeError:
            term_list = []
        label = " · ".join(term_list[:3]) if term_list else f"topic {topic}"
        topics.append((topic, parent, label, size_docs, size_pages, terms, boxes, agencies,
                       title, description, name_confidence))
    for doc, topic, prob in con.execute("SELECT doc, topic, prob FROM doc_topics"):
        doc_topics.append((doc, topic, prob))
        if topic is not None and topic >= 0:
            topic_of_doc[doc] = topic
    con.close()
    return related, near_dupes, topics, doc_topics, topic_of_doc, cross_of_doc


# ----------------------------------------------------------- places.sqlite --

def load_places():
    path = EMB / "places.sqlite"
    places, place_pages = [], []
    if not path.exists():
        return places, place_pages
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    places = con.execute(
        "SELECT place_id, kind, key, label, n_docs, n_pages, n_test_pages, first_date, last_date, lat, lon "
        "FROM places").fetchall()
    place_pages = con.execute(
        "SELECT place_id, doc, page, has_test, contaminants, units, dates, labs, confidence "
        "FROM place_pages").fetchall()
    con.close()
    return places, place_pages


# ----------------------------------------------------------- building_facts -

def _int_or_none(v: str | None) -> int | None:
    return int(float(v)) if v not in (None, "") else None


def _float_or_none(v: str | None) -> float | None:
    return float(v) if v not in (None, "") else None


def _roll_address(housenum: str | None, street: str | None) -> str | None:
    """Title Case "<housenum> <street>" straight off the roll, e.g. "77 Pearl Street". Never an
    OCR/machine-extracted address — those stay in `places.label`, not here."""
    parts = [p for p in (housenum, street) if p]
    return " ".join(parts).title() if parts else None


def load_building_facts() -> list[tuple]:
    """building_facts rows straight from GAZETTEER_CSV (export_prospect_gazetteer.py's one-time
    dump of Prospect's property roll + pluto_lots). PRESENT-DAY BUILDING FACTS ONLY — year built,
    floor count, residential/total unit counts, floor area, building class, building count on the
    lot — never owner names, unit-level rows, sales or anything about a person (Henry, 2026-09-14;
    the export script's own query never selects those fields in the first place, so there is
    nothing here to accidentally forward). One row per bbl (the CSV already is; `seen` guards a
    hand-edited CSV that isn't). Optional: the export may not have been run yet."""
    out: list[tuple] = []
    if not GAZETTEER_CSV.exists():
        return out
    seen: set[str] = set()
    with GAZETTEER_CSV.open(newline="") as f:
        for row in csv.DictReader(f):
            bbl = row.get("bbl")
            if not bbl or bbl in seen:
                continue
            seen.add(bbl)
            out.append((
                bbl, row.get("bin") or None,
                _roll_address(row.get("housenum"), row.get("street_canonical")),
                row.get("zip") or None, _int_or_none(row.get("year_built")),
                _float_or_none(row.get("num_floors")), _int_or_none(row.get("units_res")),
                _int_or_none(row.get("units_total")), _int_or_none(row.get("bldg_area")),
                row.get("bldg_class") or None, _int_or_none(row.get("num_bldgs")),
                "prospect.nyc (PLUTO-derived)",
            ))
    return out


# --------------------------------------------------------------- build ------

SCHEMA = """
CREATE TABLE documents(
  doc TEXT PRIMARY KEY, bates_end TEXT, agency TEXT, source TEXT, volume TEXT, box TEXT, folder TEXT,
  page_count INT, pdf_size INT, status TEXT, first_seen TEXT, removed_at TEXT, reappeared_at TEXT,
  changed_at TEXT, changed_fields TEXT, held_locally INT, pages_ok INT, pages_empty INT, pages_ocr INT,
  topic INT, n_related_cross INT, official_url TEXT
);
CREATE TABLE pages(
  doc TEXT, page INT, bates TEXT, chars INT, ocr_status TEXT, ocr_source TEXT, image_ready INT,
  PRIMARY KEY(doc, page)
);
CREATE TABLE snapshots(
  date TEXT PRIMARY KEY, documents INT, pages INT, bytes INT, added INT, removed INT, changed INT, sha256 TEXT
);
CREATE TABLE changes(date TEXT, doc TEXT, kind TEXT, fields TEXT);
CREATE TABLE entities(
  id TEXT PRIMARY KEY, type TEXT, slug TEXT, label TEXT, n_docs INT, n_pages INT, first_date TEXT, last_date TEXT,
  variants TEXT, bbl TEXT, bin TEXT
);
CREATE TABLE entity_pages(entity_id TEXT, doc TEXT, page INT, role TEXT, confidence REAL, raw TEXT);
CREATE TABLE signatories(
  id TEXT PRIMARY KEY, slug TEXT, name TEXT, title TEXT, org TEXT, n_docs INT, first_date TEXT, last_date TEXT
);
CREATE TABLE signatory_pages(id TEXT, doc TEXT, page INT, action TEXT, confidence REAL);
CREATE TABLE related(doc TEXT, rank INT, other TEXT, score REAL, cross INT);
CREATE TABLE near_dupes(doc TEXT, other TEXT, score REAL);
CREATE TABLE topics(
  id INT PRIMARY KEY, parent INT, label TEXT, size_docs INT, size_pages INT, terms TEXT, boxes TEXT, agencies TEXT,
  title TEXT, description TEXT, name_confidence REAL
);
CREATE TABLE doc_topics(doc TEXT, topic INT, prob REAL);
CREATE TABLE places(
  id TEXT PRIMARY KEY, kind TEXT, key TEXT, label TEXT, n_docs INT, n_pages INT, n_test_pages INT,
  first_date TEXT, last_date TEXT, lat REAL, lon REAL
);
CREATE TABLE place_pages(
  place_id TEXT, doc TEXT, page INT, has_test INT, contaminants TEXT, units TEXT, dates TEXT, labs TEXT,
  confidence REAL
);
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE building_facts(
  bbl TEXT PRIMARY KEY, bin TEXT, address TEXT, zip TEXT, year_built INT, num_floors REAL,
  units_res INT, units_total INT, bldg_area INT, bldg_class TEXT, num_bldgs INT, source TEXT
);
"""

INDEXES = """
CREATE INDEX documents_status ON documents(status);
CREATE INDEX documents_volume ON documents(volume);
CREATE INDEX documents_agency ON documents(agency);
CREATE INDEX documents_topic ON documents(topic);
CREATE INDEX pages_doc ON pages(doc);
CREATE INDEX pages_bates ON pages(bates);
CREATE INDEX changes_date ON changes(date);
CREATE INDEX changes_doc ON changes(doc);
CREATE UNIQUE INDEX entities_type_slug_unique ON entities(type, slug);
CREATE INDEX entity_pages_entity ON entity_pages(entity_id);
CREATE INDEX entity_pages_doc ON entity_pages(doc);
CREATE UNIQUE INDEX signatories_slug_unique ON signatories(slug);
CREATE INDEX signatory_pages_id ON signatory_pages(id);
CREATE INDEX signatory_pages_doc ON signatory_pages(doc);
CREATE INDEX related_doc ON related(doc);
CREATE INDEX related_other ON related(other);
CREATE INDEX near_dupes_doc ON near_dupes(doc);
CREATE INDEX near_dupes_other ON near_dupes(other);
CREATE INDEX doc_topics_doc ON doc_topics(doc);
CREATE INDEX doc_topics_topic ON doc_topics(topic);
CREATE INDEX places_kind_key ON places(kind, key);
CREATE INDEX place_pages_place ON place_pages(place_id);
CREATE INDEX place_pages_doc ON place_pages(doc);
CREATE INDEX building_facts_bin ON building_facts(bin);
CREATE INDEX entities_bbl ON entities(bbl);
CREATE INDEX entities_bin ON entities(bin);
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_PATH))
    ap.add_argument("--related", default=str(EMB / "related.sqlite"),
                     help="related/near_dupes/topics/doc_topics source (default data/embed/related.sqlite; "
                          "point at data/embed/p2-related.sqlite for topics.py's human-readable topics)")
    args = ap.parse_args()
    out_path = Path(args.out)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")

    t0 = time.time()
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    if tmp_path.exists():
        tmp_path.unlink()

    manifest = load_manifest()
    manifest_by_doc = {r["bates_start"]: r for r in manifest}

    page_status = load_page_status()
    status_counts = page_status_counts(page_status)
    doc_pages = pages_by_doc(page_status)
    image_ready_counts = load_image_ready(manifest)

    entities_path = EMB / "entities.sqlite"
    entities_con = sqlite3.connect(f"file:{entities_path}?mode=ro", uri=True) if entities_path.exists() else None
    doc_dates = load_doc_date_range(entities_con)
    entities_rows, entity_pages_rows = build_entities(entities_con, doc_dates)
    signatories_rows, signatory_pages_rows = build_signatories(entities_con, doc_dates)
    if entities_con is not None:
        entities_con.close()

    related_rows, near_dupes_rows, topics_rows, doc_topics_rows, topic_of_doc, cross_of_doc = load_related(Path(args.related))
    places_rows, place_pages_rows = load_places()
    building_facts_rows = load_building_facts()
    snapshots_rows = load_snapshots()
    changes_rows = load_changes(manifest_by_doc)

    con = sqlite3.connect(tmp_path)
    con.executescript(SCHEMA)

    # ---- documents ----
    doc_rows = []
    pages_rows = []
    for r in manifest:
        doc = r["bates_start"]
        held = (REPO / r["local_pdf"]).exists() if r.get("local_pdf") else False
        counts = status_counts.get(doc, {})
        doc_rows.append((
            doc, r.get("bates_end"), r.get("agency"), r.get("source"), r.get("production_volume"),
            r.get("box_name"), r.get("folder_name"), r.get("page_count"), r.get("pdf_size"), r.get("status"),
            r.get("first_seen"), r.get("removed_at"), r.get("reappeared_at"), r.get("changed_at"),
            json.dumps(r.get("changed_fields")) if r.get("changed_fields") else None,
            1 if held else 0,
            counts.get("ok", 0), counts.get("empty", 0), counts.get("ocr", 0),
            topic_of_doc.get(doc), cross_of_doc.get(doc, 0), r.get("download_url"),
        ))
        n_rendered = image_ready_counts.get(doc, 0)
        start_n = bates_num(doc)
        page_nums = set(range(1, n_rendered + 1))
        page_nums.update(doc_pages.get(doc, ()))
        for p in sorted(page_nums):
            st = page_status.get((doc, p))
            ocr_status = st["status"] if st else None
            ocr_source = "ours" if ocr_status == "ocr" else "pdftotext"
            bates = st["bates"] if st and st.get("bates") else (
                f"NYC-WTC_{start_n + p - 1:09d}" if start_n is not None else None)
            pages_rows.append((doc, p, bates, st["chars"] if st else None, ocr_status, ocr_source,
                                1 if p <= n_rendered else 0))

    con.executemany("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", doc_rows)
    con.executemany("INSERT INTO pages VALUES (?,?,?,?,?,?,?)", pages_rows)
    con.executemany("INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)",
                     [(s["date"], s["documents"], s["pages"], s["bytes"], s["added"], s["removed"], s["changed"],
                       s["sha256"]) for s in snapshots_rows])
    con.executemany("INSERT INTO changes VALUES (?,?,?,?)", changes_rows)
    con.executemany("INSERT INTO entities VALUES (?,?,?,?,?,?,?,?,?,?,?)", entities_rows)
    con.executemany("INSERT INTO entity_pages VALUES (?,?,?,?,?,?)", entity_pages_rows)
    con.executemany("INSERT INTO signatories VALUES (?,?,?,?,?,?,?,?)", signatories_rows)
    con.executemany("INSERT INTO signatory_pages VALUES (?,?,?,?,?)", signatory_pages_rows)
    con.executemany("INSERT INTO related VALUES (?,?,?,?,?)", related_rows)
    con.executemany("INSERT INTO near_dupes VALUES (?,?,?)", near_dupes_rows)
    con.executemany("INSERT INTO topics VALUES (?,?,?,?,?,?,?,?,?,?,?)", topics_rows)
    con.executemany("INSERT INTO doc_topics VALUES (?,?,?)", doc_topics_rows)
    con.executemany("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?)", places_rows)
    con.executemany("INSERT INTO place_pages VALUES (?,?,?,?,?,?,?,?,?)", place_pages_rows)
    con.executemany("INSERT INTO building_facts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", building_facts_rows)

    counts = {
        "documents": len(doc_rows), "pages": len(pages_rows), "snapshots": len(snapshots_rows),
        "changes": len(changes_rows), "entities": len(entities_rows), "entity_pages": len(entity_pages_rows),
        "signatories": len(signatories_rows), "signatory_pages": len(signatory_pages_rows),
        "related": len(related_rows), "near_dupes": len(near_dupes_rows), "topics": len(topics_rows),
        "doc_topics": len(doc_topics_rows), "places": len(places_rows), "place_pages": len(place_pages_rows),
        "building_facts": len(building_facts_rows),
    }
    latest_snapshot = snapshots_rows[-1]["date"] if snapshots_rows else None
    meta_rows = [
        ("built_at", dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")),
        ("snapshot_date", latest_snapshot),
        ("counts", json.dumps(counts)),
    ]
    con.executemany("INSERT INTO meta VALUES (?,?)", meta_rows)

    con.executescript(INDEXES)
    con.commit()
    con.execute("VACUUM")
    con.close()

    os.replace(tmp_path, out_path)

    summary = {"out": str(out_path), "seconds": round(time.time() - t0, 2), "counts": counts,
               "snapshot_date": latest_snapshot}
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
