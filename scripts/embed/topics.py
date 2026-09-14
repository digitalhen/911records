#!/usr/bin/env python3
"""topics.py — human-readable topic map: two-level clustering + Haiku naming.

Local only except for the Claude API calls in step 2 (naming). Replaces related.py's topic
stage (`topics`/`doc_topics`); related.py's own `related`/`near_dupes` output is left untouched —
those tables are copied verbatim from an existing related.sqlite into this script's output so a
site build can still use one file for everything the discovery layer needs.

Problem this fixes: related.py's HDBSCAN + raw TF-IDF topic labels are dominated by Lower
Manhattan street names ("water · slip · aka", "broadway · west · aka") because many of those
words are also ordinary English dictionary words (water, west, slip) that pass the "is it a real
word" filter in folders.py/related.py despite being address fragments in context here.

  1. Clustering: doc mean chunk vectors (from data/embed/pages.sqlite, same as related.py) into a
     two-level hierarchy — 40-80 leaf topics (KMeans over a UMAP reduction) grouped into 6-10
     parents (agglomerative clustering of leaf centroids).
  2. Naming: one Haiku call per topic (leaf and parent), given its top terms, top folder labels
     and a few short page excerpts (personal names stripped from both before they are sent), asking
     for {title, description, confidence}. A title containing an unlisted TitleCase pair or a name
     from the roles table is rejected and retried once. Results are cached by an input hash in
     data/embed/p2-topic-names.json.
  3. Term selection excludes: street-suffix words (street/avenue/place/...), tokens captured by
     entities.py's address/Broadway regexes, TitleCase-pair tokens (suspected names) unless both
     words are on the NYC place-word allowlist, and every token that appears in entities.sqlite's
     roles.name_norm. What survives still has to pass folders.py/related.py's original "real
     dictionary word or domain acronym" filter.

Subjects only, never people — see docs/PLAN.md's privacy rules and entities.py's docstring.

Usage:
  .venv/bin/python scripts/embed/topics.py --write-to data/embed/p2-related.sqlite
  .venv/bin/python scripts/embed/topics.py --write-to data/embed/p2-related.sqlite --no-name   (terms-only, no API calls)

Writes doc_vectors, topics(+ title, description, name_confidence), doc_topics fresh, and copies
related/near_dupes from --related-src (default data/embed/related.sqlite) unchanged.
"""
from __future__ import annotations

import argparse
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from entities import RE_ADDR, RE_BROADWAY, STREET_T  # noqa: E402
from related import displayable, shown_vocab  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
EMB = REPO / "data" / "embed"
TEXT = REPO / "data" / "text"
DEFAULT_RELATED = EMB / "related.sqlite"
NAME_CACHE = EMB / "p2-topic-names.json"
CLAUDE_KEY_FILE = Path("/Users/henry/Code/sept11-docs/.claudekey")
MODEL = "claude-haiku-4-5-20251001"
HAIKU_PRICE = {"input": 1.0, "output": 5.0}  # $ per 1M tokens

# NYC/WTC place words allowed in a topic title/description even though they are TitleCase, and
# exempted from the address/name exclusion below. Deliberately short and place-only.
ALLOWED_PLACE_WORDS = {
    "liberty", "broadway", "battery", "manhattan", "world", "trade", "center", "brooklyn",
    "hudson", "east", "river", "ground", "zero", "staten", "island", "fresh", "kills",
    "chambers", "vesey", "greenwich", "church", "fulton", "wall", "canal", "bowery", "trinity",
    "city", "hall", "park", "national", "september", "wtc", "lower", "downtown", "financial",
    "district",
}
STREET_WORDS = {
    "street", "st", "avenue", "ave", "place", "pl", "plaza", "lane", "slip", "road",
    "boulevard", "blvd", "drive", "way", "terrace", "square",
}
GENERIC_NOISE = {
    "results", "sample", "samples", "appendix", "aka", "old", "new", "end", "also", "per",
    "page", "pages", "dated", "report", "reports", "project", "site", "total", "copy", "copies",
    "attached", "enclosed", "received", "referenced", "subject", "south", "north", "west",
}

