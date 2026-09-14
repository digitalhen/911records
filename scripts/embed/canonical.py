#!/usr/bin/env python3
"""canonical.py — canonicalise OCR-noisy address, lab and contractor mentions (issue #19).

Stdlib only. Pure functions over the frequency counts entities.py already has in `mentions`; no
DB access here (entities.py does the querying/updating; p1_check.py imports this module directly
for the before/after report). Nothing here contacts the network.

## Addresses

`canonicalize_addresses(counts)` takes {raw address mention text -> occurrence count} (as already
captured by entities.py's RE_ADDR/RE_BROADWAY, e.g. "295 Lafayette Street", "295 Lafayatte St.")
and returns {raw text -> (canonical_key, canonical_label, confidence, bbl, bin, method)} — see
`canonicalize_addresses()`'s own docstring for `method` ('exact'|'roll'|'fuzzy'; a fourth value,
'llm', is added only by the separate last-resort pass in `canonical_llm.py`).

Steps:
  1. `normalize_street()` ports Prospect's `lib/address/normalize.ts` `normalizeStreet()` word-for-
     word (STREET_WORDS table, ordinal-suffix stripping, the "ST"-only-expands-as-last-token rule)
     plus the two street types entities.py's own STREET_T regex adds that Prospect's roll never
     needed (Slip, Way).
  2. Split house number from street (`split_house_street()`). **House number is always matched
     exactly** — "215 Lafayette" and "295 Lafayette" are never merged, no matter how close the
     street spelling is.
  3. Within one house number, group by the normalized street's trailing TYPE word (Street/Avenue/
     ...). **Street type is canonicalised, never dropped or merged across types** — "295 Lafayette
     Street" and a hypothetical "295 Lafayette Avenue" stay separate entities.
  4. Within one (house number, type) group, the highest-frequency street-name spelling is the
     seed. If its total count >= 5, every other spelling in the group is matched against it: exact
     (post-normalization) -> 1.0; Damerau-Levenshtein <= 2 -> 0.9; OCR-confusion-aware distance
     <= 3 (only tried for names >= 6 chars, `OCR_MIN_LEN` — a short name has too little signal for
     a fuzzy match) -> 0.75. Anything that doesn't come within threshold of the seed keeps its own
     normalized spelling as its own canonical entry (still confidence 1.0 for *its own* subgroup —
     it did not merge into anything, it did not fail to merge either). If the group's best count
     never reaches 5, the whole group is "seed-only": every member gets confidence 0.5, because
     there was never enough independent corroboration to trust the merge. **A candidate is never
     matched, at any tier, when both names carry a digit token and the tokens differ** ("EAST 45"
     vs "EAST 4") — a numbered street's number IS the street name, so that guard applies before the
     distance check even runs (`_match_tier`).
  5. `canonical_key = f"address:{house_num}-{slug(seed street)}"`, `canonical_label` is the seed
     spelling in Title Case ("295 Lafayette Street").

## The property-roll gazetteer (issue #19 follow-up, Henry 2026-09-14)

`load_gazetteer()` reads `data/embed/gazetteer-prospect.csv`, a one-time export of Prospect's property
roll (`scripts/embed/export_prospect_gazetteer.py`, run by an operator — nothing in this module or
in entities.py ever talks to the Prospect database itself). When a gazetteer is passed to
`canonicalize_addresses()`, it is tried FIRST for every (house number, street type) group: an exact
or fuzzy (same distance rules as the frequency method) match against the roll's own street spelling
for that house number is authoritative, and the resulting canonical entity carries the roll's BBL
(and BIN, when the roll has one) so `places.py` can resolve a building from it directly.

**The roll does not cover everything, so the frequency-seed method (above) stays as a fallback**
for any raw spelling that doesn't match the roll at its house number: the export is restricted to
nine lower-Manhattan ZIPs (Henry's instruction), and plenty of addresses mentioned in these
records are NOT in that footprint at all — the flagship case, "295 Lafayette Street", is a lab/
contractor mailing address in NoHo (ZIP 10012), north of Canal Street and outside every ZIP in the
export. Falling back keeps that merge working; only the roll-matched rows get a BBL/BIN attached.

## Labs and contractors

`canonicalize_orgs(kind, counts)` (kind = "lab" | "contractor") strips punctuation and folds a
known suffix family to one canonical suffix (Laboratory/Laboratories/Labs -> "Laboratory"; Inc./
Inc/Incorporated -> "Inc."; Corp./Corporation -> "Corp."; "&" / "and" -> "&"), then applies the
same seed-frequency logic as addresses to the REMAINDER (the org name before the suffix), at a
single edit-distance-<=1 threshold (Damerau): exact -> 1.0, one edit -> 0.9, seed-only (best count
< 5) -> 0.5. There is no "0.75 two+" tier for orgs — the spec caps org matching at one edit.

OCR confusion pairs modelled (`OCR_CONFUSE_GROUPS`, `_fold_tt_it`): i/l/1, a/e, c/e, tt/it. These
soften substitution cost in `ocr_aware_distance()` and fold "tt"<->"it" before comparing, which is
what turns "Lafayeitte"-shaped OCR errors as close to "Lafayette" as a plain edit-distance-2 typo.
"""
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Dict, List, NamedTuple, Tuple

