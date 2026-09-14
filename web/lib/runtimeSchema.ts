// Runtime tables the app itself owns — answer permalinks (B3), PII reports
// and saved-search alerts (B6) — live in schema `app` on the PRIMARY
// Postgres, never in `site` (the pipeline's schema, which the app only
// reads). Modeled on ~/Code/prospect/lib/runtimeSchema.ts: idempotent DDL run
// once per process at boot (see instrumentation.ts), safe to run on every
// replica concurrently because every statement is CREATE ... IF NOT EXISTS.
//
// B1 only creates the schema itself and a placeholder migrations table, so
// concurrent `CREATE SCHEMA IF NOT EXISTS` calls from two replicas booting
// at once have somewhere to land without racing each other. The actual
// runtime tables (answers, pii_reports, saved_searches, ...) belong to the
// workstreams that read and write them — add them here, not in a new file,
// so there is exactly one place that owns "what runtime state exists".
import { query } from './db';

export const RUNTIME_DDL = `
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.runtime_migrations (
  id SERIAL PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

-- B3 (Ask): frozen answers, permalinked at /a/<id>. Only a validated,
-- non-empty answer is ever written here — see lib/ask/store.ts.
CREATE TABLE IF NOT EXISTS app.answers (
  id TEXT PRIMARY KEY,
  q TEXT NOT NULL,
  plan JSONB NOT NULL,
  answer JSONB NOT NULL,
  cites JSONB NOT NULL,
  model TEXT NOT NULL,
  usage JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- B3 (Ask): the running daily USD total for the model calls Ask makes, so
-- ASK_DAILY_USD_CAP can be enforced across restarts — see lib/ask/spend.ts
-- for the per-replica caveat (two Dokploy replicas each enforce this cap
-- independently against the same shared total).
CREATE TABLE IF NOT EXISTS app.ask_spend (
  day DATE PRIMARY KEY,
  usd NUMERIC NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0
);

-- B17 (Ask follow-ups, issue #23): threads a follow-up turn to the answer it
-- was asked from, so /a/<id> can render the whole chain. ALTER ... ADD
-- COLUMN IF NOT EXISTS keeps this tolerant of an install where app.answers
-- already exists without the column (COMMON-web.md "schema first, code
-- second") — safe to run concurrently on every replica, like the rest of
-- this file. See lib/ask/store.ts's saveAnswer/getAnswerChain.
ALTER TABLE app.answers ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES app.answers(id);
CREATE INDEX IF NOT EXISTS answers_parent_id_idx ON app.answers (parent_id);

-- B21 (Ask "list" answers, issue #35): a list plan's rows (lib/ask/lists.ts's ListResult),
-- snapshotted at save time so the permalink stays frozen like a prose answer. NULL for every
-- ordinary question/refuse/offtopic answer row — 'answer' still carries an (empty) AskAnswer for
-- those rows so the column stays NOT NULL without a migration.
ALTER TABLE app.answers ADD COLUMN IF NOT EXISTS list_result JSONB;
`;

let ensured: Promise<void> | undefined;

export function ensureRuntimeSchema(): Promise<void> {
  ensured ??= query(RUNTIME_DDL).then(
    () => undefined,
    (err: unknown) => {
      ensured = undefined;
      throw err;
    },
  );
  return ensured;
}
