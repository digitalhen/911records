import assert from 'node:assert/strict';
import test from 'node:test';

// db.ts builds its pool on first import, so point it at the test database before anything loads.
if (process.env.RATE_LIMIT_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.RATE_LIMIT_TEST_DATABASE_URL;

// Memory store: the default (RATE_LIMIT_STORE unset).
test('memory: allows max per window, then rejects with a retry time', async () => {
  delete process.env.RATE_LIMIT_STORE;
  const { hit } = await import('./rateLimit.ts');
  for (let i = 0; i < 3; i++) assert.equal((await hit('t1', 'ip', 3, 60_000)).ok, true);
  const r = await hit('t1', 'ip', 3, 60_000);
  assert.equal(r.ok, false);
  assert.ok(r.retryAfter > 0 && r.retryAfter <= 60);
  assert.equal((await hit('t1', 'other-ip', 3, 60_000)).ok, true, 'keys are independent');
  assert.equal((await hit('t2', 'ip', 3, 60_000)).ok, true, 'scopes are independent');
});

test('memory: the window resets', async () => {
  const { hit } = await import('./rateLimit.ts');
  assert.equal((await hit('t3', 'ip', 1, 30)).ok, true);
  assert.equal((await hit('t3', 'ip', 1, 30)).ok, false);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal((await hit('t3', 'ip', 1, 30)).ok, true);
});

// Postgres store: needs a database (RATE_LIMIT_TEST_DATABASE_URL); skipped otherwise.
test('postgres: one limit shared by concurrent callers', { skip: !process.env.RATE_LIMIT_TEST_DATABASE_URL }, async () => {
  process.env.RATE_LIMIT_STORE = 'postgres';
  const { query } = await import('./db.ts');
  const { RUNTIME_DDL } = await import('./runtimeSchema.ts');
  await query('CREATE SCHEMA IF NOT EXISTS app');
  // Only the rate-limit table: the rest of RUNTIME_DDL depends on earlier migrations.
  await query(RUNTIME_DDL.slice(RUNTIME_DDL.indexOf('CREATE TABLE IF NOT EXISTS app.rate_limits')));
  await query('DELETE FROM app.rate_limits');
  const { hit } = await import('./rateLimit.ts');
  const results = await Promise.all(Array.from({ length: 50 }, () => hit('pg', '1.2.3.4', 20, 60_000)));
  assert.equal(results.filter((r) => r.ok).length, 20, 'exactly max allowed across concurrent callers');
  const rejected = results.find((r) => !r.ok)!;
  assert.ok(rejected.retryAfter > 0 && rejected.retryAfter <= 60);
  assert.equal((await hit('pg', '5.6.7.8', 20, 60_000)).ok, true);
  await query(`UPDATE app.rate_limits SET reset_at = now() - interval '1 second' WHERE key = 'pg:1.2.3.4'`);
  assert.equal((await hit('pg', '1.2.3.4', 20, 60_000)).ok, true, 'expired window restarts');
  const { pool } = await import('./db.ts');
  await pool.end();
});
