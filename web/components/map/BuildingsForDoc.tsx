import { buildingsForDoc } from '@/lib/map/data';
import { buildingUrl, pageUrl } from '@/lib/map/types';
export default async function BuildingsForDoc({ doc }: { doc: string }) {
  const places = await buildingsForDoc(doc);
  if (!places.length) return null;
  return <section aria-label="Buildings mentioned in this document">
    <h2>Buildings in this record</h2>
    <p className="small muted">Machine-extracted building matches; verify each source. Buildings, never households.</p>
    <ul>{places.map(p=><li key={p.id}><a href={buildingUrl(p)}>{p.label}</a> · {p.n_pages} pages · confidence {p.confidence?.toFixed(2) ?? 'not available'} · <a href={pageUrl(p)}>verify page {p.page}</a></li>)}</ul>
  </section>;
}
