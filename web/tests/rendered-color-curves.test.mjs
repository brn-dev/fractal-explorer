import test from 'node:test';
import assert from 'node:assert/strict';
import {correctRenderedPixels,renderedCurveLUT,RENDERED_LUT_SIZE} from '../src/rendered-color-curves.mjs';

const source=Uint8ClampedArray.from([0,0,0,255,128,128,128,255,240,80,20,255,5,20,60,120]);
test('rendered corrections are non-destructive and identity is byte exact',()=>{
  const result=correctRenderedPixels(source,{});assert.deepEqual(result,source);assert.notEqual(result,source);
  assert.deepEqual(correctRenderedPixels(source,{tone:{points:[[0,0],[.5,.5],[1,1]]}}),source);
  assert.equal(renderedCurveLUT({}).length,RENDERED_LUT_SIZE*4);
});
test('rendered tone affects black/interior pixels and RGB applies after tone, preserving alpha',()=>{
  const tone={points:[[0,.1],[1,1]],interpolation:'segments'},red={points:[[0,0],[1,.5]],interpolation:'segments'};
  const result=correctRenderedPixels(source,{tone,red});
  assert.ok(result[0]>=12&&result[0]<=13);assert.equal(result[1],26);assert.equal(result[2],26);
  assert.ok(result[4]<result[5]);for(let i=3;i<source.length;i+=4)assert.equal(result[i],source[i]);
  assert.deepEqual(source,Uint8ClampedArray.from([0,0,0,255,128,128,128,255,240,80,20,255,5,20,60,120]));
});
test('rendered correction rejects malformed curves instead of corrupting a preview',()=>{
  assert.throws(()=>correctRenderedPixels(source,{unknown:{}}));
  assert.throws(()=>renderedCurveLUT({red:{points:[[0,0],[.5,1],[.5,0],[1,1]]}}));
});
