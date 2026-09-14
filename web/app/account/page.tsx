import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AccountPanel } from '@/components/account/AccountPanel';
import { socialMeta } from '@/lib/seo/social';

// Personalized, sign-in-gated content -- never indexed, matching /case and
// /ask's own robots handling.
export function generateMetadata(): Metadata {
  const title = 'Account';
  const description = 'Sign in with an emailed link to sync your case folder across devices and save searches for a daily digest of new matches.';
  return {
    title,
    description,
    alternates: { canonical: '/account' },
    robots: { index: false, follow: false },
    ...socialMeta(title, description, '/account'),
  };
}

export default function AccountPage() {
  return (
    <>
      <Header active="/account" />
      <main id="main">
        <div className="page-title">
          <div>
            <div className="eyebrow">No password, ever</div>
            <h1>Account</h1>
          </div>
        </div>
        <AccountPanel />
      </main>
      <Footer />
    </>
  );
}
