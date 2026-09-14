// Postgres access, modeled on ~/Code/prospect/lib/db.ts: a primary pool for
// writes and an OPTIONAL read pool for the standby, with a fallback to the
// primary when the standby is unreachable. Server-only — nothing here may be
// imported from a 'use client' component (no such import exists in this app;
// keep it that way).
//
// docs/PLAN.md: derived data (documents, pages, page_text, snapshots,
// changes, entities, ...) lives in Postgres database `sept11`, schema
// `site`, built by the pipeline (workstream A2). Runtime tables the app
// itself owns (answers, PII reports, saved-search alerts) live in schema
// `app` on the PRIMARY only — see lib/runtimeSchema.ts.
import { Pool, type PoolClient, types } from 'pg';

// bigint (int8, oid 20) arrives as a string by default so precision is not
// lost. pdf_size and snapshots.bytes are the only bigints in this schema and
// both fit comfortably in a JS number.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// numeric (oid 1700) — none in this schema today, but harmless to normalize.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const DEFAULT_URL = 'postgres://sept11:sept11@127.0.0.1:5432/sept11';

declare global {
  // eslint-disable-next-line no-var
  var __sept11Pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __sept11ReadPool: Pool | undefined;
}

/** Nothing in this app should take more than a couple hundred ms; kill anything pathological rather than queue behind it. */
const STATEMENT_TIMEOUT_MS = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 5_000);
const SESSION_OPTIONS = '-c jit=off';

function makePool(connectionString: string, applicationName: string, max: number): Pool {
  const p = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    options: SESSION_OPTIONS,
    application_name: applicationName,
  });
  // A standby restart/promotion kills idle clients; an unhandled Pool
  // 'error' event is an uncaught exception. Never let the read pool bring
  // the process down — the next query's rejection is what drives fallback.
  p.on('error', () => {});
  return p;
}

export const pool: Pool =
  globalThis.__sept11Pool ?? makePool(process.env.DATABASE_URL || DEFAULT_URL, 'sept11-records', Number(process.env.PGPOOL_MAX || 15));
if (process.env.NODE_ENV !== 'production') globalThis.__sept11Pool = pool;

const READ_URL = (process.env.DATABASE_READ_URL || '').trim() || null;
export const readPool: Pool | null = READ_URL
  ? (globalThis.__sept11ReadPool ?? makePool(READ_URL, 'sept11-records-read', Number(process.env.PGPOOL_READ_MAX || 15)))
  : null;
if (readPool && process.env.NODE_ENV !== 'production') globalThis.__sept11ReadPool = readPool;

export interface ReadPoolState {
  configured: boolean;
  lastFallbackAt: number | null;
}
let lastFallbackAt: number | null = null;

/** A read-only query. Prefers the standby; falls back to the primary (and remembers it, for /api/health) on any error. */
export async function queryRead<T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  if (readPool) {
    try {
      const res = await readPool.query(text, params as unknown[]);
      return res.rows as T[];
    } catch (err) {
      lastFallbackAt = Date.now();
      console.warn('[db] read replica query failed, falling back to primary', err instanceof Error ? err.message : err);
    }
  }
  const res = await pool.query(text, params as unknown[]);
  return res.rows as T[];
}

export async function queryReadOne<T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await queryRead<T>(text, params);
  return rows[0] ?? null;
}

/** A write (or a read that must see the primary's own writes). */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params as unknown[]);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres error code 42P01 = undefined_table — schema `site` not built yet, or a table A2 hasn't added. */
export function isUndefinedTableError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '42P01';
}

/** Runs a read that should degrade to "no data yet" rather than 500 when the pipeline's schema isn't there yet. */
export async function queryReadSafe<T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  try {
    return await queryRead<T>(text, params);
  } catch (err) {
    if (isUndefinedTableError(err)) return [];
    throw err;
  }
}

export function readPoolState(): ReadPoolState {
  return { configured: readPool !== null, lastFallbackAt };
}

export async function pingDb(timeoutMs = 1_000): Promise<boolean> {
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function pingReadPool(timeoutMs = 1_000): Promise<boolean | null> {
  if (!readPool) return null;
  try {
    await Promise.race([
      readPool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}
