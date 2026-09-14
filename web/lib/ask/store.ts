// Answer permalinks: app.answers (schema `app`, DDL in lib/runtimeSchema.ts).
// Only a validated, non-empty answer is ever stored — insufficient-evidence
// and refusal turns render directly on /ask and get no permalink, because
// there is nothing frozen worth a stable URL for (docs/PLAN.md URL scheme:
// "/ask?q= -> /a/<id>").
import { randomUUID } from 'crypto';
import { query, queryOne } from '../db';
import { ensureRuntimeSchema } from '../runtimeSchema';
import type { AskPlan } from './plan';
import type { AskAnswer } from './answer';
import type { RetrievedPage } from './retrieve';
import type { ListResult } from './lists';

export interface StoredCite {
  doc: string;
  page: number;
  batesPage: string;
  agency: string | null;
  volume: string | null;
  box: string | null;
  folder: string | null;
}

export interface AnswerRow {
  id: string;
  q: string;
  plan: AskPlan;
  answer: AskAnswer;
  cites: StoredCite[];
  model: string;
  usage: Record<string, unknown>;
  created_at: string;
  /** B17 (follow-ups): the answer row this turn was asked from, or null for
   *  a root question. See getAnswerChain. */
  parent_id: string | null;
  /** B21 (issue #35): the frozen table for a plan.kind === 'list' answer, or null for every
   *  ordinary question/refuse/offtopic row. See lib/ask/listExec.ts's runList. */
  list_result: ListResult | null;
  /** B24 ("refresh a frozen answer"): the answer row this one replaced, or null if this row was
   *  never a refresh. Set once at save time, never mutated. */
  refreshed_from: string | null;
  /** B24: the answer row that replaced THIS one, or null while this is still the current version.
   *  Set after the fact by markSuperseded, on the OLD row, once the refresh's new row is saved. */
  superseded_by: string | null;
}

/** An empty AskAnswer — what a 'list' row's `answer` column carries, since that column stays
 *  NOT NULL for every row (list answers write list_result instead; see runtimeSchema.ts). */
export const EMPTY_ASK_ANSWER: AskAnswer = { sentences: [], notEstablished: [], followUps: [] };

export async function saveAnswer(args: {
  q: string;
  plan: AskPlan;
  answer: AskAnswer;
  pages: RetrievedPage[];
  model: string;
  usage: Record<string, unknown>;
  /** B17: set when this turn is a follow-up on an existing answer. */
  parentId?: string | null;
  /** B21: set for a plan.kind === 'list' answer — see EMPTY_ASK_ANSWER above. */
  listResult?: ListResult | null;
  /** B24: set when this row is a refresh of an existing answer — see lib/ask/store.ts's
   *  markSuperseded, called on the OLD row right after this new one is saved. */
  refreshedFrom?: string | null;
}): Promise<string> {
  await ensureRuntimeSchema();
  const id = randomUUID();
  const cites: StoredCite[] = args.pages.map((p) => ({
    doc: p.doc,
    page: p.page,
    batesPage: p.batesPage,
    agency: p.agency,
    volume: p.volume,
    box: p.box,
    folder: p.folder,
  }));
  await query(
    `INSERT INTO app.answers (id, q, plan, answer, cites, model, usage, parent_id, list_result, refreshed_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      args.q,
      JSON.stringify(args.plan),
      JSON.stringify(args.answer),
      JSON.stringify(cites),
      args.model,
      JSON.stringify(args.usage),
      args.parentId ?? null,
      args.listResult ? JSON.stringify(args.listResult) : null,
      args.refreshedFrom ?? null,
    ],
  );
  return id;
}

/** The newest stored root answer for the same question text (case/whitespace-insensitive), not
 *  superseded, written in the last 30 days — so a suggested question that has already been
 *  answered opens instantly instead of re-planning, re-retrieving and re-writing (2026-09-14,
 *  founder: "shouldn't this suggested question be coming from a cached page"). A follow-up
 *  (parent_id set) is never reused as a root answer. "Refresh this answer" bypasses this. */
export async function findRecentAnswer(q: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM app.answers
      WHERE lower(regexp_replace(q, '\\s+', ' ', 'g')) = lower(regexp_replace($1, '\\s+', ' ', 'g'))
        AND parent_id IS NULL AND superseded_by IS NULL
        AND created_at > now() - interval '30 days'
      ORDER BY created_at DESC LIMIT 1`,
    [q.trim()],
  );
  return row?.id ?? null;
}

export async function getAnswer(id: string): Promise<AnswerRow | null> {
  return queryOne<AnswerRow>('SELECT * FROM app.answers WHERE id = $1', [id]);
}

/** B24: marks `oldId` as superseded by `newId`, once the refresh's new row is safely saved. Never
 *  touches any other column on the old row — the old permalink's own content stays frozen exactly
 *  as it was written; only this pointer changes. */
export async function markSuperseded(oldId: string, newId: string): Promise<void> {
  await query('UPDATE app.answers SET superseded_by = $2 WHERE id = $1', [oldId, newId]);
}

/** The Bates pages an answer's SENTENCES actually cite (a subset of `cites`,
 *  which holds every page retrieved that turn) — what a follow-up's planner
 *  call is given as "the parent's cited page ids" (issue #23). */
export function citedBatesPages(row: Pick<AnswerRow, 'answer'>): string[] {
  return [...new Set(row.answer.sentences.flatMap((s) => s.cites))];
}

const MAX_CHAIN_DEPTH = 25;

/**
 * The full thread `id` belongs to, root first and `id`'s own row last — what
 * /a/[id] renders (prior turns compact, the leaf in full). A follow-up is
 * only ever created from an existing answer row (app/ask/page.tsx), so a
 * cycle should be impossible; MAX_CHAIN_DEPTH just keeps a bad row from
 * turning into an unbounded query loop rather than trusting that.
 */
export async function getAnswerChain(id: string): Promise<AnswerRow[]> {
  const chain: AnswerRow[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current) && chain.length < MAX_CHAIN_DEPTH) {
    seen.add(current);
    const row = await getAnswer(current);
    if (!row) break;
    chain.unshift(row);
    current = row.parent_id;
  }
  return chain;
}
