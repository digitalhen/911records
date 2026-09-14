const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

export interface Crumb {
  name: string;
  /** Site-relative path, e.g. "/browse". Omit for the current page. */
  path?: string;
}

/** BreadcrumbList JSON-LD (docs/PLAN.md SEO section: "BreadcrumbList on
 *  doc/browse/entity/building pages"). Mirrors whatever visual breadcrumb
 *  (`.bread`) the page already renders — this is the same trail, typed for
 *  search engines. */
export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: `${SITE_URL}${c.path}` } : {}),
    })),
  };
}
