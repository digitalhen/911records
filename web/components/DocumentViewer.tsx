import { formatDate } from '@/lib/dates';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { CiteButton } from '@/components/CiteButton';
import { getDocument, getPage as getSitePage, getPageText } from '@/lib/site';
import { getIndexedPage } from '@/lib/opensearch';
import { getPageBoxes } from '@/lib/boxes';
import { fileExists, pageImagePath, pageImageUrl, pdfPath } from '@/lib/files';

function fmtBytes(n: number | null): string {
  if (!n) return '—';
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text: string, term?: string): string {
  const escaped = escapeHtml(text);
  if (!term) return escaped;
  const re = new RegExp(`(${escapeRegExp(term)})`, 'gi');
  return escaped.replace(re, '<mark>$1</mark>');
}

function batesRange(doc: string, batesEnd: string | null): string {
  if (!batesEnd || batesEnd === doc) return doc;
  return `${doc}–${batesEnd.replace(/^NYC-WTC_/, '')}`;
}

export async function DocumentViewer({ doc, page, highlight }: { doc: string; page: number; highlight?: string }) {
  const docRow = await getDocument(doc);
  if (!docRow) notFound();

  const pageCount = docRow.page_count ?? 1;
  if (page < 1 || page > pageCount) notFound();

  const agency = docRow.agency || '';
  const volume = docRow.volume || '';
  const removed = docRow.status === 'removed';

  const [pageText, boxes, indexedFacts, sitePage] = await Promise.all([
    getPageText(doc, page),
    getPageBoxes(agency, volume, doc, page),
    getIndexedPage(doc, page),
    getSitePage(doc, page),
  ]);

  // The files service has no listing endpoint, so "does this page have a
  // rendered image yet" is a HEAD request, not a filesystem stat (this app
  // has no bind mount to data/ — see lib/files.ts).
  const hasImage = await fileExists(pageImageUrl(agency, volume, doc, page));
  const bates = sitePage?.bates || doc;

  const citation = `NYC Law Department, ${bates}. Mirrored by 911records.nyc (independent project; not affiliated with the City of New York). Official record: ${docRow.official_url || 'see City portal'}.`;

  return (
    <>
      <Header active="/search" />
      <main id="main">
        <div className="bread">
          <Link href="/search">← Document results</Link>
          <span>/</span>
          <span>{docRow.box || 'Unboxed'}</span>
          <span>/</span>
          <span>{docRow.folder || 'No folder label'}</span>
        </div>

        {removed && (
          <div className="removed-note">
            <h3>This document was removed by the City</h3>
            <p>
              It was present in an earlier snapshot and no longer appears in the City&apos;s catalog
              {docRow.removed_at ? ` as of ${formatDate(docRow.removed_at)}` : ''}. We keep the mirrored copy and metadata for the
              record; it is not republished as current. See{' '}
              <Link href="/changes">the release and change log</Link>.
            </p>
          </div>
        )}

        <div className="page-title viewer-heading">
          <div>
            <div className="eyebrow">
              Document / {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </div>
            <h1>{docRow.folder || doc}</h1>
            <span className="derived-label">Label derived from the City&apos;s folder field. The City does not supply document titles.</span>
            <span className="bates">{batesRange(doc, docRow.bates_end)}</span>
          </div>
          <div className="actions">
            <CiteButton citation={citation} />
          </div>
        </div>

        <form className="findbar" action={`/doc/${doc}${page > 1 ? `/p/${page}` : ''}`} method="get">
          <label htmlFor="hl">Find within this page (highlights the page image)</label>
          <input id="hl" name="hl" type="search" defaultValue={highlight || ''} />
          <button className="button small" type="submit">
            Find
          </button>
          {highlight && !boxes && <span className="muted">No word-box data for this page yet.</span>}
        </form>

        <div className="viewer-shell">
          <section aria-label="Page viewer">
            <div className="viewer-toolbar">
              <div className="pager">
                <Link
                  className="button small"
                  aria-disabled={page <= 1}
                  href={page > 2 ? `/doc/${doc}/p/${page - 1}` : `/doc/${doc}`}
                >
                  ←
                </Link>
                <span>
                  Page {page} of {pageCount}
                </span>
                <Link className="button small" aria-disabled={page >= pageCount} href={`/doc/${doc}/p/${page + 1}`}>
                  →
                </Link>
              </div>
              <div className="view-tools">
                <a href={pdfPath(agency, volume, doc)}>Mirrored PDF</a>
                {docRow.official_url && (
                  <a href={docRow.official_url} target="_blank" rel="noopener">
                    Official City PDF ↗
                  </a>
                )}
              </div>
            </div>
            <div className="document-split">
              <div className="scan-area">
                <div className="pane-label">Page image</div>
                {hasImage ? (
                  <div className="page-image-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pageImagePath(agency, volume, doc, page)} alt={`Scanned page image, ${bates}`} />
                    {boxes &&
                      highlight &&
                      boxes.words
                        .filter(([, , , , word]) => word.toLowerCase().includes(highlight.toLowerCase()))
                        .map(([x0, y0, x1, y1, word], i) => (
                          <span
                            key={i}
                            className="hit-box"
                            title={word}
                            style={{
                              left: `${(x0 / boxes.w) * 100}%`,
                              top: `${(y0 / boxes.h) * 100}%`,
                              width: `${((x1 - x0) / boxes.w) * 100}%`,
                              height: `${((y1 - y0) / boxes.h) * 100}%`,
                            }}
                          />
                        ))}
                  </div>
                ) : (
                  <div className="scan-placeholder">
                    Page image not rendered yet.
                    <br />
                    The pipeline renders page images incrementally; check back or read the OCR text alongside.
                  </div>
                )}
              </div>
              <section className="ocr">
                <div className="pane-label">OCR text</div>
                <p className="quality">
                  OCR status: {sitePage?.ocr_status || (pageText?.text ? 'text extracted' : 'unknown')}
                  {sitePage?.ocr_source ? ` · source: ${sitePage.ocr_source}` : pageText?.source ? ` · source: ${pageText.source}` : ''}
                </p>
                {pageText?.text ? (
                  <div>
                    {pageText.text.split(/\n{2,}/).map((para, i) => (
                      <p
                        key={i}
                        style={{ whiteSpace: 'pre-wrap' }}
                        dangerouslySetInnerHTML={{ __html: highlightText(para, highlight) }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    No OCR text available for this page. It may be an image-only scan; the pipeline queues these for
                    our own OCR pass.
                  </p>
                )}
                <p className="ocr-warning">OCR can misread numbers and units. Confirm readings against the page image before using them.</p>
              </section>
            </div>
            <div className="page-caption">
              <span className="mono">{bates}</span>
              <span>Source: NYC Law Department, mirrored locally</span>
            </div>
          </section>

          <aside className="metadata">
            <section>
              <h2>City-provided metadata</h2>
              <dl>
                <dt>Collection</dt>
                <dd>{docRow.source || '—'}</dd>
                <dt>Agency</dt>
                <dd>{docRow.agency || '—'}</dd>
                <dt>Box / folder</dt>
                <dd>
                  {docRow.box || '—'} / {docRow.folder ? `“${docRow.folder}”` : 'no folder label'}
                </dd>
                <dt>Production volume</dt>
                <dd className="mono">{docRow.volume || '—'}</dd>
                <dt>Bates range</dt>
                <dd className="mono">{batesRange(doc, docRow.bates_end)}</dd>
                <dt>Pages / file size</dt>
                <dd>
                  {pageCount} {pageCount === 1 ? 'page' : 'pages'} / {fmtBytes(docRow.pdf_size)}
                </dd>
              </dl>
              {docRow.official_url && (
                <a className="source-link" href={docRow.official_url} target="_blank" rel="noopener">
                  Official City PDF ↗
                </a>
              )}
            </section>
            <section className="extract">
              <h2>Extracted from this page</h2>
              <p>Machine-derived from OCR. Check the scan; these are not City metadata fields.</p>
              {indexedFacts ? (
                <dl>
                  {indexedFacts.dates.length > 0 && (
                    <>
                      <dt>Date(s)</dt>
                      <dd>{indexedFacts.dates.join(', ')}</dd>
                    </>
                  )}
                  {indexedFacts.addresses.length > 0 && (
                    <>
                      <dt>Address(es)</dt>
                      <dd>{indexedFacts.addresses.join(', ')}</dd>
                    </>
                  )}
                  {indexedFacts.contaminants.length > 0 && (
                    <>
                      <dt>Contaminant(s)</dt>
                      <dd>{indexedFacts.contaminants.join(', ')}</dd>
                    </>
                  )}
                  {indexedFacts.labs.length > 0 && (
                    <>
                      <dt>Lab(s)</dt>
                      <dd>{indexedFacts.labs.join(', ')}</dd>
                    </>
                  )}
                  {!indexedFacts.dates.length &&
                    !indexedFacts.addresses.length &&
                    !indexedFacts.contaminants.length &&
                    !indexedFacts.labs.length && <dd>Nothing extracted from this page yet.</dd>}
                </dl>
              ) : (
                <p className="small muted">Not indexed yet.</p>
              )}
              <p className="small">
                We show private identities only when redacted or absent from the record as released. Appearance in a
                record implies nothing about anyone.{' '}
                <Link href="/personal-information">Policy, reporting and response times →</Link>
              </p>
              <a className="report-link" href={`/personal-information#report`}>
                Report personal information that should have been redacted ↗
              </a>
            </section>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
