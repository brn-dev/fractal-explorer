import test from 'node:test';
import assert from 'node:assert/strict';
import { wallpaperSnapshot, defaultWallpaperDraft, wallpaperScreenDraft, wallpaperColorCycle, wallpaperPlan, wallpaperViewPath, wallpaperManifest, wallpaperStates, wallpaperJSON, MAX_WALLPAPER_JSON_BYTES, wallpaperTransition, transitionCurves, transitionProgress } from '../src/wallpaper.mjs';
import { largeWallpaperDraft } from './wallpaper-fixtures.mjs';
import { wallpaperZip, crc32 } from '../src/zip-store.mjs';
import { decimal, compare } from '../src/decimal.mjs';
import { MAX_PALETTE_COLORS } from '../src/palettes.mjs';
const view = { fractal:'julia', x:'0', y:'0', span:'3.6', julia_x:'-.8', julia_y:'.156', iterations:200, bailout:64 };
const snapshot = () => wallpaperSnapshot({ view, colors:{palette:0,density:1,phase:.2}, speed:.12, wander:true, automation:{} }, [{name:'Test',colors:['#001122','#aabbcc','#001122']}]);

test('custom interior colors survive wallpaper plans and old designs retain their appearance',()=>{
  for(const screen of ['inner','cover']) {
    const source=snapshot();source.colors.interiorColor='#aabbcc';
    const draft=defaultWallpaperDraft(source,screen);
    for(const plan of wallpaperPlan(draft))for(const frame of [0,plan.frames-1])
      assert.equal(plan.sample(frame).colors.interiorColor,'#aabbcc');
    draft.kind='static';
    assert.equal(wallpaperPlan(draft)[0].sample(0).colors.interiorColor,'#aabbcc');
    delete draft.states[screen==='cover'?'closed-steady':'open-steady'].colors.interiorColor;
    assert.equal(wallpaperPlan(draft)[0].sample(0).colors.interiorColor,'#081112');
    draft.states[screen==='cover'?'closed-steady':'open-steady'].colors.interiorColor='bad';
    assert.throws(()=>wallpaperPlan(draft),/interior color/);
  }
});

test('entry-free designs render only the unchanged steady loop and declare loop-only playback',()=>{
  for(const screen of ['inner','cover']) {
    const draft=defaultWallpaperDraft(snapshot(),screen), full=wallpaperPlan(draft).find(p=>!p.transition);
    draft.entryTransition=false;const before=structuredClone(draft),plans=wallpaperPlan(draft),manifest=wallpaperManifest(draft,plans);
    assert.equal(plans.length,1);assert.equal(plans[0].transition,undefined);
    for(const frame of [0,Math.floor(full.frames/2),full.frames-1])assert.deepEqual(plans[0].sample(frame),full.sample(frame));
    assert.equal(manifest.kind,'loop');assert.deepEqual(Object.keys(manifest.clips),[full.key]);
    assert.deepEqual(Object.values(manifest.playback),[[full.key]]);assert.equal(manifest.editor.entryTransition,false);
    assert.deepEqual(draft,before);
    draft.arrivalSeconds=NaN;draft.arrivalFps=NaN;draft.transitions=null;
    draft.states[screen==='cover'?'closed-transition':'open-transition']={};
    assert.equal(wallpaperPlan(draft).length,1,'unused transition settings and snapshots do not affect export');
  }
});

test('legacy designs retain entry transitions and entry choice rejects nonboolean data',()=>{
  const draft=defaultWallpaperDraft(snapshot(),'inner');delete draft.entryTransition;
  assert.equal(wallpaperPlan(draft).length,2);assert.equal(wallpaperManifest(draft,wallpaperPlan(draft)).kind,undefined);
  for(const bad of [null,0,1,'false',[],{}])assert.throws(()=>wallpaperPlan({...draft,entryTransition:bad}),/entry transition/);
});

