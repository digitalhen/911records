import type { Metadata, Viewport } from 'next';
import './globals.css';
import Analytics from '@/components/Analytics';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: '9/11 City Records — independent records explorer',
    template: '%s · 9/11 City Records',
  },
  description:
    "A search and reading tool over New York City's released 9/11 records: 24,436 documents, 172,537 Bates-numbered pages, released by the NYC Law Department and mirrored here as the City updates it.",
  openGraph: {
    type: 'website',
    siteName: '9/11 City Records',
    title: '9/11 City Records — independent records explorer',
    description: "Search and read New York City's released 9/11 records by keyword, address or Bates number.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { colorScheme: 'light', width: 'device-width', initialScale: 1 };

const orgJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Cleartext Labs',
  url: SITE_URL,
  description:
    'Cleartext Labs builds independent, citation-first tools over public records. 9/11 City Records is not affiliated with the City of New York.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }} />
        {/* Google Analytics (gtag.js), off unless NEXT_PUBLIC_GA_ID is set —
            see lib/analytics.ts. */}
        <Analytics />
      </body>
    </html>
  );
}
