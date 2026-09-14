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
}

export async function saveAnswer(args: {
  q: string;
  plan: AskPlan;
  answer: AskAnswer;
  pages: RetrievedPage[];
  model: string;
  usage: Record<string, unknown>;
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
    `INSERT INTO app.answers (id, q, plan, answer, cites, model, usage)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, args.q, JSON.stringify(args.plan), JSON.stringify(args.answer), JSON.stringify(cites), args.model, JSON.stringify(args.usage)],
  );
  return id;
}

export async function getAnswer(id: string): Promise<AnswerRow | null> {
  return queryOne<AnswerRow>('SELECT * FROM app.answers WHERE id = $1', [id]);
}
