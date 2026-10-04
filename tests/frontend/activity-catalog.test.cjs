const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const lib = require('../../src/lib/activities/catalog.ts');
const payload = () => JSON.parse(fs.readFileSync('tests/activity_mock/activities.json', 'utf8'));
test('both shipped configs share the file and remote schema; invalid endpoints and credential fields are rejected', () => {
  lib.parseCatalog(payload());
  lib.parseCatalog(JSON.parse(fs.readFileSync('activity-service/activities.json', 'utf8')));
  const duplicate = payload(); duplicate.activities.push(duplicate.activities[0]);
  assert.throws(() => lib.parseCatalog(duplicate));
  for (const url of ['https://evil.example/steal', 'http://127.0.0.1:1432/mock/workbuddy/status?token=x', 'http://127.0.0.1:1432/mock/workbuddy/../workbuddy/status']) {
    const bad = payload(); bad.activities[0].query.request.url = url;
    assert.throws(() => lib.parseCatalog(bad));
  }
  const bad = payload(); bad.activities[0].query.request.headers = {Authorization: 'secret'};
  assert.throws(() => lib.parseCatalog(bad));
});
test('catalog filters disabled, expired and region-ineligible activities without using quota to infer eligibility', () => {
  const catalog = payload(); catalog.activities[0].regions = ['cn']; catalog.activities[1].enabled = false;
  const rows = lib.catalogActivities(lib.parseCatalog(catalog), [
    {id:'w',providerId:'workbuddy',region:'cn',totalRemain:0},
    {id:'g',providerId:'workbuddy',region:'global'}], false);
  assert.deepEqual(rows[0].entries.map(e => [e.accountId,e.status]), [['w','unknown']]);
  assert.match(rows[0].entries[0].note, /cannot be mixed/);
  catalog.activities[0].expiresAt = 1;
  assert.deepEqual(lib.catalogActivities(lib.parseCatalog(catalog), [{id:'w',providerId:'workbuddy',region:'cn'}], false), []);
});
test('missing fields never match null; unknown claim results never confirm success', () => {
  const op = payload().activities[0].claim;
  op.response.rules = [{all:[{path:'data.missing',equals:null}],status:'claimed'}];
  assert.equal(lib.normalize({data:{}},op,true).status, 'pending');
  assert.equal(lib.normalize({data:{missing:null}},op,true).status, 'claimed');
  assert.equal(lib.parseActivityResult({status:'available'},true).status,'pending');
  assert.throws(() => lib.parseActivityResult({status:'invented'}));
});

test('ZCode local claims accept only the official endpoint and locally generated parameters', () => {
  const value = JSON.parse(fs.readFileSync('activity-service/activities.json', 'utf8'));
  assert.equal(lib.parseCatalog(value).activities[1].adapterId, 'zcode-plan-v1');
  value.activities[1].claim.request.body = {plan_id:'injected-by-server'};
  assert.throws(() => lib.parseCatalog(value));
  value.activities[1].claim.request.body = {};
  value.activities[1].claim.request.url = 'https://evil.example/claim';
  assert.throws(() => lib.parseCatalog(value));
});