test('static wallpaper exports one constant PNG at native pixels with sampling and editable scene',()=>{
  for(const screen of ['cover','inner']) {
    const draft=defaultWallpaperDraft(snapshot(),screen);draft.kind='static';draft.displayProfile='fold8-ultra';draft.longest='native';draft.supersampling=2;
    const steady=screen==='cover'?'closed-steady':'open-steady';
    draft.states[steady].automation={julia_x:{enabled:true,target:'-.7',speed:.25,shape:'sine'}};
    const original=structuredClone(draft),plans=wallpaperPlan(draft),[plan]=plans;
    assert.equal(plans.length,1);assert.equal(plan.static,true);assert.equal(plan.transition,undefined);
    assert.equal(plan.file,`${screen}-poster.png`);assert.equal(plan.frames,1);assert.equal(plan.duration,0);
    assert.deepEqual([plan.width,plan.height],screen==='cover'?[1080,2520]:[2256,2504]);
    assert.equal(plan.renderWidth,plan.width*2);assert.equal(plan.renderHeight,plan.height*2);
    assert.deepEqual(plan.snapshot.automation,{});assert.equal(plan.snapshot.wander,false);
    assert.deepEqual(plan.sample(0).view,original.states[steady].view);assert.deepEqual(plan.sample(0).colors,original.states[steady].colors);
    assert.throws(()=>plan.sample(1),/frame/);assert.deepEqual(draft,original);
    const manifest=wallpaperManifest(draft,plans);assert.equal(manifest.kind,'static');assert.deepEqual(manifest.clips,{});
    assert.deepEqual(manifest.images,{[screen]:{file:plan.file,width:plan.width,height:plan.height}});
    assert.deepEqual(manifest.posters,{[screen]:plan.file});assert.deepEqual(manifest.editor,original);
    assert.deepEqual(wallpaperColorCycle(draft),{enabled:false,seconds:1,cycles:0});
    assert.equal(Math.max(...['width','height'].map(k=>wallpaperPlan(draft,{previewLongest:480})[0][k])),480);
  }
});

test('static rendering ignores video settings but still validates image resolution and sampling',()=>{
  const draft=defaultWallpaperDraft(snapshot(),'cover');draft.kind='static';
  Object.assign(draft,{quality:'invalid',bitrateMbps:0,idleSeconds:NaN,idleFps:NaN,arrivalSeconds:NaN,arrivalFps:NaN,colorSeconds:NaN,transitions:null});
  assert.doesNotThrow(()=>wallpaperPlan(draft));draft.supersampling=1.7;assert.throws(()=>wallpaperPlan(draft),/supersampling/);
  draft.supersampling=1;draft.longest='native';assert.throws(()=>wallpaperPlan(draft),/resolution/);
  draft.longest=480;draft.kind='unknown';assert.throws(()=>wallpaperPlan(draft),/animated or static/);
});

test('moderate dynamic modes share quality across clips and use output pixels for a bounded fallback',()=>{
  const draft=defaultWallpaperDraft(snapshot(),'inner');assert.equal(draft.quality,'dynamic-high');
  draft.longest='native';draft.screenSizes={inner:{width:2256,height:2504}};draft.supersampling=2;
  for(const [quality,qp,bits,max]of [['dynamic-high',22,.18,60e6],['dynamic-balanced',26,.1,35e6]]) {
    draft.quality=quality;const plans=wallpaperPlan(draft);
    for(const plan of plans){assert.equal(plan.quantizer,qp);assert.equal(plan.bitrate,Math.min(max,Math.round(plan.width*plan.height*plan.fps*bits)));}
    assert.equal(wallpaperManifest(draft,plans).editor.quality,quality);
  }
  draft.quality='maximum';assert.equal(wallpaperPlan(draft)[0].quantizer,0);assert.equal(wallpaperPlan(draft)[0].bitrate,null);
  assert.equal(draft.quality,'maximum','existing Maximum drafts retain their selected mode');
});

test('wallpaper supersampling increases render samples while preserving encoded dimensions and bitrate',()=>{
  const captured=wallpaperSnapshot({view,colors:{palette:0},supersampling:2},[{colors:['#000000','#ffffff']}]);
  const draft=defaultWallpaperDraft(captured,'inner');
  assert.equal(draft.supersampling,2);
  draft.quality='high';
  for(const scale of [1,1.5,2,3,4]) {
    draft.supersampling=scale;
    const plans=wallpaperPlan(draft), baseline=wallpaperPlan({...draft,supersampling:1});
    for(let i=0;i<plans.length;i++) {
      assert.equal(plans[i].renderWidth,plans[i].width*scale);
      assert.equal(plans[i].renderHeight,plans[i].height*scale);
      assert.equal(plans[i].bitrate,baseline[i].bitrate);
      assert.equal(plans[i].width,baseline[i].width);
    }
  }
  delete draft.supersampling; assert.equal(wallpaperPlan(draft)[0].supersampling,1);
  draft.supersampling=1.7;assert.throws(()=>wallpaperPlan(draft),/supersampling/);
});

