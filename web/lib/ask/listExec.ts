// Deterministic executors for Ask's "list" plan kind (issue #35, lib/ask/lists.ts's
// catalogue): each function runs one parameterized, read-only query against
// schema `site` and returns a ListResult — no model call, no free-form SQL,
// same queryReadSafe/pool used by every other page (5s statement timeout,
// schema-first: an undefined table degrades to zero rows, never a 500).
// Modeled on lib/map/data.ts and lib/discovery/data.ts's query shapes
// (place_pages.contaminants/dates/labs, entity_pages, signatories) but
// self-contained here rather than importing their private query builders.
import { queryReadSafe } from '../db';
import { buildingUrl } from '../map/types';
import { entityHref } from '../discovery/data';
import {
  isListKind,
  MAX_LIST_ROWS,
  LIST_SPECS,
  docTypeLabel,
  type ListCite,
  type ListKind,
  type ListPlanLike,
  type ListResult,
  type ListRow,
} from './lists';

const ACTIVE = `d.status IS DISTINCT FROM 'removed'`;
// A DATE_RE-checked jsonb array element is a real calendar date, same convention as lib/map/data.ts.
const DATE_RANGE = (col: string) =>
  `EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(${col},'[]'::jsonb)) v WHERE v ~ '^\\d{4}-\\d{2}-\\d{2}$' AND v >= $DF AND v < $DT)`;

interface RepPage {
  doc: string | null;
  page: number | null;
}

/** Batch-resolves representative (doc,page) pairs to their Bates stamp + filing metadata, for
 *  ListRow.cite (bulk "Save to case" and a citeable link). One round trip for the whole result set. */
async function citesFor(pairs: RepPage[]): Promise<Map<string, ListCite>> {
  const docs: string[] = [];
  const pages: number[] = [];
  for (const p of pairs) {
    if (p.doc && p.page != null) {
      docs.push(p.doc);
      pages.push(p.page);
    }
  }
  if (!docs.length) return new Map();
  const rows = await queryReadSafe<{ doc: string; page: number; bates: string; agency: string | null; box: string | null; folder: string | null; volume: string | null }>(
    `SELECT pg.doc,pg.page,pg.bates,d.agency,d.box,d.folder,d.volume
     FROM site.pages pg JOIN site.documents d ON d.doc=pg.doc
     WHERE (pg.doc,pg.page) IN (SELECT * FROM unnest($1::text[],$2::int[]))`,
    [docs, pages],
  );
  return new Map(
    rows.map((r) => [
      `${r.doc}:${r.page}`,
      { doc: r.doc, page: r.page, batesPage: r.bates, agency: r.agency, box: r.box, folder: r.folder, volume: r.volume },
    ]),
  );
}

function citeKey(doc: string | null, page: number | null): string | null {
  return doc && page != null ? `${doc}:${page}` : null;
}

/** Resolves free-text "building" (an address as typed, or a bare BIN) to the site.places row(s)
 *  it matches. Same fragility as lib/ask/retrieve.ts's toSearchFilters: the model's phrasing rarely
 *  equals the roll's exact keyword-field spelling, so this tries an exact match first and only
 *  falls back to ILIKE — never a hard filter that silently returns zero on a near-miss address. */
async function resolveBuildingPlaces(
  address: string,
  bin: string,
): Promise<{ id: string; kind: string; key: string; label: string }[]> {
  if (bin) {
    const rows = await queryReadSafe<{ id: string; kind: string; key: string; label: string }>(
      `SELECT id,kind,key,label FROM site.places WHERE kind='bin' AND key=$1 LIMIT 1`,
      [bin],
    );
    if (rows.length) return rows;
  }
  const text = address.trim();
  if (!text) return [];
  const exact = await queryReadSafe<{ id: string; kind: string; key: string; label: string }>(
    `SELECT id,kind,key,label FROM site.places WHERE kind='address' AND upper(key)=upper($1) LIMIT 5`,
    [text],
  );
  if (exact.length) return exact;
  const pattern = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
  return queryReadSafe<{ id: string; kind: string; key: string; label: string }>(
    `SELECT id,kind,key,label FROM site.places WHERE kind IN ('address','bin') AND key ILIKE $1 ORDER BY length(key) LIMIT 10`,
    [pattern],
  );
}

