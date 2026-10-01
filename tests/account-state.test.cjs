const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { mergeAccount, restoreAccounts, cachedAccounts } = require('../src/lib/accountState.ts');
const account = (id, providerId='workbuddy', fetchedAt=10) => ({id, providerId, fetchedAt, totalRemain:90,totalUsed:10,totalSize:100,packages:[]});
test('refresh updates in place and preserves same-provider accounts',()=>{
 const original=[account('w1'),account('z1','zcode'),account('w2')];
 const updated=mergeAccount(original,account('w1','workbuddy',20));
 assert.deepEqual(updated.map(x=>x.id),['w1','z1','w2']);
 assert.equal(updated[0].fetchedAt,20);
 assert.equal(updated[2],original[2]);
 assert.deepEqual(mergeAccount(updated,account('w3')).map(x=>x.id),['w1','z1','w2','w3']);
});
test('startup discovery preserves snapshots, drops missing credentials, and keeps failed-provider cache',()=>{
 const cached=[account('w2'),account('w1'),account('old'),account('z1','zcode')];
 const restored=restoreAccounts(cached,[account('w1','workbuddy',0),account('w2','workbuddy',0),account('w3','workbuddy',0)],['workbuddy']);
 assert.deepEqual(restored.map(x=>x.id),['w2','w1','z1','w3']);
 assert.equal(restored[0].fetchedAt,10);
 assert.equal(restored[3].fetchedAt,0);
});
test('invalid and duplicate cached accounts are ignored',()=>{
 assert.deepEqual(cachedAccounts('{bad'),[]);
 assert.deepEqual(cachedAccounts('{}'),[]);
 const parsed=cachedAccounts(JSON.stringify([account('w1'),account('w1'),{id:'broken',providerId:'workbuddy',fetchedAt:10}]));
 assert.deepEqual(parsed.map(x=>x.id),['w1']);
});
