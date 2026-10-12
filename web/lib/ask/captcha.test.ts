import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAskCaptcha } from './captcha';
import type { CaptchaConfig } from '../downloads/captcha';

const config: CaptchaConfig = {
  siteKey: 'live-site-key', secretKey: 'private-key', sessionSecret: 'unused',
  testMode: false, production: true, origin: 'https://911records.org',
};
const headers = new Headers({ origin: config.origin });
const accepted = { success: true, action: 'ask_ai', hostname: '911records.org' };
const provider = (body: object, status = 200) => (async () => Response.json(body, { status })) as typeof fetch;

test('missing configuration, missing/oversize tokens and foreign origins fail before Siteverify', async () => {
  const never = (async () => { throw new Error('must not call provider'); }) as typeof fetch;
  for (const token of [null, '', ' ', 'a'.repeat(2049), 123]) {
    assert.match((await verifyAskCaptcha(token, headers, config, never))!, /verification check/);
  }
  assert.match((await verifyAskCaptcha('token', headers, null, never))!, /unavailable/);
  for (const origin of ['', 'https://evil.example', 'http://localhost:3000']) {
    assert.match((await verifyAskCaptcha('token', new Headers({ origin }), config, never))!, /on this site/);
  }
});

test('only a successful provider response with the AI action and canonical hostname authorizes', async () => {
  assert.equal(await verifyAskCaptcha('token', headers, config, provider(accepted)), null);
  for (const body of [
    {}, { ...accepted, success: false }, { ...accepted, success: 'true' },
    { ...accepted, action: 'bulk_download' }, { ...accepted, hostname: 'evil.example' },
    { success: true }, { success: false, 'error-codes': ['timeout-or-duplicate'] },
  ]) assert.ok(await verifyAskCaptcha('token', headers, config, provider(body)));
});

test('each submission verifies afresh, so a replay cannot authorize another turn', async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(init?.cache, 'no-store');
    assert.equal((init?.body as URLSearchParams).get('response'), 'single-use-token');
    return Response.json(++calls === 1 ? accepted : { success: false, 'error-codes': ['timeout-or-duplicate'] });
  }) as typeof fetch;
  assert.equal(await verifyAskCaptcha('single-use-token', headers, config, fetcher), null);
  assert.ok(await verifyAskCaptcha('single-use-token', headers, config, fetcher));
  assert.equal(calls, 2);
});

test('provider outages and malformed responses fail closed', async () => {
  for (const fetcher of [provider({}, 500), (async () => { throw new Error('timeout'); }) as typeof fetch,
    (async () => new Response('not json')) as typeof fetch]) {
    assert.match((await verifyAskCaptcha('token', headers, config, fetcher))!, /unavailable/);
  }
});
