import importlib.util,json,sqlite3,sys,tempfile,unittest,os,hashlib
from pathlib import Path
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'embed'))
from page_text import effective_rows,select_text
import pages,doctypes,summaries,facts,load_site_pg

class OCRPipelineTests(unittest.TestCase):
    def test_summary_ids_preserve_document_and_retry_mapping(self):
        exact=[{'id':i,'title':f'document {i}'} for i in range(1,21)]
        self.assertEqual(summaries.align_ids(exact,list(range(1,21))),exact)
        zero=[{'id':i,'title':f'document {i+1}'} for i in range(20)]
        self.assertEqual(summaries.align_ids(zero,list(range(1,21))),exact)
        retries=[{'id':7,'title':'seventh'}, {'id':19,'title':'nineteenth'}]
        self.assertEqual(summaries.align_ids(retries,[7,19]),retries)
        self.assertEqual(summaries.align_ids([{'id':0,'title':'seventh'},{'id':1,'title':'nineteenth'}],[7,19]),retries)
        self.assertEqual(summaries.align_ids([exact[6]],[7]),[exact[6]])
        self.assertIsNone(summaries.align_ids([{'id':99,'title':'unknown'}],[7]))
        self.assertIsNone(summaries.align_ids([{'id':1},{'id':1}],[1,2]))
        items=[dict(id=i,doc_type='report',folder='',box='',agency='',page_count=1,excerpt='sample') for i in range(1,21)]
        with patch.object(summaries,'BACKEND','ollama'),patch.object(summaries,'call_ollama',return_value=json.dumps(exact)):
            actual,_=summaries.call_model(None,items,summaries.Budget(1),summaries.StopSignal())
        self.assertEqual(actual,exact)

    def test_fact_dates_do_not_invent_missing_days(self):
        self.assertEqual(facts.complete_date('2001-10-31'),'2001-10-31')
        self.assertEqual(facts.complete_date('2000-02-29'),'2000-02-29')
        for value in (None,'2001','2001-10','2001-02-29','2001-13-01','20011031','unknown',2001):
            self.assertIsNone(facts.complete_date(value))

    def test_legacy_and_explicit_decisions(self):
        raw={'page':1,'text':'original '*30}
        self.assertEqual(select_text(raw,{1:{'text':'legacy '*30}})[0],raw['text'])
        self.assertEqual(select_text({'page':1,'text':''},{1:{'text':'legacy '*30}})[1],'ours')
        self.assertEqual(select_text(raw,{1:{'text':'new','accepted_for_index':True}}),('new','ours'))
        self.assertEqual(select_text(raw,{1:{'text':'','accepted_for_index':True}}),('','ours'))
        self.assertEqual(select_text({'page':1,'text':''},{1:{'text':'rejected '*30,'accepted_for_index':False}}),('','pdftotext'))

    def test_consumers_use_identical_approved_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);f=folder/'DOC.pages.jsonl';replacement='Asbestos report at 75 Maiden Lane, dated 09/08/2002. Result 0.0049.'
            f.write_text(json.dumps(dict(page=1,bates='B1',text='garbled old '*30))+'\n')
            (folder/'DOC.ocr.jsonl').write_text(json.dumps(dict(page=1,text=replacement,accepted_for_index=True))+'\n')
            self.assertEqual(list(effective_rows(f))[0]['text'],replacement)
            self.assertEqual(doctypes.doc_text(f,{('DOC',1):'ocr'})[0],replacement)
            self.assertEqual(summaries.page_text('DOC',1,{('DOC',1):'ocr'},{'DOC':f}),replacement)
            self.assertEqual(facts.doc_pages(f,{('DOC',1):'ocr'})[0][2],replacement)
            with patch.object(load_site_pg,'TEXT_DIR',folder):
                self.assertEqual(list(load_site_pg.page_text_rows({('DOC',1):'ocr'})),[('DOC',1,replacement,'ours')])

    def test_long_page_commits_all_chunks_together(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);f=folder/'DOC.pages.jsonl';text='asbestos laboratory report '*400
            f.write_text(json.dumps(dict(page=1,bates='B1',text=text))+'\n')
            calls=[]
            def fake_embed(texts):calls.append(len(texts));return np.ones((len(texts),768),dtype=np.float32)
            with patch.object(pages,'DB',folder/'pages.sqlite'),patch.object(pages,'TEXT',folder),patch.object(pages,'embed',fake_embed),patch.object(sys,'argv',['pages.py','--batch','2']):
                pages.main()
            con=sqlite3.connect(folder/'pages.sqlite')
            expected=len(list(pages.chunks_of(text.strip())))
            self.assertEqual(con.execute('select count(*) from chunks').fetchone()[0],expected)
            self.assertEqual(calls,[expected])
            con.execute('delete from chunks where chunk=0');con.commit();con.close()
            with patch.object(pages,'DB',folder/'pages.sqlite'),patch.object(pages,'TEXT',folder),patch.object(pages,'embed',fake_embed),patch.object(sys,'argv',['pages.py','--batch','2']):
                pages.main()
                pages.main()
            con=sqlite3.connect(folder/'pages.sqlite')
            self.assertEqual(con.execute('select count(*) from chunks').fetchone()[0],expected)
            self.assertEqual(calls,[expected,expected])

    def test_superseded_pdf_invalidates_approved_ocr(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);text=root/'text'/'agency';pdf=root/'pdf'/'agency'
            text.mkdir(parents=True);pdf.mkdir(parents=True)
            original=pdf/'DOC.pdf';original.write_bytes(b'first PDF revision')
            stamp=original.stat();f=text/'DOC.pages.jsonl'
            f.write_text(json.dumps(dict(page=1,text='current original text'))+'\n')
            (text/'DOC.ocr.jsonl').write_text(json.dumps(dict(page=1,text='approved OCR',accepted_for_index=True,pdf_mtime_ns=stamp.st_mtime_ns,pdf_size=stamp.st_size))+'\n')
            self.assertEqual(list(effective_rows(f))[0]['text'],'approved OCR')
            original.write_bytes(b'replacement PDF revision with different length')
            self.assertEqual(list(effective_rows(f))[0]['text'],'current original text')

    def test_candidate_cannot_drop_readings(self):
        from ocr_upgrade import choose
        old='sample laboratory report reading result ' + ' '.join(f'{i}.1234' for i in range(10))
        candidate={'text':'The environmental laboratory report contains results from the analysis of samples collected from the building during the investigation of air quality and asbestos contamination.'}
        self.assertIsNone(choose(old,[candidate,dict(candidate)]))

    def test_embedding_failure_does_not_publish_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);f=folder/'DOC.pages.jsonl'
            f.write_text(json.dumps(dict(page=1,bates='B1',text='asbestos report '*100))+'\n')
            with patch.object(pages,'DB',folder/'pages.sqlite'),patch.object(pages,'TEXT',folder),patch.object(pages,'embed',side_effect=RuntimeError('offline')),patch.object(sys,'argv',['pages.py']):
                with self.assertRaises(RuntimeError):pages.main()
            con=sqlite3.connect(folder/'pages.sqlite')
            self.assertEqual(con.execute('select count(*) from pages').fetchone()[0],0)
            self.assertEqual(con.execute('select count(*) from chunks').fetchone()[0],0)

    def test_apply_is_backed_up_idempotent_and_clips_boxes(self):
        import ocr_apply
        with tempfile.TemporaryDirectory() as tmp:
            original_cwd=Path.cwd()
            try:
                os.chdir(tmp)
                pdf=Path('data/pdf/agency/DOC.pdf');pdf.parent.mkdir(parents=True);pdf.write_bytes(b'fixture PDF')
                source=Path('data/text/agency/DOC.pages.jsonl');source.parent.mkdir(parents=True)
                original={'page':1,'bates':'B1','text':'original extraction '*10}
                source.write_text(json.dumps(original)+'\n');stat=pdf.stat()
                staged=Path('staged');staged.mkdir();sample=dict(id='DOC-p1',doc='DOC',page=1,pdf=str(pdf),text_file=str(source))
                candidate=dict(engine='apple-vision',text='improved text',w=100,h=200,words=[[-2,10,90,210,'improved']],conf=95)
                r=dict(sample=sample,original=original,decision='reviewed-replace',decision_version=ocr_apply.DECISION_VERSION,selected='apple-vision',candidates=[candidate],stamp=dict(version='test',pdf_mtime_ns=stat.st_mtime_ns,pdf_size=stat.st_size,original_sha256=hashlib.sha256(original['text'].encode()).hexdigest()))
                (staged/'manifest.json').write_text(json.dumps([sample]));(staged/'DOC-p1.json').write_text(json.dumps(r))
                with patch.object(sys,'argv',['ocr_apply.py','--staged','staged','--backup','backup']):
                    ocr_apply.main();ocr_apply.main()
                self.assertEqual(json.loads(source.read_text()),original)
                self.assertEqual(list(effective_rows(source))[0]['text'],'improved text')
                boxes=json.loads(source.with_name('DOC.ocr.boxes.jsonl').read_text())
                self.assertEqual(boxes['words'],[[0,10,90,200,'improved']])
                self.assertEqual(len(json.loads(Path('backup/applied.json').read_text())),1)
                self.assertFalse(json.loads(Path('backup/sidecars.json').read_text())[str(source.with_name('DOC.ocr.jsonl'))]['existed'])
            finally:os.chdir(original_cwd)

    def test_phrase_scoring_rejects_wrong_numeric_prefix(self):
        from ocr_score import contains
        self.assertFalse(contains('Result 196.0','96.0'))
        self.assertFalse(contains('Sample AD224710','AD22471'))
        self.assertTrue(contains('Result: 96.0','96.0'))
        self.assertTrue(contains('Westchester Dept, of Labs & Research','Westchester Dept. of Labs & Research'))

    def test_single_engine_guess_requires_corroboration(self):
        from ocr_upgrade import choose
        readable={'text':'The environmental laboratory report contains results from the analysis of samples collected from the building during the investigation of air quality and asbestos contamination.'}
        sparse={'text':'NYC 9/11 Public Portal Document'}
        self.assertIsNone(choose('',[readable,sparse]))
        corroborated={'text':readable['text']}
        self.assertIsNotNone(choose('',[readable,corroborated]))

if __name__=='__main__':unittest.main()
