const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
}
require.extensions['.css'] = () => {};
require.extensions['.svg'] = (module, file) => { module.exports = file; };
require.extensions['.png'] = (module, file) => { module.exports = file; };
const { default: Card } = require('../src/components/providers/DeepseekAccountCard.tsx');
const { formatMoney } = require('../src/lib/money.ts');
const { cachedAccounts, restoreAccounts } = require('../src/lib/accountState.ts');
const { orbMeter } = require('../src/lib/orb.ts');
const { providerGroups, readProviderSelection } = require('../src/lib/providerGroups.ts');
const account = { id: 'deepseek-one', providerId: 'deepseek', source: 'deepseek-api', label: 'Personal', fetchedAt: 42, isAvailable: true,
  balances: [{ currency: 'CNY', total_balance: '110.001', granted_balance: '10.001', topped_up_balance: '100' },
    { currency: 'USD', total_balance: '2.50', granted_balance: '0', topped_up_balance: '2.50' }] };
const render = value => renderToStaticMarkup(React.createElement(Card, { account: value, active: true, stale: false, loading: false, panelId: value.id }));
test('balance card preserves separate currencies and never invents a quota percentage', () => {
  const html = render(account);
  assert.match(html, /¥110\.00/);
  assert.match(html, /\$2\.50/);
  assert.match(html, /Granted balance/);
  assert.match(html, /Topped-up balance/);
  assert.doesNotMatch(html, /\shidden(?:=|\s|>)|aria-expanded|View breakdown|Hide breakdown/);
  assert.doesNotMatch(html, /<progress|Remaining:|%/);
  assert.deepEqual(orbMeter(account), { percent: null, used: null, total: null });
});
test('zero balance remains a connected card with an actionable availability state', () => {
  const html = render({ ...account, isAvailable: false, balances: [{ currency: 'CNY', total_balance: '0', granted_balance: '0', topped_up_balance: '0' }] });
  assert.match(html, /¥0\.00/);
  assert.match(html, /Top up to continue/);
});
test('platform accounts show their identity and preserve negative recharge balances', () => {
  const html = render({ ...account, source: 'deepseek-platform', contact: '152******56', balances: [{ currency: 'CNY', total_balance: '5.98305', granted_balance: '6', topped_up_balance: '-0.01695' }] });
  assert.match(html, /152\*\*\*\*\*\*56/);
  assert.match(html, /¥5\.98/);
  assert.match(html, /-¥0\.02/);
  assert.match(html, /¥6\.00/);
  assert.doesNotMatch(html, /Personal · API/);
});

test('money displays exact cent rounding, trailing zeros and no negative zero', () => {
  assert.equal(formatMoney('1.005', 'CNY'), '¥1.01');
  assert.equal(formatMoney('-1.005', 'CNY'), '-¥1.01');
  assert.equal(formatMoney('-0.001', 'CNY'), '¥0.00');
  assert.equal(formatMoney('9.999', 'USD'), '$10.00');
  assert.equal(formatMoney('1.005e1', 'USD'), '$10.05');
  assert.equal(formatMoney('9007199254740993.015', 'CNY'), '¥9007199254740993.02');
});
test('cumulative spending is always visible and missing spending never becomes zero', () => {
  const html = render({ ...account, balances: [{ ...account.balances[0], total_cost: '1.005' }] });
  assert.match(html, /<dt title="Total spent">Spent<\/dt><dd>¥1\.01<\/dd>/);
  assert.match(render(account), /Total spending is not available for this account/);
});

test('startup restores named API accounts and preserves cached balances', () => {
  const cached = cachedAccounts(JSON.stringify([account]));
  const restored = restoreAccounts(cached, [{ ...account, fetchedAt: 0, balances: [] }], ['deepseek']);
  assert.equal(restored[0].fetchedAt, 42);
  assert.deepEqual(restored[0].balances, account.balances);
  assert.deepEqual(restoreAccounts(cached, [], ['deepseek']), []);
});
test('DeepSeek keys group under one provider with independent named selections', () => {
  const second = { ...account, id: 'deepseek-two', label: 'Work' };
  const selection = readProviderSelection(JSON.stringify({ deepseek: second.id }));
  const groups = providerGroups([account, second], selection);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].selected.id, second.id);
});

const { formatRefreshTime } = require('../src/lib/refreshTime.ts');
test('legacy DeepSeek refresh timestamps migrate from milliseconds without losing balances', () => {
  const milliseconds = Date.parse('2026-10-02T06:26:48.123Z');
  const seconds = Math.floor(milliseconds / 1000);
  for (const source of ['deepseek-api', 'deepseek-platform']) {
    const legacy = { ...account, source, fetchedAt: milliseconds };
    const migrated = cachedAccounts(JSON.stringify([legacy]));
    assert.equal(migrated[0].fetchedAt, seconds);
    assert.equal(new Date(migrated[0].fetchedAt * 1000).toISOString(), '2026-10-02T06:26:48.000Z');
    assert.deepEqual(migrated[0].balances, legacy.balances);
    const restored = restoreAccounts(migrated, [{ ...legacy, fetchedAt: 0, balances: [] }], ['deepseek']);
    assert.equal(restored[0].fetchedAt, seconds);
    assert.equal(cachedAccounts(JSON.stringify(restored))[0].fetchedAt, seconds);
  }
  assert.equal(cachedAccounts(JSON.stringify([{ ...account, fetchedAt: seconds }]))[0].fetchedAt, seconds);
  assert.equal(cachedAccounts(JSON.stringify([{ ...account, fetchedAt: 0 }]))[0].fetchedAt, 0);
  const other = { id: 'codex', providerId: 'codex', rateLimits: {}, fetchedAt: milliseconds };
  assert.equal(cachedAccounts(JSON.stringify([other]))[0].fetchedAt, milliseconds);
});
test('refresh time uses local 24-hour time in both the main window and preview', () => {
  for (const hour of [0, 13, 23]) {
    const timestamp = new Date(2026, 9, 2, hour, 26, 48).getTime() / 1000;
    const expected = `${String(hour).padStart(2, '0')}:26:48`;
    assert.equal(formatRefreshTime(timestamp), expected);
    assert.ok(formatRefreshTime(timestamp, true).includes(expected));
    assert.ok(formatRefreshTime(timestamp, true).includes('2026'));
  }
});
