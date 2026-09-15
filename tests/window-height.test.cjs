const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Same on-the-fly transpile trick the card test uses; no build step required.
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

const { fittedWindowHeight } = require('../src/lib/windowHeight.ts');

// A real measurement: card 547 + chrome 113 + shell 8, on a 1080p screen.
const fit = overrides => fittedWindowHeight({ content: 547, panel: 0, chrome: 113, padding: 8, current: 700, screen: 1080, ...overrides });

test('measures the card, the chrome and the shell into one height', () => {
  assert.equal(fit({ current: 600 }), 672);
});

test('leaves the window alone once it is within rounding slack', () => {
  assert.equal(fit({ current: 672 }), null);
  assert.equal(fit({ current: 674 }), null);
  assert.equal(fit({ current: 670 }), null);
  assert.equal(fit({ current: 676 }), 672);
});

test('a window with no card is nothing but its header and footer', () => {
  assert.equal(fit({ content: 0, current: 672 }), 125);
});

test('an open panel takes the place of the empty body', () => {
  assert.equal(fit({ content: 0, panel: 220, current: 125 }), 345);
});

test('the taller of the card and the panel wins', () => {
  assert.equal(fit({ panel: 220, current: 125 }), 672);
  assert.equal(fit({ content: 547, panel: 700, current: 672 }), 825);
});

test('stops short of the screen edge and lets the inner scroll area take over', () => {
  assert.equal(fit({ content: 4000, current: 300, screen: 1080 }), 1000);
  assert.equal(fit({ content: 0, panel: 4000, current: 125, screen: 1080 }), 1000);
  assert.equal(fit({ content: 4000, current: 300, screen: 700 }), 620);
});

test('a screen shorter than the empty window still fits the chrome', () => {
  assert.equal(fit({ content: 4000, current: 300, screen: 130 }), 121);
  assert.equal(fit({ content: 4000, current: 300, chrome: 0, padding: 0, screen: 200 }), 120);
});