test('each screen renders and packages only its own pair, including migrated combined designs',()=>{
  const legacy = defaultWallpaperDraft(snapshot());
  for (const screen of ['cover','inner']) {
    const draft = wallpaperScreenDraft(legacy,screen), plans = wallpaperPlan(draft), manifest = wallpaperManifest(draft,plans);
    assert.equal(plans.length,2); assert.ok(plans.every(plan=>plan.screen===screen));
    assert.equal(Object.keys(draft.states).length,2); assert.equal(manifest.screen,screen);
    assert.deepEqual(Object.keys(manifest.posters),[screen]);
    assert.equal(Object.keys(manifest.clips).length,2); assert.equal(Object.keys(manifest.playback).length,1);
    plans[0].snapshot.view.x='1'; assert.equal(legacy.states[plans[0].key].view.x,'0');
    assert.throws(()=>wallpaperScreenDraft(draft,screen==='cover'?'inner':'cover'),/other screen/);
  }
  assert.equal(wallpaperPlan(legacy).length,4);
});

test('saved steady parameters match live animation samples without per-channel speed changes',async()=>{
  const {animationPlan}=await import('../src/animation.mjs');
  for(const fps of [10,15,24,30]) {
    const draft=defaultWallpaperDraft(snapshot(),'inner');draft.idleFps=fps;draft.idleSeconds=3;
    draft.states['open-steady'].automation={julia_x:{enabled:true,target:'-.7',speed:.35,shape:'sine'},julia_y:{enabled:true,target:'.3',speed:1.1,shape:'smootherstep'}};
    const steady=wallpaperPlan(draft).find(plan=>!plan.transition),live=animationPlan(steady.snapshot.view,steady.snapshot.automation);
    assert.equal(steady.duration,20);assert.equal(steady.parameterCycles.julia_x,7);assert.equal(steady.parameterCycles.julia_y,22);
    for(let index=0;index<steady.frames;index++) assert.deepEqual(steady.sample(index).view,live.viewAt(index*30/fps));
  }
});

test('native screen pixels and video quality are independent of preview resolution',()=>{
  for(const screen of ['cover','inner']) {
    const draft=defaultWallpaperDraft(snapshot(),screen);draft.longest='native';draft.quality='maximum';
    draft.screenSizes={cover:{width:1080,height:2520},inner:{width:2256,height:2504}};
    const plan=wallpaperPlan(draft)[0],preview=wallpaperPlan(draft,{previewLongest:480})[0];
    assert.deepEqual([plan.width,plan.height],Object.values(draft.screenSizes[screen]));
    assert.equal(Math.max(preview.width,preview.height),480);assert.equal(plan.quantizer,0);assert.equal(plan.bitrate,null);
    draft.quality='ultra';assert.equal(wallpaperPlan(draft)[0].bitrate,Math.min(240e6,Math.round(plan.width*plan.height*plan.fps*.96)));
    draft.quality='custom';draft.bitrateMbps=123.5;assert.equal(wallpaperPlan(draft)[0].bitrate,123500000);
    draft.bitrateMbps=601;assert.throws(()=>wallpaperPlan(draft),/bitrate/);
    draft.quality='maximum';delete draft.screenSizes[screen];assert.throws(()=>wallpaperPlan(draft),/detect its resolution/);
    assert.doesNotThrow(()=>wallpaperPlan(draft,{previewLongest:480}));
  }
});

test('animated wallpaper captures the shared cycle origin while still captures keep visible color',()=>{
  const state={view,colors:{definition:{name:'Test',colors:['#001122','#aabbcc']},density:1,phase:.7},loopColorPhase:.2,speed:.25,wander:true};
  assert.equal(wallpaperSnapshot(state,[]).colors.phase,((.2%1)+1)%1);
  assert.equal(wallpaperSnapshot(state,[],{visible:true}).colors.phase,((.7%1)+1)%1);
});

