#!/usr/bin/env python3
"""Verify every applied OCR page across local embeddings/tags, Postgres and search.
Reads credentials through the existing pipeline mechanisms; never prints source text.
"""
import argparse,hashlib,json,sqlite3,sys,os
from pathlib import Path
import psycopg
import numpy as np
sys.path[:0]=[str(Path(__file__).resolve().parents[1]/'embed'),str(Path(__file__).resolve().parents[1]/'search')]
from page_text import effective_rows
from pages import chunks_of,MODEL
import opensearch

p=argparse.ArgumentParser();p.add_argument('--backup',type=Path,required=True);a=p.parse_args()
applied=json.loads((a.backup/'applied.json').read_text())
files={}
for sidecar in Path('data/text').rglob('*.ocr.jsonl'):
    doc=sidecar.name.removesuffix('.ocr.jsonl')
    source=sidecar.with_name(doc+'.pages.jsonl')
    if source.exists():files[doc]=source
selected={(r['doc'],r['page']) for r in applied};expected={}
for doc,f in files.items():
    for row in effective_rows(f):
        if row['text_source']=='ours':expected[doc,row['page']]=row
by_doc={doc for doc,page in expected}
pages=sqlite3.connect('file:data/embed/pages.sqlite?mode=ro',uri=True)
entities=sqlite3.connect('file:data/embed/entities.sqlite?mode=ro',uri=True)
failures=[];vectors={};tags={}
for key in selected - expected.keys():failures.append([*key,'applied OCR not selected'])
for key,row in expected.items():
    sha=hashlib.sha1(row['text'].encode()).hexdigest()
    state=pages.execute('select text_sha1,status from pages where doc=? and page=?',key).fetchone()
    if not state or state[0]!=sha:failures.append([*key,'embedding text hash'])
    entity=entities.execute('select text_sha1 from pages where doc=? and page=?',key).fetchone()
    if not entity or entity[0]!=sha:failures.append([*key,'tag text hash'])
    import re
    stripped=re.sub(r'\s+',' ',row['text']).strip()
    chunks=pages.execute('select vec from chunks where doc=? and page=? and model=? order by chunk',(*key,MODEL)).fetchall()
    count=len(chunks)
    if chunks:
        vector=np.mean([np.frombuffer(v,dtype=np.float32) for (v,) in chunks],axis=0)
        vectors[key]=[round(float(x),6) for x in vector / np.linalg.norm(vector)]
    fields={'contaminant':'contaminants','date':'dates','measurement':'measurement_units'}
    tags[key]={field:set() for field in fields.values()}
    for label,norm in entities.execute("select label,norm from mentions where doc=? and page=? and source='regex'",key):
        if label in fields:tags[key][fields[label]].add(norm)
    if state and count!=(len(list(chunks_of(stripped))) if state[1] in ('ok','ocr') else 0):failures.append([*key,'chunk count'])
with psycopg.connect(host=os.getenv('PGHOST','127.0.0.1'),port=int(os.getenv('PGPORT','5433')),user=os.getenv('PGUSER','sept11'),dbname=os.getenv('PGDATABASE','sept11')) as pg:
    rows=pg.execute('select doc,page,text,source from site.page_text where doc=any(%s)',(list(by_doc),)).fetchall()
    published={(d,p):(t,s) for d,p,t,s in rows}
    for key,row in expected.items():
        if published.get(key)!=(row['text'],'ours'):failures.append([*key,'Postgres text/source'])
keys=list(expected)
for start in range(0,len(keys),250):
    subset=keys[start:start+250]
    response=opensearch.call('POST',f'/{opensearch.INDEX}/_mget',{'ids':[f'{d}_p{p}' for d,p in subset]})
    if len(response['docs'])!=len(subset):failures.append(['OpenSearch batch size',start])
    for key,doc in zip(subset,response['docs']):
        source=doc.get('_source',{})
        if source.get('text')!=expected[key]['text'] or source.get('ocr_source')!='ours':failures.append([*key,'OpenSearch text/source'])
        if key in vectors:
            actual=source.get('vector',[])
            if len(actual)!=768 or not np.allclose(actual,vectors[key],rtol=0,atol=1e-6):failures.append([*key,'OpenSearch embedding vector'])
        elif source.get('vector') is not None:failures.append([*key,'unexpected OpenSearch vector'])
        for field,values in tags[key].items():
            if set(source.get(field,[]))!=values:failures.append([*key,'OpenSearch '+field])
result=dict(applied_pages=len(applied),verified_ocr_pages=len(expected),verified_embedding_vectors=len(vectors),applied_verified_pages=len(selected & expected.keys()),failures=failures)
(a.backup/'verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));raise SystemExit(bool(failures) or not selected.issubset(expected))
