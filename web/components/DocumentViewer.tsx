import { formatDate } from '@/lib/dates';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { CiteButton } from '@/components/CiteButton';
import { SaveToCaseButton } from '@/components/case/SaveToCaseButton';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import { getDocument, getPage as getSitePage, getPageText, getNextInFolder } from '@/lib/site';
import { getIndexedPage } from '@/lib/opensearch';
import { getPageBoxes } from '@/lib/boxes';
import { fileExists, pageImagePath, pageImageUrl, pdfPath } from '@/lib/files';
import { RelatedRecords } from '@/components/discovery/RelatedRecords';
import { MoreLikePage } from '@/components/discovery/MoreLikePage';
import BuildingsForDoc from '@/components/map/BuildingsForDoc';
import { OthersAlsoRead } from '@/components/reading/OthersAlsoRead';
import { ViewBeacon } from '@/components/reading/ViewBeacon';
import { Button, ButtonLink } from '@/components/ui';
import { browseUrl } from '@/lib/info/catalog';
import { buildingsForDoc, resolveBuildingRedirect } from '@/lib/map/data';
import { buildingUrl } from '@/lib/map/types';
import { docTypeLabel } from '@/lib/docTypes';

interface CoverSheetLinks {
  folderHref: string;
  nextHref: string | null;
  buildingHref: string | null;
}

/** Cover-sheet-only lookups (issue #28): the folder listing, the next Bates-ordered document filed
 *  in the same folder, and the building page when a BIN resolves for this document's page. Never
 *  called for a non-cover-sheet document, so the extra queries only happen where they're used. */
