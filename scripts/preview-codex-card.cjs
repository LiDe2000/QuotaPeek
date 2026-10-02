// Render the real component with explicitly labeled demo data.
// node scripts/preview-codex-card.cjs <output.html> [--serve]
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require.extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
require.extensions['.css'] = () => {};
require.extensions['.png'] = (module, file) => { module.exports = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`; };
const Card = require('../src/components/providers/CodexAccountCard.tsx').default;
const now = Math.floor(Date.now() / 1000);
const account = {
  id: 'codex-local', providerId: 'codex', source: 'codex-app-server', accountId: null,
  email: 'preview@example.com', planType: 'pro', fetchedAt: now,
  rateLimits: { codex: { primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: now + 9400 },
    secondary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: now + 345600 } } },
  tokenUsage: { lifetimeTokens: 1234567, todayTokens: 34567, latestDailyDate: null, latestDailyTokens: null },
};
const states = [
  ['2 次可用 · 点击展开详情', [{ expiresAt: new Date('2026-10-23T02:46:00+08:00').getTime() / 1000 }, { expiresAt: new Date('2026-10-30T02:17:00+08:00').getTime() / 1000 }]],
  ['暂无可用次数', []], ['数据尚未接入', undefined],
];
const css = ['src/styles/tokens.css', 'src/styles/themes.css', 'src/styles/global.css', 'src/components/AccountCard.css', 'src/components/providers/CodexAccountCard.css']
  .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^@import.*$/gm, '')).join('\n');
const cards = states.map(([label, manualResets], index) => `<div class="sample"><h2 class="sample-label">${label}</h2>${renderToStaticMarkup(React.createElement(Card, {
  account: { ...account, rateLimitResetCredits: manualResets && { availableCount: manualResets.length, credits: manualResets.map((reset, i) => ({ ...reset, id: `reset-${i}`, status: 'available', resetType: 'codexRateLimits', title: null, description: null })) } }, active: true, stale: false, loading: false, panelId: `sample-${index}`,
}))}</div>`).join('');
const html = `<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Codex 手动重置 · 第一版预览</title><style>${css}
html,body { overflow:auto; background:var(--color-background); } body { padding:32px; } main { max-width:1100px; margin:auto; } .preview-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; } .preview-header h1 { font-size:20px; } .preview-header p { color:var(--color-text-muted); margin-top:8px; font-size:12px; } .theme-button { background:var(--color-surface); padding:10px 16px; border:1px solid var(--color-border); border-radius:10px; } .samples { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:20px; align-items:start; } .sample-label { margin-bottom:12px; font-size:12px; color:var(--color-text-muted); font-weight:500; } @media(max-width:850px) { .samples { grid-template-columns:1fr; max-width:360px; margin:auto; } body { padding:20px; } }
</style><main><header class="preview-header"><div><h1>Codex · 手动重置</h1><p>第一版 UI 预览 · 以下均为示例数据，不代表真实账户额度</p></div><button class="theme-button" onclick="document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light'">切换深色 / 浅色</button></header><div class="samples">${cards}</div></main></html>`;
const output = process.argv[2];
if (!output) throw new Error('Provide an output HTML path');
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
console.log(output);
if (process.argv.includes('--serve')) {
  require('node:http').createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(output));
  }).listen(4174, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4174'));
}
