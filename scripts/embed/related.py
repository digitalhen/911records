#!/usr/bin/env python3
"""related.py — discovery layer: document vectors, related records, topics, near-duplicates.

Local only. Reads data/embed/pages.sqlite (page chunk vectors from pages.py) and
data/manifest.jsonl; writes data/embed/related.sqlite. Rebuilt from scratch each run
(cheap: 24k docs x 768 dims), written to a temp file and renamed so readers never see
a half-built store.

  doc_vectors(doc, n_chunks, vec)                   mean of the doc's chunk vectors, L2-normalised
  related(doc, rank, other, score, cross)           top-K nearest documents; cross = 1 when the other
                                                    document sits in a different box, agency or
                                                    collection ("filed elsewhere")
  near_dupes(doc, other, score)                     cosine >= DUP_THRESHOLD (same form / memo / rescan)
  page_vectors are not copied — "more like this page" queries pages.sqlite chunks directly
  topics(topic, parent, size_docs, size_pages, terms, boxes, agencies)
  doc_topics(doc, topic, prob)

Topic names use only dictionary words and domain acronyms (see folders.py): OCR text is full of
personal names and they must not become labels. Topics are about subjects, never people.

Usage: .venv/bin/python scripts/embed/related.py [--k 20] [--min-topic 15]
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from folders import DOMAIN_TERMS  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
EMB = REPO / "data" / "embed"
TEXT = REPO / "data" / "text"
DUP_THRESHOLD = 0.97


def shown_vocab() -> set[str]:
    s = set(DOMAIN_TERMS)
    p = Path("/usr/share/dict/words")
    if p.exists():
        s |= {w.strip() for w in p.open() if w.strip() and w.strip().islower()}
    return s


def displayable(w: str, shown: set[str]) -> bool:
    stems = {w, w[:-1] if w.endswith("s") else w, w[:-2] if w.endswith("es") else w,
             w[:-3] + "y" if w.endswith("ies") else w}
    return bool(stems & shown)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=20)
    ap.add_argument("--min-topic", type=int, default=15)
    args = ap.parse_args()
    t0 = time.time()

    meta = {r["bates_start"]: r for r in map(json.loads, (REPO / "data" / "manifest.jsonl").open())}
    src = sqlite3.connect(EMB / "pages.sqlite")
    acc: dict[str, list] = {}
    for doc, vec in src.execute("SELECT doc, vec FROM chunks"):
        acc.setdefault(doc, []).append(np.frombuffer(vec, dtype=np.float32))
    docs = sorted(acc)
    if len(docs) < 3:
        print(json.dumps({"docs_with_vectors": len(docs), "note": "too few documents yet"}))
        return 0
    V = np.stack([np.mean(acc[d], axis=0) for d in docs]).astype(np.float32)
    V /= np.linalg.norm(V, axis=1, keepdims=True)
    n = len(docs)

    tmp = EMB / "related.sqlite.tmp"
    if tmp.exists():
        tmp.unlink()
    out = sqlite3.connect(tmp)
    out.executescript("""
    CREATE TABLE doc_vectors(doc TEXT PRIMARY KEY, n_chunks INT, vec BLOB);
    CREATE TABLE related(doc TEXT, rank INT, other TEXT, score REAL, cross INT, PRIMARY KEY(doc, rank));
    CREATE TABLE near_dupes(doc TEXT, other TEXT, score REAL);
    CREATE TABLE topics(topic INT PRIMARY KEY, parent INT, size_docs INT, size_pages INT, terms TEXT,
                        boxes TEXT, agencies TEXT);
    CREATE TABLE doc_topics(doc TEXT PRIMARY KEY, topic INT, prob REAL);
    """)
    out.executemany("INSERT INTO doc_vectors VALUES (?,?,?)",
                    [(d, len(acc[d]), V[i].tobytes()) for i, d in enumerate(docs)])

    def where(d):
        m = meta.get(d, {})
        return (m.get("box_name"), m.get("agency"), m.get("source"))

    k = min(args.k, n - 1)
    rel_rows, dup_rows, cross_count = [], [], 0
    for s in range(0, n, 2048):
        S = V[s:s + 2048] @ V.T
        for bi in range(S.shape[0]):
            i = s + bi
            S[bi, i] = -1.0
            top = np.argpartition(-S[bi], k)[:k]
            top = top[np.argsort(-S[bi, top])]
            for rank, j in enumerate(top):
                cross = int(where(docs[i]) != where(docs[j]))
                cross_count += cross
                rel_rows.append((docs[i], rank, docs[j], float(S[bi, j]), cross))
                if S[bi, j] >= DUP_THRESHOLD and i < j:
                    dup_rows.append((docs[i], docs[j], float(S[bi, j])))
    out.executemany("INSERT INTO related VALUES (?,?,?,?,?)", rel_rows)
    out.executemany("INSERT INTO near_dupes VALUES (?,?,?)", dup_rows)

    topics_made = 0
    if n >= max(50, args.min_topic * 3):
        import umap
        from sklearn.cluster import HDBSCAN
        from sklearn.feature_extraction.text import TfidfVectorizer
        X = umap.UMAP(n_components=10, n_neighbors=15, min_dist=0.0, metric="cosine",
                      random_state=911).fit_transform(V)
        hd = HDBSCAN(min_cluster_size=args.min_topic, min_samples=5).fit(X)
        labels, probs = hd.labels_, hd.probabilities_
        page_files = {f.name[: -len(".pages.jsonl")]: f for f in TEXT.rglob("*.pages.jsonl")}
        texts = []
        for d in docs:
            f = page_files.get(d)
            body = ""
            if f:
                body = " ".join((json.loads(l).get("text") or "") for l in f.open() if l.strip())[:20000]
            texts.append(body)
        tf = TfidfVectorizer(token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z]{2,}\b", lowercase=True, sublinear_tf=True,
                             min_df=min(3, max(1, n // 50)), max_df=0.5, stop_words="english")
        try:
            M = tf.fit_transform(texts)
        except ValueError:
            M = None
        if M is None:
            labels = np.full(n, -1)
        vocab = np.array(tf.get_feature_names_out())
        gmean = np.asarray(M.mean(axis=0)).ravel()
        shown = shown_vocab()
        for t in sorted(set(labels) - {-1}):
            idx = np.where(labels == t)[0]
            score = np.asarray(M[idx].mean(axis=0)).ravel() - gmean
            terms = [w for w in vocab[np.argsort(-score)[:200]] if displayable(w, shown)][:8]
            boxes = collections.Counter(meta.get(docs[i], {}).get("box_name") for i in idx)
            ags = collections.Counter(meta.get(docs[i], {}).get("agency") for i in idx)
            pages = sum(int(meta.get(docs[i], {}).get("page_count") or 0) for i in idx)
            out.execute("INSERT INTO topics VALUES (?,?,?,?,?,?,?)",
                        (int(t), None, len(idx), pages, json.dumps(terms),
                         json.dumps(boxes.most_common(10)), json.dumps(ags.most_common(5))))
            topics_made += 1
        out.executemany("INSERT INTO doc_topics VALUES (?,?,?)",
                        [(d, int(labels[i]), float(probs[i])) for i, d in enumerate(docs)])
    out.commit()
    out.close()
    os.replace(tmp, EMB / "related.sqlite")

    print(json.dumps({
        "docs_with_vectors": n, "related_pairs": len(rel_rows),
        "cross_box_agency_or_collection_share": round(cross_count / max(1, len(rel_rows)), 3),
        "near_duplicate_pairs": len(dup_rows), "topics": topics_made,
        "seconds": round(time.time() - t0, 1),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
