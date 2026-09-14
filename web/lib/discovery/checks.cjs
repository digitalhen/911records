// Offline behavior checks: node lib/discovery/checks.cjs (from web/).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name, mocks, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname,name),'utf8');
  const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(output,{module,exports:module.exports,require(name){if(!(name in mocks))throw Error(`Unexpected import ${name}`);return mocks[name];},process:{env:{}},Buffer,AbortSignal,URLSearchParams,Date,...globals},{filename:name});
  return module.exports;
}
(async()=>{
  let reads=0;
  const data = load('data.ts',{'react':{cache:f=>f},'@/lib/db':{queryReadSafe:async()=>{reads++;return [];}}});
  assert.equal(await data.getEntity('person','private-name'),null);
  assert.equal(reads,0,'Person routes must never query entities');
  assert.deepEqual(Array.from(data.months(['["2001-10-04","2001-10-05"]',['2002-01-08','invalid']])) ,['2001-10','2002-01']);
  assert.equal(data.months('2001-99-10').length,0);
  const pgDate = new Date('2001-09-11T04:00:00.000Z');
  assert.equal(data.formatDate(pgDate),'2001-09-11');
  assert.equal(data.formatDate('2001-09-11'),'2001-09-11');
  assert.equal(data.formatDate('2001-09-11T23:30:00-04:00'),'2001-09-11');
  for (const value of [null, undefined, new Date(NaN), 'invalid', '2001-02-30', {}]) {
    assert.equal(data.formatDate(value),null);
    assert.equal(data.months(value).length,0);
  }
  assert.deepEqual(Array.from(data.months([pgDate,['2001-09-12T12:00:00Z','["2002-01-08"]'],null])),['2001-09','2002-01']);
  const suggestions = load('data.ts',{'react':{cache:f=>f},'@/lib/db':{queryReadSafe:async()=>[
    {first_date:pgDate,last_date:new Date('2002-01-08T00:00:00Z')},
    {first_date:null,last_date:null},
  ]}});
  const rows = await suggestions.suggestEntities('agency');
  assert.equal(rows.length,4,'Both entity and signatory suggestions are retained');
  for (const row of rows) {
    assert.equal(row.first_date === null || row.first_date === '2001-09-11',true);
    assert.equal(row.last_date === null || row.last_date === '2002-01-08',true);
  }
  assert.deepEqual(Array.from(data.terms('["asbestos", ["sampling", 0.8], 4]')),['asbestos','sampling']);
  assert.equal(data.pageHref('a/b',2),'/doc/a%2Fb/p/2');
  let queryBody;
  let fetches=0;
  const hits=[{_source:{doc:'removed',page:1},_score:0.99},{_source:{doc:'available',page:2},_score:0.9},{_source:{doc:'available',page:99},_score:0.8},{_source:{doc:'source',page:1},_score:1}];
  let sourceAllowed=true,vector=[0.1,0.2];
  const similar=load('moreLikeThis.ts',{
    '@/lib/opensearch':{INDEX:'test-index'},
    '@/lib/db':{queryReadSafe:async(sql)=>{
      assert.match(sql,/status IS DISTINCT FROM 'removed'/);
      if(sql.includes('p.doc=$1'))return sourceAllowed?[{doc:'source',page:1}]:[];
      return [{doc:'available',page:2}];
    }},
  },{fetch:async(url,options)=>{fetches++;if(options.method==='GET'){assert.match(url,/_source_includes=vector/);return {ok:true,json:async()=>({_source:{vector}})};}queryBody=JSON.parse(options.body);return {ok:true,json:async()=>({hits:{hits}})};}});
  const result=await similar.moreLikeThis('source',1);
  assert.equal(result.unavailable,false);
  assert.equal(result.hits.length,1);
  assert.equal(result.hits[0].doc,'available');
  assert.equal(result.hits[0].page,2,'Unknown and removed pages must be discarded');
  assert.equal(queryBody.query.knn.vector.filter.bool.must_not[0].term.doc,'source');
  assert.deepEqual(queryBody._source,['doc','page'],'No text or names requested');
  sourceAllowed=false;fetches=0;
  assert.equal((await similar.moreLikeThis('source',1)).hits.length,0);
  assert.equal(fetches,0,'Removed source must never fetch a vector');
  sourceAllowed=true;vector=undefined;fetches=0;
  assert.equal((await similar.moreLikeThis('source',1)).unavailable,true);
  assert.equal(fetches,1,'Missing vector must not trigger k-NN');
  console.log('PASS: Date/timestamp formatting, suggestion dates, nested histogram dates, person route exclusion, safe URLs, topic terms, k-NN document exclusion, authoritative removed/missing-page filtering, removed-source guard, missing-vector fallback.');
})().catch(error=>{console.error(error);process.exitCode=1;});
