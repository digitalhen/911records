import { cache } from 'react';
import { cached } from '@/lib/site';
import { queryReadSafe } from '@/lib/db';
import { buildVersion, documentsHaveTitles } from '@/lib/site';

export const ENTITY_TYPES = ['lab', 'agency', 'contractor', 'substance', 'address'] as const;
export const TYPE_LABELS: Record<string, string> = { lab: 'Labs', agency: 'Agencies & offices', contractor: 'Contractors', substance: 'Substances', address: 'Addresses & buildings', signatory: 'Officials acting on records' };
// Panel order on /entities.
export const PANEL_TYPES = ['lab', 'agency', 'contractor', 'substance', 'address', 'signatory'] as const;
export const pageHref = (doc: string, page = 1) => `/doc/${encodeURIComponent(doc)}/p/${page}`;
export const entityHref = (type: string, slug: string) => type === 'signatory' ? `/signatory/${encodeURIComponent(slug)}` : `/entity/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`;
export interface Source { doc: string; page: number; confidence: number | null }
export interface Entity extends Source { id: string; type: string; slug: string; label: string; n_docs: number; n_pages: number; first_date: string | Date | null; last_date: string | Date | null; role?: string; bin?: string | null; bbl?: string | null; variants?: unknown }
export interface Signatory extends Entity { name: string; title: string | null; org: string | null }
export interface Occurrence extends Source { role: string; agency: string | null; volume: string | null; box: string | null; folder: string | null; title: string | null; summary: string | null; dates: unknown }
// Not `extends Source`: a parent/rollup topic (no direct site.doc_topics rows — see getTopics)
// has no doc/page of its own, unlike every other Source-bearing row in this file.
export interface Topic { id: number; parent: number | null; label: string; size_docs: number; size_pages: number; terms: unknown; boxes: unknown; agencies: unknown; title: string | null; description: string | null; name_confidence: number | null; doc: string | null; page: number | null; confidence: number | null }
/** A Topic has a checkable source page only when it carries direct document assignments
 * (every leaf topic does; parent/rollup topics don't) — use as the `Extraction` `source` prop. */
export function topicSource(t: Topic): Source | null {
  return t.doc != null && t.page != null ? { doc: t.doc, page: t.page, confidence: t.confidence } : null;
}
/** Human-readable title when a name-safe one was generated (site.topics.title, P2); otherwise the
 * term-list label, falling back further to a generic "Topic N". Never renders raw terms as a title. */
export function topicTitle(t: Topic): string {
  return t.title || t.label || `Topic ${t.id}`;
}
export interface PanelRow { id: string; type: string; slug: string; label: string; n_docs: number; n_pages: number; first_date: string | Date | null; last_date: string | Date | null; bin: string | null; bbl: string | null }
/** A building link takes priority over the entity page when an address resolved to a BIN/BBL. */
export function entityLinkHref(row: Pick<PanelRow,'type'|'slug'|'bin'>): string {
  return row.type === 'address' && row.bin ? `/building/${encodeURIComponent(row.bin)}` : entityHref(row.type, row.slug);
}

