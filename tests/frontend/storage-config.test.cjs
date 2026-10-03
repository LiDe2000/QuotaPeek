const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('all window configurations defer creation until the data root has been resolved', () => {
  for (const file of ['src-tauri/tauri.conf.json', 'src-tauri/tauri.software-rendering.conf.json']) {
    for (const window of read(file).app.windows) assert.equal(window.create, false, file);
  }
});

test('installer builds explicitly select the installed data strategy', () => {
  const scripts = read('package.json').scripts;
  assert.match(scripts['tauri:build:installed'], /--features installed/);
  assert.equal(read('src-tauri/tauri.conf.json').bundle.active, false);
  assert.equal(read('src-tauri/tauri.installed.conf.json').bundle.active, true);
});
