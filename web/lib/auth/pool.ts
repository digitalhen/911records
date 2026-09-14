// A dedicated pg Pool for Better Auth, separate from lib/db.ts's pool
// (COMMON-web.md: do not edit lib/db.ts). Better Auth's Kysely/pg adapter
// issues unqualified table names ("user", "session", "account",
// "verification"); pinning this pool's session `search_path` to schema
// `app` (same primary Postgres, same DATABASE_URL) is what lands those
// tables in `app` alongside the rest of this app's runtime state, with no
// per-field `modelName`/`fieldName` remapping needed on the Better Auth side.
// See lib/runtimeSchema.ts for the actual `CREATE TABLE` statements this
// depends on -- they must match Better Auth's own column names exactly.
import { Pool } from 'pg';

const DEFAULT_URL = 'postgres://sept11:sept11@127.0.0.1:5432/sept11';

declare global {
  // eslint-disable-next-line no-var
  var __sept11AuthPool: Pool | undefined;
}

function makeAuthPool(): Pool {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_URL,
    max: Number(process.env.PGPOOL_AUTH_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 5_000),
    options: '-c search_path=app,public',
    application_name: 'sept11-records-auth',
  });
  p.on('error', () => {});
  return p;
}

export const authPool: Pool = globalThis.__sept11AuthPool ?? makeAuthPool();
if (process.env.NODE_ENV !== 'production') globalThis.__sept11AuthPool = authPool;
