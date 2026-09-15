#!/usr/bin/env python3
"""summaries.py — per-document title + one-sentence summary (issue #37).

Local, except for the Claude API calls used for every non-cover-sheet document. Fixes the exact
complaint Henry raised on the topic pages: a list of bare Bates numbers with no indication of what
each record actually is.

For every document, produces:
  title    at most 10 words, what the record is (e.g. "Asbestos bulk sample results, 130 Liberty
           Street, Oct 2001").
  summary  one sentence, at most 180 characters.

Two paths:

  cover_sheet (site.documents.doc_type == 'cover_sheet', from scripts/embed/doctypes.py's
  data/embed/p3-doctypes.jsonl) — RULE-BASED, no model call: title is always
  "Folder cover sheet — <folder>" (or "Folder cover sheet" with no folder label), summary is a
  fixed sentence describing what a City-portal property-lookup cover sheet is. confidence 1.0,
  model NULL (bookkeeping: no API call was made for this row).

  everything else — one claude-haiku-4-5-20251001 call per batch of ~10 documents, JSON array in,
  JSON array out (strict: a batch whose response isn't a JSON array of the right length is retried
  once as one call, then, if still bad, every document in it is written with title=summary=None,
  confidence=0.0, model=None — never a guess). Inputs per document: doc_type, folder label, box,
  agency, page 1 text (<=1500 chars, watermark stripped); if page 1 looks like a cover-sheet-shaped
  page (doctypes.py's Block/Lot+BIN pattern) or is near-empty (<200 chars), page 2 is used instead
  when it exists. Also given: page_count.

Privacy (docs/PLAN.md's non-negotiable rules; same approach as scripts/embed/topics.py):
  - Before anything goes to the model, every TitleCase word-pair in the folder label and the page
    excerpt is replaced with "[name]" UNLESS both words are on the NYC place-word allowlist
    (topics.ALLOWED_PLACE_WORDS) or the pair is a known agency/lab/contractor vocabulary token
    (ORG_ALLOW_WORDS, built from entities.AGENCIES plus generic org words like "Laboratory"/"Inc").
  - Every model output (title + summary together) is checked the same way topics.py checks a topic
    title: a TitleCase pair not on the allowlists, or any word that appears in the entities.sqlite
    roles table (roles.name_norm, filtered to non-dictionary tokens the same way topics.py does) is
    a rejection. A rejected batch is retried ONCE, for just the rejected items, with a note telling
    the model to rewrite without any person's name. Still-rejected items are written with
    title=summary=None, confidence=0.0, model=None rather than ever shown with a name in it.
  - The prompt explicitly forbids describing any identifiable individual's health, medical,
    exposure or diagnosis details — subject matter and process only (what was tested/inspected/
    requested/recorded, where, when).
  - Nothing here ever contacts the City's portal.

Cache: data/embed/p5-summaries-cache.json, keyed by sha256(doc_type|folder(redacted)|box|agency|
page_count|excerpt(redacted)) — a re-run only re-asks the model for a document whose classified
inputs actually changed (a doctypes.py reclassification, new/changed OCR text, etc.).

Incremental/resumable: data/embed/p5-summaries.jsonl carries one row per document; a document whose
input hash matches its cached row (SUMMARIES_VERSION also unchanged) is skipped entirely, and
progress (rows done, running cost) is checkpointed to disk every CHECKPOINT documents, so a killed
and restarted run picks up close to where it left off rather than from zero.

Budget: --budget-usd (default 30.0, per Henry's cap for the whole corpus). The run stops issuing
new API calls once the running cost reaches the cap and reports stopped_on_budget=true; every
document already resolved (by rule or by an earlier call) is kept.

Clean stop on an account-level usage limit (distinct from --budget-usd above, and from a plain
network/JSON hiccup, which stays a per-batch retry): if the Anthropic account itself has hit its
own usage cap (HTTP 400, "You have reached your specified API usage limits..."), the run logs it
ONCE, stops issuing further calls (every remaining batch resolves instantly to
title=summary=None), and exits 0 — this is an expected stop condition, not a crash. Rerun the same
command later (once the cap resets, or with a different key) to resume exactly where it left off,
via the cache and the output jsonl.

Usage:
  .venv/bin/python scripts/embed/summaries.py [--out data/embed/p5-summaries.jsonl] [--limit N]
                                               [--budget-usd 30] [--workers 6]

Output: one JSON object per line — {doc, title, summary, confidence, model, hash}. Always prints a
one-line JSON progress summary (documents done, by-rule vs by-model vs rejected/failed, cost so
far, seconds) at every checkpoint and at the end.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import hashlib
import json
import os
import re
import sqlite3
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from doctypes import RE_BIN, RE_BLOCK_LOT, WATERMARK_RE  # noqa: E402
from entities import AGENCIES  # noqa: E402
from related import displayable, shown_vocab  # noqa: E402
from topics import ALLOWED_PLACE_WORDS, RE_TITLECASE_PAIR  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
TEXT = REPO / "data" / "text"
EMB = REPO / "data" / "embed"
OUT_PATH = EMB / "p5-summaries.jsonl"
CACHE_PATH = EMB / "p5-summaries-cache.json"
DOCTYPES_JSONL = EMB / "p3-doctypes.jsonl"
CLAUDE_KEY_FILE = Path("/Users/henry/Code/sept11-docs/.claudekey")
MODEL = "claude-haiku-4-5-20251001"
PRICE_IN_PER_MTOK = 1.00
PRICE_OUT_PER_MTOK = 5.00
DEFAULT_BUDGET_USD = 30.0
BATCH_SIZE = int(os.environ.get("SUMMARIES_BATCH", "10"))  # documents per model call; 20 with the claude -p backend (process start-up dominates)
CHECKPOINT_EVERY = 500  # documents (across all batches), not API calls

# Bumped whenever the prompt, the excerpt selection or the privacy rules below change, so a cached
# row with an old SUMMARIES_VERSION is never carried over unexamined (same convention as
# doctypes.py's RULES_VERSION).
SUMMARIES_VERSION = 2

MAX_EXCERPT_CHARS = 1500
NEAR_EMPTY_CHARS = 200
MAX_TITLE_WORDS = 10
MAX_SUMMARY_CHARS = 180

# Organisation-vocabulary tokens allowed in a title/summary even though they are TitleCase pairs —
# built from entities.py's AGENCIES gazetteer plus generic lab/contractor-organisation words. Kept
# separate from topics.ALLOWED_PLACE_WORDS (place names only) since a document title routinely
# needs to say "Department of Environmental Protection" or "ABC Laboratories".
ORG_ALLOW_WORDS = {w.lower() for phrase in AGENCIES for w in re.findall(r"[A-Za-z]+", phrase)} | {
    "laboratory", "laboratories", "labs", "lab", "analytical", "testing", "environmental",
    "engineering", "engineers", "consultants", "consulting", "contracting", "contractors",
    "construction", "associates", "services", "inc", "corp", "corporation", "company", "llc", "co",
    "the", "of", "and", "for",
}
ALLOWED_WORDS = ALLOWED_PLACE_WORDS | ORG_ALLOW_WORDS


def redact_titlecase(text: str) -> str:
    """Same rule as topics.py: strip suspected person names (TitleCase word pairs) unless both
    words are on the place/organisation allowlists."""
    def repl(m: re.Match) -> str:
        w1, w2 = m.group(1), m.group(2)
        if w1.lower() in ALLOWED_WORDS and w2.lower() in ALLOWED_WORDS:
            return m.group(0)
        return "[name]"
    return RE_TITLECASE_PAIR.sub(repl, text or "")


def _grounded_words(source: str) -> set[str]:
    """Lower-cased words of the source text plus their 4-letter stems, so an OCR-mangled
    'Montgomry' still grounds 'Montgomery' and 'Reservoir' grounds 'Reservoirs'."""
    words: set[str] = set()
    for w in re.findall(r"[A-Za-z]+", source):
        w = w.lower()
        words.add(w)
        if len(w) >= 4:
            words.add(w[:4])
    return words


def _word_grounded(w: str, grounded: set[str]) -> bool:
    return w in grounded or (len(w) >= 4 and w[:4] in grounded)


def text_violates(text: str, roles_words: set[str], source: str = "") -> str | None:
    """Same check topics.py runs on a candidate topic title, applied to a title+summary pair.

    A Title-Case pair ("Westchester County", "Montgomery Watson") is allowed when both words are
    domain/place words OR both appear in the document's own text/folder/box/agency (OCR-tolerant):
    the model may repeat a place or company the record names, it may never introduce one. Words
    that are known person names from the roles table are always rejected, grounded or not, so a
    redacted person is never reconstructed from a title."""
    grounded = _grounded_words(source) if source else set()
    for m in RE_TITLECASE_PAIR.finditer(text):
        w1, w2 = m.group(1).lower(), m.group(2).lower()
        allowed = (w1 in ALLOWED_WORDS or _word_grounded(w1, grounded)) and \
                  (w2 in ALLOWED_WORDS or _word_grounded(w2, grounded))
        if not allowed:
            return f"contains a name-like phrase ('{m.group(0)}')"
    for w in re.findall(r"[A-Za-z]+", text):
        if w.lower() in roles_words:
            return f"contains a name from the roles table ('{w}')"
    return None


def item_source(it: dict) -> str:
    """Everything the model was shown for one document: the text a title may legitimately repeat."""
    return " ".join(str(it.get(k) or "") for k in ("excerpt", "folder", "box", "agency"))


def load_roles_words() -> set[str]:
    """Same construction as topics.py's roles_words: entities.sqlite roles.name_norm tokens that
    are NOT real dictionary/domain words (the false-positive extractions overwhelmingly pass the
    dictionary test; genuine surnames overwhelmingly fail it)."""
    path = EMB / "entities.sqlite"
    if not path.exists():
        return set()
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    roles_names = [r[0] for r in con.execute("SELECT DISTINCT name_norm FROM roles")]
    con.close()
    shown = shown_vocab()
    out: set[str] = set()
    for nm in roles_names:
        for w in re.findall(r"[A-Za-z]+", nm):
            wl = w.lower()
            if len(wl) > 1 and wl not in ALLOWED_WORDS and not displayable(wl, shown) \
                    and wl not in COMMON_NOT_NAMES and not inflected_dictionary_word(wl):
                out.add(wl)
    return out


# Ordinary words the roles extractor has mistaken for people; never a reason to reject a title.
COMMON_NOT_NAMES = {"signed", "dated", "received", "submitted", "approved", "reviewed", "analyzed",
                    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}


def _dictionary_lower() -> set[str]:
    try:
        with open("/usr/share/dict/words") as fh:
            return {w.strip() for w in fh if w.strip() and w[0].islower()}
    except OSError:
        return set()


_DICT_LOWER = _dictionary_lower()


def inflected_dictionary_word(w: str) -> bool:
    """'submitted', 'monitoring', 'analyzed': an -ed/-ing form of a dictionary verb of 5+ letters.
    Surnames that happen to end the same way ('Harding' = hard+ing) keep a stem under 5 letters
    and stay in the list."""
    for suf in ("ed", "ing"):
        if w.endswith(suf) and len(w) - len(suf) >= 5:
            stem = w[:-len(suf)]
            cands = {stem, stem + "e"}
            if len(stem) > 2 and stem[-1] == stem[-2]:
                cands.add(stem[:-1])
            if any(c in _DICT_LOWER for c in cands):
                return True
    return False


def load_page_status() -> dict[tuple[str, int], str]:
    path = EMB / "pages.sqlite"
    if not path.exists():
        return {}
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    out = {(doc, page): status for doc, page, status in con.execute("SELECT doc, page, status FROM pages")}
    con.close()
    return out


def load_doc_types() -> dict[str, str]:
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


def page_text(doc: str, page: int, page_status: dict[tuple[str, int], str], page_files: dict[str, Path]) -> str:
    """One page's text, watermark stripped, OCR-overlaid for a page recorded `empty` (same rule as
    doctypes.py/load_site_pg.py). Empty string if the page doesn't exist or has no text."""
    f = page_files.get(doc)
    if not f:
        return ""
    ocr_path = f.with_name(f"{doc}.ocr.jsonl")
    ocr_map: dict[int, str] = {}
    if page_status.get((doc, page)) == "empty" and ocr_path.exists():
        for line in ocr_path.open():
            if not line.strip():
                continue
            r = json.loads(line)
            if int(r["page"]) == page:
                ocr_map[page] = r.get("text") or ""
                break
    for line in f.open():
        if not line.strip():
            continue
        row = json.loads(line)
        if int(row["page"]) == page:
            text = ocr_map.get(page, row.get("text") or "")
            return WATERMARK_RE.sub("", text).strip()
    return ""


