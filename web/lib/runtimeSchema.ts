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
