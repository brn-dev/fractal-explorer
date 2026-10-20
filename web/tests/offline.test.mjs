import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Generate from the actual builder so these checks cover the shipped worker.
execFileSync(process.execPath,['scripts/offline.mjs'],{cwd:new URL('..',import.meta.url),stdio:'pipe'});
const code=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
function runtime() {
  const events=new Map(), contents=new Map(), deleted=[];let installed=[],claimed=false,skipped=false;
  const self={location:new URL('https://example.com/fractal/sw.js'),addEventListener:(name,handler)=>events.set(name,handler),clients:{claim:async()=>{claimed=true;}},skipWaiting:()=>{skipped=true;}};
  const cache={addAll:async requests=>{installed=requests;},match:async(request,options)=>{
    const entry=contents.get(typeof request==='string'?request:request.url);
    if(entry?.vary && !options?.ignoreVary)return undefined;
    return entry?.response ?? entry;
  }};
  const caches={open:async()=>cache,keys:async()=>['fractal-web-old','unrelated'],delete:async key=>deleted.push(key)};
  class RelativeRequest extends Request {constructor(url,options){super(new URL(url,self.location.href),options);}}
  vm.runInNewContext(code,{self,caches,Request:RelativeRequest,URL,fetch:async()=>{throw new Error('Network must not be needed.');}});
  return {events,contents,deleted,get installed(){return installed;},get claimed(){return claimed;},get skipped(){return skipped;}};
}
test('offline installation bypasses stale HTTP caches for the entire bundle',async()=>{
  const r=runtime();let done;r.events.get('install')({waitUntil:p=>{done=p;}});await done;
  assert.ok(r.installed.length>6);assert.ok(r.installed.every(request=>request.cache==='reload'));
  assert.ok(r.installed.some(request=>request.url.endsWith('/fractal/')));
  assert.ok(r.installed.some(request=>request.url.includes('/assets/worker-')));
});
test('offline document navigation preserves query parameters while loading the cached shell',async()=>{
  const r=runtime(), expected=new Response('cached application shell');r.contents.set('https://example.com/fractal/',expected);
  let response;r.events.get('fetch')({request:{method:'GET',mode:'navigate',url:'https://example.com/fractal/?cpu=1'},respondWith:p=>{response=p;}});
  assert.equal(await (await response).text(),'cached application shell');
});
test('cached static modules remain available when hosting adds Vary: Origin',async()=>{
  const r=runtime();r.contents.set('https://example.com/fractal/assets/engine.js',{vary:true,response:new Response('cached engine')});
  let response;r.events.get('fetch')({request:{method:'GET',mode:'cors',url:'https://example.com/fractal/assets/engine.js'},respondWith:p=>{response=p;}});
  assert.equal(await(await response).text(),'cached engine');
});
test('offline updates claim clients and remove only previous versions of this app',async()=>{
  const r=runtime();let done;r.events.get('activate')({waitUntil:p=>{done=p;}});await done;
  assert.deepEqual(r.deleted,['fractal-web-old']);assert.equal(r.claimed,true);
  r.events.get('message')({data:'activate'});assert.equal(r.skipped,true);
});
