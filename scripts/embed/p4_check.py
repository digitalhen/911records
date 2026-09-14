#!/usr/bin/env python3
"""p4_check.py — issue #34 sample-level facts quality check. Local only; reads
data/embed/p4-facts.sqlite (facts.py's output, never modified here) and data/text/**/<bates>.pages.
jsonl. Samples 40 facts (stratified across extractors so both 'rules' and 'llm' are represented,
fixed seed for reproducibility), prints each beside the page excerpt it came from, and writes
data/embed/p4-report.md with:
  - counts by extractor and by rule tier (Tier A/B/C — inferred from confidence, since facts.py
    doesn't persist which tier produced a 'rules' row: 0.85 => A, 0.7 => B, 0.4/0.5 => C)
  - an AUTOMATED precision proxy per extractor: does the fact's substance word and its value (or
    limit_value, for a censored/below-limit reading) actually appear, verbatim, on the page the
    fact cites? This is a sanity floor, not a substitute for Henry's own read of the 40 examples
    below it — a fact can pass this check and still be wrong (wrong sample paired with the wrong
    substance on a busy page), but it cannot pass while citing text that plain isn't there.
  - substance/building coverage: how many distinct buildings now have >=1 reading, overall and for
    the flagship query ("addresses impacted by asbestos") specifically, plus every other substance
    with at least one building.

Never renders a health verdict — this script reports what fraction of `result` values ('above'/
'below') a page's own stated limit already determined, never a judgment of its own.

Usage: .venv/bin/python scripts/embed/p4_check.py [--db data/embed/p4-facts.sqlite] [--sample 40]
"""
from __future__ import annotations

import argparse
import collections
import json
import random
import re
import sqlite3
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_DB = REPO / "data" / "embed" / "p4-facts.sqlite"
TEXT = REPO / "data" / "text"
REPORT = REPO / "data" / "embed" / "p4-report.md"

import sys as _sys  # noqa: E402
_sys.path.insert(0, str(Path(__file__).resolve().parent))
import facts as facts_mod  # noqa: E402  reuse ELEMENT_SYMBOLS so "Hg" corroborates "mercury"

# Deliberately WIDER than facts.ELEMENT_SYMBOLS (which is capped at the metals already in
# entities.CONTAMINANTS, since that's the only substance vocabulary the RULES tiers are allowed to
# use — see facts.py's module docstring). The LLM tier is explicitly allowed to name a substance
# entities.py's gazetteer doesn't track (e.g. "Manganese", "Selenium", "Tin" off an ICP-MS metals
# printout that only ever prints the symbol: "Mn", "Se", "Sn") — checking those against just the
# word "manganese" fails even though the reading is correct, because the page never spells it out.
# This full periodic-table-adjacent table is ONLY for this check's own corroboration; it must never
# be imported back into facts.py's extraction path (that would let the rules tiers invent substances
# outside the gazetteer the module docstring documents).
SYMBOL_BY_SUBSTANCE = {v: k for k, v in facts_mod.ELEMENT_SYMBOLS.items()}
SYMBOL_BY_SUBSTANCE.update({
    "silver": "ag", "aluminum": "al", "aluminium": "al", "barium": "ba", "calcium": "ca",
    "cobalt": "co", "iron": "fe", "potassium": "k", "lithium": "li", "magnesium": "mg",
    "manganese": "mn", "molybdenum": "mo", "sodium": "na", "antimony": "sb", "selenium": "se",
    "tin": "sn", "strontium": "sr", "thallium": "tl", "vanadium": "v", "titanium": "ti",
})

TIER_BY_CONFIDENCE = {0.85: "A (DEP asbestos columnar block)", 0.7: "B (generic lab-report table)",
                       0.5: "C (page-level pairing, single)", 0.4: "C (page-level pairing, nearest)"}


def tier_label(extractor: str, confidence: float | None) -> str:
    if extractor == "llm":
        return "D (LLM last resort)"
    return TIER_BY_CONFIDENCE.get(round(confidence, 2) if confidence is not None else None, f"rules (conf={confidence})")


def index_text_files() -> dict[str, Path]:
    return {p.name[: -len(".pages.jsonl")]: p for p in TEXT.rglob("*.pages.jsonl")}


