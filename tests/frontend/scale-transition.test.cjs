const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(side = 'right') {
  const animation = { cancel() { this.cancelled = true; }, pause() { this.paused = true; }, play() { this.played = true; } };
  const node = { dataset: { side }, getBoundingClientRect: () => ({ width: 450 }),
    animate(keyframes, options) { animation.keyframes = keyframes; animation.options = options; return animation; } };
  let events = 0;
  const listeners = new Map();
  const context = { exports: {}, document: { querySelector: () => node }, Event: class {},
    setTimeout: () => 1, clearTimeout() {},
    window: { dispatchEvent() { events++; }, addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name) { listeners.delete(name); } } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/appearance/scaleTransition.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return { transition: context.exports.transitionScale, node, animation, events: () => events,
    ready() { listeners.get('interface-scale-fitted')?.(); } };
}

test('both scale directions change real layout once and animate only the visual transform', () => {
  for (const [from, to] of [[1, 1.5], [1.5, 0.75]]) {
    const h = harness();
    const values = [];
    h.transition(from, to, value => values.push(value), false);
    assert.deepEqual(values, [to], 'no per-frame zoom writes or native fitting');
    assert.equal(h.node.dataset.scaleLayoutWidth, '450');
    assert.equal(Number(h.node.dataset.scaleFitRatio), Math.max(1, from / to));
    assert.equal(h.animation.keyframes[0].transform, `scale(${from / to})`);
    assert.equal(h.animation.keyframes[1].transform, 'scale(1)');
    assert.equal(h.animation.options.duration, 180);
    assert.equal(h.animation.paused, true);
    assert.equal(h.animation.played, undefined, 'native geometry must settle before the transition starts');
    h.ready();
    assert.equal(h.animation.played, true);
    h.animation.onfinish();
    assert.equal(h.node.dataset.scaleFitRatio, undefined);
    assert.equal(h.node.dataset.scaleLayoutWidth, undefined);
    assert.equal(h.events(), 1, 'one final fit releases the reserved geometry');
    assert.deepEqual(values, [to]);
  }
});

test('left-opening windows animate around the rail edge and cancellation releases all reservations', () => {
  const h = harness('left');
  const cancel = h.transition(1.5, 1, () => {}, false);
  assert.equal(h.animation.keyframes[0].transformOrigin, 'right top');
  cancel();
  h.ready();
  assert.equal(h.animation.played, undefined, 'cancelled transitions must not restart on late native events');
  assert.equal(h.animation.cancelled, true);
  assert.equal(h.animation.onfinish, null);
  assert.equal(h.node.dataset.scaleFitRatio, undefined);
  assert.equal(h.events(), 0);
});

test('reduced motion and startup scale restore apply directly without animation or reserved space', () => {
  for (const [from, to, reduced] of [[1, 1.5, true], [1.2, 1.2, false]]) {
    const h = harness();
    const values = [];
    h.transition(from, to, value => values.push(value), reduced);
    assert.deepEqual(values, [to]);
    assert.equal(h.animation.keyframes, undefined);
    assert.equal(h.node.dataset.scaleFitRatio, undefined);
  }
});
