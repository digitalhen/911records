#!/usr/bin/env python3
"""Score manually transcribed phrases/values, with token boundaries for numbers.
This is retrieval-oriented phrase recall, not word-error rate or corpus accuracy.
"""
import argparse,json,re
from pathlib import Path

def normalize(text):
    text=text.casefold()
    text=re.sub(r'(?<!\d)\.|\.(?!\d)',' ',text)
    return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9.]+',' ',text)).strip()

def contains(text, phrase):
    return bool(re.search(r'(?<![a-z0-9.])'+re.escape(normalize(phrase))+r'(?![a-z0-9.])',normalize(text)))

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--reference',type=Path,required=True);p.add_argument('--results',type=Path,required=True);a=p.parse_args()
    reference=json.loads(a.reference.read_text());scores=[]
    for engine in ('existing','viewer-psm6','300-psm6','300-psm3','300-psm1-osd','300-best-psm1','vision'):
        rows=[]
        for doc,phrases in reference.items():
            text=(a.results/doc/(engine+'.txt')).read_text()
            found=[phrase for phrase in phrases if contains(text,phrase)]
            rows.append(dict(id=doc,found=len(found),total=len(phrases),missing=[phrase for phrase in phrases if phrase not in found]))
        scores.append(dict(engine=engine,found=sum(r['found'] for r in rows),total=sum(r['total'] for r in rows),pages=rows))
    (a.results/'phrase-scores.json').write_text(json.dumps(scores,indent=2))
    print(json.dumps(scores,indent=2))
if __name__=='__main__':main()
