import { formatDate } from '@/lib/dates';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SearchBox } from '@/components/SearchBox';
import { getMeta, getLatestSnapshot, siteSchemaReady } from '@/lib/site';

export const metadata: Metadata = {
  title: '9/11 City Records — search and read the released records',
  alternates: { canonical: '/' },
};

export const dynamic = 'force-dynamic';

// NOTE: this is the B1 scaffold home page — search box, collection summary,
// latest snapshot only. Agent B2 (docs/PLAN.md workstream table) finishes the
// home page: suggested questions, recent releases panel, browse/topic/map
// entry points, the "reading these records" note.
export default async function HomePage() {
  const [ready, meta, snapshot] = await Promise.all([siteSchemaReady(), getMeta(), getLatestSnapshot()]);

  // snapshots.{documents,pages} are the catalog's authoritative corpus-wide
  // totals; meta.counts.{documents,pages} are the pipeline's own processed
  // row counts (pages, notably, lags the true total until extraction and
  // OCR catch up) — prefer the snapshot for what the collection summary
  // should say the collection actually is.
  const documents = snapshot?.documents ?? meta?.documents ?? null;
  const pages = snapshot?.pages ?? meta?.pages ?? null;

  return (
    <>
      <Header active="/" edition={snapshot ? `${formatDate(snapshot.date)} release` : undefined} />
      <main id="main">
        <div className="home-top">
          <section className="home-intro">
            <div className="eyebrow">Public records / September 11, 2001</div>
            <h1>
              Find the record.
              <br />
              Read it for yourself.
            </h1>
            <p className="subtitle">
              New York City&apos;s released 9/11 documents, mirrored locally and searchable by keyword, address or
              Bates number.
            </p>
            <SearchBox />
          </section>
          <aside className="collection-summary">
            <div className="eyebrow">The collection</div>
            <div className="collection-stats">
              <div className="stat">
                <strong>{documents !== null ? documents.toLocaleString() : '—'}</strong>
                <span>PDF documents</span>
              </div>
              <div className="stat">
                <strong>{pages !== null ? pages.toLocaleString() : '—'}</strong>
                <span>Bates-numbered pages</span>
              </div>
            </div>
            <p>
              Released by the NYC Law Department. Environmental sampling, correspondence and other City records,
              mirrored here and updated as the City releases more.
            </p>
            {!ready && (
              <p className="error-note">
                Collection index not built yet (schema <code>site</code> is missing from the database). Waiting on
                the pipeline&apos;s first build.
              </p>
            )}
          </aside>
        </div>
        <div className="fixture">
          <strong>In progress.</strong> This is the foundation build (workstream B1): search and the document viewer
          are live; Ask, browse, entities, topics, the building map and the case folder ship in later stages.
        </div>
      </main>
      <Footer />
    </>
  );
}