def looks_like_cover_sheet_page(text: str) -> bool:
    return bool(RE_BLOCK_LOT.search(text) and RE_BIN.search(text))


def pick_excerpt(doc: str, page_status: dict[tuple[str, int], str], page_files: dict[str, Path]) -> str:
    p1 = page_text(doc, 1, page_status, page_files)
    if len(p1) >= NEAR_EMPTY_CHARS and not looks_like_cover_sheet_page(p1):
        return p1[:MAX_EXCERPT_CHARS]
    p2 = page_text(doc, 2, page_status, page_files)
    return (p2 or p1)[:MAX_EXCERPT_CHARS]


def cover_sheet_address(folder: str | None) -> str | None:
    """A DEP cover-sheet folder label is the WHOLE property-lookup line — e.g. "8 HENRY STREET
    Block: 279 Lot: 40 BIN: 1003375 AKA's: 16-22 Oliver Street, 26-32 Catherine Street" — not a
    short label (docs/PLAN.md issue #30: some folder labels here are the raw sheet text). Keep only
    the address portion before "Block ... Lot ...", Title Cased (the source is ALL CAPS)."""
    if not folder:
        return None
    m = RE_BLOCK_LOT.search(folder)
    head = (folder[: m.start()] if m else folder).strip(" -–—;,")
    return head.title() if head else None


