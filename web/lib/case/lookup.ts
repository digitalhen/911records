// Server-only helpers for the case folder's API routes (app/api/case/*).
// Saved items live in the browser's localStorage and carry only what was
// known at save time; these refresh the rest against Postgres each time the
// /case page loads — catching a removal, redaction change or corrected
// folder label since the page was saved. Never imported from a 'use client'
// file (COMMON-web.md).
import { queryReadSafe } from '@/lib/db';
import { moreLikeThis } from '@/lib/discovery/moreLikeThis';

export interface CaseDocMeta {
  doc: string;
  bates_end: string | null;
  folder: string | null;
  box: string | null;
  agency: string | null;
  volume: string | null;
  official_url: string | null;
  status: string | null;
  removed_at: string | null;
}

export async function lookupDocs(docs: string[]): Promise<Record<string, CaseDocMeta>> {
  const unique = [...new Set(docs)].slice(0, 500);
  if (!unique.length) return {};
  const rows = await queryReadSafe<CaseDocMeta>(
    `SELECT doc, bates_end, folder, box, agency, volume, official_url, status, removed_at
     FROM site.documents WHERE doc = ANY($1::text[])`,
    [unique],
  );
  return Object.fromEntries(rows.map((r) => [r.doc, r]));
}

export interface CaseSuggestion {
  doc: string;
  page: number;
  score: number;
  reason: string;
}

/** Case-folder suggestions: run the existing more-like-this vector search
 *  (lib/discovery/moreLikeThis.ts, same helper /a/[id] and /doc use) from
 *  each saved page, pool the results, drop anything already saved, and keep
 *  the strongest match per document. Capped to a handful of saved pages so
 *  one large case folder can't fan out into dozens of OpenSearch calls. */
export async function suggestForCase(
  saved: { doc: string; page: number; label: string }[],
): Promise<{ suggestions: CaseSuggestion[]; unavailable: boolean }> {
  if (!saved.length) return { suggestions: [], unavailable: false };
  const savedKeys = new Set(saved.map((s) => `${s.doc}:${s.page}`));
  const basis = saved.slice(-8);
  const results = await Promise.all(basis.map((s) => moreLikeThis(s.doc, s.page).catch(() => ({ hits: [], unavailable: true }))));

  const unavailable = results.every((r) => r.unavailable) && results.length > 0;
  const best = new Map<string, CaseSuggestion>();
  results.forEach((result, i) => {
    const from = basis[i]!;
    for (const hit of result.hits) {
      const key = `${hit.doc}:${hit.page}`;
      if (savedKeys.has(key)) continue;
      const existing = best.get(key);
      if (existing && existing.score >= hit.score) continue;
      best.set(key, {
        doc: hit.doc,
        page: hit.page,
        score: hit.score,
        reason: `Similar in content to ${from.label} (saved in your case folder).`,
      });
    }
  });

  return {
    suggestions: [...best.values()].sort((a, b) => b.score - a.score).slice(0, 8),
    unavailable,
  };
}
