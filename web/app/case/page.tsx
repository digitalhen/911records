import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { CaseFolderApp } from '@/components/case/CaseFolderApp';
import { socialMeta } from '@/lib/seo/social';

// Browser-local, per-visitor content (docs/PLAN.md: "/case | case folder,
// browser-local"). Nothing here is personalized server-side, but there is
// nothing worth a search engine indexing either — robots.txt already
// disallows /case; this is the belt-and-suspenders metadata to match
// /ask, /a/[id] and /search.
export function generateMetadata(): Metadata {
  const title = 'Case folder';
  const description = 'Saved pages, notes and an exhibit list — stored in this browser only. No account, no cloud sync.';
  return {
    title,
    description,
    alternates: { canonical: '/case' },
    robots: { index: false, follow: false },
    ...socialMeta(title, description, '/case'),
  };
}

export default function CasePage() {
  return (
    <>
      <Header active="/case" />
      <main id="main">
        <CaseFolderApp />
      </main>
      <Footer />
    </>
  );
}
