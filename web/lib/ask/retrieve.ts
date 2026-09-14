// Deterministic retrieval for a "question"-kind AskPlan: OpenSearch hybrid
// search over the plan's terms and filters, then an excerpt built from
// site.page_text (never from the OpenSearch snippet, which is unrelated
// text) for each of the best pages. No model call happens in this file.
import { search, type SearchFilters, type SearchHit } from '../opensearch';
import { getPageText } from '../site';
import type { AskFilters } from './plan';

export const MAX_RETRIEVED_PAGES = 12;
const EXCERPT_MAX_CHARS = 600;

export interface RetrievedPage {
  doc: string;
  page: number;
  batesPage: string;
  agency: string | null;
  box: string | null;
  folder: string | null;
  volume: string | null;
  /** Up to EXCERPT_MAX_CHARS of site.page_text, centered on the best term match. */
  excerpt: string;
  score: number;
}

/**
 * AskFilters (model-generated free text) -> opensearch.ts's SearchFilters.
 *
 * Only `contaminant` becomes a hard `term` filter: the index's `contaminants`
 * field is a short, reliably-lowercased vocabulary ("asbestos", "lead") that
 * the model's own phrasing usually matches. `agency`, `address` and `lab`
 * are exact-match keyword fields storing the CITY'S OWN formatting
 * ("Environmental Protection, Dept. of", "114 LIBERTY STREET",
 * "ENVIRONMENTAL LABORATORIES") — a model saying "DEP" or "Liberty Street"
 * will never equal those strings, and a `term` filter on a near-miss
 * silently returns zero hits instead of a bad-but-present answer. The
 * `/search` facet UI doesn't have this problem (a facet link's value comes
 * FROM the index, so it always matches); Ask's model-generated value does
 * not have that guarantee. So those three, plus any stated date, are folded
 * into the free-text query below as a soft relevance signal instead of a
 * hard filter — a real fix would need an alias normalizer (DEP -> the City's
 * agency string, a street address matcher) shared with lib/opensearch.ts;
 * noted as a follow-up in web/NOTES-B3.md. `bin` has no field in the
 * OpenSearch mapping yet (A2/B5's place-resolution work) and is dropped.
 */
function toSearchFilters(filters: AskFilters): SearchFilters {
  const out: SearchFilters = {};
  if (filters.contaminant) out.contaminant = filters.contaminant.toLowerCase();
  return out;
}

function softFilterTerms(filters: AskFilters): string[] {
  return [filters.address, filters.agency, filters.lab, filters.dateFrom, filters.dateTo].filter(
    (v): v is string => !!v,
  );
}

/** The best-matching span of `text` for any of `terms`, padded to roughly EXCERPT_MAX_CHARS. */
function bestExcerpt(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let bestIdx = -1;
  for (const term of terms) {
    const t = term.trim().toLowerCase();
    if (!t) continue;
    const idx = lower.indexOf(t);
    if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx === -1) return text.slice(0, EXCERPT_MAX_CHARS);
  const half = Math.floor(EXCERPT_MAX_CHARS / 2);
  const start = Math.max(0, bestIdx - half);
  const end = Math.min(text.length, start + EXCERPT_MAX_CHARS);
  return text.slice(start, end);
}

export async function retrieveForQuestion(terms: string[], filters: AskFilters): Promise<RetrievedPage[]> {
  const q = [...terms.filter(Boolean), ...softFilterTerms(filters)].join(' ');
  // allowSemanticOnly: this came from the planner's 'question' kind, not a
  // bare /search box — semantic recall for paraphrased content is wanted
  // even when the exact terms don't appear verbatim (opensearch.ts's
  // "no lexical hit" gate is for the box, not for Ask — B11).
  const result = await search({
    q,
    filters: toSearchFilters(filters),
    page: 1,
    pageSize: MAX_RETRIEVED_PAGES,
    allowSemanticOnly: true,
  });
  if (result.error || !result.hits.length) return [];

  // Cover sheets (issue #28: the City portal's one-page property-lookup separators — address,
  // Block/Lot, BIN, no substantive content) are never cited by Ask — there is nothing on the page
  // to answer a question from. Filtering here (rather than relying on lib/opensearch.ts's ranking
  // penalty alone) keeps a cover sheet out entirely even if it would otherwise have out-scored
  // every content page. `hit.docType` is null for anything the pipeline hasn't classified yet, so
  // this never drops a page for lack of data.
  const contentHits = result.hits.filter((hit) => hit.docType !== 'cover_sheet');

  const pages = await Promise.all(
    contentHits.map(async (hit: SearchHit): Promise<RetrievedPage | null> => {
      const row = await getPageText(hit.doc, hit.page);
      const text = row?.text?.trim();
      if (!text) return null; // no OCR text yet — nothing to cite or write an excerpt from
      return {
        doc: hit.doc,
        page: hit.page,
        batesPage: hit.batesPage,
        agency: hit.agency,
        box: hit.box,
        folder: hit.folder,
        volume: hit.volume,
        excerpt: bestExcerpt(text, terms),
        score: hit.score,
      };
    }),
  );
  return pages.filter((p): p is RetrievedPage => p !== null);
}
