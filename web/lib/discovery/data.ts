import { cache } from 'react';
import { queryReadSafe } from '@/lib/db';

export const ENTITY_TYPES = ['lab', 'agency', 'contractor', 'substance', 'address'] as const;
export const TYPE_LABELS: Record<string, string> = { lab: 'Labs', agency: 'Agencies / offices', contractor: 'Contractors', substance: 'Substances', address: 'Addresses', signatory: 'Signatories by role' };
export const pageHref = (doc: string, page = 1) => `/doc/${encodeURIComponent(doc)}/p/${page}`;
export const entityHref = (type: string, slug: string) => type === 'signatory' ? `/signatory/${encodeURIComponent(slug)}` : `/entity/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`;
export interface Source { doc: string; page: number; confidence: number | null }
export interface Entity extends Source { id: string; type: string; slug: string; label: string; n_docs: number; n_pages: number; first_date: string | Date | null; last_date: string | Date | null; role?: string }
export interface Signatory extends Entity { name: string; title: string | null; org: string | null }
export interface Occurrence extends Source { role: string; agency: string | null; volume: string | null; box: string | null; folder: string | null; dates: unknown }
export interface Topic extends Source { id: number; parent: number | null; label: string; size_docs: number; size_pages: number; terms: unknown; boxes: unknown; agencies: unknown }

// Only non-person entity types may enter HTML, suggestions, metadata or sitemaps.
export async function suggestEntities(q: string): Promise<Entity[]> {
  const pattern = `%${q.slice(0, 120).replace(/[\\%_]/g, '\\$&')}%`;
  const [entities, signatories] = await Promise.all([
    queryReadSafe<Entity>(`SELECT e.id,e.type,e.slug,e.label,e.first_date,e.last_date,
      s.doc,s.page,s.confidence,c.n_docs,c.n_pages FROM site.entities e
      JOIN LATERAL (SELECT DISTINCT ep.doc,ep.page,ep.confidence FROM site.entity_pages ep JOIN site.documents d USING(doc)
        JOIN site.pages p USING(doc,page) WHERE ep.entity_id=e.id AND d.status IS DISTINCT FROM 'removed' ORDER BY ep.doc,ep.page LIMIT 1) s ON true
      JOIN LATERAL (SELECT COUNT(DISTINCT ep.doc) AS n_docs,COUNT(DISTINCT (ep.doc,ep.page)) AS n_pages
        FROM site.entity_pages ep JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
        WHERE ep.entity_id=e.id AND d.status IS DISTINCT FROM 'removed') c ON true
      WHERE e.type=ANY($1::text[]) AND e.label ILIKE $2 ORDER BY e.n_pages DESC,e.id LIMIT 60`, [ENTITY_TYPES, pattern]),
    queryReadSafe<Entity>(`SELECT s.id,s.slug,'signatory' AS type,COALESCE(NULLIF(s.title,''),'Official signatory') AS label,
      s.first_date,s.last_date,c.n_docs,c.n_pages,x.doc,x.page,x.confidence,x.role FROM site.signatories s
      JOIN LATERAL (SELECT sp.doc,sp.page,sp.confidence,sp.action AS role
        FROM site.signatory_pages sp JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
        WHERE sp.id=s.id AND d.status IS DISTINCT FROM 'removed' ORDER BY sp.doc,sp.page LIMIT 1) x ON true
      JOIN LATERAL (SELECT COUNT(DISTINCT sp.doc) AS n_docs,COUNT(DISTINCT (sp.doc,sp.page)) AS n_pages
        FROM site.signatory_pages sp JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
        WHERE sp.id=s.id AND d.status IS DISTINCT FROM 'removed') c ON true
      WHERE COALESCE(s.title,'') ILIKE $1 OR COALESCE(s.org,'') ILIKE $1 OR EXISTS (
        SELECT 1 FROM site.signatory_pages sp JOIN site.documents d USING(doc)
        WHERE sp.id=s.id AND sp.action ILIKE $1 AND d.status IS DISTINCT FROM 'removed')
      ORDER BY s.n_docs DESC,s.id LIMIT 20`, [pattern]),
  ]);
  return [...entities, ...signatories].map(row => ({
    ...row, first_date: formatDate(row.first_date), last_date: formatDate(row.last_date),
  }));
}
export const getEntity = cache(async (type: string, slug: string) => {
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) return null;
  return (await queryReadSafe<Entity>('SELECT * FROM site.entities WHERE type=$1 AND slug=$2', [type, slug]))[0] ?? null;
});
export const getSignatory = cache(async (slug: string) => (await queryReadSafe<Signatory>('SELECT * FROM site.signatories WHERE slug=$1', [slug]))[0] ?? null);
export const getOccurrences = cache(async (id: string, signatory = false): Promise<Occurrence[]> => {
  const table = signatory ? 'signatory_pages' : 'entity_pages';
  const key = signatory ? 'id' : 'entity_id';
  const role = signatory ? 'action' : 'role';
  return queryReadSafe<Occurrence>(`SELECT DISTINCT ep.doc,ep.page,ep.${role} AS role,ep.confidence,d.agency,d.volume,d.box,d.folder,
    (SELECT jsonb_agg(pp.dates) FROM site.place_pages pp WHERE pp.doc=ep.doc AND pp.page=ep.page) AS dates
    FROM site.${table} ep JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
    WHERE ep.${key}=$1 AND d.status IS DISTINCT FROM 'removed' ORDER BY ep.doc,ep.page,role`, [id]);
});
export const getTopics = cache(async () => queryReadSafe<Topic>(`SELECT t.*,s.doc,s.page,NULL::real AS confidence FROM site.topics t
  JOIN LATERAL (SELECT dt.doc,p.page FROM site.doc_topics dt JOIN site.documents d USING(doc)
    JOIN site.pages p USING(doc) WHERE dt.topic=t.id AND d.status IS DISTINCT FROM 'removed'
    ORDER BY dt.prob DESC NULLS LAST,dt.doc,p.page LIMIT 1) s ON true ORDER BY t.size_pages DESC,t.id`));
