import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { APP_VERSION, RELEASES } from '@/lib/releases';

export const metadata: Metadata = { title: 'Releases', description: `Version history of 911records.nyc, currently v${APP_VERSION}.` };

export default function Releases() {
  return (
    <>
      <Header active="/about" />
      <main id="main" className="page">
        <div className="page-title"><div><div className="eyebrow">This site</div><h1>Releases</h1>
          <p className="subtitle">What changed on 911records.nyc, newest first. The City&rsquo;s own record changes are under <a href="/changes">Releases &amp; changes</a>.</p></div></div>
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
