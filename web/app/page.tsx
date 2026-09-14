import HomeMap, { mapMetadata } from '@/components/map/HomeMap';
import { getMeta } from '@/lib/site';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  return mapMetadata();
}

// Dataset JSON-LD on the root (docs/PLAN.md SEO section). HomeMap itself
// stays B5's — this wraps it rather than editing that component, since the
// JSON-LD only needs the page shell, not anything HomeMap renders.
export default async function HomePage() {
  const meta = await getMeta().catch(() => null);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: '9/11 City Records',
    description:
      "New York City's released 9/11 records — Bates-numbered documents from the NYC Law Department, mirrored and made searchable. Independent project; not affiliated with the City of New York.",
    url: SITE_URL,
    isAccessibleForFree: true,
    creator: { '@type': 'Organization', name: 'Cleartext Labs', url: SITE_URL },
    ...(meta?.documents ? { size: `${meta.documents} documents` } : {}),
    ...(meta?.snapshot_date ? { dateModified: meta.snapshot_date } : {}),
    distribution: { '@type': 'DataDownload', encodingFormat: 'text/html', contentUrl: SITE_URL },
  };
  return (
    <>
      <HomeMap />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
