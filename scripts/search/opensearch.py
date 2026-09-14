#!/usr/bin/env python3
"""opensearch.py — index the 9/11 records into OpenSearch and query them (hybrid).

Python stdlib only (urllib). Talks to the node named by OPENSEARCH_URL (default
http://127.0.0.1:9200, the local docker-compose.opensearch.yml, no auth needed); set
OPENSEARCH_USER / OPENSEARCH_PASSWORD to talk to a node with basic auth on (the production node
in the Dokploy VM). This script itself never contacts the portal.

One OpenSearch document per PAGE (id "<bates_start>_p<page>"):
  text              OCR text: english analyzer + .exact (standard) subfield, offsets for highlighting
  vector            768-d nomic-embed-text, mean of the page's chunk vectors (lucene HNSW, cosine)
  doc, page, bates_page, bates_start, bates_end, agency, source, box, folder, volume, page_count,
  pdf_size, ocr_status (ok|empty|junk|ocr), ocr_source (pdftotext|ours), image_ready (bool)
  doc_status (present|removed), first_seen (date)
  doc_type (cover_sheet|lab_report|chain_of_custody|memo_letter|sign_in_sheet|invoice|
            permit_application|form|photo_log|other), doc_type_confidence (P3, issue #28,
            scripts/embed/doctypes.py's data/embed/p3-doctypes.jsonl; absent when that file hasn't
            classified the document yet)
  contaminants[], labs[], contractors[], agencies_mentioned[], dates[] (date), bins[], bbls[],
  addresses[], measurement_units[]
  official_roles[]  "role | title | org" for people acting in an official capacity (official=1)
  official_people[] their names — ONLY for official=1 roles; private individuals are never indexed
  topic, related_filed_elsewhere (count)

Commands:
  setup     create the index if missing (--recreate drops it first) and PUT the mapping (adding a
            new field to an existing index is a compatible update, not a reindex) plus the hybrid
            search pipeline
  index     bulk (re)index every extracted page (incremental by a content hash stored in the doc);
            --limit N indexes only the first N documents (by Bates order), for quick smoke tests
  query Q   hybrid query: BM25 (english) + k-NN on the embedded query, min-max normalised and
            combined 0.4 keyword / 0.6 semantic through the search pipeline; exact Bates numbers
            short-circuit. Prints ids, scores and facet counts — never page text.
  stats     index document count and field coverage

Usage:
  .venv/bin/python scripts/search/opensearch.py setup [--recreate]
  .venv/bin/python scripts/search/opensearch.py index [--limit N]
  .venv/bin/python scripts/search/opensearch.py query "asbestos results Liberty Street October 2001" [--k 10]
  .venv/bin/python scripts/search/opensearch.py stats

Env: OPENSEARCH_URL (default http://127.0.0.1:9200), OPENSEARCH_USER, OPENSEARCH_PASSWORD.
"""
from __future__ import annotations

import argparse
import base64
import collections
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
EMB = REPO / "data" / "embed"
TEXT = REPO / "data" / "text"
OS = os.environ.get("OPENSEARCH_URL", "http://127.0.0.1:9200").rstrip("/")
OS_USER = os.environ.get("OPENSEARCH_USER")
OS_PASSWORD = os.environ.get("OPENSEARCH_PASSWORD")
INDEX = "sept11-pages-v1"
PIPELINE = "sept11-hybrid"
OLLAMA = "http://localhost:11434/api/embed"
MODEL = "nomic-embed-text"
DIM = 768
RE_BATES = re.compile(r"NYC-(?:W|VV)TC[ _]?(\d{6,9})", re.I)


