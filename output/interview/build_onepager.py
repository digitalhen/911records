"""Generate the interview handout as vector PDF and editable SVG.
Run: python3 output/interview/build_onepager.py (requires reportlab).
Coordinates use a top-left origin, in points; text remains editable in the SVG.
Evidence: scripts/refresh_daily.sh; scripts/embed/{ocr_auto,page_text,pages,
entities,canonical,doctypes,topics,summaries,facts}.py;
scripts/search/opensearch.py; web/lib/ask/{router,plan,retrieve,answer}.ts.
Production topics use sklearn KMeans + AgglomerativeClustering. GLiNER is an
optional extraction mode, not claimed as part of the nightly pipeline here.
The 231,104 figure is catalog pages; 64,385 is currently available PDFs.
"""
from pathlib import Path
from html import escape
import math
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output'
W,H = 792,612
for name,file in [('Arial','Arial.ttf'),('Arial-Bold','Arial Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name, '/System/Library/Fonts/Supplemental/'+file))
c = canvas.Canvas(str(OUT/'pdf/911records-interview-onepager.pdf'),pagesize=(W,H))
c.setTitle('911records.org - Applied ML, NLP and LLM systems')
c.setAuthor('Henry Williams')
c.setSubject('Interview architecture overview: OCR, semantic search and cited answers')
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="11in" height="8.5in" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc">',
'<title id="title">911records.org: From scanned records to cited answers</title>',
'<desc id="desc">Flowchart of ingestion, OCR, NLP, embeddings, LLM enrichment, publication, hybrid search and cited answers.</desc>']
INK='#172B37'; MUTED='#526773'; LINE='#B9C7CD'; BG='#F5F8F8'; TEAL='#126F70'; BLUE='#235C9D'; PURPLE='#7451A0'
def color(x):
    return tuple(int(x[i:i+2],16)/255 for i in (1,3,5))
def rect(x,y,w,h,fill,stroke=None,r=0):
    c.setFillColorRGB(*color(fill));c.setStrokeColorRGB(*color(stroke or fill));c.setLineWidth(.7)
    c.roundRect(x,H-y-h,w,h,r,fill=1,stroke=bool(stroke))
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke or "none"}" stroke-width=".7"/>')
def text(x,y,s,size=10,fill=INK,bold=False):
    font='Arial-Bold' if bold else 'Arial';c.setFont(font,size);c.setFillColorRGB(*color(fill));c.drawString(x,H-y,s)
    svg.append(f'<text x="{x}" y="{y}" font-family="Arial, sans-serif" font-size="{size}" font-weight="{700 if bold else 400}" fill="{fill}">{escape(s)}</text>')
def para(x,y,s,w,size=9.3,leading=12.4,fill=MUTED,bold=False):
    font='Arial-Bold' if bold else 'Arial'; result=[]
    for block in s.split('\n'):
        line=''
        for word in block.split():
            candidate=(line+' '+word).strip()
            if line and pdfmetrics.stringWidth(candidate,font,size)>w:result.append(line);line=word
            else:line=candidate
        result.append(line)
    for i,line in enumerate(result):text(x,y+i*leading,line,size,fill,bold)
    return y+len(result)*leading

def line(points,fill=LINE,width=1,arrow=False):
    c.setStrokeColorRGB(*color(fill));c.setLineWidth(width)
    p=c.beginPath();p.moveTo(points[0][0],H-points[0][1])
    for x,y in points[1:]:p.lineTo(x,H-y)
    c.drawPath(p)
    svg.append('<polyline points="'+' '.join(f'{x},{y}' for x,y in points)+f'" fill="none" stroke="{fill}" stroke-width="{width}"/>')
    if arrow:
        a,b=points[-2:];angle=math.atan2(b[1]-a[1],b[0]-a[0]);size=4
        pts=[b,(b[0]-size*math.cos(angle-.5),b[1]-size*math.sin(angle-.5)),(b[0]-size*math.cos(angle+.5),b[1]-size*math.sin(angle+.5))]
        c.setFillColorRGB(*color(fill));p=c.beginPath();p.moveTo(pts[0][0],H-pts[0][1])
        for x,y in pts[1:]:p.lineTo(x,H-y)
        p.close();c.drawPath(p,fill=1,stroke=0)
        svg.append('<polygon points="'+' '.join(f'{x},{y}' for x,y in pts)+f'" fill="{fill}"/>')

def node(x,y,w,h,kicker,title,body,accent=TEAL,size=9.3):
    rect(x,y,w,h,'#FFFFFF',LINE,6)
    rect(x,y,3,h,accent,r=1)
    text(x+12,y+16,kicker,8,accent,True)
    text(x+12,y+32,title,11,INK,True)
    end=para(x+12,y+47,body,w-24,size=size,leading=12)
    if end-12>y+h-7:raise ValueError(f'Text overflow in {title}: {end} vs {y+h}')