async function coverSheetLinks(docRow: NonNullable<Awaited<ReturnType<typeof getDocument>>>, doc: string): Promise<CoverSheetLinks> {
  const [nextDoc, places] = await Promise.all([getNextInFolder(docRow), buildingsForDoc(doc)]);
  let buildingHref: string | null = null;
  const place = places[0];
  if (place) {
    if (place.kind === 'bin') {
      buildingHref = buildingUrl(place);
    } else {
      const bin = await resolveBuildingRedirect(place);
      buildingHref = bin ? `/building/${encodeURIComponent(bin)}` : buildingUrl(place);
    }
  }
  return {
    folderHref: browseUrl([docRow.agency, docRow.volume, docRow.box, docRow.folder], docRow.source ?? ''),
    nextHref: nextDoc ? `/doc/${encodeURIComponent(nextDoc.doc)}` : null,
    buildingHref,
  };
}

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

  const isCoverSheet = !removed && docRow.doc_type === 'cover_sheet';
  const [pageText, boxes, indexedFacts, sitePage, coverSheet] = await Promise.all([
    getPageText(doc, page),
    getPageBoxes(agency, volume, doc, page),
    getIndexedPage(doc, page),
    getSitePage(doc, page),
    isCoverSheet ? coverSheetLinks(docRow, doc) : Promise.resolve(null),
  ]);

  // The files service has no listing endpoint, so "does this page have a
  // rendered image yet" is a HEAD request, not a filesystem stat (this app
  // has no bind mount to data/ — see lib/files.ts).
  const hasImage = await fileExists(pageImageUrl(agency, volume, doc, page));
  const bates = sitePage?.bates || doc;

  const citation = `NYC Law Department, ${bates}. Mirrored by 911records.nyc (independent project; not affiliated with the City of New York). Official record: ${docRow.official_url || 'see City portal'}.`;

  const jsonLdBreadcrumb = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Document results', path: '/search' },
    { name: docRow.box || 'Unboxed' },
    { name: docRow.folder || doc, path: `/doc/${doc}` },
  ]);

  return (
    <>
      <Header active="/ask" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBreadcrumb) }} />
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

        {coverSheet && (
          <div className="note">
            <h3>Folder cover sheet — the folder&apos;s records follow</h3>
            <p>
              This single page is a City-portal property lookup sheet (address, Block/Lot, BIN), not the folder&apos;s
              substantive records.{' '}
              <span className="derived-label">
                Machine-extracted document type · confidence {Math.round((docRow.doc_type_confidence ?? 0) * 100)}%
              </span>
            </p>
            <p className="small">
              <Link href={coverSheet.folderHref}>See the whole folder in Browse →</Link>
              {coverSheet.nextHref && (
                <>
                  {' · '}
                  <Link href={coverSheet.nextHref}>Next document in this folder →</Link>
                </>
              )}
              {coverSheet.buildingHref && (
                <>
                  {' · '}
                  <Link href={coverSheet.buildingHref}>Building page →</Link>
                </>
              )}
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
            {!removed && (
              <SaveToCaseButton
                item={{ doc, page, batesPage: bates, label: docRow.folder || doc, box: docRow.box, agency: docRow.agency, volume: docRow.volume }}
              />
            )}
            <CiteButton citation={citation} />
          </div>
        </div>

        <form className="findbar" action={`/doc/${doc}${page > 1 ? `/p/${page}` : ''}`} method="get">
          <label htmlFor="hl">Find within this page (highlights the page image)</label>
          <input id="hl" name="hl" type="search" defaultValue={highlight || ''} />
          <Button variant="secondary" size="small" type="submit">
            Find
          </Button>
          {highlight && !boxes && <span className="muted">No word-box data for this page yet.</span>}
        </form>

        <div className="viewer-shell">
          <section aria-label="Page viewer">
            <div className="viewer-toolbar">
              <div className="pager">
                <ButtonLink
                  variant="secondary"
                  size="small"
                  aria-disabled={page <= 1}
                  href={page > 2 ? `/doc/${doc}/p/${page - 1}` : `/doc/${doc}`}
                >
                  ←
                </ButtonLink>
                <span>
                  Page {page} of {pageCount}
                </span>
                <ButtonLink variant="secondary" size="small" aria-disabled={page >= pageCount} href={`/doc/${doc}/p/${page + 1}`}>
                  →
                </ButtonLink>
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
                {/* --muted (4.04:1) fails WCAG AA 4.5:1 against .scan-area's #e0e5e7 background
                    (Lighthouse a11y, issue #32 item 6); --muted-2 is the same design system's
                    darker muted token (5.61:1) and reads as the same gray label style. */}
                <div className="pane-label" style={{ color: 'var(--muted-2)' }}>
                  Page image
                </div>
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
                      <p key={i} className="ocr-text" dangerouslySetInnerHTML={{ __html: highlightText(para, highlight) }} />
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
              {docRow.doc_type && docRow.doc_type !== 'cover_sheet' && (
                <p className="small">
                  <strong>{docTypeLabel(docRow.doc_type)}</strong>
                  <span className="derived-label">
                    Machine-extracted document type · confidence {Math.round((docRow.doc_type_confidence ?? 0) * 100)}%
                  </span>
                </p>
              )}
              {indexedFacts &&
              (indexedFacts.dates.length || indexedFacts.addresses.length || indexedFacts.contaminants.length || indexedFacts.labs.length) ? (
                // Every <dd> here is paired with a preceding <dt> — a lone <dd> with no <dt> (the
                // prior "nothing extracted" fallback lived inside this same <dl>) is invalid list
                // structure and was one of the a11y issues Lighthouse flagged on this page
                // (issue #32, item 6); that fallback is its own <p> below, outside the <dl>.
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
                </dl>
              ) : indexedFacts ? (
                <p className="small muted">Nothing extracted from this page yet.</p>
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

        {!removed && (
          <>
            <ViewBeacon doc={doc} />
            <RelatedRecords doc={doc} />
            <MoreLikePage doc={doc} page={page} />
            <BuildingsForDoc doc={doc} />
            <OthersAlsoRead doc={doc} />
            <p className="small">
              <Link href={`/doc/${encodeURIComponent(doc)}/versions`}>Compare copies and versions →</Link>
            </p>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
