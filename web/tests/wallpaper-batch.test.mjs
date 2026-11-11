import test from 'node:test';
import assert from 'node:assert/strict';
import { wallpaperSnapshot, defaultWallpaperDraft, wallpaperPaletteDefinitions, wallpaperPaletteDrafts, wallpaperPlan, wallpaperManifest } from '../src/wallpaper.mjs';
import { createWallpaperURL, readWallpaperURL } from '../src/wallpaper-share.mjs';
import { paintPaletteFrame, renderPaletteBatch } from '../src/wallpaper-batch.mjs';
import { wallpaperBatchZip } from '../src/zip-store.mjs';

const base={name:'Base',colors:['#001122','#aabbcc','#001122']};
const extra={name:'Other',colors:['#332211','#ffeedd','#332211']};
function draft(screen='inner') {
  const view={fractal:'mandelbrot',x:'-.5',y:'0',span:'3.6',iterations:80,bailout:64,julia_x:'-.8',julia_y:'.156'};
  const next=defaultWallpaperDraft(wallpaperSnapshot({view,colors:{definition:base,interiorColor:'#123456',density:1.4,phase:.2},wander:true,speed:.2,automation:{}},[]),screen);
  Object.assign(next,{longest:480,idleSeconds:2,idleFps:10,paletteVariants:[extra]});return next;
}

test('palette variants preserve screen, exact animation, quality and interior color as independent ordinary packages',async()=>{
  for(const screen of ['cover','inner'])for(const kind of ['animated','static'])for(const entryTransition of [true,false]) {
    const source=Object.assign(draft(screen),{kind,entryTransition}),before=structuredClone(source);
    const restored=await readWallpaperURL(await createWallpaperURL('https://example.test/',source));
    assert.deepEqual(restored.paletteVariants,[extra]);
    const variants=wallpaperPaletteDrafts(restored);assert.equal(variants.length,2);
    const [a,b]=variants.map(value=>wallpaperPlan(value));assert.equal(a.length,b.length);
    for(let slot=0;slot<a.length;slot++) {
      for(const key of ['width','height','fps','frames','duration','supersampling','quantizer','bitrate'])assert.equal(a[slot][key],b[slot][key]);
      for(const index of [0,a[slot].frames-1]) {
        const x=a[slot].sample(index),y=b[slot].sample(index);
        assert.deepEqual(x.view,y.view);assert.equal(x.colors.phase,y.colors.phase);assert.equal(x.colors.density,y.colors.density);
        assert.equal(y.colors.interiorColor,'#123456');assert.deepEqual(x.colors.definition,base);assert.deepEqual(y.colors.definition,extra);
      }
    }
    for(const [index,variant] of variants.entries()) {
      assert.equal(variant.screen,screen);assert.equal(variant.entryTransition,entryTransition);assert.equal(variant.kind,kind);
      assert.equal(variant.paletteVariants,undefined);assert.match(variant.name,index?/Other/:/Base/);
      assert.equal(wallpaperManifest(variant,wallpaperPlan(variant)).editor,variant);
    }
    assert.deepEqual(source,before);
  }
});

test('palette batches validate portable color definitions, limit encoders and remove duplicates',()=>{
  const source=draft();source.paletteVariants=[extra,structuredClone(extra),base];assert.equal(wallpaperPaletteDefinitions(source).length,2);
  for(const bad of ['bad',[{name:'Bad',colors:['red','blue']}],Array(4).fill(extra)])assert.throws(()=>wallpaperPlan({...source,paletteVariants:bad}),/palette/);
  const normalized=wallpaperPaletteDefinitions({...source,paletteVariants:[{name:'Upper',colors:['#AABBCC','#DDEEFF']}]});
  assert.deepEqual(normalized[1].colors,['#aabbcc','#ddeeff']);
  const names=wallpaperPaletteDrafts({...draft(),name:'🌌'.repeat(40)}).map(variant=>variant.name);
  assert.equal(new Set(names).size,2);assert.ok(names.every(name=>name.length<=80&&name.isWellFormed()));
  assert.ok(names[0].endsWith(' · Base'));assert.ok(names[1].endsWith(' · Other'));
});

