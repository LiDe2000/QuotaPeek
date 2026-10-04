const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,file);
const {fetchCatalog,requestMockActivity} = require('../../src/lib/activities/catalogClient.ts');
test('browser preview reads remote configuration then queries and claims directly at the fake official API', async () => {
  const result = await fetchCatalog('http://127.0.0.1:1431/v1/activities', async () => assert.fail('must prefer remote'));
  assert.equal(result.source,'server');
  const [wb,zc] = result.catalog.activities;
  assert.equal((await requestMockActivity(wb,'preview-wb-0',false,true)).status,'available');
  assert.equal((await requestMockActivity(wb,'preview-wb-0',true,true)).status,'claimed');
  assert.equal((await requestMockActivity(wb,'preview-wb-0',true,true)).status,'claimed');
  assert.equal((await requestMockActivity(wb,'preview-wb-2',true,true)).status,'pending');
  assert.equal((await requestMockActivity(zc,'preview-zc-1',true,true)).status,'verification');
  const local = await fetchCatalog('http://127.0.0.1:1431/missing', async () => JSON.parse(fs.readFileSync('tests/activity_mock/activities.json','utf8')));
  assert.equal(local.source,'local');
  assert.equal((await requestMockActivity(local.catalog.activities[1],'preview-zc-0',true,true)).status,'claimed');
  await assert.rejects(() => requestMockActivity(wb,'real-account',false,true));
  await assert.rejects(() => requestMockActivity(wb,'preview-wb-0',false,false));
});
test('lost claim responses are verified without retries; redirects and malformed queries are rejected', async () => {
  const base = JSON.parse(fs.readFileSync('tests/activity_mock/activities.json','utf8')).activities[0];
  for (const fault of ['timeout','malformed','redirect']) {
    for (const [account,expected] of [['preview-wb-0','claimed'],['preview-wb-2','pending']]) {
      assert.equal((await fetch('http://127.0.0.1:1432/testing/reset',{method:'POST'})).status,200);
      const item = structuredClone(base);
      item.claim.request.timeoutMs = 500;
      item.claim.request.query = {fault};
      assert.equal((await requestMockActivity(item,account,true,true)).status,expected,`${fault}: ${account}`);
      assert.equal((await requestMockActivity(item,account,true,true)).status,expected);
      const counts = await (await fetch('http://127.0.0.1:1432/testing/stats')).json();
      assert.equal(counts.claims,1,'Lost response must never cause a second submission');
      assert.equal(counts.redirects,0);
    }
  }
  for (const fault of ['malformed','redirect']) {
    const item = structuredClone(base);
    item.query.request.query = {fault};
    await assert.rejects(() => requestMockActivity(item,'preview-wb-0',false,true));
  }
  assert.equal((await (await fetch('http://127.0.0.1:1432/testing/stats')).json()).redirects,0);
});
