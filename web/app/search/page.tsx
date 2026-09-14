import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SearchBox } from '@/components/SearchBox';
import { findExactBates, search, type FacetBucket, type SearchFilters } from '@/lib/opensearch';
import { FILTER_KEYS, getStr, searchHref, type SearchParamsInput } from '@/lib/searchUrl';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const q = getStr(sp, 'q');
  const title = q ? `“${q}” — document results` : 'Search the records';
  return { title, alternates: { canonical: q ? `/search?q=${encodeURIComponent(q)}` : '/search' }, robots: { index: false } };
}

const PAGE_SIZE = 20;

const FACET_LABELS: Record<string, string> = {
  source: 'Collection',
  agency: 'Agency',
  box: 'Box',
  folder: 'Folder',
  volume: 'Production volume',
  contaminants: 'Contaminant',
  labs: 'Lab',
  addresses: 'Address',
};

// facet key in the aggregation response -> the filter query param it sets
const FACET_TO_FILTER: Record<string, string> = {
  source: 'source',
  agency: 'agency',
  box: 'box',
  folder: 'folder',
  volume: 'volume',
  contaminants: 'contaminant',
  labs: 'lab',
  addresses: 'address',
};

function FacetGroup({
  aggKey,
  buckets,
  sp,
  selected,
}: {
  aggKey: string;
  buckets: FacetBucket[];
  sp: SearchParamsInput;
  selected?: string;
}) {
  const filterKey = FACET_TO_FILTER[aggKey]!;
  if (!buckets.length && !selected) return null;
  return (
    <details className="facet" open={!!selected || buckets.length <= 8}>
      <summary>{FACET_LABELS[aggKey] || aggKey}</summary>
      <div className="facet-options">
        {selected && (
          <label className="check">
            <span>✕ {selected}</span>
            <Link className="facet-count" href={searchHref(sp, { [filterKey]: null })}>
              clear
            </Link>
          </label>
        )}
        {buckets
          .filter((b) => b.key !== selected)
          .map((b) => (
            <label className="check" key={b.key}>
              <Link href={searchHref(sp, { [filterKey]: b.key })} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', width: '100%' }}>
                <span>{b.key}</span>
                <span className="facet-count">{b.count}</span>
              </Link>
            </label>
          ))}
      </div>
    </details>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const sp = await searchParams;
  const q = getStr(sp, 'q') || '';
  const page = Math.max(1, Number(getStr(sp, 'page')) || 1);
  const sort = (getStr(sp, 'sort') as 'relevance' | 'bates' | 'newest') || 'relevance';

  const filters: SearchFilters = {};
  for (const key of FILTER_KEYS) {
    const v = getStr(sp, key);
    if (v) (filters as Record<string, string>)[key] = v;
  }

  if (q.trim()) {
    const exact = await findExactBates(q);
    if (exact) {
      redirect(exact.page > 1 ? `/doc/${exact.doc}/p/${exact.page}` : `/doc/${exact.doc}`);
    }
  }

  const result = await search({ q, filters, page, pageSize: PAGE_SIZE, sort });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <>
      <Header active="/ask" />
      <main id="main">
        <SearchBox q={q} compact />
        <p className="small muted" style={{ marginBottom: 14 }}>
          {result.error
            ? 'Search is temporarily unavailable.'
            : q.trim()
              ? `Searching the mirrored records for “${q}”.`
              : 'Browsing all mirrored pages. Enter a keyword, address or Bates number to narrow this.'}
          {!result.error && !result.semantic && q.trim() && (
            <> Semantic ranking is unavailable ({result.semanticError || 'Ollama unreachable'}); showing keyword-only results.</>
          )}
        </p>
        {result.error && <div className="error-note">{result.error}</div>}
        <div className="results-layout">
          <aside className="facets" aria-label="Filter documents">
            <div className="facet-head">
              <h2>Filter documents</h2>
              {FILTER_KEYS.some((k) => getStr(sp, k)) && (
                <Link href={searchHref(sp, Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}>Reset</Link>
              )}
            </div>
            <FacetGroup aggKey="source" buckets={result.facets.source || []} sp={sp} selected={filters.source} />
            <FacetGroup aggKey="agency" buckets={result.facets.agency || []} sp={sp} selected={filters.agency} />
            <FacetGroup aggKey="box" buckets={result.facets.box || []} sp={sp} selected={filters.box} />
            <FacetGroup aggKey="folder" buckets={result.facets.folder || []} sp={sp} selected={filters.folder} />
            <FacetGroup aggKey="volume" buckets={result.facets.volume || []} sp={sp} selected={filters.volume} />
            <FacetGroup aggKey="contaminants" buckets={result.facets.contaminants || []} sp={sp} selected={filters.contaminant} />
            <FacetGroup aggKey="labs" buckets={result.facets.labs || []} sp={sp} selected={filters.lab} />
            <FacetGroup aggKey="addresses" buckets={result.facets.addresses || []} sp={sp} selected={filters.address} />
          </aside>
          <section>
            <div className="result-toolbar">
              <h1>
                <span id="result-count">{result.total.toLocaleString()}</span> document results
              </h1>
              <div className="actions">
                <form action="/search" method="get">
                  <input type="hidden" name="q" value={q} />
                  {FILTER_KEYS.map((k) => filters[k] ? <input key={k} type="hidden" name={k} value={filters[k]} /> : null)}
                  <label>
                    Sort{' '}
                    <select name="sort" defaultValue={sort}>
                      <option value="relevance">Relevance</option>
                      <option value="bates">Bates number</option>
                      <option value="newest">Derived date, newest first</option>
                    </select>
                  </label>{' '}
                  <button className="button small" type="submit">
                    Apply
                  </button>
                </form>
              </div>
            </div>
            <div id="result-list">
              {result.hits.map((hit) => (
                <article className="result-item" key={`${hit.doc}_${hit.page}`}>
                  <div className="result-top">
                    <div>
                      <h2>
                        <Link href={`/doc/${hit.doc}${hit.page > 1 ? `/p/${hit.page}` : ''}`}>
                          {hit.folder || hit.doc} — page {hit.page}
                        </Link>
                      </h2>
                      <span className="range mono">{hit.batesPage}</span>
                    </div>
                  </div>
                  <div className="result-context">
                    {[hit.source, hit.box, hit.folder].filter(Boolean).join(' / ')}
                  </div>
                  {hit.snippetHtml ? (
                    <p className="snippet" dangerouslySetInnerHTML={{ __html: hit.snippetHtml }} />
                  ) : (
                    <p className="snippet muted">
                      {hit.ocrStatus === 'empty'
                        ? 'Image-only scan or no searchable OCR text yet.'
                        : 'No matching passage to preview on this page.'}
                    </p>
                  )}
                  <div className="result-foot">
                    <span>Volume {hit.volume || '—'}</span>
                    <span>Agency: {hit.agency || '—'}</span>
                    {hit.contaminants.length > 0 && <span className="derived">Contaminants: {hit.contaminants.join(', ')}</span>}
                  </div>
                </article>
              ))}
              {!result.hits.length && !result.error && (
                <div className="note" id="no-results">
                  <h3>No matches</h3>
                  <p>Try different keywords, clear a filter, or search a Bates number directly.</p>
                </div>
              )}
            </div>
            <div className="pagination">
              <span>
                Page {page} of {totalPages.toLocaleString()} · {result.total.toLocaleString()} pages matched
              </span>
              <div className="actions">
                {page > 1 && <Link className="button small" href={searchHref(sp, { page: String(page - 1) })}>← Previous</Link>}
                {page < totalPages && <Link className="button small" href={searchHref(sp, { page: String(page + 1) })}>Next →</Link>}
              </div>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
