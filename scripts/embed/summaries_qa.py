#!/usr/bin/env python3
"""Quality pass over every document title and summary (Henry, 2026-09-14: "do a quality check over
all the summaries. read the text, check if anything looks poor quality and resummarize").

Three stages, all resumable, one model call in flight at a time:

  screen   Heuristics over every titled row (no model): placeholder/generic titles, titles that only
           repeat the folder label, missing or one-word summaries, format junk, low model confidence,
           and a grounding score (share of the title's content words found, OCR-tolerantly, in the
           document's own excerpt/folder/box/agency). Writes flags into the QA file.
  review   The model reads each document's excerpt next to its current title+summary and returns
           "ok" or a corrected pair with a one-line reason, under a strict rubric. Every document,
           batches of 20, resumable; corrections go through the same privacy check as summaries.py.
  apply    Writes accepted corrections into p5-summaries.jsonl (same input hash, so the daily refresh
           reuses them) and a Markdown report with counts and before/after examples.

    SUMMARIES_BACKEND=ollama .venv/bin/python -u scripts/embed/summaries_qa.py screen
    SUMMARIES_BACKEND=ollama .venv/bin/python -u scripts/embed/summaries_qa.py review [--flagged-only] [--limit N]
    .venv/bin/python scripts/embed/summaries_qa.py apply
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import summaries as S  # noqa: E402  (shares backends, redaction, privacy check, paths)

QA_PATH = S.EMB / "p5-summaries-qa.jsonl"
REPORT_PATH = S.REPO / "docs" / "eval" / "summaries-qa-report.md"
BATCH = int(S.os.environ.get("SUMMARIES_QA_BATCH", "20"))
CHECKPOINT_EVERY = 200

PLACEHOLDER_TITLES = re.compile(
    r"^(untitled|unknown|document|record|report|form|page|n/?a|none|no title|"
    r"unclassified document|no readable text|\(no readable text\)|illegible( document)?|blank( page)?)\b[\s.,;:-]*$",
    re.I)
BOILERPLATE = re.compile(r"\b(this document|the document|the excerpt|this excerpt|this record|the record|ocr|the text|"
                         r"cannot be determined|unable to determine|not enough information|insufficient)\b", re.I)
JUNK = re.compile(r"[{}\[\]<>|\\]|\bid\s*[:=]|\"title\"|\btitle:|\bsummary:|^\s*[-*•]")
TRUNCATED = re.compile(r"(\.\.\.|…)\s*$|[A-Za-z0-9,;]$")  # ellipsis, or ends mid-clause with no closing punctuation
STOP = {"the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "at", "by", "with", "from", "re", "vs",
        "record", "records", "report", "reports", "form", "forms", "document", "documents", "sheet", "memo",
        "letter", "log", "list", "summary", "results", "analysis", "notice", "page", "pages", "dated",
        "regarding", "concerning", "about", "into", "per", "no", "not", "is", "are", "was", "were", "be"}

REVIEW_PROMPT = (
    "You are checking machine-written titles and one-sentence summaries for documents in a public archive of "
    "New York City's 9/11 environmental and administrative records. For each document you get: its rule-based "
    "type, City folder label, box, agency, page count, an excerpt from its first readable page, and the CURRENT "
    "title and summary.\n\n"
    "Decide for each whether the current title+summary is acceptable. Return \"ok\" unless at least one of these "
    "holds:\n"
    "  (a) it states something the excerpt/folder/box/agency do not support (wrong substance, wrong place, wrong "
    "date, wrong record type, invented lab or organisation);\n"
    "  (b) it is generic where the excerpt gives specifics (e.g. 'Document from DEP' when the excerpt shows an "
    "asbestos air sample result for a named street);\n"
    "  (c) it describes the excerpt or the OCR instead of the record ('The document appears to be…', "
    "'illegible text');\n"
    "  (d) it is malformed: JSON fragments, brackets, truncated, not English, a title longer than 12 words, a "
    "summary that is not one sentence.\n"
    "When you return \"fix\", write the replacement: title at most 10 words naming WHAT the record is (type, "
    "substance/place/date when the excerpt shows them); summary one sentence, at most 35 words, only facts visible "
    "in the inputs; never the name of a person, never a guess. If the excerpt is unreadable and the current title "
    "is an honest generic one, that is \"ok\".\n\n"
    "Respond with ONLY a JSON array, one object per input item in the same order: "
    "{\"id\": <int>, \"verdict\": \"ok\"|\"fix\", \"reason\": \"<a|b|c|d> short note\", \"title\": \"...\", "
    "\"summary\": \"...\", \"confidence\": 0.0-1.0}. Omit title/summary when verdict is ok.\n\n"
    "Items (JSON, one per line):\n"
)


# ---------------------------------------------------------------- items ------------------------------------------
def build_items() -> dict[str, dict]:
    """Same inputs summaries.py gives the model, keyed by doc; cover sheets excluded (rule-based)."""
    manifest = [json.loads(l) for l in (S.REPO / "data" / "manifest.jsonl").open() if l.strip()]
    doc_types = S.load_doc_types()
    page_status = S.load_page_status()
    page_files = {f.name[: -len(".pages.jsonl")]: f for f in S.TEXT.rglob("*.pages.jsonl")}
    items: dict[str, dict] = {}
    for m in manifest:
        doc = m["bates_start"]
        dt = doc_types.get(doc)
        if dt == "cover_sheet":
            continue
        folder = S.redact_titlecase(m.get("folder_name") or "")
        excerpt = S.redact_titlecase(S.pick_excerpt(doc, page_status, page_files))
        items[doc] = {"doc": doc, "doc_type": dt or "unknown", "folder": folder or None, "box": m.get("box_name"),
                      "agency": m.get("agency"), "page_count": m.get("page_count"), "excerpt": excerpt}
    return items


def load_qa() -> dict[str, dict]:
    if not QA_PATH.exists():
        return {}
    out = {}
    for line in QA_PATH.open():
        if line.strip():
            r = json.loads(line)
            out[r["doc"]] = r
    return out


def save_qa(qa: dict[str, dict]) -> None:
    tmp = QA_PATH.with_suffix(".tmp")
    with tmp.open("w") as f:
        for r in qa.values():
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(QA_PATH)


# ---------------------------------------------------------------- screen -----------------------------------------
def content_words(text: str) -> list[str]:
    return [w for w in re.findall(r"[A-Za-z]{3,}", text.lower()) if w not in STOP]


def grounding(title: str, item: dict) -> float:
    words = content_words(title)
    if not words:
        return 1.0
    g = S._grounded_words(S.item_source(item))
    ok = sum(1 for w in words if S._word_grounded(w, g) or w in S.RECORD_WORDS)
    return ok / len(words)


def screen_row(row: dict, item: dict) -> tuple[list[str], float]:
    title = (row.get("title") or "").strip()
    summary = (row.get("summary") or "").strip()
    flags: list[str] = []
    if not title:
        return ["untitled"], 0.0
    if PLACEHOLDER_TITLES.match(title):
        flags.append("placeholder-title")
    if len(title.split()) < 3:
        flags.append("short-title")
    if len(title.split()) > 12:
        flags.append("long-title")
    folder = (item.get("folder") or "").strip().lower()
    if folder and title.lower().strip(" .") in (folder, f"folder {folder}"):
        flags.append("title-is-folder-label")
    if BOILERPLATE.search(title) or BOILERPLATE.search(summary):
        flags.append("describes-excerpt")
    if JUNK.search(title) or JUNK.search(summary):
        flags.append("format-junk")
    if not summary:
        flags.append("no-summary")
    elif len(summary.split()) < 6:
        flags.append("short-summary")
    elif summary.lower() == title.lower():
        flags.append("summary-repeats-title")
    if summary and TRUNCATED.search(summary):
        flags.append("truncated-summary")
    if (row.get("confidence") or 0) < 0.35:
        flags.append("low-confidence")
    g = grounding(title, item)
    if g < 0.5:
        flags.append("weak-grounding")
    return flags, g


def cmd_screen(args) -> int:
    items = build_items()
    rows = S.load_existing(S.OUT_PATH)
    qa = load_qa()
    counts: Counter = Counter()
    n = 0
    for doc, item in items.items():
        row = rows.get(doc) or {}
        flags, g = screen_row(row, item)
        rec = qa.get(doc, {"doc": doc})
        rec.update({"doc": doc, "flags": flags, "grounding": round(g, 2), "old_title": row.get("title"),
                    "old_summary": row.get("summary"), "old_model": row.get("model")})
        qa[doc] = rec
        n += 1
        for f in flags:
            counts[f] += 1
    save_qa(qa)
    flagged = sum(1 for r in qa.values() if r.get("flags"))
    print(json.dumps({"screened": n, "flagged": flagged, "by_flag": dict(counts.most_common())}, indent=1))
    return 0


# ---------------------------------------------------------------- review -----------------------------------------
def review_prompt(batch: list[dict]) -> str:
    lines = []
    for i, b in enumerate(batch, 1):
        lines.append(json.dumps({
            "id": i, "doc_type": b["doc_type"], "folder": b["folder"] or "(none)", "box": b["box"] or "(none)",
            "agency": b["agency"] or "(none)", "page_count": b["page_count"],
            "excerpt": b["excerpt"] or "(no readable text)",
            "current_title": b["old_title"], "current_summary": b["old_summary"] or "(none)",
        }, ensure_ascii=False))
    return REVIEW_PROMPT + "\n".join(lines)


def call_review(prompt: str) -> list[dict] | None:
    if S.BACKEND == "ollama":
        text = S.call_ollama(prompt)
    elif S.BACKEND == "cli":
        text = S.call_claude_cli(prompt)
    elif S.BACKEND == "codex":
        text = S.call_codex_cli(prompt)
    else:
        import anthropic
        client = anthropic.Anthropic(api_key=S.CLAUDE_KEY_FILE.read_text().strip())
        resp = client.messages.create(model=S.MODEL, max_tokens=4000, system=S.SYSTEM_PROMPT,
                                      messages=[{"role": "user", "content": prompt}])
        text = "".join(getattr(b, "text", "") for b in resp.content)
    arr = S.extract_json_array(text)
    if arr is None:
        print(f"qa: reply not a JSON array ({len(text)} chars): {text[:120]!r}", file=sys.stderr)
    return arr


def cmd_review(args) -> int:
    items = build_items()
    rows = S.load_existing(S.OUT_PATH)
    qa = load_qa()
    roles_words = S.load_roles_words()
    todo = []
    for doc, item in items.items():
        row = rows.get(doc) or {}
        if not row.get("title"):
            continue  # nothing to review; summaries.py owns untitled documents
        rec = qa.get(doc)
        if rec and rec.get("verdict"):
            continue  # resumable
        if args.flagged_only and not (rec and rec.get("flags")):
            continue
        todo.append({**item, "old_title": row.get("title"), "old_summary": row.get("summary")})
    if args.limit:
        todo = todo[: args.limit]
    print(f"qa: reviewing {len(todo)} documents in batches of {BATCH} ({S.BACKEND}: {S.BACKEND_MODEL})", flush=True)
    t0 = time.time()
    done = 0
    since = 0
    verdicts: Counter = Counter()
    for i in range(0, len(todo), BATCH):
        batch = todo[i: i + BATCH]
        by_id = {j + 1: b for j, b in enumerate(batch)}
        try:
            parsed = call_review(review_prompt(batch))
        except Exception as e:
            print(f"qa: batch failed ({e})", file=sys.stderr)
            parsed = None
        seen = set()
        if parsed:
            for r in parsed:
                if not isinstance(r, dict) or r.get("id") not in by_id or r["id"] in seen:
                    continue
                seen.add(r["id"])
                b = by_id[r["id"]]
                rec = qa.setdefault(b["doc"], {"doc": b["doc"]})
                rec.update({"old_title": b["old_title"], "old_summary": b["old_summary"]})
                verdict = str(r.get("verdict") or "ok").lower()
                reason = str(r.get("reason") or "")[:160]
                if verdict == "fix":
                    title = S.clamp_title(str(r.get("title") or "").strip())
                    summary = S.clamp_summary(str(r.get("summary") or ""))
                    problem = S.text_violates(f"{title} {summary}", roles_words, S.item_source(b)) if title else "empty title"
                    if problem:
                        rec.update({"verdict": "fix-rejected", "reason": f"{reason} | privacy: {problem}"})
                    else:
                        conf = r.get("confidence", 0.5)
                        rec.update({"verdict": "fix", "reason": reason, "new_title": title, "new_summary": summary or None,
                                    "new_confidence": float(conf) if isinstance(conf, (int, float)) else 0.5,
                                    "reviewer": S.BACKEND_MODEL})
                else:
                    rec.update({"verdict": "ok", "reason": reason, "reviewer": S.BACKEND_MODEL})
                verdicts[rec["verdict"]] += 1
        missing = [b for j, b in by_id.items() if j not in seen]
        for b in missing:
            verdicts["unreviewed"] += 1  # left without a verdict: picked up again on the next run
        done += len(batch)
        since += len(batch)
        if since >= CHECKPOINT_EVERY or i + BATCH >= len(todo):
            since = 0
            save_qa(qa)
            print(json.dumps({"checkpoint": True, "done": done, "of": len(todo), "seconds": round(time.time() - t0, 1),
                              "verdicts": dict(verdicts)}), flush=True)
    return 0


# ---------------------------------------------------------------- apply ------------------------------------------
def cmd_apply(args) -> int:
    rows = S.load_existing(S.OUT_PATH)
    qa = load_qa()
    applied = 0
    for doc, rec in qa.items():
        if rec.get("verdict") == "fix" and rec.get("new_title") and doc in rows:
            row = rows[doc]
            if rec.get("applied"):
                continue
            rows[doc] = {**row, "title": rec["new_title"], "summary": rec.get("new_summary"),
                         "confidence": rec.get("new_confidence", 0.5), "model": f"{rec.get('reviewer')} (qa)"}
            rec["applied"] = True
            applied += 1
    if applied and not args.dry_run:
        S.write_out(S.OUT_PATH, rows)
        save_qa(qa)
    write_report(qa, applied, args.dry_run)
    print(f"qa: applied {applied} corrections{' (dry run)' if args.dry_run else ''}; report at {REPORT_PATH}")
    return 0


def write_report(qa: dict[str, dict], applied: int, dry: bool) -> None:
    recs = list(qa.values())
    reviewed = [r for r in recs if r.get("verdict")]
    verdicts = Counter(r["verdict"] for r in reviewed)
    flags = Counter(f for r in recs for f in r.get("flags", []))
    reasons = Counter((r.get("reason") or "?")[:1].lower() for r in reviewed if r.get("verdict") == "fix")
    fixes = [r for r in reviewed if r.get("verdict") == "fix"]
    random.seed(7)
    sample = random.sample(fixes, min(20, len(fixes)))
    lines = [f"# Summaries quality pass — {time.strftime('%Y-%m-%d')}", "",
             f"Screened {len(recs):,} documents; {sum(1 for r in recs if r.get('flags')):,} carried at least one heuristic flag.",
             f"Reviewed {len(reviewed):,} by model; verdicts: " + ", ".join(f"{k} {v:,}" for k, v in verdicts.most_common()) + ".",
             f"Corrections applied to the published rows: {applied:,}{' (dry run)' if dry else ''}.", "",
             "## Heuristic flags", "", "| flag | documents |", "|---|---|"]
    lines += [f"| {k} | {v:,} |" for k, v in flags.most_common()]
    lines += ["", "## Why the model changed a title", "", "| rubric | fixes |", "|---|---|"]
    names = {"a": "(a) unsupported by the text", "b": "(b) generic where specifics exist", "c": "(c) describes the excerpt/OCR", "d": "(d) malformed"}
    lines += [f"| {names.get(k, k)} | {v:,} |" for k, v in reasons.most_common()]
    lines += ["", "## Before and after (random sample of corrections)", ""]
    for r in sample:
        lines += [f"**{r['doc']}** — {r.get('reason')}", "", f"- before: {r.get('old_title')} — {r.get('old_summary') or ''}",
                  f"- after: {r.get('new_title')} — {r.get('new_summary') or ''}", ""]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines))


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("screen")
    r = sub.add_parser("review")
    r.add_argument("--flagged-only", action="store_true")
    r.add_argument("--limit", type=int, default=0)
    a = sub.add_parser("apply")
    a.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    return {"screen": cmd_screen, "review": cmd_review, "apply": cmd_apply}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
