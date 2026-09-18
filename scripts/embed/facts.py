#!/usr/bin/env python3
"""facts.py — sample-level environmental test facts (issue #34): "addresses impacted by asbestos"
needs a TABLE, not a document list. This walks every page of a lab_report / chain_of_custody / form
document (scripts/embed/doctypes.py's classification), plus any other page where entities.py already
found a contaminant AND a measurement, and tries to pull out individual sample readings: substance,
sample type, value + unit, date, lab, method, a stated limit and above/below when the page itself
compares to one, and the exact page + Bates it came from.

Local only (never contacts the City's portal). Reads data/embed/entities.sqlite (mentions, read-only
— never written here), data/embed/p3-doctypes.jsonl, data/embed/pages.sqlite (for the OCR-overlay
rule doctypes.py/load_site_pg.py already use), data/embed/gazetteer-prospect.csv (via canonical.py,
optional) and data/text/**/<bates>.pages.jsonl (+ .ocr.jsonl). Writes ONLY data/embed/p4-facts.jsonl,
data/embed/p4-facts.sqlite and data/embed/p4-facts-cache.json — never touches entities.sqlite,
pages.sqlite or site.sqlite.

## Extraction, three rule tiers then an LLM last resort

Every page is worked page-by-page; a page's mentions (contaminant/measurement/date/lab/address/bin/
block_lot, source='regex') come straight from entities.sqlite, and `building_key` is resolved once
per page, strongest signal first — BIN > block/lot > canonicalised address bbl > canonicalised
address key (same priority places.py uses for its own place resolution) — via canonical.py's own
canonicalisation already stored on `mentions` by `entities.py --canonicalise`. `null` when the page
carries none of those.

  Tier A — DEP-style columnar asbestos bulk report (`dep_asbestos_block()`). A recurring NYC DEP
    "ASBESTOS ANALYTICAL REPORT" shape: a `Location Sampled:` line and a `DEP Sample #:` / lab
    sample-number line, each holding N space-separated entries (one per sample column), followed by
    a `Results (%)` block whose lines repeat `<material> <value>` N times left-to-right — literally
    "Chrysotile 1 Chrysotile TRACE Chrysotile 1.1" for a 3-sample page. A results LINE is used only
    when it yields exactly N (material, value) pairs — a line with a different count (seen on real
    pages, usually a blank OCR'd cell) is dropped rather than guessed. `sample_type='bulk'`,
    `unit='%'`, confidence 0.85.
  Tier B — generic lab-report column table (`generic_table()`). Finds a header line naming both a
    "Results"-ish and "Units"-ish column (also matches "Test Description", "Analyte", "MDL",
    "Method", "Analyzed on" — the Westchester County "REPORT OF ANALYSIS" shape, e.g.
    NYC-WTC_000025711 p3/4, and generic ICP-MS/GC-MS printouts), maps each subsequent row's
    2-or-more-space-separated cells onto that header by column position, and only emits a fact when
    the row's value cell parses as a number (or `<value`/`ND`/`TRACE`). confidence 0.7.
  Tier C — page-level pairing fallback (`page_level_pairing()`). No table shape recognised, but the
    page's own regex mentions carry exactly one contaminant and one measurement (or every
    measurement has one unambiguous nearest contaminant within 400 chars, capped at 3 pairs) — pairs
    them directly. confidence 0.5 (single pair) or 0.4 (nearest-pair, multi).
  Tier D — LLM last resort (`llm_extract()`), **only** for a page whose DOCUMENT was classified
    lab_report/chain_of_custody/form, rules found nothing on it, AND it still "looks like a result
    table" (`looks_like_table()`: a measurement-shaped number+unit, or vocabulary like "results",
    "sample id", "laboratory", "analysis", "detected"). Sent to claude-haiku-4-5-20251001 in batches
    of `LLM_BATCH_SIZE` pages, page text truncated to `LLM_MAX_CHARS` chars, a strict JSON-array
    schema, cached by sha1(page text) in data/embed/p4-facts-cache.json (so a re-run, or a budget cap
    hit partway, never re-asks/re-bills a page already answered), hard-capped at `--budget-usd`
    (default $3). Facts returned this way are `extractor='llm'`; `building_key` is still resolved the
    same page-level way as the rule tiers (the model is never asked to know a BBL).

Substance normalisation reuses entities.py's own CONTAMINANTS gazetteer (`entities.RE_CONT`) so a
fact's `substance` matches an existing `substance` entity's `norm` 1:1; a small element-symbol table
(`ELEMENT_SYMBOLS`, Pb/Hg/Cd/Cr/As/Be/Ni/Zn/Cu) maps a metals-table column header onto the same
gazetteer word. A material name with no gazetteer match (e.g. "Cellulose", "Fibrous glass", "Matrix"
in a DEP asbestos block's non-asbestos rows) is dropped, not guessed at — it is real page content but
not one of entities.py's tracked contaminants, so nothing here invents a new one.

Units are normalised (`canon_unit()`) to entities.py's own set (f/cc, s/mm², ppm, ppb, ppt, µg/m³,
mg/m³, ng/m³, mg/kg, µg/g, %) plus three this module adds for water samples the brief asks for
(µg/L, mg/L, ng/L — entities.py's own UNITS regex has no water unit, since places.py/entities.py
never needed one). `sample_type` comes from an explicit keyword on the page when present
(`SAMPLE_TYPE_KEYWORDS`), else a unit->type default (`UNIT_SAMPLE_TYPE_DEFAULT`) when the unit
implies one unambiguously (% -> bulk, mg/kg -> soil, µg/L -> water, f/cc -> air), else null — ppm/ppb
alone say nothing about matrix. `method` is a plain keyword scan (`METHOD_PATTERNS`: PCM, TEM, PLM,
GC-MS, ICP-MS, AA, XRF) over the page (Tier A/C) or the row's own Method cell (Tier B). `limit_value`/
`limit_source`/`result` are populated ONLY when the page states a limit near the reading AND a
numeric comparison is possible (`find_limit_near()` for Tiers A/C; Tier B's own Limit/MDL column for
Tier B) — never a health verdict, per the brief; most facts carry `result=None` ("none-stated").

Output: data/embed/p4-facts.jsonl (one row per fact) and data/embed/p4-facts.sqlite (`facts` table,
same columns). Both are rebuilt fully on every run (like places.py; cheap enough — only the LLM tier
is cached). Prints a one-line JSON summary: counts by extractor/tier, substance/building coverage,
LLM token usage and cost.

Usage:
  .venv/bin/python scripts/embed/facts.py [--out PATH] [--sqlite PATH] [--budget-usd 3.0]
                                           [--no-llm] [--limit-pages N]
"""
from __future__ import annotations