RE_TITLECASE_PAIR = re.compile(r"\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b")
RE_STREETISH = re.compile(r"\b((?:[A-Z][a-z]+\s+){0,2}[A-Z][a-z]+)\s+" + STREET_T + r"\b")
RE_BARE_BROADWAY = re.compile(r"\b(Broadway|Bowery)\b")


def load_body(doc: str, page_files: dict) -> str:
    f = page_files.get(doc)
    if not f:
        return ""
    return " ".join((json.loads(l).get("text") or "") for l in f.open() if l.strip())[:20000]


def collect_exclusions(texts: list[str], roles_words: set[str]) -> set[str]:
    """Words that must never surface as a topic term: street-suffix words, address/Broadway
    text, anything caught in a TitleCase pair, and roles-table words that survived the
    dictionary/domain-term filter (see the `roles_words` comment at its construction site)."""
    excl = set(STREET_WORDS) | set(GENERIC_NOISE) | roles_words
    for t in texts:
        for m in RE_ADDR.finditer(t):
            excl.update(w.lower() for w in re.findall(r"[A-Za-z]+", m.group(0)))
        for m in RE_BROADWAY.finditer(t):
            excl.add(m.group(2).lower())
        for m in RE_BARE_BROADWAY.finditer(t):
            excl.add(m.group(1).lower())
        for m in RE_STREETISH.finditer(t):
            excl.update(w.lower() for w in re.findall(r"[A-Za-z]+", m.group(0)))
        for m in RE_TITLECASE_PAIR.finditer(t):
            w1, w2 = m.group(1).lower(), m.group(2).lower()
            if w1 not in ALLOWED_PLACE_WORDS:
                excl.add(w1)
            if w2 not in ALLOWED_PLACE_WORDS:
                excl.add(w2)
    return excl


def redact_titlecase(text: str) -> str:
    """Strip suspected person names (TitleCase word pairs) from text going to the model, unless
    both words are on the NYC place-word allowlist."""
    def repl(m: re.Match) -> str:
        w1, w2 = m.group(1), m.group(2)
        if w1.lower() in ALLOWED_PLACE_WORDS and w2.lower() in ALLOWED_PLACE_WORDS:
            return m.group(0)
        return "[name]"
    return RE_TITLECASE_PAIR.sub(repl, text)


def title_violates(title: str, roles_words: set[str]) -> str | None:
    for m in RE_TITLECASE_PAIR.finditer(title):
        w1, w2 = m.group(1).lower(), m.group(2).lower()
        if w1 not in ALLOWED_PLACE_WORDS or w2 not in ALLOWED_PLACE_WORDS:
            return f"contains a name-like phrase ('{m.group(0)}')"
    for w in re.findall(r"[A-Za-z]+", title):
        if w.lower() in roles_words:
            return f"contains a name from the roles table ('{w}')"
    return None


