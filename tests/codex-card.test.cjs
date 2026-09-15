const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Transpile the actual card for Node's test runner; no browser or new dependency required.
require.extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
require.extensions['.css'] = () => {};
const { default: Card, windowLabel } = require('../src/components/providers/CodexAccountCard.tsx');
const account = { id: 'codex-local', providerId: 'codex', source: 'codex-app-server', email: 'test@example.com', planType: 'plus', fetchedAt: 1 };
const render = (bucket, stale = false) => renderToStaticMarkup(React.createElement(Card, {
  account: { ...account, rateLimits: { codex: bucket } }, active: true, stale, loading: false,
}));
test('labels reflect actual durations instead of assuming five hours', () => {
  assert.equal(windowLabel(300, 'Primary'), '5 Hour Limit');
  assert.equal(windowLabel(10080, 'Secondary'), 'Weekly Limit');
  assert.equal(windowLabel(15, 'Primary'), '15 Minute Limit');
  assert.equal(windowLabel(null, 'Primary'), 'Primary');
});
test('converts usage into remaining percent and omits absent windows', () => {
  const html = render({ primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: null } });
  assert.match(html, /value="58"/);
  assert.match(html, /Reset time unavailable/);
  assert.doesNotMatch(html, /Weekly Limit/);
});
test('missing windows never become zero percent; stale data is labeled', () => {
  const html = render({}, true);
  assert.match(html, /No quota windows reported/);
  assert.match(html, /Stale data/);
  assert.doesNotMatch(html, /<progress/);
});
test('expired reset keeps measured usage and asks for refresh', () => {
  const html = render({ secondary: { usedPercent: 110, windowDurationMins: 10080, resetsAt: 1 } });
  assert.match(html, /value="0"/);
  assert.match(html, /Refresh to check reset/);
});
test('the reset row reads as a remaining duration next to the percent', () => {
  // 156.5 minutes lands mid-minute, so the ceiling is stable at 157 even with a slow render.
  const html = render({ primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 156.5 * 60 } });
  assert.match(html, /2h 37m remaining/);
  assert.doesNotMatch(html, /h \d+m left/);
});
test('the percent stands alone instead of carrying its own label', () => {
  const html = render({ primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: null } });
  assert.match(html, /<strong>85<span>%<\/span><\/strong>/);
  assert.doesNotMatch(html, /remaining-label/);
});
test('the reset stamp is a locale-independent MM-DD HH:MM with padded fields', () => {
  const html = render({ primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 90 * 60 } });
  assert.match(html, /Resets \d{2}-\d{2} \d{2}:\d{2}/);
  assert.doesNotMatch(html, /Resets [0-9]+月|\d{2}\/\d{2}/);
});
test('the latest daily label keeps the dashed month-day', () => {
  const html = renderToStaticMarkup(React.createElement(Card, {
    account: { ...account, rateLimits: {}, tokenUsage: { lifetimeTokens: 1, todayTokens: null, latestDailyDate: '2026-09-14', latestDailyTokens: 2200 } },
    active: true, stale: false, loading: false,
  }));
  assert.match(html, /Latest · 09-14/);
  assert.doesNotMatch(html, /Latest · 09\/14/);
});
