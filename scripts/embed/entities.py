#!/usr/bin/env python3
"""entities.py — incremental entity extraction over the extracted OCR pages.

Local only (never contacts the portal). Incremental per page text hash AND extractor version:
bumping REGEX_VERSION re-runs the regex pass over every page.

  regex  (default, fast):
    date         normalised to ISO, kept only if 1990–2012
    measurement  number + unit (f/cc, s/mm2, ppm, ppb, ug/m3, mg/kg, %)
    contaminant  gazetteer
    agency       gazetteer (acronyms case-sensitive)
    lab          "<Name> Laborator(y|ies) / Labs / Analytical / Testing" organisations
    contractor   "<Name> (Inc.|Corp.|LLC|Co.|Associates|Consultants|Engineers|Contracting)"
    address      street addresses, Broadway/Bowery
    bin, block_lot
  roles (regex, same pass) — people in an official/professional capacity, table `roles`:
    labelled fields: Prepared/Reviewed/Approved/Analyzed/Certified/Submitted/Inspected by:, Analyst:,
    Inspector:, Signature:, From:, To:, CC:  and closing blocks ("Sincerely," / "Very truly yours,")
    followed by a name line and (optionally) a title line.
    official = 1 when a title line (Commissioner, Director, Chemist, Inspector, ...) or an agency/lab
    is attached, or the role is a certifying action (approved/reviewed/analyzed/certified/inspected).
  gliner (--gliner): zero-shot NER (person, organization, government agency, location, building,
    chemical, laboratory) as a second opinion.

Personal data policy (see design brief): people are only ever searchable as a role on a record, in
an official capacity. Every person mention is stored pii=1; the console summary never prints any
person or address value — counts only. Top values are printed only for contaminant, agency, lab,
contractor and measurement units. Keep entities.sqlite local.

Store: data/embed/entities.sqlite
  pages(doc, page, text_sha1, regex_done (= version), gliner_done)
  mentions(doc, page, start, end, label, text, norm, score, source, pii)
  roles(doc, page, start, end, role, name, name_norm, title, org, official)

Usage: .venv/bin/python scripts/embed/entities.py [--gliner] [--limit-docs N] [--gliner-model NAME]
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import canonical  # noqa: E402  (address/lab/contractor canonicalisation, issue #19)

REPO = Path(__file__).resolve().parents[2]
TEXT = REPO / "data" / "text"
DB = REPO / "data" / "embed" / "entities.sqlite"
REGEX_VERSION = 2
CANONICAL_LABELS = ("address", "lab", "contractor")
# One-time export of Prospect's property roll (export_prospect_gazetteer.py, operator-run; this
# module never connects to the Prospect database itself — see that script's docstring). Optional:
# canonicalise() falls back to the frequency-seed method everywhere the file is absent or a house
# number isn't in it. TODO(coordinator, on merge to main): rename off the p1- prefix if this stays
# the permanent path.
GAZETTEER_CSV = REPO / "data" / "embed" / "gazetteer-prospect.csv"

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

CONTAMINANTS = [
    "asbestos", "chrysotile", "amosite", "crocidolite", "tremolite", "actinolite", "anthophyllite",
    "lead", "mercury", "cadmium", "chromium", "arsenic", "beryllium", "nickel", "zinc", "copper",
    "pcb", "pcbs", "polychlorinated biphenyl", "dioxin", "dioxins", "furan", "furans", "benzene",
    "toluene", "xylene", "ethylbenzene", "pah", "pahs", "polycyclic aromatic", "silica", "fiberglass",
    "glass fibers", "gypsum", "calcium carbonate", "particulate", "pm2.5", "pm 2.5", "pm10", "pm 10",
    "voc", "vocs", "svoc", "svocs", "freon", "mold", "sulfur dioxide", "hydrogen sulfide",
    "carbon monoxide", "formaldehyde", "diesel", "smoke", "dust", "debris", "concrete dust",
]
AGENCIES = [
    "EPA", "U.S. EPA", "Environmental Protection Agency", "DEP", "Department of Environmental Protection",
    "OSHA", "FEMA", "NIOSH", "ATSDR", "CDC", "DOH", "DOHMH", "Department of Health", "NYSDEC", "NYSDOH",
    "USACE", "Army Corps of Engineers", "DDC", "Department of Design and Construction", "DCAS",
    "FDNY", "Fire Department", "NYPD", "Police Department", "DOB", "Department of Buildings",
    "OEM", "Office of Emergency Management", "Port Authority", "Con Edison", "Law Department",
    "Corporation Counsel", "City Hall", "Mayor's Office", "Office of the Mayor", "DORIS",
    "Lower Manhattan Development Corporation", "LMDC", "Battery Park City Authority", "Verizon",
    "Board of Education", "Department of Sanitation", "DSNY", "HPD", "Red Cross", "Salvation Army",
]
TITLE_WORDS = [
    "Commissioner", "Deputy Commissioner", "Assistant Commissioner", "Director", "Deputy Director",
    "Chief", "Manager", "Project Manager", "Supervisor", "Engineer", "Chief Engineer", "Inspector",
    "Analyst", "Chemist", "Microbiologist", "Industrial Hygienist", "Hygienist", "Toxicologist",
    "Geologist", "Scientist", "Technician", "Counsel", "General Counsel", "Attorney", "Officer",
    "Coordinator", "Administrator", "Secretary", "Mayor", "Deputy Mayor", "President", "Vice President",
    "Principal", "Laboratory Director", "QA Officer", "Quality Assurance", "Specialist", "Superintendent",
    "Borough Commissioner", "Executive", "Associate", "Assistant", "Environmental Scientist",
]
UNITS = r"(?:f/cc|fibers?/cc|s/mm2|s/mm\^?2|structures?/mm2|ppm|ppb|ppt|µg/m3|ug/m3|mg/m3|mg/kg|µg/g|ug/g|ng/m3|%)"
STREET_T = r"(?:Street|St\.?|Avenue|Ave\.?|Place|Pl\.?|Plaza|Lane|Slip|Road|Boulevard|Blvd\.?|Drive|Way|Terrace|Square)"
CAPWORD = r"(?:[A-Z][a-zA-Z'&\-]+|[A-Z]\.)"

RE_DATE_NUM = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b")
RE_DATE_ISO = re.compile(r"\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b")
RE_DATE_TXT = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b", re.I)
RE_MEAS = re.compile(r"(?<![\w.])(<\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*" + UNITS + r"(?![\w/])", re.I)
RE_ADDR = re.compile(r"\b(\d{1,4}(?:-\d{1,4})?)\s+((?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+|\d{1,3}(?:st|nd|rd|th))(?:\s+[A-Z][a-z]+){0,2})\s+" + STREET_T + r"(?=\W)")
RE_BROADWAY = re.compile(r"\b(\d{1,4})\s+(Broadway|Bowery)\b")
RE_BIN = re.compile(r"\bBIN\s*#?:?\s*(\d{7})\b")
RE_BLOCKLOT = re.compile(r"\bBlock\s*#?:?\s*(\d{1,5})\W{1,4}Lot\s*#?:?\s*(\d{1,4})\b", re.I)
RE_LAB = re.compile(r"\b((?:" + CAPWORD + r"[ ,&]{1,3}){1,5}(?:Laborator(?:y|ies)|Labs?|Analytical(?:\s+(?:Services|Laboratories|Inc\.?))?|Testing(?:\s+(?:Laboratories|Services|Inc\.?))?))\b")
RE_CONTRACTOR = re.compile(r"\b((?:" + CAPWORD + r"[ ,&]{1,3}){1,5}(?:Inc\.|Inc\b|Corp\.|Corporation|LLC|L\.L\.C\.|Co\.|Company|Associates|Consultants|Consulting|Engineers|Engineering|Contracting|Contractors|Construction|Environmental Services))")

ROLE_LABELS = {
    "prepared by": "prepared", "reviewed by": "reviewed", "approved by": "approved", "analyzed by": "analyzed",
    "analysed by": "analyzed", "certified by": "certified", "submitted by": "submitted", "inspected by": "inspected",
    "sampled by": "sampled", "collected by": "sampled", "checked by": "reviewed", "authorized by": "approved",
    "analyst": "analyzed", "inspector": "inspected", "signature": "signed", "signed": "signed",
    "from": "from", "to": "to", "cc": "cc", "c.c.": "cc", "attention": "to", "attn": "to",
}
CERTIFYING = {"approved", "reviewed", "analyzed", "certified", "inspected", "signed", "prepared"}
RE_ROLE = re.compile(
    r"(?im)^[ \t]*(" + "|".join(sorted((re.escape(k) for k in ROLE_LABELS), key=len, reverse=True)) + r")[ \t]*[:.\-][ \t]*"
    r"((?:" + CAPWORD + r"[ \t]+){0,3}" + CAPWORD + r")(?:[ \t]*,[ \t]*([^\n]{2,80}))?")
RE_CLOSING = re.compile(
    r"(?i)(sincerely|very truly yours|respectfully(?: submitted)?|regards)\s*,?\s*\n(?:[ \t]*\n){0,3}"
    r"[ \t]*((?:" + CAPWORD + r"[ \t]+){0,3}" + CAPWORD + r")[ \t]*\n[ \t]*([^\n]{2,80})?")
RE_TITLE = re.compile(r"\b(" + "|".join(sorted((re.escape(t) for t in TITLE_WORDS), key=len, reverse=True)) + r")\b")
NOT_NAMES = {"The", "This", "Date", "Subject", "Re", "Page", "Sample", "Project", "Report", "City", "New", "York",
             "Department", "Office", "Environmental", "Protection", "Agency", "Laboratory", "Inc", "N/A", "None"}


def gaz_regex(words: list[str], flags=re.I) -> re.Pattern:
    alts = sorted({re.escape(w) for w in words}, key=len, reverse=True)
    return re.compile(r"(?<![\w])(" + "|".join(alts) + r")(?![\w])", flags)


RE_CONT = gaz_regex(CONTAMINANTS)
RE_AGENCY_CS = gaz_regex([a for a in AGENCIES if a.isupper() or "." in a], flags=0)
RE_AGENCY_CI = gaz_regex([a for a in AGENCIES if not (a.isupper() or "." in a)])
RE_AGENCY_ANY = gaz_regex(AGENCIES)


def iso(y: int, m: int, d: int) -> str | None:
    if y < 100:
        y += 2000 if y < 50 else 1900
    try:
        v = dt.date(y, m, d)
    except ValueError:
        return None
    return v.isoformat() if 1990 <= v.year <= 2012 else None


def norm_org(s: str) -> str:
    return re.sub(r"[\s,]+", " ", s).strip(" ,&").upper()


def regex_mentions(text: str):
    for m in RE_DATE_NUM.finditer(text):
        n = iso(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        if n:
            yield m.start(), m.end(), "date", m.group(0), n, 0
    for m in RE_DATE_ISO.finditer(text):
        n = iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if n:
            yield m.start(), m.end(), "date", m.group(0), n, 0
    for m in RE_DATE_TXT.finditer(text):
        n = iso(int(m.group(3)), MONTHS[m.group(1)[:3].lower()], int(m.group(2)))
        if n:
            yield m.start(), m.end(), "date", m.group(0), n, 0
    for m in RE_MEAS.finditer(text):
        unit = re.search(UNITS, m.group(0), re.I).group(0).lower()
        yield m.start(), m.end(), "measurement", m.group(0), unit, 0
    for m in RE_CONT.finditer(text):
        yield m.start(), m.end(), "contaminant", m.group(0), m.group(0).lower().replace(" ", ""), 0
    for rx in (RE_AGENCY_CS, RE_AGENCY_CI):
        for m in rx.finditer(text):
            yield m.start(), m.end(), "agency", m.group(0), m.group(0).upper(), 0
    for m in RE_LAB.finditer(text):
        yield m.start(1), m.end(1), "lab", m.group(1), norm_org(m.group(1)), 0
    for m in RE_CONTRACTOR.finditer(text):
        yield m.start(1), m.end(1), "contractor", m.group(1), norm_org(m.group(1)), 0
    for rx in (RE_ADDR, RE_BROADWAY):
        for m in rx.finditer(text):
            yield m.start(), m.end(), "address", m.group(0), re.sub(r"\s+", " ", m.group(0)).upper(), 1
    for m in RE_BIN.finditer(text):
        yield m.start(), m.end(), "bin", m.group(0), m.group(1), 0
    for m in RE_BLOCKLOT.finditer(text):
        yield m.start(), m.end(), "block_lot", m.group(0), f"{m.group(1)}/{m.group(2)}", 0


def plausible_name(name: str) -> bool:
    toks = name.split()
    return (1 <= len(toks) <= 4 and not any(t.strip(".") in NOT_NAMES for t in toks)
            and sum(len(t.strip(".")) > 1 for t in toks) >= 1 and not RE_TITLE.search(name))


def role_mentions(text: str):
    """(start, end, role, name, name_norm, title, org, official) for people acting on a record."""
    for m in RE_ROLE.finditer(text):
        role = ROLE_LABELS[m.group(1).lower().rstrip(".")] if m.group(1).lower().rstrip(".") in ROLE_LABELS \
            else ROLE_LABELS.get(m.group(1).lower(), "named")
        name = m.group(2).strip()
        if not plausible_name(name):
            continue
        tail = (m.group(3) or "")
        after = text[m.end(): m.end() + 120].split("\n")
        title_src = tail or (after[1] if len(after) > 1 else "")
        t = RE_TITLE.search(title_src)
        org = RE_AGENCY_ANY.search(title_src) or RE_LAB.search(title_src)
        title = t.group(1) if t else None
        orgv = norm_org(org.group(1)) if org else None
        official = int(bool(title or orgv) or role in CERTIFYING)
        yield m.start(2), m.start(2) + len(name), role, name, name.upper(), title, orgv, official
    for m in RE_CLOSING.finditer(text):
        name = m.group(2).strip()
        if not plausible_name(name):
            continue
        line = m.group(3) or ""
        t = RE_TITLE.search(line)
        org = RE_AGENCY_ANY.search(line) or RE_LAB.search(line)
        title = t.group(1) if t else None
        orgv = norm_org(org.group(1)) if org else None
        yield m.start(2), m.start(2) + len(name), "signed", name, name.upper(), title, orgv, int(bool(title or orgv))


GLINER_LABELS = ["person", "organization", "government agency", "laboratory", "location", "building", "chemical"]


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or DB
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript("""
    CREATE TABLE IF NOT EXISTS pages(doc TEXT, page INT, text_sha1 TEXT, regex_done INT DEFAULT 0,
        gliner_done INT DEFAULT 0, PRIMARY KEY(doc, page));
    CREATE TABLE IF NOT EXISTS mentions(doc TEXT, page INT, start INT, "end" INT, label TEXT, text TEXT,
        norm TEXT, score REAL, source TEXT, pii INT);
    CREATE TABLE IF NOT EXISTS roles(doc TEXT, page INT, start INT, "end" INT, role TEXT, name TEXT,
        name_norm TEXT, title TEXT, org TEXT, official INT);
    CREATE INDEX IF NOT EXISTS mentions_label_norm ON mentions(label, norm);
    CREATE INDEX IF NOT EXISTS mentions_doc ON mentions(doc, page);
    CREATE INDEX IF NOT EXISTS roles_name ON roles(name_norm, role);
    CREATE INDEX IF NOT EXISTS roles_doc ON roles(doc, page);
    """)
    migrate_canonical_columns(con)
    return con


def migrate_canonical_columns(con: sqlite3.Connection) -> None:
    """Add mentions.canonical_key/canonical_label/canonical_confidence/canonical_bbl/canonical_bin/
    canonical_method/canonical_borough/canonical_address_role if missing. Safe to re-run (checks
    PRAGMA table_info first; SQLite has no ADD COLUMN IF NOT EXISTS). canonical_method IN
    ('exact','roll','fuzzy','llm') — see canonical.py's canonicalize_addresses()/
    canonicalize_orgs() docstrings for 'exact'/'roll'/'fuzzy', and canonical_llm.py for the 'llm'
    last-resort pass (issue #19 follow-up, Henry 2026-09-14). canonical_borough/
    canonical_address_role (address label only) are set by `classify_addresses()` below (issue #19
    follow-up, Henry 2026-09-14: "59-17 Junction Blvd -> Queens; it's a testing center")."""
    cols = {r[1] for r in con.execute("PRAGMA table_info(mentions)")}
    for name, decl in (("canonical_key", "TEXT"), ("canonical_label", "TEXT"),
                        ("canonical_confidence", "REAL"), ("canonical_bbl", "TEXT"),
                        ("canonical_bin", "TEXT"), ("canonical_method", "TEXT"),
                        ("canonical_borough", "TEXT"), ("canonical_address_role", "TEXT")):
        if name not in cols:
            con.execute(f"ALTER TABLE mentions ADD COLUMN {name} {decl}")
    con.execute("CREATE INDEX IF NOT EXISTS mentions_canonical ON mentions(canonical_key)")
    con.commit()


def canonicalise(con: sqlite3.Connection) -> tuple[dict, dict]:
    """Incremental pass: for label in address/lab/contractor, compute canonical_key/label/
    confidence/method for every distinct `norm` and fill any mentions row still missing one.
    Addresses try the Prospect property-roll gazetteer (GAZETTEER_CSV, loaded once here if present
    — canonical.py itself never touches a database) first, carrying its bbl/bin; anything the roll
    doesn't cover falls back to entities.py's own mention-frequency counts as a seed gazetteer, same
    as labs and contractors always do. Only ever WRITES WHERE canonical_key IS NULL, so a re-run
    never re-scores an already-canonicalised row even if the corpus or the gazetteer has grown since
    (that re-scoring, if ever wanted, is a deliberate separate pass, not a side effect of running
    this one again).

    Returns (stats, mappings) — mappings[label] is the raw `canonical.canonicalize_addresses()` /
    `canonicalize_orgs()` output, reused by `canonicalise_llm()` (below) so the last-resort LLM pass
    never recomputes the rule-based tiers."""
    migrate_canonical_columns(con)
    gazetteer = None
    if GAZETTEER_CSV.exists():
        gazetteer = canonical.load_gazetteer(GAZETTEER_CSV)
    stats: dict = {}
    mappings: dict = {}
    for label in CANONICAL_LABELS:
        counts = dict(con.execute("SELECT norm, count(*) FROM mentions WHERE label=? GROUP BY 1", (label,)))
        before = con.execute("SELECT count(*) FROM mentions WHERE label=? AND canonical_key IS NULL",
                              (label,)).fetchone()[0]
        if label == "address":
            mapping = canonical.canonicalize_addresses(counts, gazetteer=gazetteer)
            rows = [(ck, cl, cf, bbl, bin_, mth, label, norm)
                    for norm, (ck, cl, cf, bbl, bin_, mth) in mapping.items()]
            roll_matched = sum(1 for v in mapping.values() if v[3])
            con.executemany(
                "UPDATE mentions SET canonical_key=?, canonical_label=?, canonical_confidence=?, "
                "canonical_bbl=?, canonical_bin=?, canonical_method=? "
                "WHERE label=? AND norm=? AND canonical_key IS NULL", rows)
        else:
            mapping = canonical.canonicalize_orgs(label, counts)
            rows = [(ck, cl, cf, mth, label, norm) for norm, (ck, cl, cf, mth) in mapping.items()]
            roll_matched = None
            con.executemany(
                "UPDATE mentions SET canonical_key=?, canonical_label=?, canonical_confidence=?, "
                "canonical_method=? WHERE label=? AND norm=? AND canonical_key IS NULL", rows)
        mappings[label] = mapping
        after = con.execute("SELECT count(*) FROM mentions WHERE label=? AND canonical_key IS NULL",
                             (label,)).fetchone()[0]
        stats[label] = {"distinct_raw": len(counts), "distinct_canonical": len(set(v[0] for v in mapping.values())),
                         "rows_filled": before - after, "rows_still_null": after}
        if roll_matched is not None:
            stats[label]["roll_matched_raw_spellings"] = roll_matched
            stats[label]["gazetteer_loaded"] = gazetteer is not None
    con.commit()
    return stats, mappings


def classify_addresses(con: sqlite3.Connection) -> dict:
    """Borough + address_role for every canonicalised address entity (issue #19 follow-up, Henry
    2026-09-14: "59-17 Junction Blvd -> this is in Queens; it's a testing center" — lab/contractor
    mailing addresses outside Manhattan were being treated as sampling-site buildings). Run AFTER
    canonicalise() (and, if used, canonical_llm.py's merges) so every address mention already has
    its FINAL canonical_key.

    borough: canonical.infer_borough() — 'Manhattan' | 'Outside Manhattan' | 'Queens', see that
    function's docstring for the (deliberately conservative, machine-derived) signals.

    address_role: 'organisation' | 'site'. An address is 'organisation' when the MAJORITY of its
    mention occurrences share a (doc, page) with a lab or contractor mention — the letterhead/
    signature-block signal Henry named ("appears only in lab/contractor letterheads, signature
    blocks or 'Laboratory:'/'Analyzed by' contexts"). This is a page-level proxy, not a character-
    distance one: a lab/contractor name and its own address are essentially always on the same
    page when either appears at all, and page-level keeps this a single pass over `mentions`
    rather than a second full-text scan.

    Stores canonical_borough/canonical_address_role on EVERY mentions row sharing a canonical_key
    (not just WHERE NULL — a full re-classify is correct here, unlike canonicalise()'s incremental
    fill, since a repeat run should reflect the CURRENT final canonical_key assignment, including
    any the LLM pass merged since a prior classify run)."""
    migrate_canonical_columns(con)
    gazetteer = canonical.load_gazetteer(GAZETTEER_CSV) if GAZETTEER_CSV.exists() else None
    manhattan_streets = canonical.gazetteer_street_names(gazetteer) if gazetteer else None

    org_pages = {(d, p) for d, p in con.execute(
        "SELECT DISTINCT doc, page FROM mentions WHERE label IN ('lab','contractor')")}

    by_key: dict[str, dict] = {}
    for doc, page, norm, ckey, clabel, cbbl in con.execute(
            "SELECT doc, page, norm, canonical_key, canonical_label, canonical_bbl "
            "FROM mentions WHERE label='address' AND canonical_key IS NOT NULL"):
        g = by_key.setdefault(ckey, {"label": clabel, "bbl": cbbl, "pages": [], "n": 0, "org_n": 0})
        if cbbl and not g["bbl"]:
            g["bbl"] = cbbl
        g["pages"].append((doc, page))
        g["n"] += 1
        if (doc, page) in org_pages:
            g["org_n"] += 1

    rows = []
    borough_counts: dict[str, int] = collections.Counter()
    role_counts: dict[str, int] = collections.Counter()
    reclassified = 0  # borough != 'Manhattan' or role == 'organisation' — the count the report wants
    for ckey, g in by_key.items():
        house, street = canonical.split_house_street(g["label"] or "")
        stype = canonical.street_type_of(street) or ""
        sname = canonical.street_name_of(street)
        borough = (canonical.infer_borough(house, sname, stype, g["bbl"], manhattan_streets)
                   if house is not None else "Outside Manhattan")
        role = "organisation" if g["org_n"] / g["n"] >= 0.5 else "site"
        borough_counts[borough] += 1
        role_counts[role] += 1
        if borough != "Manhattan" or role == "organisation":
            reclassified += 1
        rows.append((borough, role, ckey))

    con.executemany(
        "UPDATE mentions SET canonical_borough=?, canonical_address_role=? "
        "WHERE label='address' AND canonical_key=?", rows)
    con.commit()
    return {
        "address_entities_classified": len(by_key),
        "by_borough": dict(borough_counts),
        "by_address_role": dict(role_counts),
        "reclassified_non_manhattan_or_org": reclassified,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gliner", action="store_true")
    ap.add_argument("--gliner-model", default="urchade/gliner_medium-v2.1")
    ap.add_argument("--limit-docs", type=int, default=0)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--canonicalise", action="store_true",
                     help="fill mentions.canonical_key/label/confidence for address/lab/contractor "
                          "mentions still missing them, then exit (does not run extraction)")
    ap.add_argument("--llm", action="store_true",
                     help="with --canonicalise: also run the LLM last-resort pass (canonical_llm.py, "
                          "issue #19 follow-up) on whatever the rule-based tiers left isolated")
    ap.add_argument("--llm-budget-usd", type=float, default=1.0)
    ap.add_argument("--db", default=None, help="override the entities.sqlite path (e.g. for a copy)")
    args = ap.parse_args()

    db_path = Path(args.db) if args.db else None
    con = connect(db_path)

    if args.canonicalise:
        stats, mappings = canonicalise(con)
        print(json.dumps({"canonicalise": stats}, indent=1))
        if args.llm:
            import canonical_llm
            llm_summary = {}
            for label in CANONICAL_LABELS:
                updates, usage = canonical_llm.resolve_label(
                    con, label, mappings[label], budget_usd=args.llm_budget_usd)
                n = canonical_llm.apply_updates(con, label, updates)
                llm_summary[label] = {**usage, "rows_updated": n}
            print(json.dumps({"canonicalise_llm": llm_summary}, indent=1))
        # Runs after any --llm merges, so borough/address_role reflect the FINAL canonical_key.
        classify_stats = classify_addresses(con)
        print(json.dumps({"classify_addresses": classify_stats}, indent=1))
        return 0

    state = {(d, p): (s, r, g) for d, p, s, r, g in con.execute("SELECT doc,page,text_sha1,regex_done,gliner_done FROM pages")}
    files = sorted(TEXT.rglob("*.pages.jsonl"))
    if args.limit_docs:
        files = files[: args.limit_docs]

    model = None
    if args.gliner:
        from gliner import GLiNER
        import torch
        model = GLiNER.from_pretrained(args.gliner_model)
        if torch.backends.mps.is_available():
            model = model.to("mps")

    t0 = time.time()
    stats = collections.Counter()
    for f in files:
        doc = f.name[: -len(".pages.jsonl")]
        for line in f.open():
            if not line.strip():
                continue
            row = json.loads(line)
            page, text = int(row["page"]), row.get("text") or ""
            if len(text.strip()) < 40:
                continue
            sha = hashlib.sha1(text.encode()).hexdigest()
            prev = state.get((doc, page))
            if prev and prev[0] != sha:
                con.execute("DELETE FROM mentions WHERE doc=? AND page=?", (doc, page))
                con.execute("DELETE FROM roles WHERE doc=? AND page=?", (doc, page))
                prev = None
            regex_current = bool(prev and (prev[1] or 0) >= REGEX_VERSION)
            gliner_done = bool(prev and prev[2])
            if not regex_current:
                con.execute("DELETE FROM mentions WHERE doc=? AND page=? AND source='regex'", (doc, page))
                con.execute("DELETE FROM roles WHERE doc=? AND page=?", (doc, page))
                rows = [(doc, page, s, e, lab, t, n, None, "regex", pii) for s, e, lab, t, n, pii in regex_mentions(text)]
                con.executemany('INSERT INTO mentions VALUES (?,?,?,?,?,?,?,?,?,?)', rows)
                rrows = [(doc, page, *r) for r in role_mentions(text)]
                con.executemany('INSERT INTO roles VALUES (?,?,?,?,?,?,?,?,?,?)', rrows)
                stats["regex_pages"] += 1
                stats["regex_mentions"] += len(rows)
                stats["role_mentions"] += len(rrows)
            if model is not None and not gliner_done:
                rows = []
                for cs in range(0, len(text), 1200):
                    chunk = text[cs: cs + 1300]
                    for ent in model.predict_entities(chunk, GLINER_LABELS, threshold=args.threshold):
                        lab = ent["label"]
                        rows.append((doc, page, cs + ent["start"], cs + ent["end"], f"g:{lab}", ent["text"],
                                     re.sub(r"\s+", " ", ent["text"]).strip().upper(), float(ent["score"]), "gliner",
                                     1 if lab in ("person", "location", "building") else 0))
                con.executemany('INSERT INTO mentions VALUES (?,?,?,?,?,?,?,?,?,?)', rows)
                stats["gliner_pages"] += 1
                stats["gliner_mentions"] += len(rows)
            con.execute("INSERT OR REPLACE INTO pages VALUES (?,?,?,?,?)",
                        (doc, page, sha, REGEX_VERSION, 1 if (gliner_done or model is not None) else 0))
        con.commit()

    summary = {"run": dict(stats), "seconds": round(time.time() - t0, 1)}
    summary["mentions_by_label"] = dict(con.execute("SELECT label, count(*) FROM mentions GROUP BY 1 ORDER BY 2 DESC").fetchall())
    summary["distinct_by_label"] = dict(con.execute("SELECT label, count(DISTINCT norm) FROM mentions GROUP BY 1").fetchall())
    summary["roles_by_role"] = dict(con.execute("SELECT role, count(*) FROM roles GROUP BY 1 ORDER BY 2 DESC").fetchall())
    summary["roles_official"] = dict(con.execute("SELECT official, count(*) FROM roles GROUP BY 1").fetchall())
    summary["distinct_official_people"] = con.execute("SELECT count(DISTINCT name_norm) FROM roles WHERE official=1").fetchone()[0]
    summary["roles_top_titles"] = con.execute("SELECT title, count(*) FROM roles WHERE title IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10").fetchall()
    for lab in ("contaminant", "agency", "lab", "contractor", "measurement"):
        summary[f"top_{lab}"] = con.execute(
            "SELECT norm, count(*) FROM mentions WHERE label=? GROUP BY 1 ORDER BY 2 DESC LIMIT 10", (lab,)).fetchall()
    summary["top_date_months"] = con.execute(
        "SELECT substr(norm,1,7), count(*) FROM mentions WHERE label='date' GROUP BY 1 ORDER BY 2 DESC LIMIT 10").fetchall()
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
