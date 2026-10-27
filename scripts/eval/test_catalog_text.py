"""Regression: moved records must never publish archived text or duplicate pages."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'embed'))
from page_text import catalog_text_files
import load_site_pg


class CatalogTextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.text = self.repo / 'data/text'
        self.old = self.write('old', 'DOC', 'obsolete')
        self.current = self.write('current', 'DOC', 'current')
        self.manifest = self.repo / 'data/manifest.jsonl'
        self.row = dict(bates_start='DOC', local_text='data/text/current/DOC.txt', status='present')
        self.catalog([self.row])

    def write(self, volume, doc, text):
        p = self.text / volume / (doc + '.pages.jsonl')
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(dict(page=1, text=text)) + '\n')
        return p

    def catalog(self, rows):
        self.manifest.write_text(''.join(json.dumps(r) + '\n' for r in rows))

    def test_loader_uses_current_copy_once(self):
        with patch.object(load_site_pg, 'TEXT_DIR', self.text):
            self.assertEqual(list(load_site_pg.page_text_rows({})), [('DOC', 1, 'current', 'pdftotext')])
        self.assertTrue(self.old.exists())

    def test_missing_current_copy_does_not_resurrect_old_text(self):
        self.current.unlink()
        self.assertEqual(catalog_text_files(self.text), [])

    def test_removed_record_preserved_but_uncatalogued_file_excluded(self):
        self.write('other', 'STRAY', 'not catalogued')
        self.catalog([{**self.row, 'status': 'removed'}])
        self.assertEqual(catalog_text_files(self.text), [self.current])

    def test_ambiguous_catalog_or_unmanaged_copies_fail(self):
        self.catalog([self.row, self.row])
        with self.assertRaises(ValueError):
            catalog_text_files(self.text)
        self.manifest.unlink()
        with self.assertRaises(ValueError):
            catalog_text_files(self.text)
        self.old.unlink()
        self.assertEqual(catalog_text_files(self.text), [self.current])


if __name__ == '__main__':
    unittest.main()
