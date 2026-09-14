// Document-page strip (B22, issue #36): "Others also read" — up to 5
// documents linked to this one by Ask co-citation, folder filing or the
// discovery layer's own similarity (lib/reading/store.ts). Styled like the
// existing RelatedRecords/MoreLikePage discovery sections on this same page
// (same classes, same restraint) rather than inventing new CSS.
import Link from 'next/link';
import { pageHref } from '@/lib/discovery/data';
import { othersAlsoRead } from '@/lib/reading/store';

export async function OthersAlsoRead({ doc }: { doc: string }) {
  let rows: Awaited<ReturnType<typeof othersAlsoRead>> = [];
  try {
    rows = await othersAlsoRead(doc, 5);
  } catch {
    rows = [];
  }
  if (!rows.length) return null;
  return (
    <section className="discovery">
      <h2>Others also read</h2>
      <p className="small muted">
        Readers open these alongside this record — through an Ask answer, the same folder, or indexed similarity.
        Not a claim they are about the same event.
      </p>
      <div className="discovery-grid">
        <div>
          {rows.map((r) => (
            <article className="result-item" key={r.doc}>
              <Link href={pageHref(r.doc, r.page)}>
                {r.title || r.doc}
                {r.box ? ` · Box ${r.box}` : ''}
              </Link>
              {r.title && <p className="small muted mono">{r.doc}</p>}
              <p className="small muted">{r.reason}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default OthersAlsoRead;