test('transition and loop share palette, density and constant color speed independently of geometry easing',()=>{
  for(const screen of ['cover','inner']) for(const curve of transitionCurves) for(const crossfade of [false,true]) {
    const draft=defaultWallpaperDraft(snapshot(),screen), arrivalKey=screen==='cover'?'closed-transition':'open-transition';
    draft.colorWander=true; draft.colorSeconds=4; draft.idleSeconds=8;
    draft.transitions[arrivalKey]={seconds:1.3,easing:curve.value,...(curve.value==='custom'?{curve:{points:[[0,0],[.2,.8],[1,1]]}}:{})};
    draft.states[arrivalKey].colors={definition:{name:'Different',colors:['#ffffff','#000000']},density:4,phase:.9};
    if(crossfade) draft.states[arrivalKey].view.fractal='mandelbrot';
    const [arrival,idle]=wallpaperPlan(draft), steady=idle.sample(0).colors;
    assert.equal(arrival.crossfade,crossfade); assert.equal(arrival.colorCycleSeconds,4); assert.equal(idle.colorCycleSeconds,4);
    for(const plan of [arrival,idle]) for(let index=0;index<plan.frames;index++) {
      const sample=plan.sample(index);
      assert.deepEqual(sample.colors.definition,steady.definition); assert.equal(sample.colors.density,steady.density);
      assert.deepEqual(sample.from.colors,sample.colors); assert.deepEqual(sample.to.colors,sample.colors);
      if(index) { const delta=(sample.colors.phase-plan.sample(index-1).colors.phase+1)%1; assert.ok(Math.abs(delta-1/(plan.fps*4))<1e-12); }
    }
    assert.deepEqual(arrival.sample(arrival.frames-1).colors,steady);
    assert.ok(Math.abs((steady.phase-idle.sample(idle.frames-1).colors.phase+1)%1-1/(idle.fps*4))<1e-12);
    draft.colorWander=false;
    for(const plan of wallpaperPlan(draft)) assert.deepEqual(plan.sample(0).colors,plan.sample(plan.frames-1).colors);
  }
});

test('shared color time fits whole loop cycles and rejects invalid choices before rendering',()=>{
  const draft=defaultWallpaperDraft(snapshot(),'cover'); draft.colorSeconds=3; draft.idleSeconds=8;
  assert.deepEqual(wallpaperColorCycle(draft),{enabled:true,seconds:8/3,cycles:3});
  for(const seconds of [0,.49,20.01,NaN,Infinity]) { draft.colorSeconds=seconds; assert.throws(()=>wallpaperPlan(draft),/color cycle/); }
});

test('transition interpolation respects the span ceiling and maximum coordinate budget',()=>{
  const path = wallpaperViewPath({...view, span:'15.999999999999999'}, {...view, span:'16'});
  for (const amount of [.6,.75,.9]) assert.ok(compare(decimal(path.viewAt(amount).span), decimal('16')) <= 0);
  const from = {...view, x:'0.'+'1'.repeat(12062)};
  const longPath = wallpaperViewPath(from, view);
  assert.deepEqual(longPath.viewAt(0), from);
  const middle = longPath.viewAt(.5);
  assert.ok(middle.x.length <= 12064);
  assert.ok(compare(decimal(middle.x), decimal('0')) >= 0);
  assert.ok(compare(decimal(middle.x), decimal(from.x)) <= 0);
});

