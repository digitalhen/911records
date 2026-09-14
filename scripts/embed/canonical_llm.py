#!/usr/bin/env python3
"""canonical_llm.py — LLM last resort for the OCR address/lab/contractor spellings the rule-based
tiers in canonical.py couldn't place (issue #19 follow-up, Henry 2026-09-14: "for fuzzy matches we
can use LLM as a last resort").

**This is the ONLY module in this repo that calls the Anthropic API for canonicalisation.**
canonical.py stays pure/stdlib/no-network by its own design (see its module docstring) — this
module reads the candidates `canonical.find_llm_candidates()` / `find_llm_org_candidates()` compute
(a raw spelling whose canonical_key matched nothing else, plus up to 8 EXISTING canonical labels at
the same house number + street type — or, for orgs, the same first token — it could plausibly be an
OCR misread of) and asks the model, in batches of ~25 items, which candidate (if any) each raw
spelling is. A merge is made only when the model answers with confidence >= MIN_MERGE_CONFIDENCE
(0.8); the merge is always STORED at canonical_confidence 0.6, never the model's own confidence —
the ceiling reflects that an LLM guess, however confident it sounds, is weaker evidence than a rule
match, and canonical_method is stored as 'llm'. The LLM never invents a new canonical entity: every
candidate it is shown already exists (a roll street or an earlier rule-based canonical entry), so a
merge only ever revises an isolated spelling INTO that existing group.

Key: read from /Users/henry/Code/sept11-docs/.claudekey (one line, `sk-ant-...`) into
ANTHROPIC_API_KEY for THIS PROCESS ONLY — never printed, logged, echoed in an error message, or
written anywhere else. Uses the `anthropic` Python SDK (installed into the shared .venv for this
work; also needed by the B3-ask workstream per docs/PLAN.md's Ask design).

Cache: data/embed/canonical-llm-cache.json, keyed by sha1(raw + "|" + sorted(candidates)) so a
re-run — including a batch that failed partway — never re-asks (and never re-bills) a question it
already has an answer for, even if unrelated groups changed in between.

Usage (library, from entities.py's `--canonicalise --llm`):
    updates, usage = resolve_label(con, "address", mapping)   # mapping from canonicalise()'s return
Standalone smoke test: .venv/bin/python scripts/embed/canonical_llm.py --db data/embed/p1-entities.sqlite
Never touches a database directly except through the connection the caller passes in for the UPDATE
— finding candidates and calling the model needs no database access at all.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import canonical  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
KEY_FILE = Path("/Users/henry/Code/sept11-docs/.claudekey")
CACHE_PATH = REPO / "data" / "embed" / "canonical-llm-cache.json"
MODEL = "claude-haiku-4-5-20251001"
BATCH_SIZE = 25
MIN_MERGE_CONFIDENCE = 0.8
STORED_CONFIDENCE = 0.6
# Second gate, found necessary live: the model's own >=0.8 confidence alone was not reliable enough
# — on the first real run it confidently (0.8-0.95) matched genuinely different streets that happen
# to share a house number: "30 Vesey Street" <-> "30 Wall Street" (mutually!), "75 Murray Street" ->
# "75 Chambers Street", "116 Nassau Street" -> "116 John Street", "9 Mill Lane" -> "9 Maiden Lane".
# Measuring OCR_aware_distance/max(len) for every accepted merge (`canonical.address_name_part()`/
# `org_name_part()`) cleanly separated the two groups: every confirmed-good LLM merge on that run
# scored <= 0.44 (worst: "Latsyeiie"/"Lafayette"), every bad one scored >= 0.67 ("Vesey"/"Wall" 0.90,
# "Chambers"/"Broad" 0.94, "Mill"/"Maiden" 0.67). MAX_LLM_NAME_RATIO=0.6 sits in that gap. This is
# NOT the same threshold as canonical.py's own OCR_MAX_RATIO (3/8, for the rule-based fuzzy tier —
# stricter, and gated by OCR_MIN_LEN) — this one runs AFTER the model has already said yes, as a
# sanity check on an LLM answer specifically, not a match-finding tier of its own.
MAX_LLM_NAME_RATIO = 0.6
# claude-haiku-4-5 pricing (shared/model pricing table, checked 2026-09-14): $1.00 / $5.00 per
# 1M input/output tokens. The dated snapshot id Henry named carries the same per-token price.
PRICE_IN_PER_MTOK = 1.00
PRICE_OUT_PER_MTOK = 5.00
DEFAULT_BUDGET_USD = 1.0

SYSTEM_PROMPT = (
    "You are checking whether an OCR-garbled address or organisation name from a scanned 1990s-"
    "2000s government record is a misread of one specific KNOWN-CORRECT spelling from a short "
    "candidate list, or none of them. Each candidate is a real, already-established spelling (from "
    "a property roll or from repeated occurrences in this same set of documents) — you are matching, "
    "never inventing. Two spellings that are genuinely different real places or organisations must "
    "never be called a match, even if they look similar (e.g. \"Warren Street\" and \"Walker Street\" "
    "are different real streets, not an OCR error of each other). Respond with ONLY a JSON array, no "
    "prose, no markdown fences, one object per item in the same order: "
    '{"id": <int>, "match": "<one candidate string, exactly as given>" or null, "confidence": <0..1>}. '
    "Set match to null and confidence low whenever you are not genuinely confident."
)


def _load_api_key(key_file: Path = KEY_FILE) -> str:
    key = key_file.read_text().strip()
    if not key:
        raise RuntimeError(f"{key_file} is empty")
    return key


def _load_cache(path: Path = CACHE_PATH) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return {}
    return {}


def _save_cache(cache: dict, path: Path = CACHE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=1, sort_keys=True))


def _cache_key(raw: str, candidates: list[str]) -> str:
    h = hashlib.sha1()
    h.update(raw.encode("utf-8", "replace"))
    h.update(b"\x00")
    h.update("\x00".join(sorted(candidates)).encode("utf-8", "replace"))
    return h.hexdigest()


def _build_batch_prompt(items: list[dict]) -> str:
    lines = []
    for it in items:
        cand_list = ", ".join(json.dumps(c) for c in it["candidates"])
        lines.append(f'{{"id": {it["id"]}, "raw": {json.dumps(it["raw"])}, "candidates": [{cand_list}]}}')
    return "Items:\n" + "\n".join(lines)


def _parse_response(text: str) -> list[dict]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text)


def _call_model(client, model: str, items: list[dict]) -> tuple[list[dict], object]:
    """One batch call. Returns (parsed JSON list, response.usage). Raises on malformed JSON — the
    caller treats the whole batch as unresolved (no merges) rather than guessing partial results."""
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_batch_prompt(items)}],
    )
    text = "".join(b.text for b in response.content if b.type == "text")
    return _parse_response(text), response.usage


def resolve_label(
    con: sqlite3.Connection,
    label: str,
    mapping: dict,
    model: str = MODEL,
    batch_size: int = BATCH_SIZE,
    budget_usd: float = DEFAULT_BUDGET_USD,
    cache_path: Path = CACHE_PATH,
    key_file: Path = KEY_FILE,
) -> tuple[dict, dict]:
    """label: 'address'|'lab'|'contractor'. `mapping` is exactly what entities.py's canonicalise()
    already computed and wrote for this label (canonical.canonicalize_addresses()/
    canonicalize_orgs()'s return value) — this function recomputes nothing about the rule-based
    tiers, only finds what they left unmatched and asks the model about it.

    Returns (updates, usage): `updates[raw]` = the new (canonical_key, canonical_label,
    STORED_CONFIDENCE, bbl, bin, 'llm') tuple for every raw spelling the model merged with
    confidence >= MIN_MERGE_CONFIDENCE — the CALLER applies these as an UPDATE that OVERWRITES the
    raw spelling's existing (isolated, self-standing) canonical assignment, since "matched nothing"
    in canonical.py's rule-based pass still gets a real (if lonely) canonical_key, not NULL. `usage`
    is a summary dict (groups_considered, cache_hits, api_calls, batches, input_tokens,
    output_tokens, cost_usd, merged, stopped_on_budget)."""
    if label == "address":
        candidates = canonical.find_llm_candidates(mapping)
    else:
        candidates = canonical.find_llm_org_candidates(label, mapping)

    usage = {
        "groups_considered": len(candidates), "cache_hits": 0, "api_calls": 0, "batches": 0,
        "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "merged": 0, "rejected_sanity": 0,
        "stopped_on_budget": False,
    }
    updates: dict = {}
    if not candidates:
        return updates, usage

    cache = _load_cache(cache_path)
    to_ask: list[dict] = []
    resolved_from_cache: dict[str, dict] = {}
    for raw, info in candidates.items():
        cands = info["candidates"]
        ck = _cache_key(raw, cands)
        if ck in cache:
            resolved_from_cache[raw] = cache[ck]
            usage["cache_hits"] += 1
        else:
            to_ask.append({"id": len(to_ask), "raw": raw, "candidates": cands, "cache_key": ck})

    name_part = (canonical.address_name_part if label == "address"
                 else lambda s: canonical.org_name_part(label, s))

    def _apply(raw: str, result: dict, info: dict) -> None:
        match, confidence = result.get("match"), result.get("confidence", 0)
        if not (match and match in info["keys"] and confidence is not None
                and confidence >= MIN_MERGE_CONFIDENCE):
            return
        a, b = name_part(raw), name_part(match)
        if not a or not b:
            usage["rejected_sanity"] += 1
            return
        ratio = canonical.ocr_aware_distance(a, b) / max(len(a), len(b))
        if ratio > MAX_LLM_NAME_RATIO:
            usage["rejected_sanity"] += 1
            return
        new_key, bbl, bin_ = info["keys"][match]
        updates[raw] = (new_key, match, STORED_CONFIDENCE, bbl, bin_, "llm")
        usage["merged"] += 1

    for raw, result in resolved_from_cache.items():
        _apply(raw, result, candidates[raw])

    if to_ask:
        client = None
        for start in range(0, len(to_ask), batch_size):
            if usage["cost_usd"] >= budget_usd:
                usage["stopped_on_budget"] = True
                break
            batch = to_ask[start:start + batch_size]
            if client is None:
                import anthropic  # imported lazily so a cache-only run needs no key/SDK at all
                client = anthropic.Anthropic(api_key=_load_api_key(key_file))
            try:
                parsed, api_usage = _call_model(client, model, batch)
            except Exception as e:  # malformed JSON, network error, etc. — skip this batch, keep going
                print(f"canonical_llm: batch at {start} failed ({e}); leaving it unresolved", file=sys.stderr)
                continue
            usage["api_calls"] += 1
            usage["batches"] += 1
            usage["input_tokens"] += api_usage.input_tokens
            usage["output_tokens"] += api_usage.output_tokens
            usage["cost_usd"] += (api_usage.input_tokens * PRICE_IN_PER_MTOK
                                   + api_usage.output_tokens * PRICE_OUT_PER_MTOK) / 1_000_000
            by_id = {r.get("id"): r for r in parsed if isinstance(r, dict)}
            for item in batch:
                result = by_id.get(item["id"])
                if result is None:
                    continue
                cache[item["cache_key"]] = {"match": result.get("match"), "confidence": result.get("confidence")}
                _apply(item["raw"], result, candidates[item["raw"]])
        _save_cache(cache, cache_path)

    usage["cost_usd"] = round(usage["cost_usd"], 6)
    return updates, usage


def apply_updates(con: sqlite3.Connection, label: str, updates: dict) -> int:
    """Overwrite the existing (isolated) canonical_* columns for every raw spelling the LLM merged.
    `updates` is keyed by `norm` (the same uppercase-normalized key canonicalise()'s own mapping and
    UPDATE statements use — NOT the mixed-case `text` column), so this matches every mentions row
    that shares that norm, same as the rule-based pass. Unlike canonicalise()'s incremental
    UPDATE ... WHERE canonical_key IS NULL, this intentionally REVISES rows that already have a
    canonical_key — that key was the spelling's own single-member group, and the LLM found
    somewhere better for it to belong."""
    rows = [(ck, cl, cf, bbl, bin_, mth, label, norm) for norm, (ck, cl, cf, bbl, bin_, mth) in updates.items()]
    con.executemany(
        "UPDATE mentions SET canonical_key=?, canonical_label=?, canonical_confidence=?, "
        "canonical_bbl=?, canonical_bin=?, canonical_method=? WHERE label=? AND norm=?", rows)
    con.commit()
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", required=True, help="entities.sqlite (or a copy) to read/write — never the live one without saying so")
    ap.add_argument("--budget-usd", type=float, default=DEFAULT_BUDGET_USD)
    args = ap.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import entities  # local import: reuses connect()/canonicalise() rather than duplicating them

    con = entities.connect(Path(args.db))
    stats, mappings = entities.canonicalise(con)
    print(json.dumps({"rule_based": stats}, indent=1))

    t0 = time.time()
    total_usage = {"cost_usd": 0.0, "merged": 0}
    for label in ("address", "lab", "contractor"):
        updates, usage = resolve_label(con, label, mappings[label], budget_usd=args.budget_usd)
        n = apply_updates(con, label, updates)
        total_usage["cost_usd"] += usage["cost_usd"]
        total_usage["merged"] += n
        print(json.dumps({label: usage, "rows_updated": n}, indent=1))
    print(json.dumps({"total_cost_usd": round(total_usage["cost_usd"], 4),
                       "total_merged": total_usage["merged"], "seconds": round(time.time() - t0, 1)}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
