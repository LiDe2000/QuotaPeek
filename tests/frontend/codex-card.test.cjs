const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Transpile the actual card for Node's test runner; no browser or new dependency required.
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
require.extensions['.css'] = () => {};
require.extensions['.png'] = (module, file) => { module.exports = file; };
const { default: Card, windowLabel, expiryStamp } = require('../../src/components/providers/CodexAccountCard.tsx');
const account = { id: 'codex-local', providerId: 'codex', source: 'codex-app-server', email: 'test@example.com', planType: 'plus', fetchedAt: 1 };
const render = (bucket, stale = false) => renderToStaticMarkup(React.createElement(Card, {
  account: { ...account, rateLimits: { codex: bucket } }, active: true, stale, loading: false,
}));
const renderResets = manualResets => renderToStaticMarkup(React.createElement(Card, {
  account: { ...account, rateLimits: {}, rateLimitResetCredits: Array.isArray(manualResets) ? {
    availableCount: manualResets.filter(reset => reset.expiresAt === null || reset.expiresAt * 1000 > Date.now()).length,
    credits: manualResets.map((reset, index) => ({ id: `reset-${index}`, status: 'available', resetType: 'codexRateLimits', ...reset })),
  } : manualResets }, active: true, stale: false, loading: false,
}));
test('manual reset availability distinguishes unknown from zero', () => {
  assert.match(renderResets(undefined), /Unavailable/);
  assert.doesNotMatch(renderResets(undefined), /None available/);
  assert.match(renderResets([]), /None available/);
});
test('manual resets exclude expired grants and show nearest expiry first', () => {
  const early = Math.floor(Date.now() / 1000) + 86400;
  const html = renderResets([{ expiresAt: early + 86400 }, { expiresAt: 1 }, { expiresAt: early }]);
  assert.match(html, /2 available/);
  assert.match(html, /<details><summary>/);
  assert.match(html, /Expires \d{1,2}\/\d{1,2}, \d{1,2}:\d{2} (AM|PM) GMT[+-]\d/);
  const summary = html.match(/<summary>(.*?)<\/summary>/s)[1];
  assert.match(summary, /Manual resets/);
  assert.doesNotMatch(summary, /Expires|Weekly|Next expiry/);
  assert.match(html, /Full reset <span>\(Weekly \+ 5 hr\)<\/span>/);
  assert.equal((html.match(/Full reset/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Use reset/);
});
test('reset expiry uses local twelve-hour time and includes the date timezone offset', () => {
  const date = new Date(2026, 9, 23, 2, 46);
  const offset = -date.getTimezoneOffset();
  const suffix = Math.abs(offset) % 60 ? `:${String(Math.abs(offset) % 60).padStart(2, '0')}` : '';
  assert.equal(expiryStamp(date.getTime() / 1000), `10/23, 2:46 AM GMT${offset >= 0 ? '+' : '-'}${Math.floor(Math.abs(offset) / 60)}${suffix}`);
});
test('manual reset with unknown expiry stays available', () => {
  const html = renderResets([{ expiresAt: null }]);
  assert.match(html, /1 available/);
  assert.match(html, /No expiry/);
  assert.doesNotMatch(html, /Next expiry/);
});
test('server count stays authoritative when reset details are unavailable or capped', () => {
  for (const credits of [null, [], [{ id: 'reset-1', status: 'available', resetType: 'codexRateLimits', expiresAt: null }]]) {
    const html = renderResets({ availableCount: 3, credits });
    assert.match(html, /3 available/);
    assert.doesNotMatch(html, /None available/);
  }
});

test('missing reset details keep the count and offer refresh retry', () => {
  for (const credits of [null, undefined]) {
    const html = renderResets({ availableCount: 2, credits });
    assert.match(html, /2 available/);
    assert.match(html, /temporarily unavailable/);
    assert.match(html, /Refresh to retry/);
    assert.doesNotMatch(html, /No current reset details reported/);
  }
});

test('fetched empty or expired details are not reported as a failed request', () => {
  for (const credits of [[], [{ id: 'expired', status: 'available', resetType: 'codexRateLimits', expiresAt: 1 }]]) {
    const html = renderResets({ availableCount: 2, credits });
    assert.match(html, /2 available/);
    assert.match(html, /No current reset details reported/);
    assert.doesNotMatch(html, /temporarily unavailable|Refresh to retry/);
  }
});

test('partial details remain visible and zero resets do not suggest retry', () => {
  const partial = renderResets({ availableCount: 2, credits: [{ id: 'credit-1', status: 'available', resetType: 'codexRateLimits', expiresAt: null }] });
  assert.match(partial, /2 available/);
  assert.match(partial, /Full reset/);
  assert.match(partial, /Showing reported reset details/);
  assert.doesNotMatch(partial, /temporarily unavailable|Refresh to retry/);
  const zero = renderResets({ availableCount: 0, credits: null });
  assert.match(zero, /None available/);
  assert.doesNotMatch(zero, /temporarily unavailable|Refresh to retry/);
});
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
