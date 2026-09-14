import type { Metadata } from 'next';

/** Open Graph + Twitter card fields (docs/PLAN.md SEO section), shared so
 *  every route's generateMetadata gets the same shape instead of only the
 *  root layout's generic ones (Next inherits a parent's `openGraph`/
 *  `twitter` object whole when a child doesn't set its own — so leaving
 *  these out means every page shows the homepage's card). Spread the result
 *  into a route's returned Metadata. */
export function socialMeta(title: string, description: string | undefined, path: string): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: { title, description, url: path, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}