# --------------------------------------------------------------------- street normalisation ---
# Ported word-for-word from /Users/henry/Code/prospect/lib/address/normalize.ts (read-only
# reference; not imported — that file is TypeScript and lives in a different repo). Keep this
# table in sync by hand if the Prospect source changes; there is no cross-repo import mechanism.
STREET_WORDS: Dict[str, str] = {
    "N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST",
    "NE": "NORTHEAST", "NW": "NORTHWEST", "SE": "SOUTHEAST", "SW": "SOUTHWEST",
    "ST": "STREET", "STR": "STREET", "AVE": "AVENUE", "AV": "AVENUE",
    "RD": "ROAD", "DR": "DRIVE", "BLVD": "BOULEVARD", "PL": "PLACE", "PLZ": "PLAZA",
    "CT": "COURT", "LN": "LANE", "TER": "TERRACE", "TERR": "TERRACE",
    "PKWY": "PARKWAY", "PKY": "PARKWAY", "HWY": "HIGHWAY", "SQ": "SQUARE",
    "CIR": "CIRCLE", "BRDG": "BRIDGE", "EXPY": "EXPRESSWAY",
    # entities.py's STREET_T regex recognises two more types Prospect's roll never needed:
    "SLIP": "SLIP", "WAY": "WAY",
}
# Full-form street-type words (the set of possible trailing tokens after normalize_street()).
STREET_TYPES = {
    "STREET", "AVENUE", "BOULEVARD", "ROAD", "DRIVE", "PLACE", "PLAZA", "COURT", "LANE",
    "TERRACE", "PARKWAY", "HIGHWAY", "SQUARE", "CIRCLE", "BRIDGE", "EXPRESSWAY", "SLIP", "WAY",
}
RE_ORDINAL = re.compile(r"^(\d+)(ST|ND|RD|TH)$")
RE_HOUSE_STREET = re.compile(r"^(\d{1,4}(?:-\d{1,4})?)\s+(.*)$")
RE_PUNCT = re.compile(r"[^A-Z0-9 ]+")
RE_WS = re.compile(r"\s+")


def normalize_street(raw: str) -> str:
    """Uppercase, punctuation->space, whitespace collapsed, ordinal suffix dropped, abbreviations
    expanded — except a trailing "ST"/"STR" only expands when it is the LAST word (a leading "ST"
    is left alone: "St Nicholas" is a saint, not a street type mid-name)."""
    words = [w for w in RE_WS.split(RE_PUNCT.sub(" ", raw.upper()).strip()) if w]
    words = [RE_ORDINAL.sub(r"\1", w) for w in words]
    out = []
    n = len(words)
    for i, w in enumerate(words):
        if w in ("ST", "STR") and i != n - 1:
            out.append(w)
        else:
            out.append(STREET_WORDS.get(w, w))
    return " ".join(out)


