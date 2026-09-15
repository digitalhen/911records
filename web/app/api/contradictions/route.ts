import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import { ensureRuntimeSchema } from '@/lib/runtimeSchema';
import { submissionHandler } from '@/lib/contradictions/submissions';

export const runtime = 'nodejs';
export const POST = submissionHandler(async data => {
  await ensureRuntimeSchema();
  const id = randomUUID();
  await query('INSERT INTO app.contradiction_submissions (id, kind, sources, note) VALUES ($1, $2, $3, $4)', [id, data.kind, data.sources, data.note]);
  return id;
});
