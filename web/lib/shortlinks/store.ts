import { createHash, randomBytes } from 'node:crypto';
import { queryOne } from '../db';
import { ensureRuntimeSchema } from '../runtimeSchema';
import { SITE_ORIGIN, normalizeTarget, shortDocumentTarget } from './paths';

export async function createShortlink(input: string) {
  const target = normalizeTarget(input);
  const direct = shortDocumentTarget(target);
  if (direct) return { url: SITE_ORIGIN + target, short_url: direct };
  await ensureRuntimeSchema();
  const hash = createHash('sha256').update(target).digest('hex');
  for (let i = 0; i < 3; i++) {
    const code = 'r' + randomBytes(8).toString('base64url');
    const inserted = await queryOne<{ code: string }>(
      'INSERT INTO app.shortlinks (code, target_hash, target) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING code', [code, hash, target]);
    const row = inserted ?? await queryOne<{ code: string; target: string }>('SELECT code, target FROM app.shortlinks WHERE target_hash=$1', [hash]);
    if (row) return { url: SITE_ORIGIN + target, short_url: `${SITE_ORIGIN}/s/${row.code}` };
  }
  throw new Error('Could not create shortlink.');
}

export async function resolveStoredCode(code: string) {
  if (!/^r[A-Za-z0-9_-]{11}$/.test(code)) return null;
  // Primary read avoids replication lag immediately after creating a link.
  const row = await queryOne<{ target: string }>('SELECT target FROM app.shortlinks WHERE code=$1', [code]);
  return row ? normalizeTarget(row.target) : null;
}
