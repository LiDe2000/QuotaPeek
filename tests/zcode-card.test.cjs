const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

require.extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
require.extensions['.css'] = () => {};
const { default: Card, resetText } = require('../src/components/providers/ZcodeAccountCard.tsx');

const account = {
  id: 'zcode-oauth',
  providerId: 'zcode',
  source: 'zcode-billing',
  email: 'LiDe',
  planName: 'ZCode Trust Build',
  planDescription: 'ZCode Global Build',
  region: 'cn',
  fetchedAt: 1790823847,
  windows: [{
    key: 'bucket_2105488821852463104',
    label: 'GLM-5.3-Flash',
    unit: 'token',
    usedPercent: 25,
    used: 25000000,
    remain: 75000000,
    total: 100000000,
    resetsAt: Date.now() + 3600 * 1000,
    oneTime: true,
  }],
};
const render = (overrides = {}, stale = false) => renderToStaticMarkup(React.createElement(Card, {
  account: { ...account, ...overrides }, active: true, stale, loading: false,
}));

test('the hero sums every bucket and names the unit', () => {
  const html = render();
  assert.match(html, /Tokens remaining/);
  assert.match(html, /75M<span> tokens<\/span>/);
  assert.match(html, /25% used · 25M of 100M used/);
});

test('each balance becomes its own row with the model as its label', () => {
  const html = render({
    windows: [
      account.windows[0],
      { key: 'bucket-2', label: 'GLM-5.3', unit: 'token', usedPercent: 50, used: 50, remain: 50, total: 100, resetsAt: null, oneTime: false },
    ],
  });
  assert.match(html, /GLM-5\.3-Flash/);
  assert.match(html, /25M \/ 100M tokens/);
  assert.equal((html.match(/class="zc-window"/g) || []).length, 2);
  // The hero stays one figure: the buckets are summed before they are shown.
  assert.match(html, /75M<span> tokens<\/span>/);
});

test('a one-time grant expires while a recurring one resets', () => {
  assert.match(render(), /Expires \d\d-\d\d \d\d:\d\d/);
  const recurring = render({ windows: [{ ...account.windows[0], oneTime: false }] });
  assert.match(recurring, /Resets \d\d-\d\d \d\d:\d\d/);
  assert.doesNotMatch(recurring, /Expires/);
});

test('an expired one-time grant reads as expired, not as a stale reset', () => {
  const html = render({ windows: [{ ...account.windows[0], resetsAt: 1 }] });
  assert.match(html, />Expired</);
  assert.match(html, /Expires 01-01 08:00/);
});

test('missing buckets never invent a percentage or a zero balance', () => {
  const html = render({ windows: [], planName: null, email: null });
  assert.match(html, /Quota remaining/);
  assert.match(html, />—</);
  assert.match(html, /No quota bucket reported\./);
  assert.match(html, /No quota buckets reported for this ZCode account\./);
  assert.match(html, /Plan unavailable/);
  assert.match(html, /ZCode account/);
  // No data means no bar and no unit label, rather than a zeroed one.
  assert.doesNotMatch(html, /<progress/);
  assert.doesNotMatch(html, /units/);
});

test('the region follows the account system the sign-in used', () => {
  assert.match(render(), /LiDe · CN/);
  assert.match(render({ region: 'global' }), /LiDe · Global/);
});

test('stale data is labelled instead of silently shown', () => {
  assert.match(render({}, true), /Stale data/);
  assert.doesNotMatch(render(), /Stale data/);
});

test('percent formatting drops a trailing decimal but keeps one when it matters', () => {
  assert.equal(resetText(null, 0, false)[0], 'Reset time unavailable');
  assert.equal(resetText(null, 0, true)[0], 'Expiry unavailable');
  const [label] = resetText(Date.now() + 90 * 60000, Date.now(), false);
  assert.match(label, /^Resets \d\d-\d\d \d\d:\d\d$/);
});
