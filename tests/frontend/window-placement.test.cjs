const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const {horizontalPlacement,physicalHorizontalPlacement}=require('../../src/lib/window/windowPlacement.ts');
const place=overrides=>horizontalPlacement({x:0,currentWidth:78,targetWidth:474,railWidth:62,inset:8,screenLeft:0,screenWidth:1920,side:'right',...overrides});
test('left edge expands to the right without moving the rail',()=>assert.deepEqual(place({}),{x:0,side:'right'}));
test('right edge expands to the left and collapse keeps the rail anchored',()=>{
 const expanded=place({x:1842});
 assert.deepEqual(expanded,{x:1446,side:'left'});
 assert.deepEqual(place({x:expanded.x,currentWidth:474,targetWidth:78,side:'left'}),{x:1842,side:'left'});
});
test('moving a left-opening window to the left edge switches its direction',()=>assert.deepEqual(place({x:-396,currentWidth:474,side:'left'}),{x:0,side:'right'}));
test('placement uses the current monitor origin, including negative coordinates',()=>assert.deepEqual(place({x:-78,screenLeft:-1920}),{x:-474,side:'left'}));

test('200% DPI right-edge expansion and collapse preserve physical rail coordinates',()=>{
 const input={x:3684,currentWidth:78,targetWidth:474,railWidth:62,inset:8,screenLeft:0,screenWidth:3840,side:'right',scaleFactor:2};
 const expanded=physicalHorizontalPlacement(input);
 assert.deepEqual(expanded,{x:2892,side:'left'});
 assert.equal(expanded.x+474*2-8*2-62*2,input.x+8*2);
 assert.deepEqual(physicalHorizontalPlacement({...input,x:expanded.x,currentWidth:474,targetWidth:78,side:'left'}),{x:3684,side:'left'});
});

test('physical screen origins are not rescaled when the window uses fractional DPI',()=>{
 assert.deepEqual(physicalHorizontalPlacement({x:-97.5,currentWidth:78,targetWidth:474,railWidth:62,inset:8,
   screenLeft:-2400,screenWidth:2400,side:'right',scaleFactor:1.25}),{x:-592,side:'left'});
});
