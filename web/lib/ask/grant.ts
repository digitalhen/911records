import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { captchaConfig } from '../downloads/captcha';
import { query } from '../db';
import { ensureRuntimeSchema } from '../runtimeSchema';
import { getStr, type SearchParamsInput } from '../searchUrl';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const askRequestHash = (sp: SearchParamsInput) => hash(JSON.stringify(
  [captchaConfig()?.testMode ? 'preview' : 'live', ...['q', 'parent', 'refresh', 'mode'].map(key => getStr(sp, key) || '')],
));

export async function issueAskGrant(sp: SearchParamsInput): Promise<string> {
  await ensureRuntimeSchema();
  await query('DELETE FROM app.ask_captcha_grants WHERE expires_at <= now()');
  const token = randomBytes(32).toString('hex');
  await query(`INSERT INTO app.ask_captcha_grants (token_hash, request_hash, expires_at)
    VALUES ($1, $2, now() + interval '2 minutes')`, [hash(token), askRequestHash(sp)]);
  return token;
}

/** Atomic deletion on the primary prevents replay and races across replicas. */
export async function consumeAskGrant(sp: SearchParamsInput, token?: string): Promise<boolean> {
  if (!captchaConfig() || !token || !/^[a-f0-9]{64}$/.test(token)) return false;
  try {
    await ensureRuntimeSchema();
    const rows = await query(`DELETE FROM app.ask_captcha_grants
      WHERE token_hash = $1 AND request_hash = $2 AND expires_at > now()
      RETURNING token_hash`, [hash(token), askRequestHash(sp)]);
    return rows.length === 1;
  } catch {
    console.error('[ask] CAPTCHA grant could not be consumed; blocking AI');
    return false;
  }
}