def extract_json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text.strip(), re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def build_prompt(terms: list[str], folder_labels: list[str], excerpts: list[str], retry_note: str | None) -> str:
    lines = [
        "You are naming a topic cluster of City of New York 9/11 records (environmental testing, "
        "inspections, correspondence, permits) for a public document explorer.",
        "Describe the SUBJECT MATTER only — a substance, activity, place-type or period. Never "
        "mention, infer or guess any person's name; the inputs below have already had suspected "
        "names replaced with [name].",
        "",
        "Top distinctive terms: " + (", ".join(terms) or "(none)"),
        "Common folder labels for this group of records: " + ("; ".join(folder_labels) if folder_labels else "(none)"),
        "Sample page excerpts from central documents in this group:",
    ]
    for e in excerpts:
        lines.append(f"- {e}")
    if not excerpts:
        lines.append("- (none available)")
    lines += [
        "",
        'Respond with ONLY a JSON object: {"title": "...", "description": "...", "confidence": 0.0-1.0}',
        "title: 3-7 words, plain English, specific (substance/activity/place-type/period), not generic. "
        "Almost every record here is a post-9/11 World Trade Center environmental/permit record, so "
        "'World Trade Center environmental testing' on its own is USELESS as a title — every other "
        "topic in this same map could say that. Lead with what makes THIS group distinct: the specific "
        "substance, system, permit type, agency, activity or period shown in the terms/excerpts above, "
        "and only mention World Trade Center / 7 WTC / lower Manhattan if the terms point at a "
        "specific building or place, not as filler.",
        "Write the title in SENTENCE CASE — capitalize only the first word and genuine proper nouns "
        "(a well-known NYC place name). Do NOT use Title Case / Headline Case (do not capitalize "
        "every word) — a title like 'Asbestos Air Testing Reports' is wrong, write it as "
        "'Asbestos air testing reports' instead.",
        "description: one sentence, at most 160 characters, ordinary sentence case.",
        "Neither field may contain any person's name, or two consecutive capitalized words unless "
        "both are a well-known NYC place name (e.g. Liberty, Broadway, Battery, Manhattan, World Trade Center).",
    ]
    if retry_note:
        lines += ["", f"Your previous answer was rejected: {retry_note}. Provide a different, compliant title."]
    return "\n".join(lines)


