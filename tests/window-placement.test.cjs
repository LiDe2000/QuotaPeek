const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const {horizontalPlacement}=require('../src/lib/windowPlacement.ts');
const place=overrides=>horizontalPlacement({x:0,currentWidth:78,targetWidth:474,railWidth:62,inset:8,screenLeft:0,screenWidth:1920,side:'right',...overrides});
test('left edge expands to the right without moving the rail',()=>assert.deepEqual(place({}),{x:0,side:'right'}));
test('right edge expands to the left and collapse keeps the rail anchored',()=>{
 const expanded=place({x:1842});
 assert.deepEqual(expanded,{x:1446,side:'left'});
 assert.deepEqual(place({x:expanded.x,currentWidth:474,targetWidth:78,side:'left'}),{x:1842,side:'left'});
});
test('moving a left-opening window to the left edge switches its direction',()=>assert.deepEqual(place({x:-396,currentWidth:474,side:'left'}),{x:0,side:'right'}));
test('placement uses the current monitor origin, including negative coordinates',()=>assert.deepEqual(place({x:-78,screenLeft:-1920}),{x:-474,side:'left'}));