def split_house_street(raw_addr: str) -> Tuple[str | None, str]:
    """"295 Lafayette Street" -> ("295", "295 LAFAYETTE STREET" normalized street part only)."""
    m = RE_HOUSE_STREET.match(raw_addr.strip())
    if not m:
        return None, normalize_street(raw_addr)
    return m.group(1).upper(), normalize_street(m.group(2))


def street_type_of(normalized_street: str) -> str | None:
    words = normalized_street.split()
    return words[-1] if words and words[-1] in STREET_TYPES else None


def street_name_of(normalized_street: str) -> str:
    """The normalized street minus its trailing type word (what gets fuzzy-matched)."""
    words = normalized_street.split()
    if words and words[-1] in STREET_TYPES:
        words = words[:-1]
    return " ".join(words)


def address_name_part(s: str) -> str:
    """The fuzzy-matched "core" of a full address string ("117 Chambers Street" -> "CHAMBERS") —
    used by canonical_llm.py's post-hoc sanity check, so an LLM-approved match can be scored on the
    same basis as a rule-based one regardless of which label ('address') it came from."""
    house, street = split_house_street(s)
    return street_name_of(street) if house is not None else ""


# ------------------------------------------------------------------------------ edit distance ---
# OCR confusion pairs (single-character groups; membership in the same group costs 0.5 instead of
# 1 to substitute). "tt/it" is a two-character confusion, handled separately by folding both
# spellings to the same token before the edit-distance DP runs (see ocr_aware_distance()).
OCR_CONFUSE_GROUPS = [set("IL1"), set("AE"), set("CE")]
RE_TT_IT = re.compile(r"TT|IT")


def _sub_cost(a: str, b: str) -> float:
    if a == b:
        return 0.0
    for g in OCR_CONFUSE_GROUPS:
        if a in g and b in g:
            return 0.5
    return 1.0


def _weighted_damerau(a: str, b: str, sub_cost) -> float:
    """Damerau-Levenshtein (adjacent transposition included) with a pluggable substitution cost;
    insertion/deletion always cost 1. O(len(a)*len(b)), fine for street-name-length strings."""
    la, lb = len(a), len(b)
    d = [[0.0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1):
        d[i][0] = i
    for j in range(lb + 1):
        d[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            cost = sub_cost(a[i - 1], b[j - 1])
            d[i][j] = min(
                d[i - 1][j] + 1,        # deletion
                d[i][j - 1] + 1,        # insertion
                d[i - 1][j - 1] + cost,  # substitution (0 if equal)
            )
            if (i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]):
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)  # transposition
    return d[la][lb]


def damerau_levenshtein(a: str, b: str) -> int:
    """Plain (unweighted) Damerau-Levenshtein distance, for names < 8 chars."""
    return int(_weighted_damerau(a, b, lambda x, y: 0.0 if x == y else 1.0))


def _fold_tt_it(s: str) -> str:
    """Fold both "TT" and "IT" to "T" so e.g. LAFAYETTE and LAFAYEITE compare equal on that run."""
    return RE_TT_IT.sub("T", s)


def ocr_aware_distance(a: str, b: str) -> float:
    """OCR-confusion-aware distance for names >= 8 chars: weighted substitution cost (i/l/1, a/e,
    c/e at 0.5) applied after folding tt/it runs to a common token."""
    return _weighted_damerau(_fold_tt_it(a), _fold_tt_it(b), _sub_cost)


# --------------------------------------------------------------------------------- addresses ---
MIN_SEED_FREQ = 5


