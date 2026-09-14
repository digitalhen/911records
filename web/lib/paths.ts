// Path helpers shared by lib/siteDb.ts, lib/textFiles.ts, the dev files
// server (scripts/files-dev-server.mjs) and the fixture generator
// (scripts/fixture-site-db.mjs). Keeping the on-disk layout in one place
// means the production `files` nginx map generator (../files/) and this app
// agree on where things live without importing across the Node/nginx split.
import path from 'node:path';

/** Root of the mirrored data tree. Defaults to ../data for `npm run dev` run from web/. */
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', 'data');

/**
 * The six agencies in the corpus map to fixed on-disk directory codes under
 * data/pdf, data/text and data/pages. This is stable for the life of the
 * corpus (README "Snapshot 2026-09-13"); a new agency showing up in a future
 * release would need a line added here.
 */
export const AGENCY_DIR: Record<string, string> = {
  'Environmental Protection, Dept. of': 'DEP',
  'Citywide Administrative Services, Dept. of': 'DCAS',
  'Fire Department': 'FDNY',
  'Records and Information Services, Dept. of': 'DORIS',
  'Design and Construction, Dept. of': 'DDC',
  'Buildings, Dept. of': 'DOB',
};

export function agencyDir(agency: string | null | undefined): string | null {
  if (!agency) return null;
  return AGENCY_DIR[agency] ?? null;
}

export function pdfPath(agency: string, volume: string, bates: string): string {
  return path.join(DATA_DIR, 'pdf', agencyDir(agency) || agency, volume, `${bates}.pdf`);
}

export function textPath(agency: string, volume: string, bates: string): string {
  return path.join(DATA_DIR, 'text', agencyDir(agency) || agency, volume, `${bates}.txt`);
}

export function pagesJsonlPath(agency: string, volume: string, bates: string): string {
  return path.join(DATA_DIR, 'text', agencyDir(agency) || agency, volume, `${bates}.pages.jsonl`);
}

/** Word-box files come in two flavors depending on which pass produced them. */
export function boxesJsonlPaths(agency: string, volume: string, bates: string): string[] {
  const dir = path.join(DATA_DIR, 'text', agencyDir(agency) || agency, volume);
  return [path.join(dir, `${bates}.boxes.jsonl`), path.join(dir, `${bates}.ocr.boxes.jsonl`)];
}

export function pageImageDir(agency: string, volume: string, bates: string): string {
  return path.join(DATA_DIR, 'pages', agencyDir(agency) || agency, volume, bates);
}

export function pageImagePath(agency: string, volume: string, bates: string, n: number, thumb = false): string {
  return path.join(pageImageDir(agency, volume, bates), thumb ? `${n}.t.webp` : `${n}.webp`);
}

export const BATES_RE = /NYC-(?:W|VV)TC[ _]?(\d{6,9})/i;

/** Normalize free text like "NYC-WTC_900058160" to the canonical dashed form. */
export function normalizeBates(raw: string): string | null {
  const m = BATES_RE.exec(raw.trim());
  if (!m) return null;
  const digits = m[1]!.padStart(9, '0');
  return `NYC-WTC_${digits}`;
}