test('opening and closing default to immediate movement and independently configurable timing',()=>{
  const draft=defaultWallpaperDraft(snapshot());
  assert.deepEqual(wallpaperTransition(draft,'open-transition'),{seconds:3,easing:'ease-out'});
  draft.transitions={'open-transition':{seconds:1.2,easing:'ease-out'},'closed-transition':{seconds:2.4,easing:'linear'}};
  const plans=wallpaperPlan(draft),opened=plans.find(p=>p.key==='open-transition'),closed=plans.find(p=>p.key==='closed-transition');
  assert.equal(opened.frames,36);assert.equal(closed.frames,72);assert.equal(opened.easing,'ease-out');
  assert.ok(opened.sample(1).amount>2.8/(opened.frames-1));
  assert.ok(Math.abs(closed.sample(1).amount-1/(closed.frames-1))<1e-12);
});
test('all transition curves are monotonic, have exact endpoints and meet the steady first frame',()=>{
  for(const {value} of transitionCurves.filter(item=>item.value!=='custom')){
    const draft=defaultWallpaperDraft(snapshot());draft.transitions={'open-transition':{seconds:.5,easing:value}};
    const plans=wallpaperPlan(draft),arrival=plans.find(p=>p.key==='open-transition'),steady=plans.find(p=>p.key==='open-steady');
    let previous=-1;
    for(let i=0;i<arrival.frames;i++){const amount=arrival.sample(i).amount;assert.ok(amount>=previous&&amount>=0&&amount<=1);previous=amount;}
    assert.deepEqual(arrival.sample(0).view,draft.states['open-transition'].view);
    assert.deepEqual(arrival.sample(arrival.frames-1).view,steady.sample(0).view);
    assert.deepEqual(arrival.sample(arrival.frames-1).colors,steady.sample(0).colors);
  }
  assert.ok(transitionProgress(.01,'ease-out')>.029);
  assert.ok(1-transitionProgress(.99,'ease-out')<.000002);
  assert.ok(transitionProgress(.01,'ease-in-out')<.00002);
});
test('legacy drafts and invalid timing fields are handled before rendering',()=>{
  const draft=defaultWallpaperDraft(snapshot());delete draft.transitions;draft.arrivalSeconds=1;
  assert.equal(wallpaperPlan(draft).find(p=>p.transition).frames,30);
  for(const timing of [null,[],{'open-transition':null},{'open-transition':{seconds:0}},{'open-transition':{seconds:11}},{'open-transition':{easing:'unknown'}}]){
    assert.throws(()=>wallpaperPlan({...draft,transitions:timing}),/transition/);
  }
});
test('a new draft has lively idle states even when the explorer was still', () => {
  const source=snapshot();source.wander=false;const draft=defaultWallpaperDraft(source);
  assert.equal(draft.states['closed-steady'].wander,true);assert.equal(draft.states['open-steady'].wander,true);
});
test('the four states map exactly to arrival then steady playback on each screen', () => {
  const draft = defaultWallpaperDraft(snapshot()), plans = wallpaperPlan(draft), manifest = wallpaperManifest(draft,plans);
  assert.deepEqual(manifest.playback['just-closed'], ['closed-transition','closed-steady']);
  assert.deepEqual(manifest.playback['just-opened'], ['open-transition','open-steady']);
  assert.equal(plans.length,4); assert.equal(new Set(plans.map(p=>p.file)).size,4);
  assert.equal(manifest.clips['closed-steady'].loop,true); assert.equal(manifest.clips['open-transition'].loop,false);
  for (const p of plans) { assert.equal(p.width%2,0); assert.equal(p.height%2,0); assert.equal(p.fps,p.transition?30:15); }
});

test('transition-only packages retain all four clips and exact still endpoints', () => {
  const draft = defaultWallpaperDraft(snapshot()); draft.steadyMotion = 'still';
  const plans = wallpaperPlan(draft), manifest = wallpaperManifest(draft, plans);
  assert.equal(manifest.steadyMotion, 'still'); assert.equal(manifest.editor.steadyMotion, 'still');
  assert.equal(Object.keys(manifest.clips).length, 4);
  for (const arrival of plans.filter(p => p.transition)) {
    const steady = plans.find(p => p.key === arrival.target);
    assert.deepEqual(arrival.sample(arrival.frames - 1).view, steady.sample(0).view);
    assert.deepEqual(arrival.sample(arrival.frames - 1).colors, steady.sample(0).colors);
  }
});

