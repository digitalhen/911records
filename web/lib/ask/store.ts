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
}

export async function saveAnswer(args: {
  q: string;
  plan: AskPlan;
  answer: AskAnswer;
  pages: RetrievedPage[];
  model: string;
  usage: Record<string, unknown>;
  /** B17: set when this turn is a follow-up on an existing answer. */
  parentId?: string | null;
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
    `INSERT INTO app.answers (id, q, plan, answer, cites, model, usage, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      args.q,
      JSON.stringify(args.plan),
      JSON.stringify(args.answer),
      JSON.stringify(cites),
      args.model,
      JSON.stringify(args.usage),
      args.parentId ?? null,
    ],
  );
  return id;
}

export async function getAnswer(id: string): Promise<AnswerRow | null> {
  return queryOne<AnswerRow>('SELECT * FROM app.answers WHERE id = $1', [id]);
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
