const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { createPersistentState } = require('../../src/lib/storage/persistentState.ts');

test('saved state is loaded before reads and initialization runs once', async () => {
  let loads = 0;
  const state = createPersistentState({ load: async () => { loads++; return { accounts: [{ id: 'a' }], settings: { theme: 'light' } }; }, saveSettings: async () => {}, saveCache: async () => {} });
  assert.throws(() => state.getSetting('theme'), /initialized/);
  await Promise.all([state.initialize(), state.initialize()]);
  assert.equal(loads, 1);
  assert.equal(state.getSetting('theme'), 'light');
  assert.deepEqual(state.getAccounts(), [{ id: 'a' }]);
});

test('rapid settings changes persist in order and failures do not prevent a later retry', async () => {
  const writes = [];
  const failures = [];
  const state = createPersistentState({ load: async () => ({ accounts: [], settings: {} }), saveSettings: async patch => { writes.push(patch); if (writes.length === 1) throw new Error('disk full'); }, saveCache: async () => {} });
  state.subscribeError(() => failures.push(state.getError()));
  await state.initialize();
  const failed = state.setSetting('theme', 'dark');
  const retry = state.setSetting('theme', 'light');
  await assert.rejects(failed, /disk full/);
  await retry;
  assert.deepEqual(writes, [{ theme: 'dark' }, { theme: 'light' }]);
  assert.equal(state.getSetting('theme'), 'light');
  assert.match(failures[0], /disk full/);
  assert.equal(state.getError(), null);
});

test('cache writes capture their input and are serialized with settings', async () => {
  const order = [];
  const state = createPersistentState({ load: async () => ({ accounts: [], settings: {} }), saveSettings: async patch => order.push(patch), saveCache: async accounts => order.push(accounts) });
  await state.initialize();
  const accounts = [{ id: 'a', fetchedAt: 1 }];
  const first = state.saveAccounts(accounts);
  accounts[0].fetchedAt = 2;
  const second = state.setSetting('selected', 'a');
  const third = state.saveAccounts(accounts);
  await Promise.all([first, second, third]);
  assert.deepEqual(order, [[{ id: 'a', fetchedAt: 1 }], { selected: 'a' }, [{ id: 'a', fetchedAt: 2 }]]);
});

test('account and provider selection are saved in one atomic patch', async () => {
  const writes = [];
  const state = createPersistentState({ load: async () => ({ accounts: [], settings: {} }), saveSettings: async patch => writes.push(patch), saveCache: async () => {} });
  await state.initialize();
  const patch = { 'quotapeek-selected-account': 'a', 'quotapeek-provider-selection-v1': '{"deepseek":"a"}' };
  await state.setSettings(patch);
  assert.deepEqual(writes, [patch]);
  assert.equal(state.getSetting('quotapeek-selected-account'), 'a');
});

test('successful cache writes do not hide a failed setting save', async () => {
  const state = createPersistentState({ load: async () => ({ accounts: [], settings: {} }), saveSettings: async () => { throw new Error('disk full'); }, saveCache: async () => {} });
  await state.initialize();
  await assert.rejects(state.setSetting('theme', 'light'));
  await state.saveAccounts([]);
  assert.match(state.getError(), /disk full/);
});

test('removal is ordered with writes and stale snapshots cannot resurrect an account', async () => {
  const writes = [];
  let release;
  const deleting = new Promise(resolve => { release = resolve; });
  const original = [{ id: 'a', providerId: 'workbuddy' }, { id: 'b', providerId: 'workbuddy' }];
  const state = createPersistentState({
    load: async () => ({ accounts: original, settings: { 'quotapeek-selected-account': 'a', 'quotapeek-provider-selection-v1': '{"workbuddy":"a"}', 'quotapeek-theme': 'light' } }),
    saveSettings: async patch => writes.push(['settings', patch]),
    saveCache: async accounts => writes.push(['cache', accounts]),
    removeAccount: async (id, patch) => { writes.push(['remove', id, patch]); await deleting; },
  });
  await state.initialize();
  const before = state.saveAccounts(original);
  const removal = state.removeAccount('a');
  await before;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.getAccounts(), original, 'keep the account until deletion succeeds');
  const staleCache = state.saveAccounts(original);
  const staleSelection = state.setSettings({ 'quotapeek-selected-account': 'a', 'quotapeek-provider-selection-v1': '{"workbuddy":"a"}' });
  release();
  await Promise.all([removal, staleCache, staleSelection]);
  assert.deepEqual(writes.map(x => x[0]), ['cache', 'remove', 'cache', 'settings']);
  assert.deepEqual(writes[2][1], [original[1]]);
  assert.equal(writes[3][1]['quotapeek-selected-account'], 'b');
  assert.deepEqual(state.getAccounts(), [original[1]]);
  assert.equal(state.getSetting('quotapeek-selected-account'), 'b');
  assert.equal(state.getSetting('quotapeek-theme'), 'light');
  state.reconnectAccount('a');
  await state.saveAccounts(original);
  assert.deepEqual(state.getAccounts(), original, 'explicit reconnection can add it again');
});

test('failed removal preserves the account and selections and can be retried', async () => {
  const accounts = [{ id: 'codex-local', providerId: 'codex' }];
  let attempts = 0;
  const state = createPersistentState({
    load: async () => ({ accounts, settings: { 'quotapeek-selected-account': 'codex-local', 'quotapeek-provider-selection-v1': '{"codex":"codex-local"}' } }),
    saveSettings: async () => {}, saveCache: async () => {},
    removeAccount: async () => { if (++attempts === 1) throw new Error('disk full'); },
  });
  await state.initialize();
  await assert.rejects(state.removeAccount('codex-local'), /disk full/);
  assert.deepEqual(state.getAccounts(), accounts);
  assert.equal(state.getSetting('quotapeek-selected-account'), 'codex-local');
  await state.removeAccount('codex-local');
  assert.deepEqual(state.getAccounts(), []);
  assert.equal(state.getSetting('quotapeek-selected-account'), '');
  assert.equal(state.getSetting('quotapeek-provider-selection-v1'), '{}');
  assert.equal(state.getError(), null);
});
