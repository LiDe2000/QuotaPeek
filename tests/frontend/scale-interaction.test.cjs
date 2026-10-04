const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const slots = [];
  let index = 0;
  let tree;
  let applied = 100;
  const calls = [];
  const effects = [];
  const react = {
    useRef(value) { const i = index++; return slots[i] ??= { current: value }; },
    useState(value) {
      const i = index++;
      if (!(i in slots)) slots[i] = value;
      return [slots[i], next => { slots[i] = next; }];
    },
    useEffect(effect, deps) {
      const i = index++;
      if (!slots[i] || deps.some((value, j) => value !== slots[i][j])) effects.push(effect);
      slots[i] = deps;
    },
  };
  const jsx = (type, props) => ({ type, props });
  const context = { exports: {}, require: id => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id.endsWith('useStripScroll')) return { useStripScroll() {} };
    if (id.endsWith('interfaceScale')) return { INTERFACE_SCALE: { min: 75, max: 150, step: 5, default: 100 } };
    if (id.endsWith('.css')) return {};
    throw new Error(id);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/settings/AppearanceSettings.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  function render() {
    index = 0;
    tree = context.exports.default({ theme: 'dark', scale: applied, onThemeChange() {}, onClose() {},
      onScaleChange(value) { calls.push(value); applied = value; } });
    effects.splice(0).forEach(effect => effect());
  }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const result = find(child, predicate);
      if (result) return result;
    }
  }
  const target = { value: '100', captured: null, setPointerCapture(id) { this.captured = id; } };
  function event(extra = {}) { return { currentTarget: target, pointerId: 1, button: 0, isPrimary: true, ...extra }; }
  render();
  return { calls, target, event, render,
    slider: () => find(tree, node => node.props?.id === 'interface-scale').props,
    output: () => find(tree, node => node.type === 'output').props.children.join(''),
    reset: () => find(tree, node => node.props?.className === 'scale-reset').props,
  };
}

test('drag previews percentages and applies once on release, including captured outside release', () => {
  const h = harness();
  h.slider().onPointerDown(h.event());
  assert.equal(h.target.captured, 1, 'capture keeps release events when the pointer leaves the slider');
  for (const value of [105, 110, 115]) {
    h.target.value = String(value);
    h.slider().onChange(h.event()); h.render();
    assert.equal(h.output(), `${value}%`);
    assert.deepEqual(h.calls, []);
  }
  h.slider().onPointerUp(h.event()); h.render();
  assert.deepEqual(h.calls, [115]);
  h.slider().onBlur(h.event());
  assert.deepEqual(h.calls, [115], 'blur must not duplicate the committed value');
});

test('cancelled drags restore the applied percentage without resizing', () => {
  const h = harness();
  h.slider().onPointerDown(h.event());
  h.target.value = '140'; h.slider().onChange(h.event()); h.render();
  h.slider().onPointerCancel(h.event()); h.render();
  assert.equal(h.output(), '100%');
  assert.deepEqual(h.calls, []);
});

test('keyboard changes apply on key release and reset applies immediately', () => {
  const h = harness();
  h.target.value = '120'; h.slider().onChange(h.event()); h.render();
  assert.deepEqual(h.calls, []);
  h.slider().onKeyUp(h.event({ key: 'ArrowRight' })); h.render();
  assert.deepEqual(h.calls, [120]);
  h.reset().onClick(); h.render();
  assert.deepEqual(h.calls, [120, 100]);
  assert.equal(h.output(), '100%');
});

test('lost capture discards a draft while blur commits keyboard or accessibility changes', () => {
  const h = harness();
  h.slider().onPointerDown(h.event());
  h.target.value = '130'; h.slider().onChange(h.event()); h.render();
  h.slider().onLostPointerCapture(h.event()); h.render();
  assert.equal(h.output(), '100%');
  assert.deepEqual(h.calls, []);
  h.target.value = '110'; h.slider().onChange(h.event()); h.render();
  h.slider().onBlur(h.event()); h.render();
  assert.deepEqual(h.calls, [110]);
});
