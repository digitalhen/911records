// Client for the OpenSearch index built by scripts/search/opensearch.py.
// Mapping, pipeline name and field names here must track that file — see its
// header comment for the authoritative schema. Local network call only.
import { embedQuery } from './embed';
import { BATES_RE } from './bates';

const OPENSEARCH_URL = process.env.OPENSEARCH_URL || 'http://127.0.0.1:9200';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER;
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD;
export const INDEX = process.env.OPENSEARCH_INDEX || 'sept11-pages-v1';
const PIPELINE = process.env.OPENSEARCH_PIPELINE || 'sept11-hybrid';

const HL_OPEN = '';
const HL_CLOSE = '';

// The "_english_" predefined stop word list — exactly what
// scripts/search/opensearch.py's mapping gives OpenSearch's built-in
// "english" analyzer for the `text` field (see its header comment). Kept in
// sync by hand: OpenSearch has no endpoint that hands this list back.
const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'if', 'in', 'into', 'is', 'it',
  'no', 'not', 'of', 'on', 'or', 'such', 'that', 'the', 'their', 'then', 'there', 'these',
  'they', 'this', 'to', 'was', 'will', 'with',
]);

// The analyzer's own list (above) is a BM25/indexing stopword list — by
// design it does not touch pronouns or auxiliaries ("you", "do", "like"
// are real, indexed tokens to it). That's exactly why "do you like jesus"
// hit /search and highlighted "you" on nearly every page (B11): "you" is
// common enough in correspondence OCR to match almost every document, and
// the highlighter reflects whatever the query contains. So the *query-text*
// noise list used here is deliberately wider than the analyzer's own —
// mirrors lib/ask/router.ts's FLAGGED_WORDS (same words, same reason: they
// carry no search-relevant content on their own).
const QUERY_NOISE_WORDS = new Set([
  ...ENGLISH_STOPWORDS,
  'do', 'does', 'did', 'can', 'could', 'should', 'would',
  'what', 'who', 'whom', 'why', 'how', 'when', 'where', 'which', 'like',
  'you', 'your', 'i', 'me', 'my', 'we',
]);

/** The words of `text` that carry search-relevant content — see QUERY_NOISE_WORDS above. */
function contentTerms(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
    .filter((t) => t && !QUERY_NOISE_WORDS.has(t.toLowerCase()));
}

function authHeaders(): Record<string, string> {
  if (!OPENSEARCH_USER) return {};
  const token = Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD || ''}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

