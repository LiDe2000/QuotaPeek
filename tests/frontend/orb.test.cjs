const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { orbMeter } = require('../../src/lib/providers/orb.ts');

test('workbuddy meters its credit total and clamps over-committed accounts', () => {
  const meter = orbMeter({ providerId: 'workbuddy', totalUsed: 187, totalSize: 10000 });
  assert.equal(Number(meter.percent.toFixed(2)), 98.13);
  assert.equal(meter.used, 187);
  assert.equal(meter.total, 10000);
  const over = orbMeter({ providerId: 'workbuddy', totalUsed: 120, totalSize: 100 });
  assert.equal(over.percent, 0);
});

test('zcode sums every numbered bucket and ignores the unnumbered ones', () => {
  const meter = orbMeter({
    providerId: 'zcode',
    windows: [
      { used: 25000000, total: 100000000 },
      { used: 50000000, total: 100000000 },
      { used: null, total: 100 },
    ],
  });
  assert.equal(meter.percent, 62.5);
  assert.equal(meter.used, 75000000);
  assert.equal(meter.total, 200000000);
  assert.deepEqual(orbMeter({ providerId: 'zcode', windows: [{ used: null, total: null }] }), { percent: null, used: null, total: null });
});

test('codex rings remaining quota, clamped, or nothing at all', () => {
  const meter = orbMeter({ providerId: 'codex', rateLimits: { p: { primary: { usedPercent: 30 }, secondary: null } } });
  assert.equal(meter.percent, 70);
  assert.equal(meter.used, null);
  assert.equal(orbMeter({ providerId: 'codex', rateLimits: { p: { primary: { usedPercent: 240 }, secondary: null } } }).percent, 0);
  assert.deepEqual(orbMeter({ providerId: 'codex', rateLimits: {} }), { percent: null, used: null, total: null });
});

test('codex warns for the most depleted window across all buckets', () => {
 const meter=orbMeter({providerId:'codex',rateLimits:{
  p:{primary:{usedPercent:20},secondary:{usedPercent:95}},
  other:{primary:{usedPercent:40},secondary:null}
 }});
 assert.equal(meter.percent,5);
});