from page_text import effective_rows
import argparse
import collections
import datetime
import hashlib
import json
import os
import random
import re
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import canonical  # noqa: E402  (unused directly here beyond entities.sqlite's own canonicalisation, kept for the module-level cross reference in docs)
import entities as entities_mod  # noqa: E402  reuse CONTAMINANTS/RE_CONT/the gazetteer, never re-derive it

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"
TEXT = DATA / "text"
EMB = DATA / "embed"
ENTITIES_DB = EMB / "entities.sqlite"
DOCTYPES_JSONL = EMB / "p3-doctypes.jsonl"
PAGES_DB = EMB / "pages.sqlite"

OUT_JSONL = EMB / "p4-facts.jsonl"
OUT_SQLITE = EMB / "p4-facts.sqlite"
CACHE_PATH = EMB / "p4-facts-cache.json"
KEY_FILE = Path("/Users/henry/Code/sept11-docs/.claudekey")

MODEL = "claude-haiku-4-5-20251001"
LLM_BATCH_SIZE = 2           # pages per request — a table-dense page can hold dozens of readings,
                              # each a whole JSON object in the response; keeping batches small keeps
                              # the response under LLM_MAX_TOKENS instead of getting cut off mid-JSON
                              # (the first real run, 2026-09-14, truncated at batch size 3 / 4096
                              # output tokens on pages like a 13-analyte ICP-MS metals table).
LLM_MAX_TOKENS = 8192
LLM_MAX_CHARS = 6000         # per-page text cap sent to the model
DEFAULT_BUDGET_USD = 3.0
# claude-haiku-4-5 pricing, same table canonical_llm.py cites (checked 2026-09-14).
PRICE_IN_PER_MTOK = 1.00
PRICE_OUT_PER_MTOK = 5.00

TARGET_DOC_TYPES = {"lab_report", "chain_of_custody", "form"}
WATERMARK_RE = re.compile(r"NYC\s*9[\/\s]*1+1?\s*Public\s*Portal\s*Document", re.I)

# ------------------------------------------------------------------------------- units/substances --
UNITS_FACTS = (r"(?:f/cc|fibers?/cc|s/mm2|s/mm\^?2|structures?/mm2|ppm|ppb|ppt|"
               r"µg/m3|ug/m3|mg/m3|ng/m3|mg/kg|µg/g|ug/g|µg/L|ug/L|mg/L|ng/L|"
               # wipe-sample units (µg or mg per sq ft / 100 cm²) — added after facts.py's first
               # real-corpus run turned up an EPA-wipe metals report (NYC-WTC_000096024 p4-5,
               # "Cadmium 0.595 µg/ft2") entities.py's own UNITS regex never needed since it has no
               # wipe-sample use case of its own.
               r"µg/ft2|ug/ft2|mg/ft2|µg/100\s?cm2|ug/100\s?cm2|"
               r"%)")
RE_MEAS_FACTS = re.compile(r"(?<![\w.])(<\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*" + UNITS_FACTS + r"(?![\w/])", re.I)
UNIT_CANON = {
    "f/cc": "f/cc", "fiber/cc": "f/cc", "fibers/cc": "f/cc",
    "s/mm2": "s/mm²", "s/mm^2": "s/mm²", "structure/mm2": "s/mm²", "structures/mm2": "s/mm²",
    "ppm": "ppm", "ppb": "ppb", "ppt": "ppt",
    "µg/m3": "µg/m³", "ug/m3": "µg/m³", "mg/m3": "mg/m³", "ng/m3": "ng/m³",
    "mg/kg": "mg/kg", "µg/g": "µg/g", "ug/g": "µg/g", "%": "%",
    "µg/l": "µg/L", "ug/l": "µg/L", "mg/l": "mg/L", "ng/l": "ng/L",
    "µg/ft2": "µg/ft²", "ug/ft2": "µg/ft²", "mg/ft2": "mg/ft²",
    "µg/100cm2": "µg/100cm²", "ug/100cm2": "µg/100cm²",
}
UNIT_SAMPLE_TYPE_DEFAULT = {
    "f/cc": "air", "s/mm²": "air", "µg/m³": "air", "mg/m³": "air", "ng/m³": "air",
    "mg/kg": "soil", "µg/g": "soil", "%": "bulk",
    "µg/L": "water", "mg/L": "water", "ng/L": "water",
    "µg/ft²": "wipe", "mg/ft²": "wipe", "µg/100cm²": "wipe",
    "ppm": None, "ppb": None, "ppt": None,
}
SAMPLE_TYPE_KEYWORDS = [
    ("air", re.compile(r"\bair\s*sample|ambient\s*air|personal\s*air|area\s*air\b", re.I)),
    ("bulk", re.compile(r"\bbulk\s*sample|bulk\s*material\b", re.I)),
    ("wipe", re.compile(r"\bwipe\s*sample|dust\s*wipe|surface\s*wipe\b", re.I)),
    ("dust", re.compile(r"\bsettled\s*dust|dust\s*sample\b", re.I)),
    ("water", re.compile(r"\bwater\s*sample|potable\s*water|non-?potable\b", re.I)),
    ("soil", re.compile(r"\bsoil\s*sample|sediment\s*sample\b", re.I)),
]
METHOD_PATTERNS = [
    ("PCM", re.compile(r"\bPCM\b|phase\s*contrast\s*microscopy", re.I)),
    ("TEM", re.compile(r"\bTEM\b|transmission\s*electron\s*microscopy", re.I)),
    ("PLM", re.compile(r"\bPLM\b|polarized\s*light\s*microscopy", re.I)),
    ("GC-MS", re.compile(r"\bGC[/\-]?MS\b|gas\s*chromatography", re.I)),
    ("ICP-MS", re.compile(r"\bICP[/\-]?MS\b|inductively\s*coupled\s*plasma", re.I)),
    ("AA", re.compile(r"\batomic\s*absorption\b", re.I)),
    ("XRF", re.compile(r"\bXRF\b|x-?ray\s*fluorescence", re.I)),
]
ELEMENT_SYMBOLS = {  # only elements already in entities.CONTAMINANTS — see module docstring
    "pb": "lead", "hg": "mercury", "cd": "cadmium", "cr": "chromium", "as": "arsenic",
    "be": "beryllium", "ni": "nickel", "zn": "zinc", "cu": "copper",
}
RE_LIMIT_LABEL = re.compile(
    r"(?i)\b(action\s*level|clearance\s*(?:level|criteria)|permissible\s*exposure\s*limit|"
    r"OSHA\s*PEL|PEL|reporting\s*limit|method\s*detection\s*limit|MDL|detection\s*limit)\b"
    r"\s*[:\-]?\s*(<?\s*\d+(?:,\d{3})*(?:\.\d+)?)\s*(" + UNITS_FACTS + r")?")
