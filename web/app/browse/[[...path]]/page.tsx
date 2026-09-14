import { formatDate, type DatabaseDate } from '@/lib/dates';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { queryRead } from '@/lib/db';
import { browseUrl, filters, levels, number, segment, unsegment } from '@/lib/info/catalog';
import { pageMetadata } from '@/lib/info/metadata';
import { PageShell } from '@/components/info/PageShell';
import { AdUnit } from '@/components/ads/AdUnit';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import { ButtonLink, Button, Callout } from '@/components/ui';
import styles from '@/components/info/info.module.css';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ path?: string[] }>; searchParams: Promise<{ source?: string; page?: string; agency?: string; volume?: string }> };
export async function generateMetadata({ params, searchParams }: Props) {
  const { path = [] } = await params; const { source } = await searchParams;
  return pageMetadata('Browse records', 'Follow the City’s collection and box to the folder labels and Bates-numbered documents inside — filter by agency or production volume.', browseUrl(path.map(unsegment), source));
}
interface Group { label: string | null; documents: number; pages: number }
interface BoxRow { label: string | null; agency: string | null; volume: string | null; documents: number; pages: number }
interface Doc { doc: string; bates_end: string | null; page_count: number; status: string; removed_at: DatabaseDate | null }

/** Index-level (no agency/volume/box/folder path chosen) box grouping — the
 *  design's "Collection → Box → Folder" hierarchy (issue #32, item 3). Boxes
 *  are grouped across every agency/volume so the index skips the forced
 *  agency-then-volume drill-down; agency and volume become an optional
 *  filter row (query params, independent of the path scheme) instead of
 *  path segments. Grouping by (box, agency, volume) — not box alone — keeps
 *  the link to each box's folder listing exact even for the handful of
 *  boxes that span more than one agency/volume in the real data. */
