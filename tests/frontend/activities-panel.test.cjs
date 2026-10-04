const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
require.extensions['.css'] = () => {};
for (const extension of ['.png', '.svg']) require.extensions[extension] = (module, file) => { module.exports = file; };
const { default: Panel } = require('../../src/components/activities/ActivityPanel.tsx');
const campaigns = [
  { id: 'build', providerId: 'zcode', title: 'Build reward', reward: '100M tokens', entries: [{ accountId: 'z', status: 'available' }] },
  { id: 'bonus', providerId: 'zcode', title: 'Bonus reward', reward: '20M tokens', entries: [{ accountId: 'z', status: 'claimed' }] },
  { id: 'buddy', providerId: 'workbuddy', title: 'Daily credits', reward: '100 credits', entries: [{ accountId: 'w', status: 'available' }] },
];
const render = () => renderToStaticMarkup(React.createElement(Panel, {
  accounts: [], onClose() {},
  controller: { activities: campaigns, demo: true, batchRunning: false, message: null, claim() {}, claimAll() {} },
}));

test('a provider groups all matching campaigns without exposing other provider claims', () => {
  const html = render();
  assert.equal((html.match(/<article /g) ?? []).length, 1);
  assert.match(html, /aria-label="ZCode activities"/);
  assert.match(html, /<h3[^>]*>Build reward<\/h3>/);
  assert.match(html, /<h3[^>]*>Bonus reward<\/h3>/);
  assert.doesNotMatch(html, /Daily credits/);
  assert.match(html, /aria-label="Select WorkBuddy"/);
  assert.match(html, /aria-label="Select ZCode"/);
  assert.equal((html.match(/class="activity-claim"/g) ?? []).length, 1);
});
