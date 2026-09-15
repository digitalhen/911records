import assert from 'node:assert/strict';
import test from 'node:test';
import { submissionHandler } from './submissions';

const valid = { kind: 'correction', sources: 'NYC-WTC_000145371', note: 'Please check the attribution on this page.' };
const request = (data: unknown, origin = 'https://911records.nyc') => new Request('https://911records.nyc/api/contradictions', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
test('accepts a private submission and returns only its receipt', async () => {
  let saved: unknown;
  const handler = submissionHandler(async data => { saved = data; return 'receipt'; });
  const response = await handler(request(valid));
  assert.equal(response.status, 201);
  assert.deepEqual(saved, valid);
  assert.deepEqual(await response.json(), { id: 'receipt' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('rejects foreign origins, invalid input and oversized bodies before saving', async () => {
  const handler = submissionHandler(async () => { assert.fail('Must not save'); });
  assert.equal((await handler(request(valid, 'https://example.org'))).status, 403);
  assert.equal((await handler(request({ ...valid, sources: '' }))).status, 400);
  assert.equal((await handler(request({ ...valid, note: 'x'.repeat(33000) }))).status, 413);
});
test('rate limits repeated submissions and sanitizes storage errors', async () => {
  const handler = submissionHandler(async () => { throw new Error('private database details'); });
  for (let i = 0; i < 5; i++) {
    const response = await handler(request(valid));
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('private database details'));
  }
  assert.equal((await handler(request(valid))).status, 429);
});