test('old drafts retain animated playback and unknown modes are rejected', () => {
  const draft = defaultWallpaperDraft(snapshot()); delete draft.steadyMotion;
  assert.equal(wallpaperManifest(draft, wallpaperPlan(draft)).steadyMotion, 'animated');
  draft.steadyMotion = 'unknown'; assert.throws(() => wallpaperPlan(draft), /playback mode/);
});
test('each arrival ends at exactly the idle frame zero, including colors and automation', () => {
  const draft = defaultWallpaperDraft(snapshot());
  draft.states['open-transition'].colors.density=1.2;
  draft.states['open-steady'].colors.density=.3;
  draft.states['open-steady'].automation={julia_x:{enabled:true,target:'-.79',speed:.25,shape:'smootherstep'}};
  const plans=wallpaperPlan(draft);
  for(const start of plans.filter(p=>p.transition)){
    const idle=plans.find(p=>p.key===start.target), end=start.sample(start.frames-1), zero=idle.sample(0);
    assert.deepEqual(end.view,zero.view);assert.deepEqual(end.colors,zero.colors);
  }
});
test('interpolation retains deep coordinates and logarithmic zoom beyond Number range', () => {
  const from={...view,x:'-0.743643887037151000000000000000000000000001',span:'1e-1000'};
  const to={...from,x:'-0.743643887037151000000000000000000000000003',span:'1e-2000'};
  const p=wallpaperViewPath(from,to), middle=p.viewAt(.5);
  assert.equal(p.compatible,true);assert.equal(compare(decimal(middle.x),decimal('-0.743643887037151000000000000000000000000002')),0);
  assert.equal(Number(middle.span),0);assert.equal(middle.span,'1e-1500');
  assert.deepEqual(p.viewAt(1),to);
});
test('different expressions and palettes choose a blend instead of invalid parameter interpolation', () => {
  const draft=defaultWallpaperDraft(snapshot());
  draft.states['closed-transition'].view={...view,fractal:'mandelbrot'};
  draft.states['open-transition'].colors.definition.colors=['#000000','#ffffff'];
  const plans=wallpaperPlan(draft);
  assert.equal(plans.find(p=>p.key==='closed-transition').crossfade,true);
  assert.equal(plans.find(p=>p.key==='open-transition').crossfade,true);
});

test('different saved rendering settings blend the two states without discarding arrival settings', () => {
  const draft=defaultWallpaperDraft(snapshot());
  draft.states['open-transition'].settings={arithmetic:'fp32',range_mode:'standard'};
  draft.states['open-steady'].settings={arithmetic:'auto',range_mode:'auto'};
  const p=wallpaperPlan(draft).find(p=>p.key==='open-transition');
  assert.equal(p.crossfade,true); assert.equal(p.sample(0).amount,0); assert.equal(p.sample(p.frames-1).amount,1);
  assert.deepEqual(p.sample(0).from.settings,{arithmetic:'fp32',range_mode:'standard'});
  assert.deepEqual(p.sample(p.frames-1).to.settings,{arithmetic:'auto',range_mode:'auto'});
  assert.equal(wallpaperPlan(draft).find(p=>p.key==='closed-transition').crossfade,false);
});
test('idle automation and palette wandering complete integer cycles without a final hold', () => {
  const draft=defaultWallpaperDraft(snapshot());
  draft.states['open-steady'].automation={julia_y:{enabled:true,target:'.17',speed:.25,shape:'sine'}};
  const p=wallpaperPlan(draft).find(p=>p.key==='open-steady');
  assert.deepEqual(p.sample(0).view,p.snapshot.view);assert.notDeepEqual(p.sample(Math.floor(p.frames/4)).view,p.snapshot.view);
  const last=p.sample(p.frames-1);assert.notEqual(last.colors.phase,p.sample(0).colors.phase);
  assert.throws(()=>p.sample(p.frames),/Invalid/);
});

