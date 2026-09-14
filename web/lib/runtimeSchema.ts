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

-- B22 ("What others are reading", issue #36): editorially pre-seeded and data-
-- derived entry points into notable documents, refreshed nightly by
-- web/scripts/seed-reading.ts (see lib/reading/*). "group" is a display
-- section ('Start here', 'Sampling and results', 'What the City knew',
-- 'Buildings'); "rank" orders within a group and, blended with recent
-- app.doc_views, across the whole home-page list. The seed script never
-- writes a cover sheet or a document whose folder label reads as a private
-- individual's name (lib/reading/nameSafety.ts) — see COMMON-web.md's
-- privacy rules.
CREATE TABLE IF NOT EXISTS app.reading_seeds (
  doc TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  "group" TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reading_seeds_group_rank_idx ON app.reading_seeds ("group", rank);

-- B22: aggregate, anonymous per-day view counts, incremented once per document
-- page load by the /api/v beacon (navigator.sendBeacon, no cookies). Never a
-- user identifier, session id or IP address — a document+day counter only,
-- so this table carries no personal data at all.
CREATE TABLE IF NOT EXISTS app.doc_views (
  doc TEXT NOT NULL,
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc, day)
);
CREATE INDEX IF NOT EXISTS doc_views_day_idx ON app.doc_views (day);
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
