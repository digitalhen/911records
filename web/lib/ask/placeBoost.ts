import { queryReadSafe } from '../db';
import { search } from '../opensearch';
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
export async function placePagesForQuestion(filters: AskFilters, q = '', terms: string[] = [], priorTerms: string[] = []): Promise<PlaceBoost> {
  // The planner usually fills filters.address; if it didn't, a street address written in the
  // question itself still counts (a map chip is always "… for <address>?").
  const address = filters.address || addressInText(q);
  if (!address && !filters.bin) return NONE;
  const places = await resolveBuildingPlaces(address, filters.bin);
  if (!places.length) return NONE;
  const label = places[0]!.label;
  // 2026-09-14: "What was the final cost … for cleaning 114 Liberty Street apartments?" came back
  // empty although the building's folder holds a "Total Cost" addendum and a Comptroller letter —
  // the test-pages-first ordering below never reaches them. So first run the question's own terms
  // as a search restricted to the building's documents; fall back to the ordering only when that
  // finds nothing.
  const docRows = await queryReadSafe<{ doc: string }>(
    `SELECT DISTINCT x.doc FROM site.place_pages x JOIN site.documents d ON d.doc = x.doc
      WHERE x.place_id = ANY($1) AND d.status IS DISTINCT FROM 'removed' AND coalesce(d.doc_type, '') <> 'cover_sheet'
      LIMIT 1000`,
    [places.map((p) => p.id)],
  );
  // Inside one building's folder the words that describe the folder itself ("cleaning",
  // "apartments", "decontamination") are on almost every page and drown the words that
  // distinguish the question ("cost", "contract amount" — measured 2026-09-14 on 114 Liberty
  // Street). So search first with the terms this question ADDED over the prior turn, then with
  // every term, and keep the added-term hits in front.
  const norm = (t: string) => t.trim().toLowerCase();
  const prior = new Set(priorTerms.map(norm));
  const allTerms = terms.filter(Boolean).filter((t) => norm(t) !== norm(address));
  const newTerms = allTerms.filter((t) => !prior.has(norm(t)));
  if (docRows.length && allTerms.length) {
    const docs = docRows.map((r) => r.doc);
    const queries = newTerms.length && newTerms.length < allTerms.length ? [newTerms, allTerms] : [allTerms];
    const refs: PageRef[] = [];
    const seen = new Set<string>();
    for (const qt of queries) {
      const scoped = await search({ q: qt.join(' '), filters: { docs }, page: 1, pageSize: MAX_PLACE_PAGES, allowSemanticOnly: true });
      for (const h of scoped.hits) {
        if (seen.has(h.batesPage) || refs.length >= MAX_PLACE_PAGES) continue;
        seen.add(h.batesPage);
        refs.push({ doc: h.doc, page: h.page, batesPage: h.batesPage, agency: h.agency, box: h.box, folder: h.folder, volume: h.volume });
      }
    }
    if (refs.length) return { label, refs };
  }
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
  return { label, refs: rows.filter((r) => r.batesPage) };
}

const ADDRESS_RE = /\b\d{1,5}(?:-\d{1,5})?[A-Z]?\s+(?:[A-Z][A-Z.]*\s+){1,3}(?:ST|STREET|AVE|AVENUE|PL|PLACE|RD|ROAD|BLVD|BOULEVARD|LN|LANE|DR|DRIVE|SQ|SQUARE|BROADWAY|WAY|PLAZA|SLIP|ROW|TERRACE)\b\.?/i;
export function addressInText(q: string): string {
  const m = ADDRESS_RE.exec(q);
  return m ? m[0].trim() : '';
}
