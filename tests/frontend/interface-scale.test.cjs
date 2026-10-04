const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { normalizeInterfaceScale, INTERFACE_SCALE } = require('../../src/lib/appearance/interfaceScale.ts');

test('scale defaults safely for missing or damaged saved settings', () => {
  for (const raw of [null, '', 'invalid', 'Infinity', NaN, Infinity]) assert.equal(normalizeInterfaceScale(raw), 100);
});

test('saved percentages restore, snap to steps, and stay in range', () => {
  assert.equal(normalizeInterfaceScale('120'), 120);
  assert.equal(normalizeInterfaceScale(107), 105);
  assert.equal(normalizeInterfaceScale(108), 110);
  assert.equal(normalizeInterfaceScale(50), INTERFACE_SCALE.min);
  assert.equal(normalizeInterfaceScale(200), INTERFACE_SCALE.max);
});