def page_text(files_by_doc: dict[str, Path], doc: str, page: int) -> str | None:
    f = files_by_doc.get(doc)
    if not f:
        return None
    for line in f.open():
        if not line.strip():
            continue
        row = json.loads(line)
        if int(row["page"]) == page:
            return row.get("text") or ""
    return None


def excerpt_around(text: str, needle: str | None, width: int = 350) -> str:
    if needle:
        m = re.search(re.escape(needle), text, re.I)
        if m:
            lo, hi = max(0, m.start() - width), min(len(text), m.end() + width)
            return ("…" if lo else "") + text[lo:hi].strip() + ("…" if hi < len(text) else "")
    return text[: width * 2].strip() + ("…" if len(text) > width * 2 else "")


def format_number(v: float) -> list[str]:
    """A few plausible verbatim spellings of a float as it might appear on the page (1.0 -> "1",
    "1.0"; 1.1 -> "1.1"), for the corroboration check below."""
    out = {str(v)}
    if v == int(v):
        out.add(str(int(v)))
    out.add(f"{v:.1f}")
    out.add(f"{v:.2f}")
    return list(out)


def corroborated(fact: dict, text: str | None) -> bool | None:
    """True/False if the page text is available and we can check; None if the page text couldn't be
    loaded (excluded from the precision denominator, not counted as a failure).

    Substance matching accepts either the gazetteer word itself OR, for the handful of metals
    entities.CONTAMINANTS covers by name (lead, mercury, ...), the periodic-table symbol a lab
    table's own column header actually uses ("Hg", "Pb", ...) — a real table almost never spells
    out "mercury", so requiring the word alone made the LLM tier look far worse than it is on a
    first pass of this check (2% "corroborated") until this fallback was added."""
    if text is None:
        return None
    ok = True
    substance = fact.get("substance")
    if substance:
        words = re.findall(r"[a-z]+", substance.lower())  # a gazetteer norm has no spaces ("carbonmonoxide")
        word_hit = any(w in text.lower() for w in words if len(w) >= 3) if words else True  # keeps "pcb"/"pah"/"voc"
        symbol = SYMBOL_BY_SUBSTANCE.get(substance.lower())
        symbol_hit = bool(symbol and re.search(r"\b" + re.escape(symbol.capitalize()) + r"\b", text))
        ok = word_hit or symbol_hit
    value = fact.get("value")
    if ok and value is not None:
        ok = any(v in text for v in format_number(value))
    elif ok and fact.get("limit_value") is not None:
        ok = any(v in text for v in format_number(fact["limit_value"]))
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--sample", type=int, default=40)
    ap.add_argument("--seed", type=int, default=34, help="fixed seed (issue #34) for a reproducible sample")
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"error: {db_path} does not exist — run scripts/embed/facts.py first")
        return 1

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cols = [r[1] for r in con.execute("PRAGMA table_info(facts)")]
    rows = [dict(zip(cols, r)) for r in con.execute(f"SELECT {','.join(cols)} FROM facts")]
    con.close()

    if not rows:
        print("no facts in the database — nothing to check")
        REPORT.write_text("# P4 facts check (issue #34)\n\nNo facts extracted.\n")
        return 0

    files_by_doc = index_text_files()

    by_extractor = collections.Counter(r["extractor"] for r in rows)
    by_tier = collections.Counter(tier_label(r["extractor"], r["confidence"]) for r in rows)

    # ---- automated corroboration proxy, over the FULL set (not just the printed sample) ----
    corrob_by_extractor: dict[str, list[bool]] = collections.defaultdict(list)
    text_cache: dict[tuple, str | None] = {}
    for r in rows:
        key = (r["doc"], r["page"])
        if key not in text_cache:
            text_cache[key] = page_text(files_by_doc, r["doc"], r["page"])
        c = corroborated(r, text_cache[key])
        if c is not None:
            corrob_by_extractor[r["extractor"]].append(c)

    precision_lines = []
    for extractor in sorted(by_extractor):
        checked = corrob_by_extractor.get(extractor, [])
        if checked:
            rate = sum(checked) / len(checked)
            precision_lines.append(f"| {extractor} | {by_extractor[extractor]} | {len(checked)} | {rate:.0%} |")
        else:
            precision_lines.append(f"| {extractor} | {by_extractor[extractor]} | 0 | n/a |")

    # ---- coverage: buildings with >=1 reading, overall and per substance ----
    buildings_by_substance: dict[str, set] = collections.defaultdict(set)
    all_buildings: set = set()
    for r in rows:
        if r["building_key"]:
            all_buildings.add(r["building_key"])
            if r["substance"]:
                buildings_by_substance[r["substance"]].add(r["building_key"])
    substance_coverage = sorted(((s, len(b)) for s, b in buildings_by_substance.items()), key=lambda x: -x[1])

    result_counts = collections.Counter(r["result"] for r in rows if r["result"])

    # ---- 40-fact sample, stratified across extractors present ----
    random.seed(args.seed)
    by_ext_rows: dict[str, list[dict]] = collections.defaultdict(list)
    for r in rows:
        by_ext_rows[r["extractor"]].append(r)
    n_ext = len(by_ext_rows) or 1
    per_ext = max(1, args.sample // n_ext)
    sample: list[dict] = []
    for ext, ext_rows in by_ext_rows.items():
        sample.extend(random.sample(ext_rows, min(per_ext, len(ext_rows))))
    if len(sample) < args.sample:
        remaining = [r for r in rows if r not in sample]
        sample.extend(random.sample(remaining, min(args.sample - len(sample), len(remaining))))
    sample = sample[: args.sample]

    lines = ["# P4 facts check (issue #34)", "", f"DB: `{db_path}`", f"Total facts: {len(rows)}", ""]
    lines.append("## Counts by extractor / tier")
    lines.append("")
    lines.append("| extractor | n facts |")
    lines.append("|---|---:|")
    for ext, n in by_extractor.most_common():
        lines.append(f"| {ext} | {n} |")
    lines.append("")
    lines.append("| tier | n facts |")
    lines.append("|---|---:|")
    for tier, n in by_tier.most_common():
        lines.append(f"| {tier} | {n} |")

    lines.append("")
    lines.append("## Automated precision proxy (substance word + value/limit found verbatim on the cited page)")
    lines.append("")
    lines.append("Not a substitute for reading the sample below — a fact can pass this and still pair the wrong "
                  "sample with the wrong substance on a busy page. It's a floor: it cannot pass while citing "
                  "text that isn't on the page at all.")
    lines.append("")
    lines.append("| extractor | n facts | n checked (page text found) | corroborated |")
    lines.append("|---|---:|---:|---:|")
    lines.extend(precision_lines)

    lines.append("")
    lines.append("## `result` (above/below a page-stated limit) — never a health verdict, only what the page itself says")
    lines.append("")
    lines.append(f"above: {result_counts.get('above', 0)}, below: {result_counts.get('below', 0)}, "
                  f"none-stated: {len(rows) - sum(result_counts.values())}")

    lines.append("")
    lines.append("## Building coverage")
    lines.append("")
    lines.append(f"Distinct buildings with >=1 reading (any substance): **{len(all_buildings)}**")
    lines.append("")
    lines.append("| substance | n buildings with >=1 reading |")
    lines.append("|---|---:|")
    for s, n in substance_coverage:
        lines.append(f"| {s} | {n} |")

    lines.append("")
    lines.append(f"## {len(sample)} sampled facts with page excerpt (seed={args.seed})")
    lines.append("")
    print(f"=== {len(sample)} sampled facts (seed={args.seed}) ===")
    for r in sample:
        text = text_cache.get((r["doc"], r["page"]))
        needle = r.get("substance") or (str(r["value"]) if r.get("value") is not None else None)
        exc = excerpt_around(text or "", needle) if text else "(page text not found)"
        head = (f"{r['doc']} p{r['page']} ({r.get('bates')}) — {r.get('substance')} "
                f"{r.get('value')} {r.get('unit') or ''} — building={r.get('building_key')} "
                f"tier={tier_label(r['extractor'], r['confidence'])} result={r.get('result')}")
        print(head)
        print(f"    {exc[:300]}")
        lines.append(f"### {head}")
        lines.append("")
        lines.append(f"> {exc}")
        lines.append("")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n")
    print(f"\nwrote {REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