RE_RESULTS_HEADER = re.compile(r"(?im)^[ \t]*Results\s*\(%\)[ \t]*$")
RE_LOCATION_LINE = re.compile(r"(?im)^[ \t]*Location\s*Sampled\s*:?[ \t]*(.+)$")
RE_SAMPLEID_LINE = re.compile(r"(?im)^[ \t]*(?:DEP\s*)?Sample\s*#\s*:?[ \t]*(.+)$")
RE_DATE_ANALYZED = re.compile(r"(?im)^[ \t]*Analyzed\s*:?[ \t]*(\d{1,2}/\d{1,2}/\d{2,4})")
RE_DATE_COLLECTED = re.compile(r"(?im)^[ \t]*(?:Date\s*)?Collected\s*:?[ \t]*(\d{1,2}/\d{1,2}/\d{2,4})")
RE_TABLE_HEADER = re.compile(r"(?im)^.*\bResults?\b.*\b(?:Units?|MDL)\b.*$")
RE_LOOKS_LIKE_TABLE = re.compile(
    r"(?i)\bresults?\s*of\s*analysis\b|\bsample\s*(?:id|no\.?|#)\b|\blaborator(?:y|ies)\b|"
    r"\banalytical\s*report\b|\bcertificate\s*of\s*analysis\b|\bchain\s*of\s*custody\b|\bdetected\b")
COLUMN_ALIASES = {
    "substance": ("test description", "analyte", "parameter", "constituent", "substance", "chemical"),
    "value": ("results", "result", "conc. mean", "concentration", "value", "amount"),
    "unit": ("units", "unit", "sample unit"),
    "limit": ("mdl", "method detection limit", "reporting limit", "detection limit", "pql", "rl"),
    "method": ("method",),
    "date": ("analyzed on", "analyzed", "date analyzed", "date"),
}


def strip_watermark(text: str) -> str:
    return WATERMARK_RE.sub("", text or "")


def canon_unit(raw: str | None) -> str | None:
    if not raw:
        return None
    return UNIT_CANON.get(re.sub(r"\s+", "", raw.strip().lower()))


def normalize_substance(raw: str | None) -> str | None:
    """A cell/word -> entities.py's own contaminant gazetteer norm, or None if it isn't one of
    entities.CONTAMINANTS (see module docstring: a material name with no gazetteer match is
    dropped, never invented)."""
    if not raw:
        return None
    raw = raw.strip()
    if not raw:
        return None
    sym = ELEMENT_SYMBOLS.get(raw.lower())
    if sym:
        return sym
    m = entities_mod.RE_CONT.search(raw)
    return m.group(0).lower().replace(" ", "") if m else None


def infer_sample_type(window: str, unit: str | None) -> str | None:
    for st, rx in SAMPLE_TYPE_KEYWORDS:
        if rx.search(window):
            return st
    return UNIT_SAMPLE_TYPE_DEFAULT.get(unit) if unit else None


def detect_method(text: str) -> str | None:
    for name, rx in METHOD_PATTERNS:
        if rx.search(text):
            return name
    return None


def find_limit_near(text: str, pos: int, window: int = 250) -> tuple[float | None, str | None, str | None]:
    """(limit_value, limit_source, unit_or_None) from a limit label within `window` chars of `pos`,
    or (None, None, None). Never invents a comparison — the caller still needs a numeric `value` to
    turn this into `result`."""
    lo, hi = max(0, pos - window), min(len(text), pos + window)
    m = RE_LIMIT_LABEL.search(text[lo:hi])
    if not m:
        return None, None, None
    try:
        val = float(m.group(2).replace(",", "").lstrip("<").strip())
    except ValueError:
        return None, None, None
    return val, m.group(1).strip(), canon_unit(m.group(3))


def compare_result(value: float | None, limit_value: float | None) -> str | None:
    if value is None or limit_value is None:
        return None
    return "below" if value <= limit_value else "above"