def call_haiku(api_key: str, terms: list[str], folder_labels: list[str], excerpts: list[str],
               retry_note: str | None) -> tuple[str, dict]:
    prompt = build_prompt(terms, folder_labels, excerpts, retry_note)
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 300,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", body,
        {"content-type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    return text, (data.get("usage") or {})


def name_topic(api_key: str, cache: dict, terms: list[str], folder_labels: list[str],
               excerpts: list[str], roles_words: set[str], usage_totals: collections.Counter) -> dict:
    key_obj = {"terms": terms, "folders": folder_labels, "excerpts": excerpts}
    h = hashlib.sha256(json.dumps(key_obj, sort_keys=True).encode()).hexdigest()
    if h in cache:
        return cache[h]
    result = {"title": None, "description": None, "confidence": 0.0}
    note = None
    for _attempt in range(2):
        try:
            text, usage = call_haiku(api_key, terms, folder_labels, excerpts, note)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            result = {"title": None, "description": None, "confidence": 0.0, "error": str(e)}
            break
        usage_totals["input"] += usage.get("input_tokens", 0)
        usage_totals["output"] += usage.get("output_tokens", 0)
        usage_totals["calls"] += 1
        parsed = extract_json(text)
        if not parsed or not parsed.get("title"):
            note = "your response was not a JSON object with a non-empty 'title' field"
            continue
        problem = title_violates(str(parsed["title"]), roles_words)
        if problem:
            note = problem
            result = {"title": None, "description": None, "confidence": 0.0, "rejected_title": str(parsed["title"]), "reason": problem}
            continue
        conf = parsed.get("confidence", 0.5)
        result = {
            "title": str(parsed["title"]).strip()[:120],
            "description": (str(parsed.get("description") or "").strip()[:200]) or None,
            "confidence": float(conf) if isinstance(conf, (int, float)) else 0.5,
        }
        break
    cache[h] = result
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-to", default=str(DEFAULT_RELATED),
                     help="output sqlite path (use data/embed/p2-related.sqlite to avoid touching production)")
    ap.add_argument("--related-src", default=str(DEFAULT_RELATED),
                     help="existing related.sqlite to copy related/near_dupes from unchanged")
    ap.add_argument("--no-name", action="store_true", help="skip Haiku naming (terms-only labels, no API calls)")
    ap.add_argument("--limit-docs", type=int, default=0)
    args = ap.parse_args()
    t0 = time.time()

    if Path(args.write_to).resolve() == DEFAULT_RELATED.resolve():
        print("refusing to write to data/embed/related.sqlite — pass --write-to data/embed/p2-related.sqlite",
              file=sys.stderr)
        return 1

    meta = {r["bates_start"]: r for r in map(json.loads, (REPO / "data" / "manifest.jsonl").open())}
    src = sqlite3.connect(EMB / "pages.sqlite")
    acc: dict[str, list] = {}
    for doc, vec in src.execute("SELECT doc, vec FROM chunks"):
        acc.setdefault(doc, []).append(np.frombuffer(vec, dtype=np.float32))
    docs = sorted(acc)
    if args.limit_docs:
        docs = docs[: args.limit_docs]
    n = len(docs)
    if n < 50:
        print(json.dumps({"docs_with_vectors": n, "note": "too few documents yet"}))
        return 0
    V = np.stack([np.mean(acc[d], axis=0) for d in docs]).astype(np.float32)
    V /= np.linalg.norm(V, axis=1, keepdims=True)

    page_files = {f.name[: -len(".pages.jsonl")]: f for f in TEXT.rglob("*.pages.jsonl")}
    texts = [load_body(d, page_files) for d in docs]

    shown = shown_vocab()

    entities_path = EMB / "entities.sqlite"
    roles_names: list[str] = []
    if entities_path.exists():
        econ = sqlite3.connect(f"file:{entities_path}?mode=ro", uri=True)
        roles_names = [r[0] for r in econ.execute("SELECT DISTINCT name_norm FROM roles")]
        econ.close()
    # roles.name_norm is regex-extracted from noisy OCR text and full of false positives —
    # ordinary words like "AND"/"PROJECT"/"AIR" show up as "names" as often as real surnames do.
    # Only treat a word as a suspected name if it is *not* a real dictionary word/domain term
    # (the same "is this displayable" test related.py/folders.py already use for term labels) —
    # genuine surnames overwhelmingly fail that test; the false-positive extractions pass it.
    roles_words: set[str] = set()
    for nm in roles_names:
        for w in re.findall(r"[A-Za-z]+", nm):
            wl = w.lower()
            if len(wl) > 1 and wl not in ALLOWED_PLACE_WORDS and not displayable(wl, shown):
                roles_words.add(wl)

    excl = collect_exclusions(texts, roles_words)

    from sklearn.feature_extraction.text import TfidfVectorizer
    tf = TfidfVectorizer(token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z]{2,}\b", lowercase=True, sublinear_tf=True,
                         min_df=min(3, max(1, n // 50)), max_df=0.5, stop_words="english")
    M = tf.fit_transform(texts)
    vocab = np.array(tf.get_feature_names_out())
    gmean = np.asarray(M.mean(axis=0)).ravel()

    def top_terms(idx: np.ndarray, count: int = 15) -> list[str]:
        score = np.asarray(M[idx].mean(axis=0)).ravel() - gmean
        out: list[str] = []
        for i in np.argsort(-score):
            w = vocab[i]
            if w in excl or not displayable(w, shown):
                continue
            out.append(w)
            if len(out) == count:
                break
        return out

    from sklearn.cluster import AgglomerativeClustering, KMeans
    # KMeans runs directly on the L2-normalised doc vectors (approximating spherical/cosine
    # k-means), not a UMAP reduction: UMAP's local-structure-preserving embedding (tried with
    # n_components 10-20, several neighbor/min_dist settings) reliably left one enormous
    # low-density "background" cluster (40%+ of the corpus) with everything else tiny — useless
    # as a "leaf topic". Clustering the raw vectors gave balanced clusters (largest ~5-6% of the
    # corpus) on this corpus, so that is what is used for both the leaf and parent step.
    Xr = V
    k = min(80, max(40, n // 150))
    km = KMeans(n_clusters=k, random_state=911, n_init=10).fit(Xr)
    leaf_labels = km.labels_
    n_parent = min(10, max(6, round(k / 8)))
    leaf_centroids = np.stack([
        Xr[leaf_labels == t].mean(axis=0) if np.any(leaf_labels == t) else Xr.mean(axis=0)
        for t in range(k)
    ])
    parent_of_leaf = AgglomerativeClustering(n_clusters=n_parent).fit(leaf_centroids).labels_

    probs = np.zeros(n)
    for t in range(k):
        idx = np.where(leaf_labels == t)[0]
        if len(idx) == 0:
            continue
        c = Xr[idx].mean(axis=0)
        d = np.linalg.norm(Xr[idx] - c, axis=1)
        maxd = d.max() if d.max() > 0 else 1.0
        probs[idx] = np.clip(1 - d / maxd, 0.05, 1.0)

    def folder_labels_for(idx: np.ndarray, count: int = 10) -> list[str]:
        c = collections.Counter()
        for i in idx:
            lab = (meta.get(docs[i], {}).get("folder_name") or "").strip()
            if lab:
                c[lab] += 1
        return [redact_titlecase(lab) for lab, _ in c.most_common(count)]

    def excerpts_for(idx: np.ndarray, count: int = 3) -> list[str]:
        cvec = V[idx].mean(axis=0)
        norm = np.linalg.norm(cvec) or 1.0
        cvec = cvec / norm
        sims = V[idx] @ cvec
        order = idx[np.argsort(-sims)]
        out: list[str] = []
        for i in order:
            f = page_files.get(docs[i])
            if not f:
                continue
            text = None
            for line in f.open():
                if not line.strip():
                    continue
                row = json.loads(line)
                t = (row.get("text") or "").strip()
                if len(t) > 40:
                    text = t
                    break
            if not text:
                continue
            out.append(redact_titlecase(re.sub(r"\s+", " ", text))[:300])
            if len(out) == count:
                break
        return out

    api_key = None
    if not args.no_name:
        try:
            api_key = CLAUDE_KEY_FILE.read_text().strip()
        except OSError:
            print(f"warning: could not read {CLAUDE_KEY_FILE}; writing terms-only labels", file=sys.stderr)

    cache: dict = {}
    if NAME_CACHE.exists():
        try:
            cache = json.loads(NAME_CACHE.read_text())
        except json.JSONDecodeError:
            cache = {}

    usage_totals = collections.Counter()

    def name_or_blank(idx: np.ndarray, terms: list[str]) -> dict:
        if not api_key:
            return {"title": None, "description": None, "confidence": 0.0}
        return name_topic(api_key, cache, terms, folder_labels_for(idx), excerpts_for(idx), roles_words, usage_totals)

    leaf_rows = []
    child_idx_by_parent: dict[int, list[int]] = collections.defaultdict(list)
    for t in range(k):
        idx = np.where(leaf_labels == t)[0]
        if len(idx) == 0:
            continue
        child_idx_by_parent[int(parent_of_leaf[t])].extend(idx.tolist())
        terms = top_terms(idx)
        boxes = collections.Counter(meta.get(docs[i], {}).get("box_name") for i in idx)
        ags = collections.Counter(meta.get(docs[i], {}).get("agency") for i in idx)
        pages = sum(int(meta.get(docs[i], {}).get("page_count") or 0) for i in idx)
        name = name_or_blank(idx, terms)
        parent_id = k + int(parent_of_leaf[t])
        leaf_rows.append({
            "topic": t, "parent": parent_id, "size_docs": len(idx), "size_pages": pages,
            "terms": terms, "boxes": boxes.most_common(10), "agencies": ags.most_common(5),
            "title": name.get("title"), "description": name.get("description"),
            "name_confidence": name.get("confidence"),
        })

    parent_rows = []
    for p in range(n_parent):
        idx = np.array(sorted(set(child_idx_by_parent.get(p, []))), dtype=int)
        if len(idx) == 0:
            continue
        terms = top_terms(idx)
        boxes = collections.Counter(meta.get(docs[i], {}).get("box_name") for i in idx)
        ags = collections.Counter(meta.get(docs[i], {}).get("agency") for i in idx)
        pages = sum(int(meta.get(docs[i], {}).get("page_count") or 0) for i in idx)
        name = name_or_blank(idx, terms)
        parent_rows.append({
            "topic": k + p, "parent": None, "size_docs": len(idx), "size_pages": pages,
            "terms": terms, "boxes": boxes.most_common(10), "agencies": ags.most_common(5),
            "title": name.get("title"), "description": name.get("description"),
            "name_confidence": name.get("confidence"),
        })

    NAME_CACHE.write_text(json.dumps(cache, indent=1))

    doc_topics_rows = [(docs[i], int(leaf_labels[i]), float(probs[i])) for i in range(n)]

    out_path = Path(args.write_to)
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    if tmp.exists():
        tmp.unlink()
    out = sqlite3.connect(tmp)
    out.executescript("""
    CREATE TABLE doc_vectors(doc TEXT PRIMARY KEY, n_chunks INT, vec BLOB);
    CREATE TABLE related(doc TEXT, rank INT, other TEXT, score REAL, cross INT, PRIMARY KEY(doc, rank));
    CREATE TABLE near_dupes(doc TEXT, other TEXT, score REAL);
    CREATE TABLE topics(topic INT PRIMARY KEY, parent INT, size_docs INT, size_pages INT, terms TEXT,
                        boxes TEXT, agencies TEXT, title TEXT, description TEXT, name_confidence REAL);
    CREATE TABLE doc_topics(doc TEXT PRIMARY KEY, topic INT, prob REAL);
    """)
    out.executemany("INSERT INTO doc_vectors VALUES (?,?,?)",
                    [(d, len(acc[d]), V[i].tobytes()) for i, d in enumerate(docs)])

    copied_related = copied_dupes = 0
    src_related = Path(args.related_src)
    if src_related.exists() and src_related.resolve() != out_path.resolve():
        rcon = sqlite3.connect(f"file:{src_related}?mode=ro", uri=True)
        try:
            rows = rcon.execute("SELECT doc, rank, other, score, cross FROM related").fetchall()
            out.executemany("INSERT INTO related VALUES (?,?,?,?,?)", rows)
            copied_related = len(rows)
            rows = rcon.execute("SELECT doc, other, score FROM near_dupes").fetchall()
            out.executemany("INSERT INTO near_dupes VALUES (?,?,?)", rows)
            copied_dupes = len(rows)
        except sqlite3.OperationalError:
            pass
        rcon.close()

    for r in leaf_rows + parent_rows:
        out.execute("INSERT INTO topics VALUES (?,?,?,?,?,?,?,?,?,?)", (
            r["topic"], r["parent"], r["size_docs"], r["size_pages"], json.dumps(r["terms"]),
            json.dumps(r["boxes"]), json.dumps(r["agencies"]), r["title"], r["description"],
            r["name_confidence"],
        ))
    out.executemany("INSERT INTO doc_topics VALUES (?,?,?)", doc_topics_rows)
    out.commit()
    out.close()
    os.replace(tmp, out_path)

    cost = usage_totals["input"] / 1e6 * HAIKU_PRICE["input"] + usage_totals["output"] / 1e6 * HAIKU_PRICE["output"]
    summary = {
        "docs_with_vectors": n, "leaf_topics": len(leaf_rows), "parent_topics": len(parent_rows),
        "copied_related_pairs": copied_related, "copied_near_dupes": copied_dupes,
        "haiku_calls": usage_totals["calls"], "haiku_input_tokens": usage_totals["input"],
        "haiku_output_tokens": usage_totals["output"], "haiku_cost_usd": round(cost, 4),
        "named": sum(1 for r in leaf_rows + parent_rows if r["title"]),
        "seconds": round(time.time() - t0, 1), "out": str(out_path),
    }
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
