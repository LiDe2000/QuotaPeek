const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, file);
const {verifyZcode} = require('../../src/lib/activities/zcodeVerification.ts');
const config = {region:'cn',prefix:'public',sceneId:'public'};

test('silent success returns the fresh result and removes the SDK instance and mount', async t => {
  const originalTimer = global.setTimeout;
  global.setTimeout = (fn, ms) => originalTimer(fn, ms === 2200 ? 0 : ms);
  t.after(() => {global.setTimeout = originalTimer; delete global.window; delete global.document;});
  let destroyed = 0, removed = 0;
  global.document = {createElement:()=>({append(){},remove(){removed++;}}),body:{appendChild(){}},head:{appendChild(){assert.fail('SDK is already loaded');}}};
  const result = 'opaque-fresh-verification-result';
  global.window = {initAliyunCaptcha(o){o.getInstance({startTracelessVerification(){o.success(result);},destroy(){destroyed++;}});}};
  assert.equal(await verifyZcode(config), result);
  assert.equal(destroyed, 1);
  assert.equal(removed, 1);

  // The SDK may report a terminal pass through fail() before success() provides the parameter.
  global.window.initAliyunCaptcha = o => o.getInstance({startTracelessVerification(){o.fail({success:true,verifyResult:true,verifyCode:'T006'});o.success(result);}});
  assert.equal(await verifyZcode(config), result);

  for (const failure of [{success:true,verifyResult:false,verifyCode:'F015'},{verifyCode:'F008'}]) {
    global.window.initAliyunCaptcha = o => o.getInstance({startTracelessVerification(){o.fail(failure);}});
    await assert.rejects(verifyZcode(config), /official ZCode app/);
  }
});
