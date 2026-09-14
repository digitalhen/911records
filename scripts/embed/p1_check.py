#!/usr/bin/env python3
"""p1_check.py — issue #19 canonicalisation check. Local only; reads a COPY of entities.sqlite
(never the live one the production loop owns) and never writes to it. Reports, for 25 random
canonical addresses with >=2 raw variants, the canonical label + its variants, and before/after
entity counts (distinct raw spelling vs. distinct canonical_key) for address/lab/contractor.
Writes data/embed/p1-report.md.

Usage: .venv/bin/python scripts/embed/p1_check.py [--db data/embed/p1-entities.sqlite]
"""
from __future__ import annotations

import argparse
import random
import sqlite3
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_DB = REPO / "data" / "embed" / "p1-entities.sqlite"
REPORT = REPO / "data" / "embed" / "p1-report.md"
LABELS = ("address", "lab", "contractor")


def before_after(con: sqlite3.Connection, label: str) -> tuple[int, int, int]:
    """(distinct raw norm, distinct canonical_key, rows without a canonical_key)."""
    before = con.execute("SELECT count(DISTINCT norm) FROM mentions WHERE label=?", (label,)).fetchone()[0]
    after = con.execute("SELECT count(DISTINCT canonical_key) FROM mentions WHERE label=? AND canonical_key IS NOT NULL",
                         (label,)).fetchone()[0]
    missing = con.execute("SELECT count(*) FROM mentions WHERE label=? AND canonical_key IS NULL", (label,)).fetchone()[0]
    return before, after, missing


def roll_match_breakdown(con: sqlite3.Connection) -> dict:
    """How many OCR address mentions (and distinct raw spellings) matched the Prospect property-
    roll gazetteer exactly, fuzzily, or not at all (canonical_bbl IS NULL — either the roll doesn't
    cover that house number/ZIP footprint, or entities.py --canonicalise ran without a gazetteer
    CSV present)."""
    rows = con.execute(
        "SELECT canonical_bbl IS NOT NULL, canonical_confidence, count(*), count(DISTINCT norm) "
        "FROM mentions WHERE label='address' AND canonical_key IS NOT NULL GROUP BY 1,2"
    ).fetchall()
    out = {"roll_exact": [0, 0], "roll_fuzzy": [0, 0], "no_roll_match": [0, 0]}
    for has_bbl, conf, n_mentions, n_raw in rows:
        if has_bbl and conf == 1.0:
            bucket = "roll_exact"
        elif has_bbl:
            bucket = "roll_fuzzy"
        else:
            bucket = "no_roll_match"
        out[bucket][0] += n_mentions
        out[bucket][1] += n_raw
    return {k: {"mentions": v[0], "distinct_raw_spellings": v[1]} for k, v in out.items()}


