// Fixed-window, per-key rate limits (Ask, Ask verification, shortlinks, MCP).
//
// RATE_LIMIT_STORE picks where the counters live:
//   memory   (default) per process. With N app copies behind a load balancer a client can get up
//            to N x the limit, and counts reset on restart. 911records.org's two Dokploy replicas
//            run this way.
//   postgres one counter per key in app.rate_limits on the primary, shared by every copy: exact
//            cluster-wide limits for autoscaled deployments (deploy/aws). Costs one small upsert
//            per limited request. If Postgres errors, the call falls back to the memory counter,
//            so a database hiccup loosens limits rather than taking the endpoint down.
import { query } from './db';

export interface LimitResult {
  /** The request may proceed (and was counted). */
  ok: boolean;
  /** Seconds until the window resets (when !ok). */
  retryAfter: number;
  /** Rejected because the memory store is full of distinct keys, not because this key hit its limit. */
  busy?: boolean;
}

export interface LimitOptions {
  /**
   * Memory store only: what to do with a NEW key when MAX_KEYS distinct keys are already tracked
   * (after dropping expired ones). 'reject' answers busy; 'allow' lets it through, tracked.
   */
  overflow?: 'reject' | 'allow';
}

const MAX_KEYS = 5_000;
const memory = new Map<string, Map<string, { count: number; reset: number }>>();

export const rateLimitStore = (): 'memory' | 'postgres' =>
  (process.env.RATE_LIMIT_STORE || '').trim().toLowerCase() === 'postgres' ? 'postgres' : 'memory';

function memoryHit(scope: string, key: string, max: number, windowMs: number, opts: LimitOptions): LimitResult {
  let buckets = memory.get(scope);
  if (!buckets) memory.set(scope, (buckets = new Map()));
  const now = Date.now();
  let b = buckets.get(key);
  if (b && b.reset <= now) {
    buckets.delete(key);
    b = undefined;
  }
  if (!b) {
    if (buckets.size >= MAX_KEYS) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    if (buckets.size >= MAX_KEYS && (opts.overflow ?? 'reject') === 'reject') {
      return { ok: false, retryAfter: 5, busy: true };
    }
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
  b.count += 1;
  return { ok: true, retryAfter: 0 };
}

// One row per scope:key, updated atomically. Every request increments the count (rejected ones
// too), so a request is allowed while count <= max: the same outcome as the memory store. An
// expired window restarts at 1. Old rows are swept now and then.
const UPSERT = `
INSERT INTO app.rate_limits AS r (key, count, reset_at)
VALUES ($1, 1, now() + make_interval(secs => $2))
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.count + 1 END,
  reset_at = CASE WHEN r.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE r.reset_at END
RETURNING count, greatest(1, ceil(extract(epoch FROM r.reset_at - now())))::int AS retry`;

let lastSweep = 0;

async function postgresHit(scope: string, key: string, max: number, windowMs: number): Promise<LimitResult> {
  const rows = await query<{ count: number; retry: number }>(UPSERT, [`${scope}:${key}`, windowMs / 1000]);
  if (Date.now() - lastSweep > 10 * 60_000) {
    lastSweep = Date.now();
    void query(`DELETE FROM app.rate_limits WHERE reset_at < now() - interval '1 hour'`).catch(() => {});
  }
  const row = rows[0];
  if (!row || row.count <= max) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: row.retry };
}

/** Count one request for `key` in `scope`; `ok: false` means over `max` per `windowMs`. */
export async function hit(scope: string, key: string, max: number, windowMs: number, opts: LimitOptions = {}): Promise<LimitResult> {
  if (rateLimitStore() === 'postgres') {
    try {
      return await postgresHit(scope, key, max, windowMs);
    } catch (err) {
      console.error('[rateLimit] postgres store failed; using memory', err instanceof Error ? err.message : err);
    }
  }
  return memoryHit(scope, key, max, windowMs, opts);
}
