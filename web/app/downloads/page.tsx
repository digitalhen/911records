import Link from 'next/link';
import { PageShell } from '@/components/info/PageShell';
import { pageMetadata } from '@/lib/info/metadata';
import { currentDownloads, downloadHref, formatBytes, type Archive } from '@/lib/downloads/catalog';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return pageMetadata(
    'Download the records',
    'Download the current collection of City records as one ZIP or by box, with checksums and an inventory for keeping your copy up to date.',
    '/downloads',
  );
}

const number = (n: number) => n.toLocaleString('en-US');

function Download({ archive, label }: { archive: Archive; label: string }) {
  return (
    <div>
      <a className={styles.download} href={downloadHref(archive.name)}>
        {label} <span aria-hidden="true">↓</span>
      </a>
      <div className="small muted">{number(archive.documents)} documents · {formatBytes(archive.bytes)}</div>
      <details className={styles.checksum}>
        <summary>SHA-256 checksum</summary>
        <code>{archive.sha256}</code>
      </details>
    </div>
  );
}

export default async function Downloads({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const filter = q.trim().toLocaleLowerCase('en-US');
  const catalog = await currentDownloads().catch(() => null);
  const boxes = catalog?.boxes.filter(box =>
    [box.box || 'Box not recorded', box.agency, box.volume].some(value =>
      value?.toLocaleLowerCase('en-US').includes(filter),
    ),
  ) || [];

  return (
    <PageShell active="/downloads">
      <div className="page-title">
        <div>
          <div className="eyebrow">Take the records with you</div>
          <h1>Download the collection.</h1>
          <p className="subtitle">Original City PDFs, together in one ZIP or organized by box.</p>
          <p className="small muted">A quick verification is required before downloading. One check unlocks downloads in this browser for 12 hours.</p>
        </div>
      </div>
      {catalog ? (
        <>
          <section className={styles.full} aria-labelledby="whole-collection">
            <div>
              <h2 id="whole-collection">The whole collection</h2>
              <p>{number(catalog.full.documents)} documents · {number(catalog.full.pages)} pages</p>
              <p className="small muted">
                Catalog captured {catalog.snapshot_date || 'on an unrecorded date'}.
                {' '}Archives prepared {new Date(catalog.generated_at).toISOString().slice(0, 10)}.
              </p>
            </div>
            <Download archive={catalog.full} label="Download all PDFs" />
          </section>
          <p className={styles.note}>
            Each ZIP includes an inventory and SHA-256 checksums. PDFs retain their Bates numbers,
            grouped by agency and production volume. These downloads contain original PDFs, not
            the site’s search index, page images, or machine-generated summaries. Large archives
            use ZIP64; allow enough disk space for both the ZIP and its extracted files.
            Interrupted downloads can be resumed while that archive remains current.
          </p>
          <section aria-labelledby="boxes">
            <h2 id="boxes">Download by box</h2>
            <p className="muted">
              Boxes are separated by agency and production volume. Records without a box label are included too.
            </p>
            <form className={styles.filter} action="/downloads">
              <label htmlFor="box-filter">Find a box, agency, or volume</label>
              <div>
                <input id="box-filter" name="q" type="search" defaultValue={q} />
                <button type="submit">Filter boxes</button>
                {q && <Link href="/downloads">Clear</Link>}
              </div>
            </form>
            <p className="small muted">{number(boxes.length)} of {number(catalog.boxes.length)} boxes</p>
            <div className={styles.grid}>
              {boxes.map(box => (
                <article className={styles.box} key={box.name}>
                  <h3>{box.box || 'Box not recorded'}</h3>
                  <p className="small muted">
                    {box.agency || 'Agency not recorded'}<br />{box.volume || 'Volume not recorded'}
                  </p>
                  <Download archive={box} label={`Download ${box.box || 'unlabelled records'}`} />
                </article>
              ))}
            </div>
            {!boxes.length && <p>No boxes match this filter. <Link href="/downloads">Show all boxes</Link>.</p>}
          </section>
        </>
      ) : (
        <section className={styles.full}>
          <div>
            <h2>Downloads are being prepared</h2>
            <p>
              The current archives are temporarily unavailable. Please check back shortly.
              You can still <Link href="/browse">browse the records</Link>.
            </p>
          </div>
        </section>
      )}
      <section className={styles.updates} aria-labelledby="stay-current">
        <h2 id="stay-current">Keep your copy up to date</h2>
        <p>
          The collection follows the City’s catalog. Our refresh process checks for additions,
          changes and removals; a catalog capture date is not necessarily the date the City changed a record.
        </p>
        <ol>
          <li>Save the inventory included in your ZIP.</li>
          <li>
            Get the {catalog
              ? <a href="/api/downloads/manifest.json">latest inventory (JSON)</a>
              : 'latest inventory here once downloads are ready'} and compare documents by their <code>path</code>.
            For a box download, compare records in the same agency, volume, and box.
          </li>
          <li>
            Add new paths, replace PDFs whose <code>sha256</code> changed, and remove paths no longer
            listed under <code>documents</code> if you want your copy to match the current collection.
            You can download fresh boxes instead of the entire collection.
          </li>
        </ol>
        <p>
          Outdated ZIP links stop working when the catalog is refreshed. Removed PDFs are excluded
          from new downloads; the inventory retains their Bates numbers and recorded removal dates.
          Copies already downloaded cannot be recalled.
        </p>
        <p><Link href="/changes">See the catalog’s change history →</Link></p>
      </section>
    </PageShell>
  );
}
