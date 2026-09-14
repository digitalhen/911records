// Word-box data for hit highlighting on the document viewer. Fetched from
// the `files` service (data/text/<agency>/<volume>/<bates>.boxes.jsonl or
// .ocr.boxes.jsonl, docs/PLAN.md) rather than read off local disk — the app
// has no bind mount to data/ in production. Files are small (one per
// document, at most a few MB), so each is parsed once and kept whole in a
// process-local LRU rather than re-fetched per page view.
import { textFileUrl } from './files';

export interface WordBox {
  page: number;
  w: number;
  h: number;
  words: [number, number, number, number, string][];
}

const MAX_ENTRIES = 200;
const cache = new Map<string, WordBox[]>();

function cacheGet(key: string): WordBox[] | undefined {
  const v = cache.get(key);
  if (v) {
    // refresh recency
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function cacheSet(key: string, v: WordBox[]): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, v);
}

async function fetchBoxesFile(url: string): Promise<WordBox[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const text = await res.text();
    const rows: WordBox[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as WordBox);
      } catch {
        // skip malformed line
      }
    }
    return rows;
  } catch {
    return null;
  }
}

export async function getPageBoxes(agency: string, volume: string, bates: string, page: number): Promise<WordBox | null> {
  for (const suffix of ['.boxes.jsonl', '.ocr.boxes.jsonl']) {
    const url = textFileUrl(agency, volume, bates, suffix);
    let rows = cacheGet(url);
    if (!rows) {
      const fetched = await fetchBoxesFile(url);
      if (fetched === null) continue; // 404 or unreachable — try the other suffix
      rows = fetched;
      cacheSet(url, rows);
    }
    const match = rows.find((r) => r.page === page);
    if (match) return match;
  }
  return null;
}