rect(0,0,W,H,'#FFFFFF')
text(32,29,'HENRY WILLIAMS  /  911RECORDS.ORG',9,TEAL,True)
text(32,58,'From scanned records to cited answers.',25,INK,True)
text(32,77,"An independent research platform for New York City's released September 11 records.",10.5,MUTED)
for x,w,a,b in [(32,220,'64,385','PDFs available'),(264,232,'231,104','catalog pages'),(508,252,'Nightly','catalog refresh + change tracking')]:
    rect(x,91,w,24,BG,r=4);text(x+10,107,a,11,INK,True);text(x+(75 if x!=508 else 58),107,b,9,MUTED)

text(32,134,'01  /  BUILD THE EVIDENCE LAYER',9,TEAL,True)
node(32,144,160,79,'INGESTION','City catalog + PDFs','Snapshot and diff; track changes and withdrawals. Preserve source files and Bates page IDs.',size=9.2)
node(212,144,324,79,'OCR  /  LOCAL','Extract text + recover scans','Embedded text > Tesseract fallback > 300-DPI Apple Vision / Tesseract comparison. Readability, cross-engine agreement and number-preservation gates control replacements.',size=9.2)
node(556,144,204,79,'PROVENANCE','Selected page text','Use the current catalog copy and approved OCR. Keep each page linked to its original scan.',size=9.2)
line([(192,183),(208,183)],arrow=True)
line([(536,183),(552,183)],arrow=True)
# One selected text stream feeds the three independent enrichment outputs.
line([(658,223),(658,236),(148,236)],width=.9)
for x in [148,396,644]:line([(x,236),(x,251)],arrow=True)
node(32,254,232,85,'NLP / LANGUAGE PROCESSING','Structured information','Python regex + dictionaries extract addresses, labs, dates and measurements. Fuzzy matching resolves names; rules classify record types.',TEAL,9.5)
node(280,254,232,85,'ML','Meaning + discovery','Local nomic-embed-text: 768-D vectors from page chunks. Similarity search, related records and scikit-learn topic clustering.',BLUE,9.5)
node(528,254,232,85,'LLMs','Readable descriptions','Local Qwen: titles and summaries. Claude Haiku: topic labels, fallback facts and entity cleanup.',PURPLE,9.5)
for x in [148,396,644]:line([(x,339),(x,351)],arrow=True)
rect(32,355,728,32,INK,r=5)
text(44,375,'PUBLISH',8.5,'#B7DADA',True)
text(100,375,'PostgreSQL: metadata + text   |   OpenSearch: text + vectors   |   Next.js: two hosts behind Cloudflare',9.2,'#FFFFFF')

text(32,411,'02  /  SEARCH, EXPLAIN, VERIFY',9,TEAL,True)
line([(542,387),(542,425)],arrow=True)
text(550,410,'serves retrieval',8,MUTED)
node(32,428,166,90,'INPUT','Researcher asks','Bates ID: open the record.\nKeywords: search directly.\nQuestion: use an LLM plan.',TEAL,9.3)
node(214,428,166,90,'ROUTING','Plan + retrieve','Haiku plans question terms and filters. Embed the query locally using the same nomic model.',PURPLE,9.3)
node(396,428,174,90,'HYBRID SEARCH','Rank the evidence','Filter eligible pages; rank with OpenSearch BM25 + k-NN. Normalize and blend: 40% keyword / 60% semantic.',BLUE,9.3)
node(586,428,174,90,'USER EXPERIENCE','Results you can check','Search: snippets + filters. Ask: Haiku uses up to 12 excerpts with checked citation IDs. Verify in the scan + OCR viewer.',TEAL,9.3)
for a,b in [(198,214),(380,396),(570,586)]:line([(a,473),(b-4,473)],arrow=True)

text(32,540,'EXPERIENCE DEMONSTRATED',8.5,INK,True)
for x,label,body,accent in [(32,'ML','Embedding pipelines, clustering and OCR quality evaluation.',BLUE),(280,'NLP','Information extraction, canonicalization and document classification.',TEAL),(528,'LLMs','Local inference, structured outputs and retrieval-augmented generation.',PURPLE)]:
    text(x,559,label,10,accent,True)
    para(x+34,559,body,196,9.2,11.5,INK)
line([(32,588),(760,588)],width=.6)
text(32,601,'Pretrained models integrated into a production system. Original scans remain the evidence.',8,MUTED)
text(619,601,'Corpus: October 27, 2026',8,MUTED)
c.linkURL('https://911records.org',(32,H-32,285,H-16),relative=0)
c.showPage();c.save()
svg.append('</svg>')
(OUT/'interview/911records-interview-onepager.svg').write_text('\n'.join(svg))
print('Created PDF + editable SVG')
