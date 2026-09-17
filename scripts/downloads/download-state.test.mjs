import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogChanged } from '../lib/download-state.mjs';

test('changed PDFs require a catalog check even at the same byte size', () => {
  const row = { changed_at: '2026-09-17', pdf_size: 123, download_url: 'https://example.test/a.pdf' };
  assert.equal(catalogChanged(row, { bytes: 123 }), true);
  const checked = { catalog_changed_at: row.changed_at, manifest_pdf_size: 123, url: row.download_url };
  assert.equal(catalogChanged(row, checked), false);
  assert.equal(catalogChanged({ ...row, pdf_size: 124 }, checked), true);
  assert.equal(catalogChanged({ ...row, download_url: 'https://example.test/b.pdf' }, checked), true);
  assert.equal(catalogChanged({ ...row, changed_at: '2026-09-18' }, checked), true);
  assert.equal(catalogChanged({ ...row, changed_at: undefined }, null), false);
});
