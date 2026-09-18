"""Queue coverage, source invalidation, retry and exclusion checks for automatic OCR."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'embed'))
import ocr_auto as auto


class AutomaticOCRTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        self.pdf = self.data / 'pdf/agency/DOC.pdf'
        self.pdf.parent.mkdir(parents=True)
        self.pdf.write_bytes(b'PDF revision one')
        self.source = self.data / 'text/agency/DOC.pages.jsonl'
        self.source.parent.mkdir(parents=True)
        self.source.write_text(json.dumps(dict(page=1, text='The laboratory report contains readable English text. ' * 30)) + '\n')
        self.con = auto.connect(self.data / 'state.sqlite')
        self.addCleanup(self.con.close)

    def queue(self, **kwargs):
        return auto.candidates(self.data, self.con, **kwargs)

    def test_readable_pages_reviewed_without_embedding_database(self):
        queue, counts = self.queue()
        self.assertEqual(len(queue), 1)
        self.assertEqual(counts['pages_seen'], 1)
        self.assertEqual(self.queue(active_docs=set())[0], [])

    def test_review_reused_until_pdf_or_selected_text_changes(self):
        sample, fp, _ = self.queue()[0][0]
        auto.remember(self.con, sample['id'], fp, 'done', 'result.json')
        self.assertEqual(self.queue()[1]['cached'], 1)
        self.pdf.write_bytes(b'PDF revision two, replaced source')
        self.assertEqual(len(self.queue()[0]), 1)
        sample, fp, _ = self.queue()[0][0]
        auto.remember(self.con, sample['id'], fp, 'done', 'result.json')
        self.source.write_text(json.dumps(dict(page=1, text='changed extraction')) + '\n')
        self.assertEqual(len(self.queue()[0]), 1)

    def test_approved_text_preserved_only_for_same_pdf(self):
        stamp = self.pdf.stat()
        self.source.with_name('DOC.ocr.jsonl').write_text(json.dumps(dict(page=1,text='approved',accepted_for_index=True,pdf_mtime_ns=stamp.st_mtime_ns,pdf_size=stamp.st_size)) + '\n')
        self.assertEqual(self.queue()[1]['approved'], 1)
        self.pdf.write_bytes(b'new PDF')
        self.assertEqual(len(self.queue()[0]), 1)

    def test_failed_pages_retry_and_new_revision_bypasses_backoff(self):
        sample, fp, _ = self.queue()[0][0]
        auto.remember(self.con, sample['id'], fp, 'error', 'result.json', 1, 100)
        self.assertEqual(self.queue(now=99)[1]['deferred'], 1)
        self.assertEqual(len(self.queue(now=101)[0]), 1)
        self.pdf.write_bytes(b'replacement')
        self.assertEqual(len(self.queue(now=99)[0]), 1)

    def test_stale_text_result_cannot_mask_engine_failure(self):
        wave, _ = self.queue()
        sample, fp, _ = wave[0]
        stale = self.data / 'stale.json'
        st = self.pdf.stat()
        stale.write_text(json.dumps(dict(sample=sample,decision_version=auto.DECISION_VERSION,stamp=dict(version=auto.VERSION,pdf_mtime_ns=st.st_mtime_ns,pdf_size=st.st_size,original_sha256=hashlib.sha256(b'other text').hexdigest()))))
        auto.remember(self.con, sample['id'], fp, 'pending', stale)
        wave, _ = self.queue()
        with patch.object(auto.subprocess, 'run') as run:
            run.return_value.returncode = 1
            errors = auto.process_wave(wave, self.data/'wave', self.data/'backup', self.con, Path('vision'))
        self.assertEqual(errors, 1)
        self.assertEqual(run.call_count, 1)  # no apply after a stale result
        self.assertEqual(self.queue()[1]['deferred'], 1)

    def test_running_owner_excludes_other_ingestors(self):
        lock = self.data / 'lock'
        with auto.pipeline_lock(lock):
            with auto.pipeline_lock(lock, os.getpid()):
                self.assertTrue(lock.exists())
            with self.assertRaises(RuntimeError):
                with auto.pipeline_lock(lock):
                    pass
        self.assertFalse(lock.exists())


if __name__ == '__main__':
    unittest.main()
