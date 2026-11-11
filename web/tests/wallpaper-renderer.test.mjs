import test from 'node:test';
import assert from 'node:assert/strict';
import { WallpaperFrameRenderer } from '../src/wallpaper-renderer.mjs';
const colors={density:1.3,phase:.2,interiorColor:'#aabbcc',colorCurves:{tone:{points:[[0,0],[.5,.3],[1,1]]}},definition:{colors:['#123456','#abcdef']}};
function fixture(gpu=true) {
  const calls={render:[],read:0,paint:[],restore:[],cpu:[],draw:[],put:0},data=new Map();
  const renderer={gpu,device:{queue:{async onSubmittedWorkDone(){}}},canvas:{},async render(view,width,height,settings){calls.render.push({view,width,height,settings});this.value=view.x;this.last={metadata:{width,height,color_origin:0}};return this.last;},async readField(){calls.read++;return new Float32Array([Number(this.value)]);},presentCached(values,metadata){this.value=values[0];this.last={metadata};calls.restore.push(this.value);},paint(index,density,phase,definition,interiorColor,colorCurves){calls.paint.push({value:Number(this.value),phase,definition,interiorColor,colorCurves});}};
  const fields={async get(key){return data.get(key);},async put(key,frame){calls.put++;data.set(key,frame);}};
  const target={width:0,height:0,getContext(){return{drawImage:(...args)=>calls.draw.push(args)}}};
  const controller=new AbortController();
  const painter=new WallpaperFrameRenderer(renderer,fields,(target,values,metadata,colors)=>calls.cpu.push({target,values,metadata,colors}),controller.signal);
  const field=(x,cache=false,settings={})=>painter.field({x},settings,64,80,cache);
  return{painter,renderer,fields,target,calls,field,controller};
}
test('palette-only GPU frames reuse the resident field without CPU readback or temporary storage',async()=>{
  const t=fixture();
  for(let i=0;i<100;i++)await t.painter.paint(t.target,await t.field('1'),{...colors,phase:i/100});
  assert.equal(t.calls.render.length,1);assert.equal(t.calls.read,0);assert.equal(t.calls.put,0);assert.equal(t.calls.cpu.length,0);
  assert.equal(t.calls.paint.length,100);assert.equal(t.calls.draw.length,100);assert.equal(t.calls.paint.at(-1).phase,.99);
  assert.equal(t.calls.paint[0].definition,colors.definition);assert.deepEqual([t.target.width,t.target.height],[64,80]);
  assert.equal(t.calls.paint[0].interiorColor,colors.interiorColor);
  assert.equal(t.calls.paint[0].colorCurves,colors.colorCurves);
});
test('one-use transitions compute exact views without storing full-resolution fields',async()=>{
  const t=fixture();
  for(let i=0;i<20;i++)await t.painter.paint(t.target,await t.field(String(i)),colors);
  assert.deepEqual(t.calls.render.map(call=>call.view.x),Array.from({length:20},(_,i)=>String(i)));
  assert.equal(t.calls.read,0);assert.equal(t.calls.put,0);assert.equal(t.calls.cpu.length,0);
});
test('returning parameter states restore their own cached GPU field before coloring',async()=>{
  const t=fixture();
  for(const x of ['1','2','1','1','2'])await t.painter.paint(t.target,await t.field(x,true),colors);
  assert.equal(t.calls.render.length,2);assert.equal(t.calls.read,2);assert.equal(t.calls.put,2);
  assert.deepEqual(t.calls.paint.map(call=>call.value),[1,2,1,1,2]);assert.deepEqual(t.calls.restore,[1,2]);
});
test('cheap GPU fields stop spilling after storage costs more than recomputation, without changing views',async()=>{
  const t=fixture();Object.assign(t.fields,{memoryBudget:0,memoryBytes:0,writable:true});
  const render=t.renderer.render;t.renderer.render=async function(...args){const result=await render.apply(this,args);result.metadata.elapsed_ms=0;return result;};
  for(const x of ['1','2','3','1','2'])await t.painter.paint(t.target,await t.field(x,true),colors);
  assert.equal(t.calls.put,1);assert.equal(t.calls.read,1);
  assert.deepEqual(t.calls.paint.map(call=>call.value),[1,2,3,1,2]);
  assert.equal(t.calls.render.length,4,'the first cached field is reused and uncached fields recompute');
});
test('expensive GPU fields retain temporary caching for return states',async()=>{
  const t=fixture();Object.assign(t.fields,{memoryBudget:0,memoryBytes:0,writable:true});
  const render=t.renderer.render;t.renderer.render=async function(...args){const result=await render.apply(this,args);result.metadata.elapsed_ms=100000;return result;};
  for(const x of ['1','2','3','2','1'])await t.painter.paint(t.target,await t.field(x,true),colors);
  assert.equal(t.calls.render.length,3);assert.equal(t.calls.put,3);assert.equal(t.calls.read,3);
  assert.deepEqual(t.calls.paint.map(call=>call.value),[1,2,3,2,1]);
});
test('transition endpoint reused as an animated loop start can be cached once without recomputation',async()=>{
  const t=fixture();await t.painter.paint(t.target,await t.field('1'),colors);
  for(let i=0;i<4;i++)await t.painter.paint(t.target,await t.field('1',true),colors);
  assert.equal(t.calls.render.length,1);assert.equal(t.calls.read,1);assert.equal(t.calls.put,1);
});
test('CPU fallback retains source values, palette and dimensions and reuses repeated fields',async()=>{
  const t=fixture(false);
  for(const x of ['1','1','2','1'])await t.painter.paint(t.target,await t.field(x,true),colors);
  assert.equal(t.calls.render.length,2);assert.equal(t.calls.read,2);assert.equal(t.calls.paint.length,0);
  assert.deepEqual(t.calls.cpu.map(call=>call.values[0]),[1,1,2,1]);assert.equal(t.calls.cpu[0].colors,colors);
  assert.deepEqual(t.calls.cpu[0].metadata,{width:64,height:80,color_origin:0});
});
test('device loss invalidates a resident field and uses the renderer fallback for the same view',async()=>{
  const t=fixture();await t.painter.paint(t.target,await t.field('1'),colors);t.renderer.lost='lost';
  const render=t.renderer.render;t.renderer.render=async function(...args){this.gpu=false;this.device=null;this.lost=null;return render.apply(this,args);};
  await t.painter.paint(t.target,await t.field('1'),colors);
  assert.equal(t.calls.render.length,2);assert.equal(t.calls.cpu.length,1);assert.equal(t.calls.cpu[0].values[0],1);
});
test('cancellation and a device loss while coloring cannot hand an incomplete image to encoding',async()=>{
  const t=fixture(),frame=await t.field('1');t.controller.abort();
  await assert.rejects(t.painter.paint(t.target,frame,colors),{name:'AbortError'});assert.equal(t.calls.draw.length,0);
  const next=fixture(),ready=await next.field('1');next.renderer.device.queue.onSubmittedWorkDone=async()=>{next.renderer.lost='lost';};
  await assert.rejects(next.painter.paint(next.target,ready,colors),/GPU disconnected/);assert.equal(next.calls.draw.length,0);
});
