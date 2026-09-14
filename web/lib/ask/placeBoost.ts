import { queryReadSafe } from '../db';
import { resolveBuildingPlaces } from './listExec';
import type { AskFilters } from './plan';
import type { PageRef } from './retrieve';

/** At most this many building pages are pushed into the retrieved set, leaving the other
 *  slots (MAX_RETRIEVED_PAGES = 12) for the text search's own hits. */
const MAX_PLACE_PAGES = 6;

/**
 * Pages the pipeline attributed to the building a question names (site.place_pages —
 * including whole folders attributed via their cover sheet, source='folder').
 *
 * 2026-09-14: the map's "What test records exist for 235-247 GREENWICH ST?" chip produced an
 * answer saying no test records existed — the building's lab reports sit in a folder whose
 * pages never spell the address, so a text search only ever surfaced building lists. Text
 * retrieval can't see folder attribution; this hands it the building's own pages as a boost.
 * Test-candidate pages first, then the pipeline's confidence; cover sheets and pages without
 * text are skipped (nothing to cite).
 */
export interface PlaceBoost { label: string; refs: PageRef[] }
const NONE: PlaceBoost = { label: '', refs: [] };
export async function placePagesForQuestion(filters: AskFilters, q = ''): Promise<PlaceBoost> {
  // The planner usually fills filters.address; if it didn't, a street address written in the
  // question itself still counts (a map chip is always "… for <address>?").
  const address = filters.address || addressInText(q);
  if (!address && !filters.bin) return NONE;
  const places = await resolveBuildingPlaces(address, filters.bin);
  if (!places.length) return NONE;
  const rows = await queryReadSafe<PageRef>(
    `SELECT x.doc, x.page, pg.bates AS "batesPage", d.agency, d.box, d.folder, d.volume
       FROM site.place_pages x
       JOIN site.documents d ON d.doc = x.doc
       JOIN site.pages pg ON pg.doc = x.doc AND pg.page = x.page
      WHERE x.place_id = ANY($1)
        AND d.status IS DISTINCT FROM 'removed'
        AND coalesce(d.doc_type, '') <> 'cover_sheet'
        AND coalesce(pg.chars, 0) > 0
      ORDER BY x.has_test DESC, x.confidence DESC NULLS LAST, x.doc, x.page
      LIMIT $2`,
    [places.map((p) => p.id), MAX_PLACE_PAGES],
  );
  return { label: places[0]!.label, refs: rows.filter((r) => r.batesPage) };
}

const ADDRESS_RE = /\b\d{1,5}(?:-\d{1,5})?[A-Z]?\s+(?:[A-Z][A-Z.]*\s+){1,3}(?:ST|STREET|AVE|AVENUE|PL|PLACE|RD|ROAD|BLVD|BOULEVARD|LN|LANE|DR|DRIVE|SQ|SQUARE|BROADWAY|WAY|PLAZA|SLIP|ROW|TERRACE)\b\.?/i;
export function addressInText(q: string): string {
  const m = ADDRESS_RE.exec(q);
  return m ? m[0].trim() : '';
}
