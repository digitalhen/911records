import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('syntax errors do not retry on primary; connection failures still do', async () => {
  for (const code of ['42601', 'ECONNREFUSED']) {
    const calls: { name: string; sql: string; params: unknown[] }[] = [];
    const failure = Object.assign(new Error('query failed'), { code });
    class Pool {
      constructor(private options: { application_name: string }) {}
      on() {}
      async query(sql: string, params: unknown[]) {
        calls.push({ name: this.options.application_name, sql, params });
        if (this.options.application_name.endsWith('-read')) throw failure;
        return { rows: [{ ok: true }] };
      }
    }
    const module = { exports: {} as { queryRead: (sql: string, params: unknown[]) => Promise<unknown> } };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./db.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports,
      require: () => ({ Pool, types: { setTypeParser() {} } }),
      process: { env: { DATABASE_READ_URL: 'postgres://unused', NODE_ENV: 'production' } },
      console: { warn() {} },
    });
    const params = ['value'];
    if (code === '42601') {
      await assert.rejects(module.exports.queryRead('SELECT $1', params), (err) => err === failure);
      assert.equal(calls.length, 1);
    } else {
      await module.exports.queryRead('SELECT $1', params);
      assert.equal(calls.length, 2);
      assert.equal(calls[1]!.name, 'sept11-records');
      assert.equal(calls[0]!.sql, calls[1]!.sql);
      assert.equal(calls[0]!.params, calls[1]!.params);
    }
  }
});
