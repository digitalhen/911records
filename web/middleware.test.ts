import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { canonicalRedirect } from './middleware';

test('legacy and www URLs permanently preserve paths, query strings and POST methods', () => {
  for (const host of ['911records.nyc','www.911records.nyc','www.911records.org']) {
    const req = new NextRequest(`https://${host}/doc/NYC-WTC_000138553/p/1?q=air%20quality&x=1`, {method:'POST'});
    const res=canonicalRedirect(req)!;
    assert.equal(res.status,308);
    assert.equal(res.headers.get('location'),'https://911records.org/doc/NYC-WTC_000138553/p/1?q=air%20quality&x=1');
  }
});
test('canonical host and local health probes do not redirect', () => {
  for (const url of ['https://911records.org/','http://localhost:3000/api/health','http://app:3000/api/health'])
    assert.equal(canonicalRedirect(new NextRequest(url)),null);
});
test('forwarded host is honored and a double-slash path cannot change the destination host', () => {
  const req=new NextRequest('http://app:3000//evil.example/a?b=c',{headers:{'x-forwarded-host':'911records.nyc'}});
  assert.equal(canonicalRedirect(req)!.headers.get('location'),'https://911records.org//evil.example/a?b=c');
});

test('crawl guard blocks crawlers before redirects and fetches, logging once per IP', async (t) => {
  const { middleware, crawlGuard } = await import('./middleware');
  const logs = t.mock.method(console, 'warn', () => {});
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  for (const [i, ua] of ['GoogleBOT', 'facebookexternalhit', 'python-requests', 'Go-http-client', 'curl', 'wget', 'httpx', 'HeadlessChrome'].entries()) {
    const headers = { 'user-agent': ua, 'cf-connecting-ip': `crawler-${i}` };
    assert.equal(crawlGuard(new NextRequest('https://911records.org/search', { headers })), null);
    for (const path of ['/search?q=', '/doc/NYC-WTC_1/versions?copy=2']) {
      const res = await middleware(new NextRequest(`https://911records.nyc${path}`, { headers }));
      assert.equal(res.status, 403);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    }
  }
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(logs.mock.callCount(), 8);
});

test('rate limit accepts 20 requests, separates clients and resets after a minute', async (t) => {
  const { crawlGuard } = await import('./middleware');
  const logs = t.mock.method(console, 'warn', () => {});
  const now = Date.now() + 120_000;
  for (const headers of [
    { 'cf-connecting-ip': 'human-cf', 'x-forwarded-for': 'ignored' },
    { 'x-forwarded-for': 'human-forwarded, proxy' },
    {},
  ] as Record<string, string>[]) {
    const req = new NextRequest('https://911records.org/search?q=asbestos', { headers });
    for (let i = 0; i < 20; i++) assert.equal(crawlGuard(req, now), null);
    const res = crawlGuard(req, now)!;
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '60');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(crawlGuard(req, now + 59_999)!.status, 429);
    assert.equal(crawlGuard(req, now + 60_000), null);
  }
  assert.equal(logs.mock.callCount(), 3);
  assert.equal(crawlGuard(new NextRequest('https://911records.org/doc/1?q=x', { headers: { 'user-agent': 'bot' } })), null);
});