def parse_measurement_text(raw: str) -> tuple[float | None, str | None]:
    m = RE_MEAS_FACTS.search(raw)
    if not m:
        return None, None
    unit_m = re.search(UNITS_FACTS, raw, re.I)
    value = None
    try:
        value = float(m.group(2).replace(",", ""))
    except (ValueError, TypeError):
        pass
    return value, canon_unit(unit_m.group(0)) if unit_m else None


def split_columns(line: str) -> list[str]:
    return [c.strip() for c in re.split(r"\s{2,}", line.strip()) if c.strip()]


# --------------------------------------------------------------------------- page mentions/building -

LOCATION_CONTEXT_RE = re.compile(
    r"(?i)(job\s*location|sample\s*location|location\s*sampled|premise|property\s*address|"
    r"site\s*address|sampled\s*at|address\s*sampled|location\s*of\s*sample)\s*[:\-]?\s*$")


def resolve_building_key(page_mentions: dict, text: str = "") -> str | None:
    """Strongest-signal-first, same priority places.py uses: BIN > block/lot > canonicalised address
    bbl > canonicalised address key. `place_id`-shaped ("bin:...", "bbl:...") for bin/block-lot so a
    fact's building_key lines up with `places.place_id` directly.

    Among address mentions, one immediately preceded (within 50 chars) by a "Job Location:"/
    "Sample Location:"/"Premise"/etc. label is preferred over the page's first address regardless of
    position — found live on 2026-09-14 (NYC-WTC_000096024 p4): the page's FIRST address mention was
    the testing lab's own letterhead ("10 Morris Avenue, Glen Cove, NY" — Ambient Group Inc.'s
    mailing address, not even in Manhattan), while the actual sampled building ("Job Location: 75
    Park Place") came later and lost to first-mention priority. Falls back to the plain
    first-address priority when no mention carries that context (most pages)."""
    bins = page_mentions.get("bin") or []
    if bins:
        return f"bin:{bins[0]['norm']}"
    bls = page_mentions.get("block_lot") or []
    if bls:
        try:
            b, l = bls[0]["norm"].split("/")
            return f"bbl:1{int(b):05d}{int(l):04d}"
        except ValueError:
            pass
    addrs = page_mentions.get("address") or []
    labeled = [a for a in addrs if LOCATION_CONTEXT_RE.search(text[max(0, a["start"] - 50): a["start"]])]
    for a in labeled or addrs:
        if a.get("canonical_bbl"):
            return f"bbl:{a['canonical_bbl']}"
    for a in labeled or addrs:
        if a.get("canonical_key"):
            return a["canonical_key"]
    return None


def page_lab(page_mentions: dict) -> str | None:
    labs = page_mentions.get("lab") or []
    if not labs:
        return None
    c = collections.Counter(l.get("canonical_label") or l["text"] for l in labs)
    return c.most_common(1)[0][0]


def nearest_date(page_mentions: dict, pos: int | None) -> str | None:
    dates = page_mentions.get("date") or []
    if not dates:
        return None
    if pos is None:
        return dates[0]["norm"]
    return min(dates, key=lambda d: abs(d["start"] - pos))["norm"]


def normalize_cell_date(raw: str | None) -> str | None:
    """A table cell's own date (e.g. "9/18/2001", generic_table's Tier B) -> ISO, via entities.iso()
    so it matches every other date in the corpus. None if the cell doesn't hold a recognisable date."""
    if not raw:
        return None
    m = entities_mod.RE_DATE_NUM.search(raw)
    if not m:
        return None
    return entities_mod.iso(int(m.group(3)), int(m.group(1)), int(m.group(2)))


def header_date(text: str) -> str | None:
    """"Analyzed: 07/13/02" preferred over "Date Collected: ..." for a lab result's date, ported
    inline via entities.iso() so the format matches every other date in the corpus."""
    for rx in (RE_DATE_ANALYZED, RE_DATE_COLLECTED):
        m = rx.search(text)
        if m:
            mm, dd, yy = m.group(1).split("/")
            iso = entities_mod.iso(int(yy), int(mm), int(dd))
            if iso:
                return iso
    return None


# --------------------------------------------------------------------------------------- Tier A -----

def dep_asbestos_block(doc: str, page: int, bates: str | None, text: str, page_mentions: dict,
                        building_key: str | None) -> list[dict] | None:
    if not RE_RESULTS_HEADER.search(text):
        return None
    loc_m, id_m = RE_LOCATION_LINE.search(text), RE_SAMPLEID_LINE.search(text)
    if not loc_m or not id_m:
        return None
    locations, sample_ids = split_columns(loc_m.group(1)), split_columns(id_m.group(1))
    n = len(sample_ids)
    if n == 0 or len(locations) != n:
        return None

    tail = text[RE_RESULTS_HEADER.search(text).end():]
    result_lines = []
    for ln in tail.split("\n"):
        if not ln.strip():
            if result_lines:
                break
            continue
        if re.match(r"(?i)^\s*comments\b", ln):
            break
        result_lines.append(ln)

    pair_re = re.compile(r"([A-Za-z][A-Za-z .]{1,30}?)\s*[:\-]?\s*(\d+\.?\d*|TRACE|ND|NONE\s*DETECTED|<\s*\d+\.?\d*)\b")
    per_sample: dict[int, list[tuple[str, str]]] = collections.defaultdict(list)
    for ln in result_lines:
        pairs = pair_re.findall(ln)
        if len(pairs) != n:  # only a clean N-column line is trusted — see module docstring
            continue
        for i, (sub, val) in enumerate(pairs):
            per_sample[i].append((sub.strip(), val.strip()))
    if not per_sample:
        return None

    date = header_date(text) or nearest_date(page_mentions, None)
    lab = page_lab(page_mentions)
    method = detect_method(text) or "PLM"  # this report shape's own header cites PLM/point-counting
    facts = []
    for i in range(n):
        for sub_raw, val_raw in per_sample.get(i, []):
            substance = normalize_substance(sub_raw)
            if substance is None:
                continue
            vu = val_raw.upper()
            value = None
            if vu not in ("TRACE", "ND") and "NONE" not in vu:
                try:
                    value = float(val_raw.lstrip("<"))
                except ValueError:
                    value = None
            facts.append({
                "doc": doc, "page": page, "bates": bates, "building_key": building_key,
                "substance": substance, "sample_type": "bulk", "value": value, "unit": "%",
                "date": date, "lab": lab, "method": method, "limit_value": None, "limit_source": None,
                "result": None, "sample_id": sample_ids[i], "location": locations[i],
                "confidence": 0.85, "extractor": "rules",
            })
    return facts or None


