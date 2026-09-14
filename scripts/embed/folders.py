#!/usr/bin/env python3
"""folders.py — stage 0 of the embedding work: embed and cluster the 4,172 folder labels.

Folder labels are the only descriptive text available before the PDFs are mirrored
and their OCR text extracted. This clusters them to see the archive's themes early.

Local only: reads data/manifest.jsonl, embeds with Ollama (nomic-embed-text, the
"clustering: " task prefix), reduces with UMAP, clusters with HDBSCAN, and names
each cluster by its distinctive TF-IDF terms. Never contacts the portal.

Writes data/embed/folders/:
  embeddings.npy     float32 [n_labels, 768], row order = labels.json
  labels.json        [{label, docs, pages, boxes, agencies, x, y, cluster}]
  clusters.json      [{cluster, size_labels, size_docs, size_pages, terms, agencies}]
  map.html           a self-contained scatter plot (LOCAL ONLY: labels may contain
                     personal names — do not publish without scrubbing)

Folder labels can contain names of private individuals, so the console summary
prints only terms that never occur inside a TitleCase word pair in any label.

Usage: .venv/bin/python scripts/embed/folders.py [--min-cluster 8]
"""
from __future__ import annotations

import argparse
import collections
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"
OUT = DATA / "embed" / "folders"
OLLAMA = "http://localhost:11434/api/embed"
MODEL = "nomic-embed-text"

# Agency / technical acronyms and domain words allowed in displayed cluster names.
DOMAIN_TERMS = {
    "epa", "dep", "dcas", "fdny", "nypd", "ddc", "dob", "doris", "dohmh", "edc", "fema", "osha", "niosh",
    "atsdr", "cdc", "usace", "nysdec", "nysdoh", "wtc", "nyc", "foil", "gcms", "pcb", "pcbs", "pah", "pahs",
    "voc", "vocs", "hvac", "tem", "plm", "pcm", "hepa", "msds", "bin", "ppm", "ppb", "coc", "qaqc", "mep",
    "voa", "tic", "tics", "svoc", "svocs", "icp", "xrf", "pm", "dust", "dioxin", "dioxins", "freon",
}


def embed(texts: list[str], batch: int = 128) -> np.ndarray:
    out = []
    for i in range(0, len(texts), batch):
        body = json.dumps({"model": MODEL, "input": [f"clustering: {t}" for t in texts[i:i + batch]]}).encode()
        req = urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"})
        out.extend(json.load(urllib.request.urlopen(req, timeout=600))["embeddings"])
    v = np.asarray(out, dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-cluster", type=int, default=8)
    args = ap.parse_args()

    from sklearn.cluster import HDBSCAN
    from sklearn.feature_extraction.text import TfidfVectorizer
    import umap

    rows = [json.loads(l) for l in (DATA / "manifest.jsonl").open()]
    agg: dict[str, dict] = {}
    for r in rows:
        lab = (r.get("folder_name") or "").strip()
        if not lab:
            continue
        a = agg.setdefault(lab, {"label": lab, "docs": 0, "pages": 0, "boxes": set(), "agencies": set()})
        a["docs"] += 1
        a["pages"] += int(r.get("page_count") or 0)
        a["boxes"].add(r.get("box_name") or "")
        a["agencies"].add(r.get("agency") or "")
    items = sorted(agg.values(), key=lambda a: -a["docs"])
    labels = [a["label"] for a in items]
    print(f"folder labels: {len(labels)} (docs with no label skipped: {sum(1 for r in rows if not (r.get('folder_name') or '').strip())})")

    OUT.mkdir(parents=True, exist_ok=True)
    t = time.time()
    X = embed(labels)
    np.save(OUT / "embeddings.npy", X)
    print(f"embedded {X.shape} in {time.time() - t:.1f}s")

    t = time.time()
    X10 = umap.UMAP(n_components=10, n_neighbors=15, min_dist=0.0, metric="cosine", random_state=911).fit_transform(X)
    X2 = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.1, metric="cosine", random_state=911).fit_transform(X)
    cl = HDBSCAN(min_cluster_size=args.min_cluster, min_samples=3).fit_predict(X10)
    print(f"umap+hdbscan in {time.time() - t:.1f}s: {len(set(cl) - {-1})} clusters, noise {int((cl == -1).sum())} labels")

    # Cluster names are shown to people, and labels can hold private names. A term is
    # shown only if it is a common English word (system dictionary, lower-case entries,
    # which excludes proper nouns) or a known agency/technical acronym. Everything else
    # (surnames, unknown tokens) is withheld.
    shown = set(DOMAIN_TERMS)
    dict_path = Path("/usr/share/dict/words")
    if dict_path.exists():
        shown |= {w.strip() for w in dict_path.open() if w.strip() and w.strip().islower()}

    tf = TfidfVectorizer(token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z]{2,}\b", sublinear_tf=True, min_df=2)
    M = tf.fit_transform(labels)
    vocab = np.array(tf.get_feature_names_out())
    global_mean = np.asarray(M.mean(axis=0)).ravel()
    present = (M > 0).astype(np.float32)

    clusters = []
    withheld_terms = 0
    for c in sorted(set(cl) - {-1}):
        idx = np.where(cl == c)[0]
        share = np.asarray(present[idx].mean(axis=0)).ravel()      # fraction of the cluster's labels containing the term
        score = np.asarray(M[idx].mean(axis=0)).ravel() - global_mean
        cand = [i for i in np.argsort(-score) if share[i] >= 0.2 and score[i] > 0]
        terms = []
        for i in cand:
            w = vocab[i]
            stems = {w, w[:-1] if w.endswith("s") else w, w[:-2] if w.endswith("es") else w,
                     w[:-3] + "y" if w.endswith("ies") else w}
            if stems & shown:
                terms.append(w)
            else:
                withheld_terms += 1
            if len(terms) == 6:
                break
        ag = collections.Counter()
        for i in idx:
            ag.update({a: items[i]["docs"] for a in items[i]["agencies"]})
        clusters.append({
            "cluster": int(c), "size_labels": int(len(idx)),
            "size_docs": int(sum(items[i]["docs"] for i in idx)),
            "size_pages": int(sum(items[i]["pages"] for i in idx)),
            "terms": terms, "agencies": dict(ag.most_common(3)),
        })
    clusters.sort(key=lambda c: -c["size_docs"])

    out_rows = []
    for i, a in enumerate(items):
        out_rows.append({"label": a["label"], "docs": a["docs"], "pages": a["pages"],
                         "boxes": sorted(a["boxes"]), "agencies": sorted(a["agencies"]),
                         "x": float(X2[i, 0]), "y": float(X2[i, 1]), "cluster": int(cl[i])})
    (OUT / "labels.json").write_text(json.dumps(out_rows))
    (OUT / "clusters.json").write_text(json.dumps(clusters, indent=1))
    write_map(out_rows, clusters, OUT / "map.html")

    print(f"\n{'docs':>6} {'pages':>7} {'labels':>6}  terms (name-like tokens withheld)  | top agency")
    for c in clusters[:25]:
        top = next(iter(c["agencies"]), "")
        print(f"{c['size_docs']:>6} {c['size_pages']:>7} {c['size_labels']:>6}  {', '.join(c['terms'])}  | {top.split(',')[0]}")
    print(f"\ncandidate terms withheld as not-dictionary/not-domain (possible names): {withheld_terms}")
    print(f"wrote {OUT}")
    return 0