def _slug(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", s.strip()).strip("-").lower()
    return re.sub(r"-{2,}", "-", s) or "x"


def title_case(s: str) -> str:
    """Title-case a normalized (all-caps) street/org name, keeping numerals and single-letter
    directionals ("W") capitalised as-is."""
    return " ".join(w if (w.isdigit() or (len(w) <= 1)) else w.capitalize() for w in s.split())


class GazEntry(NamedTuple):
    street_norm: str  # normalize_street()'d roll street_name, e.g. "LAFAYETTE STREET"
    bbl: str
    bin: str | None


def load_gazetteer(path: str | Path) -> Dict[str, List[GazEntry]]:
    """house number -> [GazEntry, ...] from data/embed/gazetteer-prospect.csv
    (export_prospect_gazetteer.py's one-time dump of Prospect's property roll)."""
    by_house: Dict[str, List[GazEntry]] = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            house = (row.get("housenum") or "").strip().upper()
            street = (row.get("street_canonical") or "").strip()
            if not house or not street:
                continue
            by_house.setdefault(house, []).append(
                GazEntry(street, row["bbl"], row.get("bin") or None))
    return by_house


# (tier, distance) for a name matched against a candidate, or None if outside every threshold.
# tier 0 = exact, 1 = confidence 0.9, 2 = confidence 0.75 — same ladder for the roll and the
# frequency-seed fallback, so a roll match and a frequency match are scored on equal footing.
TIER_CONF = {0: 1.0, 1: 0.9, 2: 0.75}

# Team lead, 2026-09-14: OCR-aware tier's length gate lowered 8 -> 6, so "Labette" (7 chars) can
# reach "Lafayette" (9 chars, ocr_aware_distance == 3.0). Applied uniformly — to BOTH the roll and
# the frequency-seed fallback, not roll matches only, even though the ask's parenthetical framed it
# as roll-anchored ("the candidate seed is a roll address"): 295 Lafayette Street, the address that
# motivated the ask, sits outside the gazetteer's nine-ZIP footprint (NoHo, ZIP 10012 — see the
# module docstring), so "Labette" never has a roll candidate to match against at house number 295;
# restricting the lower gate to roll-only matches would never produce the merge that was asked for.
OCR_MIN_LEN = 6
# The OCR-aware tier's distance cap is a RATIO of the longer name's length, not a flat 3, and this
# is the second live finding from this round's re-testing (also not part of either explicit ask,
# also fixed and flagged in the report). A flat "<=3 for names >=6 chars" lets a distance-3 match
# span HALF of a 6-letter word — "WARREN"/"WALKER" and "WARREN"/"WATERS" (each 6 chars, distance 3)
# are real, distinct Lower Manhattan streets that were merging via ROLL matches once OCR_MIN_LEN
# dropped to 6. OCR_MAX_RATIO reproduces the original spec's own implicit ratio (distance<=3 AT
# length>=8 means <=37.5% of the word) at every length instead of only at exactly 8: "LABETTE"
# (7)/"LAFAYETTE" (9) stays at distance 3 / 9 = 33% (kept), "WARREN"/"WALKER" is 3 / 6 = 50%
# (rejected). OCR_MIN_LEN stays as a hard floor below which no OCR-aware match is even attempted.
MIN_PLAIN_LEN = 6
OCR_MAX_RATIO = 3 / 8

RE_DIGIT_TOKEN = re.compile(r"\d+")


def _digit_tokens(s: str) -> set:
    return set(RE_DIGIT_TOKEN.findall(s))


def _match_tier(a: str, b: str) -> Tuple[int, float] | None:
    # Never fuzzy-match across differing digit tokens (team lead, 2026-09-14): "EAST 45" and
    # "EAST 4" (from "228 E. 45th Street" / "228 E. 4th Street") are one Damerau edit apart, but a
    # numbered street's number IS the street — dropping/changing a digit is a different address,
    # not an OCR wobble, and it is exactly the shape of error this module must never merge past
    # (same principle as house number and street type, just inside the fuzzy-matched name). A
    # street name with NO digit token (ordinary names) is unaffected either way.
    da, db = _digit_tokens(a), _digit_tokens(b)
    if da and db and da != db:
        return None
    if a == b:
        return (0, 0.0)
    if len(a) >= MIN_PLAIN_LEN and len(b) >= MIN_PLAIN_LEN:
        dist_plain = damerau_levenshtein(a, b)
        if dist_plain <= 2:
            return (1 if dist_plain <= 1 else 2, float(dist_plain))
    if len(a) >= OCR_MIN_LEN and len(b) >= OCR_MIN_LEN:
        dist_ocr = ocr_aware_distance(a, b)
        max_dist = min(3.0, max(len(a), len(b)) * OCR_MAX_RATIO)
        if dist_ocr <= max_dist:
            return (1 if dist_ocr <= 1 else 2, dist_ocr)
    return None


def canonicalize_addresses(
    counts: Dict[str, int], gazetteer: Dict[str, List[GazEntry]] | None = None
) -> Dict[str, Tuple[str, str, float, str | None, str | None, str]]:
    """{raw address text -> occurrence count} -> {raw address text -> (canonical_key,
    canonical_label, confidence, bbl_or_None, bin_or_None, method)}. `method` is 'exact' (distance-0
    match, either against the roll or a frequency seed — including a spelling that stands alone as
    its own single-member group, which is trivially an exact match to itself), 'roll' (non-exact
    roll-gazetteer match) or 'fuzzy' (non-exact frequency-seed match, including the 0.5-confidence
    "seed-only" case). A fourth method, 'llm', is never produced here — see `find_llm_candidates()`
    and `canonical_llm.py` for the last-resort pass that revises an 'exact' (self-standing) entry
    into an existing group when the rule-based tiers found nothing.

    `counts` should hold every distinct raw spelling seen (already the mentions.norm/text grouping
    entities.py has); house number and street TYPE are never merged across groups (see module
    docstring).

    When `gazetteer` (see `load_gazetteer()`) is given, the roll is tried FIRST for every group —
    a match carries the roll's bbl/bin. Anything the roll doesn't cover at that house number falls
    back to the frequency-seed method, with bbl/bin left None."""
    # group raw texts by (house_num, street_type); each entry keeps its normalized street name too
    groups: Dict[Tuple[str, str], Dict[str, int]] = {}
    parsed: Dict[str, Tuple[str, str, str]] = {}  # raw -> (house, type, name)
    for raw, n in counts.items():
        house, street = split_house_street(raw)
        if house is None:
            continue
        stype = street_type_of(street) or ""
        sname = street_name_of(street)
        parsed[raw] = (house, stype, sname)
        key = (house, stype)
        groups.setdefault(key, {})
        groups[key][sname] = groups[key].get(sname, 0) + n

    out: Dict[str, Tuple[str, str, float, str | None, str | None, str]] = {}
    for (house, stype), name_counts in groups.items():
        # roll candidates for this exact house number and street type (never across types)
        roll_candidates: List[Tuple[str, str, str | None]] = []
        if gazetteer:
            for ge in gazetteer.get(house, ()):
                if street_type_of(ge.street_norm) == stype:
                    roll_candidates.append((street_name_of(ge.street_norm), ge.bbl, ge.bin))

        seed_name, seed_freq = max(name_counts.items(), key=lambda kv: (kv[1], kv[0]))
        seed_ok = seed_freq >= MIN_SEED_FREQ
        seed_key = f"address:{house}-{_slug(seed_name + ' ' + stype)}"
        seed_label = title_case(f"{house} {seed_name} {stype}".strip())

        for raw, n in counts.items():
            if raw not in parsed or parsed[raw][:2] != (house, stype):
                continue
            _, _, sname = parsed[raw]

            best = None  # (tier, dist, g_name, bbl, bin)
            for g_name, bbl, bin_ in roll_candidates:
                t = _match_tier(sname, g_name)
                if t is not None and (best is None or (t[0], t[1]) < (best[0], best[1])):
                    best = (t[0], t[1], g_name, bbl, bin_)
            if best is not None:
                tier, _, g_name, bbl, bin_ = best
                key = f"address:bbl:{bbl}"
                label = title_case(f"{house} {g_name} {stype}".strip())
                conf = TIER_CONF[tier]
                out[raw] = (key, label, conf, bbl, bin_, "exact" if conf == 1.0 else "roll")
                continue

            if not seed_ok:
                key = seed_key if sname == seed_name else f"address:{house}-{_slug(sname + ' ' + stype)}"
                label = seed_label if sname == seed_name else title_case(f"{house} {sname} {stype}".strip())
                out[raw] = (key, label, 0.5, None, None, "fuzzy")
                continue
            t = _match_tier(sname, seed_name)
            if t is not None:
                conf = TIER_CONF[t[0]]
                out[raw] = (seed_key, seed_label, conf, None, None, "exact" if conf == 1.0 else "fuzzy")
                continue
            # no roll match and no frequency-seed match within threshold: stands on its own
            own_key = f"address:{house}-{_slug(sname + ' ' + stype)}"
            out[raw] = (own_key, title_case(f"{house} {sname} {stype}".strip()), 1.0, None, None, "exact")
    return out


# ------------------------------------------------------------------------- labs & contractors ---
ORG_SUFFIXES: Dict[str, Dict[str, str]] = {
    "lab": {
        "LABORATORY": "Laboratory", "LABORATORIES": "Laboratory", "LABS": "Laboratory",
        "LAB": "Laboratory", "ANALYTICAL": "Analytical", "TESTING": "Testing",
    },
    "contractor": {
        "INC": "Inc.", "INCORPORATED": "Inc.", "CORP": "Corp.", "CORPORATION": "Corp.",
        "LLC": "LLC", "CO": "Co.", "COMPANY": "Co.", "ASSOCIATES": "Associates",
        "CONSULTANTS": "Consultants", "CONSULTING": "Consulting", "ENGINEERS": "Engineers",
        "ENGINEERING": "Engineering", "CONTRACTING": "Contracting", "CONTRACTORS": "Contractors",
        "CONSTRUCTION": "Construction",
    },
}
RE_ORG_PUNCT = re.compile(r"[.,]")
RE_AMP = re.compile(r"\s*&\s*")


def normalize_org_suffix(kind: str, raw_norm: str) -> Tuple[str, str]:
    """(remainder-without-suffix, canonical-suffix-or-'') for a lab/contractor mention's already-
    uppercased `norm` text. Strips trailing punctuation and folds "&" to "AND" so "Smith & Jones"
    and "Smith and Jones" compare equal."""
    s = RE_ORG_PUNCT.sub("", raw_norm.upper())
    s = RE_AMP.sub(" AND ", s)
    s = RE_WS.sub(" ", s).strip()
    words = s.split()
    suffix_map = ORG_SUFFIXES.get(kind, {})
    suffix = ""
    if words and words[-1] in suffix_map:
        suffix = suffix_map[words[-1]]
        words = words[:-1]
    return " ".join(words), suffix


def org_name_part(kind: str, s: str) -> str:
    """The fuzzy-matched "core" of an org string (the remainder before the suffix) — see
    `address_name_part()`; same purpose, for labs/contractors."""
    remainder, _ = normalize_org_suffix(kind, s)
    return remainder


def canonicalize_orgs(kind: str, counts: Dict[str, int]) -> Dict[str, Tuple[str, str, float, str]]:
    """Same seed-frequency idea as addresses, but grouped by (kind, canonical suffix) and matched
    on the remainder at a flat Damerau distance <= 1 (no OCR-aware tier for orgs — the spec caps
    this at one edit). Returns {raw -> (canonical_key, canonical_label, confidence, method)}, method
    'exact' or 'fuzzy' — see `canonicalize_addresses()`'s docstring for what those mean; orgs never
    get 'roll' (no gazetteer here) and never get 'llm' from this function (see
    `find_llm_org_candidates()`)."""
    groups: Dict[str, Dict[str, int]] = {}
    parsed: Dict[str, Tuple[str, str]] = {}  # raw -> (suffix, remainder)
    for raw, n in counts.items():
        remainder, suffix = normalize_org_suffix(kind, raw)
        if not remainder:
            continue
        parsed[raw] = (suffix, remainder)
        groups.setdefault(suffix, {})
        groups[suffix][remainder] = groups[suffix].get(remainder, 0) + n

    out: Dict[str, Tuple[str, str, float, str]] = {}
    for suffix, rem_counts in groups.items():
        seed_rem, seed_freq = max(rem_counts.items(), key=lambda kv: (kv[1], kv[0]))
        seed_ok = seed_freq >= MIN_SEED_FREQ
        seed_label = title_case(seed_rem) + (f" {suffix}" if suffix else "")
        seed_key = f"{kind}:{_slug(seed_rem + ' ' + suffix)}"

        for raw, n in counts.items():
            if raw not in parsed or parsed[raw][0] != suffix:
                continue
            _, rem = parsed[raw]
            if not seed_ok:
                key = seed_key if rem == seed_rem else f"{kind}:{_slug(rem + ' ' + suffix)}"
                label = seed_label if rem == seed_rem else title_case(rem) + (f" {suffix}" if suffix else "")
                out[raw] = (key, label, 0.5, "fuzzy")
                continue
            if rem == seed_rem:
                out[raw] = (seed_key, seed_label, 1.0, "exact")
                continue
            dist = damerau_levenshtein(rem, seed_rem) if min(len(rem), len(seed_rem)) else 99
            if dist <= 1:
                out[raw] = (seed_key, seed_label, 0.9, "fuzzy")
                continue
            own_key = f"{kind}:{_slug(rem + ' ' + suffix)}"
            out[raw] = (own_key, title_case(rem) + (f" {suffix}" if suffix else ""), 1.0, "exact")
    return out


# ---------------------------------------------------------------- LLM last resort (candidates) ---
# Pure, stdlib, no network — picks out what NEEDS an LLM call and what to ask it. The actual call
# lives in canonical_llm.py (the ONLY module in this repo that talks to the Anthropic API), which
# imports these two finders. Kept here because they share canonicalize_*()'s grouping logic and
# must stay in lock-step with it: a "candidate" is only ever an EXISTING canonical label from this
# same rule-based pass (a roll street or a frequency seed) — the LLM only ever revises an isolated
# spelling INTO an existing group, it never creates a new one.
MAX_LLM_CANDIDATES = 8


def find_llm_candidates(
    mapping: Dict[str, Tuple[str, str, float, str | None, str | None, str]]
) -> Dict[str, Dict[str, object]]:
    """{raw -> {"candidates": [canonical_label, ...], "keys": {label: (canonical_key, bbl, bin)}}}
    for every raw address spelling whose canonical_key (from `mapping`, i.e. already run through
    `canonicalize_addresses()`) is used by no other raw spelling (it "matched nothing") AND at
    least one OTHER, ESTABLISHED canonical label exists at the same house number + street type (a
    roll street, or a frequency seed that already merged >= 2 raw spellings). Candidates are capped
    at `MAX_LLM_CANDIDATES`, roll-backed ones first, then by how many raw spellings already back
    them.

    **A candidate must be established — never another isolated, unverified spelling.** Found live
    while testing this pass: two single-mention "seed-only" entries at the same house+type (neither
    with any independent corroboration) were offered to each other as candidates, and the model
    said yes to BOTH directions — one real, uncorrupted spelling ("39-17 Junction Boulevard") got
    merged INTO the other's garbled form ("39-17 Jwmti Boulevard") while the garbled one merged into
    the real one's old key, an identity swap with no real winner. Separately, "117 Cedar Street" (a
    single-mention 0.5-confidence seed, itself unverified) was offered as a candidate for "117
    Chambers St" and accepted — merging two DIFFERENT real streets. Restricting candidates to
    roll-backed entries or frequency seeds with >= 2 corroborating raw spellings removes both
    failure modes: the LLM is only ever asked to match an unverified spelling against something
    that already has independent evidence behind it."""
    key_raw_count: Dict[str, int] = {}
    for v in mapping.values():
        key_raw_count[v[0]] = key_raw_count.get(v[0], 0) + 1

    group_candidates: Dict[Tuple[str, str], List[Tuple[str, str, str | None, str | None, int]]] = {}
    seen_keys: set = set()
    for raw, v in mapping.items():
        key, label, _, bbl, bin_, _ = v
        if key in seen_keys:
            continue
        seen_keys.add(key)
        if bbl is None and key_raw_count[key] < 2:
            continue  # not established: never offered as a merge TARGET for another orphan
        house, street = split_house_street(raw)
        if house is None:
            continue
        stype = street_type_of(street) or ""
        group_candidates.setdefault((house, stype), []).append((label, key, bbl, bin_, key_raw_count[key]))

    out: Dict[str, Dict[str, object]] = {}
    for raw, v in mapping.items():
        key, label = v[0], v[1]
        if key_raw_count[key] != 1:
            continue  # already merged with something by the rule-based pass
        house, street = split_house_street(raw)
        if house is None:
            continue
        stype = street_type_of(street) or ""
        pool = [c for c in group_candidates.get((house, stype), []) if c[1] != key]
        if not pool:
            continue
        pool.sort(key=lambda c: (c[2] is None, -c[4]))  # roll-backed (bbl set) first, then frequency
        top = pool[:MAX_LLM_CANDIDATES]
        out[raw] = {
            "candidates": [c[0] for c in top],
            "keys": {c[0]: (c[1], c[2], c[3]) for c in top},
        }
    return out


def find_llm_org_candidates(
    kind: str, mapping: Dict[str, Tuple[str, str, float, str]]
) -> Dict[str, Dict[str, object]]:
    """Same idea as `find_llm_candidates()` for labs/contractors: candidates are OTHER, ESTABLISHED
    canonical labels of the same `kind` that share the remainder's first token (e.g. "TESTWELL ..."
    spellings are candidates for each other) — labs/contractors have no house number to group by, so
    the first token of the org name is the grouping key instead. Same "never another orphan" guard
    as `find_llm_candidates()`: a candidate must already have merged >= 2 raw spellings (orgs have
    no roll to fall back on, so that is the only kind of established evidence available here)."""
    key_raw_count: Dict[str, int] = {}
    for v in mapping.values():
        key_raw_count[v[0]] = key_raw_count.get(v[0], 0) + 1

    group_candidates: Dict[str, List[Tuple[str, str, int]]] = {}
    seen_keys: set = set()
    parsed: Dict[str, str] = {}  # raw -> first token of the remainder
    for raw, v in mapping.items():
        key, label = v[0], v[1]
        remainder, _ = normalize_org_suffix(kind, raw)
        first = remainder.split()[0] if remainder else ""
        parsed[raw] = first
        if key in seen_keys:
            continue
        seen_keys.add(key)
        if key_raw_count[key] < 2:
            continue  # not established: never offered as a merge TARGET for another orphan
        group_candidates.setdefault(first, []).append((label, key, key_raw_count[key]))

    out: Dict[str, Dict[str, object]] = {}
    for raw, v in mapping.items():
        key, label = v[0], v[1]
        if key_raw_count[key] != 1:
            continue
        first = parsed.get(raw, "")
        if not first:
            continue
        pool = [c for c in group_candidates.get(first, []) if c[1] != key]
        if not pool:
            continue
        pool.sort(key=lambda c: -c[2])
        top = pool[:MAX_LLM_CANDIDATES]
        out[raw] = {"candidates": [c[0] for c in top], "keys": {c[0]: (c[1], None, None) for c in top}}
    return out