# --------------------------------------------------------------------------------------- Tier B -----

def generic_table(doc: str, page: int, bates: str | None, text: str, page_mentions: dict,
                   building_key: str | None) -> list[dict] | None:
    lines = text.split("\n")
    header_idx = next((i for i, ln in enumerate(lines) if RE_TABLE_HEADER.match(ln)), None)
    if header_idx is None:
        return None
    header_cells = split_columns(lines[header_idx])
    if len(header_cells) < 2:
        return None
    roles = []
    for cell in header_cells:
        cl = cell.lower()
        roles.append(next((r for r, aliases in COLUMN_ALIASES.items() if any(a in cl for a in aliases)), None))
    if "value" not in roles:
        return None

    page_date = header_date(text) or nearest_date(page_mentions, None)
    page_method = detect_method(text)
    facts = []
    for ln in lines[header_idx + 1: header_idx + 60]:
        if not ln.strip():
            continue
        if re.match(r"(?i)^\s*(comments?|report\s*to|received\s*by|attention)\b", ln):
            break
        cells = split_columns(ln)
        if len(cells) < 2:
            continue
        row = dict(zip(roles, cells))
        val_cell = row.get("value")
        if not val_cell:
            continue
        val_stripped = val_cell.strip().upper()
        below_mdl = bool(re.match(r"^<\s*(?:MDL|RL|DL|PQL)$", val_stripped))  # censored: "< MDL", no number of its own
        below = val_cell.strip().startswith("<")
        m = re.match(r"^<?\s*(\d+(?:,\d{3})*(?:\.\d+)?)", val_cell)
        if not m and not below_mdl and val_stripped not in ("ND", "TRACE", "NONE DETECTED"):
            continue
        substance = normalize_substance(row.get("substance"))
        if substance is None:
            continue
        value = float(m.group(1).replace(",", "")) if m else None
        unit = canon_unit(row.get("unit"))
        if unit is None:
            um = RE_MEAS_FACTS.search(val_cell)
            unit = canon_unit(re.search(UNITS_FACTS, um.group(0), re.I).group(0)) if um else None
        limit_cell = row.get("limit")
        limit_value = None
        if limit_cell:
            lm = re.match(r"^\D*(\d+(?:,\d{3})*(?:\.\d+)?)", limit_cell)
            if lm:
                try:
                    limit_value = float(lm.group(1).replace(",", ""))
                except ValueError:
                    limit_value = None
        result = "below" if below else compare_result(value, limit_value)
        facts.append({
            "doc": doc, "page": page, "bates": bates, "building_key": building_key,
            "substance": substance, "sample_type": infer_sample_type(ln, unit), "value": value, "unit": unit,
            "date": normalize_cell_date(row.get("date")) or page_date, "lab": page_lab(page_mentions),
            "method": row.get("method") or page_method,
            "limit_value": limit_value, "limit_source": "table column" if limit_value is not None else None,
            "result": result, "sample_id": None, "location": None,
            "confidence": 0.7, "extractor": "rules",
        })
    return facts or None


# --------------------------------------------------------------------------------------- Tier C -----

def page_level_pairing(doc: str, page: int, bates: str | None, text: str, page_mentions: dict,
                        building_key: str | None) -> list[dict] | None:
    conts, meas = page_mentions.get("contaminant") or [], page_mentions.get("measurement") or []
    if not conts or not meas:
        return None
    lab, date_fallback = page_lab(page_mentions), header_date(text)
    method = detect_method(text)

    def make_fact(c: dict, m: dict, confidence: float) -> dict:
        value, unit = parse_measurement_text(m["text"])
        limit_value, limit_source, _ = find_limit_near(text, m["start"])
        return {
            "doc": doc, "page": page, "bates": bates, "building_key": building_key,
            "substance": normalize_substance(c["text"]) or c["norm"],
            "sample_type": infer_sample_type(text[max(0, m["start"] - 150): m["end"] + 150], unit),
            "value": value, "unit": unit, "date": nearest_date(page_mentions, m["start"]) or date_fallback,
            "lab": lab, "method": method, "limit_value": limit_value, "limit_source": limit_source,
            "result": compare_result(value, limit_value), "sample_id": None, "location": None,
            "confidence": confidence, "extractor": "rules",
        }

    if len(conts) == 1 and len(meas) == 1:
        return [make_fact(conts[0], meas[0], 0.5)]

    pairs = []
    for m in meas:
        best = min(conts, key=lambda c: abs(c["start"] - m["start"]))
        if abs(best["start"] - m["start"]) <= 400:
            pairs.append((best, m))
    if pairs and len(pairs) <= 3:
        return [make_fact(c, m, 0.4) for c, m in pairs]
    return None


def looks_like_table(text: str) -> bool:
    """Gate for the (expensive) LLM tier: require an actual number+unit token (not just report-y
    vocabulary — "laboratory"/"detected"/"sample id" alone show up on far too many memo/form pages
    in this corpus, e.g. every DEP letter that mentions "the laboratory results"; that blew the
    budget by ~150x in testing) AND at least one of the report-shaped keywords, so a bare stray unit
    mention (rare, but possible) doesn't get sent either."""
    return bool(RE_MEAS_FACTS.search(text) and RE_LOOKS_LIKE_TABLE.search(text))


