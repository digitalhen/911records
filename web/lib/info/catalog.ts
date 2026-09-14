import 'server-only';
import { queryRead } from '@/lib/db';
import type { DatabaseDate } from '@/lib/dates';
import type { SnapshotRow } from '@/lib/site';

export const number = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US');
export const captureNote = 'Dates are when we captured the City’s catalog, not necessarily when the City published or changed a record. A changed catalog entry does not by itself establish that a PDF was re-redacted.';
export const beforeMirrorNote = 'Known removed before the mirror: the catalog fell from 24,441 documents on September 9 to 24,437 on September 11, then 24,436 on September 13, 2026. Four Bates numbers were recorded by an earlier watchdog; one additional seven-page document was never identified. We hold none of those documents.';
export const snapshots = () => queryRead<SnapshotRow>('SELECT * FROM site.snapshots ORDER BY date DESC');
export interface SafeChange { date: DatabaseDate; doc: string; kind: string; bates_end: string | null; agency: string | null; page_count: number | null; status: string | null; removed_at: DatabaseDate | null }
export function changes(date?: string, limit?: number, offset = 0) {
  return queryRead<SafeChange>(`SELECT c.date, c.doc, c.kind, d.bates_end, d.agency, d.page_count, d.status, d.removed_at FROM site.changes c LEFT JOIN site.documents d ON d.doc=c.doc ${date ? 'WHERE c.date=$1' : ''} ORDER BY c.date DESC, c.doc, c.kind ${limit ? `LIMIT $${date ? 2 : 1} OFFSET $${date ? 3 : 2}` : ''}`, [...(date ? [date] : []), ...(limit ? [limit, offset] : [])]);
}
export const levels = ['agency', 'volume', 'box', 'folder'] as const;
// Reserve segments for missing/empty metadata and URL dot segments; escape real tildes.
// Next decodes URL segments once before passing params; unsegment only undoes our escapes.
export const segment = (value: string | null) => value == null ? '~' : value === '' ? '~e' : value === '.' ? '~d' : value === '..' ? '~dd' : encodeURIComponent(value.replaceAll('~', '~~'));
// Next 15 hands catch-all params to the page still percent-encoded ("Buildings%2C%20Dept.%20of"),
// so decode here (guarded: a value that is not valid encoding is kept as-is).
const decodeSegment = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
export const unsegment = (raw: string) => { const value = decodeSegment(raw); return value === '~' ? null : value === '~e' ? '' : value === '~d' ? '.' : value === '~dd' ? '..' : value.replaceAll('~~', '~'); };
export function browseUrl(path: (string | null)[], source?: string) {
  return '/browse' + (path.length ? '/' + path.map(segment).join('/') : '') + (source !== undefined ? `?source=${encodeURIComponent(source)}` : '');
}
export function filters(path: (string | null)[], source?: string) {
  const params: unknown[] = [...path];
  const clauses = path.map((_, i) => `${levels[i]} IS NOT DISTINCT FROM $${i + 1}`);
  if (source !== undefined) { params.push(source); clauses.push(`COALESCE(source, '')=$${params.length}`); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}
