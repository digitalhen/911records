#!/usr/bin/env python3
"""Read-only OCR comparison. Run from repo root; writes only --output.
Manifest entries: id, pdf, image, page, status. No corpus sidecars are changed.
"""
import argparse,csv,hashlib,io,json,os,platform,subprocess,time
from pathlib import Path

def run(cmd):
    start=time.perf_counter()
    p=subprocess.run(list(map(str,cmd)),capture_output=True,text=True,check=True,timeout=180,
                     env={**os.environ,'OMP_THREAD_LIMIT':'1'})
    return p.stdout,time.perf_counter()-start

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--manifest',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--best-data',type=Path)
    ap.add_argument('--vision',type=Path)
    ap.add_argument('--engines', help='comma-separated engine names; omitted runs all')
    args=ap.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    rows=[]
    versions={'tesseract':run(['tesseract','--version'])[0], 'platform':platform.platform(),
              'manifest_sha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest()}
    if args.best_data:
        versions['best_sha256']=hashlib.sha256((args.best_data/'eng.traineddata').read_bytes()).hexdigest()
    (args.output/'environment.json').write_text(json.dumps(versions,indent=2))
    for sample in json.loads(args.manifest.read_text()):
        folder=args.output/sample['id']; folder.mkdir(exist_ok=True)
        image=folder/'300.png'
        _,render_seconds=run(['pdftoppm','-f',sample['page'],'-l',sample['page'],'-singlefile','-r','300','-png',sample['pdf'],folder/'300'])
        configs=[('viewer-psm6',sample['image'],6,False),('300-psm6',image,6,False),
                 ('300-psm3',image,3,False),('300-psm1-osd',image,1,False)]
        if args.best_data: configs.append(('300-best-psm1',image,1,True))
        for name,img,psm,best in configs:
            if args.engines and name not in args.engines.split(','): continue
            try:
                extra=['--tessdata-dir', args.best_data] if best else []
                raw,seconds=run(['tesseract',img,'stdout','-l','eng',*extra,'--psm',psm,'-c','tessedit_create_tsv=1'])
                (folder/f'{name}.tsv').write_text(raw)
                words=[r for r in csv.DictReader(io.StringIO(raw),delimiter='\t',quoting=csv.QUOTE_NONE) if r['level']=='5' and r.get('text','').strip()]
                lines={}
                for w in words: lines.setdefault(tuple(w[k] for k in ('block_num','par_num','line_num')),[]).append(w['text'])
                text='\n'.join(' '.join(line) for line in lines.values())
                (folder/f'{name}.txt').write_text(text)
                rows.append(dict(id=sample['id'],status=sample['status'],engine=name,seconds=seconds,render_seconds=0 if name.startswith('viewer') else render_seconds,words=len(words),confidence=sum(float(w['conf']) for w in words)/len(words) if words else None))
            except subprocess.CalledProcessError as e: rows.append(dict(id=sample['id'],engine=name,error=e.stderr[-1500:]))
        if args.vision and (not args.engines or 'vision' in args.engines.split(',')):
            raw,seconds=run([args.vision,image]); observations=json.loads(raw)
            (folder/'vision.json').write_text(raw)
            (folder/'vision.txt').write_text('\n'.join(r['text'] for r in observations))
            rows.append(dict(id=sample['id'],status=sample['status'],engine='vision',seconds=seconds,render_seconds=render_seconds,words=sum(len(r['text'].split()) for r in observations)))
        text,seconds=run(['pdftotext','-f',sample['page'],'-l',sample['page'],'-layout',sample['pdf'],'-'])
        (folder/'existing.txt').write_text(text)
        rows.append(dict(id=sample['id'],status=sample['status'],engine='existing',seconds=seconds,words=len(text.split())))
        (args.output/'results.json').write_text(json.dumps(rows,indent=2))
        print(sample['id'], 'complete',flush=True)
if __name__=='__main__': main()
