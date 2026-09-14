#!/usr/bin/env python3
"""doctypes.py — rule-based document type classifier (issue #28).

Local only; touches no network. Stdlib only (python3, json, re, hashlib, pathlib).

Classifies every extracted document (one row per data/text/**/<bates>.pages.jsonl) into a
`doc_type` with a `confidence` (0..1) and a short human-readable `reason`. First-pass rules only —
this is not a model. Every pattern below was checked against the mirrored corpus (12,030 documents
as of 2026-09-14, this script's own JSON summary); example Bates numbers are real hits, not
invented.

Types, in the priority order rules are tried (first match wins):

  cover_sheet        Exactly one page, and the page reads as a NYC DEP property-lookup separator:
                      an ALL-CAPS street address line, "Block <n> Lot <n>", and "BIN <7 digits>"
                      (RE_BLOCK_LOT + RE_BIN). Real example: NYC-WTC_000120384, page 1 —
                        "88 PINE STREET / Block: 38 Lot: 17 / BIN: 1000876 / 135-153 Water St, ..."
                      This is the pattern Henry asked about (issue #28): 495 of 6,206 one-page
                      documents sampled from the current mirror match it (confidence 0.9). A weaker
                      variant — Block/Lot present but no BIN match, often an OCR miss on the BIN
                      line — scores 0.55. No separate bare "BOX n" / "FOLDER:" separator page was
                      found anywhere in the sampled corpus (checked for literal "Box #"/"Folder:"
                      lines with little else on the page); if the daily catalog job later mirrors
                      one, RE_BLOCK_LOT/RE_BIN won't catch it and this docstring should be updated.
  chain_of_custody   Literal phrase "chain of custody" (42 hits in the sample) — e.g.
                      NYC-WTC_000164362 p3 ("... CEQ ... DRAFT 10/17/03 ... chain of custody ...").
                      Confidence 0.85.
  sign_in_sheet      Literal "sign-in sheet" / "sign in sheet" (14 hits) — e.g. NYC-WTC_000146770
                      p1 "CITY LEGISLATIVE AFFAIRS / MEETING SIGN-IN SHEET" and NYC-WTC_000152141
                      p1 "WTC - Emergency Proclamation ... Sign-In Sheet". Confidence 0.85.
  invoice            "Bill To" / "Amount Due" / "Remit (payment) to" / "Invoice No./Date" (210
                      hits) — e.g. NYC-WTC_000096348 p1 "Sub-Total ... Remit Payment To: ...
                      Reference Invoice #". Confidence 0.7. (A bare mention of the word "invoice"
                      inside a letter, e.g. NYC-WTC_000171270's "Enclosed please find an invoice
                      dated ...", is deliberately NOT matched here — memo_letter's From/To/Re/Dear
                      header wins that one instead, since it is tried first only when this rule
                      doesn't match; see ORDER below.)
  permit_application ACP-7 (NYC DEP's asbestos abatement notification/permit form; mentioned e.g.
                      NYC-WTC_000164936 p3 "An ACP7 form signed by the contractor and air-monitoring
                      firm shall be submitted directly to the DEP") or explicit
                      "permit application"/"application for permit"/"variance application"/
                      "asbestos abatement notification" (26+ hits). Confidence 0.6 — this vocabulary
                      also shows up in narrative memos *about* permits, hence the lower score than
                      chain_of_custody/sign_in_sheet's exact-phrase matches.
  lab_report         Two or more of a basket of analytical-report signals in the SAME document:
                      "certificate of analysis", "laboratory report", "analytical report",
                      "sample id:"/"lab sample no.", "method detection limit", "reporting limit",
                      "PLM/TEM method|analysis", "% asbestos", "asbestos content", "f/cc" /
                      "fibers/cc", "results of analysis". A single narrative mention (e.g. a memo
                      explaining "if a substance contains more than 1% asbestos...", NYC-WTC_000151352)
                      scores only 0.45; two or more distinct signals together (denser, more
                      report-like text) score 0.65. This basket is intentionally broad — DEP's
                      asbestos-testing vocabulary bleeds into guidance memos and cover letters, so
                      recall is favored over precision for a "first pass"; a hand-checked sample
                      (PLAN.md stage 0 item 5's 200-document check) should tighten it.
  memo_letter        A From:/To: header block (both, at line starts) or a "Dear <name>" salutation
                      scores 0.75 — by far the most common shape in this corpus (3,538+ hits): most
                      DCAS/DEP correspondence is email printouts or business letters. A lone "Re:"
                      plus one of From:/To: scores 0.6; a lone Re:/Dear/From:/To: scores 0.45.
  photo_log          "photo log" / "photograph log" / "list of photographs" / "photo index". Not
                      observed in the sampled corpus (0 hits) — included because the brief asks for
                      it and DEP inspection binders commonly include one; scores 0.6 if it ever
                      matches, so it never outranks an exact-phrase rule above it.
  form               Fallback structural heuristic: 3+ checkbox glyphs (❑ □ ☐ or "[ ]") or 4+
                      numbered field lines ("12. Methods of ACM Abatement ..." — real example
                      NYC-WTC_000093141 p2, DEP's "ASBESTOS INSPECTION REPORT" form) and no more
                      specific rule matched. Confidence 0.4.
  other              Nothing matched. Confidence 0.0. Covers ordinary body pages, fax transmission
                      banners, blank/near-blank scans (just the portal watermark + Bates stamp —
                      860 one-page examples in the sample, e.g. NYC-WTC_000171017), etc.

Every page of the mirror carries a "NYC 9/11 Public Portal Document" watermark line from the
City's portal itself — it is NOT a signal for anything here (5,562 of 6,206 sampled one-page
documents carry it and are NOT cover sheets) and every regex below ignores it.

Text source: data/text/<agency>/<volume>/<bates>.pages.jsonl (one {page,bates,chars,text} per
line, extract_text.mjs). For a page recorded as `empty` in data/embed/pages.sqlite (image-only
scan), a same-page line from the sibling <bates>.ocr.jsonl overlays it when present — same rule
load_site_pg.py uses for site.page_text. All of a document's pages are concatenated (with the
watermark stripped) for classification; page 1 alone decides `cover_sheet` (must be single-page)
and carries slightly more weight for memo_letter's header check.

Incremental: data/embed/p3-doctypes.jsonl caches a sha1 of each document's classified text
(watermark stripped) alongside its row; a document whose text hash AND RULES_VERSION both match
the cached row is skipped and that row is carried over verbatim. Bump RULES_VERSION whenever a
rule changes — otherwise an old, cached misclassification would survive forever since the
underlying text (and therefore its hash) never changed. Delete the file to force a full rebuild.

Usage:
  .venv/bin/python scripts/embed/doctypes.py [--out data/embed/p3-doctypes.jsonl] [--limit N]

Output: one JSON object per line — {doc, doc_type, confidence, reason, text_sha1, rules_version}
(the last two are bookkeeping for the incremental cache; consumers should read only the first
three). Always prints a one-line JSON distribution summary (counts per doc_type, mean confidence,
seconds) at the end, whether or not anything was reclassified.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TEXT = REPO / "data" / "text"
EMB = REPO / "data" / "embed"
OUT_PATH = EMB / "p3-doctypes.jsonl"

# Bumped whenever a rule (any RE_* above or classify()'s logic) changes, so a cached row keyed only
# on text_sha1 doesn't silently survive a rule fix forever — a document's text is unchanged but its
# classification should not be. load_existing() only reuses a row whose rules_version also matches.
RULES_VERSION = 2

WATERMARK_RE = re.compile(r"NYC\s*9[\/\s]*1+1?\s*Public\s*Portal\s*Document", re.I)

# ---- cover_sheet -----------------------------------------------------------
# \W{0,4} rather than a fixed punctuation class: real OCR runs the "Block:" label straight into a
# bullet-glyph misread of the colon (e.g. "Block:•38 Lot: 17", NYC-WTC_000120384) or drops the
# colon entirely ("Block 16 Lot 7510", NYC-WTC_000105306) — a single optional separator char missed
# both.
RE_BLOCK_LOT = re.compile(r"\bBlock\W{0,4}\d+\W{1,4}Lot\W{0,4}\d+", re.I)
RE_BIN = re.compile(r"\bBIN\s*[:\-]?\s*\d{6,7}", re.I)

# ---- chain_of_custody -------------------------------------------------------
RE_CHAIN_OF_CUSTODY = re.compile(r"\bchain\s*of\s*custody\b", re.I)

# ---- sign_in_sheet ----------------------------------------------------------
RE_SIGN_IN = re.compile(r"\bsign[\s\-]?in\s*sheet\b", re.I)

# ---- invoice ----------------------------------------------------------------
RE_INVOICE = re.compile(
    r"\bbill\s*to\b|\bamount\s*due\b|\bremit\s*(?:payment\s*)?to\b|"
    r"\binvoice\s*(?:no\.?|number|#)\s*[:\-]?\s*\d|\binvoice\s*date\b",
    re.I,
)

# ---- permit_application ------------------------------------------------------
RE_PERMIT = re.compile(
    r"\bACP-?7\b|\basbestos\s*abatement\s*notification\b|\bnotification\s*of\s*intent\s*to\s*abate\b|"
    r"\bpermit\s*application\b|\bapplication\s*for\s*(?:a\s*)?permit\b|\bvariance\s*application\b",
    re.I,
)

# ---- lab_report (basket of signals; 2+ distinct hits -> higher confidence) --
RE_LAB_SIGNALS: list[tuple[str, re.Pattern]] = [
    ("certificate of analysis", re.compile(r"\bcertificate\s*of\s*analysis\b", re.I)),
    ("laboratory report", re.compile(r"\blaboratory\s*report\b", re.I)),
    ("analytical report", re.compile(r"\banalytical\s*report\b", re.I)),
    ("sample id", re.compile(r"\bsample\s*id\s*[:#]", re.I)),
    ("lab sample no", re.compile(r"\blab\s*sample\s*(?:no\.?|number|id)\b", re.I)),
    ("method detection limit", re.compile(r"\bmethod\s*detection\s*limit\b", re.I)),
    ("reporting limit", re.compile(r"\breporting\s*limit\b", re.I)),
    ("PLM/TEM method or analysis", re.compile(r"\b(?:plm|tem)\s*(?:method|analysis)\b", re.I)),
    ("% asbestos", re.compile(r"%\s*asbestos\b", re.I)),
    ("asbestos content", re.compile(r"\basbestos\s*content\b", re.I)),
    ("f/cc or fibers/cc", re.compile(r"\bf\s*/\s*cc\b|\bfibers?\s*/\s*cc\b", re.I)),
    ("results of analysis", re.compile(r"\bresults?\s*of\s*analysis\b", re.I)),
]

# ---- memo_letter --------------------------------------------------------------
RE_FROM = re.compile(r"(?m)^\s*From\s*:", re.I)
RE_TO = re.compile(r"(?m)^\s*To\s*:", re.I)
RE_DEAR = re.compile(r"(?m)^\s*Dear\s+\S", re.I)
RE_RE_HEADER = re.compile(r"(?m)^\s*Re\s*:", re.I)

# ---- photo_log ------------------------------------------------------------------
RE_PHOTO_LOG = re.compile(r"\bphoto(?:graph)?\s*log\b|\blist\s*of\s*photographs?\b|\bphoto\s*index\b", re.I)

# ---- form (fallback) -------------------------------------------------------------
RE_CHECKBOX = re.compile(r"[❑□☐]|\[\s?\]")
RE_NUMBERED_FIELD = re.compile(r"(?m)^\s*\d{1,2}\.\s+[A-Z]")


def strip_watermark(text: str) -> str:
    return WATERMARK_RE.sub("", text or "")


def classify(page1: str, full: str, n_pages: int) -> tuple[str, float, str]:
    """(doc_type, confidence, reason) — first matching rule wins, in the priority order documented
    above. `page1` and `full` both have the portal watermark already stripped."""
    if n_pages == 1 and RE_BLOCK_LOT.search(page1):
        if RE_BIN.search(page1):
            return ("cover_sheet", 0.9, "single page; address header + Block/Lot + BIN (NYC DEP property cover sheet)")
        return ("cover_sheet", 0.55, "single page with Block/Lot but no BIN match (possible OCR miss on the BIN line)")

    if RE_CHAIN_OF_CUSTODY.search(full):
        return ("chain_of_custody", 0.85, 'literal "chain of custody"')

    if RE_SIGN_IN.search(full):
        return ("sign_in_sheet", 0.85, 'literal "sign-in sheet"')

    if RE_INVOICE.search(full):
        m = RE_INVOICE.search(full)
        return ("invoice", 0.7, f"invoice header vocabulary ({m.group(0)!r})")

    if RE_PERMIT.search(full):
        m = RE_PERMIT.search(full)
        return ("permit_application", 0.6, f"permit/notification vocabulary ({m.group(0)!r})")

    lab_hits = [name for name, pat in RE_LAB_SIGNALS if pat.search(full)]
    if lab_hits:
        conf = 0.65 if len(lab_hits) >= 2 else 0.45
        return ("lab_report", conf, "analytical-report signals: " + ", ".join(lab_hits[:4]))

    has_from, has_to, has_dear, has_re = (RE_FROM.search(page1), RE_TO.search(page1), RE_DEAR.search(page1), RE_RE_HEADER.search(page1))
    if (has_from and has_to) or has_dear:
        return ("memo_letter", 0.75, "From:/To: header block or a Dear salutation")
    if has_re and (has_from or has_to):
        return ("memo_letter", 0.6, "Re: header plus a From: or To: line")
    if has_re or has_dear or has_from or has_to:
        return ("memo_letter", 0.45, "a single From:/To:/Re:/Dear header line")

    if RE_PHOTO_LOG.search(full):
        return ("photo_log", 0.6, 'literal "photo log" / "list of photographs"')

    n_checkbox = len(RE_CHECKBOX.findall(full))
    n_numbered = len(RE_NUMBERED_FIELD.findall(full))
    if n_checkbox >= 3 or n_numbered >= 4:
        return ("form", 0.4, f"structured form heuristic: {n_checkbox} checkbox marks, {n_numbered} numbered fields")

    return ("other", 0.0, "no rule matched")


def load_page_status() -> dict[tuple[str, int], str]:
    path = EMB / "pages.sqlite"
    if not path.exists():
        return {}
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    out = {(doc, page): status for doc, page, status in con.execute("SELECT doc, page, status FROM pages")}
    con.close()
    return out


def doc_text(f: Path, page_status: dict[tuple[str, int], str]) -> tuple[str, str, int]:
    """(page1_text, full_text, n_pages), watermark stripped, OCR-overlaid for pages recorded
    `empty` (same rule load_site_pg.py uses for site.page_text)."""
    doc = f.name[: -len(".pages.jsonl")]
    ocr_path = f.with_name(f"{doc}.ocr.jsonl")
    ocr_map: dict[int, str] = {}
    if ocr_path.exists():
        for line in ocr_path.open():
            if not line.strip():
                continue
            r = json.loads(line)
            ocr_map[int(r["page"])] = r.get("text") or ""

    page1 = ""
    parts: list[str] = []
    n_pages = 0
    for line in f.open():
        if not line.strip():
            continue
        row = json.loads(line)
        page = int(row["page"])
        n_pages += 1
        text = row.get("text") or ""
        if page_status.get((doc, page)) == "empty" and page in ocr_map:
            text = ocr_map[page]
        text = strip_watermark(text)
        parts.append(text)
        if page == 1:
            page1 = text
    return page1, "\n".join(parts), n_pages


def load_existing(out_path: Path) -> dict[str, dict]:
    if not out_path.exists():
        return {}
    out: dict[str, dict] = {}
    with out_path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("doc"):
                out[row["doc"]] = row
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_PATH))
    ap.add_argument("--limit", type=int, default=0, help="classify only the first N documents (smoke test)")
    args = ap.parse_args()
    out_path = Path(args.out)

    t0 = time.time()
    page_status = load_page_status()
    existing = load_existing(out_path)

    files = sorted(TEXT.rglob("*.pages.jsonl"))
    if args.limit:
        files = files[: args.limit]

    rows: list[dict] = []
    reused = 0
    dist: collections.Counter = collections.Counter()
    conf_sum: collections.defaultdict = collections.defaultdict(float)

    for f in files:
        doc = f.name[: -len(".pages.jsonl")]
        page1, full, n_pages = doc_text(f, page_status)
        text_sha1 = hashlib.sha1(full.encode("utf-8", "ignore")).hexdigest()

        cached = existing.get(doc)
        if cached and cached.get("text_sha1") == text_sha1 and cached.get("rules_version") == RULES_VERSION:
            row = cached
            reused += 1
        else:
            doc_type, confidence, reason = classify(page1, full, n_pages)
            row = {
                "doc": doc, "doc_type": doc_type, "confidence": confidence, "reason": reason,
                "text_sha1": text_sha1, "rules_version": RULES_VERSION,
            }

        rows.append(row)
        dist[row["doc_type"]] += 1
        conf_sum[row["doc_type"]] += row["confidence"]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    with tmp_path.open("w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
    tmp_path.replace(out_path)

    distribution = {
        t: {"count": n, "mean_confidence": round(conf_sum[t] / n, 3)} for t, n in dist.most_common()
    }
    summary = {
        "out": str(out_path),
        "documents": len(rows),
        "reused_from_cache": reused,
        "reclassified": len(rows) - reused,
        "seconds": round(time.time() - t0, 2),
        "distribution": distribution,
    }
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
