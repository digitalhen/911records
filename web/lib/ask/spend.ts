// Daily USD spend cap for Ask's model calls (docs/PLAN.md env
// ASK_DAILY_USD_CAP, default 5). Persisted in app.ask_spend so the figure
// survives a restart, but the check-then-increment below is NOT atomic
// across the two Dokploy replicas (docs/PLAN.md HA note) — two replicas each
// read "under cap" a moment apart and can both proceed, and a burst of
// concurrent requests on ONE replica can race the same way. That means the
// cap is closer to "per replica, best-effort" than a hard ceiling: worst
// case the true daily spend overshoots by a handful of concurrent calls, not
// by a multiple of the cap. Good enough for v1; a hard cap would need an
// UPDATE ... WHERE usd < cap RETURNING pattern (a single round trip that
// reserves the call), left as a follow-up if the estimate below ever proves
// too loose in production.
import { query, queryOne } from '../db';
import { ensureRuntimeSchema } from '../runtimeSchema';

export const ASK_DAILY_USD_CAP = Number(process.env.ASK_DAILY_USD_CAP || 5);

// Per-million-token prices used to estimate spend against the daily cap. The
// defaults are Claude Haiku 4.5's list prices (the default Ask model); set
// ASK_PRICE_INPUT_PER_MTOK / ASK_PRICE_OUTPUT_PER_MTOK when you point Ask at a
// different model (docs/MODELS.md), and 0 for a local model so the cap never
// trips. Cache reads run ~0.1x the input rate, cache writes ~1.25x; both are
// folded in so the estimate tracks billing without the Admin API's cost endpoints.
function price(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const INPUT_PER_TOKEN = price('ASK_PRICE_INPUT_PER_MTOK', 1) / 1_000_000;
const OUTPUT_PER_TOKEN = price('ASK_PRICE_OUTPUT_PER_MTOK', 5) / 1_000_000;
const CACHE_READ_PER_TOKEN = INPUT_PER_TOKEN * 0.1;
const CACHE_WRITE_PER_TOKEN = INPUT_PER_TOKEN * 1.25;

export interface AskUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function estimateCostUsd(usage: AskUsage): number {
  return (
    usage.input_tokens * INPUT_PER_TOKEN +
    usage.output_tokens * OUTPUT_PER_TOKEN +
    (usage.cache_read_input_tokens ?? 0) * CACHE_READ_PER_TOKEN +
    (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE_PER_TOKEN
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today's recorded spend on THIS install (all replicas share the one primary). */
export async function getTodaySpendUsd(): Promise<number> {
  await ensureRuntimeSchema();
  const row = await queryOne<{ usd: string | number }>('SELECT usd FROM app.ask_spend WHERE day = $1', [today()]);
  return row ? Number(row.usd) : 0;
}

export async function underDailyCap(): Promise<boolean> {
  try {
    return (await getTodaySpendUsd()) < ASK_DAILY_USD_CAP;
  } catch (err) {
    // Fail closed: unavailable metering must never permit unbudgeted AI calls.
    console.error('[ask] spend check failed, blocking the call', err);
    return false;
  }
}

/** Await before continuing so a redirect cannot discard the usage write. */
export async function recordSpend(usd: number): Promise<void> {
  try {
    await ensureRuntimeSchema();
    await query(
      `INSERT INTO app.ask_spend (day, usd, calls) VALUES ($1, $2, 1)
       ON CONFLICT (day) DO UPDATE SET usd = app.ask_spend.usd + EXCLUDED.usd, calls = app.ask_spend.calls + 1`,
      [today(), usd],
    );
  } catch (err) {
    console.error('[ask] spend record failed', err);
  }
}
