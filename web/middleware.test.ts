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
