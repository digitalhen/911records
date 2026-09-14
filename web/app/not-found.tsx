import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SearchBox } from '@/components/SearchBox';
import { EmptyState } from '@/components/ui';

// Next's special not-found convention (docs/PLAN.md SEO section: "a 404
// page with search box"). Applies to any route that calls notFound() or
// that simply doesn't exist. Genuinely missing/removed documents get their
// own handling: middleware.ts rewrites removed docs to /gone with a real
// 410, and this page still renders normally at a 404 status for everything
// else unmatched.
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main">
        <EmptyState eyebrow="404" title="Page not found">
          <p className="subtitle">
            That page doesn&apos;t exist, or the link is out of date. Search the records, or a Bates number, below.
          </p>
          <div className="mt-6">
            <SearchBox />
          </div>
          <p className="small muted mt-4">
            Looking for a removed record? See <Link href="/changes">releases &amp; changes</Link> — or start from{' '}
            <Link href="/">the home page</Link>.
          </p>
        </EmptyState>
      </main>
      <Footer />
    </>
  );
}
