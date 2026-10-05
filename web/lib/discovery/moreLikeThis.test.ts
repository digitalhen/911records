import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('similarity SQL is valid before FROM with and without title columns', async () => {
  for (const withTitles of [true, false]) {
    let checked = false;
    const module = { exports: {} as { moreLikeThis: (doc: string, page: number) => Promise<{ unavailable: boolean }> } };
    const mocks: Record<string, unknown> = {
      '@/lib/opensearch': { INDEX: 'test' },
      '@/lib/site': { documentsHaveTitles: async () => withTitles },
      '@/lib/db': { queryReadSafe: async (sql: string) => {
        if (sql.includes('p.doc=$1')) return [{ doc: 'source' }];
        assert.doesNotMatch(sql, /,\s*FROM/i);
        assert.match(sql, withTitles ? /d.title,d.summary\s+FROM/ : /NULL::text AS summary\s+FROM/);
        checked = true;
        return [{ doc: 'copy', page: 1 }];
      } },
    };
    const source = readFileSync(new URL('./moreLikeThis.ts', import.meta.url), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      module, exports: module.exports, require: (name: string) => { assert.ok(name in mocks, name); return mocks[name]; },
      process: { env: {} }, Buffer, AbortSignal,
      fetch: async (_url: string, options: { method: string }) => ({ ok: true, json: async () => options.method === 'GET'
        ? { _source: { vector: [0.1] } }
        : { hits: { hits: [{ _source: { doc: 'copy', page: 1 }, _score: 0.9 }] } } }),
    });
    assert.equal((await module.exports.moreLikeThis('source', 1)).unavailable, false);
    assert.equal(checked, true);
  }
});
