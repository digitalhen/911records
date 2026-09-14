// Per-IP rate limit for Ask's model path: 20/hour (docs/PLAN.md). In-memory,
// so this is PER PROCESS — with two Dokploy replicas (docs/PLAN.md HA note)
// behind one Cloudflare tunnel, an IP that gets load-balanced across both
// effectively gets up to 2x this limit, and every count resets on a deploy
// or restart. That is an accepted looseness for v1 abuse control, not a
// precise quota; a shared counter (e.g. in Postgres or Redis) would be
// needed for an exact cluster-wide limit.
const WINDOW_MS = 60 * 60 * 1000;
export const ASK_RATE_LIMIT_PER_HOUR = 20;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory: an unbounded Map keyed by client IP is a slow leak over a
// long-running process. Trimmed opportunistically on write, not on a timer.
const MAX_TRACKED_IPS = 5_000;

export function allowAskRequest(ip: string): boolean {
  const now = Date.now();
  const existing = buckets.get(ip);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    if (buckets.size > MAX_TRACKED_IPS) {
      for (const [key, b] of buckets) {
        if (now - b.windowStart >= WINDOW_MS) buckets.delete(key);
      }
    }
    return true;
  }
  if (existing.count >= ASK_RATE_LIMIT_PER_HOUR) return false;
  existing.count += 1;
  return true;
}

/** Best-effort client IP from the headers Cloudflare/Next put on the request. */
export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf;
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return 'unknown';
}
