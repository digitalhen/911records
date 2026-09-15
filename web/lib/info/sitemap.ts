import { formatDate } from '@/lib/dates';
import 'server-only';
import { snapshots } from './catalog';
/** B6/coordinator can include these in the shared sitemap index without changing B2 routes. */
export async function informationSitemapPaths(): Promise<string[]> {
  const rows = await snapshots();
  return ['/contradictions', '/browse', '/changes', '/personal-information', '/privacy', '/terms', '/about', '/reading', ...rows.map(row => `/changes/${encodeURIComponent(formatDate(row.date))}`)];
}
