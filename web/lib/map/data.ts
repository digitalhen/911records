import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import footprintJoins from '@/public/geo/joins.json';
import { queryReadSafe } from '@/lib/db';
import { buildVersion } from '@/lib/site';
import { measurementCandidates } from './measurements';
import { buildingUrl, DEFAULT_FILTERS, month, type BuildingFacts, type Candidate, type MapFilters, type Place, type PlaceFile } from './types';

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
 max(pp.confidence) confidence,
 max(bf.address) roll_address, max(ea.label) entity_address`;
// Title resolution (#20 follow-up, Henry 2026-09-14): a BIN/BBL place titled itself "BIN 1000836"
// whenever no source page happened to carry a regex-shaped address string. `ea` is the most-cited
// roll-matched address entity for this place's BIN/BBL (or, for an address-kind place, the entity
// matching its own raw text); `bf` is the roll's own address for that BIN/BBL, preferred when present.
const joins = `FROM site.places p JOIN site.place_pages pp ON pp.place_id=p.id
 JOIN site.documents d ON d.doc=pp.doc JOIN site.pages pg ON pg.doc=pp.doc AND pg.page=pp.page
 LEFT JOIN site.page_text t ON t.doc=pp.doc AND t.page=pp.page
 LEFT JOIN LATERAL (SELECT min(value) first_date,max(value) last_date
 FROM jsonb_array_elements_text(coalesce(pp.dates,'[]'::jsonb)) WHERE value ~ '^\\d{4}-\\d{2}-\\d{2}$') dt ON true
 LEFT JOIN LATERAL (SELECT e.label,e.bbl,e.bin FROM site.entities e WHERE e.type='address' AND (
   (p.kind='address' AND upper(e.label)=upper(p.key)) OR
   (p.kind='bin' AND e.bin=p.key) OR (p.kind='bbl' AND e.bbl=p.key)
 ) ORDER BY e.n_pages DESC,e.id LIMIT 1) ea ON true
 LEFT JOIN LATERAL (SELECT bfx.address FROM site.building_facts bfx WHERE
   (p.kind='bbl' AND bfx.bbl=p.key) OR (p.kind='bin' AND bfx.bin=p.key) OR
   (p.kind='address' AND ea.bin IS NOT NULL AND bfx.bin=ea.bin) OR
   (p.kind='address' AND ea.bbl IS NOT NULL AND bfx.bbl=ea.bbl)
 LIMIT 1) bf ON true`;
// Addresses only: reject free-form building labels and strip any unit/household suffix.
// Label preference, most to least trustworthy: (1) the roll's own address for this BIN/BBL,
// (2) the most-cited roll-matched address entity for it, (3) a regex-shaped address already on
// this place's raw label, (4) a fallback that can never be mistaken for a real address.
type PlaceRow = Place & { roll_address?: string | null; entity_address?: string | null };
function safePlace(row: PlaceRow): Place {
  const { roll_address, entity_address, ...p } = row;
  const regexAddress = /^\d{1,5}(?:-\d{1,5})?\s+(?:(?:[A-Z0-9'-]+\s+){1,4}(?:STREET|ST\.?|AVENUE|AVE\.?|PLACE|PL\.?|PLAZA|LANE|SLIP|ROAD|BOULEVARD|BLVD\.?|DRIVE|WAY|TERRACE|SQUARE)|BROADWAY|BOWERY)\b/i.exec(p.label || '')?.[0];
  const fallback = p.kind === 'bin' ? `Building BIN ${p.key} (address not in the roll)`
    : p.kind === 'bbl' ? `Building Block ${p.key.slice(1,6).replace(/^0+/, '')} · Lot ${p.key.slice(6).replace(/^0+/, '')} (address not in the roll)`
    : 'Building address not in the roll';
  return { ...p, label: roll_address || entity_address || regexAddress || fallback };
}
async function queryMapPlaces(f: MapFilters): Promise<Place[]> {
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
const isDefaultFilters = (f: MapFilters) =>
  f.substance === DEFAULT_FILTERS.substance && f.from === DEFAULT_FILTERS.from &&
  f.to === DEFAULT_FILTERS.to && f.type === DEFAULT_FILTERS.type && f.only === DEFAULT_FILTERS.only;
// Perf (issue #13): the home map's initial (unfiltered) load is the same for every visitor between
// refreshes — cached, keyed by buildVersion(). Any other filter combination (the /api/map route
// used by the panel's live filter controls) stays a plain, uncached read — those are per-query and
// not worth caching individually.
const cachedDefaultMapPlaces = unstable_cache(
  async (_v: string) => queryMapPlaces(DEFAULT_FILTERS),
  ['map-places-default'],
  { revalidate: 60 },
);
export async function getMapPlaces(f: MapFilters = DEFAULT_FILTERS): Promise<Place[]> {
  if (isDefaultFilters(f)) return cachedDefaultMapPlaces(await buildVersion());
  return queryMapPlaces(f);
}
// Address places have no bbl/bin of their own; when the property-roll canonicaliser matched this
// address to an entity, that entity carries the bbl/bin. Never used for anything but building facts
// and the bin-canonicalisation redirect below.
async function addressLink(key: string): Promise<{ bbl: string | null; bin: string | null } | null> {
  const rows = await queryReadSafe<{ bbl: string | null; bin: string | null }>(
    `SELECT bbl,bin FROM site.entities WHERE type='address' AND upper(label)=upper($1) AND (bbl IS NOT NULL OR bin IS NOT NULL) LIMIT 1`,
    [key]);
  return rows[0] ?? null;
}
export async function getBuildingFacts(place: Pick<Place,'kind'|'key'>): Promise<BuildingFacts | null> {
  let bbl = place.kind === 'bbl' ? place.key : null;
  let bin = place.kind === 'bin' ? place.key : null;
  if (place.kind === 'address') {
    const link = await addressLink(place.key);
    bbl = link?.bbl ?? null; bin = link?.bin ?? null;
  }
  if (!bbl && !bin) return null;
  const rows = await queryReadSafe<BuildingFacts>(
    `SELECT bbl,bin,year_built,num_floors,units_res,units_total,bldg_area,bldg_class,num_bldgs,source
     FROM site.building_facts WHERE ($1::text IS NOT NULL AND bbl=$1) OR ($2::text IS NOT NULL AND bin=$2) LIMIT 1`,
    [bbl, bin]);
  return rows[0] ?? null;
}
// Canonicalisation for #25: a bbl:/address: place that has a present-day BIN which itself resolves
// to an indexed place (source pages exist under that BIN) should redirect there — one URL per
// building rather than one per identifier kind. Never redirects to a BIN with no records of its own.
export async function resolveBuildingRedirect(place: Pick<Place, 'kind' | 'key'>): Promise<string | null> {
  if (place.kind === 'bin') return null;
  let candidates: string[] = [];
  if (place.kind === 'bbl') {
    // A footprint's BIN can span several BBLs (and one BBL can appear under more than one nearby
    // footprint entry); check every candidate BIN, not just the first, and only redirect to one
    // that actually resolves (has records of its own).
    const target = `bbl:${place.key}`;
    candidates = Object.entries(footprintJoins as Record<string, string[]>).filter(([, ids]) => ids.includes(target)).map(([bin]) => bin);
  } else if (place.kind === 'address') {
    const bin = (await addressLink(place.key))?.bin ?? null;
    if (bin) candidates = [bin];
  }
  for (const bin of candidates) {
    const target = await getPlaceFile(bin);
    if (target) return target.place.key;
  }
  return null;
}
// Perf (issue #13): one building page is the same for every visitor between refreshes — cached,
// keyed by (buildVersion(), id). The outer React cache() still dedupes repeat calls for the same
// id within one request (resolveBuildingRedirect above calls this per BIN candidate).
const cachedPlaceFile = unstable_cache(
  async (_v: string, id: string) => queryPlaceFile(id),
  ['map-place-file'],
  { revalidate: 60 },
);
export const getPlaceFile = cache(async (id: string): Promise<PlaceFile | null> => cachedPlaceFile(await buildVersion(), id));
async function queryPlaceFile(id: string): Promise<PlaceFile | null> {
  const places = await queryReadSafe<Place>(`SELECT ${columns} ${joins} WHERE ${active}
    AND (p.id=$1 OR (p.kind='bin' AND p.key=$1)) GROUP BY p.id ORDER BY p.id LIMIT 1`,[id]);
  if (!places[0]) return null;
  const place = safePlace(places[0]);
  const facts = await getBuildingFacts(place);
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
  return { place, rows, related: related.map(safePlace), facts };
}
function strings(v: unknown): string[] { return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []; }
// Perf (issue #13): the "suggested" building/substance for the home map are the same for every
// visitor between refreshes — cached, keyed by buildVersion().
const cachedSuggestions = unstable_cache(
  async (_v: string) => {
    const [places, substances] = await Promise.all([
      queryReadSafe<Place>(`SELECT ${columns} ${joins} WHERE ${active} AND p.id=(SELECT x.place_id FROM site.place_pages x JOIN site.documents d ON d.doc=x.doc WHERE ${active} AND x.has_test GROUP BY x.place_id ORDER BY count(*) DESC,x.place_id LIMIT 1) GROUP BY p.id`),
      queryReadSafe<{label: string; doc: string; page: number}>(`SELECT e.label,source.doc,source.page FROM site.entities e JOIN LATERAL (SELECT ep.doc,ep.page FROM site.entity_pages ep JOIN site.documents d ON d.doc=ep.doc WHERE ep.entity_id=e.id AND ${active} ORDER BY ep.doc,ep.page LIMIT 1) source ON true WHERE e.type IN ('contaminant','substance') ORDER BY e.n_pages DESC LIMIT 1`),
    ]);
    const p = places[0] ? safePlace(places[0]) : null;
    return { place: p, substance: substances[0]?.label || null, substanceSource: substances[0] ? {doc:substances[0].doc,page:substances[0].page} : null };
  },
  ['map-suggestions'],
  { revalidate: 60 },
);
export async function getSuggestions() {
  return cachedSuggestions(await buildVersion());
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
// Only canonical, resolving URLs (#25): a bbl:/address: place that canonicalises to a BIN is
// listed under that BIN (deduped against the BIN's own row, if it also has records) instead of
// under its own identifier.
export async function buildingSitemapEntries(): Promise<Pick<Place, 'id' | 'key' | 'kind'>[]> {
  const rows = await queryReadSafe<Pick<Place, 'id' | 'key' | 'kind'>>(`SELECT p.id,p.key,p.kind FROM site.places p WHERE EXISTS
    (SELECT 1 FROM site.place_pages pp JOIN site.documents d ON d.doc=pp.doc WHERE pp.place_id=p.id AND ${active}) ORDER BY p.id`);
  const seen = new Set<string>();
  const out: Pick<Place, 'id' | 'key' | 'kind'>[] = [];
  for (const row of rows) {
    let entry = row;
    if (row.kind !== 'bin') {
      const bin = await resolveBuildingRedirect(row);
      if (bin) entry = { id: `bin:${bin}`, key: bin, kind: 'bin' };
    }
    const url = buildingUrl(entry);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(entry);
  }
  return out;
}
