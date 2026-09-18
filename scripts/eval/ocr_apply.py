#!/usr/bin/env python3
"""Apply staged OCR decisions with original-sidecar backups and provenance checks.
Run only while the refresh and embedding-loop locks are held by the coordinator.
Original PDFs and .pages.jsonl extractions are never modified.
"""
import argparse,hashlib,json,shutil,sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'embed'))
from page_text import effective_rows
from ocr_pages import atomic_lines,read_lines
from ocr_upgrade import DECISION_VERSION

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--staged',type=Path,required=True);p.add_argument('--backup',type=Path,required=True)
    a=p.parse_args();a.backup.mkdir(parents=True,exist_ok=True)
    grouped=defaultdict(list)
    manifest_path=a.staged/'manifest.json'
    if not manifest_path.exists():raise ValueError('Staged manifest is required')
    samples=json.loads(manifest_path.read_text())
    for sample in samples:
        f=a.staged/(sample['id']+'.json')
        if not f.exists():raise ValueError(f"Incomplete staging: {sample['id']}")
        r=json.loads(f.read_text())
        if r['sample']['id'] != sample['id']:raise ValueError('Staged sample mismatch')
        if r.get('decision_version') != DECISION_VERSION:raise ValueError('Stale decision policy')
        if r['decision']!='keep':grouped[r['sample']['text_file']].append(r)
    pending=[];already=0
    for src,results in grouped.items():
        source=Path(src);current={r['page']:r for r in effective_rows(source)}
        for r in results:
            s=r['sample'];st=Path(s['pdf']).stat();stamp=r['stamp']
            if (st.st_mtime_ns,st.st_size)!=(stamp['pdf_mtime_ns'],stamp['pdf_size']):raise ValueError(f"PDF changed: {s['id']}")
            chosen=next(c for c in r['candidates'] if c['engine']==r['selected'])
            now=current[s['page']]['text']
            if now==chosen['text']:
                already+=1;continue
            if hashlib.sha256(now.encode()).hexdigest()!=stamp['original_sha256']:raise ValueError(f"Text changed: {s['id']}")
            pending.append((source,r,chosen))
    # Validate every source before any publication; preserve each original sidecar once.
    backups={}
    for source,r,c in pending:
        doc=r['sample']['doc'];base=source.parent/doc
        for suffix in ('.ocr.jsonl','.ocr.boxes.jsonl'):
            path=Path(str(base)+suffix);dest=a.backup/'sidecars'/path.relative_to('data/text')
            if str(path) in backups:continue
            backups[str(path)]=dict(existed=path.exists(),backup=str(dest))
            if path.exists() and not dest.exists():dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest)
    manifest=a.backup/'sidecars.json'
    previous=json.loads(manifest.read_text()) if manifest.exists() else {}
    manifest.write_text(json.dumps({**backups,**previous},indent=2))
    by_doc=defaultdict(list)
    for source,r,c in pending:by_doc[source].append((r,c))
    applied=[]
    for source,records in by_doc.items():
        doc=source.name.removesuffix('.pages.jsonl');base=source.parent/doc
        text_path=Path(str(base)+'.ocr.jsonl');box_path=Path(str(base)+'.ocr.boxes.jsonl')
        texts,boxes=read_lines(text_path),read_lines(box_path)
        for r,c in records:
            s=r['sample'];page=s['page'];stamp=r['stamp']
            common=dict(page=page,accepted_for_index=True,upgrade_version=stamp['version'],pdf_mtime_ns=stamp['pdf_mtime_ns'],pdf_size=stamp['pdf_size'],original_sha256=stamp['original_sha256'],decision=r['decision'])
            texts[page]=dict(**common,bates=r['original'].get('bates'),text=c['text'],chars=len(c['text']),source=c['engine'],conf=c['conf'],dpi=300,psm=c.get('psm',1) if c['engine']=='tesseract' else None)
            # Vision's rotated rectangles may extend slightly beyond page edges.
            words=[]
            for x0,y0,x1,y1,word in c['words']:
                x0,x1=max(0,min(c['w'],x0)),max(0,min(c['w'],x1))
                y0,y1=max(0,min(c['h'],y0)),max(0,min(c['h'],y1))
                if x1>x0 and y1>y0:words.append([x0,y0,x1,y1,word])
            boxes[page]=dict(**common,w=c['w'],h=c['h'],words=words,space='px')
            applied.append(dict(doc=doc,page=page,engine=c['engine'],decision=r['decision'],old_chars=len(r['original']['text']),new_chars=len(c['text'])))
        atomic_lines(box_path,boxes);atomic_lines(text_path,texts)
    history_path=a.backup/'applied.json'
    history=json.loads(history_path.read_text()) if history_path.exists() else []
    all_applied={(r['doc'],r['page']):r for r in history+applied}
    history_path.write_text(json.dumps(list(all_applied.values()),indent=2))
    print(json.dumps(dict(applied=len(applied),already_applied=already,documents=len(by_doc))))
if __name__=='__main__':main()
