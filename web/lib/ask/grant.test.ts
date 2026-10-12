import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueAskGrant, consumeAskGrant, askRequestHash } from './grant';

test('grants bind the question, parent, refresh and mode', () => {
  const sp = { q: 'question', parent: 'parent', refresh: 'refresh', mode: 'question' };
  for (const key of Object.keys(sp)) assert.notEqual(askRequestHash(sp), askRequestHash({ ...sp, [key]: 'changed' }));
  assert.equal(askRequestHash({ q: 'question' }), askRequestHash({ q: ['question'], mode: '' }));
});

test('shared database grants reject tampering, expiry, wrong requests, replay and concurrent use', {
  skip: process.env.RUN_ASK_GRANT_DB_TESTS !== '1',
}, async () => {
  const { query, pool, readPool } = await import('../db');
  const sp = { q: `CAPTCHA integration test ${Date.now()}`, mode: 'question' };
  try {
    const token = await issueAskGrant(sp);
    assert.equal(await consumeAskGrant({ ...sp, q: 'different question' }, token), false);
    assert.equal(await consumeAskGrant(sp, token + 'x'), false);
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeAskGrant(sp, token)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await consumeAskGrant(sp, token), false);
    const expired = await issueAskGrant(sp);
    await query('UPDATE app.ask_captcha_grants SET expires_at = now() - interval \'1 second\' WHERE request_hash = $1', [askRequestHash(sp)]);
    assert.equal(await consumeAskGrant(sp, expired), false);
  } finally {
    await query('DELETE FROM app.ask_captcha_grants WHERE request_hash = $1', [askRequestHash(sp)]);
    await pool.end();
    await readPool?.end();
  }
});