function isoOrNull(from: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
}
/** Exclusive upper bound: a stated "to" date includes that whole day. */
function toExclusive(to: string): string | null {
  const d = isoOrNull(to);
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

// --- 1. buildings_by_substance ---------------------------------------------------------------

async function buildingsBySubstance(p: ListPlanLike): Promise<ListResult> {
  const substance = p.filters.contaminant.toLowerCase();
  const from = isoOrNull(p.filters.dateFrom);
  const to = toExclusive(p.filters.dateTo);
  const rows = await queryReadSafe<{
    id: string; kind: string; key: string; label: string;
    doc_count: number; page_count: number; first_date: string | null; last_date: string | null;
    roll_address: string | null; rep_doc: string | null; rep_page: number | null;
  }>(
    `SELECT p.id,p.kind,p.key,p.label,
       count(DISTINCT pp.doc)::int doc_count, count(*)::int page_count,
       min(dt.first_date) first_date, max(dt.last_date) last_date,
       max(bf.address) roll_address,
       (array_agg(pp.doc ORDER BY pp.confidence DESC NULLS LAST,pp.doc,pp.page))[1] rep_doc,
       (array_agg(pp.page ORDER BY pp.confidence DESC NULLS LAST,pp.doc,pp.page))[1] rep_page
     FROM site.places p
     JOIN site.place_pages pp ON pp.place_id=p.id
     JOIN site.documents d ON d.doc=pp.doc
     LEFT JOIN LATERAL (SELECT min(value) first_date,max(value) last_date
       FROM jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) v(value) WHERE v.value ~ '^\\d{4}-\\d{2}-\\d{2}$') dt ON true
     LEFT JOIN site.building_facts bf ON (p.kind='bbl' AND bf.bbl=p.key) OR (p.kind='bin' AND bf.bin=p.key)
     WHERE ${ACTIVE} AND pp.contaminants ? $1
       AND (NOT $2 OR pp.has_test)
       AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) v
         WHERE v ~ '^\\d{4}-\\d{2}-\\d{2}$' AND v >= $3 AND v < $4))
     GROUP BY p.id
     ORDER BY page_count DESC, p.id
     LIMIT ${MAX_LIST_ROWS}`,
    [substance, p.resultOnly, from, to],
  );
  const cites = await citesFor(rows.map((r) => ({ doc: r.rep_doc, page: r.rep_page })));
  const out: ListRow[] = rows.map((r) => ({
    key: r.id,
    label: r.roll_address || r.label,
    href: buildingUrl(r),
    extra: [],
    docCount: r.doc_count,
    pageCount: r.page_count,
    firstDate: r.first_date,
    lastDate: r.last_date,
    cite: cites.get(citeKey(r.rep_doc, r.rep_page) ?? '') ?? null,
  }));
  return { kind: 'buildings_by_substance', title: LIST_SPECS.buildings_by_substance.describe(p), extraColumnLabels: [], rows: out, truncated: out.length >= MAX_LIST_ROWS };
}

// --- 2 & 7: labs / substances by building (same jsonb-array-column shape) --------------------

async function jsonbColumnByBuilding(
  kind: 'labs_by_building' | 'substances_by_building',
  column: 'labs' | 'contaminants',
  entityType: 'lab' | 'substance',
  p: ListPlanLike,
): Promise<ListResult> {
  const places = await resolveBuildingPlaces(p.filters.address, p.filters.bin);
  const title = places[0]
    ? LIST_SPECS[kind].describe({ ...p, filters: { ...p.filters, address: places[0].label } })
    : LIST_SPECS[kind].describe(p);
  if (!places.length) return { kind, title, extraColumnLabels: [], rows: [], truncated: false };
  const ids = places.map((pl) => pl.id);
  const rows = await queryReadSafe<{
    value: string; doc_count: number; page_count: number; first_date: string | null; last_date: string | null;
    rep_doc: string | null; rep_page: number | null; slug: string | null;
  }>(
    `SELECT v.value,
       count(DISTINCT pp.doc)::int doc_count, count(*)::int page_count,
       min(dt.first_date) first_date, max(dt.last_date) last_date,
       (array_agg(pp.doc ORDER BY pp.confidence DESC NULLS LAST,pp.doc,pp.page))[1] rep_doc,
       (array_agg(pp.page ORDER BY pp.confidence DESC NULLS LAST,pp.doc,pp.page))[1] rep_page,
       max(el.slug) slug
     FROM site.place_pages pp
     JOIN site.documents d ON d.doc=pp.doc
     CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(pp.${column},'[]'::jsonb)) v(value)
     LEFT JOIN LATERAL (SELECT min(value) first_date,max(value) last_date
       FROM jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) dv(value) WHERE dv.value ~ '^\\d{4}-\\d{2}-\\d{2}$') dt ON true
     LEFT JOIN site.entities el ON el.type=$2 AND upper(el.label)=upper(v.value)
     WHERE ${ACTIVE} AND pp.place_id = ANY($1::text[]) AND v.value <> ''
     GROUP BY v.value
     ORDER BY page_count DESC, v.value
     LIMIT ${MAX_LIST_ROWS}`,
    [ids, entityType],
  );
  const cites = await citesFor(rows.map((r) => ({ doc: r.rep_doc, page: r.rep_page })));
  const out: ListRow[] = rows.map((r) => ({
    key: r.value,
    label: r.value,
    href: r.slug ? entityHref(entityType, r.slug) : null,
    extra: [],
    docCount: r.doc_count,
    pageCount: r.page_count,
    firstDate: r.first_date,
    lastDate: r.last_date,
    cite: cites.get(citeKey(r.rep_doc, r.rep_page) ?? '') ?? null,
  }));
  return { kind, title, extraColumnLabels: [], rows: out, truncated: out.length >= MAX_LIST_ROWS };
}

// --- 3. labs_by_substance ----------------------------------------------------------------------

async function labsBySubstance(p: ListPlanLike): Promise<ListResult> {
  const substance = p.filters.contaminant.toLowerCase();
  const rows = await queryReadSafe<{
    value: string; doc_count: number; page_count: number; first_date: string | null; last_date: string | null;
    rep_doc: string | null; rep_page: number | null; slug: string | null;
  }>(
    `SELECT v.value,
       count(DISTINCT pp.doc)::int doc_count, count(*)::int page_count,
       min(dt.first_date) first_date, max(dt.last_date) last_date,
       (array_agg(pp.doc ORDER BY pp.confidence DESC NULLS LAST,pp.doc,pp.page))[1] rep_doc,
       (array_agg(pp.page ORDER BY pp.confidence DESC NULLS LAST,pp.doc,pp.page))[1] rep_page,
       max(el.slug) slug
     FROM site.place_pages pp
     JOIN site.documents d ON d.doc=pp.doc
     CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(pp.labs,'[]'::jsonb)) v(value)
     LEFT JOIN LATERAL (SELECT min(value) first_date,max(value) last_date
       FROM jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) dv(value) WHERE dv.value ~ '^\\d{4}-\\d{2}-\\d{2}$') dt ON true
     LEFT JOIN site.entities el ON el.type='lab' AND upper(el.label)=upper(v.value)
     WHERE ${ACTIVE} AND pp.contaminants ? $1 AND v.value <> ''
     GROUP BY v.value
     ORDER BY page_count DESC, v.value
     LIMIT ${MAX_LIST_ROWS}`,
    [substance],
  );
  const cites = await citesFor(rows.map((r) => ({ doc: r.rep_doc, page: r.rep_page })));
  const out: ListRow[] = rows.map((r) => ({
    key: r.value,
    label: r.value,
    href: r.slug ? entityHref('lab', r.slug) : null,
    extra: [],
    docCount: r.doc_count,
    pageCount: r.page_count,
    firstDate: r.first_date,
    lastDate: r.last_date,
    cite: cites.get(citeKey(r.rep_doc, r.rep_page) ?? '') ?? null,
  }));
  return { kind: 'labs_by_substance', title: LIST_SPECS.labs_by_substance.describe(p), extraColumnLabels: [], rows: out, truncated: out.length >= MAX_LIST_ROWS };
}

// --- 4. contractors_by_building --------------------------------------------------------------

async function contractorsByBuilding(p: ListPlanLike): Promise<ListResult> {
  const places = await resolveBuildingPlaces(p.filters.address, p.filters.bin);
  const title = places[0]
    ? LIST_SPECS.contractors_by_building.describe({ ...p, filters: { ...p.filters, address: places[0].label } })
    : LIST_SPECS.contractors_by_building.describe(p);
  if (!places.length) return { kind: 'contractors_by_building', title, extraColumnLabels: [], rows: [], truncated: false };
  const ids = places.map((pl) => pl.id);
  const rows = await queryReadSafe<{
    id: string; slug: string; label: string; first_date: string | null; last_date: string | null;
    doc_count: number; page_count: number; rep_doc: string | null; rep_page: number | null;
  }>(
    `SELECT e.id,e.slug,e.label,e.first_date,e.last_date,
       count(DISTINCT ep.doc)::int doc_count, count(DISTINCT (ep.doc,ep.page))::int page_count,
       (array_agg(ep.doc ORDER BY ep.confidence DESC NULLS LAST,ep.doc,ep.page))[1] rep_doc,
       (array_agg(ep.page ORDER BY ep.confidence DESC NULLS LAST,ep.doc,ep.page))[1] rep_page
     FROM site.entity_pages ep
     JOIN site.entities e ON e.id=ep.entity_id AND e.type='contractor'
     JOIN site.documents d ON d.doc=ep.doc
     WHERE ${ACTIVE} AND EXISTS (SELECT 1 FROM site.place_pages pp WHERE pp.doc=ep.doc AND pp.page=ep.page AND pp.place_id = ANY($1::text[]))
     GROUP BY e.id
     ORDER BY page_count DESC, e.label
     LIMIT ${MAX_LIST_ROWS}`,
    [ids],
  );
  const cites = await citesFor(rows.map((r) => ({ doc: r.rep_doc, page: r.rep_page })));
  const out: ListRow[] = rows.map((r) => ({
    key: r.id,
    label: r.label,
    href: entityHref('contractor', r.slug),
    extra: [],
    docCount: r.doc_count,
    pageCount: r.page_count,
    firstDate: r.first_date,
    lastDate: r.last_date,
    cite: cites.get(citeKey(r.rep_doc, r.rep_page) ?? '') ?? null,
  }));
  return { kind: 'contractors_by_building', title, extraColumnLabels: [], rows: out, truncated: out.length >= MAX_LIST_ROWS };
}

// --- 5. documents_by_type ----------------------------------------------------------------------

async function documentsByType(p: ListPlanLike): Promise<ListResult> {
  const from = isoOrNull(p.filters.dateFrom);
  const to = toExclusive(p.filters.dateTo);
  // Agency free text ("DEP") rarely equals documents.agency's spelled-out City string
  // ("Environmental Protection, Dept. of") — same fragility lib/ask/retrieve.ts documents — so this
  // also accepts a match against any 'agency'-typed entity mentioned on the document (entities.py's
  // canonicalisation keeps common abbreviations like "DEP" as their own entity).
  const agencyPattern = p.filters.agency ? `%${p.filters.agency.replace(/[\\%_]/g, '\\$&')}%` : null;
  const rows = await queryReadSafe<{
    doc: string; agency: string | null; box: string | null; folder: string | null; volume: string | null;
    doc_type: string | null; first_seen: string | null; first_date: string | null; last_date: string | null;
  }>(
    `SELECT d.doc,d.agency,d.box,d.folder,d.volume,d.doc_type,d.first_seen,
       (SELECT min(value) FROM site.place_pages pp CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) v(value)
         WHERE pp.doc=d.doc AND v.value ~ '^\\d{4}-\\d{2}-\\d{2}$') first_date,
       (SELECT max(value) FROM site.place_pages pp CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) v(value)
         WHERE pp.doc=d.doc AND v.value ~ '^\\d{4}-\\d{2}-\\d{2}$') last_date
     FROM site.documents d
     WHERE ${ACTIVE} AND d.doc_type=$1
       AND ($2::text IS NULL OR d.box=$2)
       AND ($3::text IS NULL OR d.agency ILIKE $3 OR EXISTS (
         SELECT 1 FROM site.entity_pages ep JOIN site.entities e ON e.id=ep.entity_id
         WHERE ep.doc=d.doc AND e.type='agency' AND e.label ILIKE $3))
       AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM site.place_pages pp CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) v(value)
         WHERE pp.doc=d.doc AND v.value ~ '^\\d{4}-\\d{2}-\\d{2}$' AND v.value >= $4 AND v.value < $5))
     ORDER BY d.first_seen DESC NULLS LAST, d.doc
     LIMIT ${MAX_LIST_ROWS}`,
    [p.filters.docType, p.filters.box || null, agencyPattern, from, to],
  );
  const cites = await citesFor(rows.map((r) => ({ doc: r.doc, page: 1 })));
  const out: ListRow[] = rows.map((r) => ({
    key: r.doc,
    label: r.folder || r.doc,
    href: `/doc/${encodeURIComponent(r.doc)}`,
    extra: [
      { label: 'Agency', value: r.agency || '—' },
      { label: 'Box', value: r.box || '—' },
    ],
    docCount: 1,
    pageCount: 1,
    firstDate: r.first_date,
    lastDate: r.last_date,
    cite: cites.get(citeKey(r.doc, 1) ?? '') ?? null,
  }));
  return {
    kind: 'documents_by_type',
    title: LIST_SPECS.documents_by_type.describe(p),
    extraColumnLabels: ['Agency', 'Box'],
    rows: out,
    truncated: out.length >= MAX_LIST_ROWS,
  };
}

// --- 6. officials_by_role ----------------------------------------------------------------------

async function officialsByRole(p: ListPlanLike): Promise<ListResult> {
  const pattern = `%${p.filters.role.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await queryReadSafe<{
    id: string; slug: string; title: string; org: string | null; first_date: string | null; last_date: string | null;
    doc_count: number; page_count: number; rep_doc: string | null; rep_page: number | null;
  }>(
    `SELECT s.id,s.slug,COALESCE(NULLIF(s.title,''),'Official signatory') title,s.org,s.first_date,s.last_date,
       count(DISTINCT sp.doc)::int doc_count, count(DISTINCT (sp.doc,sp.page))::int page_count,
       (array_agg(sp.doc ORDER BY sp.confidence DESC NULLS LAST,sp.doc,sp.page))[1] rep_doc,
       (array_agg(sp.page ORDER BY sp.confidence DESC NULLS LAST,sp.doc,sp.page))[1] rep_page
     FROM site.signatories s
     JOIN site.signatory_pages sp ON sp.id=s.id
     JOIN site.documents d ON d.doc=sp.doc
     WHERE ${ACTIVE} AND (COALESCE(NULLIF(s.title,''),'') ILIKE $1 OR COALESCE(s.org,'') ILIKE $1 OR sp.action ILIKE $1)
     GROUP BY s.id
     ORDER BY page_count DESC, title
     LIMIT ${MAX_LIST_ROWS}`,
    [pattern],
  );
  const cites = await citesFor(rows.map((r) => ({ doc: r.rep_doc, page: r.rep_page })));
  const out: ListRow[] = rows.map((r) => ({
    key: r.id,
    label: r.title,
    href: `/signatory/${encodeURIComponent(r.slug)}`,
    extra: [{ label: 'Office', value: r.org || '—' }],
    docCount: r.doc_count,
    pageCount: r.page_count,
    firstDate: r.first_date,
    lastDate: r.last_date,
    cite: cites.get(citeKey(r.rep_doc, r.rep_page) ?? '') ?? null,
  }));
  return {
    kind: 'officials_by_role',
    title: LIST_SPECS.officials_by_role.describe(p),
    extraColumnLabels: ['Office'],
    rows: out,
    truncated: out.length >= MAX_LIST_ROWS,
  };
}

const EXECUTORS: Record<ListKind, (p: ListPlanLike) => Promise<ListResult>> = {
  buildings_by_substance: buildingsBySubstance,
  labs_by_building: (p) => jsonbColumnByBuilding('labs_by_building', 'labs', 'lab', p),
  labs_by_substance: labsBySubstance,
  contractors_by_building: contractorsByBuilding,
  documents_by_type: documentsByType,
  officials_by_role: officialsByRole,
  substances_by_building: (p) => jsonbColumnByBuilding('substances_by_building', 'contaminants', 'substance', p),
};

/** Runs the list plan's executor. Never throws for a missing/empty catalogue entry or an unready
 *  plan (a model slip that emits kind:'list' without the field the listType needs) — both degrade
 *  to an empty, clearly-titled result rather than a 500, matching queryReadSafe's own degrade rule. */
export async function runList(plan: ListPlanLike): Promise<ListResult> {
  if (!isListKind(plan.listType) || !LIST_SPECS[plan.listType].ready(plan)) {
    return { kind: 'buildings_by_substance', title: 'Not enough was specified to build this list', extraColumnLabels: [], rows: [], truncated: false };
  }
  return EXECUTORS[plan.listType](plan);
}

export { docTypeLabel };