async function boxIndex(source: string | undefined, agency?: string, volume?: string): Promise<BoxRow[]> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (source !== undefined) { params.push(source); clauses.push(`COALESCE(source,'')=$${params.length}`); }
  if (agency) { params.push(agency); clauses.push(`agency=$${params.length}`); }
  if (volume) { params.push(volume); clauses.push(`volume=$${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return queryRead<BoxRow>(
    `SELECT box AS label, agency, volume, COUNT(*) AS documents, COALESCE(SUM(page_count),0) AS pages FROM site.documents ${where} GROUP BY box, agency, volume ORDER BY box NULLS LAST, agency NULLS LAST, volume NULLS LAST`,
    params,
  );
}

async function distinctValues(column: 'agency' | 'volume', source?: string): Promise<string[]> {
  const params: unknown[] = [];
  let where = `WHERE ${column} IS NOT NULL`;
  if (source !== undefined) { params.push(source); where += ` AND COALESCE(source,'')=$${params.length}`; }
  const rows = await queryRead<{ v: string }>(`SELECT DISTINCT ${column} AS v FROM site.documents ${where} ORDER BY 1`, params);
  return rows.map((r) => r.v);
}

export default async function Browse({ params, searchParams }: Props) {
  const { path: raw = [] } = await params;
  if (raw.length > 4) notFound();
  const path = raw.map(unsegment);
  const { source, page: pageInput, agency: agencyFilter, volume: volumeFilter } = await searchParams;
  const page = Math.max(1, Math.min(100000, Number(pageInput) || 1)) | 0;
  const atIndex = path.length === 0;
  const { where, params: values } = filters(path, source);
  let groups: Group[] = [], collections: Group[] = [], docs: Doc[] = [], total: Group | undefined, unavailable = false;
  let boxes: BoxRow[] = [], agencyOptions: string[] = [], volumeOptions: string[] = [];
  try {
    const results = await Promise.all([
      queryRead<Group>(`SELECT COUNT(*) AS documents, COALESCE(SUM(page_count),0) AS pages FROM site.documents ${where}`, values),
      queryRead<Group>("SELECT COALESCE(source,'') AS label, COUNT(*) AS documents, COALESCE(SUM(page_count),0) AS pages FROM site.documents GROUP BY COALESCE(source,'') ORDER BY label"),
      atIndex ? Promise.resolve([]) : (path.length < 4 ? queryRead<Group>(`SELECT ${levels[path.length]} AS label, COUNT(*) AS documents, COALESCE(SUM(page_count),0) AS pages FROM site.documents ${where} GROUP BY ${levels[path.length]} ORDER BY ${levels[path.length]} NULLS LAST`, values) : Promise.resolve([])),
      path.length === 4 ? queryRead<Doc>(`SELECT doc,bates_end,page_count,status,removed_at FROM site.documents ${where} ORDER BY doc LIMIT 101 OFFSET $${values.length+1}`, [...values,(page-1)*100]) : Promise.resolve([]),
      atIndex ? boxIndex(source, agencyFilter, volumeFilter) : Promise.resolve([]),
      atIndex ? distinctValues('agency', source) : Promise.resolve([]),
      atIndex ? distinctValues('volume', source) : Promise.resolve([]),
    ]);
    [total] = results[0]; collections = results[1]; groups = results[2]; docs = results[3]; boxes = results[4]; agencyOptions = results[5]; volumeOptions = results[6];
  } catch { unavailable = true; }
  if (!unavailable && !atIndex && !total?.documents && (raw.length || source !== undefined)) notFound();
  // An index-level agency/volume filter with no matches falls through to the "No boxes match
  // this filter" empty state below rather than a 404 — unlike a path segment (agency/volume/
  // box/folder), an index filter is not itself a resource identity.
  const boxTotals = boxes.reduce((acc, b) => ({ documents: acc.documents + Number(b.documents), pages: acc.pages + Number(b.pages) }), { documents: 0, pages: 0 });
  const boxLabelCounts = new Map<string, number>();
  boxes.forEach((b) => { const k = b.label ?? ''; boxLabelCounts.set(k, (boxLabelCounts.get(k) || 0) + 1); });
  const crumbs = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Browse records', path: '/browse' },
    ...(source !== undefined ? [{ name: source || 'Not recorded', path: browseUrl([], source) }] : []),
    ...path.map((part, i) => ({ name: part || `${levels[i]} not recorded`, path: browseUrl(path.slice(0, i + 1), source) })),
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <PageShell active="/browse">
        <div className="page-title">
          <div>
            <div className="eyebrow">Browse records</div>
            <h1>The order the City kept.</h1>
            <p className="subtitle">Follow the collection, box and handwritten folder label to the documents inside.</p>
          </div>
        </div>
        <div className={styles.columns}>
          <aside className={styles.sidebar}>
            <h2>Collections</h2>
            <Link href="/browse">All collections</Link>
            {collections.map((c) => (
              <Link key={c.label} href={browseUrl([], c.label || '')} aria-current={source === c.label ? 'page' : undefined}>
                {c.label || 'Collection not recorded'}
                <br />
                <span className="small muted">{number(c.documents)} documents · {number(c.pages)} pages</span>
              </Link>
            ))}
            <p className={styles.note}>City source labels are preserved. No machine-generated descriptions.</p>
          </aside>
          <section>
            <nav className="bread" aria-label="Breadcrumb">
              <Link href="/browse">Collection</Link>
              {source !== undefined && <Link href={browseUrl([], source)}>{source || 'Not recorded'}</Link>}
              {path.map((part, i) => (
                <Link key={i} href={browseUrl(path.slice(0, i + 1), source)}>
                  {part || `${levels[i]} not recorded`}
                </Link>
              ))}
            </nav>
            {unavailable ? (
              <Callout tone="error" role="status">
                The collection catalog is temporarily unavailable. Please try again later.
              </Callout>
            ) : atIndex ? (
              <>
                <form className={styles.filterRow} action="/browse" method="get">
                  {source !== undefined && <input type="hidden" name="source" value={source} />}
                  <label>
                    Agency{' '}
                    <select name="agency" defaultValue={agencyFilter || ''}>
                      <option value="">All agencies</option>
                      {agencyOptions.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Volume{' '}
                    <select name="volume" defaultValue={volumeFilter || ''}>
                      <option value="">All volumes</option>
                      {volumeOptions.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button variant="secondary" size="small" type="submit">
                    Apply
                  </Button>
                  {(agencyFilter || volumeFilter) && <Link href={browseUrl([], source)}>Reset</Link>}
                </form>
                <h2>Boxes{source !== undefined ? ` in ${source || 'this collection'}` : ''}</h2>
                <p className={styles.note}>{number(boxTotals.documents)} documents · {number(boxTotals.pages)} pages</p>
                {boxes.map((b) => (
                  <div className={styles.row} key={`${b.agency ?? ''}|${b.volume ?? ''}|${b.label ?? ''}`}>
                    <Link href={browseUrl([b.agency, b.volume, b.label], source)}>
                      {b.label || 'Not recorded'}
                      {(boxLabelCounts.get(b.label ?? '') || 0) > 1 ? ` — ${b.volume || 'volume not recorded'}` : ''} →
                    </Link>
                    <span className="small muted">{number(b.documents)} documents · {number(b.pages)} pages</span>
                  </div>
                ))}
                {!boxes.length && <p>No boxes match this filter.</p>}
              </>
            ) : (
              <>
                <h2>{path.length === 4 ? 'Documents in this folder' : ['Agencies', 'Volumes', 'Boxes', 'Folders'][path.length]}</h2>
                {path.length === 4 && <p className="subtitle">Folder label / City-provided: {path[3] || 'Not recorded'}</p>}
                <p className={styles.note}>{number(total?.documents)} documents · {number(total?.pages)} pages</p>
                {groups.map((g) => (
                  <div className={styles.row} key={segment(g.label)}>
                    <Link href={browseUrl([...path, g.label], source)}>{g.label || 'Not recorded'} →</Link>
                    <span className="small muted">{number(g.documents)} documents · {number(g.pages)} pages</span>
                  </div>
                ))}
                {docs.slice(0, 100).map((d) => (
                  <div className={styles.row} key={d.doc}>
                    <div>
                      {d.status === 'removed' ? (
                        <>
                          <Link className="bates" href={`/doc/${encodeURIComponent(d.doc)}`}>
                            {d.doc}
                            {d.bates_end !== d.doc && d.bates_end ? ` – ${d.bates_end}` : ''} ↗
                          </Link>
                          <p className="small muted">Removed by the City{d.removed_at ? ` on ${formatDate(d.removed_at)}` : ' (date not recorded)'}</p>
                        </>
                      ) : (
                        <Link className="bates" href={`/doc/${encodeURIComponent(d.doc)}`}>
                          {d.doc}
                          {d.bates_end !== d.doc && d.bates_end ? ` – ${d.bates_end}` : ''} ↗
                        </Link>
                      )}
                    </div>
                    <span className="small muted">{number(d.page_count)} pages</span>
                  </div>
                ))}
                {!total?.documents && <p>No catalog records yet.</p>}
                {path.length === 4 && (
                  <nav aria-label="Document pages" className={`${styles.pager} actions`}>
                    {page > 1 && (
                      <ButtonLink variant="secondary" size="small" href={`${browseUrl(path, source)}${source === undefined ? '?' : '&'}page=${page - 1}`}>
                        ← Previous
                      </ButtonLink>
                    )}
                    {docs.length > 100 && (
                      <ButtonLink variant="secondary" size="small" href={`${browseUrl(path, source)}${source === undefined ? '?' : '&'}page=${page + 1}`}>
                        Next →
                      </ButtonLink>
                    )}
                  </nav>
                )}
              </>
            )}
          </section>
        </div>
        <AdUnit />
      </PageShell>
    </>
  );
}