// entities.bin (from the Prospect property-roll gazetteer join) can name a BIN with no
// site.places row of its own — place_pages is built from a separate extraction pass, so
// /building/<bin> would 404. Only surface a bin here when a building page actually resolves.
const LINKABLE_BIN = `(CASE WHEN e.bin IS NOT NULL AND EXISTS (SELECT 1 FROM site.places pl WHERE pl.kind='bin' AND pl.key=e.bin) THEN e.bin END) AS bin`;
/** Top N entities of one type by page count, plus the total count of all indexed entities of that type. Used by the /entities panel grid and its "See all" link. */
export async function panelEntities(type: string, limit = 8): Promise<{ rows: PanelRow[]; total: number }> {
  if (type === 'signatory') return panelSignatories(limit);
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) return { rows: [], total: 0 };
  const rows = await queryReadSafe<PanelRow & { total: number }>(`SELECT e.id,e.type,e.slug,e.label,e.first_date,e.last_date,${LINKABLE_BIN},e.bbl,
    c.n_docs,c.n_pages,COUNT(*) OVER() AS total FROM site.entities e
    JOIN LATERAL (SELECT COUNT(DISTINCT ep.doc) AS n_docs,COUNT(DISTINCT (ep.doc,ep.page)) AS n_pages
      FROM site.entity_pages ep JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
      WHERE ep.entity_id=e.id AND d.status IS DISTINCT FROM 'removed') c ON true
    WHERE e.type=$1 AND c.n_pages>0 ORDER BY c.n_pages DESC,e.id LIMIT $2`, [type, limit]);
  return { rows: rows.map(withDates), total: rows[0]?.total ?? 0 };
}
async function panelSignatories(limit = 8): Promise<{ rows: PanelRow[]; total: number }> {
  const rows = await queryReadSafe<PanelRow & { total: number }>(`SELECT s.id,s.slug,'signatory' AS type,
    COALESCE(NULLIF(s.title,''),'Official signatory') AS label,s.first_date,s.last_date,NULL::text AS bin,NULL::text AS bbl,
    c.n_docs,c.n_pages,COUNT(*) OVER() AS total FROM site.signatories s
    JOIN LATERAL (SELECT COUNT(DISTINCT sp.doc) AS n_docs,COUNT(DISTINCT (sp.doc,sp.page)) AS n_pages
      FROM site.signatory_pages sp JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
      WHERE sp.id=s.id AND d.status IS DISTINCT FROM 'removed') c ON true
    WHERE c.n_pages>0 ORDER BY c.n_pages DESC,s.id LIMIT $1`, [limit]);
  return { rows: rows.map(withDates), total: rows[0]?.total ?? 0 };
}
// Perf (issue #13): /entities' panel grid runs 6 entity-type queries (each with its own
// per-entity LATERAL count) on every visit — cached, keyed by lib/site.ts's buildVersion() so a
// refresh swap is picked up within ~60s. Rows are already plain JSON (withDates formats dates to
// strings), so this round-trips through unstable_cache unchanged.
const cachedPanelGrid = cached(
  async (_v: string, limit: number) => {
    const entries = await Promise.all(PANEL_TYPES.map(async type => [type, await panelEntities(type, limit)] as const));
    return Object.fromEntries(entries);
  },
  ['discovery-panel-grid'],
  { revalidate: 60 },
);
/** All panels for the /entities grid, fetched together. */
export async function panelGrid(limit = 8): Promise<Record<string, { rows: PanelRow[]; total: number }>> {
  return cachedPanelGrid(await buildVersion(), limit);
}
/** Paginated, A–Z-filterable listing for /entities/[type] (also used for the signatory listing). */
export async function listEntities(type: string, opts: { letter?: string; offset?: number; limit?: number } = {}): Promise<{ rows: PanelRow[]; total: number } | null> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 60));
  const offset = Math.max(0, opts.offset ?? 0);
  const letter = opts.letter && /^[A-Za-z0-9]$/.test(opts.letter) ? opts.letter.toUpperCase() : null;
  if (type === 'signatory') {
    const params: unknown[] = [limit, offset];
    if (letter) params.push(`${letter}%`);
    const rows = await queryReadSafe<PanelRow & { total: number }>(`SELECT s.id,s.slug,'signatory' AS type,
      COALESCE(NULLIF(s.title,''),'Official signatory') AS label,s.first_date,s.last_date,NULL::text AS bin,NULL::text AS bbl,
      c.n_docs,c.n_pages,COUNT(*) OVER() AS total FROM site.signatories s
      JOIN LATERAL (SELECT COUNT(DISTINCT sp.doc) AS n_docs,COUNT(DISTINCT (sp.doc,sp.page)) AS n_pages
        FROM site.signatory_pages sp JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
        WHERE sp.id=s.id AND d.status IS DISTINCT FROM 'removed') c ON true
      WHERE c.n_pages>0 ${letter ? "AND COALESCE(NULLIF(s.title,''),'Official signatory') ILIKE $3" : ''}
      ORDER BY label ASC,s.id LIMIT $1 OFFSET $2`, params);
    return { rows: rows.map(withDates), total: rows[0]?.total ?? 0 };
  }
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) return null;
  const params: unknown[] = [type, limit, offset];
  if (letter) params.push(`${letter}%`);
  const rows = await queryReadSafe<PanelRow & { total: number }>(`SELECT e.id,e.type,e.slug,e.label,e.first_date,e.last_date,${LINKABLE_BIN},e.bbl,
    c.n_docs,c.n_pages,COUNT(*) OVER() AS total FROM site.entities e
    JOIN LATERAL (SELECT COUNT(DISTINCT ep.doc) AS n_docs,COUNT(DISTINCT (ep.doc,ep.page)) AS n_pages
      FROM site.entity_pages ep JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
      WHERE ep.entity_id=e.id AND d.status IS DISTINCT FROM 'removed') c ON true
    WHERE e.type=$1 AND c.n_pages>0 ${letter ? 'AND e.label ILIKE $4' : ''}
    ORDER BY e.label ASC,e.id LIMIT $2 OFFSET $3`, params);
  return { rows: rows.map(withDates), total: rows[0]?.total ?? 0 };
}
function withDates<T extends { first_date: unknown; last_date: unknown }>(row: T): T {
  return { ...row, first_date: formatDate(row.first_date), last_date: formatDate(row.last_date) };
}

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
  const titleCol = (await documentsHaveTitles()) ? 'd.title,d.summary,' : 'NULL::text AS title,NULL::text AS summary,';
  return queryReadSafe<Occurrence>(`SELECT DISTINCT ep.doc,ep.page,ep.${role} AS role,ep.confidence,d.agency,d.volume,d.box,d.folder,${titleCol}
    (SELECT jsonb_agg(pp.dates) FROM site.place_pages pp WHERE pp.doc=ep.doc AND pp.page=ep.page) AS dates
    FROM site.${table} ep JOIN site.documents d USING(doc) JOIN site.pages p USING(doc,page)
    WHERE ep.${key}=$1 AND d.status IS DISTINCT FROM 'removed' ORDER BY ep.doc,ep.page,role`, [id]);
});
export interface RelatedEntity { id: string; type: string; slug: string; label: string; bin: string | null; shared_pages: number }
/** Other non-person entities that co-occur on the same source pages as this entity/signatory —
 *  labs, agencies, contractors, substances and addresses only (entity_pages never carries a
 *  person), ranked by how many pages they share. Feeds the "Related entities" section. */
