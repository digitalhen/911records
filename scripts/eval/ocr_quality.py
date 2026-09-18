"""Conservative lexical screen, not an OCR accuracy metric.
Uses a local dictionary plus corpus vocabulary; never fabricates or corrects text.
"""
import re
from collections import Counter
from pathlib import Path

WORDS = {w.strip().lower() for w in Path('/usr/share/dict/words').read_text().splitlines()}
WORDS.update('nyc wtc asbestos chrysotile amosite crocidolite tremolite actinolite anthophyllite diquat gcms ah era ah era nv lap nvlap ahera elap dep epa tclp pcm plm tem ug mg ng ppm ppb analyte analytes chromatogram quantitation quant calibration deionized analyz ed analyzed laboratory labs misc acq inst vial tic rt multiplier environ environmental westchester quantitation quantitation'.split())
WATERMARK = re.compile(r'NYC\s*9/11\s*Public\s*Portal\s*Document|NYC[-_ ]?WTC[-_ ]?\d+',re.I)

def quality(text):
    text=WATERMARK.sub('',text)
    tokens=re.findall(r'\b[A-Za-z]{3,}\b',text)
    good=[t.lower() for t in tokens if t.lower() in WORDS]
    return dict(tokens=len(tokens), good=len(good), unique=len(set(good)), ratio=len(good)/max(1,len(tokens)), chars=len(re.sub(r'\s+', ' ', text).strip()))

def numbers(text):
    return Counter(re.findall(r'(?<![\w.])\d+\.\d+(?![\w.])',WATERMARK.sub('',text)))


def recognized_words(text):
    return {word.lower() for word in re.findall(r'\b[A-Za-z]{3,}\b', WATERMARK.sub('', text))
            if word.lower() in WORDS}
