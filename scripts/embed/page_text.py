"""One text-selection rule for embeddings, tagging, publication and search.
Original PDF extraction stays untouched. Approved OCR can replace a bad text layer;
legacy fallback OCR is eligible only when the original is shorter than 80 chars.
"""
import json
import re
from pathlib import Path

MIN_CHARS = 80

def load_ocr(path: Path) -> dict[int, dict]:
    doc = path.name.removesuffix('.pages.jsonl')
    sidecar = path.with_name(doc + '.ocr.jsonl')
    if not sidecar.exists():
        return {}
    rows = {int(row['page']): row for line in sidecar.read_text().splitlines()
            if line.strip() for row in [json.loads(line)]}
    # Approved OCR belongs to a particular PDF revision, not just its Bates id.
    text_root = next((parent for parent in path.resolve().parents if parent.name == 'text'), None)
    if text_root:
        pdf = text_root.parent / 'pdf' / path.resolve().relative_to(text_root).parent / (doc + '.pdf')
        stamp = (pdf.stat().st_mtime_ns, pdf.stat().st_size) if pdf.exists() else None
        rows = {page: row for page, row in rows.items()
                if not row.get('accepted_for_index') or
                (row.get('pdf_mtime_ns'), row.get('pdf_size')) == stamp}
    return rows

def select_text(row: dict, ocr: dict[int, dict]) -> tuple[str, str]:
    original = row.get('text') or ''
    candidate = ocr.get(int(row['page']), {})
    if candidate.get('accepted_for_index') is True:
        return candidate.get('text') or '', 'ours'
    if candidate.get('accepted_for_index') is False:
        return original, 'pdftotext'
    if (len(re.sub(r'\s+', ' ', original).strip()) < MIN_CHARS
            and len(re.sub(r'\s+', ' ', candidate.get('text') or '').strip()) >= MIN_CHARS):
        return candidate['text'], 'ours'
    return original, 'pdftotext'

def effective_rows(path: Path):
    ocr = load_ocr(path)
    with path.open() as source:
        for line in source:
            if line.strip():
                row = json.loads(line)
                text, origin = select_text(row, ocr)
                yield {**row, 'text': text, 'chars': len(text), 'text_source': origin}