test('idle parameter motion retains absolute speeds rounded to whole clip cycles', () => {
  const samples = [];
  for (const speed of [.25, .5, 1]) {
    const draft = defaultWallpaperDraft(snapshot()); draft.idleSeconds = 8;
    draft.states['open-steady'].automation = { julia_x: { enabled: true, target: '-.7', speed, shape: 'sine' } };
    const p = wallpaperPlan(draft).find(p => p.key === 'open-steady');
    assert.equal(p.parameterCycles.julia_x, speed * 8);
    samples.push(Number(p.sample(p.fps).view.julia_x));
    assert.deepEqual(p.sample(0).view, p.snapshot.view);
  }
  assert.ok(Math.abs(samples[0] + .75) < 1e-12);
  assert.equal(samples[1], -.7); assert.equal(samples[2], -.8);
  const draft = defaultWallpaperDraft(snapshot()); draft.idleSeconds = 3;
  draft.states['open-steady'].automation = { julia_x: { enabled: true, target: '-.7', speed: .5, shape: 'sine' } };
  assert.equal(wallpaperPlan(draft).find(p => p.key === 'open-steady').parameterCycles.julia_x, 2);
});
test('wallpaper drafts validate ranges, expressions, and detached custom palettes', () => {
  const draft=defaultWallpaperDraft(snapshot());
  draft.states['open-steady'].colors.definition.colors=Array.from({length:13},()=> '#123456');
  assert.doesNotThrow(()=>wallpaperPlan(draft));
  draft.arrivalSeconds=100;assert.throws(()=>wallpaperPlan(draft),/arrival/);
  draft.arrivalSeconds=3;draft.states['closed-steady'].colors.definition.colors=['invalid','#123456'];
  assert.throws(()=>wallpaperPlan(draft),/palette/);
});
test('stored ZIP entries have interoperable headers, CRCs, and fixed safe names', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const blob=await wallpaperZip([['wallpaper.json',new Blob(['hello'])],['cover-idle.mp4',new Blob([new Uint8Array([1,2,3])])]]);
  const bytes=new Uint8Array(await blob.arrayBuffer()),v=new DataView(bytes.buffer);
  assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint32(14,true),crc32(new TextEncoder().encode('hello')));
  assert.equal(v.getUint32(bytes.length-22,true),0x06054b50);assert.equal(v.getUint16(bytes.length-12,true),2);
  await assert.rejects(wallpaperZip([['../file.mp4',new Blob(['x'])]]),/filename/);
});

test('every accepted imported palette can be restored in the existing editor', () => {
  const draft=defaultWallpaperDraft(snapshot());
  const definition=draft.states['open-steady'].colors.definition;
  const colors=Array.from({length:MAX_PALETTE_COLORS},(_,i)=>`#${i.toString(16).padStart(6,'0')}`);
  definition.colors=[...colors,'#000040'];
  assert.throws(()=>wallpaperPlan(draft),new RegExp(`2–${MAX_PALETTE_COLORS} colors`));
  definition.colors=[...colors,'#000000'];
  assert.doesNotThrow(()=>wallpaperPlan(draft));
  definition.name='x'.repeat(41); assert.throws(()=>wallpaperPlan(draft),/name/);
});

test('still/arrival captures use the displayed frame, while animated captures retain their loop baseline', () => {
  const source = {view, visibleView:{...view,julia_x:'-.7'}, visibleViewReady:true,
    automation:{julia_x:{enabled:true,target:'-.7',speed:.25,shape:'sine'}},
    colors:{definition:{name:'P',colors:['#000000','#ffffff']},density:1,phase:0},speed:.12};
  assert.equal(wallpaperSnapshot(source,[],{visible:true}).view.julia_x,'-.7');
  assert.equal(wallpaperSnapshot(source,[]).view.julia_x,'-.8');
  source.visibleViewReady=false;
  assert.equal(wallpaperSnapshot(source,[],{visible:true}).view.julia_x,'-.8','pending navigation must not capture an obsolete displayed frame');
  source.requestedView={...view,x:'.1',julia_x:'-.75'};
  assert.deepEqual(wallpaperSnapshot(source,[],{visible:true}).view,source.requestedView,'pending rerenders retain their requested center and paused parameters');
});

test('supported long constants and automation produce portable drafts and package metadata above 1 MiB', () => {
  const draft = largeWallpaperDraft(), json = wallpaperJSON(draft, true);
  assert.ok(new Blob([json]).size > 1024 ** 2);
  assert.ok(new Blob([json]).size <= MAX_WALLPAPER_JSON_BYTES);
  const restored = JSON.parse(json), plans = wallpaperPlan(restored), manifest = wallpaperManifest(restored, plans);
  assert.equal(plans.length, 4);
  assert.equal(restored.states['open-steady'].view.x16, draft.states['open-steady'].view.x16);
  assert.ok(new Blob([wallpaperJSON(manifest)]).size > 1024 ** 2);
});

test('metadata size limits count UTF-8 bytes and reject oversize manifests before rendering', () => {
  assert.throws(() => wallpaperJSON({text:'é'.repeat(MAX_WALLPAPER_JSON_BYTES / 2)}), /4 MiB/);
  const draft = defaultWallpaperDraft(snapshot()); draft.note = 'x'.repeat(MAX_WALLPAPER_JSON_BYTES);
  assert.throws(() => wallpaperManifest(draft, wallpaperPlan(draft)), /4 MiB/);
});
