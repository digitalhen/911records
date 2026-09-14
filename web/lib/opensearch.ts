// Client for the OpenSearch index built by scripts/search/opensearch.py.
// Mapping, pipeline name and field names here must track that file — see its
// header comment for the authoritative schema. Local network call only.
import { embedQuery } from './embed';
import { BATES_RE } from './paths';

const OPENSEARCH_URL = process.env.OPENSEARCH_URL || 'http://127.0.0.1:9200';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER;
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD;
export const INDEX = process.env.OPENSEARCH_INDEX || 'sept11-pages-v1';
const PIPELINE = process.env.OPENSEARCH_PIPELINE || 'sept11-hybrid';

const HL_OPEN = '';
const HL_CLOSE = '';

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
}

const FACET_FIELDS = ['agency', 'source', 'box', 'volume', 'folder', 'contaminants', 'labs', 'addresses'] as const;

function buildFilterClauses(filters: SearchFilters): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];
  if (filters.agency) clauses.push({ term: { agency: filters.agency } });
  if (filters.source) clauses.push({ term: { source: filters.source } });
  if (filters.box) clauses.push({ term: { box: filters.box } });
  if (filters.folder) clauses.push({ term: { folder: filters.folder } });
  if (filters.volume) clauses.push({ term: { volume: filters.volume } });
  if (filters.contaminant) clauses.push({ term: { contaminants: filters.contaminant } });
  if (filters.lab) clauses.push({ term: { labs: filters.lab } });
  if (filters.address) clauses.push({ term: { addresses: filters.address } });
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
}

export async function search(opts: SearchOptions): Promise<SearchResult> {
  const { q, filters = {}, page = 1, pageSize = 20, sort = 'relevance' } = opts;
  const from = Math.max(0, (page - 1) * pageSize);
  const filterClauses = buildFilterClauses(filters);
  const trimmed = q.trim();

  let semantic = false;
  let semanticError: string | undefined;
  let vector: number[] | null = null;
  if (trimmed) {
    const embed = await embedQuery(trimmed);
    vector = embed.vector;
    semantic = embed.reachable && !!embed.vector;
    if (!embed.reachable) semanticError = embed.error || 'Ollama unreachable';
  }

  const textQuery = trimmed
    ? { multi_match: { query: trimmed, fields: ['text', 'text.exact^0.5', 'folder.text^0.3'] } }
    : { match_all: {} };

  let queryBody: Record<string, unknown>;
  let searchPath = `/${INDEX}/_search`;
  if (trimmed && vector) {
    queryBody = {
      hybrid: {
        queries: [textQuery, { knn: { vector: { vector, k: Math.max(50, pageSize * 5) } } }],
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
    _source: ['doc', 'page', 'bates_page', 'agency', 'source', 'box', 'folder', 'volume', 'ocr_status', 'contaminants'],
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
    }));
    const facets: Record<string, FacetBucket[]> = {};
    for (const f of FACET_FIELDS) {
      facets[f] = (res.aggregations?.[f]?.buckets ?? []).map((b) => ({ key: b.key, count: b.doc_count }));
    }
    return { hits, total: res.hits.total.value, tookMs: res.took, facets, semantic, semanticError };
  } catch (err) {
    return {
      hits: [],
      total: 0,
      tookMs: 0,
      facets: {},
      semantic,
      semanticError,
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
      _source: ['doc', 'page', 'bates_page', 'agency', 'box', 'folder', 'volume'],
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
      }));
  } catch {
    return [];
  }
}