export async function topicDocuments(id: number, offset = 0) {
  return queryReadSafe<Source & { prob: number; agency: string | null; box: string | null; total: number }>(`SELECT dt.doc,dt.prob,d.agency,d.box,p.page,COUNT(*) OVER() AS total
    FROM site.doc_topics dt JOIN site.documents d USING(doc)
    JOIN LATERAL (SELECT page FROM site.pages WHERE doc=d.doc ORDER BY page LIMIT 1) p ON true
    WHERE dt.topic=$1 AND d.status IS DISTINCT FROM 'removed' ORDER BY dt.prob DESC NULLS LAST,dt.doc LIMIT 50 OFFSET $2`, [id,offset]);
}
export function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function terms(value: unknown): string[] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(v => typeof v === 'string' ? [v] : Array.isArray(v) && typeof v[0] === 'string' ? [v[0]] : []).slice(0,12);
}
export function distribution(value: unknown): [string, number][] {
  const parsed = jsonValue(value);
  if (!parsed || typeof parsed !== 'object') return [];
  const entries = Array.isArray(parsed) ? parsed.filter(Array.isArray) : Object.entries(parsed);
  return entries.filter((v): v is [string, number] => typeof v[0] === 'string' && typeof v[1] === 'number').slice(0,12);
}
export function months(value: unknown): string[] {
  const parsed = jsonValue(value);
  if (Array.isArray(parsed)) return [...new Set(parsed.flatMap(months))];
  const date = formatDate(parsed);
  return date ? [date.slice(0,7)] : [];
}

/** pg returns SQL dates/timestamps as Date objects; JSX and suggestions need strings. */
export function formatDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0,10) : null;
  if (typeof value !== 'string') return null;
  // Preserve the calendar date written on the record, including timestamp strings.
  const match = /^(\d{4}-(0[1-9]|1[0-2])-\d{2})(?:$|[T ])/.exec(value);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === match[1] ? match[1] : null;
}
