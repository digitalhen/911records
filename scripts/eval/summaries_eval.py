#!/usr/bin/env python3
"""Evaluate summariser backends on the same batch of documents.

Inputs: the batch prompt the pipeline sent (data/eval/batch20-prompt.txt) and each model's raw
output. Scores every (model, document) pair three ways:

  1. Format: valid JSON array, every item has id/title/summary, title <= 12 words, summary <= 40 words.
  2. Grounding (deterministic hallucination proxy): every capitalised word, number and year in the
     title+summary must appear in the document's excerpt, folder label, box or agency (OCR-tolerant:
     a token counts as found if a 4-character prefix matches). Reported as the share of grounded tokens.
  3. Judge (optional, --judge): a small model rates faithfulness (1-5) and specificity (1-5) per item
     from the excerpt alone, in one call per model.

Writes data/eval/summaries-eval.json and data/eval/summaries-eval.html (a Vega-Lite report), and,
with BRAINTRUST_API_KEY set and the `braintrust` package installed, logs every item to a Braintrust
experiment so the runs can be compared in its UI (--braintrust).
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "embed"))
sys.argv, _argv = ["summaries.py"], sys.argv  # summaries.py parses argv on import in main() only; keep clean
import summaries as sm  # noqa: E402
sys.argv = _argv

STOP = {"The", "A", "An", "This", "Form", "Record", "Report", "Document", "Records", "Sample", "Samples", "City", "New", "York",
        "Chain", "Custody", "Laboratory", "Lab", "Labs", "Department", "County", "Analysis", "Water", "Air", "Test", "Testing"}


def load_items(prompt_path: Path) -> dict[int, dict]:
    text = prompt_path.read_text()
    user = text[len(sm.SYSTEM_PROMPT) + 2:]
    items = {}
    for m in re.finditer(r'\{\s*"id":\s*(\d+),\s*"doc_type":\s*"(.*?)",\s*"folder":\s*"(.*?)",\s*"box":\s*"(.*?)",\s*"agency":\s*"(.*?)",\s*"page_count":\s*(\S+?),\s*"excerpt":\s*"(.*?)"\s*\}', user, flags=re.S):
        i, dt, folder, box, agency, pc, ex = m.groups()
        items[int(i)] = {"id": int(i), "doc_type": dt, "folder": folder, "box": box, "agency": agency, "excerpt": ex}
    if not items:  # fall back to a looser parse
        for m in re.finditer(r'"id":\s*(\d+).*?"excerpt":\s*"(.*?)"\s*[,}]', user, flags=re.S):
            items[int(m.group(1))] = {"id": int(m.group(1)), "doc_type": "", "folder": "", "box": "", "agency": "", "excerpt": m.group(2)}
    return items


def tokens_to_ground(s: str) -> list[str]:
    out = []
    for tok in re.findall(r"[A-Za-z][A-Za-z&'.-]+|\d{2,4}", s):
        if tok[0].isupper() and tok not in STOP and len(tok) > 2:
            out.append(tok)
        elif tok.isdigit():
            out.append(tok)
    return out


def grounded(tok: str, hay: str) -> bool:
    h = hay.lower()
    t = tok.lower().strip(".,'&-")
    if not t:
        return True
    if t in h:
        return True
    return len(t) >= 4 and t[:4] in h


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def expand_dates(text: str) -> str:
    """A date the OCR shows as 10/25/01 supports a summary that says "Oct 2001": add the spelled-out
    forms so the grounding check does not penalise a correct reading of a numeric date."""
    out = []
    for m in re.finditer(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b", text):
        mo, _d, yr = int(m.group(1)), m.group(2), m.group(3)
        year = int(yr) if len(yr) == 4 else (2000 + int(yr) if int(yr) < 50 else 1900 + int(yr))
        if 1 <= mo <= 12:
            out += [MONTHS[mo - 1], MONTHS[mo - 1][:3], str(year)]
    for m in re.finditer(r"\b(19|20)(\d{2})\b", text):
        out.append(m.group(0))
    return " ".join(out)


def score_format(items: dict[int, dict], out: list | None) -> dict[int, dict]:
    res = {}
    for i in items:
        a = next((x for x in (out or []) if isinstance(x, dict) and x.get("id") == i), None)
        if not a or not a.get("title") or not a.get("summary"):
            res[i] = {"valid": 0, "title_words": 0, "summary_words": 0, "title": None, "summary": None, "confidence": None}
            continue
        tw, sw = len(str(a["title"]).split()), len(str(a["summary"]).split())
        res[i] = {"valid": int(tw <= 12 and sw <= 40), "title_words": tw, "summary_words": sw,
                  "title": str(a["title"]), "summary": str(a["summary"]), "confidence": a.get("confidence")}
    return res


def score_grounding(items: dict[int, dict], fmt: dict[int, dict]) -> None:
    for i, it in items.items():
        r = fmt[i]
        if not r["title"]:
            r["grounding"] = 0.0; r["ungrounded"] = []
            continue
        hay = " ".join([it["excerpt"], it["folder"], it["box"], it["agency"], it["doc_type"].replace("_", " ")])
        hay += " " + expand_dates(it["excerpt"])
        toks = tokens_to_ground(r["title"] + " " + r["summary"])
        bad = [t for t in toks if not grounded(t, hay)]
        r["grounding"] = 1.0 if not toks else round(1 - len(bad) / len(toks), 3)
        r["ungrounded"] = bad


JUDGE_SYSTEM = ("You grade machine-written titles and one-line summaries of archival documents against the OCR excerpt "
                "they were written from. For each item return faithfulness 1-5 (5 = nothing stated that the excerpt does not "
                "support; 1 = invented facts) and specificity 1-5 (5 = names the concrete place, date, substance or lab the "
                "excerpt shows; 1 = generic). Output ONLY a JSON array of {\"id\", \"faithfulness\", \"specificity\", \"note\"}.")


def judge(items: dict[int, dict], fmt: dict[int, dict], model: str) -> dict[int, dict]:
    rows = []
    for i, it in items.items():
        r = fmt[i]
        if not r["title"]:
            continue
        rows.append({"id": i, "excerpt": it["excerpt"][:1500], "title": r["title"], "summary": r["summary"]})
    prompt = "Items:\n" + json.dumps(rows, ensure_ascii=False)
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    p = subprocess.run(["claude", "-p", "--model", model, "--output-format", "json", "--no-session-persistence", "--tools", "",
                        "--system-prompt", JUDGE_SYSTEM], input=prompt, capture_output=True, text=True, env=env, timeout=600)
    try:
        arr = sm.extract_json_array(json.loads(p.stdout).get("result", "")) or []
    except Exception:
        arr = []
    return {int(a["id"]): a for a in arr if isinstance(a, dict) and "id" in a}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", default=str(ROOT / "data/eval/batch20-prompt.txt"))
    ap.add_argument("--outputs", default=str(ROOT / "data/eval/outputs-haiku-luna-qwen35b.json"), help="JSON {model: [items]}")
    ap.add_argument("--extra", action="append", default=[], help="model=path to a raw output file to parse")
    ap.add_argument("--judge", action="store_true")
    ap.add_argument("--judge-model", default="claude-haiku-4-5-20251001")
    ap.add_argument("--braintrust", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "data/eval/summaries-eval.json"))
    args = ap.parse_args()

    items = load_items(Path(args.prompt))
    outputs = json.load(open(args.outputs))
    for spec in args.extra:
        name, path = spec.split("=", 1)
        outputs[name] = sm.extract_json_array(Path(path).read_text())

    report = {"n_items": len(items), "models": {}}
    for model, out in outputs.items():
        fmt = score_format(items, out)
        score_grounding(items, fmt)
        jd = judge(items, fmt, args.judge_model) if args.judge else {}
        per = []
        for i in sorted(items):
            r = dict(fmt[i]); r["id"] = i
            if i in jd:
                r["faithfulness"] = jd[i].get("faithfulness"); r["specificity"] = jd[i].get("specificity"); r["judge_note"] = jd[i].get("note")
            per.append(r)
        n = len(per)
        titles = [r["title"] for r in per if r["title"]]
        summary = {
            "usable": sum(1 for r in per if r["title"]) / n,
            "format_ok": sum(r["valid"] for r in per) / n,
            "grounding": round(sum(r["grounding"] for r in per) / n, 3),
            "distinct_titles": round(len(set(titles)) / max(1, len(titles)), 3),
            "mean_confidence": round(sum(float(r["confidence"] or 0) for r in per) / n, 3),
        }
        if jd:
            summary["faithfulness"] = round(sum(float(r.get("faithfulness") or 0) for r in per) / n, 2)
            summary["specificity"] = round(sum(float(r.get("specificity") or 0) for r in per) / n, 2)
        report["models"][model] = {"summary": summary, "items": per}
        print(model, json.dumps(summary))

    Path(args.out).write_text(json.dumps(report, indent=1, ensure_ascii=False))
    write_html(report, Path(args.out).with_suffix(".html"))

    if args.braintrust:
        if not os.environ.get("BRAINTRUST_API_KEY"):
            print("BRAINTRUST_API_KEY not set — skipping upload", file=sys.stderr)
        else:
            import braintrust  # type: ignore
            for model, data in report["models"].items():
                exp = braintrust.init(project="911records-summaries", experiment=model)
                for r in data["items"]:
                    it = items[r["id"]]
                    exp.log(input={"excerpt": it["excerpt"], "folder": it["folder"], "doc_type": it["doc_type"]},
                            output={"title": r["title"], "summary": r["summary"]},
                            scores={k: v for k, v in {"format_ok": r["valid"], "grounding": r["grounding"],
                                    "faithfulness": (r.get("faithfulness") or 0) / 5 if "faithfulness" in r else None,
                                    "specificity": (r.get("specificity") or 0) / 5 if "specificity" in r else None}.items() if v is not None},
                            metadata={"model": model, "id": r["id"], "ungrounded": r["ungrounded"]})
                print("braintrust:", exp.summarize())
    return 0


def write_html(report: dict, path: Path) -> None:
    rows = []
    for model, data in report["models"].items():
        for k, v in data["summary"].items():
            rows.append({"model": model, "metric": k, "value": v})
    item_rows = [{"model": m, **{k: r.get(k) for k in ("id", "grounding", "faithfulness", "specificity", "title")}}
                 for m, d in report["models"].items() for r in d["items"]]
    spec1 = {"$schema": "https://vega.github.io/schema/vega-lite/v5.json", "title": "Summariser backends on the same 20 documents",
             "data": {"values": rows}, "mark": "bar", "height": 220, "width": 520,
             "encoding": {"x": {"field": "metric", "type": "nominal", "title": None}, "xOffset": {"field": "model"},
                          "y": {"field": "value", "type": "quantitative", "title": "score (fraction or 1-5 scaled)"},
                          "color": {"field": "model"}, "tooltip": [{"field": "model"}, {"field": "metric"}, {"field": "value"}]}}
    spec2 = {"$schema": "https://vega.github.io/schema/vega-lite/v5.json", "title": "Grounding per document (share of names, numbers and years found in the excerpt)",
             "data": {"values": item_rows}, "mark": "rect", "height": 120, "width": 520,
             "encoding": {"x": {"field": "id", "type": "ordinal", "title": "document"}, "y": {"field": "model", "type": "nominal", "title": None},
                          "color": {"field": "grounding", "type": "quantitative", "scale": {"scheme": "blues", "domain": [0, 1]}},
                          "tooltip": [{"field": "model"}, {"field": "id"}, {"field": "grounding"}, {"field": "title"}]}}
    html = f"""<!doctype html><meta charset="utf-8"><title>Summariser evaluation</title>
<script src="https://cdn.jsdelivr.net/npm/vega@5"></script><script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script><script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
<body style="font-family:system-ui;margin:24px;max-width:900px"><h1 style="font-size:20px">911records.nyc summariser evaluation</h1>
<p style="color:#555">Same batch prompt, same {report['n_items']} documents, one call per model. Generated by scripts/eval/summaries_eval.py.</p>
<div id="v1"></div><div id="v2" style="margin-top:24px"></div>
<script>vegaEmbed('#v1',{json.dumps(spec1)});vegaEmbed('#v2',{json.dumps(spec2)});</script></body>"""
    path.write_text(html)


if __name__ == "__main__":
    raise SystemExit(main())
