const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { providerGroups, readProviderSelection } = require('../src/lib/providerGroups.ts');
const { refreshCooldown } = require('../src/lib/refreshCooldown.ts');
const account = (id, providerId) => ({ id, providerId });

test('one group per provider preserves account order and independent remembered selections', () => {
  const accounts = [account('w1', 'workbuddy'), account('z1', 'zcode'), account('w2', 'workbuddy'), account('z2', 'zcode')];
  const groups = providerGroups(accounts, { workbuddy: 'w2', zcode: 'z1' });
  assert.deepEqual(groups.map(group => group.providerId), ['workbuddy', 'zcode']);
  assert.deepEqual(groups[0].accounts.map(account => account.id), ['w1', 'w2']);
  assert.deepEqual(groups.map(group => group.selected.id), ['w2', 'z1']);
  assert.equal(providerGroups(accounts, { workbuddy: 'deleted' })[0].selected.id, 'w1');
  assert.deepEqual(providerGroups([], {}), []);
});

test('persisted provider choices reject malformed and unsupported values', () => {
  assert.deepEqual(readProviderSelection('{bad'), {});
  assert.deepEqual(readProviderSelection('null'), {});
  assert.deepEqual(readProviderSelection('["w1"]'), {});
  assert.deepEqual(readProviderSelection('{"workbuddy":"w2","zcode":4,"other":"x"}'), {workbuddy: 'w2'});
});

test('manual refresh cooldown starts after completion and handles clock rollback', () => {
  assert.equal(refreshCooldown(10, undefined), 0);
  assert.equal(refreshCooldown(0, 0), 10000);
  assert.equal(refreshCooldown(9999, 0), 1);
  assert.equal(refreshCooldown(10000, 0), 0);
  assert.equal(refreshCooldown(15000, 0), 0);
  assert.equal(refreshCooldown(0, 100), 10000);
});

test('saved provider order controls both surfaces without changing accounts or selection', () => {
  const accounts = [account('w1', 'workbuddy'), account('c1', 'codex'), account('w2', 'workbuddy'), account('d1', 'deepseek')];
  const groups = providerGroups(accounts, { workbuddy: 'w2' }, ['deepseek', 'workbuddy']);
  assert.deepEqual(groups.map(group => group.providerId), ['deepseek', 'workbuddy', 'codex']);
  assert.deepEqual(groups[1].accounts.map(account => account.id), ['w1', 'w2']);
  assert.equal(groups[1].selected.id, 'w2');
  assert.deepEqual(accounts.map(account => account.id), ['w1', 'c1', 'w2', 'd1']);
});

test('saved order ignores duplicates, unknown providers and damaged settings', () => {
  const { readProviderOrder } = require('../src/lib/providerGroups.ts');
  for (const raw of [null, 'null', '{}', '{bad']) assert.deepEqual(readProviderOrder(raw), []);
  assert.deepEqual(readProviderOrder('["zcode","unknown",4,"codex","zcode"]'), ['zcode', 'codex']);
});

test('moving a provider inserts it in either direction and ignores invalid drops', () => {
  const { moveProvider } = require('../src/lib/providerGroups.ts');
  const order = ['workbuddy', 'codex', 'deepseek', 'zcode'];
  assert.deepEqual(moveProvider(order, 'workbuddy', 'deepseek'), ['codex', 'deepseek', 'workbuddy', 'zcode']);
  assert.deepEqual(moveProvider(order, 'zcode', 'codex'), ['workbuddy', 'zcode', 'codex', 'deepseek']);
  assert.deepEqual(moveProvider(order, 'codex', 'codex'), order);
  assert.deepEqual(moveProvider(order, 'missing', 'codex'), order);
  assert.deepEqual(moveProvider(order, 'codex', 'missing'), order);
});