# ---------------------------------------------------------------------------------- data loading ----

def load_doctypes() -> dict[str, str]:
    out: dict[str, str] = {}
    if not DOCTYPES_JSONL.exists():
        return out
    with DOCTYPES_JSONL.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("doc") and row.get("doc_type"):
                out[row["doc"]] = row["doc_type"]
    return out


def load_page_status() -> dict[tuple[str, int], str]:
    if not PAGES_DB.exists():
        return {}
    con = sqlite3.connect(f"file:{PAGES_DB}?mode=ro", uri=True)
    out = {(doc, page): status for doc, page, status in con.execute("SELECT doc, page, status FROM pages")}
    con.close()
    return out


MENTION_LABELS = ("contaminant", "measurement", "date", "lab", "address", "bin", "block_lot")


def load_all_page_mentions() -> dict[tuple[str, int], dict[str, list[dict]]]:
    """(doc,page) -> {label: [{start,end,text,norm,canonical_key,canonical_bbl,canonical_bin}, ...]}
    for every source='regex' mention this module cares about. Loaded once, fully, into memory —
    entities.sqlite is 12MB / ~55k mentions at the corpus size this ran against (2026-09-14); revisit
    if the mirror grows enough to make that impractical."""
    out: dict[tuple[str, int], dict[str, list[dict]]] = collections.defaultdict(lambda: collections.defaultdict(list))
    if not ENTITIES_DB.exists():
        return out
    con = sqlite3.connect(f"file:{ENTITIES_DB}?mode=ro", uri=True)
    cols = {r[1] for r in con.execute("PRAGMA table_info(mentions)")}
    has_canon = "canonical_key" in cols
    sel = "canonical_key, canonical_label, canonical_bbl, canonical_bin" if has_canon else "NULL,NULL,NULL,NULL"
    q = (f"SELECT doc, page, start, \"end\", label, text, norm, {sel} FROM mentions "
         f"WHERE source='regex' AND label IN ({','.join('?' * len(MENTION_LABELS))}) ORDER BY doc, page, start")
    for doc, page, start, end, label, text, norm, ck, cl, cbbl, cbin in con.execute(q, MENTION_LABELS):
        out[(doc, page)][label].append({
            "start": start, "end": end, "text": text, "norm": norm,
            "canonical_key": ck, "canonical_label": cl, "canonical_bbl": cbbl, "canonical_bin": cbin,
        })
    con.close()
    return out


def index_text_files() -> dict[str, Path]:
    return {p.name[: -len(".pages.jsonl")]: p for p in TEXT.rglob("*.pages.jsonl")}


def doc_pages(f: Path, page_status: dict[tuple[str, int], str]) -> list[tuple[int, str | None, str]]:
    """[(page, bates, text), ...], using the shared approved-OCR selection rule — same rule doctypes.py /
    load_site_pg.py use, so facts.py reads exactly the same text the rest of the pipeline does.

    Deliberately NOT watermark-stripped, unlike doctypes.py's own doc_text(): every mention's
    start/end offset in entities.sqlite was computed by entities.py against the RAW (unstripped)
    page text, and this module indexes into `text` with those exact offsets in several places
    (resolve_building_key's location-context window, nearest_date, find_limit_near, Tier C's
    proximity pairing). Stripping the watermark here would shift every offset by the watermark's
    own length and silently misalign all of them — caught live on 2026-09-14 when
    resolve_building_key's new location-label lookback (NYC-WTC_000096024 p4) kept missing a label
    that WAS there, just not where the shifted offset pointed. None of this module's own regex tiers
    (A/B/C's header/line matching) depend on the watermark being absent."""
    out = []
    for row in effective_rows(f):
        page = int(row["page"])
        text = row.get("text") or ""
        out.append((page, row.get("bates"), text))
    return out


# ------------------------------------------------------------------------------------- LLM tier -----

FACT_SCHEMA_DESC = (
    '{"substance": string|null, "sample_type": "air"|"bulk"|"wipe"|"dust"|"water"|"soil"|null, '
    '"value": number|null, "unit": string|null, "date": "YYYY-MM-DD"|null, "lab": string|null, '
    '"method": string|null, "limit_value": number|null, "limit_source": string|null, '
    '"result": "above"|"below"|null, "sample_id": string|null, "location": string|null, '
    '"confidence": number}'
)
SYSTEM_PROMPT = (
    "You extract sample-level environmental test readings (asbestos, lead, and other contaminant "
    "measurements) from a scanned 1990s-2000s NYC government record page. Only extract a reading "
    "that has BOTH a substance/contaminant AND a numeric value with a unit stated on the page — "
    "never infer or guess a value that is not written down. `result` (above/below a limit) is set "
    "ONLY when the page itself states a limit value AND the comparison is unambiguous from the "
    "text — leave it null otherwise; never render a health judgment of your own. `date` must be "
    "ISO (YYYY-MM-DD) and only when a real date is stated. If the page has no sample-level readings, "
    "return an empty array for it. Respond with ONLY a JSON array, no prose, no markdown fences, one "
    'object per input page in the same order: {"id": <int>, "facts": [' + FACT_SCHEMA_DESC + ", ...]}."
)


def _load_api_key() -> str:
    key = KEY_FILE.read_text().strip()
    if not key:
        raise RuntimeError(f"{KEY_FILE} is empty")
    return key


def _load_cache() -> dict:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            return {}
    return {}


def _save_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache))


def _build_prompt(items: list[dict]) -> str:
    parts = []
    for it in items:
        parts.append(f'--- id {it["id"]} (doc {it["doc"]} page {it["page"]}) ---\n{it["text"]}')
    return "\n\n".join(parts)


