import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION, COOKIE_NAME, GRANT_SECONDS, captchaConfig, captchaGate, downloadName,
  hasDownloadGrant, issueGrant, validGrant, verificationHandler, type CaptchaConfig,
} from './captcha';

const key = 'unit-test-session-key-with-at-least-thirty-two-characters';
const config: CaptchaConfig = {
  siteKey: 'real-site-key', secretKey: 'real-secret-key', sessionSecret: key,
  production: true, testMode: false, origin: 'https://911records.nyc',
};
const file = `box-${'a'.repeat(64)}.zip`;
const request = (body: unknown = { token: 'valid-token', file }, origin = config.origin) =>
  new Request(`${config.origin}/api/downloads/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
const provider = (result: object, status = 200) => (async () => Response.json(result, { status })) as typeof fetch;
const accepted = { success: true, action: ACTION, hostname: '911records.nyc' };

test('grants expire, reject tampering, and work across replicas sharing a key', () => {
  const now = 100000;
  const grant = issueGrant(key, now);
  assert.equal(validGrant(grant, key, now), true);
  assert.equal(validGrant(grant, key, now + GRANT_SECONDS * 1000 - 1), true);
  assert.equal(validGrant(grant, key, now + GRANT_SECONDS * 1000), false);
  assert.equal(validGrant(grant, key, now - 1), false);
  assert.equal(validGrant(grant, 'another-replica-with-the-wrong-secret', now), false);
  assert.equal(validGrant(grant + 'x', key, now), false);
  assert.equal(validGrant(grant + '.extra', key, now), false);
  assert.equal(validGrant('bad.payload', key, now), false);
  assert.equal(validGrant(undefined, key, now), false);
  const preview = issueGrant(key, now, 'preview');
  assert.equal(validGrant(preview, key, now), false);
  assert.equal(validGrant(preview, key, now, 'preview'), true);
});

test('production fails closed with missing credentials, short signing keys, or test credentials', () => {
  const env = { NODE_ENV: 'production' as const, TURNSTILE_SITE_KEY: 'real-site', TURNSTILE_SECRET_KEY: 'real-secret', DOWNLOAD_SESSION_SECRET: key };
  assert.ok(captchaConfig(env));
  assert.equal(captchaConfig({ ...env, TURNSTILE_SECRET_KEY: '' }), null);
  assert.equal(captchaConfig({ ...env, DOWNLOAD_SESSION_SECRET: 'short' }), null);
  assert.equal(captchaConfig({ ...env, TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }), null);
  assert.equal(captchaConfig({ ...env, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' }), null);
  assert.equal(captchaConfig({ ...env, TURNSTILE_TEST_MODE: '1' })?.testMode, false);
});

test('only known download path shapes can be returned', () => {
  for (const value of ['https://attacker.example', '//attacker.example', '../files/pdf/a.pdf', '/api/downloads/verify', 'box-a.zip', null]) assert.equal(downloadName(value), false);
  for (const value of [file, 'manifest.json', 'index.json', `manifest-${'f'.repeat(64)}.json`]) assert.equal(downloadName(value), true);
});

test('download gate protects GET, HEAD, range and inventory requests', () => {
  const original = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'production', TURNSTILE_SITE_KEY: 'real-site', TURNSTILE_SECRET_KEY: 'real-secret', DOWNLOAD_SESSION_SECRET: key });
  try {
    const url = `${config.origin}/api/downloads/${file}`;
    assert.equal(captchaGate(new Request(url))?.status, 303);
    assert.equal(captchaGate(new Request(url, { method: 'HEAD' }))?.status, 403);
    assert.equal(captchaGate(new Request(url, { headers: { Range: 'bytes=0-3' } }))?.status, 303);
    assert.equal(captchaGate(new Request(`${config.origin}/api/downloads/manifest.json`))?.status, 303);
    const cookie = `${COOKIE_NAME}=${issueGrant(key)}`;
    assert.equal(captchaGate(new Request(url, { headers: { Cookie: cookie } })), null);
    assert.equal(captchaGate(new Request(url, { headers: { Cookie: cookie + 'tampered' } }))?.status, 303);
    process.env.TURNSTILE_SECRET_KEY = '';
    assert.equal(captchaGate(new Request(url, { headers: { Cookie: cookie } }))?.status, 503);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in original)) delete process.env[name];
    Object.assign(process.env, original);
  }
});

test('successful server validation sets a secure, scoped HttpOnly grant', async () => {
  const handler = verificationHandler(() => config, provider(accepted));
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.equal((await result.json()).download, `/api/downloads/${file}`);
  const cookie = result.headers.get('set-cookie')!;
  for (const flag of ['Path=/api/downloads', 'HttpOnly', 'SameSite=Lax', 'Secure', `Max-Age=${GRANT_SECONDS}`]) assert.ok(cookie.includes(flag));
  assert.equal(hasDownloadGrant(new Request(config.origin, { headers: { Cookie: cookie.split(';')[0]! } }), config), true);
});

test('failed, expired, replayed, wrong-host and wrong-action tokens cannot issue grants', async () => {
  for (const result of [
    { success: false, 'error-codes': ['invalid-input-response'] },
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { ...accepted, hostname: 'attacker.example' },
    { ...accepted, action: 'login' },
    { success: true },
  ]) {
    const response = await verificationHandler(() => config, provider(result))(request());
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('invalid requests and provider outages fail closed', async () => {
  const handler = verificationHandler(() => config, provider(accepted));
  assert.equal((await handler(request({}, 'https://attacker.example'))).status, 403);
  assert.equal((await handler(request({ token: '', file }))).status, 400);
  assert.equal((await handler(request({ token: 'valid', file: '//attacker.example' }))).status, 400);
  assert.equal((await handler(request({ token: 'x'.repeat(9000), file }))).status, 413);
  assert.equal((await verificationHandler(() => null, provider(accepted))(request())).status, 503);
  assert.equal((await verificationHandler(() => config, provider({}, 500))(request())).status, 503);
});

test('verification attempts are rate limited', async () => {
  const handler = verificationHandler(() => config, provider({ success: false }));
  for (let i = 0; i < 10; i++) assert.equal((await handler(request())).status, 403);
  const response = await handler(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '600');
});
