#!/usr/bin/env python3
"""Consistent, one-time snapshots before an OCR reprocess (scheduler locks required)."""
import argparse,json,shutil,sqlite3
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);a=p.parse_args()
paths=list(Path('data/embed').glob('*.sqlite'))+[Path('data/site/site.sqlite')]
paths += list(Path('data/embed').glob('*.json'))+list(Path('data/embed').glob('*.jsonl'))
count=0
for src in paths:
    if not src.exists():continue
    dest=a.out/'derived'/src.relative_to('data')
    if dest.exists():continue
    dest.parent.mkdir(parents=True,exist_ok=True);tmp=dest.with_suffix(dest.suffix+'.tmp')
    if src.suffix=='.sqlite':
        source=sqlite3.connect(f'file:{src}?mode=ro',uri=True);target=sqlite3.connect(tmp)
        source.backup(target);target.close();source.close()
    else:shutil.copy2(src,tmp)
    tmp.replace(dest);count+=1
print(json.dumps({'backups_created':count,'directory':str(a.out)}))
