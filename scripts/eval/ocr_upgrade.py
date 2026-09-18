#!/usr/bin/env python3
"""Stage 300-DPI Vision/Tesseract alternatives without modifying production text.
A conservative dictionary screen proposes replacements; decisions and all alternatives
are retained for review. Confidence and this screen are not accuracy estimates.
"""
import argparse,csv,hashlib,io,json,os,subprocess,tempfile,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'embed'))
from page_text import effective_rows
from ocr_quality import quality,numbers,recognized_words
from ocr_benchmark import run

VERSION='300dpi-vision-tesseract-2'
DECISION_VERSION=5

def choose(original,candidates):
    old=quality(original)
    eligible=[]
    for c in candidates:
        q=quality(c['text']);c['quality']=q
        # Require readable language and a material gain. Preserve decimals in a
        # previously readable text layer; this protects scientific measurements.
        if q['tokens']<15 or q['ratio']<.65 or q['unique']<10:continue
        # An independent engine must corroborate substantive words. This avoids
        # promoting a single engine's plausible-looking guesses from image texture.
        vocabulary=recognized_words(c['text'])
        if not any(other is not c and len(vocabulary & recognized_words(other['text'])) >= 10
                   for other in candidates):continue
        gain=q['good']>=max(old['good']+8,old['good']*1.20)
        cleaner=q['good']>=old['good']*.90 and q['ratio']>=old['ratio']+.20
        if not (gain or cleaner):continue
        a,b=numbers(original),numbers(c['text'])
        if (old['ratio']>=.65 and old['good']>=15) or sum(a.values())>=5:
            retained=sum((a & b).values())/max(1,sum(a.values()))
            if a and retained<1.0:continue
        eligible.append(c)
    if not eligible:return None
    return max(eligible,key=lambda c:c['quality']['good']*c['quality']['ratio'])

def decide(result):
    original=result['original'];candidates=result['candidates'];sample=result['sample']
    winner=choose(original['text'],candidates)
    decision='replace' if winner else 'keep'
    if (not winner and original['text_source']=='ours' and quality(original['text'])['good']<15
            and all(quality(c['text'])['tokens']<8 for c in candidates)):
        # Sparse handwriting can also trigger this disagreement. Keep it unless
        # a reviewer has checked the scan; word-count loss alone is not proof of noise.
        result={**result,'review_reason':'sparse-disagreement'}
    if sample.get('reviewed_engine'):
        winner=next(c for c in candidates if c['engine']==sample['reviewed_engine']);decision='reviewed-replace'
    return {**result,'decision':decision,'selected':winner['engine'] if winner else None,'decision_version':DECISION_VERSION}

def tess(image, psm=1):
    raw,seconds=run(['tesseract',image,'stdout','-l','eng','--psm',psm,'-c','tessedit_create_tsv=1'])
    rows=list(csv.DictReader(io.StringIO(raw),delimiter='\t',quoting=csv.QUOTE_NONE));dims=next(r for r in rows if r['level']=='1')
    lines={};words=[];conf=[]
    for r in rows:
        if r['level']!='5' or not (r.get('text') or '').strip():continue
        x,y,w,h=[int(r[k]) for k in ('left','top','width','height')]
        words.append([x,y,x+w,y+h,r['text']]);conf.append(float(r['conf']))
        lines.setdefault(tuple(r[k] for k in ('block_num','par_num','line_num')),[]).append(r['text'])
    return dict(engine='tesseract',psm=psm,text='\n'.join(' '.join(v) for v in lines.values()),words=words,w=int(dims['width']),h=int(dims['height']),conf=sum(conf)/len(conf) if conf else 0,seconds=seconds)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--vision',type=Path,required=True);p.add_argument('--jobs',type=int,default=3);p.add_argument('--limit',type=int,default=0);p.add_argument('--tesseract-psm',type=int,choices=[1,3],default=1);p.add_argument('--vision-only',action='store_true',help='reviewed retries only, when Tesseract times out')
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    samples=json.loads(a.manifest.read_text());samples=samples[:a.limit] if a.limit else samples
    (a.output/'manifest.json').write_text(json.dumps(samples,indent=2))
    originals={}
    for f in {s['text_file'] for s in samples}:
        originals[f]={int(r['page']):r for r in effective_rows(Path(f))}
    def process(s):
        dest=a.output/(s['id']+'.json');original=originals[s['text_file']][s['page']]
        pdf=Path(s['pdf']);st=pdf.stat();sha=hashlib.sha256(original['text'].encode()).hexdigest()
        stamp=dict(version=VERSION,pdf_mtime_ns=st.st_mtime_ns,pdf_size=st.st_size,original_sha256=sha)
        if a.vision_only:stamp['vision_only']=True
        if a.tesseract_psm != 1:stamp['tesseract_psm']=a.tesseract_psm
        if dest.exists():
            prev=json.loads(dest.read_text())
            if prev.get('stamp')==stamp:
                prev=decide(prev);dest.write_text(json.dumps(prev));return prev
        with tempfile.TemporaryDirectory(prefix='ocr-',dir=a.output) as td:
            im=Path(td)/'page.tif'
            _,render=run(['pdftoppm','-f',s['page'],'-l',s['page'],'-singlefile','-r','300','-tiff',pdf,im.with_suffix('')])
            raw,seconds=run([a.vision,im,'--boxes']);v=json.loads(raw)
            vision=dict(engine='apple-vision',text='\n'.join(r['text'] for r in v['rows']),words=v['words'],w=v['w'],h=v['h'],conf=100*sum(r['confidence'] for r in v['rows'])/max(1,len(v['rows'])),seconds=seconds,revision=v['revision'])
            candidates=[vision] if a.vision_only else [vision,tess(im,a.tesseract_psm)]
            result=decide(dict(sample=s,stamp=stamp,original=original,original_quality=quality(original['text']),candidates=candidates,render_seconds=render))
            if pdf.stat().st_mtime_ns!=st.st_mtime_ns:raise RuntimeError('PDF changed during OCR')
            tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(result));tmp.replace(dest)
            return result
    def safe_process(sample):
        try:
            return process(sample)
        except Exception as exc:
            detail = exc.stderr if isinstance(exc, subprocess.CalledProcessError) else str(exc)
            error = dict(sample=sample, decision='error', error=type(exc).__name__, detail=detail)
            (a.output/('error-' + sample['id'] + '.json')).write_text(json.dumps(error))
            return error
    stats={};start=time.time()
    with ThreadPoolExecutor(max_workers=a.jobs) as pool:
        for i,r in enumerate(pool.map(safe_process,samples),1):
            stats[r['decision']]=stats.get(r['decision'],0)+1
            if i%25==0 or i==len(samples):print(json.dumps(dict(done=i,total=len(samples),seconds=round(time.time()-start),decisions=stats)),flush=True)
    (a.output/'summary.json').write_text(json.dumps(stats,indent=2))
    if stats.get('error'): raise SystemExit(1)
if __name__=='__main__':main()