export async function relatedEntities(pages: Pick<Source,'doc'|'page'>[], excludeId = '', limit = 10): Promise<RelatedEntity[]> {
  const docs = [...new Set(pages.map(p => p.doc))];
  const pageNos = [...new Set(pages.map(p => p.page))];
  if (!docs.length) return [];
  return queryReadSafe<RelatedEntity>(`SELECT e.id,e.type,e.slug,e.label,${LINKABLE_BIN},COUNT(DISTINCT (ep.doc,ep.page)) AS shared_pages
    FROM site.entity_pages ep JOIN site.entities e ON e.id=ep.entity_id JOIN site.documents d USING(doc)
    WHERE ep.doc=ANY($1::text[]) AND ep.page=ANY($2::int[]) AND ep.entity_id<>$3 AND d.status IS DISTINCT FROM 'removed'
      AND EXISTS (SELECT 1 FROM unnest($1::text[],$2::int[]) AS src(doc,page) WHERE src.doc=ep.doc AND src.page=ep.page)
    GROUP BY e.id,e.type,e.slug,e.label,e.bin ORDER BY shared_pages DESC,e.id LIMIT $4`, [docs, pageNos, excludeId, limit]);
}
// LEFT JOIN LATERAL: parent/rollup topics (site.topics.parent IS NULL for every one seen so far)
// carry no direct site.doc_topics rows of their own — their size_pages/size_docs are aggregated
// from their children — so an inner join here would silently drop every parent topic and make
// the tree unreachable above its leaves. Callers must treat doc/page/confidence as possibly null.
// Perf (issue #13): the topic tree is identical for every visitor between refreshes — cross-
// request cached (keyed by buildVersion()), wrapped in React's per-request cache() too so the two
// calls on /topics/[id] (generateMetadata + the page body) never even reach the Next data cache
// lookup twice in the same request.
const cachedTopics = cached(
  async (_v: string) => queryReadSafe<Topic>(`SELECT t.*,s.doc,s.page,t.name_confidence AS confidence FROM site.topics t
  LEFT JOIN LATERAL (SELECT dt.doc,p.page FROM site.doc_topics dt JOIN site.documents d USING(doc)
    JOIN site.pages p USING(doc) WHERE dt.topic=t.id AND d.status IS DISTINCT FROM 'removed'
    ORDER BY dt.prob DESC NULLS LAST,dt.doc,p.page LIMIT 1) s ON true ORDER BY t.size_pages DESC,t.id`),
  ['discovery-topics'],
  { revalidate: 60 },
);
export const getTopics = cache(async () => cachedTopics(await buildVersion()));
export async function topicDocuments(id: number, offset = 0) {
  // Schema-first (issue #37): d.title/d.summary are read by name, not `SELECT *`, so they are
  // gated on documentsHaveTitles() rather than risking a 42703 in the deploy/data-load gap — see
  // that function's comment in lib/site.ts.
  const withTitles = await documentsHaveTitles();
  const titleCols = withTitles ? 'd.title,d.summary,' : 'NULL::text AS title,NULL::text AS summary,';
  // Cover sheets (issue #28) are excluded from topic document lists, like search — a folder
  // cover sheet carries no subject-matter content, so a topic assignment on one is noise, not a
  // document worth reading for this topic. Still reachable through /browse or by Bates.
  return queryReadSafe<Source & { prob: number; agency: string | null; box: string | null; title: string | null; summary: string | null; total: number }>(`SELECT dt.doc,dt.prob,d.agency,d.box,${titleCols}p.page,COUNT(*) OVER() AS total
    FROM site.doc_topics dt JOIN site.documents d USING(doc)
    JOIN LATERAL (SELECT page FROM site.pages WHERE doc=d.doc ORDER BY page LIMIT 1) p ON true
    WHERE dt.topic=$1 AND d.status IS DISTINCT FROM 'removed' AND d.doc_type IS DISTINCT FROM 'cover_sheet'
    ORDER BY dt.prob DESC NULLS LAST,dt.doc LIMIT 50 OFFSET $2`, [id,offset]);
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
