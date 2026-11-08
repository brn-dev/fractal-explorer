import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeUpdateMonitor } from '../src/native-updates.mjs';

function setup({saveSession=async()=>{},canReload=()=>true,identity=async()=>({id:'current'}),failApply=false}={}){
  const calls=[],states=[],timers=new Map(),events=new EventTarget(),visibility=new EventTarget();let seq=0;
  visibility.hidden=false;
  const host={version:'current',available:false,readyVersion:'',checking:false,bundled:true,error:'',requiresApk:0};
  const monitor=createNativeUpdateMonitor({saveSession,canReload,identity,events,visibility,
    call(action,version){calls.push([action,version]);if(action==='apply'&&failApply)throw new Error('export active');return {...host};},
    setTimer(fn,delay){timers.set(++seq,{fn,delay});return seq;},clearTimer(id){timers.delete(id);},onChange:s=>states.push(s),
  });
  return{monitor,calls,states,host,timers,events,visibility,get state(){return states.at(-1);}};
}
test('native startup confirms exactly the loaded identity, then checks automatically without reloading',async()=>{
  const s=setup();await s.monitor.started;
  assert.deepEqual(s.calls.slice(0,2),[['confirm','current'],['auto',undefined]]);assert.equal(s.state.notice,false);assert.equal(s.timers.size,0);
  s.monitor.destroy();
});
test('download polling announces only a complete ready bundle and stops polling when finished',async()=>{
  const s=setup();await s.monitor.started;s.host.checking=true;s.monitor.check();
  assert.equal(s.state.notice,false);assert.equal(s.timers.size,1);
  s.host.checking=false;s.host.available=true;s.host.readyVersion='new';[...s.timers.values()][0].fn();
  assert.equal(s.state.notice,true);assert.equal(s.timers.size,0);assert.ok(!s.calls.some(([a])=>a==='apply'));s.monitor.destroy();
});
test('Later dismisses one release; manual checks and a different ready release can announce again',async()=>{
  const s=setup();await s.monitor.started;s.host.available=true;s.host.readyVersion='new';s.monitor.check();s.monitor.dismiss();assert.equal(s.state.notice,false);
  s.events.dispatchEvent(new Event('focus'));assert.equal(s.state.notice,false);
  s.monitor.check();assert.equal(s.state.notice,true);s.monitor.dismiss();s.host.readyVersion='newer';s.events.dispatchEvent(new Event('online'));assert.equal(s.state.notice,true);s.monitor.destroy();
});
test('apply saves before native activation and prevents repeat application while reloading',async()=>{
  const order=[],s=setup({saveSession:async()=>order.push('save')});await s.monitor.started;s.host.available=true;s.host.readyVersion='new';s.monitor.check();
  assert.equal(await s.monitor.apply(),true);order.push(...s.calls.filter(([a])=>a==='apply').map(([a])=>a));assert.deepEqual(order,['save','apply']);
  assert.equal(await s.monitor.apply(),false);assert.equal(s.state.applying,true);assert.equal([...s.timers.values()][0].delay,15000);s.monitor.destroy();assert.equal(s.timers.size,0);
});
test('unfinished scene/export guard keeps the ready update without saving or reloading',async()=>{
  let saved=false;const s=setup({saveSession:()=>{saved=true;},canReload:()=> 'Save your scene first.'});await s.monitor.started;
  s.host.available=true;s.host.readyVersion='new';s.monitor.check();assert.equal(await s.monitor.apply(),false);assert.equal(saved,false);assert.equal(s.state.available,true);assert.match(s.state.error,/scene/);assert.ok(!s.calls.some(([a])=>a==='apply'));s.monitor.destroy();
});
test('save and native apply failures leave the update available for retry',async()=>{
  for(const mode of ['save','native']){
    const s=setup({saveSession:async()=>{if(mode==='save')throw new Error('save failed');},failApply:mode==='native'});await s.monitor.started;
    s.host.available=true;s.host.readyVersion='new';s.monitor.check();assert.equal(await s.monitor.apply(),false);assert.equal(s.state.applying,false);assert.equal(s.state.available,true);assert.match(s.state.error,/failed|export active/);s.monitor.destroy();
  }
});
test('missing identity cannot acknowledge a failed boot or start automatic downloads',async()=>{
  const s=setup({identity:async()=>{throw new Error('identity missing');}});await s.monitor.started;assert.deepEqual(s.calls,[]);assert.match(s.state.error,/identity missing/);s.monitor.destroy();
});
test('destroy during asynchronous save prevents late activation and clears wake listeners',async()=>{
  let done;const s=setup({saveSession:()=>new Promise(resolve=>{done=resolve;})});await s.monitor.started;
  s.host.available=true;s.host.readyVersion='new';s.monitor.check();const applying=s.monitor.apply();await Promise.resolve();s.monitor.destroy();done();assert.equal(await applying,false);
  const count=s.calls.length;s.events.dispatchEvent(new Event('focus'));s.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(s.calls.length,count);assert.equal(s.timers.size,0);
});
test('reload timeout permits retry and hidden checks do not schedule polling',async()=>{
  const s=setup();await s.monitor.started;s.host.available=true;s.host.readyVersion='new';s.monitor.check();await s.monitor.apply();[...s.timers.values()][0].fn();assert.equal(s.state.applying,false);assert.match(s.state.error,/did not reload/);
  s.visibility.hidden=true;s.host.checking=true;s.monitor.check();assert.equal([...s.timers.values()].filter(t=>t.delay===1000).length,0);s.monitor.destroy();
});