function target() {
  return {width:1,height:1,draws:[],getContext(){return this.context??={globalAlpha:1,drawImage:(...args)=>this.draws.push(args)};},toBlob(callback){callback(new Blob(['png']));}};
}
test('a batch computes each field once before recoloring all palettes, including crossfades and supersampling',async()=>{
  for(const crossfade of [false,true]) {
    const calls=[],outputs=[target(),target(),target()],work=target(),layer=target();
    const painter={async field(view,settings,width,height,cache){calls.push(['field',view.id,width,height,cache]);return {view};},async paint(canvas,frame,colors){calls.push(['paint',frame.view.id,colors.id]);}};
    const plan={width:100,height:120,renderWidth:200,renderHeight:240,transition:true,destination:{settings:{}},sample(){return {crossfade,view:{id:'one'},amount:.4,colors:{id:0},from:{view:{id:'from'},settings:{},colors:{id:0}},to:{view:{id:'to'},settings:{},colors:{id:0}}};}};
    const plans=outputs.map((_,i)=>({...plan,sample(){const sample=plan.sample();sample.colors.id=sample.from.colors.id=sample.to.colors.id=i;return sample;}}));
    await paintPaletteFrame(painter,plans,0,outputs,work,layer,new AbortController().signal);
    assert.deepEqual(calls.filter(c=>c[0]==='field').map(c=>c[1]),crossfade?['from','to']:['one']);
    assert.equal(calls.filter(c=>c[0]==='paint').length,crossfade?6:3);
    if(crossfade)assert.ok(calls.findIndex(c=>c[0]==='field'&&c[1]==='to')>calls.findIndex(c=>c[0]==='paint'&&c[2]===2));
    assert.ok(outputs.every(output=>output.context.globalAlpha===1));
    const controller=new AbortController();controller.abort();
    await assert.rejects(paintPaletteFrame(painter,plans,0,outputs,work,layer,controller.signal),/cancelled/);
  }
});

test('batch failures cancel all already opened encoders and release canvas surfaces',async()=>{
  const previous=globalThis.document,canvases=[];globalThis.document={createElement(){const value=target();canvases.push(value);return value;}};
  const source=draft();let opened=0,cancelled=0;
  try {
    await assert.rejects(renderPaletteBatch({draft:source,renderer:{},fields:{},paint(){},codecs:{async mp4Encoder(){if(++opened===2)throw new Error('encoder limit');return{async cancel(){cancelled++;}};}},signal:new AbortController().signal}),/encoder limit/);
    assert.equal(cancelled,1);assert.ok(canvases.every(value=>value.width===1&&value.height===1));
  } finally {globalThis.document=previous;}
});

test('cancelling a running batch cancels every encoder before publishing any package',async()=>{
  const previous=globalThis.document;globalThis.document={createElement:target};
  const controller=new AbortController();let cancelled=0,finished=0;
  try {
    await assert.rejects(renderPaletteBatch({draft:draft(),renderer:{},fields:{},paint(){},codecs:{async mp4Encoder(){return{async finish(){finished++;},async cancel(){cancelled++;}};}},signal:controller.signal,onProgress(){controller.abort();}}),/cancelled/);
    assert.equal(cancelled,2);assert.equal(finished,0);
  } finally {globalThis.document=previous;}
});

test('batch archives contain ordinary named ZIPs and reject traversal and oversized palette counts',async()=>{
  const zip=await wallpaperBatchZip([['01-base.zip',new Blob(['a'])],['02-other.zip',new Blob(['b'])]]);
  const bytes=new Uint8Array(await zip.arrayBuffer());assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
  for(const name of ['../bad.zip','sub/bad.zip','bad.mp4'])await assert.rejects(wallpaperBatchZip([[name,new Blob(['x'])]]),/filename/);
  await assert.rejects(wallpaperBatchZip(Array.from({length:5},(_,i)=>[`${i}.zip`,new Blob(['x'])])),/Too many/);
});
