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
