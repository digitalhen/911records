#!/usr/bin/env python3
"""Build ZIP64 downloads from the published catalog. No network calls; atomic publication."""
import argparse
import collections
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import zipfile

README = '''911records.nyc — original City PDFs

PDFs are organized by agency, production volume and Bates number.
manifest.json lists the included documents, byte sizes and SHA-256 checksums.
Folder labels and machine-generated descriptions are not included.
These are the records available in this catalog, not every record ever released.
The City may add, replace or withdraw records. Download a fresh manifest from
https://911records.nyc/api/downloads/manifest.json to compare your copy.
Match documents by their path: new paths are additions, changed SHA-256 values
are replacements, and paths absent from the new manifest should be removed
from a copy intended to match the current collection. Check /changes for context.
We cannot recall copies already downloaded. Do not treat an old ZIP as current.
Catalog capture dates are not necessarily the dates the City changed a record.
Independent project by Cleartext Labs; not affiliated with the City of New York.
'''

def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')) + '\n').encode()

def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()

def build(data, output):
    output.mkdir(parents=True, exist_ok=True)
    with (output / '.build.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return build_locked(data, output)

def build_locked(data, output):
    with sqlite3.connect(f'file:{data / "site/site.sqlite"}?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        meta = dict(db.execute('SELECT key,value FROM meta'))
        rows = [dict(r) for r in db.execute('SELECT doc,agency,volume,box,source,page_count,status,removed_at FROM documents ORDER BY doc')]
    if not meta.get('built_at'):
        raise ValueError('Catalog has no build identifier')
    mirror = {r['bates_start']: r for line in (data / 'manifest.jsonl').read_text().splitlines() if line.strip() for r in [json.loads(line)]}
    groups = collections.defaultdict(list)
    records, removed, files = [], [], {}
    for row in rows:
        doc = row['doc']
        if row['status'] == 'removed':
            removed.append({'doc': doc, 'removed_at': row['removed_at']})
            continue
        if row['status'] != 'present':
            raise ValueError(f'Unknown document status: {doc}')
        source = mirror[doc]
        if source.get('status') != 'present':
            raise ValueError(f'Mirror/catalog disagree: {doc}')
        relative = Path(source['local_pdf'])
        if relative.parts[:2] != ('data', 'pdf') or '..' in relative.parts:
            raise ValueError(f'Unsafe PDF path: {doc}')
        path = (data / Path(*relative.parts[1:])).resolve()
        if not path.is_relative_to((data / 'pdf').resolve()):
            raise ValueError(f'PDF escapes mirror: {doc}')
        sidecar_path = path.with_suffix('.pdf.json')
        sidecar = json.loads(sidecar_path.read_text()) if sidecar_path.exists() else {}
        if source.get('changed_at') and (source['changed_at'] != sidecar.get('catalog_changed_at') or source.get('pdf_size') != sidecar.get('manifest_pdf_size') or source.get('download_url') != sidecar.get('url')):
            raise ValueError(f'Changed PDF has not been revalidated: {doc}')
        before = path.stat()
        if before.st_size != source.get('pdf_size') and before.st_size != sidecar.get('bytes'):
            raise ValueError(f'PDF is incomplete: {doc}')
        with path.open('rb') as handle:
            if handle.read(5) != b'%PDF-':
                raise ValueError(f'Invalid PDF: {doc}')
        sha = digest(path)
        if path.stat() != before:
            raise ValueError(f'PDF changed during hashing: {doc}')
        record = {k: row[k] for k in ('doc', 'agency', 'volume', 'box', 'source', 'page_count')}
        record.update(path=str(Path(*relative.parts[1:])), bytes=before.st_size, sha256=sha)
        records.append(record)
        files[record['path']] = (path, before)
        groups[(row['agency'], row['volume'], row['box'])].append(record)
    if not records:
        raise ValueError('Refusing to publish an empty collection')
    with tempfile.TemporaryDirectory(prefix='.building-', dir=output) as tmp:
        stage = Path(tmp)
        artifacts = []
        def archive(label, items, group=None):
            manifest = encoded({'schema_version': 1, 'documents': items})
            identity = hashlib.sha256(manifest + README.encode()).hexdigest()
            name = f'{label}-{identity}.zip'
            target = output / name
            if not target.exists():
                with zipfile.ZipFile(stage / name, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as z:
                    z.writestr('README.txt', README)
                    z.writestr('manifest.json', manifest)
                    for record in items:
                        path, before = files[record['path']]
                        if path.stat() != before:
                            raise ValueError(f'PDF changed during packaging: {path}')
                        z.write(path, record['path'])
                        if path.stat() != before:
                            raise ValueError(f'PDF changed during packaging: {path}')
                os.replace(stage / name, target)
            artifact = {'name': name, 'documents': len(items), 'pages': sum(r['page_count'] or 0 for r in items), 'bytes': target.stat().st_size, 'sha256': digest(target)}
            if group is not None:
                artifact.update(zip(('agency', 'volume', 'box'), group))
            artifacts.append(artifact)
            return artifact
        full = archive('collection', records)
        boxes = [archive('box', items, group) for group, items in sorted(groups.items(), key=lambda p: str(p[0]))]
        inventory = {'schema_version': 1, 'built_at': meta['built_at'], 'snapshot_date': meta.get('snapshot_date'), 'documents': records, 'removed': removed}
        manifest_bytes = encoded(inventory)
        manifest_name = f'manifest-{hashlib.sha256(manifest_bytes).hexdigest()}.json'
        (stage / manifest_name).write_bytes(manifest_bytes)
        os.replace(stage / manifest_name, output / manifest_name)
        for path, before in files.values():
            if path.stat() != before:
                raise ValueError(f'PDF changed before publication: {path}')
        index = {'schema_version': 1, 'built_at': meta['built_at'], 'snapshot_date': meta.get('snapshot_date'), 'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'manifest': manifest_name, 'full': full, 'boxes': boxes}
        (stage / 'index.json').write_bytes(encoded(index))
        os.replace(stage / 'index.json', output / 'index.json')
    # Old files are not publicly addressable after index swap. Reclaim disk space.
    keep = {a['name'] for a in artifacts} | {manifest_name, 'index.json', '.build.lock'}
    for old in output.iterdir():
        if old.is_file() and old.name not in keep and (old.suffix == '.zip' or old.name.startswith('manifest-')):
            old.unlink()
    return index

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path('data'))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = build(args.data.resolve(), (args.output or args.data / 'downloads').resolve())
    print(json.dumps({'documents': result['full']['documents'], 'boxes': len(result['boxes']), 'bytes': result['full']['bytes'], 'built_at': result['built_at']}))
