const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Drive the hook's actual handlers with a deterministic clock and layout.
// Browser geometry and pointer capture are the boundary doubles, not the reorder logic.
function setup(axis = 'y', zoom = 1) {
  const timers = new Map(), frames = new Map(), listeners = new Map(), moves = [];
  let serial = 0, state = null;
  const buttons = ['workbuddy', 'codex', 'deepseek'].map((provider, index) => ({
    dataset: { provider }, offsetTop: index * 50, offsetLeft: index * 80, offsetWidth: 80, offsetHeight: 50,
    setPointerCapture() { this.captured = true; }, hasPointerCapture() { return this.captured; }, releasePointerCapture() { this.captured = false; },
  }));
  const root = { scrollTop: 0, scrollLeft: 0, scrollHeight: 150, clientHeight: 150, scrollWidth: 240, clientWidth: 240,
    getBoundingClientRect: () => ({ top: 0, bottom: 150 * zoom, left: 0, right: 240 * zoom }), querySelectorAll: () => buttons };
  const hooks = { useRef: value => ({ current: value }), useState: () => [null, value => { state = typeof value === 'function' ? value(state) : value; }], useEffect: effect => effect() };
  const context = { exports: {}, require: name => { assert.equal(name, 'react'); return hooks; },
    setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id),
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../../src/hooks/useProviderReorder.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const hook = context.exports.useProviderReorder(axis, (...args) => moves.push(args));
  hook.container.current = root;
  const props = hook.itemProps('workbuddy');
  const event = (x = 40, y = 25) => ({ isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: buttons[0], preventDefault() {}, stopPropagation() {} });
  return { props, event, moves, root, timers, frames, buttons, listeners, state: () => state,
    hold: () => { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); },
    blocked: () => { let blocked = false; props.onClickCapture({ detail: 1, preventDefault() { blocked = true; }, stopPropagation() {} }); return blocked; } };
}

test('scaled provider dragging converts screen coordinates to layout coordinates', () => {
  const h = setup('x', 1.5);
  h.props.onPointerDown(h.event(60, 37.5)); h.hold();
  h.props.onPointerUp(h.event(180, 37.5));
  assert.deepEqual(h.moves, [['workbuddy', 'codex']]);
});

test('short clicks remain clicks; early movement cancels long press without sorting or refreshing', () => {
  const h = setup();
  h.props.onPointerDown(h.event()); h.props.onPointerUp(h.event()); h.hold();
  assert.equal(h.blocked(), false); assert.equal(h.moves.length, 0); assert.equal(h.state(), null);
  h.props.onPointerDown(h.event()); h.props.onPointerMove(h.event(40, 90)); h.hold();
  assert.equal(h.blocked(), true); assert.equal(h.moves.length, 0); assert.equal(h.state(), null);
});

test('long press drops at final pointer coordinates in both axes and suppresses click', () => {
  for (const axis of ['x', 'y']) {
    const h = setup(axis);
    h.props.onPointerDown(h.event()); h.hold();
    assert.equal(h.state().source, 'workbuddy');
    h.props.onPointerUp(axis === 'x' ? h.event(200, 25) : h.event(40, 125));
    assert.deepEqual(h.moves, [['workbuddy', 'deepseek']]);
    assert.equal(h.blocked(), true); assert.equal(h.frames.size, 0);
    h.props.onPointerDown(h.event()); h.props.onPointerUp(h.event());
    assert.equal(h.blocked(), false);
  }
});

test('Escape, blur, lost capture, pointer cancellation and outside drops discard reordering', () => {
  for (const cancel of [h => h.listeners.get('keydown')({key:'Escape',preventDefault(){}}), h => h.listeners.get('blur')(),
    h => h.props.onLostPointerCapture(), h => h.props.onPointerCancel(h.event()), h => h.props.onPointerUp(h.event(900, 900))]) {
    const h = setup(); h.props.onPointerDown(h.event()); h.hold(); cancel(h);
    assert.equal(h.moves.length, 0); assert.equal(h.state(), null); assert.equal(h.frames.size, 0); assert.equal(h.blocked(), true);
  }
});

test('Escape during the initial hold also prevents an accidental refresh click', () => {
  const h = setup(); h.props.onPointerDown(h.event()); h.listeners.get('keydown')({key:'Escape',preventDefault(){}});
  h.hold(); h.props.onPointerUp(h.event());
  assert.equal(h.moves.length, 0); assert.equal(h.blocked(), true);
});

test('dragging at an overflowing edge cannot extend its own scroll range indefinitely', () => {
  const h = setup('x'); h.root.clientWidth = 160; h.root.getBoundingClientRect = () => ({top:0,bottom:50,left:0,right:160});
  h.props.onPointerDown(h.event()); h.hold(); h.props.onPointerMove(h.event(158,25));
  for(let i=0;i<100;i++){const tasks=[...h.frames.values()];h.frames.clear();tasks.forEach(fn=>fn());}
  assert.equal(h.root.scrollLeft, 80);
  h.props.onPointerCancel(h.event());
});

test('Alt+Right reorders the provider wrapper when the focused button is nested inside it', () => {
  const h = setup('x');
  h.props.onKeyDown({ altKey: true, key: 'ArrowRight', currentTarget: { closest: () => h.buttons[0] }, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(h.moves, [['workbuddy', 'codex']]);
});

test('neighbors make room before release in both axes, then cancellation restores the order', () => {
  for (const axis of ['x', 'y']) {
    const h = setup(axis);
    h.props.onPointerDown(h.event()); h.hold();
    h.props.onPointerMove(axis === 'x' ? h.event(200, 25) : h.event(40, 125));
    const tasks = [...h.frames.values()]; h.frames.clear(); tasks.forEach(fn => fn());
    assert.equal(h.state().shifts.codex, axis === 'x' ? -80 : -50);
    assert.equal(h.state().shifts.deepseek, axis === 'x' ? -80 : -50);
    assert.deepEqual(h.moves, [], 'preview must not save an order');
    h.props.onPointerCancel();
    assert.equal(h.state(), null); assert.deepEqual(h.moves, []);
  }
});

test('circular dragging across the visual seam commits the previewed neighbors', () => {
  const h = setup('x');
  h.root.dataset = { looping: 'true' };
  h.buttons[0].offsetLeft = 80; h.buttons[1].offsetLeft = 160; h.buttons[2].offsetLeft = 0;
  h.props.onPointerDown(h.event(120, 25)); h.hold();
  h.props.onPointerUp(h.event(40, 25));
  assert.deepEqual(h.moves, [['workbuddy', 'codex']]);
});
