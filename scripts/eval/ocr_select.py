#!/usr/bin/env python3
"""Select suspect pages for a read-only comparison. Run from the repository root."""
import argparse,json,random,sqlite3,sys
from collections import Counter
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'embed'))
from page_text import effective_rows
from ocr_quality import quality

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--seed',type=int,default=918)
    p.add_argument('--reviewed',type=Path,help='optional JSON mapping page id to visually reviewed engine')
    a=p.parse_args()
    reviewed=json.loads(a.reviewed.read_text()) if a.reviewed else {}
    con=sqlite3.connect('file:data/embed/pages.sqlite?mode=ro',uri=True)
    status={(d,p):s for d,p,s in con.execute('select doc,page,status from pages')};con.close()
    rows=[];counts=Counter()
    for f in sorted(Path('data/text').rglob('*.pages.jsonl')):
        doc=f.name.removesuffix('.pages.jsonl');rel=f.relative_to('data/text')
        pdf=Path('data/pdf')/rel.parent/(doc+'.pdf')
        if not pdf.exists():continue
        for row in effective_rows(f):
            page=int(row['page']);st=status.get((doc,page),'empty');q=quality(row['text'])
            poor=(q['tokens']>=10 and q['ratio']<.50) or (q['chars']>200 and q['tokens']<10)
            reason=st if st in ('empty','ocr','junk') else 'poor-text-layer' if poor else None
            if not reason:continue
            image=Path('data/pages')/rel.parent/doc/f'{page}.webp'
            if not image.exists():continue
            counts[reason]+=1
            sample=dict(id=f'{doc}-p{page}',doc=doc,page=page,status=st,reason=reason,pdf=str(pdf),image=str(image),text_file=str(f),quality=q)
            if sample['id'] in reviewed:sample['reviewed_engine']=reviewed[sample['id']]
            rows.append(sample)
    random.Random(a.seed).shuffle(rows);rows.sort(key=lambda r:not bool(r.get('reviewed_engine')))
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(rows,indent=2))
    print(json.dumps(dict(total=len(rows),reasons=dict(counts))))
if __name__=='__main__':main()
