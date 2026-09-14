#!/usr/bin/env python3
"""pages.py — incremental page-level embeddings over the extracted OCR text.

Reads data/text/**/<bates_start>.pages.jsonl (written by scripts/extract_text.mjs,
one {page, bates, chars, text} per line) and embeds every page that has enough real
text, locally, with Ollama nomic-embed-text ("search_document: " prefix, 768-d,
L2-normalised). Never contacts the portal. Safe to re-run: pages already embedded
with the same model and the same text hash are skipped.

Pages are chunked when long (nomic's context is ~8k tokens, but OCR tables are
dense): CHUNK_CHARS with OVERLAP, so one page may yield several vectors.

Store: data/embed/pages.sqlite
  pages(doc TEXT, page INT, bates TEXT, chars INT, alpha_ratio REAL, status TEXT,
        text_sha1 TEXT, PRIMARY KEY(doc, page))
        status ∈ ok | ocr (Tesseract text replacing an empty page) | empty (image-only / <MIN_CHARS) | junk (alpha_ratio < MIN_ALPHA)
  chunks(doc TEXT, page INT, chunk INT, start INT, end INT, model TEXT, vec BLOB,
         PRIMARY KEY(doc, page, chunk, model))
  -- vec is float32 little-endian, 768 bytes*4

Usage: .venv/bin/python scripts/embed/pages.py [--limit-docs N] [--batch 64]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
TEXT = REPO / "data" / "text"
DB = REPO / "data" / "embed" / "pages.sqlite"
OLLAMA = "http://localhost:11434/api/embed"
MODEL = "nomic-embed-text"
CHUNK_CHARS = 3000
OVERLAP = 300
MIN_CHARS = 80        # below this a page is treated as empty (image-only scans extract to ~0)
MIN_ALPHA = 0.25      # share of characters that are letters; below this the OCR is mostly noise/numbers


def connect() -> sqlite3.Connection:
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript("""
    CREATE TABLE IF NOT EXISTS pages(doc TEXT, page INT, bates TEXT, chars INT, alpha_ratio REAL,
        status TEXT, text_sha1 TEXT, PRIMARY KEY(doc, page));
    CREATE TABLE IF NOT EXISTS chunks(doc TEXT, page INT, chunk INT, start INT, "end" INT, model TEXT,
        vec BLOB, PRIMARY KEY(doc, page, chunk, model));
    """)
    return con


def embed(texts: list[str]) -> np.ndarray:
    body = json.dumps({"model": MODEL, "input": [f"search_document: {t}" for t in texts]}).encode()
    req = urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"})
    v = np.asarray(json.load(urllib.request.urlopen(req, timeout=900))["embeddings"], dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def chunks_of(text: str):
    if len(text) <= CHUNK_CHARS:
        yield 0, 0, len(text)
        return
    i, start = 0, 0
    while start < len(text):
        end = min(len(text), start + CHUNK_CHARS)
        yield i, start, end
        if end == len(text):
            break
        start, i = end - OVERLAP, i + 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit-docs", type=int, default=0)
    ap.add_argument("--batch", type=int, default=64)
    args = ap.parse_args()

    con = connect()
    known = {(d, p): s for d, p, s in con.execute("SELECT doc, page, text_sha1 FROM pages")}
    files = sorted(TEXT.rglob("*.pages.jsonl"))
    if args.limit_docs:
        files = files[: args.limit_docs]

    pending: list[tuple] = []   # (doc, page, chunk, start, end, text)
    stats = {"docs": 0, "pages_seen": 0, "pages_new": 0, "ok": 0, "ocr": 0, "empty": 0, "junk": 0, "chunks": 0}
    t0 = time.time()

    def flush():
        if not pending:
            return
        vecs = embed([p[5] for p in pending])
        con.executemany('INSERT OR REPLACE INTO chunks(doc,page,chunk,start,"end",model,vec) VALUES (?,?,?,?,?,?,?)',
                        [(p[0], p[1], p[2], p[3], p[4], MODEL, vecs[i].tobytes()) for i, p in enumerate(pending)])
        con.commit()
        stats["chunks"] += len(pending)
        pending.clear()

    for f in files:
        doc = f.name[: -len(".pages.jsonl")]
        stats["docs"] += 1
        ocr_file = f.with_name(doc + ".ocr.jsonl")
        ocr_rows = {int(r["page"]): r for line in ocr_file.read_text().splitlines() if line.strip()
                    for r in [json.loads(line)]} if ocr_file.exists() else {}
        for line in f.open():
            if not line.strip():
                continue
            row = json.loads(line)
            page, text = int(row["page"]), row.get("text") or ""
            stats["pages_seen"] += 1
            used_ocr = False
            if len(re.sub(r"\s+", " ", text).strip()) < MIN_CHARS:
                candidate = ocr_rows.get(page, {})
                if candidate.get("chars", 0) >= MIN_CHARS and candidate.get("text"):
                    text = candidate["text"]
                    used_ocr = True
            sha = hashlib.sha1(text.encode()).hexdigest()
            if known.get((doc, page)) == sha:
                continue
            stripped = re.sub(r"\s+", " ", text).strip()
            alpha = sum(ch.isalpha() for ch in stripped) / max(1, len(stripped))
            status = "empty" if len(stripped) < MIN_CHARS else ("junk" if alpha < MIN_ALPHA else "ok")
            if used_ocr:
                status = "ocr"
            stats[status] += 1
            stats["pages_new"] += 1
            con.execute("INSERT OR REPLACE INTO pages VALUES (?,?,?,?,?,?,?)",
                        (doc, page, row.get("bates"), len(stripped), round(alpha, 3), status, sha))
            con.execute("DELETE FROM chunks WHERE doc=? AND page=? AND model=?", (doc, page, MODEL))
            if status not in ("ok", "ocr"):
                continue
            for ci, s, e in chunks_of(stripped):
                pending.append((doc, page, ci, s, e, stripped[s:e]))
                if len(pending) >= args.batch:
                    flush()
    flush()
    con.commit()
    dt = time.time() - t0
    tot = dict(con.execute("SELECT status, count(*) FROM pages GROUP BY 1").fetchall())
    nchunks = con.execute("SELECT count(*) FROM chunks WHERE model=?", (MODEL,)).fetchone()[0]
    print(json.dumps({"run": stats, "seconds": round(dt, 1), "db_pages_by_status": tot, "db_chunks": nchunks}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