async function call(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OPENSEARCH_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(`OpenSearch ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export interface SearchFilters {
  agency?: string;
  source?: string;
  box?: string;
  folder?: string;
  volume?: string;
  contaminant?: string;
  lab?: string;
  address?: string;
  year?: string;
  /** Restrict to these document ids (lib/ask/placeBoost.ts: search inside one building's own records). */
  docs?: string[];
}

export interface FacetBucket {
  key: string;
  count: number;
}

export interface SearchHit {
  doc: string;
  page: number;
  batesPage: string;
  agency: string | null;
  source: string | null;
  box: string | null;
  folder: string | null;
  volume: string | null;
  ocrStatus: string | null;
  contaminants: string[];
  score: number;
  /** HTML-safe fragment with <mark> already applied — see renderSnippet below. */
  snippetHtml: string | null;
  /** Rule-based document type (issue #28, scripts/embed/doctypes.py), when the index has classified
   *  this page's document — null before that pipeline has run over it, or before the field exists
   *  in the mapping at all. */
  docType: string | null;
  /** Plain-language document title (issue #37, scripts/embed/summaries.py), when the index has
   *  named this page's document — null before that pipeline has run over it, before the field
   *  exists in the mapping at all, or when the document was privacy-rejected with nothing safe to
   *  show. Used as the result heading in place of the bare folder label/Bates number. */
  docTitle: string | null;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  tookMs: number;
  facets: Record<string, FacetBucket[]>;
  semantic: boolean;
  semanticError?: string;
  exactBates?: { doc: string; page: number; batesPage: string } | null;
  error?: string;
  /** q was non-empty but every token is an english-analyzer stopword — nothing to search on. */
  noSearchableTerms?: boolean;
  /** Content terms remained, but none of them literally appear in any page — the semantic arm was gated off. */
  noLexicalMatch?: boolean;
  /** Folder cover sheets matching this query, hidden from `hits`/`total` unless
   *  `SearchOptions.includeCoverSheets` was set — see withCoverSheetHandling. 0 when
   *  includeCoverSheets is true (nothing was hidden to count). */
  hiddenCoverSheets?: number;
}

const MULTI_MATCH_FIELDS = ['text', 'text.exact^0.5', 'folder.text^0.3'];

/**
 * Cover sheets (issue #28: the City portal's one-page property-lookup separators — address,
 * Block/Lot, BIN, no content of their own) rank below content pages: a 0.5x score multiplier
 * whenever `doc_type` = 'cover_sheet'. A `term` filter on a field OpenSearch doesn't know about
 * yet — before scripts/search/opensearch.py's mapping update has landed, or before
 * scripts/embed/doctypes.py has classified anything — matches nothing and never errors, so this
 * degrades to a no-op rather than a broken search (schema-first, docs/briefs/COMMON-web.md).
 */
function withCoverSheetPenalty(query: Record<string, unknown>): Record<string, unknown> {
  return {
    function_score: {
      query,
      functions: [{ filter: { term: { doc_type: 'cover_sheet' } }, weight: 0.5 }],
      boost_mode: 'multiply',
    },
  };
}

const COVER_SHEET_TERM = { term: { doc_type: 'cover_sheet' } };

/**
 * Cover sheets are hidden from search results entirely by default (Henry: "I thought we were
 * hiding the cover pages") — a facet toggle on /search (`SearchOptions.includeCoverSheets`) can
 * turn them back on, in which case they fall back to the same 0.5x ranking penalty as before
 * rather than being mixed in at full weight. The exclusion is baked into the query itself (not a
 * post_filter) so the facet aggregations below also reflect the hidden-by-default universe. Same
 * schema-first degrade as withCoverSheetPenalty above: a `term` filter on a field the index
 * doesn't have yet just matches nothing, never errors.
 */
function withCoverSheetHandling(query: Record<string, unknown>, includeCoverSheets: boolean): Record<string, unknown> {
  if (!includeCoverSheets) {
    return { bool: { must: query, must_not: [COVER_SHEET_TERM] } };
  }
  return withCoverSheetPenalty(query);
}

// Facet values are exact keyword strings as indexed (addresses are UPPERCASE, labs/agencies as
// extracted), but planner- and link-generated filters arrive in free-text case ("125 Cedar
// Street"). An exact `term` silently zeroed every result (2026-09-14, a suggested search). Match
// the exact value OR the same value ignoring case OR a case-insensitive prefix.
function looseTerm(field: string, value: string) {
  const v = value.trim();
  const esc = v.replace(/([*?\\])/g, '\\$1');
  return {
    bool: {
      minimum_should_match: 1,
      should: [
        { term: { [field]: v } },
        { term: { [field]: v.toUpperCase() } },
        { wildcard: { [field]: { value: `${esc}*`, case_insensitive: true } } },
      ],
    },
  };
}

const FACET_FIELDS = ['agency', 'source', 'box', 'volume', 'folder', 'contaminants', 'labs', 'addresses'] as const;

function buildFilterClauses(filters: SearchFilters): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];
  if (filters.agency) clauses.push(looseTerm('agency', filters.agency));
  if (filters.source) clauses.push({ term: { source: filters.source } });
  if (filters.box) clauses.push({ term: { box: filters.box } });
  if (filters.folder) clauses.push({ term: { folder: filters.folder } });
  if (filters.volume) clauses.push({ term: { volume: filters.volume } });
  if (filters.contaminant) clauses.push({ term: { contaminants: filters.contaminant } });
  if (filters.lab) clauses.push(looseTerm('labs', filters.lab));
  if (filters.address) clauses.push(looseTerm('addresses', filters.address));
  if (filters.docs?.length) clauses.push({ terms: { doc: filters.docs.slice(0, 1000) } });
  if (filters.year) {
    clauses.push({
      range: { dates: { gte: `${filters.year}-01-01`, lte: `${filters.year}-12-31` } },
    });
  }
  return clauses;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Turns a highlight fragment carrying our private placeholder markers into safe HTML with <mark>. */
function renderSnippet(fragment: string): string {
  const escaped = escapeHtml(fragment);
  return escaped.split(HL_OPEN).join('<mark>').split(HL_CLOSE).join('</mark>');
}

/**
 * Does the keyword arm alone have any hit at all? A hybrid query's k-NN arm
 * always returns its nearest k neighbours regardless of whether the word
 * means anything to the corpus — searching an off-corpus word like "jesus"
 * came back with 100 semantically-"close" pages and zero actual matches,
 * which reads as noise, not results (team brief). Skipped whenever the
 * caller already knows it wants semantic recall regardless (a planner
 * question, `SearchOptions.allowSemanticOnly`).
 */
async function hasLexicalHit(query: string, filterClauses: Record<string, unknown>[], includeCoverSheets: boolean): Promise<boolean> {
  try {
    const clauses = includeCoverSheets ? filterClauses : [...filterClauses, { bool: { must_not: [COVER_SHEET_TERM] } }];
    const body = {
      query: clauses.length
        ? { bool: { must: { multi_match: { query, fields: MULTI_MATCH_FIELDS } }, filter: clauses } }
        : { multi_match: { query, fields: MULTI_MATCH_FIELDS } },
    };
    const res = (await call('POST', `/${INDEX}/_count`, body, 5000)) as { count: number };
    return (res.count ?? 0) > 0;
  } catch {
    // Don't let a broken count call falsely suppress a real search — fail open.
    return true;
  }
}

/**
 * How many pages of this same query are folder cover sheets — shown next to the "Include folder
 * cover sheets" toggle so hiding them by default doesn't read as the count silently changing.
 * Keyword-only, like hasLexicalHit above (an exact figure would need the same hybrid query twice);
 * good enough for a facet count, not claimed as the precise hidden total when semantic-only hits exist.
 */
async function countCoverSheets(query: string, filterClauses: Record<string, unknown>[]): Promise<number> {
  try {
    const filter = [...filterClauses, COVER_SHEET_TERM];
    const body = {
      query: query ? { bool: { must: { multi_match: { query, fields: MULTI_MATCH_FIELDS } }, filter } } : { bool: { filter } },
    };
    const res = (await call('POST', `/${INDEX}/_count`, body, 5000)) as { count: number };
    return res.count ?? 0;
  } catch {
    return 0;
  }
}

/** A bare Bates number in the query short-circuits straight to that page, exact per scripts/search/opensearch.py. */
export async function findExactBates(q: string): Promise<{ doc: string; page: number; batesPage: string } | null> {
  const m = BATES_RE.exec(q.trim());
  if (!m) return null;
  const batesPage = `NYC-WTC_${m[1]!.padStart(9, '0')}`;
  try {
    const res = (await call('POST', `/${INDEX}/_search`, {
      size: 1,
      _source: ['doc', 'page', 'bates_page'],
      query: { term: { bates_page: batesPage } },
    })) as { hits: { hits: { _source: { doc: string; page: number; bates_page: string } }[] } };
    const hit = res.hits.hits[0];
    if (!hit) return null;
    return { doc: hit._source.doc, page: hit._source.page, batesPage: hit._source.bates_page };
  } catch {
    return null;
  }
}

export interface SearchOptions {
  q: string;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  sort?: 'relevance' | 'bates' | 'newest';
  /**
   * Skip the "semantic needs ≥1 lexical hit" gate below. Set by
   * lib/ask/retrieve.ts: a planner-generated 'question' plan wants semantic
   * recall for paraphrased content even when its exact terms don't appear
   * verbatim — the gate exists for the bare /search box, which has no such
   * intent signal and where an off-corpus word returning only "nearest
   * neighbour" noise reads as a bug (team brief).
   */
  allowSemanticOnly?: boolean;
  /** Show folder cover sheets in `hits`/`total` instead of hiding them (a /search facet toggle;
   *  default false — see withCoverSheetHandling). Cover sheets are still ranked down when shown. */
  includeCoverSheets?: boolean;
}

export async function search(opts: SearchOptions): Promise<SearchResult> {
  const { q, filters = {}, page = 1, pageSize = 20, sort = 'relevance', allowSemanticOnly = false, includeCoverSheets = false } = opts;
  const from = Math.max(0, (page - 1) * pageSize);
  const filterClauses = buildFilterClauses(filters);
  const trimmed = q.trim();
  // Strip stopwords before it ever reaches OpenSearch: the keyword arm's
  // query text, the embedding text for the semantic arm, and (since the
  // highlighter reflects whatever query it's given) the highlighted snippet
  // all come from `strippedQuery`, never the raw `trimmed` string. A query
  // that was nothing but stopwords/pronouns ("do you like jesus") short-
  // circuits before any OpenSearch or Ollama call — see B11.
  const strippedQuery = trimmed ? contentTerms(trimmed).join(' ') : '';
  if (trimmed && !strippedQuery) {
    return { hits: [], total: 0, tookMs: 0, facets: {}, semantic: false, noSearchableTerms: true };
  }

  let noLexicalMatch = false;
  if (strippedQuery && !allowSemanticOnly && !(await hasLexicalHit(strippedQuery, filterClauses, includeCoverSheets))) {
    noLexicalMatch = true;
  }

  let semantic = false;
  let semanticError: string | undefined;
  let vector: number[] | null = null;
  if (strippedQuery && !noLexicalMatch) {
    const embed = await embedQuery(strippedQuery);
    vector = embed.vector;
    semantic = embed.reachable && !!embed.vector;
    if (!embed.reachable) semanticError = embed.error || 'Ollama unreachable';
  }

  const textQuery = withCoverSheetHandling(
    strippedQuery ? { multi_match: { query: strippedQuery, fields: MULTI_MATCH_FIELDS } } : { match_all: {} },
    includeCoverSheets,
  );

  let queryBody: Record<string, unknown>;
  let searchPath = `/${INDEX}/_search`;
  if (filters.docs?.length) {
    // A document-scoped search (one building's own records, lib/ask/placeBoost.ts) must filter
    // BEFORE ranking: as a post_filter on the hybrid query it only sees the corpus-wide top hits,
    // which rarely include the scoped documents, so it came back empty (2026-09-14). Keyword arm
    // only — the semantic arm cannot be pre-filtered here.
    queryBody = { bool: { must: textQuery, filter: [{ terms: { doc: filters.docs.slice(0, 1000) } }] } };
  } else if (strippedQuery && vector) {
    queryBody = {
      hybrid: {
        queries: [textQuery, withCoverSheetHandling({ knn: { vector: { vector, k: Math.max(50, pageSize * 5) } } }, includeCoverSheets)],
        // Required by OpenSearch whenever `from` > 0 for a hybrid query —
        // how many hits per shard the normalization pipeline keeps around to
        // support pagination. The index is single-shard (scripts/search/
        // opensearch.py), so this just needs to cover from+size.
        pagination_depth: Math.max(1000, from + pageSize),
      },
    };
    searchPath += `?search_pipeline=${PIPELINE}`;
  } else {
    queryBody = textQuery;
  }

  const sortClause =
    sort === 'bates'
      ? [{ bates_page: 'asc' }]
      : sort === 'newest'
        ? [{ dates: { order: 'desc', mode: 'max' } }]
        : undefined;

  const body: Record<string, unknown> = {
    from,
    size: pageSize,
    _source: ['doc', 'page', 'bates_page', 'agency', 'source', 'box', 'folder', 'volume', 'ocr_status', 'contaminants', 'doc_type', 'doc_title'],
    query: queryBody,
    post_filter: filterClauses.length ? { bool: { filter: filterClauses } } : undefined,
    aggs: Object.fromEntries(FACET_FIELDS.map((f) => [f, { terms: { field: f, size: 15 } }])),
    highlight: {
      pre_tags: [HL_OPEN],
      post_tags: [HL_CLOSE],
      fields: { text: { number_of_fragments: 1, fragment_size: 220, no_match_size: 0 } },
    },
  };

  try {
    const res = (await call('POST', searchPath, body)) as {
      took: number;
      hits: { total: { value: number }; hits: OsHit[] };
      aggregations?: Record<string, { buckets: { key: string; doc_count: number }[] }>;
    };
    const hits: SearchHit[] = res.hits.hits.map((h) => ({
      doc: h._source.doc,
      page: h._source.page,
      batesPage: h._source.bates_page,
      agency: h._source.agency ?? null,
      source: h._source.source ?? null,
      box: h._source.box ?? null,
      folder: h._source.folder ?? null,
      volume: h._source.volume ?? null,
      ocrStatus: h._source.ocr_status ?? null,
      contaminants: h._source.contaminants ?? [],
      score: h._score ?? 0,
      snippetHtml: h.highlight?.text?.[0] ? renderSnippet(h.highlight.text[0]) : null,
      docType: h._source.doc_type ?? null,
      docTitle: h._source.doc_title ?? null,
    }));
    const facets: Record<string, FacetBucket[]> = {};
    for (const f of FACET_FIELDS) {
      facets[f] = (res.aggregations?.[f]?.buckets ?? []).map((b) => ({ key: b.key, count: b.doc_count }));
    }
    // Keyword-only count (see countCoverSheets), so it's skipped whenever cover sheets are already
    // shown (nothing hidden to count) — kept out of the critical path, best-effort like every other
    // discovery-layer count in this codebase.
    const hiddenCoverSheets = includeCoverSheets ? 0 : await countCoverSheets(strippedQuery, filterClauses);
    return { hits, total: res.hits.total.value, tookMs: res.took, facets, semantic, semanticError, noLexicalMatch, hiddenCoverSheets };
  } catch (err) {
    return {
      hits: [],
      total: 0,
      tookMs: 0,
      facets: {},
      semantic,
      semanticError,
      noLexicalMatch,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface OsHit {
  _score: number;
  _source: {
    doc: string;
    page: number;
    bates_page: string;
    agency?: string;
    source?: string;
    box?: string;
    folder?: string;
    volume?: string;
    ocr_status?: string;
    contaminants?: string[];
    doc_type?: string;
    doc_title?: string;
  };
  highlight?: { text?: string[] };
}

export interface IndexedPageFacts {
  contaminants: string[];
  labs: string[];
  contractors: string[];
  agenciesMentioned: string[];
  dates: string[];
  addresses: string[];
  bins: string[];
  measurementUnits: string[];
  officialRoles: string[];
  ocrStatus: string | null;
}

/** The machine-derived facts OpenSearch already holds for one page — used on the document viewer's "extracted from this page" panel. */
export async function getIndexedPage(doc: string, page: number): Promise<IndexedPageFacts | null> {
  try {
    const res = (await call('GET', `/${INDEX}/_doc/${doc}_p${page}`, undefined, 3000)) as {
      found: boolean;
      _source?: Record<string, unknown>;
    };
    if (!res.found || !res._source) return null;
    const s = res._source;
    const arr = (k: string): string[] => (Array.isArray(s[k]) ? (s[k] as string[]) : []);
    return {
      contaminants: arr('contaminants'),
      labs: arr('labs'),
      contractors: arr('contractors'),
      agenciesMentioned: arr('agencies_mentioned'),
      dates: arr('dates'),
      addresses: arr('addresses'),
      bins: arr('bins'),
      measurementUnits: arr('measurement_units'),
      officialRoles: arr('official_roles'),
      ocrStatus: (s.ocr_status as string) ?? null,
    };
  } catch {
    return null;
  }
}

export async function healthCheck(): Promise<{ reachable: boolean; docCount: number | null; error?: string }> {
  try {
    const res = (await call('GET', `/${INDEX}/_count`, undefined, 2000)) as { count: number };
    return { reachable: true, docCount: res.count };
  } catch (err) {
    return { reachable: false, docCount: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One page's related documents by shared-topic ranking, used on the document viewer's discovery panel. */
export async function moreLikePage(doc: string, page: number, size = 4): Promise<SearchHit[]> {
  try {
    const res = (await call('POST', `/${INDEX}/_search`, {
      size,
      _source: ['doc', 'page', 'bates_page', 'agency', 'box', 'folder', 'volume', 'doc_type', 'doc_title'],
      query: {
        more_like_this: {
          fields: ['text'],
          like: [{ _index: INDEX, _id: `${doc}_p${page}` }],
          min_term_freq: 1,
          min_doc_freq: 1,
        },
      },
    })) as { hits: { hits: OsHit[] } };
    return res.hits.hits
      .filter((h) => h._source.doc !== doc)
      .map((h) => ({
        doc: h._source.doc,
        page: h._source.page,
        batesPage: h._source.bates_page,
        agency: h._source.agency ?? null,
        source: h._source.source ?? null,
        box: h._source.box ?? null,
        folder: h._source.folder ?? null,
        volume: h._source.volume ?? null,
        ocrStatus: null,
        contaminants: [],
        score: h._score ?? 0,
        snippetHtml: null,
        docType: h._source.doc_type ?? null,
        docTitle: h._source.doc_title ?? null,
      }));
  } catch {
    return [];
  }
}