def _parse_response(text: str) -> list[dict]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text)


def complete_date(value) -> str | None:
    """A date column needs a known day; never invent one for a partial model date."""
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return datetime.date.fromisoformat(value).isoformat()
    except ValueError:
        return None


def llm_extract(candidates: list[dict], page_mentions_by_doc_page: dict, budget_usd: float) -> tuple[list[dict], dict]:
    """`candidates`: [{doc,page,bates,text,building_key}, ...]. Returns (facts, usage)."""
    usage = {"candidates": len(candidates), "cache_hits": 0, "api_calls": 0, "input_tokens": 0,
              "output_tokens": 0, "cost_usd": 0.0, "facts_extracted": 0, "stopped_on_budget": False}
    facts: list[dict] = []
    if not candidates:
        return facts, usage

    cache = _load_cache()
    to_ask, from_cache = [], {}
    for i, c in enumerate(candidates):
        trimmed = c["text"][:LLM_MAX_CHARS]
        h = hashlib.sha1(trimmed.encode("utf-8", "replace")).hexdigest()
        c["cache_key"], c["trimmed"] = h, trimmed
        if h in cache:
            from_cache[i] = cache[h]
            usage["cache_hits"] += 1
        else:
            to_ask.append({"id": i, **c})

    def apply_result(i: int, result_facts: list[dict]) -> None:
        c = candidates[i]
        for rf in result_facts or []:
            if not isinstance(rf, dict) or not rf.get("substance"):
                continue
            if rf.get("value") is None and rf.get("limit_value") is None and not rf.get("result"):
                continue  # no reading and no censored-below-limit signal either — nothing to keep
            unit = canon_unit(rf.get("unit")) or (rf.get("unit") or None)
            facts.append({
                "doc": c["doc"], "page": c["page"], "bates": c["bates"], "building_key": c["building_key"],
                "substance": normalize_substance(rf.get("substance")) or rf.get("substance"),
                "sample_type": rf.get("sample_type"), "value": rf.get("value"), "unit": unit,
                "date": complete_date(rf.get("date")), "lab": rf.get("lab"), "method": rf.get("method"),
                "limit_value": rf.get("limit_value"), "limit_source": rf.get("limit_source"),
                "result": rf.get("result") if rf.get("result") in ("above", "below") else None,
                "sample_id": rf.get("sample_id"), "location": rf.get("location"),
                "confidence": min(0.6, float(rf.get("confidence") or 0.5)), "extractor": "llm",
            })
            usage["facts_extracted"] += 1

    for i, result_facts in from_cache.items():
        apply_result(i, result_facts)

    if to_ask:
        client = None
        for batch_num, start in enumerate(range(0, len(to_ask), LLM_BATCH_SIZE)):
            if usage["cost_usd"] >= budget_usd:
                usage["stopped_on_budget"] = True
                break
            batch = to_ask[start:start + LLM_BATCH_SIZE]
            if client is None:
                import anthropic
                client = anthropic.Anthropic(api_key=_load_api_key())
            items = [{"id": b["id"], "doc": b["doc"], "page": b["page"], "text": b["trimmed"]} for b in batch]
            try:
                resp = client.messages.create(
                    model=MODEL, max_tokens=LLM_MAX_TOKENS, system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": _build_prompt(items)}])
            except Exception as e:
                print(f"facts.py llm_extract: batch at {start} API call failed ({e}); leaving it unresolved", file=sys.stderr)
                continue
            # Count the spend regardless of what happens next — the call already cost real money
            # even if the response doesn't parse (a truncated `max_tokens` cutoff still bills its
            # output tokens). Tracking cost only on a successful parse (the first version of this
            # loop did) let a run of parse failures spend well past `budget_usd` while the tracked
            # total never moved — caught live on 2026-09-14's first real run.
            usage["api_calls"] += 1
            usage["input_tokens"] += resp.usage.input_tokens
            usage["output_tokens"] += resp.usage.output_tokens
            usage["cost_usd"] += (resp.usage.input_tokens * PRICE_IN_PER_MTOK
                                   + resp.usage.output_tokens * PRICE_OUT_PER_MTOK) / 1_000_000
            try:
                parsed = _parse_response("".join(bl.text for bl in resp.content if bl.type == "text"))
            except Exception as e:
                note = " (response hit max_tokens, likely truncated)" if resp.stop_reason == "max_tokens" else ""
                print(f"facts.py llm_extract: batch at {start} JSON parse failed ({e}){note}; leaving it unresolved",
                      file=sys.stderr)
                continue
            by_id = {r.get("id"): r.get("facts") or [] for r in parsed if isinstance(r, dict)}
            for b in batch:
                result_facts = by_id.get(b["id"], [])
                cache[b["cache_key"]] = result_facts
                apply_result(b["id"], result_facts)
            if batch_num % 15 == 14:  # periodic save — a long run interrupted partway keeps its progress
                _save_cache(cache)
        _save_cache(cache)

    usage["cost_usd"] = round(usage["cost_usd"], 6)
    return facts, usage


# --------------------------------------------------------------------------------------- output -----

SCHEMA = """
CREATE TABLE facts(
  id INTEGER PRIMARY KEY, doc TEXT, page INT, bates TEXT, building_key TEXT, substance TEXT,
  sample_type TEXT, value REAL, unit TEXT, date TEXT, lab TEXT, method TEXT, limit_value REAL,
  limit_source TEXT, result TEXT, sample_id TEXT, location TEXT, confidence REAL, extractor TEXT
);
CREATE INDEX facts_building ON facts(building_key);
CREATE INDEX facts_substance ON facts(substance);
CREATE INDEX facts_doc ON facts(doc, page);
"""
COLS = ["doc", "page", "bates", "building_key", "substance", "sample_type", "value", "unit", "date",
        "lab", "method", "limit_value", "limit_source", "result", "sample_id", "location",
        "confidence", "extractor"]


def write_outputs(facts: list[dict], out_jsonl: Path, out_sqlite: Path) -> None:
    out_jsonl.parent.mkdir(parents=True, exist_ok=True)
    tmp_jsonl = out_jsonl.with_suffix(out_jsonl.suffix + ".tmp")
    with tmp_jsonl.open("w") as f:
        for row in facts:
            f.write(json.dumps({k: row.get(k) for k in COLS}) + "\n")
    tmp_jsonl.replace(out_jsonl)

    tmp_sqlite = out_sqlite.with_suffix(out_sqlite.suffix + ".tmp")
    if tmp_sqlite.exists():
        tmp_sqlite.unlink()
    con = sqlite3.connect(tmp_sqlite)
    con.executescript(SCHEMA)
    con.executemany(
        f"INSERT INTO facts ({','.join(COLS)}) VALUES ({','.join('?' * len(COLS))})",
        [tuple(row.get(k) for k in COLS) for row in facts])
    con.commit()
    con.close()
    os.replace(tmp_sqlite, out_sqlite)


# ------------------------------------------------------------------------------------------ main ----

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_JSONL))
    ap.add_argument("--sqlite", default=str(OUT_SQLITE))
    ap.add_argument("--budget-usd", type=float, default=DEFAULT_BUDGET_USD)
    ap.add_argument("--no-llm", action="store_true", help="skip Tier D entirely (rules only)")
    ap.add_argument("--limit-docs", type=int, default=0, help="process only the first N target documents (smoke test)")
    args = ap.parse_args()

    t0 = time.time()
    doctypes = load_doctypes()
    page_status = load_page_status()
    mentions = load_all_page_mentions()
    files_by_doc = index_text_files()

    target_docs = sorted(d for d, dt in doctypes.items() if dt in TARGET_DOC_TYPES and d in files_by_doc)
    target_docs_set = set(target_docs)
    pages_with_both: dict[str, list[int]] = collections.defaultdict(list)
    for (d, p), pm in mentions.items():
        if "contaminant" in pm and "measurement" in pm and d not in target_docs_set:
            pages_with_both[d].append(p)
    extra_docs = sorted(pages_with_both)
    if args.limit_docs:
        target_docs = target_docs[: args.limit_docs]

    facts: list[dict] = []
    tier_counts: collections.Counter = collections.Counter()
    llm_candidates: list[dict] = []
    pages_seen = 0

    def process_page(doc: str, page: int, bates: str | None, text: str, llm_eligible: bool) -> None:
        nonlocal pages_seen
        pages_seen += 1
        pm = mentions.get((doc, page), {})
        bkey = resolve_building_key(pm, text)
        for tier_name, fn in (("A", dep_asbestos_block), ("B", generic_table), ("C", page_level_pairing)):
            result = fn(doc, page, bates, text, pm, bkey)
            if result:
                facts.extend(result)
                tier_counts[tier_name] += 1
                return
        if llm_eligible and looks_like_table(text) and not args.no_llm:
            llm_candidates.append({"doc": doc, "page": page, "bates": bates, "text": text, "building_key": bkey})

    # The LLM tier (Tier D) is restricted to lab_report/chain_of_custody — "form" stays eligible for
    # the free rule tiers (A/B/C) but not the paid one: it is the largest doc_type bucket (1,111 docs)
    # and, on a live budget-usd=0 dry run, contributed a disproportionate share of "looks like a
    # table" false positives (checkbox/numbered-field forms that mention a unit or "laboratory" in
    # passing) relative to genuine sample tables — see looks_like_table()'s own docstring for the
    # first (larger) fix; this is the second, cheaper to get right than a better regex.
    LLM_DOC_TYPES = {"lab_report", "chain_of_custody"}

    for doc in target_docs:
        f = files_by_doc[doc]
        for page, bates, text in doc_pages(f, page_status):
            process_page(doc, page, bates, text, doctypes.get(doc) in LLM_DOC_TYPES)

    for doc in extra_docs:
        f = files_by_doc.get(doc)
        if not f:
            continue
        pages_by_num = {pg: (b, t) for pg, b, t in doc_pages(f, page_status)}
        for p in pages_with_both[doc]:
            hit = pages_by_num.get(p)
            if hit is None:
                continue
            bates, page_text = hit
            process_page(doc, p, bates, page_text, False)

    llm_facts: list[dict] = []
    llm_usage: dict = {}
    if llm_candidates and not args.no_llm:
        # A hard $3 budget can only ever afford a fraction of ~8.7k candidate pages (a handful of
        # 300-600 page lab binders dominate that count) — shuffle with a fixed seed so the budget
        # cutoff samples across many different documents/buildings/labs instead of exhausting itself
        # on whichever single binder happens to sort first.
        random.Random(34).shuffle(llm_candidates)
        llm_facts, llm_usage = llm_extract(llm_candidates, mentions, args.budget_usd)
        facts.extend(llm_facts)
        tier_counts["D"] = len({(f["doc"], f["page"]) for f in llm_facts})

    write_outputs(facts, Path(args.out), Path(args.sqlite))

    buildings_with_reading = len({f["building_key"] for f in facts if f["building_key"]})
    substances = collections.Counter(f["substance"] for f in facts if f["substance"])
    summary = {
        "target_documents": len(target_docs), "extra_documents_with_contaminant_and_measurement": len(extra_docs),
        "pages_scanned": pages_seen, "facts": len(facts),
        "facts_by_extractor": dict(collections.Counter(f["extractor"] for f in facts)),
        "pages_resolved_by_tier": dict(tier_counts),
        "llm_candidates": len(llm_candidates), "llm_usage": llm_usage,
        "buildings_with_at_least_one_reading": buildings_with_reading,
        "top_substances": substances.most_common(10),
        "seconds": round(time.time() - t0, 1),
    }
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
