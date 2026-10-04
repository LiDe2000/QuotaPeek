const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replace(/\.svg\?url/g, '.svg'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
require.extensions['.css'] = () => {};
for (const extension of ['.png', '.svg']) require.extensions[extension] = (module, file) => { module.exports = file; };
const { default: ProviderOpenButton } = require('../../src/components/navigation/ProviderOpenButton.tsx');
require.cache[require.resolve('../../src/lib/providers/providerIcons.ts')] = { exports: { providerIcon: provider => `/icons/${provider}.svg` } };
const { default: ProviderSwitcher } = require('../../src/components/navigation/ProviderSwitcher.tsx');
const { default: AccountCard } = require('../../src/components/accounts/AccountCard.tsx');

test('each provider launcher has an accessible target', () => {
  for (const providerId of ['codex', 'workbuddy', 'zcode', 'deepseek']) {
    const html = renderToStaticMarkup(React.createElement(ProviderOpenButton, { provider: providerId }));
    assert.match(html, /class="provider-open-trigger"/);
    assert.match(html, /aria-label="Open /);
    assert.match(html, /class="ui-icon"/);
    assert.doesNotMatch(html, /disabled=""/, 'launching is available outside sample previews');
    if (providerId === 'deepseek') assert.match(html, /Open DeepSeek Harness/);
  }
});

test('sample previews cannot launch real applications', () => {
  const html = renderToStaticMarkup(React.createElement(ProviderOpenButton, { provider: 'codex', disabled: true }));
  assert.match(html, /disabled=""/);
});

test('provider segments pair separate selection and launch buttons without nesting buttons', () => {
  const providers = ['codex', 'workbuddy', 'zcode', 'deepseek'];
  const groups = providers.map(providerId => ({ providerId, accounts: [], selected: { id: providerId } }));
  const html = renderToStaticMarkup(React.createElement(ProviderSwitcher, {
    groups, selected: 'workbuddy', onSelect: () => {}, onReorder: () => {},
  }));
  assert.equal((html.match(/class="provider-open-trigger"/g) ?? []).length, 4);
  assert.equal((html.match(/provider-segment provider-/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
});

test('account cards never duplicate the shared application launcher', () => {
  const html = renderToStaticMarkup(React.createElement(AccountCard, {
    account: { id: 'codex', providerId: 'codex' }, active: true, stale: false, loading: false, preview: true,
  }));
  assert.doesNotMatch(html, /provider-open-trigger/);
});