def _auth_header() -> dict:
    if not OS_USER:
        return {}
    token = base64.b64encode(f"{OS_USER}:{OS_PASSWORD or ''}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def call(method: str, path: str, body=None, ndjson: str | None = None, ok404=False):
    data = ndjson.encode() if ndjson is not None else (json.dumps(body).encode() if body is not None else None)
    ctype = "application/x-ndjson" if ndjson is not None else "application/json"
    headers = {"Content-Type": ctype, **_auth_header()}
    req = urllib.request.Request(OS + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        if ok404 and e.code == 404:
            return None
        raise SystemExit(f"OpenSearch {method} {path} -> HTTP {e.code}: {e.read()[:600].decode(errors='ignore')}")


MAPPING = {
    "settings": {"index": {"knn": True, "number_of_shards": 1, "number_of_replicas": 0, "refresh_interval": "30s"}},
    "mappings": {
        "dynamic": "strict",
        "properties": {
            "text": {"type": "text", "analyzer": "english", "index_options": "offsets",
                     "fields": {"exact": {"type": "text", "analyzer": "standard", "index_options": "offsets"}}},
            "vector": {"type": "knn_vector", "dimension": DIM,
                       "method": {"name": "hnsw", "engine": "lucene", "space_type": "cosinesimil",
                                  "parameters": {"m": 16, "ef_construction": 128}}},
            "doc": {"type": "keyword"}, "page": {"type": "integer"}, "bates_page": {"type": "keyword"},
            "bates_start": {"type": "keyword"}, "bates_end": {"type": "keyword"},
            "agency": {"type": "keyword"}, "source": {"type": "keyword"}, "box": {"type": "keyword"},
            "folder": {"type": "keyword", "fields": {"text": {"type": "text", "analyzer": "english"}}},
            "volume": {"type": "keyword"}, "page_count": {"type": "integer"}, "pdf_size": {"type": "long"},
            "ocr_status": {"type": "keyword"}, "ocr_source": {"type": "keyword"}, "image_ready": {"type": "boolean"},
            "doc_status": {"type": "keyword"}, "first_seen": {"type": "date", "format": "yyyy-MM-dd"},
            "contaminants": {"type": "keyword"}, "labs": {"type": "keyword"}, "contractors": {"type": "keyword"},
            "agencies_mentioned": {"type": "keyword"}, "dates": {"type": "date", "format": "yyyy-MM-dd"},
            "bins": {"type": "keyword"}, "bbls": {"type": "keyword"}, "addresses": {"type": "keyword"},
            "measurement_units": {"type": "keyword"},
            "official_roles": {"type": "keyword"}, "official_people": {"type": "keyword"},
            "topic": {"type": "integer"}, "related_filed_elsewhere": {"type": "integer"},
            "doc_type": {"type": "keyword"}, "doc_type_confidence": {"type": "float"},
            "content_hash": {"type": "keyword"},
        },
    },
}

PIPELINE_BODY = {
    "description": "9/11 records hybrid: min-max normalise BM25 and k-NN, weighted 0.4 keyword / 0.6 semantic",
    "phase_results_processors": [{"normalization-processor": {
        "normalization": {"technique": "min_max"},
        "combination": {"technique": "arithmetic_mean", "parameters": {"weights": [0.4, 0.6]}},
    }}],
}


def setup(recreate: bool) -> None:
    if recreate:
        call("DELETE", f"/{INDEX}", ok404=True)
    created = False
    if call("HEAD", f"/{INDEX}", ok404=True) is None:
        call("PUT", f"/{INDEX}", MAPPING)
        created = True
    else:
        # Adding a field to an existing mapping is a compatible update (no reindex needed); a
        # changed type on an existing field would be rejected by OpenSearch, which is the signal
        # to bump INDEX to a new version instead of editing this in place.
        call("PUT", f"/{INDEX}/_mapping", MAPPING["mappings"])
    call("PUT", f"/_search/pipeline/{PIPELINE}", PIPELINE_BODY)
    print(json.dumps({"index": INDEX, "created": created, "pipeline": PIPELINE,
                      "cluster": call("GET", "/")["version"]["number"]}))


def page_vectors() -> dict[tuple, np.ndarray]:
    con = sqlite3.connect(EMB / "pages.sqlite")
    acc: dict[tuple, list] = collections.defaultdict(list)
    for doc, page, vec in con.execute("SELECT doc, page, vec FROM chunks WHERE model=?", (MODEL,)):
        acc[(doc, page)].append(np.frombuffer(vec, dtype=np.float32))
    out = {}
    for k, vs in acc.items():
        v = np.mean(vs, axis=0)
        out[k] = v / np.linalg.norm(v)
    return out


def local_pdf_to_pages_dir(local_pdf: str) -> Path | None:
    """data/pdf/<agency>/<volume>/<bates>.pdf -> data/pages/<agency>/<volume>/<bates>/ (A1's layout)."""
    if not local_pdf or not local_pdf.startswith("data/pdf/") or not local_pdf.endswith(".pdf"):
        return None
    return REPO / "data" / "pages" / local_pdf[len("data/pdf/"):-len(".pdf")]


def image_ready_counts(meta: dict) -> dict[str, int]:
    """doc -> rendered page count from data/pages/<...>/<bates>/pages.json, if it exists yet."""
    out: dict[str, int] = {}
    for doc, m in meta.items():
        d = local_pdf_to_pages_dir(m.get("local_pdf") or "")
        pj = d / "pages.json" if d else None
        if not pj or not pj.exists():
            continue
        try:
            n = json.loads(pj.read_text()).get("pages")
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(n, int) and n > 0:
            out[doc] = n
    return out


def index(limit: int = 0) -> None:
    t0 = time.time()
    meta = {r["bates_start"]: r for r in map(json.loads, (REPO / "data" / "manifest.jsonl").open())}
    vecs = page_vectors()
    status = {}
    if (EMB / "pages.sqlite").exists():
        status = {(d, p): s for d, p, s in sqlite3.connect(EMB / "pages.sqlite").execute("SELECT doc, page, status FROM pages")}
    image_ready = image_ready_counts(meta)
    ents: dict[tuple, dict] = collections.defaultdict(lambda: collections.defaultdict(set))
    if (EMB / "entities.sqlite").exists():
        econ = sqlite3.connect(EMB / "entities.sqlite")
        field = {"contaminant": "contaminants", "lab": "labs", "contractor": "contractors", "agency": "agencies_mentioned",
                 "date": "dates", "bin": "bins", "address": "addresses", "measurement": "measurement_units"}
        for doc, page, label, norm in econ.execute("SELECT doc, page, label, norm FROM mentions WHERE source='regex'"):
            if label in field:
                ents[(doc, page)][field[label]].add(norm)
            elif label == "block_lot":
                b, l = norm.split("/")
                ents[(doc, page)]["bbls"].add(f"1{int(b):05d}{int(l):04d}")
        for doc, page, role, name, title, org in econ.execute(
                "SELECT doc, page, role, name_norm, title, org FROM roles WHERE official=1"):
            ents[(doc, page)]["official_roles"].add(" | ".join(x or "" for x in (role, title, org)))
            ents[(doc, page)]["official_people"].add(name)
    topic, elsewhere = {}, collections.Counter()
    if (EMB / "related.sqlite").exists():
        rcon = sqlite3.connect(EMB / "related.sqlite")
        topic = dict(rcon.execute("SELECT doc, topic FROM doc_topics"))
        for doc, n in rcon.execute("SELECT doc, sum(cross) FROM related GROUP BY doc"):
            elsewhere[doc] = int(n or 0)
    doc_types: dict[str, tuple[str, float | None]] = {}
    doctypes_path = EMB / "p3-doctypes.jsonl"
    if doctypes_path.exists():
        for line in doctypes_path.open():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("doc") and row.get("doc_type") is not None:
                doc_types[row["doc"]] = (row["doc_type"], row.get("confidence"))

    existing = {}
    body = {"size": 10000, "_source": ["content_hash"], "query": {"match_all": {}}}
    res = call("POST", f"/{INDEX}/_search?scroll=2m", body)
    while res and res["hits"]["hits"]:
        for h in res["hits"]["hits"]:
            existing[h["_id"]] = h["_source"].get("content_hash")
        res = call("POST", "/_search/scroll", {"scroll": "2m", "scroll_id": res["_scroll_id"]})

    lines, sent, skipped = [], 0, 0

    def flush():
        nonlocal lines, sent
        if lines:
            r = call("POST", "/_bulk", ndjson="\n".join(lines) + "\n")
            if r.get("errors"):
                bad = [i for i in r["items"] if i["index"].get("error")][:3]
                raise SystemExit(f"bulk errors, first: {json.dumps(bad)[:800]}")
            sent += len(lines) // 2
            lines = []

    files = sorted(TEXT.rglob("*.pages.jsonl"))
    if limit:
        files = files[:limit]
    for f in files:
        doc = f.name[: -len(".pages.jsonl")]
        m = meta.get(doc, {})
        start_n = int(re.search(r"(\d{6,})", doc).group(1))
        n_rendered = image_ready.get(doc, 0)
        for line in f.open():
            if not line.strip():
                continue
            row = json.loads(line)
            page = int(row["page"])
            text = row.get("text") or ""
            e = ents.get((doc, page), {})
            page_status = status.get((doc, page), "empty")
            src = {
                "text": text, "doc": doc, "page": page, "bates_page": f"NYC-WTC_{start_n + page - 1:09d}",
                "bates_start": doc, "bates_end": m.get("bates_end"), "agency": m.get("agency"),
                "source": m.get("source"), "box": m.get("box_name"), "folder": m.get("folder_name"),
                "volume": m.get("production_volume"), "page_count": int(m.get("page_count") or 0) or None,
                "pdf_size": int(m.get("pdf_size") or 0) or None, "ocr_status": page_status,
                "ocr_source": "ours" if page_status == "ocr" else "pdftotext",
                "image_ready": page <= n_rendered,
                "doc_status": m.get("status") or "present", "first_seen": m.get("first_seen"),
                **{k: sorted(v) for k, v in e.items()},
                "topic": topic.get(doc), "related_filed_elsewhere": elsewhere.get(doc, 0),
            }
            doc_type_row = doc_types.get(doc)
            if doc_type_row:
                src["doc_type"], src["doc_type_confidence"] = doc_type_row
            v = vecs.get((doc, page))
            if v is not None:
                src["vector"] = [round(float(x), 6) for x in v]
            h = hashlib.sha1(json.dumps(src, sort_keys=True).encode()).hexdigest()
            _id = f"{doc}_p{page}"
            if existing.get(_id) == h:
                skipped += 1
                continue
            src["content_hash"] = h
            lines.append(json.dumps({"index": {"_index": INDEX, "_id": _id}}))
            lines.append(json.dumps(src))
            if len(lines) >= 1000:
                flush()
    flush()
    call("POST", f"/{INDEX}/_refresh")
    print(json.dumps({"indexed": sent, "unchanged": skipped, "seconds": round(time.time() - t0, 1),
                      "index_docs": call("GET", f"/{INDEX}/_count")["count"]}))


def embed_query(q: str) -> list[float]:
    body = json.dumps({"model": MODEL, "input": [f"search_query: {q}"]}).encode()
    req = urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"})
    v = np.asarray(json.load(urllib.request.urlopen(req, timeout=120))["embeddings"][0], dtype=np.float32)
    return [float(x) for x in v / np.linalg.norm(v)]


FACETS = {name: {"terms": {"field": name, "size": 8}} for name in
          ("agency", "box", "volume", "contaminants", "labs", "measurement_units")}


def query(q: str, k: int) -> None:
    t0 = time.time()
    m = RE_BATES.search(q)
    if m:
        n = int(m.group(1))
        r = call("POST", f"/{INDEX}/_search", {"size": 1, "_source": ["doc", "page", "bates_page"],
                                                "query": {"term": {"bates_page": f"NYC-WTC_{n:09d}"}}})
        for h in r["hits"]["hits"]:
            print(f"exact Bates: {h['_id']} ({h['_source']['bates_page']})")
    body = {
        "size": k,
        "_source": ["doc", "page", "bates_page", "agency", "box", "volume", "contaminants", "ocr_status"],
        "query": {"hybrid": {"queries": [
            {"multi_match": {"query": q, "fields": ["text", "text.exact^0.5", "folder.text^0.3"]}},
            {"knn": {"vector": {"vector": embed_query(q), "k": max(50, k * 5)}}},
        ]}},
        "aggs": FACETS,
        "highlight": {"fields": {"text": {"number_of_fragments": 1, "fragment_size": 1}}},
    }
    r = call("POST", f"/{INDEX}/_search?search_pipeline={PIPELINE}", body)
    total = r["hits"]["total"]["value"]
    print(f"query={q!r} hits={total} took={r.get('took')}ms wall={int((time.time()-t0)*1000)}ms")
    for h in r["hits"]["hits"]:
        s = h["_source"]
        print(f"  {s['bates_page']}  score={h['_score']:.3f}  doc={s['doc']} p{s['page']} vol={s['volume']} "
              f"ocr={s.get('ocr_status')} contaminants={s.get('contaminants', [])[:4]} "
              f"highlighted={'yes' if h.get('highlight') else 'no'}")
    for name, agg in r.get("aggregations", {}).items():
        print(f"  facet {name}: {[(b['key'] if name != 'box' else b['key'], b['doc_count']) for b in agg['buckets']]}")


def stats() -> None:
    c = call("GET", f"/{INDEX}/_count")["count"]
    cov = {}
    for fld in ("vector", "contaminants", "labs", "dates", "bins", "official_roles", "topic",
                "image_ready", "ocr_source", "doc_status", "first_seen", "doc_type"):
        cov[fld] = call("POST", f"/{INDEX}/_count", {"query": {"exists": {"field": fld}}})["count"]
    print(json.dumps({"docs": c, "field_coverage": cov}))


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("setup")
    s.add_argument("--recreate", action="store_true")
    ip = sub.add_parser("index")
    ip.add_argument("--limit", type=int, default=0, help="index only the first N documents (smoke test)")
    sub.add_parser("stats")
    qp = sub.add_parser("query")
    qp.add_argument("q")
    qp.add_argument("--k", type=int, default=10)
    a = ap.parse_args()
    if a.cmd == "setup":
        setup(a.recreate)
    elif a.cmd == "index":
        index(a.limit)
    elif a.cmd == "stats":
        stats()
    else:
        query(a.q, a.k)
    return 0


if __name__ == "__main__":
    sys.exit(main())
