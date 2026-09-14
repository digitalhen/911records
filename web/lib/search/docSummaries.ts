// B27 (issue: summaries in search results): one batched Postgres lookup for
// the plain-language title/summary (site.documents.title/summary, issue #37)
// of every document on a page of search results — a single `doc = ANY($1)`
// query keyed by doc, not one query per hit. Schema-first per
// docs/briefs/COMMON-web.md: gated on documentsHaveTitles() so this degrades
// to an empty map (falling back to the OpenSearch doc_title field already
// carried on each hit) rather than a 42703 in the deploy/data-load gap.
import { queryReadSafe } from '@/lib/db';
import { documentsHaveTitles } from '@/lib/site';

export interface DocSummary {
  title: string | null;
  summary: string | null;
  summary_confidence: number | null;
}

export async function getDocSummaries(docs: string[]): Promise<Map<string, DocSummary>> {
  const unique = [...new Set(docs)];
  if (!unique.length || !(await documentsHaveTitles())) return new Map();
  const rows = await queryReadSafe<DocSummary & { doc: string }>(
    'SELECT doc, title, summary, summary_confidence FROM site.documents WHERE doc = ANY($1::text[])',
    [unique],
  );
  return new Map(rows.map((r) => [r.doc, { title: r.title, summary: r.summary, summary_confidence: r.summary_confidence }]));
}
