import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createShareURL, readShareURL, sharedState, shareBaseURL, MAX_SHARE_BYTES } from '../src/share.mjs';
import { fractals, defaultView } from '../src/fractals.mjs';
import { animationParameters, defaultAutomation, cycleShapes } from '../src/animation.mjs';

const view={fractal:'multijulia',x:'-.743643887037151',y:'.13182590420533',span:'0.0001',iterations:800,bailout:64,julia_x:'-.8',julia_y:'.156',power:4};
const state={version:1,view,automation:{julia_x:{enabled:true,target:'-.7',speed:.25,shape:'smooth-middle'},power:{enabled:true,target:'8',speed:.15,shape:'hold'}},palette:3,density:1.3,phase:.45,wanderingSpeed:.35,wander:true,vignetteEnabled:false,paused:true};
const base='https://example.com/fractal/';
const raw=data=>`${base}#s=j1.${Buffer.from(JSON.stringify(data)).toString('base64url')}`;

test('compressed and uncompressed links round-trip exact location, colors, curves, and playback',async()=>{
  for(const compress of [true,false]) {
    const link=await createShareURL(base+'?cpu=1#old',state,6,{compress});
    assert.deepEqual(await readShareURL(link,6),sharedState(state,6));
    assert.equal(new URL(link).search,'');assert.match(new URL(link).hash,compress?/^#s=g1\./:/^#s=j1\./);
    assert.ok(link.length<1500);
  }
});

test('every fractal family and cycle shape can be shared with its formula parameters',async()=>{
  for(const fractal of Object.keys(fractals)) {
    const v=defaultView({...view,span:'3.6'},fractal);
    const automation=Object.fromEntries(animationParameters(v).map(p=>[p.key,defaultAutomation(v,p)]));
    const source={...state,view:v,automation};
    assert.deepEqual(await readShareURL(await createShareURL(base,source,6),6),sharedState(source,6));
  }
  for(const shape of Object.keys(cycleShapes)) {
    const source={...state,automation:{julia_x:{...state.automation.julia_x,shape}}};
    assert.equal((await readShareURL(await createShareURL(base,source,6),6)).automation.julia_x.shape,shape);
  }
});

test('ten-thousand-digit coordinates and tiny parameter differences survive compression exactly',async()=>{
  const a='0.'+'1'.repeat(200)+'2',b='0.'+'1'.repeat(200)+'4';
  const v={...view,fractal:'julia',x:'-0.'+'1234567890'.repeat(1000),y:'0.'+'9876543210'.repeat(1000),span:'1e-10000',julia_x:a};
  const source={...state,view:v,automation:{julia_x:{enabled:true,target:b,speed:.1,shape:'smootherstep'}}};
  const link=await createShareURL(base,source,6),restored=await readShareURL(link,6);
  for(const key of ['x','y','span','julia_x']) assert.equal(restored.view[key],v[key]);
  assert.equal(restored.automation.julia_x.target,b);assert.ok(link.length<1500);
});

test('links omit frame data and device preferences and whitelist the view fields',async()=>{
  const source={...state,view:{...view,unrelated:'ignored'},cacheMemoryMiB:16384,quality:4,renderSettings:{arithmetic:'fp32'},frames:new Float32Array(1024)};
  const restored=await readShareURL(await createShareURL(base,source,6),6);
  for(const key of ['cacheMemoryMiB','quality','renderSettings','frames']) assert.equal(Object.hasOwn(restored,key),false);
  assert.equal(Object.hasOwn(restored.view,'unrelated'),false);
});

test('local previews share the published site, deployed paths stay intact, and debug queries are removed',()=>{
  for(const host of ['localhost','127.0.0.1','[::1]','demo.localhost']) assert.equal(shareBaseURL(`http://${host}:8768/?cpu=1#s=old`),'https://brn-dev.github.io/fractal-explorer/');
  assert.equal(shareBaseURL('https://example.com/subpath/index.html?cpu=1#old'),base.replace('/fractal/','/subpath/'));
  assert.equal(shareBaseURL('https://example.com/subpath/'), 'https://example.com/subpath/');
  assert.equal(shareBaseURL('http://localhost:8768/','https://other.test/fork/?debug=1#old'),'https://other.test/fork/');
  assert.throws(()=>shareBaseURL(base,'javascript:alert(1)'));
});

test('missing shares leave normal sessions alone and malformed links cannot restore partial settings',async()=>{
  assert.equal(await readShareURL(base,6),null);assert.equal(await readShareURL(base+'?s=j1.bad#coordinates',6),null);
  for(const link of [base+'#s=',base+'#s=g1.AAAA',base+'#s=j1.@@@@',base+'#s=j2.e30',base+'#s=j1.e30&s=j1.e30',raw({...state,version:2}),raw({...state,view:{...view,span:'1e-100'}}),raw({...state,palette:99}),raw({...state,density:-1}),raw({...state,wander:'yes'}),raw({...state,automation:{julia_x:{...state.automation.julia_x,shape:'unknown'}}})]) {
    await assert.rejects(readShareURL(link,6),/share link/i);
  }
});

test('compressed expansion and raw input stay within a bounded decoding budget',async()=>{
  const oversized=Buffer.alloc(MAX_SHARE_BYTES+1,32);
  await assert.rejects(readShareURL(base+'#s=j1.'+oversized.toString('base64url'),6),/too large/);
  await assert.rejects(readShareURL(base+'#s=g1.'+gzipSync(oversized).toString('base64url'),6),/too large/);
  await assert.rejects(readShareURL(base+'#s=j1.'+'a'.repeat(180001),6),/share link/);
});
