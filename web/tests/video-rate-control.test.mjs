import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVideoRateControl, videoRateDescription } from '../src/video-rate-control.mjs';

test('moderate dynamic quality prefers its exact quantizer without setting a bitrate',async()=>{
  const attempts=[];const selected=await selectVideoRateControl({quantizer:22,bitrate:30000000},async choice=>{attempts.push(choice);return true;});
  assert.deepEqual(selected,{supported:true,quantizer:22,bitrate:null,qualityMode:'dynamic-quantizer'});assert.equal(attempts.length,1);
});
test('unsupported moderate CQ uses only the declared VBR target and reports that fallback',async()=>{
  const attempts=[];const selected=await selectVideoRateControl({quantizer:26,bitrate:17000000},async choice=>{attempts.push(choice);return choice.quantizer===null;});
  assert.equal(attempts.length,2);assert.deepEqual(selected,{supported:true,quantizer:null,bitrate:17000000,qualityMode:'dynamic-vbr'});
  assert.match(videoRateDescription(selected),/target 17.0 Mbps.*fallback/);
});
test('unsupported moderate CQ and VBR fail instead of increasing bitrate or changing output settings',async()=>{
  const attempts=[];assert.deepEqual(await selectVideoRateControl({quantizer:22,bitrate:30000000},async choice=>{attempts.push(choice);return false;}),{supported:false});
  assert.deepEqual(attempts.map(choice=>[choice.quantizer,choice.bitrate]),[[22,null],[null,30000000]]);
});
test('Maximum has no browser bitrate fallback and ordinary bitrate requests stay variable',async()=>{
  let calls=0;assert.deepEqual(await selectVideoRateControl({quantizer:0,bitrate:null},async()=>{calls++;return false;}),{supported:false});assert.equal(calls,1);
  assert.deepEqual(await selectVideoRateControl({quantizer:null,bitrate:4000000},async()=>true),{supported:true,quantizer:null,bitrate:4000000,qualityMode:'vbr'});
});
test('native CQ, Maximum and VBR labels distinguish quality targets from target or maximum bitrates',()=>{
  assert.match(videoRateDescription({qualityMode:'dynamic-cq',bitrate:0}),/device scale/);
  assert.match(videoRateDescription({qualityMode:'maximum-cq',bitrate:0}),/maximum quality/);
  assert.match(videoRateDescription({qualityMode:'maximum-vbr',bitrate:200000000}),/up to 200.0 Mbps/);
  assert.match(videoRateDescription({qualityMode:'vbr',bitrate:12000000}),/variable bitrate.*target 12.0 Mbps/);
});