def multi_variant_addresses(con: sqlite3.Connection) -> list[tuple[str, str, list[tuple[str, int]], int]]:
    """(canonical_key, canonical_label, [(raw, count), ...] desc, n_docs) for every address
    canonical_key with >= 2 distinct raw spellings."""
    rows = con.execute(
        "SELECT canonical_key, canonical_label, text, count(*) c, count(DISTINCT doc) "
        "FROM mentions WHERE label='address' AND canonical_key IS NOT NULL "
        "GROUP BY canonical_key, text"
    ).fetchall()
    by_key: dict[str, dict] = {}
    for ckey, clabel, text, c, _ in rows:
        e = by_key.setdefault(ckey, {"label": clabel, "variants": {}, "docs": set()})
        e["variants"][text] = e["variants"].get(text, 0) + c
    docs_by_key = dict(con.execute(
        "SELECT canonical_key, count(DISTINCT doc) FROM mentions WHERE label='address' AND canonical_key IS NOT NULL "
        "GROUP BY canonical_key"))
    out = []
    for ckey, e in by_key.items():
        if len(e["variants"]) >= 2:
            variants = sorted(e["variants"].items(), key=lambda kv: -kv[1])
            out.append((ckey, e["label"], variants, docs_by_key.get(ckey, 0)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--sample", type=int, default=25)
    ap.add_argument("--seed", type=int, default=19, help="fixed seed (issue #19) for a reproducible sample")
    args = ap.parse_args()

    db_path = Path(args.db)
    if db_path.resolve() == (REPO / "data" / "embed" / "entities.sqlite").resolve():
        print("refusing to read the live entities.sqlite — point --db at a copy (e.g. p1-entities.sqlite)")
        return 1
    if not db_path.exists():
        print(f"error: {db_path} does not exist — copy it first: "
              f"cp data/embed/entities.sqlite {DEFAULT_DB} && "
              f".venv/bin/python scripts/embed/entities.py --canonicalise --db {DEFAULT_DB}")
        return 1

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cols = {r[1] for r in con.execute("PRAGMA table_info(mentions)")}
    if "canonical_key" not in cols:
        print("error: mentions has no canonical_key column — run entities.py --canonicalise on this copy first")
        return 1

    lines = ["# P1 canonicalisation check (issue #19)", "", f"DB: `{db_path}`", ""]
    lines.append("## Before/after entity counts (distinct raw spelling vs. distinct canonical entity)")
    lines.append("")
    lines.append("| label | before (distinct raw) | after (distinct canonical) | collapsed | still uncanonicalised |")
    lines.append("|---|---:|---:|---:|---:|")
    print("=== before/after ===")
    for label in LABELS:
        before, after, missing = before_after(con, label)
        collapsed = before - after
        lines.append(f"| {label} | {before} | {after} | {collapsed} | {missing} |")
        print(f"{label:12} before={before:5} after={after:5} collapsed={collapsed:4} still_null={missing}")

    breakdown = roll_match_breakdown(con)
    lines.append("")
    lines.append("## Prospect property-roll gazetteer match (issue #19 follow-up)")
    lines.append("")
    lines.append("| | mentions | distinct raw spellings |")
    lines.append("|---|---:|---:|")
    print("\n=== roll gazetteer match breakdown (address mentions) ===")
    for bucket, label in (("roll_exact", "matched the roll exactly"),
                           ("roll_fuzzy", "matched the roll fuzzily"),
                           ("no_roll_match", "no roll match (frequency-seed fallback)")):
        b = breakdown[bucket]
        lines.append(f"| {label} | {b['mentions']} | {b['distinct_raw_spellings']} |")
        print(f"{label:45} mentions={b['mentions']:5} distinct_raw={b['distinct_raw_spellings']}")

    candidates = multi_variant_addresses(con)
    print(f"\naddress canonical entities with >=2 raw variants: {len(candidates)}")
    random.seed(args.seed)
    sample = random.sample(candidates, min(args.sample, len(candidates)))
    sample.sort(key=lambda t: -len(t[2]))

    lines.append("")
    lines.append(f"## {len(sample)} random canonical addresses with >=2 variants (seed={args.seed})")
    lines.append("")
    print(f"\n=== {len(sample)} random canonical addresses (seed={args.seed}) ===")
    for ckey, label, variants, n_docs in sample:
        variant_str = ", ".join(f"{t!r} ({c})" for t, c in variants)
        print(f"- {label}  [{ckey}]  {len(variants)} variants, {n_docs} docs")
        print(f"    {variant_str}")
        lines.append(f"- **{label}** (`{ckey}`, {len(variants)} variants, {n_docs} docs): {variant_str}")

    laf = [c for c in candidates if c[0] == "address:295-lafayette-street"]
    lines.append("")
    lines.append("## The 295 Lafayette Street case")
    lines.append("")
    if laf:
        ckey, label, variants, n_docs = laf[0]
        variant_str = ", ".join(f"{t!r} ({c})" for t, c in variants)
        msg = (f"All {len(variants)} raw OCR spellings of 295 Lafayette Street collapse to one "
               f"entity `{ckey}` (\"{label}\"), {n_docs} documents: {variant_str}")
        print(f"\n=== 295 Lafayette ===\n{msg}")
        lines.append(msg)
    else:
        msg = "295 Lafayette Street not found as a multi-variant canonical address in this DB."
        print(msg)
        lines.append(msg)

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n")
    print(f"\nwrote {REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
