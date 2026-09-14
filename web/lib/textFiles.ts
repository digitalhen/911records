// Reads OCR text and word-box data straight from data/text/*, which is how
// the document viewer gets a page's text (docs/PLAN.md: "page image beside
// OCR text from data/text/<agency>/<volume>/<bates>.pages.jsonl line n").
// These files are small (one per document) and read on every request; that
// is fine at this corpus's page counts and avoids a text-storage duplicate
// in site.sqlite.
import fs from 'node:fs';
import readline from 'node:readline';
import { boxesJsonlPaths, pagesJsonlPath } from './paths';

export interface PageTextRow {
  page: number;
  bates: string;
  chars: number;
  text: string;
}

export interface WordBox {
  page: number;
  w: number;
  h: number;
  words: [number, number, number, number, string][];
}

async function readJsonlLines<T>(filePath: string): Promise<T[]> {
  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  } catch {
    return [];
  }
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const out: T[] = [];
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // skip malformed line rather than fail the whole read
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** Reads one page's OCR text without loading the whole document into memory twice. */
export async function getPageText(agency: string, volume: string, bates: string, page: number): Promise<PageTextRow | null> {
  const filePath = pagesJsonlPath(agency, volume, bates);
  if (!fs.existsSync(filePath)) return null;
  const rows = await readJsonlLines<PageTextRow>(filePath);
  return rows.find((r) => r.page === page) ?? null;
}

export async function getAllPageText(agency: string, volume: string, bates: string): Promise<PageTextRow[]> {
  const filePath = pagesJsonlPath(agency, volume, bates);
  if (!fs.existsSync(filePath)) return [];
  return readJsonlLines<PageTextRow>(filePath);
}

/** Word boxes for hit highlighting, in page-image pixel space (docs/PLAN.md). */
export async function getPageBoxes(agency: string, volume: string, bates: string, page: number): Promise<WordBox | null> {
  for (const filePath of boxesJsonlPaths(agency, volume, bates)) {
    if (!fs.existsSync(filePath)) continue;
    const rows = await readJsonlLines<WordBox>(filePath);
    const match = rows.find((r) => r.page === page);
    if (match) return match;
  }
  return null;
}
