import 'server-only';
import { queryOne } from '@/lib/db';

export interface Archive {
  name: string; documents: number; pages: number; bytes: number; sha256: string;
  agency?: string | null; volume?: string | null; box?: string | null;
}
export interface DownloadCatalog {
  schema_version: number; built_at: string; snapshot_date: string | null;
  generated_at: string; manifest: string; full: Archive; boxes: Archive[];
}
export const downloadsOrigin = () => `${(process.env.FILES_URL || 'http://127.0.0.1:8911').replace(/\/+$/, '')}/downloads`;
export const downloadHref = (name: string) => `/api/downloads/${encodeURIComponent(name)}`;
export function formatBytes(bytes: number) {
  return bytes >= 1000 ** 3 ? `${(bytes / 1000 ** 3).toFixed(1)} GB` : `${(bytes / 1000 ** 2).toFixed(1)} MB`;
}
export async function currentDownloads(): Promise<DownloadCatalog | null> {
  // Primary, uncached: a lagging replica must not authorize a withdrawn archive.
  const response = await fetch(`${downloadsOrigin()}/index.json`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const catalog = await response.json() as DownloadCatalog;
  if (catalog.schema_version !== 1 || !catalog.built_at || !Array.isArray(catalog.boxes)) return null;
  const meta = await queryOne<{ value: string }>("SELECT value FROM site.meta WHERE key='built_at'");
  return meta?.value === catalog.built_at ? catalog : null;
}
