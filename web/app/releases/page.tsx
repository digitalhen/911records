import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { APP_VERSION, RELEASES } from '@/lib/releases';
import { socialMeta } from '@/lib/seo/social';

const RELEASES_TITLE = 'Releases';
const RELEASES_DESCRIPTION = `Version history of 911records.org, currently v${APP_VERSION}.`;
// SEO audit (issue: SEO audit): this page had no canonical/Open Graph/Twitter metadata — every
// other route goes through socialMeta()/pageMetadata(), this one was hand-rolled and missed both.
export const metadata: Metadata = {
  title: RELEASES_TITLE,
  description: RELEASES_DESCRIPTION,
  alternates: { canonical: '/releases' },
  ...socialMeta(RELEASES_TITLE, RELEASES_DESCRIPTION, '/releases'),
};

export default function Releases() {
  return (
    <>
      <Header active="/about" />
      <main id="main" className="page">
        <div className="page-title"><div><div className="eyebrow">This site</div><h1>Releases</h1>
          <p className="subtitle">What changed on 911records.org, newest first. The City&rsquo;s own record changes are under <a href="/changes">Releases &amp; changes</a>.</p></div></div>
        {RELEASES.map((r) => (
          <section key={r.version} className="release">
            <h2>v{r.version} <span className="muted small">· {r.date}</span></h2>
            <ul>{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </section>
        ))}
      </main>
      <Footer />
    </>
  );
}
