const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual carousel handler, including its ancestor checks.
const source = ts.createSourceFile('App.tsx', fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onPointerDown') handler = node.initializer.expression.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler, 'Carousel pointer handler must exist');
const code = ts.transpileModule(`const handle = ${handler}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function element(tag, parent = null) {
  return { closest(selector) { return selector.split(',').map(part => part.trim()).includes(tag) ? this : parent?.closest(selector) ?? null; } };
}
function press(target) {
  const drag = { current: null };
  const context = { drag };
  vm.createContext(context);
  vm.runInContext(code, context);
  let captures = 0;
  context.event = { target, isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 20,
    currentTarget: { setPointerCapture() { captures++; } } };
  vm.runInContext('handle(event)', context);
  return { captures, drag };
}
test('carousel leaves disclosure clicks and their nested labels uncaptured', () => {
  for (const target of [element('summary'), element('span', element('summary')), element('button')]) {
    const result = press(target);
    assert.equal(result.captures, 0);
    assert.equal(result.drag.current, null);
  }
});
test('carousel still captures gestures on ordinary card content', () => {
  const result = press(element('span', element('section')));
  assert.equal(result.captures, 1);
  assert.equal(result.drag.current.x, 10);
});