def cover_sheet_title(folder: str | None) -> str:
    address = cover_sheet_address(folder)
    return f"Folder cover sheet — {address}" if address else "Folder cover sheet"


COVER_SHEET_SUMMARY = (
    "A City-portal property-lookup separator page (address, Block/Lot, BIN) filed ahead of the "
    "folder's substantive records, not a record of its own."
)


def input_hash(doc_type: str | None, folder: str | None, box: str | None, agency: str | None,
                page_count: int | None, excerpt: str) -> str:
    key = json.dumps(
        {"doc_type": doc_type, "folder": folder, "box": box, "agency": agency,
         "page_count": page_count, "excerpt": excerpt, "v": SUMMARIES_VERSION},
        sort_keys=True,
    )
    return hashlib.sha256(key.encode("utf-8", "replace")).hexdigest()


SYSTEM_PROMPT = (
    "You are writing short, factual titles and one-sentence summaries for individual documents in "
    "a public archive of New York City's 9/11 environmental and administrative records (lab "
    "reports, chain-of-custody forms, inspection memos, permits, correspondence, sign-in sheets, "
    "invoices, other forms). You are given, for each document: its rule-based document type (may "
    "be 'other'/unknown), its City-assigned folder label, box, agency, page count, and an excerpt "
    "from its first readable page.\n\n"
    "For each document write:\n"
    '  "title": at most 10 words, describing WHAT this record is — record type, substance/subject, '
    "building or site, and month/year, whichever are visible in the excerpt or fields. Example: "
    '"Asbestos bulk sample results, 130 Liberty Street, Oct 2001".\n'
    '  "summary": one plain sentence, at most 180 characters, describing the content and purpose '
    "of the record.\n\n"
    "Rules:\n"
    "- Never name, identify or imply the identity of any private individual. Suspected personal "
    "names in the excerpt have already been replaced with [name] — never try to guess, reconstruct "
    "or refer to a redacted or removed name, and never write a title or summary that describes a "
    "specific NAMED person's health, medical condition, exposure or diagnosis.\n"
    "- Describe subject matter and process only: what was tested, inspected, requested, permitted "
    "or recorded, where, and when.\n"
    "- If the excerpt is too thin or generic to say anything specific, still write a plausible, "
    "generic-but-honest title/summary from the folder/box/agency/doc_type fields alone (e.g. "
    '"Correspondence regarding DEP asbestos inspection") rather than leaving it empty.\n'
    "- Respond with ONLY a JSON array, no prose, no markdown fences, one object per input item in "
    'the same order: {"id": <int>, "title": "...", "summary": "...", "confidence": 0.0-1.0}.'
)


