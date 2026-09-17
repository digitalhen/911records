import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('downloads_build', Path(__file__).with_name('build.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class DownloadsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        (self.data / 'site').mkdir()
        self.db = sqlite3.connect(self.data / 'site/site.sqlite')
        self.addCleanup(self.db.close)
        self.db.executescript('''CREATE TABLE meta(key TEXT,value TEXT);
          INSERT INTO meta VALUES ('built_at','first'),('snapshot_date','2026-09-17');
          CREATE TABLE documents(doc TEXT,agency TEXT,volume TEXT,box TEXT,source TEXT,page_count INT,status TEXT,removed_at TEXT);
        ''')
        self.mirror = []
        for doc, volume, box, status in [('A','V1','Box 1','present'),('B','V2','Box 1','present'),('C','V1',None,'present'),('D','V1','Box 1','removed')]:
            self.db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)', (doc,'Agency',volume,box,'Collection',1,status,'2026-09-17' if status == 'removed' else None))
            local = f'pdf/AG/{volume}/{doc}.pdf'
            path = self.data / local
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'%PDF-1.7\nfixture\n%%EOF')
            self.mirror.append({'bates_start':doc, 'status':status, 'local_pdf':f'data/{local}', 'pdf_size':path.stat().st_size})
        self.db.commit()
        self.save_manifest()
        self.output = self.data / 'downloads'

    def save_manifest(self):
        (self.data / 'manifest.jsonl').write_text('\n'.join(json.dumps(r) for r in self.mirror))

    def test_boxes_manifest_removals_and_replacements(self):
        first = builder.build(self.data, self.output)
        self.assertEqual(first['full']['documents'], 3)
        self.assertEqual(len(first['boxes']), 3)  # same label, different volumes; unlabelled records
        with zipfile.ZipFile(self.output / first['full']['name']) as z:
            self.assertIsNone(z.testzip())
            self.assertNotIn('pdf/AG/V1/D.pdf', z.namelist())
            inventory = json.loads(z.read('manifest.json'))
            self.assertEqual(len(inventory['documents']), 3)
        manifest = json.loads((self.output / first['manifest']).read_text())
        self.assertEqual(manifest['removed'][0]['doc'], 'D')
        original = self.output / first['full']['name']
        modified_time = original.stat().st_mtime_ns
        same = builder.build(self.data, self.output)
        self.assertEqual(same['full']['name'], first['full']['name'])
        self.assertEqual(original.stat().st_mtime_ns, modified_time)
        self.db.execute("UPDATE documents SET status='removed',removed_at='2026-09-18' WHERE doc='A'")
        self.db.execute("UPDATE meta SET value='second' WHERE key='built_at'")
        self.db.commit()
        self.mirror[0]['status'] = 'removed'
        self.save_manifest()
        next_index = builder.build(self.data, self.output)
        self.assertEqual(next_index['full']['documents'], 2)
        self.assertFalse(original.exists())
        self.assertEqual(next_index['built_at'], 'second')
        # Same-size replacement must change the archive identity.
        path = self.data / 'pdf/AG/V2/B.pdf'
        path.write_bytes(path.read_bytes().replace(b'fixture', b'changed'))
        changed = builder.build(self.data, self.output)
        self.assertNotEqual(changed['full']['name'], next_index['full']['name'])

    def test_failure_preserves_published_index(self):
        builder.build(self.data, self.output)
        before = (self.output / 'index.json').read_bytes()
        (self.data / 'pdf/AG/V2/B.pdf').unlink()
        with self.assertRaises(FileNotFoundError):
            builder.build(self.data, self.output)
        self.assertEqual((self.output / 'index.json').read_bytes(), before)

    def test_unvalidated_change_is_not_published(self):
        self.mirror[0]['changed_at'] = '2026-09-17'
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'not been revalidated'):
            builder.build(self.data, self.output)
        self.assertFalse((self.output / 'index.json').exists())

    def test_partial_pdf_and_path_escape_rejected(self):
        (self.data / 'pdf/AG/V1/A.pdf').write_bytes(b'%PDF-short')
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            builder.build(self.data, self.output)
        self.mirror[0]['local_pdf'] = 'data/pdf/../../secret.pdf'
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            builder.build(self.data, self.output)

if __name__ == '__main__':
    unittest.main()
