import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallpaperURL, readWallpaperURL, wallpaperHandoff, MAX_WALLPAPER_LINK_LENGTH, MAX_WALLPAPER_LINK_BYTES } from '../src/wallpaper-share.mjs';
import { defaultWallpaperDraft, wallpaperSnapshot, wallpaperPlan, MAX_WALLPAPER_JSON_BYTES } from '../src/wallpaper.mjs';

const base='https://brn-dev.github.io/fractal-explorer/';
function draft(screen='inner') {
  const view={fractal:'julia',x:'0.'+'1234567890'.repeat(10),y:'0',span:'3.6',julia_x:'-.8',julia_y:'.156',iterations:200,bailout:64};
  const next=defaultWallpaperDraft(wallpaperSnapshot({view,colors:{definition:{name:'Mine',colors:['#123456','#abcdef','#123456']},density:1.7,phase:.321,interiorColor:'#000000'},speed:.1,wander:true,supersampling:2,automation:{julia_x:{enabled:true,target:'-.6',speed:.35,shape:'sine'}}},[]),screen);
  next.name='Wallpaper 🌌';next.longest='native';next.screenSizes={[screen]:screen==='cover'?{width:1080,height:2520}:{width:2256,height:2504}};
  next.transitions[screen==='cover'?'closed-transition':'open-transition']={seconds:1.7,easing:'ease-out-strong'};
  next.colorSeconds=4;next.colorWander=true;next.quality='custom';next.bitrateMbps=83;
  return next;
}

test('wallpaper links preserve native dimensions, exact scenes, sampling, colors and animation settings',async()=>{
  for(const screen of ['cover','inner'])for(const compress of [true,false]) {
    const source=draft(screen),before=structuredClone(source),url=await createWallpaperURL(base,source,{compress});
    assert.ok(url.length<=MAX_WALLPAPER_LINK_LENGTH);assert.equal(new URL(url).hash.startsWith('#w='),true);
    const restored=await readWallpaperURL(url);assert.deepEqual(restored,JSON.parse(JSON.stringify(wallpaperHandoff(source))));assert.deepEqual(source,before);
    const a=wallpaperPlan(source),b=wallpaperPlan(restored);
    for(let i=0;i<a.length;i++)for(const frame of [0,Math.floor(a[i].frames/2),a[i].frames-1])assert.deepEqual(b[i].sample(frame),a[i].sample(frame));
    assert.deepEqual([b[0].width,b[0].height,b[0].renderWidth,b[0].renderHeight],[a[0].width,a[0].height,a[0].width*2,a[0].height*2]);
  }
});

test('entry-free choice and retained start scene survive PC links and JSON handoffs',async()=>{
  for(const screen of ['inner','cover']) {
    const source=draft(screen);source.entryTransition=false;
    const restored=await readWallpaperURL(await createWallpaperURL(base,source));
    assert.equal(restored.entryTransition,false);assert.equal(wallpaperPlan(restored).length,1);
    assert.deepEqual(restored.states,source.states);assert.deepEqual(restored.transitions,source.transitions);
  }
});
test('links remove credentials, old queries and fragments and reject unsupported protocols',async()=>{
  const url=new URL(await createWallpaperURL('https://name:secret@example.org/app/?cpu=1#s=old',draft()));
  assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.search,'');assert.equal(url.pathname,'/app/');
  await assert.rejects(createWallpaperURL('javascript:alert(1)',draft()),/website URL/);
  assert.equal(await readWallpaperURL(base+'#s=j1.abc'),null);
});
test('invalid, ambiguous and truncated wallpaper links cannot import partial designs',async()=>{
  const valid=await createWallpaperURL(base,draft());
  for(const url of [base+'#w=j2.abc',base+'#w=j1.!!!!',base+'#w=g1.YQ',base+'#w=j1.eyJmb3JtYXQiOjF9',valid+'&w=j1.YQ',valid+'&s=j1.YQ',valid+'a'.repeat(MAX_WALLPAPER_LINK_LENGTH)])await assert.rejects(readWallpaperURL(url),/Could not open this wallpaper link/);
  const invalid=draft();delete invalid.screenSizes;assert.throws(()=>wallpaperHandoff(invalid),/detect its resolution/);
  const legacy=draft();delete legacy.screen;assert.throws(()=>wallpaperHandoff(legacy),/Choose cover or main/);
});
test('large designs retain the file path when a link exceeds the practical size limit',async()=>{
  const next=draft();let seed=7;
  const digits=()=>Array.from({length:10000},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*10);}).join('');
  for(const scene of Object.values(next.states)){scene.view.x='0.'+digits();scene.view.y='0.'+digits();}
  assert.ok(JSON.stringify(wallpaperHandoff(next)).length>30000);
  await assert.rejects(createWallpaperURL(base,next),/Download PC draft/);
  next.extra='x'.repeat(MAX_WALLPAPER_JSON_BYTES);assert.throws(()=>wallpaperHandoff(next),/4 MiB/);
});
test('compressed expansion is bounded before parsing an oversized payload',async()=>{
  const packed=Buffer.from(await new Response(new Blob(['x'.repeat(MAX_WALLPAPER_LINK_BYTES+1)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const url=base+'#w=g1.'+packed.toString('base64url');assert.ok(url.length<MAX_WALLPAPER_LINK_LENGTH);
  await assert.rejects(readWallpaperURL(url),/exceeds 128 KiB/);
});
test('small links still work when browser compression is unavailable',async()=>{
  const original=globalThis.CompressionStream;
  try {globalThis.CompressionStream=undefined;const url=await createWallpaperURL(base,draft());assert.match(url,/#w=j1\./);assert.equal((await readWallpaperURL(url)).supersampling,2);}
  finally {globalThis.CompressionStream=original;}
});
