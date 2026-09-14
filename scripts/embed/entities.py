#!/usr/bin/env python3
"""entities.py — incremental entity extraction over the extracted OCR pages.

Local only (never contacts the portal). Two passes, both incremental per page text hash:

  regex  (default, fast): dates (normalised to ISO, kept only if 1990–2012), measurements
         (number + unit: f/cc, s/mm2, ppm, ppb, ug/m3, mg/kg, %), contaminants (gazetteer),
         agencies/organisations (gazetteer), street addresses, BIN / block / lot.
  gliner (--gliner): zero-shot NER for person, organization, location, building, chemical,
         with the model named by --gliner-model. Chunks of ~1,200 characters.

Personal data: every `person` mention is stored with pii=1. The console summary never
prints person or address values — counts only. Top values are printed only for
contaminant, agency and measurement-unit labels. Keep entities.sqlite local.

Store: data/embed/entities.sqlite
  pages(doc, page, text_sha1, regex_done, gliner_done, PRIMARY KEY(doc, page))
  mentions(doc, page, start, end, label, text, norm, score, source, pii)

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

REPO = Path(__file__).resolve().parents[2]
TEXT = REPO / "data" / "text"
DB = REPO / "data" / "embed" / "entities.sqlite"

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
UNITS = r"(?:f/cc|fibers?/cc|s/mm2|s/mm\^?2|structures?/mm2|ppm|ppb|ppt|µg/m3|ug/m3|mg/m3|mg/kg|µg/g|ug/g|ng/m3|%)"
STREET_T = r"(?:Street|St\.?|Avenue|Ave\.?|Place|Pl\.?|Plaza|Lane|Slip|Road|Boulevard|Blvd\.?|Drive|Way|Terrace|Square)"

RE_DATE_NUM = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b")
RE_DATE_ISO = re.compile(r"\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b")
RE_DATE_TXT = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b", re.I)
RE_MEAS = re.compile(r"(?<![\w.])(<\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*" + UNITS + r"(?![\w/])", re.I)
RE_ADDR = re.compile(r"\b(\d{1,4}(?:-\d{1,4})?)\s+((?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+|\d{1,3}(?:st|nd|rd|th))(?:\s+[A-Z][a-z]+){0,2})\s+" + STREET_T + r"(?=\W)")
RE_BROADWAY = re.compile(r"\b(\d{1,4})\s+(Broadway|Bowery)\b")
RE_BIN = re.compile(r"\bBIN\s*#?:?\s*(\d{7})\b")
RE_BLOCKLOT = re.compile(r"\bBlock\s*#?:?\s*(\d{1,5})\W{1,4}Lot\s*#?:?\s*(\d{1,4})\b", re.I)


def gaz_regex(words: list[str], flags=re.I) -> re.Pattern:
    alts = sorted({re.escape(w) for w in words}, key=len, reverse=True)
    return re.compile(r"(?<![\w])(" + "|".join(alts) + r")(?![\w])", flags)


RE_CONT = gaz_regex(CONTAMINANTS)
RE_AGENCY_CS = gaz_regex([a for a in AGENCIES if a.isupper() or "." in a], flags=0)   # acronyms: case-sensitive
RE_AGENCY_CI = gaz_regex([a for a in AGENCIES if not (a.isupper() or "." in a)])


def iso(y: int, m: int, d: int) -> str | None:
    if y < 100:
        y += 2000 if y < 50 else 1900
    try:
        v = dt.date(y, m, d)
    except ValueError:
        return None
    return v.isoformat() if 1990 <= v.year <= 2012 else None


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
    for rx in (RE_ADDR, RE_BROADWAY):
        for m in rx.finditer(text):
            yield m.start(), m.end(), "address", m.group(0), re.sub(r"\s+", " ", m.group(0)).upper(), 1
    for m in RE_BIN.finditer(text):
        yield m.start(), m.end(), "bin", m.group(0), m.group(1), 0
    for m in RE_BLOCKLOT.finditer(text):
        yield m.start(), m.end(), "block_lot", m.group(0), f"{m.group(1)}/{m.group(2)}", 0


GLINER_LABELS = ["person", "organization", "government agency", "location", "building", "chemical"]


def connect() -> sqlite3.Connection:
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript("""
    CREATE TABLE IF NOT EXISTS pages(doc TEXT, page INT, text_sha1 TEXT, regex_done INT DEFAULT 0,
        gliner_done INT DEFAULT 0, PRIMARY KEY(doc, page));
    CREATE TABLE IF NOT EXISTS mentions(doc TEXT, page INT, start INT, "end" INT, label TEXT, text TEXT,
        norm TEXT, score REAL, source TEXT, pii INT);
    CREATE INDEX IF NOT EXISTS mentions_label_norm ON mentions(label, norm);
    CREATE INDEX IF NOT EXISTS mentions_doc ON mentions(doc, page);
    """)
    return con


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gliner", action="store_true")
    ap.add_argument("--gliner-model", default="urchade/gliner_medium-v2.1")
    ap.add_argument("--limit-docs", type=int, default=0)
    ap.add_argument("--threshold", type=float, default=0.5)
    args = ap.parse_args()

    con = connect()
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
                prev = None
            regex_done = bool(prev and prev[1])
            gliner_done = bool(prev and prev[2])
            if not regex_done:
                rows = [(doc, page, s, e, lab, t, n, None, "regex", pii) for s, e, lab, t, n, pii in regex_mentions(text)]
                con.executemany('INSERT INTO mentions VALUES (?,?,?,?,?,?,?,?,?,?)', rows)
                stats["regex_pages"] += 1
                stats["regex_mentions"] += len(rows)
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
                        (doc, page, sha, 1, 1 if (gliner_done or model is not None) else 0))
        con.commit()
    dt_s = time.time() - t0

    summary = {"run": dict(stats), "seconds": round(dt_s, 1)}
    summary["mentions_by_label"] = dict(con.execute("SELECT label, count(*) FROM mentions GROUP BY 1 ORDER BY 2 DESC").fetchall())
    summary["distinct_by_label"] = dict(con.execute("SELECT label, count(DISTINCT norm) FROM mentions GROUP BY 1").fetchall())
    for lab in ("contaminant", "agency", "measurement"):
        summary[f"top_{lab}"] = con.execute(
            "SELECT norm, count(*) FROM mentions WHERE label=? GROUP BY 1 ORDER BY 2 DESC LIMIT 12", (lab,)).fetchall()
    years = con.execute("SELECT substr(norm,1,7), count(*) FROM mentions WHERE label='date' GROUP BY 1 ORDER BY 2 DESC LIMIT 12").fetchall()
    summary["top_date_months"] = years
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
