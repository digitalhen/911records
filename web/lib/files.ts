// Builds URLs served by the `files` service (docker-compose.host.yml on
// StudioMac in production; scripts/files-dev-server.mjs in dev), reached
// through Next's /files/:path* rewrite (next.config.ts) to FILES_URL.
//
// The app is deployed HA across two Dokploy instances with no bind mount to
// the data tree (docs/PLAN.md architecture note from Henry), so PDFs, page
// images and word-box files are never read from local disk — every one of
// these is a URL, built from a document's agency/volume (read from Postgres,
// see lib/site.ts), not a filesystem path.
export const FILES_URL = process.env.FILES_URL || 'http://127.0.0.1:8911';

/**
 * The six agencies in the corpus map to fixed on-disk directory codes under
 * data/pdf, data/text and data/pages. Stable for the life of the corpus
 * (README "Snapshot 2026-09-13"); a new agency in a future release needs a
 * line added here.
 */
export const AGENCY_DIR: Record<string, string> = {
  'Environmental Protection, Dept. of': 'DEP',
  'Citywide Administrative Services, Dept. of': 'DCAS',
  'Fire Department': 'FDNY',
  'Records and Information Services, Dept. of': 'DORIS',
  'Design and Construction, Dept. of': 'DDC',
  'Buildings, Dept. of': 'DOB',
};

export function agencyDir(agency: string | null | undefined): string {
  if (!agency) return 'unknown';
  return AGENCY_DIR[agency] ?? agency;
}

// Public paths — what the BROWSER should request. These go through Next's
// own /files/:path* rewrite (next.config.ts), which is what makes them work
// from outside the docker network: the browser never talks to FILES_URL
// directly (it's a host-internal address in production), only to this app.
export function pdfPath(agency: string, volume: string, bates: string): string {
  return `/files/pdf/${agencyDir(agency)}/${volume}/${bates}.pdf`;
}

export function pageImagePath(agency: string, volume: string, bates: string, n: number, thumb = false): string {
  return `/files/page/${agencyDir(agency)}/${volume}/${bates}/${n}${thumb ? '.t' : ''}.webp`;
}

// Absolute URLs against FILES_URL — for the app's OWN server-side fetch()
// calls (existence checks, word-box files), which run inside the same
// network as the files service and must not go through the public rewrite.
export function pdfUrl(agency: string, volume: string, bates: string): string {
  return `${FILES_URL}/pdf/${agencyDir(agency)}/${volume}/${bates}.pdf`;
}

export function pageImageUrl(agency: string, volume: string, bates: string, n: number, thumb = false): string {
  return `${FILES_URL}/page/${agencyDir(agency)}/${volume}/${bates}/${n}${thumb ? '.t' : ''}.webp`;
}

export function textFileUrl(agency: string, volume: string, bates: string, suffix: string): string {
  return `${FILES_URL}/text/${agencyDir(agency)}/${volume}/${bates}${suffix}`;
}

/** HEAD request with a short timeout — used to decide "render <img>" vs. "show the placeholder frame" without ever downloading the file. */
export async function fileExists(url: string, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
