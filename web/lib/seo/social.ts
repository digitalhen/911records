import type { Metadata } from 'next';

/** Open Graph + Twitter card fields (docs/PLAN.md SEO section), shared so
 *  every route's generateMetadata gets the same shape instead of only the
 *  root layout's generic ones (Next inherits a parent's `openGraph`/
 *  `twitter` object whole when a child doesn't set its own — so leaving
 *  these out means every page shows the homepage's card). Spread the result
 *  into a route's returned Metadata. */
export function socialMeta(title: string, description: string | undefined, path: string): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    // The site card (app/opengraph-image.tsx) on every page — QA 2026-09-14 found only the home
    // page carried an og:image while every page declared summary_large_image.
    openGraph: { title, description, url: path, type: 'website', images: [{ url: '/opengraph-image', width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description, images: ['/opengraph-image'] },
  };
}
