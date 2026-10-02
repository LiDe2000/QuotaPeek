const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { mergeAccount, restoreAccounts, cachedAccounts, accountRemoval } = require('../src/lib/accountState.ts');
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

test('removal prefers another account of the same provider and clears only affected selections', () => {
 const accounts = [account('z1','zcode'), account('w1'), account('w2')];
 const settings = {'quotapeek-selected-account':'w1', 'quotapeek-provider-selection-v1':'{"workbuddy":"w1","zcode":"z1"}', 'quotapeek-theme':'light'};
 const result = accountRemoval(accounts, settings, 'w1');
 assert.deepEqual(result.accounts.map(a=>a.id), ['z1','w2']);
 assert.equal(result.settings['quotapeek-selected-account'],'w2');
 assert.deepEqual(JSON.parse(result.settings['quotapeek-provider-selection-v1']), {workbuddy:'w2', zcode:'z1'});
 const lastProvider = accountRemoval(result.accounts, result.settings, 'w2');
 assert.equal(lastProvider.settings['quotapeek-selected-account'],'z1');
 assert.deepEqual(JSON.parse(lastProvider.settings['quotapeek-provider-selection-v1']), {zcode:'z1'});
 const empty = accountRemoval(lastProvider.accounts, lastProvider.settings, 'z1');
 assert.deepEqual(empty.accounts, []);
 assert.equal(empty.settings['quotapeek-selected-account'], '');
 assert.equal(empty.settings['quotapeek-provider-selection-v1'], '{}');
 assert.equal(accountRemoval(accounts, {...settings,'quotapeek-selected-account':'z1'},'w1').settings['quotapeek-selected-account'],'z1');
});
