// Per-IP rate limit for Ask's model path: 20/hour (docs/PLAN.md). Counters live in lib/rateLimit.ts:
// per process by default (with two replicas an IP can get up to 2x this, and counts reset on
// restart: an accepted looseness for abuse control), or shared in Postgres with
// RATE_LIMIT_STORE=postgres for autoscaled deployments.
import { hit } from '../rateLimit';

const WINDOW_MS = 60 * 60 * 1000;
export const ASK_RATE_LIMIT_PER_HOUR = 20;

export async function allowAskRequest(ip: string): Promise<boolean> {
  return (await hit('ask', ip, ASK_RATE_LIMIT_PER_HOUR, WINDOW_MS, { overflow: 'allow' })).ok;
}

/** Best-effort client IP from the headers Cloudflare/Next put on the request. */
export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf;
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return 'unknown';
}
