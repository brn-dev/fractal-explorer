import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportFieldCache, exportCacheBudget } from '../src/export-field-cache.mjs';

const frame = value => ({ values: new Float32Array([value,-1,2,3]), metadata: { width: 2, height: 2, color_origin: value, timings: { kernel_ms: 5 } } });
function storage() {
  const data=new Map();let reads=0,writes=0,disposed=false;
  const store={
    async get(key){reads++;return structuredClone(data.get(key));},
    async put(key,value){writes++;data.set(key,structuredClone(value));},
    async dispose(){data.clear();disposed=true;},
  };
  return {store,data,get reads(){return reads;},get writes(){return writes;},get disposed(){return disposed;}};
}
test('a repeating cycle computes each state once and reuses raw fields independently of color phase',async()=>{
  let computed=0,opened=0;const cache=new ExportFieldCache({memoryBudget:128,createStore:async()=>{opened++;throw Error('Should fit RAM');}});
  const shown=[];
  for(const key of ['a','b','c','b','a','b','c','b','a','b','c','b']) {
    let field=await cache.get(key);
    if(!field){field=frame(++computed);await cache.put(key,field);}
    shown.push(field.values[0]);
  }
  assert.equal(computed,3);assert.equal(opened,0);assert.deepEqual(shown,[1,2,3,2,1,2,3,2,1,2,3,2]);
  assert.equal(cache.memoryBytes,48);await cache.dispose();assert.equal(cache.memoryBytes,0);
});
test('larger cycles spill to temporary storage without lowering field resolution or exceeding RAM',async()=>{
  const disk=storage(),cache=new ExportFieldCache({memoryBudget:16,createStore:async()=>disk.store});
  const a=frame(11),b=frame(22),c=frame(33);
  await cache.put('a',a);await cache.put('b',b);await cache.put('c',c);
  assert.equal(cache.memoryBytes,16);assert.equal(disk.writes,2);
  assert.equal(await cache.get('a'),a);
  for(let cycle=0;cycle<3;cycle++)assert.deepEqual(await cache.get('b'),b);
  assert.equal(disk.reads,3);assert.equal(cache.limited,false);
  await cache.put('b',b);assert.equal(disk.writes,2);
  await cache.dispose();assert.equal(disk.disposed,true);assert.equal(disk.data.size,0);
});
test('storage failures retain the bounded RAM cache and permit uncached states to be recomputed',async()=>{
  const disk=storage();let attempts=0;
  disk.store.put=async()=>{attempts++;throw new DOMException('Quota exhausted','QuotaExceededError');};
  const cache=new ExportFieldCache({memoryBudget:16,createStore:async()=>disk.store});
  await cache.put('a',frame(1));await cache.put('b',frame(2));await cache.put('c',frame(3));
  assert.equal(cache.limited,true);assert.equal(attempts,1);assert.equal((await cache.get('a')).values[0],1);
  assert.equal(await cache.get('b'),null);assert.equal(cache.memoryBytes,16);
  await cache.dispose();assert.equal(disk.disposed,true);
});
test('missing storage and failed reads do not prevent export or leak the temporary store',async()=>{
  const unavailable=new ExportFieldCache({memoryBudget:0,createStore:async()=>{throw Error('Unavailable');}});
  await unavailable.put('a',frame(1));assert.equal(unavailable.limited,true);await unavailable.dispose();
  const disk=storage(),cache=new ExportFieldCache({memoryBudget:0,createStore:async()=>disk.store});
  await cache.put('a',frame(1));disk.store.get=async()=>{throw Error('Read failed');};
  assert.equal(await cache.get('a'),null);assert.equal(cache.limited,true);
  await cache.dispose();assert.equal(disk.disposed,true);
});
test('cancellation stops cache work and cleanup still releases RAM and temporary storage',async()=>{
  const controller=new AbortController(),disk=storage();
  const cache=new ExportFieldCache({memoryBudget:16,createStore:async()=>disk.store,signal:controller.signal});
  await cache.put('a',frame(1));await cache.put('b',frame(2));controller.abort();
  await assert.rejects(cache.get('a'),{name:'AbortError'});await assert.rejects(cache.put('c',frame(3)),{name:'AbortError'});
  await cache.dispose();assert.equal(cache.memoryBytes,0);assert.equal(disk.disposed,true);
  assert.equal(exportCacheBudget(false),256*1024**2);assert.equal(exportCacheBudget(true),64*1024**2);
});
