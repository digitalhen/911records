import 'server-only';
import { cache } from 'react';
import footprintJoins from '@/public/geo/joins.json';
import { queryReadSafe } from '@/lib/db';
import { measurementCandidates } from './measurements';
import { DEFAULT_FILTERS, month, type Candidate, type MapFilters, type Place, type PlaceFile } from './types';

// Only the place schema and non-person entity types are projected. Never expose page text.
const inspection = `(coalesce(t.text,'') ~* '\\m(inspection report|inspection date|date of inspection|building inspection)\\M')`;
const footprintIds = [...new Set(Object.values(footprintJoins).flat())];
const active = `d.status IS DISTINCT FROM 'removed'`;
const columns = `p.id,p.kind,p.key,p.label,p.lat,p.lon,
 count(DISTINCT pp.doc)::int n_docs,count(*)::int n_pages,
 count(*) FILTER (WHERE pp.has_test)::int n_test_pages,
 count(*) FILTER (WHERE ${inspection})::int n_inspection_pages,
 min(dt.first_date) first_date,max(dt.last_date) last_date,
 (array_agg(pp.doc ORDER BY pp.confidence DESC NULLS LAST,pp.doc,pp.page))[1] doc,
 (array_agg(pp.page ORDER BY pp.confidence DESC NULLS LAST,pp.doc,pp.page))[1] page,
 max(pp.confidence) confidence`;
const joins = `FROM site.places p JOIN site.place_pages pp ON pp.place_id=p.id
 JOIN site.documents d ON d.doc=pp.doc JOIN site.pages pg ON pg.doc=pp.doc AND pg.page=pp.page
 LEFT JOIN site.page_text t ON t.doc=pp.doc AND t.page=pp.page
 LEFT JOIN LATERAL (SELECT min(value) first_date,max(value) last_date
 FROM jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) WHERE value ~ '^\\d{4}-\\d{2}-\\d{2}$') dt ON true`;
