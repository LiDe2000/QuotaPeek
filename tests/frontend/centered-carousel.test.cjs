const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const vm = require('node:vm');
const { renderToStaticMarkup } = require('react-dom/server');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
require.extensions['.css'] = () => {};
const { default: CenteredCarousel } = require('../../src/components/shared/CenteredCarousel.tsx');
const { carouselOffset, carouselNext } = require('../../src/lib/navigation/centeredCarousel.ts');

test('cyclic positions put the selected item at zero and connect both ends', () => {
  assert.equal(carouselOffset(0, 0, 4), 0);
  assert.equal(carouselOffset(3, 0, 4), -1);
  assert.equal(carouselOffset(0, 3, 4), 1);
  assert.equal(carouselNext(0, -1, 4), 3);
  assert.equal(carouselNext(3, 1, 4), 0);
  assert.equal(carouselNext(-1, 1, 0), -1);
});

function interaction(count = 4, selected = '0', pressed = false) {
  let time = 1000, ref = 0;
  const listeners = new Map(), calls = [], focused = [], cleanups = [];
  const root = { children: Array.from({ length: count }, (_, i) => ({ querySelector: () => ({ focus: () => focused.push(i) }) })),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const jsx = (type, props) => ({ type, props });
  const context = { exports: {}, Date: { now: () => time }, require: id => {
    if (id === 'react') return {
      useRef: value => ({ current: ref++ === 0 ? root : value }),
      useEffect: fn => cleanups.push(fn()), useLayoutEffect: fn => fn(),
    };
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id.endsWith('/centeredCarousel')) return { carouselOffset, carouselNext };
    if (id.endsWith('.css')) return {};
    throw new Error(id);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/shared/CenteredCarousel.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  const tree = context.exports.default({ items: Array.from({ length: count }, (_, i) => String(i)), selected,
    itemKey: item => item, onSelect: item => calls.push(item), renderItem: () => null, isInteracting: () => pressed, label: 'Options' });
  return { calls, focused, listeners, cleanups,
    key(key, extra = {}) { let prevented = false; tree.props.onKeyDown({ key, preventDefault() { prevented = true; }, ...extra }); return prevented; },
    wheel(delta, extra = {}) { time += 50; let prevented = false; listeners.get('wheel')({ deltaY: delta, deltaX: 0, deltaMode: 0, preventDefault() { prevented = true; }, ...extra }); return prevented; },
  };
}

test('keyboard wraps and focuses the new option, while modified sorting keys are left alone', () => {
  const h = interaction();
  assert.equal(h.key('ArrowLeft'), true);
  assert.deepEqual(h.calls, ['3']); assert.deepEqual(h.focused, [3]);
  h.key('End'); h.key('Home');
  assert.deepEqual(h.calls, ['3', '3', '0']);
  assert.equal(h.key('ArrowRight', { altKey: true }), false);
  assert.equal(interaction(0).key('ArrowRight'), true);
});

test('wheel accumulates small trackpad deltas and throttles momentum; zoom, small lists and dragging pass through', () => {
  const h = interaction();
  for (let i = 0; i < 3; i++) h.wheel(8);
  assert.deepEqual(h.calls, ['1']);
  h.wheel(100); assert.deepEqual(h.calls, ['1']);
  assert.equal(h.wheel(100, { ctrlKey: true }), false);
  assert.equal(interaction(3).wheel(100), false);
  assert.equal(interaction(4, '0', true).wheel(100), false);
  const horizontal = interaction(4, '3');
  horizontal.wheel(0, { deltaX: 100 }); assert.deepEqual(horizontal.calls, ['0']);
  h.cleanups.forEach(fn => fn?.()); assert.equal(h.listeners.size, 0);
});

test('small lists stay centered without duplicates; larger lists loop with one selected center', () => {
  for (const count of [0, 1, 2, 3, 4, 5]) {
    const items = Array.from({ length: count }, (_, i) => String(i));
    const html = renderToStaticMarkup(React.createElement(CenteredCarousel, {
      items, selected: items.at(-1), itemKey: item => item, onSelect() {}, label: 'Options',
      renderItem: (item, props) => React.createElement('button', { ...props, key: item }, item),
    }));
    assert.match(html, new RegExp(`data-looping="${count > 3}"`));
    assert.equal((html.match(/<button/g) ?? []).length, count);
    if (count > 3) assert.equal((html.match(/data-offset="0"/g) ?? []).length, 1);
  }
});
