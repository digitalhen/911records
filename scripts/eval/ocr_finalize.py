#!/usr/bin/env python3
"""Re-evaluate cached alternatives under the current acceptance policy; no OCR work."""
import argparse,json
from collections import Counter
from pathlib import Path
from ocr_upgrade import decide,DECISION_VERSION
p=argparse.ArgumentParser();p.add_argument('--staged',type=Path,required=True);a=p.parse_args()
samples=json.loads((a.staged/'manifest.json').read_text());stats=Counter();engines=Counter()
for sample in samples:
    path=a.staged/(sample['id']+'.json')
    if not path.exists():raise ValueError(f"Missing OCR: {sample['id']}")
    r=json.loads(path.read_text())
    r['sample']=sample
    r=decide(r)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(r));tmp.replace(path)
    stats[r['decision']]+=1
    if r['selected']:engines[r['selected']]+=1
out=dict(expected=len(samples),completed=sum(stats.values()),decisions=dict(stats),selected_engines=dict(engines),decision_version=DECISION_VERSION)
(a.staged/'summary.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
