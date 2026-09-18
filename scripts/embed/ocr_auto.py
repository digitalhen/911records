#!/usr/bin/env python3
"""Incremental 300-DPI OCR recovery, shared by daily refresh and the ingestion loop.

Run from the repository root. Original PDFs/extractions remain untouched. Each wave
retains both engine results and backs up replaced sidecars before downstream stages.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts/eval'))
from ocr_upgrade import VERSION, DECISION_VERSION
from page_text import effective_rows, load_ocr

POLICY = f'{VERSION}:{DECISION_VERSION}:auto-1'


def fingerprint(pdf: Path, text: str) -> str:
    st = pdf.stat()
    value = [POLICY, st.st_mtime_ns, st.st_size, hashlib.sha256(text.encode()).hexdigest()]
    return hashlib.sha256(json.dumps(value).encode()).hexdigest()


def connect(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute('''CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, fingerprint TEXT, status TEXT, retry_at REAL,
        result_path TEXT, attempts INTEGER, updated REAL)''')
    return con


def remember(con, page_id, fp, status, result_path, attempts=0, retry_at=0):
    con.execute('INSERT OR REPLACE INTO reviews VALUES (?,?,?,?,?,?,?)',
                (page_id, fp, status, retry_at, str(result_path), attempts, time.time()))
    con.commit()


def candidates(data: Path, con, active_docs=None, now=None):
    now = time.time() if now is None else now
    known = {r[0]: r[1:] for r in con.execute('SELECT * FROM reviews')}
    pending = []
    counts = dict(pages_seen=0, approved=0, cached=0, deferred=0)
    for source in sorted((data / 'text').rglob('*.pages.jsonl')):
        doc = source.name.removesuffix('.pages.jsonl')
        if active_docs is not None and doc not in active_docs:
            continue
        pdf = data / 'pdf' / source.relative_to(data / 'text').parent / (doc + '.pdf')
        if not pdf.exists():
            continue
        overlays = load_ocr(source)
        for row in effective_rows(source):
            counts['pages_seen'] += 1
            page = int(row['page'])
            if overlays.get(page, {}).get('accepted_for_index') is True:
                counts['approved'] += 1
                continue
            page_id = f'{doc}-p{page}'
            fp = fingerprint(pdf, row['text'])
            prev = known.get(page_id)
            if prev and prev[0] == fp:
                if prev[1] == 'done':
                    counts['cached'] += 1
                    continue
                if prev[1] == 'error' and prev[2] > now:
                    counts['deferred'] += 1
                    continue
            sample = dict(id=page_id, doc=doc, page=page, pdf=str(pdf), text_file=str(source),
                          image=str(data / 'pages' / source.relative_to(data / 'text').parent / doc / f'{page}.webp'),
                          reason='automatic-full-page-review',
                          original_sha256=hashlib.sha256(row['text'].encode()).hexdigest())
            pending.append((sample, fp, prev if prev and prev[0] == fp else None))
    return pending, counts


def import_staged(folder: Path, con):
    """Reuse an audited comparison only when its policy, PDF and effective text match."""
    sources = {}
    imported = 0
    for sample in json.loads((folder / 'manifest.json').read_text()):
        path = folder / (sample['id'] + '.json')
        if not path.exists():
            continue
        result = json.loads(path.read_text())
        if result.get('decision_version') != DECISION_VERSION or result.get('stamp', {}).get('version') != VERSION:
            continue
        source = Path(sample['text_file'])
        if source not in sources:
            sources[source] = {r['page']: r for r in effective_rows(source)}
        row = sources[source].get(sample['page'])
        pdf = Path(sample['pdf'])
        if row is None or not pdf.exists():
            continue
        stamp = result['stamp']; st = pdf.stat()
        if (st.st_mtime_ns, st.st_size) != (stamp['pdf_mtime_ns'], stamp['pdf_size']):
            continue
        expected = result['original']['text']
        if result.get('selected'):
            expected = next(c['text'] for c in result['candidates'] if c['engine'] == result['selected'])
        if row['text'] != expected:
            continue
        remember(con, sample['id'], fingerprint(pdf, row['text']), 'done', path.resolve())
        imported += 1
    return imported


def ensure_vision(home: Path) -> Path:
    if sys.platform != 'darwin':
        raise RuntimeError('Automatic dual-engine OCR requires macOS with Apple Vision and Swift tools')
    for command in ('tesseract', 'pdftoppm', 'swiftc'):
        if not shutil.which(command):
            raise RuntimeError(f'Automatic OCR requires {command} on PATH')
    source = REPO / 'scripts/eval/ocr_vision.swift'
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    target = home / 'bin' / ('vision-' + digest)
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix('.tmp')
        subprocess.run(['swiftc', '-O', str(source), '-o', str(tmp)], check=True, timeout=300)
        tmp.replace(target)
    return target


@contextmanager
def pipeline_lock(path: Path, owner: int | None = None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if owner is not None:
        if int((path / 'pid').read_text()) != owner:
            raise RuntimeError('OCR pipeline lock owner does not match')
        os.kill(owner, 0)
        yield
        return
    try:
        path.mkdir()
    except FileExistsError:
        try:
            pid = int((path / 'pid').read_text())
        except (FileNotFoundError, ValueError):
            raise RuntimeError('Ingestion lock has no valid owner; inspect it before retrying')
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            shutil.rmtree(path)
            path.mkdir()
        else:
            raise RuntimeError(f'Ingestion already running (pid {pid})')
    (path / 'pid').write_text(str(os.getpid()))
    try:
        yield
    finally:
        shutil.rmtree(path)


def process_wave(wave, folder: Path, backup: Path, con, vision: Path, jobs=None):
    folder.mkdir(parents=True)
    samples = [entry[0] for entry in wave]
    manifest = folder / 'manifest.json'
    manifest.write_text(json.dumps(samples, indent=2))
    for sample, fp, prev in wave:
        dest = folder / (sample['id'] + '.json')
        if prev and prev[3] and Path(prev[3]).exists():
            shutil.copy2(prev[3], dest)
        remember(con, sample['id'], fp, 'pending', dest.resolve(), prev[4] if prev else 0)
    run = subprocess.run([sys.executable, str(REPO / 'scripts/eval/ocr_upgrade.py'),
                          '--manifest', str(manifest), '--output', str(folder),
                          '--vision', str(vision), '--jobs', str(jobs or len(wave))], check=False)
    if run.returncode not in (0, 1):
        raise RuntimeError(f'OCR comparator exited {run.returncode}')
    successful = []
    errors = 0
    for sample, fp, prev in wave:
        result = folder / (sample['id'] + '.json')
        # A stale copied result must not mask a failed attempt against a changed source.
        if result.exists():
            r = json.loads(result.read_text())
            stamp = r.get('stamp', {})
            current_stamp = Path(sample['pdf']).stat()
            if (stamp.get('version') == VERSION
                    and (stamp.get('pdf_mtime_ns'), stamp.get('pdf_size')) == (current_stamp.st_mtime_ns, current_stamp.st_size)
                    and stamp.get('original_sha256') == sample['original_sha256']
                    and r.get('sample', {}).get('id') == sample['id']
                    and r.get('decision_version') == DECISION_VERSION):
                successful.append((sample, fp, prev))
                continue
        attempts = (prev[4] if prev else 0) + 1
        remember(con, sample['id'], fp, 'error', result.resolve(), attempts,
                 time.time() + min(86400, 3600 * 2 ** min(attempts - 1, 5)))
        errors += 1
    manifest.write_text(json.dumps([s for s, _, _ in successful], indent=2))
    if successful:
        subprocess.run([sys.executable, str(REPO / 'scripts/eval/ocr_apply.py'),
                        '--staged', str(folder), '--backup', str(backup)], check=True)
        for sample, fp, _ in successful:
            remember(con, sample['id'], fp, 'done', (folder / (sample['id'] + '.json')).resolve())
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs', type=int, default=int(os.getenv('OCR_AUTO_JOBS', '4')))
    parser.add_argument('--max-pages', type=int, default=int(os.getenv('OCR_AUTO_MAX_PAGES', '500')))
    parser.add_argument('--max-seconds', type=float, default=float(os.getenv('OCR_AUTO_MAX_SECONDS', '900')))
    parser.add_argument('--lock-owner', type=int)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--drain', action='store_true', help='finish the current page queue without per-cycle page/time caps')
    parser.add_argument('--import-staged', type=Path)
    args = parser.parse_args()
    if args.jobs < 1 or args.max_pages < 1 or args.max_seconds <= 0:
        parser.error('jobs, max-pages and max-seconds must be positive')
    os.chdir(REPO)
    data = Path('data'); home = data / 'ocr-auto'
    with pipeline_lock(data / 'embed/loop.lock', args.lock_owner):
        con = connect(home / 'state.sqlite')
        imported = import_staged(args.import_staged, con) if args.import_staged else 0
        active = None
        if (data / 'manifest.jsonl').exists():
            active = {r['bates_start'] for line in (data / 'manifest.jsonl').read_text().splitlines()
                      if line.strip() for r in [json.loads(line)] if r.get('status') != 'removed'}
        pending, counts = candidates(data, con, active)
        stats = dict(**counts, imported=imported, processed=0, applied=0, errors=0,
                     remaining=len(pending), dry_run=args.dry_run)
        if pending and not args.dry_run:
            vision = ensure_vision(home)
            root = home / 'runs' / (time.strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8])
            start = time.monotonic()
            limit = len(pending) if args.drain else min(len(pending), args.max_pages)
            wave_size = args.jobs * 8
            for offset in range(0, limit, wave_size):
                if not args.drain and time.monotonic() - start >= args.max_seconds:
                    break
                wave = pending[offset:min(offset + wave_size, limit)]
                stats['errors'] += process_wave(wave, root / f'wave-{offset:05d}', root / 'backup', con, vision, args.jobs)
                stats['processed'] += len(wave)
                (home / 'progress.json').write_text(json.dumps(dict(stats, run=str(root), queued=len(pending), remaining=len(pending)-stats['processed']), indent=2))
                print(json.dumps(dict(ocr_progress=stats['processed'], queued=len(pending), errors=stats['errors'])), flush=True)
            ledger = root / 'backup/applied.json'
            stats['applied'] = len(json.loads(ledger.read_text())) if ledger.exists() else 0
            stats['remaining'] -= stats['processed']
            stats['run'] = str(root)
        con.close()
        home.mkdir(parents=True, exist_ok=True)
        (home / 'last-run.json').write_text(json.dumps(stats, indent=2))
        print(json.dumps(stats), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
