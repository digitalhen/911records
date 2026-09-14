#!/usr/bin/env python3
"""search.py — local hybrid search prototype: keyword (BM25) + semantic (vectors), fused.

Engine-agnostic proof of the ranking before choosing a production engine (Typesense /
OpenSearch / Postgres+pgvector). Local only; never contacts the portal.

  build   rebuild data/embed/search.sqlite: an FTS5 index over every page's OCR text
          (porter stemming, unicode61), keyed (doc, page).
  query   embed the query with nomic-embed-text ("search_query: " prefix), score every chunk
          vector in pages.sqlite by cosine, take the best chunk per page; run the same query as
          FTS5 BM25; merge with reciprocal-rank fusion (RRF, k=60). Prints Bates page, which
          arm(s) found it, and the scores — never page text (it can contain personal names).

Usage:
  .venv/bin/python scripts/embed/search.py build
  .venv/bin/python scripts/embed/search.py query "asbestos found in buildings on Liberty Street" [--k 15] [--mode hybrid|keyword|semantic]
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
EMB = REPO / "data" / "embed"
TEXT = REPO / "data" / "text"
OLLAMA = "http://localhost:11434/api/embed"
MODEL = "nomic-embed-text"
RRF_K = 60


def build() -> None:
    t0 = time.time()
    tmp = EMB / "search.sqlite.tmp"
    if tmp.exists():
        tmp.unlink()
    con = sqlite3.connect(tmp)
    con.execute("CREATE VIRTUAL TABLE pages USING fts5(doc UNINDEXED, page UNINDEXED, bates UNINDEXED, text, "
                "tokenize='porter unicode61')")
    n = 0
    for f in sorted(TEXT.rglob("*.pages.jsonl")):
        doc = f.name[: -len(".pages.jsonl")]
        rows = []
        for line in f.open():
            if line.strip():
                r = json.loads(line)
                if (r.get("text") or "").strip():
                    rows.append((doc, int(r["page"]), r.get("bates"), r["text"]))
        con.executemany("INSERT INTO pages VALUES (?,?,?,?)", rows)
        n += len(rows)
    con.commit()
    con.close()
    tmp.replace(EMB / "search.sqlite")
    print(json.dumps({"fts_pages": n, "seconds": round(time.time() - t0, 1)}))


def embed_query(q: str) -> np.ndarray:
    body = json.dumps({"model": MODEL, "input": [f"search_query: {q}"]}).encode()
    req = urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"})
    v = np.asarray(json.load(urllib.request.urlopen(req, timeout=120))["embeddings"][0], dtype=np.float32)
    return v / np.linalg.norm(v)


def semantic(q: str, limit: int) -> list[tuple]:
    con = sqlite3.connect(EMB / "pages.sqlite")
    keys, vecs = [], []
    for doc, page, vec in con.execute("SELECT doc, page, vec FROM chunks WHERE model=?", (MODEL,)):
        keys.append((doc, page))
        vecs.append(np.frombuffer(vec, dtype=np.float32))
    if not vecs:
        return []
    s = np.stack(vecs) @ embed_query(q)
    best: dict[tuple, float] = {}
    for i in np.argsort(-s)[: limit * 5]:
        best.setdefault(keys[i], float(s[i]))
    return sorted(best.items(), key=lambda kv: -kv[1])[:limit]


def keyword(q: str, limit: int) -> list[tuple]:
    con = sqlite3.connect(EMB / "search.sqlite")
    terms = [t for t in re.findall(r"[A-Za-z0-9]{2,}", q)]
    if not terms:
        return []
    match = " OR ".join(f'"{t}"' for t in terms)
    rows = con.execute("SELECT doc, page, bm25(pages) FROM pages WHERE pages MATCH ? ORDER BY bm25(pages) LIMIT ?",
                       (match, limit)).fetchall()
    return [((d, int(p)), -float(b)) for d, p, b in rows]


RE_BATES = re.compile(r"NYC-(?:W|VV)TC[ _]?(\d{6,9})", re.I)


def exact_bates(q: str) -> list[tuple]:
    """A Bates number in the query resolves to its exact page(s) first, never to look-alikes."""
    hits = []
    manifest = [json.loads(l) for l in (REPO / "data" / "manifest.jsonl").open()]
    for m in RE_BATES.finditer(q):
        n = int(m.group(1))
        for r in manifest:
            s = int(re.search(r"(\d{6,})", r["bates_start"]).group(1))
            e = int(re.search(r"(\d{6,})", r.get("bates_end") or r["bates_start"]).group(1))
            if s <= n <= e:
                hits.append(((r["bates_start"], n - s + 1), 1.0))
                break
    return hits


def query(q: str, k: int, mode: str) -> None:
    t0 = time.time()
    exact = exact_bates(q)
    sem = semantic(q, k * 4) if mode in ("hybrid", "semantic") else []
    kw = keyword(q, k * 4) if mode in ("hybrid", "keyword") else []
    fused: dict[tuple, dict] = {}
    for key, _ in exact:
        fused[key] = {"rrf": 1.0, "arms": {"exact_bates": True}}
    for arm, res in (("semantic", sem), ("keyword", kw)):
        for rank, (key, score) in enumerate(res):
            e = fused.setdefault(key, {"rrf": 0.0, "arms": {}})
            e["rrf"] += 1.0 / (RRF_K + rank + 1)
            e["arms"][arm] = round(score, 3)
    meta = {r["bates_start"]: r for r in map(json.loads, (REPO / "data" / "manifest.jsonl").open())}
    out = sorted(fused.items(), key=lambda kv: -kv[1]["rrf"])[:k]
    print(f"query={q!r} mode={mode} semantic_hits={len(sem)} keyword_hits={len(kw)} ms={int((time.time()-t0)*1000)}")
    for (doc, page), e in out:
        m = meta.get(doc, {})
        print(f"  {doc} p{page:<3} rrf={e['rrf']:.4f} {json.dumps(e['arms'])}  vol={m.get('production_volume')} agency={(m.get('agency') or '').split(',')[0]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build")
    qp = sub.add_parser("query")
    qp.add_argument("q")
    qp.add_argument("--k", type=int, default=15)
    qp.add_argument("--mode", choices=["hybrid", "keyword", "semantic"], default="hybrid")
    args = ap.parse_args()
    if args.cmd == "build":
        build()
    else:
        query(args.q, args.k, args.mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())
