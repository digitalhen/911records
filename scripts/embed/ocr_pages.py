#!/usr/bin/env python3
"""OCR empty pages locally. OCR boxes use image pixels (space='px').

Cache each (document, page) by image path, nanosecond mtime, size and OCR options.
Revisit status=ocr too, so replacement images are not hidden by embedding status.
Publish boxes first and text last; cache hits require matching entries in both.
"""
from __future__ import annotations
import argparse
import csv
import io
import json
import os
import sqlite3
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / 'data'


def read_lines(path):
    if not path.exists():
        return {}
    return {int(r['page']): r for line in path.read_text().splitlines() if line.strip() for r in [json.loads(line)]}


def atomic_lines(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'w') as f:
            for page in sorted(rows):
                f.write(json.dumps(rows[page], ensure_ascii=False) + '\n')
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--limit', type=int, default=0, help='maximum pages to OCR')
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--psm', type=int, default=6)
    args = ap.parse_args()
    if args.limit < 0 or args.jobs < 1:
        ap.error('limit must be nonnegative and jobs positive')
    stats = dict(ocr=0, cached=0, missing_image=0, errors=0)
    db = DATA / 'embed/pages.sqlite'
    if not db.exists():
        print(json.dumps({**stats, 'missing_database': True}))
        return 0
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    rows = con.execute("SELECT doc,page,bates FROM pages WHERE status IN ('empty','ocr') ORDER BY doc,page").fetchall()
    con.close()
    paths = {p.name[:-len('.pages.jsonl')]: p for p in (DATA / 'text').rglob('*.pages.jsonl')}
    docs, tasks = {}, []
    for doc, page, bates in rows:
        if args.limit and len(tasks) >= args.limit:
            break
        src = paths.get(doc)
        if src is None:
            continue
        base = src.parent / doc
        if doc not in docs:
            text_path, box_path = Path(str(base) + '.ocr.jsonl'), Path(str(base) + '.ocr.boxes.jsonl')
            docs[doc] = (text_path, box_path, read_lines(text_path), read_lines(box_path))
        _, _, texts, boxes = docs[doc]
        image_dir = DATA / 'pages' / src.parent.relative_to(DATA / 'text') / doc
        image = next((image_dir / f'{page}.{ext}' for ext in ('webp', 'jpg') if (image_dir / f'{page}.{ext}').exists()), None)
        if image is None:
            stats['missing_image'] += 1
            continue
        # A reviewed high-resolution replacement must survive subsequent legacy
        # fallback passes. Revisit when its original PDF changes.
        prior = texts.get(page, {})
        pdf = DATA / 'pdf' / src.parent.relative_to(DATA / 'text') / (doc + '.pdf')
        if prior.get('accepted_for_index') is True and pdf.exists():
            pst = pdf.stat()
            if (prior.get('pdf_mtime_ns'), prior.get('pdf_size')) == (pst.st_mtime_ns, pst.st_size):
                stats['cached'] += 1
                continue
        st = image.stat()
        stamp = dict(image=str(image.relative_to(DATA)), image_mtime_ns=st.st_mtime_ns, image_size=st.st_size, psm=args.psm, lang='eng')
        if all(all(record.get(k) == v for k, v in stamp.items()) for record in (texts.get(page, {}), boxes.get(page, {}))):
            stats['cached'] += 1
            continue
        tasks.append((doc, page, bates, image, stamp))

    def ocr(task):
        doc, page, bates, image, stamp = task
        result = subprocess.run(['tesseract', str(image), 'stdout', '-l', 'eng', '--psm', str(args.psm), 'tsv'], capture_output=True, text=True, check=True, timeout=300)
        words, confidence, lines = [], [], {}
        w = h = None
        for r in csv.DictReader(io.StringIO(result.stdout), delimiter='\t', quoting=csv.QUOTE_NONE):
            if r['level'] == '1':
                w, h = int(r['width']), int(r['height'])
            if r['level'] != '5' or not (r.get('text') or '').strip():
                continue
            x, y, width, height = (int(r[k]) for k in ('left', 'top', 'width', 'height'))
            words.append([x, y, x + width, y + height, r['text']])
            conf = float(r['conf'])
            if conf >= 0:
                confidence.append(conf)
            key = tuple(r[k] for k in ('block_num', 'par_num', 'line_num'))
            lines.setdefault(key, []).append(r['text'])
        if w is None or h is None:
            raise ValueError('TSV has no page dimensions')
        # Do not cache a result against an image that changed during OCR.
        st = image.stat()
        if st.st_mtime_ns != stamp['image_mtime_ns'] or st.st_size != stamp['image_size']:
            raise ValueError('Image changed during OCR')
        text = '\n'.join(' '.join(line) for line in lines.values())
        return doc, page, dict(page=page, bates=bates, chars=len(text), text=text, source='tesseract', conf=round(sum(confidence)/len(confidence), 2) if confidence else None, **stamp), dict(page=page, w=w, h=h, words=words, space='px', **stamp)

    def safe(task):
        try:
            return ocr(task)
        except Exception as exc:
            # No OCR text or tesseract output in logs.
            import sys
            print(f'OCR {task[0]} page {task[1]}: {type(exc).__name__}', file=sys.stderr)
            return None

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for result in pool.map(safe, tasks):
            if result is None:
                stats['errors'] += 1
                continue
            doc, page, text, box = result
            text_path, box_path, texts, boxes = docs[doc]
            texts[page], boxes[page] = text, box
            atomic_lines(box_path, boxes)
            atomic_lines(text_path, texts)
            stats['ocr'] += 1
    print(json.dumps(stats))
    return int(stats['errors'] > 0)


if __name__ == '__main__':
    raise SystemExit(main())
