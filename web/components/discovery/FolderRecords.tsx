// A cover sheet's banner links to the folder in /browse and to the next document, but doesn't
// answer "so if this is the cover sheet, where is the rest" (Henry, on /doc/NYC-WTC_000117718) —
// this renders every other document filed in the same box+folder, in Bates order, right under the
// banner. Same result-item shape used for titled document rows elsewhere (RelatedRecords, /topics,
// /browse's folder listing): title (or the folder label) as the link, doc type and page count/date
// span underneath.
import Link from 'next/link';
import { queryReadSafe } from '@/lib/db';
import { docTypeLabel } from '@/lib/docTypes';
import type { DocumentRow } from '@/lib/site';

export interface FolderRecord {
  doc: string;
  title: string | null;
  doc_type: string | null;
  page_count: number | null;
  first_date: string | null;
  last_date: string | null;
}

/**
 * Every other (non-removed, non-cover-sheet) document in the same agency/volume/box/folder as
 * `docRow`, Bates order. Clauses built per-field (`col = $n` / `col IS NULL`), not `IS NOT
 * DISTINCT FROM` — matches lib/site.ts's getNextInFolder, whose comment explains why: Postgres
 * never turns `IS NOT DISTINCT FROM` into an index condition on the documents_browse
 * (agency,volume,box,folder,doc) index, so that form falls back to a full seq scan.
 *
 * The date span comes from site.place_pages.dates, which is populated by the place-extraction
 * pass, not every document — a memo naming no address has no place_pages rows and shows no date
 * span here, which is correct (nothing was extracted), not a bug.
 */
export async function folderRecords(docRow: DocumentRow): Promise<FolderRecord[]> {
  const fields: [string, string | null][] = [
    ['agency', docRow.agency],
    ['volume', docRow.volume],
    ['box', docRow.box],
    ['folder', docRow.folder],
  ];
  const params: unknown[] = [];
  const clauses = fields.map(([col, value]) => {
    if (value === null) return `d.${col} IS NULL`;
    params.push(value);
    return `d.${col} = $${params.length}`;
  });
  params.push(docRow.doc);
  clauses.push(`d.doc <> $${params.length}`);
  return queryReadSafe<FolderRecord>(
    `SELECT d.doc, d.title, d.doc_type, d.page_count, dt.first_date, dt.last_date
     FROM site.documents d
     LEFT JOIN LATERAL (
       SELECT min(v.value) AS first_date, max(v.value) AS last_date
       FROM site.place_pages pp, jsonb_array_elements_text(COALESCE(pp.dates, '[]'::jsonb)) v(value)
       WHERE pp.doc = d.doc AND v.value ~ '^\\d{4}-\\d{2}-\\d{2}$'
     ) dt ON true
     WHERE ${clauses.join(' AND ')} AND d.status IS DISTINCT FROM 'removed' AND d.doc_type IS DISTINCT FROM 'cover_sheet'
     ORDER BY d.doc LIMIT 500`,
    params,
  );
}

export function FolderRecordsList({ records, folderLabel }: { records: FolderRecord[]; folderLabel: string | null }) {
  if (!records.length) return null;
  // Not wrapped in .discovery-grid — that's a fixed 2-column layout for side-by-side groups
  // (RelatedRecords' "same box" / "filed elsewhere"), which would leave an odd empty half-width
  // column for this single stacked list. Plain block flow, like /topics' document list.
  return (
    <div>
      {records.map((r) => (
        <article className="result-item" key={r.doc}>
          <Link href={`/doc/${encodeURIComponent(r.doc)}`}>{r.title || folderLabel || r.doc}</Link>
          {(r.title || folderLabel) && <p className="small muted mono">{r.doc}</p>}
          <p className="small muted">
            {docTypeLabel(r.doc_type) ? `${docTypeLabel(r.doc_type)} · ` : ''}
            {r.page_count ?? 1} {r.page_count === 1 ? 'page' : 'pages'}
            {r.first_date ? ` · ${r.first_date}${r.last_date && r.last_date !== r.first_date ? `–${r.last_date}` : ''}` : ''}
          </p>
        </article>
      ))}
    </div>
  );
}

export default FolderRecordsList;