// Addresses only: reject free-form building labels and strip any unit/household suffix.
function safePlace(p: Place): Place {
  const address = /^\d{1,5}(?:-\d{1,5})?\s+(?:(?:[A-Z0-9'-]+\s+){1,4}(?:STREET|ST\.?|AVENUE|AVE\.?|PLACE|PL\.?|PLAZA|LANE|SLIP|ROAD|BOULEVARD|BLVD\.?|DRIVE|WAY|TERRACE|SQUARE)|BROADWAY|BOWERY)\b/i.exec(p.label || '');
  return { ...p, label: address?.[0] || (p.kind === 'bin' ? `BIN ${p.key}` : p.kind === 'bbl' ? `Block ${p.key.slice(1,6).replace(/^0+/, '')} · Lot ${p.key.slice(6).replace(/^0+/, '')}` : 'Building address in the source record') };
}
export async function getMapPlaces(f: MapFilters = DEFAULT_FILTERS): Promise<Place[]> {
  const dateFilter = f.from !== 0 || f.to !== 27;
  const rows = await queryReadSafe<Place>(`SELECT ${columns} ${joins} WHERE ${active}
    AND ((p.lat IS NOT NULL AND p.lon IS NOT NULL) OR p.id=ANY($7::text[]))
    AND ($1='' OR pp.contaminants ? $1)
    AND (NOT $2 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) v WHERE v >= $3 AND v < $4))
    AND (NOT $5 OR pp.has_test)
    AND ($6='' OR ($6='test' AND pp.has_test) OR ($6='inspection' AND ${inspection}) OR ($6='mention' AND NOT pp.has_test AND NOT ${inspection}))
    GROUP BY p.id ORDER BY n_test_pages DESC,p.id`, [f.substance,dateFilter,`${month(f.from)}-01`,`${month(f.to+1)}-01`,f.only,f.type,footprintIds]);
  return rows.map(safePlace);
}
export const getPlaceFile = cache(async (id: string): Promise<PlaceFile | null> => {
  const places = await queryReadSafe<Place>(`SELECT ${columns} ${joins} WHERE ${active}
    AND (p.id=$1 OR (p.kind='bin' AND p.key=$1)) GROUP BY p.id ORDER BY p.id LIMIT 1`,[id]);
  if (!places[0]) return null;
  const place = safePlace(places[0]);
  const raw = await queryReadSafe<Candidate & { text: string | null }>(`SELECT pp.doc,pp.page,d.agency,d.box,d.volume,
    pp.has_test,${inspection} inspection,pp.contaminants,pp.units,pp.dates,pp.labs,pp.confidence,t.text
    ${joins} WHERE ${active} AND p.id=$1 ORDER BY dt.first_date NULLS LAST,pp.doc,pp.page`,[place.id]);
  const rows = raw.map(({text, ...r}) => ({ ...r,
    contaminants: strings(r.contaminants), units: strings(r.units), dates: strings(r.dates).filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)),
    labs: strings(r.labs).filter(v => /\b(laborator(?:y|ies)|labs?|analytical|testing)\b/i.test(v)),
    measurements: measurementCandidates(text),
  }));
  // Resolve BIN -> BBL using the bundled present-day footprint join; never use BIN prefixes.
  const joined = footprintJoins as Record<string,string[]>;
  const blocks = place.kind === 'bbl' ? [place.key.slice(0,6)] : (joined[place.key] || []).filter(id=>id.startsWith('bbl:')).map(id=>id.slice(4,10));
  const bins = Object.entries(joined).filter(([,ids])=>ids.some(id=>id.startsWith('bbl:') && blocks.includes(id.slice(4,10)))).map(([bin])=>bin);
  const related = blocks.length ? await queryReadSafe<Place>(`SELECT ${columns} ${joins}
    WHERE ${active} AND ((p.kind='bbl' AND left(p.key,6)=ANY($1::text[])) OR (p.kind='bin' AND p.key=ANY($2::text[])))
    AND p.id<>$3 GROUP BY p.id ORDER BY n_pages DESC LIMIT 12`,[blocks,bins,place.id]) : [];
  return { place, rows, related: related.map(safePlace) };
});
function strings(v: unknown): string[] { return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []; }
export async function getSuggestions() {
  const [places, substances] = await Promise.all([
    queryReadSafe<Place>(`SELECT ${columns} ${joins} WHERE ${active} AND p.id=(SELECT x.place_id FROM site.place_pages x JOIN site.documents d ON d.doc=x.doc WHERE ${active} AND x.has_test GROUP BY x.place_id ORDER BY count(*) DESC,x.place_id LIMIT 1) GROUP BY p.id`),
    queryReadSafe<{label: string; doc: string; page: number}>(`SELECT e.label,source.doc,source.page FROM site.entities e JOIN LATERAL (SELECT ep.doc,ep.page FROM site.entity_pages ep JOIN site.documents d ON d.doc=ep.doc WHERE ep.entity_id=e.id AND ${active} ORDER BY ep.doc,ep.page LIMIT 1) source ON true WHERE e.type IN ('contaminant','substance') ORDER BY e.n_pages DESC LIMIT 1`),
  ]);
  const p = places[0] ? safePlace(places[0]) : null;
  return { place: p, substance: substances[0]?.label || null, substanceSource: substances[0] ? {doc:substances[0].doc,page:substances[0].page} : null };
}
export async function getSubstances(): Promise<string[]> {
  const rows = await queryReadSafe<{ substance: string }>(`SELECT DISTINCT value substance FROM site.place_pages pp
    JOIN site.documents d ON d.doc=pp.doc CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(pp.contaminants,'[]'::jsonb)) WHERE ${active} ORDER BY substance`);
  return rows.map(r=>r.substance);
}
export async function buildingsForDoc(doc: string): Promise<Place[]> {
  const rows = await queryReadSafe<Place>(`SELECT ${columns} ${joins} WHERE ${active} AND pp.doc=$1 GROUP BY p.id ORDER BY p.label`,[doc]);
  return rows.map(safePlace);
}
export async function buildingSitemapEntries() {
  return queryReadSafe<Pick<Place,'id'|'key'|'kind'>>(`SELECT p.id,p.key,p.kind FROM site.places p WHERE EXISTS
    (SELECT 1 FROM site.place_pages pp JOIN site.documents d ON d.doc=pp.doc WHERE pp.place_id=p.id AND ${active}) ORDER BY p.id`);
}