def build_prompt(items: list[dict], retry_ids: set[int] | None = None) -> str:
    lines = ["Documents:" if not retry_ids else
             "Documents (REWRITE ONLY these — your previous title or summary for each contained a "
             "name-like phrase or a name from the record's own roles list; describe the subject "
             "matter only, with no person's name):"]
    for it in items:
        if retry_ids is not None and it["id"] not in retry_ids:
            continue
        lines.append(json.dumps({
            "id": it["id"], "doc_type": it["doc_type"] or "unknown", "folder": it["folder"] or "(none)",
            "box": it["box"] or "(none)", "agency": it["agency"] or "(none)",
            "page_count": it["page_count"], "excerpt": it["excerpt"] or "(no readable text)",
        }))
    return "\n".join(lines)


def extract_json_array(text: str) -> list[dict] | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return None
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


class Budget:
    def __init__(self, cap: float):
        self.cap = cap
        self.spent = 0.0
        self.lock = threading.Lock()

    def add(self, usd: float) -> None:
        with self.lock:
            self.spent += usd

    def exhausted(self) -> bool:
        with self.lock:
            return self.spent >= self.cap


class Cache:
    """data/embed/p5-summaries-cache.json: hash -> {title, summary, confidence, model}, the FINAL
    (post-privacy-check) result for that exact input. Keyed by input hash rather than by doc, so
    two different documents that happen to hash identically (e.g. two near-duplicate cover pages
    with the same folder/box/agency/excerpt) never pay for the same Haiku call twice, and a re-run
    after deleting the output jsonl still costs nothing for hashes already seen."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.data: dict[str, dict] = {}
        if path.exists():
            try:
                self.data = json.loads(path.read_text())
            except (OSError, json.JSONDecodeError):
                self.data = {}
        self._dirty = False

    def get(self, h: str) -> dict | None:
        with self.lock:
            return self.data.get(h)

    def put(self, h: str, result: dict) -> None:
        with self.lock:
            self.data[h] = result
            self._dirty = True

    def save(self) -> None:
        with self.lock:
            if not self._dirty:
                return
            tmp = self.path.with_suffix(self.path.suffix + ".tmp")
            tmp.write_text(json.dumps(self.data))
            tmp.replace(self.path)
            self._dirty = False


class StopSignal:
    """Set the moment a call fails with a hard, RUN-ENDING error — the Anthropic account hit its
    own usage-limit cap (HTTP 400, "You have reached your specified API usage limits...", distinct
    from this script's own --budget-usd and from a transient rate limit) — checked before every
    subsequent API call so the run stops issuing new requests once this happens, rather than
    re-attempting a guaranteed-to-fail call for every one of the thousands of remaining batches
    (observed live, 2026-09-14: the key hit its cap ~7,000 documents in and the run kept hammering
    the API for the rest of the corpus before being killed by hand). `reason` is logged exactly
    once; every batch after that resolves instantly to title=summary=None, same as a budget-
    exhausted batch — never a crash, and main() still exits 0 (this is an expected stop condition,
    not a bug)."""

    def __init__(self) -> None:
        self.event = threading.Event()
        self.reason: str | None = None
        self.lock = threading.Lock()

    def set(self, reason: str) -> None:
        with self.lock:
            already_set = self.event.is_set()
            if not already_set:
                self.reason = reason
        if not already_set:
            print(f"summaries: stopping cleanly — {reason} (resume later: cache and jsonl are intact)", file=sys.stderr)
        self.event.set()

    def is_set(self) -> bool:
        return self.event.is_set()


def is_usage_limit_error(e: BaseException) -> bool:
    """True for Anthropic's account-level usage-limit cap specifically — a run-ending condition —
    never for an ordinary transient error (timeout, 5xx, malformed JSON), which stays a per-batch
    retry case."""
    return "usage limit" in str(e).lower()


BACKEND = os.environ.get("SUMMARIES_BACKEND", "api")  # "api" (Anthropic SDK), "cli" (claude -p), "codex" (codex exec) or "ollama" (local)
CODEX_MODEL = os.environ.get("SUMMARIES_CODEX_MODEL", "gpt-5.3-codex-spark")
OLLAMA_URL = os.environ.get("SUMMARIES_OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("SUMMARIES_OLLAMA_MODEL", "qwen3.5:35b-a3b")
BACKEND_MODEL = {"codex": CODEX_MODEL, "ollama": OLLAMA_MODEL}.get(BACKEND, MODEL)  # what the row records as its author


def call_claude_cli(prompt: str) -> str:
    """2026-09-14 (Henry: "switch to doing the summaries in haiku via claude -p"): run the same
    prompt through the Claude Code CLI in print mode, which bills the subscription rather than the
    API key and, on the day, answered in ~3 s per batch where the API was crawling. No tools, no
    session persistence, the same system prompt. The CLI must not inherit an API key or the
    nested-session marker, or it either bills the key or refuses to start."""
    import subprocess
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    proc = subprocess.run(
        ["claude", "-p", "--model", MODEL, "--output-format", "json", "--no-session-persistence",
         "--tools", "", "--system-prompt", SYSTEM_PROMPT],
        input=prompt, capture_output=True, text=True, env=env, timeout=240,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude -p exited {proc.returncode}: {proc.stderr.strip()[:300]}")
    data = json.loads(proc.stdout)
    if data.get("is_error"):
        msg = str(data.get("result", ""))[:300]
        if "usage limit" in msg.lower() or "rate limit" in msg.lower():
            raise RuntimeError("usage limit: " + msg)
        raise RuntimeError("claude -p error: " + msg)
    return str(data.get("result", ""))


def call_codex_cli(prompt: str) -> str:
    """2026-09-14 (Henry): the same prompt through the Codex CLI on a ChatGPT plan. gpt-5.3-codex-spark
    returned a full 20-document batch in ~7 s in testing (claude -p: ~25 s). Runs read-only from the
    repo (Codex only trusts configured directories); the system prompt is prepended because codex exec
    has no system-prompt flag. A quota/usage error is raised as "usage limit" so the run stops cleanly
    instead of writing empty rows — and Henry's banked resets are never touched by this script."""
    import subprocess, tempfile
    with tempfile.NamedTemporaryFile("w+", suffix=".txt", delete=False) as out:
        out_path = out.name
    proc = subprocess.run(
        ["codex", "exec", "-C", str(REPO), "--sandbox", "read-only", "-m", CODEX_MODEL, "-o", out_path, "-"],
        input=SYSTEM_PROMPT + "\n\n" + prompt, capture_output=True, text=True, timeout=300,
    )
    text = Path(out_path).read_text() if Path(out_path).exists() else ""
    Path(out_path).unlink(missing_ok=True)
    err = (proc.stderr + proc.stdout).lower()
    if proc.returncode != 0 or not text.strip():
        if "usage limit" in err or "quota" in err or "rate limit" in err or "too many requests" in err:
            raise RuntimeError("usage limit: codex " + err[-200:])
        raise RuntimeError(f"codex exec exited {proc.returncode}: {proc.stderr.strip()[-300:]}")
    return text


def call_ollama(prompt: str) -> str:
    """Local model on StudioMac (Henry, 2026-09-14: "test some local models on ollama"). Measured on a
    real 20-document batch: qwen3.5:35b-a3b 28 s / all 20 usable, with dates and lab names in the
    titles; qwen3.5 (8B) 42 s; qwen2.5:7b 20 s but generic titles; llama3.2 no valid JSON. No quota,
    no spend — the right backend for the daily refresh's small increments."""
    import urllib.request
    body = {"model": OLLAMA_MODEL, "stream": False, "think": False,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
            "options": {"temperature": 0.2, "num_ctx": 16384, "num_predict": 3000}}
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as resp:
        data = json.loads(resp.read())
    return str(data.get("message", {}).get("content", ""))


def call_model(client, items: list[dict], budget: Budget, stop: StopSignal, retry_ids: set[int] | None = None) -> tuple[list[dict] | None, float]:
    prompt = build_prompt(items, retry_ids)
    if BACKEND == "ollama":
        return extract_json_array(call_ollama(prompt)), 0.0  # local: no spend
    if BACKEND == "codex":
        try:
            text = call_codex_cli(prompt)
        except RuntimeError as e:
            if "usage limit" in str(e):
                stop.set(str(e))
            raise
        return extract_json_array(text), 0.0  # plan-billed: no API spend to count
    if BACKEND == "cli":
        try:
            text = call_claude_cli(prompt)
        except RuntimeError as e:
            if "usage limit" in str(e):
                stop.set(str(e))
            raise
        return extract_json_array(text), 0.0  # subscription-billed: no API spend to count
    try:
        response = client.messages.create(
            model=MODEL, max_tokens=200 * (len(retry_ids) if retry_ids else len(items)) + 200,
            system=SYSTEM_PROMPT, messages=[{"role": "user", "content": prompt}],
        )
    except Exception as e:
        if is_usage_limit_error(e):
            stop.set(str(e))
        raise
    text = "".join(b.text for b in response.content if b.type == "text")
    cost = (response.usage.input_tokens * PRICE_IN_PER_MTOK
            + response.usage.output_tokens * PRICE_OUT_PER_MTOK) / 1_000_000
    budget.add(cost)
    return extract_json_array(text), cost


def clamp_title(title: str) -> str:
    words = title.strip().split()
    return " ".join(words[:MAX_TITLE_WORDS])


def clamp_summary(summary: str) -> str:
    """Truncate on a word boundary rather than mid-word (a hard [:MAX_SUMMARY_CHARS] slice produced
    ugly cutoffs like "...9 of 44 LCS sta" on the first live run)."""
    s = summary.strip()
    if len(s) <= MAX_SUMMARY_CHARS:
        return s
    cut = s[:MAX_SUMMARY_CHARS].rsplit(" ", 1)[0].rstrip(",.;:—-")
    return (cut or s[:MAX_SUMMARY_CHARS]) + "…"


def process_batch(client, items: list[dict], roles_words: set[str], budget: Budget, cache: Cache, stop: StopSignal) -> list[dict]:
    """items: list of {id, doc, doc_type, folder, box, agency, page_count, excerpt(redacted), hash}.
    Returns one output row per item (doc, title, summary, confidence, model, hash). `items` passed
    in here have already been filtered to exclude cache hits (see main()) — every call in this
    function is a real, billed Haiku request."""
    by_id = {it["id"]: it for it in items}
    results: dict[int, dict] = {}

    if budget.exhausted() or stop.is_set():
        return [{"doc": it["doc"], "title": None, "summary": None, "confidence": 0.0, "model": None,
                  "hash": it["hash"]} for it in items]

    try:
        parsed, _cost = call_model(client, items, budget, stop)
    except Exception as e:
        if not stop.is_set():
            print(f"summaries: batch failed ({e}); leaving {len(items)} document(s) unresolved", file=sys.stderr)
        parsed = None

    violators: set[int] = set()
    if parsed:
        for row in parsed:
            if not isinstance(row, dict) or "id" not in row:
                continue
            iid = row.get("id")
            if iid not in by_id:
                continue
            title = str(row.get("title") or "").strip()
            summary = clamp_summary(str(row.get("summary") or ""))
            if not title:
                continue
            title = clamp_title(title)
            problem = text_violates(f"{title} {summary}", roles_words, item_source(by_id[iid]))
            if problem:
                violators.add(iid)
                continue
            conf = row.get("confidence", 0.5)
            cache_val = {"title": title, "summary": summary or None,
                         "confidence": float(conf) if isinstance(conf, (int, float)) else 0.5, "model": BACKEND_MODEL}
            results[iid] = {"doc": by_id[iid]["doc"], "hash": by_id[iid]["hash"], **cache_val}
            cache.put(by_id[iid]["hash"], cache_val)
    else:
        violators = set(by_id)  # malformed response: treat every item as needing a retry

    # Anything not already in `results` (dropped for violating the privacy check, never returned
    # by the model at all, or the whole call failed) gets exactly one retry.
    unresolved = set(by_id.keys()) - set(results.keys())

    if unresolved and not budget.exhausted() and not stop.is_set():
        retry_items = [by_id[i] for i in unresolved]
        try:
            parsed2, _cost2 = call_model(client, retry_items, budget, stop, retry_ids=unresolved)
        except Exception as e:
            if not stop.is_set():
                print(f"summaries: retry batch failed ({e}); leaving {len(unresolved)} document(s) unresolved", file=sys.stderr)
            parsed2 = None
        if parsed2:
            for row in parsed2:
                if not isinstance(row, dict) or "id" not in row:
                    continue
                iid = row.get("id")
                if iid not in unresolved:
                    continue
                title = str(row.get("title") or "").strip()
                summary = clamp_summary(str(row.get("summary") or ""))
                if not title:
                    continue
                title = clamp_title(title)
                if text_violates(f"{title} {summary}", roles_words, item_source(by_id[iid])):
                    continue  # still bad after one retry: drop to null, never guess
                conf = row.get("confidence", 0.5)
                cache_val = {"title": title, "summary": summary or None,
                             "confidence": float(conf) if isinstance(conf, (int, float)) else 0.5, "model": BACKEND_MODEL}
                results[iid] = {"doc": by_id[iid]["doc"], "hash": by_id[iid]["hash"], **cache_val}
                cache.put(by_id[iid]["hash"], cache_val)

    for iid, it in by_id.items():
        if iid not in results:
            results[iid] = {"doc": it["doc"], "title": None, "summary": None, "confidence": 0.0,
                             "model": None, "hash": it["hash"]}
    return [results[it["id"]] for it in items]


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


def write_out(out_path: Path, rows: dict[str, dict]) -> None:
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    with tmp.open("w") as f:
        for doc in sorted(rows):
            f.write(json.dumps(rows[doc]) + "\n")
    tmp.replace(out_path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_PATH))
    ap.add_argument("--limit", type=int, default=0, help="process only the first N documents needing work (smoke test)")
    ap.add_argument("--budget-usd", type=float, default=DEFAULT_BUDGET_USD)
    ap.add_argument("--workers", type=int, default=6, help="concurrent Haiku batch calls")
    args = ap.parse_args()
    out_path = Path(args.out)

    t0 = time.time()
    manifest = [json.loads(l) for l in (REPO / "data" / "manifest.jsonl").open() if l.strip()]
    doc_types = load_doc_types()
    page_status = load_page_status()
    page_files = {f.name[: -len(".pages.jsonl")]: f for f in TEXT.rglob("*.pages.jsonl")}
    roles_words = load_roles_words()
    existing = load_existing(out_path)
    cache = Cache(CACHE_PATH)

    rows: dict[str, dict] = dict(existing)
    to_process: list[dict] = []
    reused = 0
    rule_based = 0
    cache_hits = 0

    for m in manifest:
        doc = m["bates_start"]
        doc_type = doc_types.get(doc)
        folder = redact_titlecase(m.get("folder_name") or "")
        box = m.get("box_name")
        agency = m.get("agency")
        page_count = m.get("page_count")

        if doc_type == "cover_sheet":
            folder_plain = (m.get("folder_name") or "").strip() or None
            h = input_hash("cover_sheet", folder_plain, box, agency, page_count, "")
            cached = existing.get(doc)
            if cached and cached.get("hash") == h:
                reused += 1
                continue
            rows[doc] = {"doc": doc, "title": cover_sheet_title(folder_plain), "summary": COVER_SHEET_SUMMARY,
                         "confidence": 1.0, "model": None, "hash": h}
            rule_based += 1
            continue

        excerpt = redact_titlecase(pick_excerpt(doc, page_status, page_files))
        h = input_hash(doc_type, folder or None, box, agency, page_count, excerpt)
        cached = existing.get(doc)
        # 2026-09-14: a null row (title None, model None — written when the budget or the account's
        # usage cap stopped a run) used to match on hash and be skipped forever; 11,744 documents
        # sat untitled across every later run. Reuse only a row that actually carries a title.
        if cached and cached.get("hash") == h and cached.get("title"):
            reused += 1
            continue
        hit = cache.get(h)
        if hit is not None:
            rows[doc] = {"doc": doc, "hash": h, **hit}
            cache_hits += 1
            continue
        to_process.append({"doc": doc, "doc_type": doc_type, "folder": folder or None, "box": box,
                            "agency": agency, "page_count": page_count, "excerpt": excerpt, "hash": h})

    if args.limit:
        to_process = to_process[: args.limit]

    write_out(out_path, rows)  # persist rule-based rows / carried-over cache immediately

    budget = Budget(args.budget_usd)
    model_done = 0
    stopped_on_budget = False
    if to_process:
        client = None
        if BACKEND not in ("cli", "codex", "ollama"):
            import anthropic  # imported lazily: a run with nothing left to do needs no key/SDK at all
            client = anthropic.Anthropic(api_key=CLAUDE_KEY_FILE.read_text().strip())

        batches = [to_process[i: i + BATCH_SIZE] for i in range(0, len(to_process), BATCH_SIZE)]
        write_lock = threading.Lock()

        stop = StopSignal()

        def run_one(batch: list[dict]) -> list[dict]:
            for j, it in enumerate(batch):
                it["id"] = j
            return process_batch(client, batch, roles_words, budget, cache, stop)

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = {pool.submit(run_one, b): b for b in batches}
            since_checkpoint = 0
            for fut in concurrent.futures.as_completed(futures):
                try:
                    out_rows = fut.result()
                except Exception as e:
                    b = futures[fut]
                    print(f"summaries: batch crashed ({e}); leaving {len(b)} document(s) unresolved", file=sys.stderr)
                    out_rows = [{"doc": it["doc"], "title": None, "summary": None, "confidence": 0.0,
                                 "model": None, "hash": it["hash"]} for it in futures[fut]]
                with write_lock:
                    for r in out_rows:
                        rows[r["doc"]] = r
                        model_done += 1
                        since_checkpoint += 1
                    if since_checkpoint >= CHECKPOINT_EVERY:
                        since_checkpoint = 0
                        write_out(out_path, rows)
                        cache.save()
                        print(json.dumps({
                            "checkpoint": True, "done": model_done, "of": len(to_process),
                            "cost_usd": round(budget.spent, 4), "seconds": round(time.time() - t0, 1),
                        }))
                if budget.exhausted():
                    stopped_on_budget = True
                if stop.is_set():
                    # Clean stop (e.g. the Anthropic account's own usage-limit cap, not this
                    # script's --budget-usd): every batch not yet started resolves to null nearly
                    # instantly anyway (process_batch's stop.is_set() short-circuit), but cancelling
                    # what's still queued skips even that pass through the executor.
                    for other in futures:
                        if not other.done():
                            other.cancel()

        write_out(out_path, rows)
        cache.save()

    n_rejected = sum(1 for r in rows.values() if r.get("model") and r.get("title") is None)
    summary = {
        "out": str(out_path), "documents": len(rows), "reused_from_cache": reused,
        "cache_hits": cache_hits, "rule_based": rule_based, "model_calls_documents": model_done,
        "rejected_or_failed": n_rejected, "cost_usd": round(budget.spent, 4),
        "stopped_on_budget": stopped_on_budget,
        "stopped_early_reason": stop.reason if to_process else None,
        "seconds": round(time.time() - t0, 1),
    }
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
