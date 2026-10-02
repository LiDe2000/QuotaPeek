const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

for (const mode of ['baseline', 'fixed', 'stable']) test(mode === 'fixed'
  ? 'fixed viewport comparison renders content without native fitting or movement listeners'
  : `${mode}: right-edge fits commit physical position and size together without crossing DPI boundaries`, async () => {
  const fixedViewport = mode === 'fixed';
  const stableHeight = mode === 'stable';
  let expanded = false;
  let position = { x: 3684, y: 80 };
  let nativeWidth = 156;
  let nativeHeight = 600;
  let visibleHeight = 600;
  const calls = [];
  const frames = [];
  const listeners = {};
  let cleanup;
  let assertRightEdge = true;
  let blockNextRead = false;
  let releasePositionRead;
  const rail = { offsetWidth: 62, offsetHeight: 280, clientHeight: 280, scrollHeight: 280, offsetTop: 0,
    get offsetLeft() { return expanded && node.dataset.side === 'left' ? 352 : 0; } };
  const panel = { offsetWidth: 340, offsetHeight: 300, clientHeight: 300, scrollHeight: 300, offsetTop: 64,
    get offsetLeft() { return node.dataset.side === 'left' ? 0 : 74; } };
  const properties = new Map();
  const shell = {};
  const node = { dataset: {}, style: { getPropertyValue: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) },
    closest: () => shell, querySelector: () => rail, querySelectorAll: () => [],
    get children() { return expanded ? [rail, panel] : [rail]; } };
  const appWindow = {
    outerPosition: async () => {
      assert.equal(fixedViewport, false, 'fixed viewport must not query native geometry');
      const snapshot = { ...position };
      if (!blockNextRead) return snapshot;
      blockNextRead = false;
      return new Promise(resolve => { releasePositionRead = () => resolve(snapshot); });
    }, scaleFactor: async () => 2,
    onMoved: async handler => { listeners.moved = handler; return () => {}; },
    onScaleChanged: async () => () => {},
  };
  const mocks = {
    react: { useEffect: callback => { cleanup = callback(); } },
    '@tauri-apps/api/window': { getCurrentWindow: () => appWindow,
      currentMonitor: async () => ({ scaleFactor: 1, workArea: { position: { x: 0, y: 0 }, size: { width: 3840, height: 2160 } } }) },
    '@tauri-apps/api/event': { listen: async (name, handler) => {
      assert.equal(name, 'desktop-window-dragging'); listeners.drag = handler; return () => {};
    } },
    '@tauri-apps/api/core': { invoke: async (command, bounds) => {
      assert.equal(command, 'fit_window_bounds');
      assert.equal(bounds.sourceX, position.x, 'fit must use the latest position snapshot');
      assert.equal(bounds.sourceY, position.y);
      calls.push('bounds');
      position = { x: bounds.x, y: bounds.y }; nativeWidth = bounds.width;
      nativeHeight = bounds.height; visibleHeight = bounds.visibleHeight;
      assert.equal(bounds.visibleWidth, expanded ? 860 : 156);
      if (assertRightEdge) assert.equal(bounds.clipLeft + bounds.visibleWidth, 948, 'visible region stays against the same right edge');
      assert.ok(position.x + nativeWidth <= 3840, 'combined bounds must remain on the current monitor');
      listeners.moved?.({ payload: position }); listeners.resize?.();
      return true;
    } },
    '../lib/windowHeight': require('../src/lib/windowHeight.ts'),
    '../lib/windowPlacement': require('../src/lib/windowPlacement.ts'),
  };
  const observerCallbacks = [];
  class Observer {
    constructor(callback) { observerCallbacks.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  }
  const context = { exports: {}, require: id => mocks[id], console,
    navigator: { userAgent: 'Windows' },
    window: { screen: { availHeight: 1080 }, innerWidth: 78, innerHeight: 300,
      addEventListener: (name, callback) => { listeners[name] = callback; }, removeEventListener() {} },
    ResizeObserver: Observer, MutationObserver: Observer,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {},
    getComputedStyle: () => ({ paddingTop: '8', paddingBottom: '8', paddingLeft: '8', paddingRight: '8', display: 'flex',
      columnGap: '12', getPropertyValue: () => '384' }),
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/hooks/useFittedWindowHeight.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  // Omitting the override must exercise the same stable geometry as release builds.
  context.exports.useFittedWindowHeight({ current: node }, true, fixedViewport, stableHeight ? undefined : false);
  async function flush() {
    for (let i = 0; i < 40; i++) { frames.shift()?.(); await Promise.resolve(); }
    assert.equal(frames.length, 0);
  }
  await flush();
  if (fixedViewport) {
    expanded = true; observerCallbacks[1](); await flush();
    expanded = false; observerCallbacks[1](); await flush();
    listeners.resize(); await flush();
    assert.deepEqual(calls, [], 'content changes must never update native bounds or regions');
    assert.equal(listeners.moved, undefined);
    assert.equal(listeners.drag, undefined);
    assert.equal(properties.get('--window-max-height'), '300px', 'content scrolls within the fixed viewport');
    cleanup();
    return;
  }
  calls.length = 0;
  for (let i = 0; i < 3; i++) {
    expanded = true; observerCallbacks[1](); await flush();
    assert.deepEqual(calls.splice(0), ['bounds']);
    assert.equal(position.x, 2892);
    assert.equal(nativeWidth, 948);
    assert.equal(visibleHeight, 768, 'expanded content keeps its natural visible height');
    assert.equal(nativeHeight, stableHeight ? 2000 : visibleHeight);
    expanded = false; observerCallbacks[1](); await flush();
    assert.deepEqual(calls.splice(0), ['bounds']);
    assert.equal(position.x, 2892);
    assert.equal(nativeWidth, 948);
    assert.equal(visibleHeight, 600, 'collapsed blank area must not intercept input');
    assert.equal(nativeHeight, stableHeight ? 2000 : visibleHeight, 'stable mode must never resize the surface on collapse');
  }
  observerCallbacks[0](); await flush();
  assert.deepEqual(calls, [], 'unchanged bounds should not issue native updates');
  listeners.drag({ payload: true });
  assertRightEdge = false;
  for (const x of [2600, 1800, 400, -120]) {
    position = { x, y: 80 };
    listeners.moved({ payload: position }); observerCallbacks[0](); await flush();
    assert.equal(node.dataset.side, 'left', 'opening direction must not change while grabbed');
    assert.deepEqual(calls, [], 'native dragging owns the position until release');
    assert.equal(position.x, x, 'fitting must not detach the window from the pointer');
  }
  listeners.drag({ payload: false }); await flush();
  assert.equal(node.dataset.side, 'right', 'opening direction updates after release near the left edge');
  assert.deepEqual(calls, ['bounds'], 'release performs one final fit');
  calls.length = 0;
  blockNextRead = true;
  position = { x: 1000, y: 80 };
  listeners.moved({ payload: position }); await flush();
  assert.equal(typeof releasePositionRead, 'function');
  listeners.drag({ payload: true });
  position = { x: 900, y: 100 };
  listeners.moved({ payload: position });
  releasePositionRead(); await flush();
  assert.deepEqual(calls, [], 'an in-flight geometry read is discarded if dragging starts');
  assert.equal(position.x, 900);
  listeners.drag({ payload: false }); await flush();
  assert.equal(position.x, 900, 'release must never restore the obsolete position');
  cleanup();
});
