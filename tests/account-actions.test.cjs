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
const { default: AccountActions, RemovalConfirmation } = require('../src/components/AccountActions.tsx');
const { default: AccountCard } = require('../src/components/AccountCard.tsx');
const account = { id: 'codex-local', providerId: 'codex', email: 'test@example.com' };

test('a single account has a direct accessible removal button', () => {
  const html = renderToStaticMarkup(React.createElement(AccountActions, { disabled: false, onRemove: async () => true }));
  assert.match(html, /Remove account/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /<details/);
});

test('confirmation contains just the question and actions without repeating account details', () => {
  const html = renderToStaticMarkup(React.createElement(RemovalConfirmation, {
    busy: false, error: null, onConfirm: () => {}, onCancel: () => {},
  }));
  assert.match(html, /role="alertdialog"/);
  assert.match(html, />Remove account\?</);
  assert.doesNotMatch(html, /test@example.com|removal-account-name|<p|aria-describedby/);
  assert.match(html, />Cancel</);
  assert.match(html, />Remove</);
});

test('removal progress disables confirmation and cancellation and errors remain visible', () => {
  const html = renderToStaticMarkup(React.createElement(RemovalConfirmation, {
    busy: true, error: 'Could not remove this account.', onConfirm: () => {}, onCancel: () => {},
  }));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
  assert.match(html, /Removing/);
  assert.match(html, /role="alert"/);
});

test('all provider cards contain their own removal control and previews do not expose it', () => {
  const accounts = [
    { ...account, fetchedAt: 1, rateLimits: {} },
    { id:'w', providerId:'workbuddy', fetchedAt:1, uid:'demo', totalRemain:90, totalUsed:10, totalSize:100, packages:[] },
    { id:'z', providerId:'zcode', fetchedAt:1, email:'demo@example.com', windows:[] },
    { id:'d', providerId:'deepseek', fetchedAt:1, label:'Demo', isAvailable:true, balances:[] },
  ];
  for (const account of accounts) {
    const render = preview => renderToStaticMarkup(React.createElement(AccountCard, {account, active:true, stale:false, loading:false, preview, onRemove:async()=>true}));
    assert.match(render(false), /<span class="connection-status[^>]*><\/span><button type="button" class="account-remove-trigger"/);
    assert.doesNotMatch(render(true), /account-remove-trigger/);
    const placeholder = renderToStaticMarkup(React.createElement(AccountCard, {account:{...account,fetchedAt:0}, active:true, stale:true, loading:false, onRemove:async()=>true}));
    assert.match(placeholder, /account-remove-trigger/, 'an account with a failed first query can also be removed');
  }
});
