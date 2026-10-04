const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

for (const mode of ['baseline', 'fixed', 'stable', 'activity-preview']) test(mode === 'fixed'
  ? 'fixed viewport comparison renders content without native fitting or movement listeners'
  : `${mode}: right-edge fits commit physical position and size together without crossing DPI boundaries`, async () => {
  let fixedViewport = mode === 'fixed';
  const stableHeight = mode === 'stable' || mode === 'activity-preview';
  if (mode === 'activity-preview') {
    // Sample activities must still resize the native window: use App's actual argument.
    const source = ts.createSourceFile('App.tsx', fs.readFileSync('src/App.tsx','utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let argument;
    function find(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'useFittedWindowHeight') argument = node.arguments[2];
      ts.forEachChild(node,find);
    }
    find(source);
    assert.ok(argument);
    const expression = argument.getText(source).replaceAll('import.meta.env','env');
    fixedViewport = vm.runInNewContext(expression, {activityPreview:true,env:{DEV:true}});
    assert.equal(fixedViewport,false,'Native sample activities must retain automatic window fitting');
  }
  let expanded = false;
  let uiZoom = 1;
  let renderedOverflow = 0;
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
    getBoundingClientRect() { return { right: (this.offsetLeft + this.offsetWidth) * uiZoom + renderedOverflow }; },
    get offsetLeft() { return expanded && node.dataset.side === 'left' ? 352 : 0; } };
  const panel = { offsetWidth: 340, offsetHeight: 300, clientHeight: 300, scrollHeight: 300, offsetTop: 64,
    getBoundingClientRect() { return { right: (this.offsetLeft + this.offsetWidth) * uiZoom + renderedOverflow }; },
    get offsetLeft() { return node.dataset.side === 'left' ? 0 : 74; } };
  const properties = new Map();
  const shell = {};
  const node = { dataset: {}, style: { getPropertyValue: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) },
    getBoundingClientRect: () => ({ left: 0 }),
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
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      assert.equal(command, 'fit_window_bounds');
      assert.deepEqual(Object.keys(args), ['bounds'], 'geometry is sent as one bounds object');
      const bounds = args.bounds;
      assert.equal(bounds.sourceX, position.x, 'fit must use the latest position snapshot');
      assert.equal(bounds.sourceY, position.y);
      calls.push('bounds');
      position = { x: bounds.x, y: bounds.y }; nativeWidth = bounds.width;
      nativeHeight = bounds.height; visibleHeight = bounds.visibleHeight;
      const width = Number(node.dataset.scaleLayoutWidth) || (expanded ? 414 : 62) * uiZoom + renderedOverflow;
      assert.equal(bounds.visibleWidth, Math.ceil((width + 16 * uiZoom) * (Number(node.dataset.scaleFitRatio) || 1)) * 2);
      if (assertRightEdge) assert.equal(bounds.clipLeft + bounds.visibleWidth, 948, 'visible region stays against the same right edge');
      assert.ok(position.x + nativeWidth <= 3840, 'combined bounds must remain on the current monitor');
      listeners.moved?.({ payload: position }); listeners.resize?.();
      return true;
    } },
    '../lib/window/windowHeight': require('../../src/lib/window/windowHeight.ts'),
    '../lib/window/windowPlacement': require('../../src/lib/window/windowPlacement.ts'),
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
    getComputedStyle: () => ({ zoom: String(uiZoom), paddingTop: '8', paddingBottom: '8', paddingLeft: '8', paddingRight: '8', display: 'flex',
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
  if (mode === 'stable') {
    let widestSurface = 948;
    for (const zoom of [0.75, 1.5, 1]) {
      calls.length = 0;
      uiZoom = zoom;
      listeners['interface-scale-changed'](); await flush();
      assert.deepEqual(calls, ['bounds'], 'scale changes schedule native fitting without a browser resize');
      widestSurface = Math.max(widestSurface, Math.round(474 * zoom * 2));
      assert.equal(nativeWidth, widestSurface, 'shrinking keeps the WebView2 surface stable and only changes its visible region');
      assert.equal(visibleHeight, Math.ceil(296 * zoom + 4) * 2, 'visible region follows scaled content');
      assert.equal(nativeHeight, 2000, 'screen ceiling stays in monitor units');
      assert.equal(Number.parseFloat(properties.get('--window-max-height')), 1000 / zoom, 'CSS height ceiling compensates for UI zoom');
    }
    calls.length = 0;
    renderedOverflow = 0.8;
    listeners['interface-scale-changed'](); await flush();
    assert.deepEqual(calls, ['bounds'], 'rendered fractional overflow must expand the visible region');
    renderedOverflow = 0;
    position = { x: position.x, y: 1900 };
    uiZoom = 1.5;
    listeners['interface-scale-changed'](); await flush();
    assert.ok(position.y + visibleHeight <= 2160, 'enlarging near the bottom keeps the entire visible region on screen');
    calls.length = 0;
    uiZoom = 0.75;
    node.dataset.scaleLayoutWidth = String(62 * uiZoom);
    node.dataset.scaleFitRatio = '2';
    listeners['interface-scale-changed'](); await flush();
    assert.equal(nativeWidth, 1422, 'shrinking reserves the original size during the composited transition');
    const reservedHeight = visibleHeight;
    const initialFits = calls.length;
    const reservedPosition = { ...position };
    assert.ok(initialFits <= 1);
    for (let i = 0; i < 10; i++) { observerCallbacks[0](); await flush(); }
    assert.equal(calls.length, initialFits, 'animation frames must not repeatedly adjust native geometry');
    delete node.dataset.scaleLayoutWidth;
    delete node.dataset.scaleFitRatio;
    listeners['interface-scale-changed'](); await flush();
    assert.equal(nativeWidth, 1422, 'the final fit keeps the native surface stable');
    assert.deepEqual(position, reservedPosition, 'releasing reserved space must not move the window at the animation endpoint');
    assert.ok(visibleHeight < reservedHeight);
    assert.equal(calls.length, initialFits + 1);
  }
  cleanup();
});