def write_map(rows, clusters, path: Path) -> None:
    names = {c["cluster"]: " · ".join(c["terms"][:3]) for c in clusters}
    pts = [[round(r["x"], 3), round(r["y"], 3), r["cluster"], r["docs"], r["label"]] for r in rows]
    doc = f"""<!doctype html><meta charset=utf-8><title>Folder label map (local)</title>
<style>body{{margin:0;font:13px system-ui;background:#fbfaf7;color:#222}}#tip{{position:fixed;pointer-events:none;background:#fff;border:1px solid #ccc;padding:4px 6px;display:none;max-width:420px}}
header{{padding:8px 12px}}canvas{{display:block}}</style>
<header><b>9/11 portal — {len(rows)} folder labels, {len(clusters)} clusters</b> · local only (labels may contain personal names)</header>
<canvas id=c></canvas><div id=tip></div><script>
const P={json.dumps(pts)},N={json.dumps(names)};
const c=document.getElementById('c'),x=c.getContext('2d'),tip=document.getElementById('tip');
const W=innerWidth,H=innerHeight-40;c.width=W;c.height=H;
const xs=P.map(p=>p[0]),ys=P.map(p=>p[1]),mx=Math.min(...xs),Mx=Math.max(...xs),my=Math.min(...ys),My=Math.max(...ys);
const sx=v=>20+(v-mx)/(Mx-mx)*(W-40),sy=v=>20+(v-my)/(My-my)*(H-40);
const col=k=>k<0?'rgba(0,0,0,.15)':`hsl(${{(k*137.5)%360}} 65% 45% / .75)`;
for(const p of P){{x.fillStyle=col(p[2]);x.beginPath();x.arc(sx(p[0]),sy(p[1]),1.5+Math.sqrt(p[3]),0,7);x.fill()}}
x.font='11px system-ui';x.fillStyle='#000';
const cent={{}};for(const p of P)if(p[2]>=0){{const e=cent[p[2]]??=[0,0,0];e[0]+=p[0];e[1]+=p[1];e[2]++}}
for(const k in cent){{const e=cent[k];x.fillText(N[k]||'',sx(e[0]/e[2]),sy(e[1]/e[2]))}}
c.onmousemove=ev=>{{let b=null,d=64;for(const p of P){{const q=(sx(p[0])-ev.offsetX)**2+(sy(p[1])-ev.offsetY)**2;if(q<d){{d=q;b=p}}}}
if(!b){{tip.style.display='none';return}}tip.style.display='block';tip.style.left=ev.clientX+12+'px';tip.style.top=ev.clientY+12+'px';
tip.textContent=`${{b[4]}} — ${{b[3]}} docs — cluster ${{b[2]}} (${{N[b[2]]||'noise'}})`}};
</script>"""
    path.write_text(doc)


if __name__ == "__main__":
    sys.exit(main())
