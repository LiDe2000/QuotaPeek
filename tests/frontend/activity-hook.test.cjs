const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,file);
const fixture = JSON.parse(fs.readFileSync('tests/activity_mock/activities.json','utf8'));
function setup(options = {}) {
  let cursor = 0, effects = [], loadCount = 0, releaseClaim;
  let currentCatalog = fixture;
  const slots = [];
  const same = (a,b) => a?.length === b?.length && a.every((v,i) => Object.is(v,b[i]));
  const react = {
    useState(initial) { const i=cursor++; slots[i] ??= {value:initial}; return [slots[i].value, value => {slots[i].value=typeof value==='function'?value(slots[i].value):value;}]; },
    useRef(initial) { const i=cursor++; slots[i] ??= {current:initial}; return slots[i]; },
    useCallback(fn,deps) {const i=cursor++; if(!slots[i] || !same(slots[i].deps,deps)) slots[i]={fn,deps}; return slots[i].fn;},
    useEffect(fn,deps) {const i=cursor++; if(!slots[i] || !same(slots[i].deps,deps)) {
      const previous=slots[i]; slots[i]={deps}; effects.push(() => {previous?.cleanup?.(); slots[i].cleanup=fn();});
    }},
  };
  const runtime = {
    async loadActivities() {loadCount++; return {catalog:currentCatalog,source:'server',session:'s'+loadCount,notice:null};},
    async requestActivity(session,definition,account,claiming) {
      if(!claiming) return {status:options.queryStatus ?? 'available'};
      return new Promise(resolve => {releaseClaim=() => resolve({status:options.claimStatus ?? 'claimed'});});
    },
  };
  const mocks = {react, '../lib/activities/runtimeClient':runtime, '../services/storage':{storage:{getSetting:()=>''}},
    '../lib/activities/catalog':require('../../src/lib/activities/catalog.ts'),
    '../lib/activities/activityState':require('../../src/lib/activities/activityState.ts')};
  const context = {exports:{}, require:name => {assert.ok(mocks[name],name); return mocks[name];}, AbortController,
    env:{DEV:true,VITE_ACTIVITY_SERVICE_URL:''}};
  const source=fs.readFileSync('src/hooks/useActivities.ts','utf8').replaceAll('import.meta.env','env');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
  function render(visible=true) {
    cursor=0; effects=[];
    const controller=context.exports.useActivities([{id:'preview-wb-0',providerId:'workbuddy',region:'cn'}],options.demo ?? true,visible,options.onClaimed);
    for(const effect of effects) effect();
    return controller;
  }
  return {render, count:()=>loadCount, delist:()=>{currentCatalog={schemaVersion:2,revision:'empty',activities:[]};}, release:()=>releaseClaim()};
}
const settle = () => new Promise(resolve=>setImmediate(resolve));
test('confirmed real claim refreshes only its account and keeps claimed state if quota refresh fails', async () => {
  const refreshed = [];
  const h=setup({demo:false, onClaimed:async id => {refreshed.push(id); throw Error('quota offline');}});
  // Use the real adapter so the real account path is actionable.
  fixture.activities[0].adapterId='workbuddy-checkin-v1';
  try {
    h.render(); await settle();
    const claim=h.render().claim('workbuddy-daily','preview-wb-0');
    h.release(); await claim;
    assert.deepEqual(refreshed,['preview-wb-0']);
    assert.equal(h.render().activities[0].entries[0].status,'claimed');
  } finally { fixture.activities[0].adapterId='mock-http-v1'; }
});
test('unconfirmed claims and demo claims do not refresh real account quota', async () => {
  for (const [demo,claimStatus] of [[false,'pending'],[false,'verification'],[true,'claimed']]) {
    const refreshed=[];
    fixture.activities[0].adapterId=demo ? 'mock-http-v1' : 'workbuddy-checkin-v1';
    try {
      const h=setup({demo,claimStatus,onClaimed:async id=>{refreshed.push(id);}});
      h.render(); await settle();
      const claim=h.render().claim('workbuddy-daily','preview-wb-0');
      h.release(); await claim;
      assert.deepEqual(refreshed,[]);
    } finally { fixture.activities[0].adapterId='mock-http-v1'; }
  }
});
test('a pending claim refreshes quota once when a later status query confirms it', async () => {
  const refreshed=[];
  const options={demo:false,claimStatus:'pending',onClaimed:async id=>{refreshed.push(id);}};
  fixture.activities[0].adapterId='workbuddy-checkin-v1';
  try {
    const h=setup(options); h.render(); await settle();
    const claim=h.render().claim('workbuddy-daily','preview-wb-0');
    h.release(); await claim;
    assert.deepEqual(refreshed,[]);
    options.queryStatus='claimed';
    await h.render().refresh();
    assert.deepEqual(refreshed,['preview-wb-0']);
    await h.render().refresh();
    assert.deepEqual(refreshed,['preview-wb-0'],'repeated confirmed status queries should not keep refreshing quota');
  } finally { fixture.activities[0].adapterId='mock-http-v1'; }
});
test('reopening during a claim queues a reload and honors a newly empty remote catalog', async () => {
  const h=setup(); h.render(); await settle();
  const controller=h.render(); const claim=controller.claim('workbuddy-daily','preview-wb-0');
  h.render(false); h.delist(); h.render(true);
  assert.equal(h.count(),1);
  h.release(); await claim; await settle();
  const result=h.render();
  assert.equal(h.count(),2,'the reload requested while claiming must run after completion');
  assert.equal(result.activities.length,0,'remote delisting must remove the old actionable catalog');
});
test('queued refresh waits for a batch to finish and does not reload a closed panel', async () => {
  const h=setup(); h.render(); await settle();
  const controller=h.render(); const batch=controller.claimAll();
  h.render(false); h.render(true); h.delist(); h.render(false);
  h.release(); await batch; await settle();
  assert.equal(h.count(),1);
  h.render(true); await settle();
  assert.equal(h.render().activities.length,0);
});
