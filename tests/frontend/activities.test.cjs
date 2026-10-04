const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

// Bulk claims must only submit accounts with confirmed availability.
const model = require('../../src/lib/activities/activityState.ts');
const campaign = (id, entries) => ({ id, providerId: 'workbuddy', title: 'Daily reward', reward: '100 credits', entries });

test('bulk claims only target available account entries across providers', () => {
  assert.equal(typeof model.claimableEntries, 'function');
  const rows = [campaign('buddy', [{ accountId: 'a', status: 'available' }]),
    { ...campaign('build', [{ accountId: 'z', status: 'available' }, { accountId: 'b', status: 'verification' },
      { accountId: 'c', status: 'claimed' }, { accountId: 'd', status: 'unknown' }, { accountId: 'e', status: 'pending' },
      { accountId: 'f', status: 'claiming' }, { accountId: 'g', status: 'failed' }]), providerId: 'zcode' }];
  assert.deepEqual(model.claimableEntries(rows), [{ activityId: 'buddy', accountId: 'a' }, { activityId: 'build', accountId: 'z' }]);
});

test('claim results are scoped to the campaign and account, even when the account is shared', () => {
  assert.equal(typeof model.updateActivityEntry, 'function');
  const original = [campaign('daily', [{ accountId: 'a', status: 'available' }, { accountId: 'b', status: 'available' }]),
    campaign('other', [{ accountId: 'a', status: 'available' }])];
  const next = model.updateActivityEntry(original, 'daily', 'a', 'claimed');
  assert.deepEqual(next[0].entries.map(row => row.status), ['claimed', 'available']);
  assert.equal(next[1], original[1]);
  assert.equal(original[0].entries[0].status, 'available');
});
