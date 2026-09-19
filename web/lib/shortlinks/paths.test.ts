import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTarget, documentShortUrl, decodeDocumentCode, shortDocumentTarget } from './paths';

test('document shortlinks round-trip exact document and page identifiers', () => {
  for (const doc of ['NYC-WTC_000000001', 'NYC-WTC_000140827', 'NYC-WTC_999999999']) {
    for (const page of [1, 5, 172000]) {
      const target = `/doc/${doc}${page > 1 ? `/p/${page}` : ''}`;
      const short = documentShortUrl(doc, page);
      assert.equal(decodeDocumentCode(short.split('/').at(-1)!), target);
      assert.equal(shortDocumentTarget(target), short);
    }
  }
  assert.equal(decodeDocumentCode('dzzzzzz'), null);
  assert.equal(decodeDocumentCode('d1-0'), null);
  assert.equal(decodeDocumentCode('../search'), null);
});

test('saved links preserve filters and anchors and reject external or service targets', () => {
  const target = '/search?q=asbestos&address=140%20West%20Street#results';
  for (const host of ['911records.org', 'www.911records.org', '911records.nyc', 'www.911records.nyc']) {
    assert.equal(normalizeTarget(`https://${host}${target}`), target);
  }
  assert.equal(shortDocumentTarget('/doc/NYC-WTC_000140827#page'), null);
  for (const bad of ['https://evil.example/search', '//evil.example/search', '/api/health', '/mcp', '/s/d1', 'javascript:alert(1)', '/search\\evil', 'https://user@911records.org/search']) {
    assert.throws(() => normalizeTarget(bad), bad);
  }
});
