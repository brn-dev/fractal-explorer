import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL, fileURLToPath} from 'node:url';
import { largeWallpaperDraft } from './wallpaper-fixtures.mjs';
const root = fileURLToPath(new URL('../src/', import.meta.url));
const {defaultWallpaperDraft, wallpaperSnapshot} = await import(pathToFileURL(root+'wallpaper.mjs'));
let source = await readFile(root+'wallpaper-ui.js','utf8');
source = source.replace("import { BrowserEngine } from './engine.js';", 'const BrowserEngine = globalThis.TestEngine;');
source = source.replace("await import('./video-export.js')", 'globalThis.testVideo');
source = source.replaceAll(/from '(\.\/[^']+)'/g, (_, p) => `from '${pathToFileURL(root+p).href}'`);
source = source.replace(/\n}\s*$/, '\n return {draft:()=>draft};\n}');
let hold = null;
let slowRender = null;
const engines = [];
globalThis.TestEngine = class {
  constructor() { this.destroyCalls=0; engines.push(this); }
  async gate(stage) { if (hold===stage) await new Promise((resolve,reject)=>{this.pending={resolve,reject};}); }
  async init() { await this.gate('init'); }
  async render(view,width,height,settings) { await this.gate('render'); slowRender?.(); return {metadata:{width,height,color_origin:0,view}}; }
  async readField() { return new Float32Array(1); }
  cancel() {}
  destroy() { this.destroyCalls++; this.destroyed=true; this.pending?.reject(new DOMException('cancel','AbortError')); }
};
class Element extends EventTarget {
  constructor(id) { super(); this.id=id; this.tag=id; this.children=[]; this.open=false; this.value=''; this.style={setProperty(){}}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() {}
  click() { this.onclick?.(); }
  querySelectorAll(selector) { const tags=selector.split(',').map(x=>x.trim()),out=[]; const walk=e=>{ for(const c of e.children){if(tags.includes(c.tag))out.push(c);walk(c);} }; walk(this); return out; }
  close() { if(this.open){this.open=false;setImmediate(()=>this.dispatchEvent(new Event('close')));} }
  showModal() { this.open=true; }
  scrollIntoView() {}
  getContext() { return {globalAlpha:1,drawImage(){}}; }
  toDataURL() { return 'data:image/png;base64,YQ=='; }
  toBlob(callback) { callback(new Blob(['png'])); }
}
const ids=['wallpaper-dialog','wallpaper-name','wallpaper-arrival-seconds','wallpaper-idle-seconds','wallpaper-size','wallpaper-idle-fps','wallpaper-steady-motion','wallpaper-screen','wallpaper-color-motion','wallpaper-color-seconds','wallpaper-color-note','wallpaper-loop-note','wallpaper-resolution-note','wallpaper-detect-resolution','wallpaper-quality','wallpaper-bitrate','wallpaper-encoding-note','wallpaper-status','wallpaper-preview-status','wallpaper-preview-play','wallpaper-cancel','wallpaper-create','wallpaper-preview','wallpaper-preview-stage','wallpaper-state-cards','wallpaper-editing-label','wallpaper-editing','open-wallpaper-export','wallpaper-save-state','wallpaper-overview','wallpaper-apply','wallpaper-save-draft','wallpaper-open-draft','wallpaper-draft-file','export-dialog','export-menu-status'];
const palettes=[{name:'P',colors:['#000000','#ffffff','#000000']}];
const state={view:{fractal:'mandelbrot',x:'-.5',y:'0',span:'3.6',julia_x:'-.8',julia_y:'.156',iterations:100,bailout:64},colors:{palette:0,density:1,phase:0},speed:.12};
let storage;
globalThis.localStorage={getItem(){return storage;},setItem(k,v){storage=v;}};
globalThis.requestAnimationFrame=callback=>setImmediate(()=>callback(performance.now()));
globalThis.cancelAnimationFrame=clearImmediate;
globalThis.testVideo={async supportsMP4(){return true;},async mp4Encoder(){return {async add(){},async finish(){return new Blob(['mp4']);},async cancel(){}};}};
const {setupWallpaper}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(reset=true, overrides={}) {
  hold=null;
  if(reset){const draft=defaultWallpaperDraft(wallpaperSnapshot(state,palettes));draft.states['open-steady'].view.x='-.12345';storage=JSON.stringify(draft);}
  const extra=['wallpaper-gallery-screen','wallpaper-gallery-dialog','wallpaper-gallery-status','wallpaper-gallery-cards','open-wallpaper-gallery','wallpaper-gallery','wallpaper-gallery-new','wallpaper-gallery-set','wallpaper-replace-dialog','wallpaper-replace-continue','wallpaper-editing-help'];
  const elements=Object.fromEntries([...ids,...extra].map(id=>[id,new Element(id)]));
  const find=(node,id)=>node.id===id?node:node.children.map(child=>find(child,id)).find(Boolean);
  globalThis.document={hidden:false,getElementById:id=>elements[id]??Object.values(elements).map(node=>find(node,id)).find(Boolean),createElement:tag=>new Element(tag),addEventListener(){}};
  const api=setupWallpaper({engine:{gpu:false,mobile:false},palettes,getState:()=>state,applyState(){},paint(){},downloadBlob(){},...overrides});
  return {elements,api};
}
async function close(elements){elements['wallpaper-dialog'].close();await flush();}

test('import keeps the reopened/current dialog preview alive after queued close events',async()=>{
  const {elements}=setup(); elements['open-wallpaper-export'].onclick();await flush();
  await elements['wallpaper-draft-file'].onchange({target:{files:[{size:storage.length,text:async()=>storage}],value:'x'}});await flush();
  assert.equal(elements['wallpaper-dialog'].open,true); assert.notEqual(engines.at(-1).destroyed,true);
  await close(elements);
});
for(const stage of ['init','render'])test(`cancel terminates a pending CPU ${stage} and clears busy state`,async()=>{
  const {elements}=setup();elements['open-wallpaper-export'].onclick();await flush();hold=stage;
  const job=elements['wallpaper-create'].onclick();await flush();const renderer=engines.at(-1);assert.ok(renderer.pending);
  elements['wallpaper-cancel'].onclick();await flush();
  const settled=await Promise.race([job.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),25))]);
  if(!settled) renderer.pending.reject(new DOMException('forced cleanup','AbortError'));
  await job;
  assert.equal(settled,true,'cancellation should not wait for the CPU frame');assert.equal(renderer.destroyed,true);
  assert.equal(elements['wallpaper-cancel'].hidden,true);assert.match(elements['wallpaper-status'].textContent,/cancelled/);
  await close(elements);
});
test('invalid option edits retain the last valid persisted draft across a reload',async()=>{
  const {elements}=setup();elements['open-wallpaper-export'].onclick();await flush();
  const duration=document.getElementById('wallpaper-open-transition-seconds');duration.value='';
  assert.doesNotThrow(()=>duration.onchange());
  assert.match(elements['wallpaper-preview-status'].textContent,/transition/);
  await close(elements);const {api}=setup(false);
  assert.ok(api.draft(),'persisted edits should survive invalid option input');
  assert.equal(api.draft().states['open-steady'].view.x,'-.12345');
});

test('slow CPU previews show every arrival frame, its endpoint, and steady frame zero',async()=>{
  const previousPerformance=globalThis.performance, previousRAF=globalThis.requestAnimationFrame;
  let now=0;
  globalThis.performance={now:()=>now};
  globalThis.requestAnimationFrame=callback=>setImmediate(()=>{now+=1;callback(now);});
  slowRender=()=>{now+=4000;};
  const painted=[];
  const {elements}=setup(true,{paint(canvas,values,metadata,colors){painted.push({view:metadata.view,colors});}});
  try {
    elements['open-wallpaper-export'].onclick();await flush();
    elements['wallpaper-steady-motion'].value='still';elements['wallpaper-steady-motion'].onchange();await flush();
    painted.length=0;
    elements['wallpaper-preview-play'].onclick();
    for(let i=0;i<200 && !elements['wallpaper-preview-status'].textContent?.includes('still image');i++)await flush();
    assert.match(elements['wallpaper-preview-status'].textContent,/still image/);
    assert.equal(painted.length,91,'90 arrival frames followed by steady zero');
    assert.notDeepEqual(painted[0].view,painted.at(-1).view);
    assert.deepEqual(painted.at(-2),painted.at(-1),'arrival endpoint meets steady zero');
    assert.equal(elements['wallpaper-preview-play'].textContent,'Play preview');
  } finally {await close(elements);slowRender=null;globalThis.performance=previousPerformance;globalThis.requestAnimationFrame=previousRAF;}
});

test('editing an imported state uses the same normalized palette that passed validation',async()=>{
  let applied;
  const {elements}=setup(true,{applyState(value){applied=value;}});
  const draft=JSON.parse(storage), colors=Array.from({length:12},(_,i)=>`#${(i+10).toString(16).padStart(6,'0').toUpperCase()}`);
  draft.states['open-steady'].colors.definition={colors:[...colors,colors[0].toLowerCase()]};
  const imported=JSON.stringify(draft);
  elements['open-wallpaper-export'].onclick();await flush();
  await elements['wallpaper-draft-file'].onchange({target:{files:[{size:imported.length,text:async()=>imported}],value:'x'}});await flush();
  elements['wallpaper-state-cards'].children[1].children[3].children[1].onclick();
  assert.equal(applied.colors.definition.name,'Wallpaper');
  assert.equal(applied.colors.definition.colors.length,13);
  assert.equal(applied.colors.definition.colors[0],applied.colors.definition.colors.at(-1));
  assert.equal(elements['wallpaper-editing'].hidden,false);
  await flush();
});

test('Use current view in still mode captures a paused frame and makes the arrival meet it',async()=>{
  const displayed={...state,view:{...state.view,fractal:'julia'},visibleView:{...state.view,fractal:'julia',julia_x:'-.7'},visibleViewReady:true};
  const {elements}=setup(true,{getState:()=>displayed});
  elements['open-wallpaper-export'].onclick();await flush();
  elements['wallpaper-steady-motion'].value='still';elements['wallpaper-steady-motion'].onchange();await flush();
  elements['wallpaper-state-cards'].children[1].children[3].children[2].onclick();await flush();
  const saved=JSON.parse(storage), {wallpaperPlan}=await import(pathToFileURL(root+'wallpaper.mjs'));
  assert.equal(saved.states['open-steady'].view.julia_x,'-.7');
  const plans=wallpaperPlan(saved), arrival=plans.find(p=>p.key==='open-transition'), steady=plans.find(p=>p.key==='open-steady');
  assert.equal(steady.sample(0).view.julia_x,'-.7');
  assert.deepEqual(arrival.sample(arrival.frames-1).view,steady.sample(0).view);
  await close(elements);
});

test('a saved supported draft above 1 MiB can be opened again with all decimal inputs intact',async()=>{
  let downloaded;
  const {elements,api}=setup(true,{downloadBlob:async blob=>{downloaded=blob;}});
  elements['open-wallpaper-export'].onclick();await flush();
  const draft=largeWallpaperDraft(), imported=JSON.stringify(draft);
  assert.ok(new Blob([imported]).size>1024**2);
  await elements['wallpaper-draft-file'].onchange({target:{files:[{size:new Blob([imported]).size,text:async()=>imported}],value:'x'}});
  assert.equal(api.draft().states['open-steady'].view.x16,draft.states['open-steady'].view.x16);
  await elements['wallpaper-save-draft'].onclick();
  assert.ok(downloaded.size>500000);
  await close(elements);
  const fresh=setup();fresh.elements['open-wallpaper-export'].onclick();await flush();
  await fresh.elements['wallpaper-draft-file'].onchange({target:{files:[{size:downloaded.size,text:()=>downloaded.text()}],value:'x'}});
  assert.equal(fresh.api.draft().states['open-steady'].view.x16,draft.states['open-steady'].view.x16);
  assert.equal(fresh.api.draft().states['open-steady'].automation.x16.target,draft.states['open-steady'].automation.x16.target);
  await close(fresh.elements);
});

test('New wallpaper keeps the current working draft until replacement is confirmed',async()=>{
  globalThis.window = new EventTarget();
  globalThis.FractalNative = {info(){},listWallpapers(){return '{"ok":true,"wallpapers":[]}';}};
  const {elements,api}=setup();
  try {
    elements['open-wallpaper-export'].onclick(); await flush();
    elements['wallpaper-gallery'].click(); elements['wallpaper-gallery-new'].click();
    assert.equal(elements['wallpaper-replace-dialog'].open,true);
    assert.equal(api.draft().states['open-steady'].view.x,'-.12345');
    elements['wallpaper-replace-continue'].click(); await flush();
    assert.equal(api.draft().states['open-steady'].view.x,state.view.x);
    assert.equal(elements['wallpaper-gallery-dialog'].open,false);
    assert.equal(elements['wallpaper-dialog'].open,true);
    assert.equal(JSON.parse(storage).states['open-steady'].view.x,state.view.x);
  } finally {await close(elements);delete globalThis.FractalNative;}
});

test('gallery New uses native resolution on either screen while preserving imported sizes',async()=>{
  globalThis.window=new EventTarget();
  globalThis.FractalNative={info(){},wallpaperDisplays(){return JSON.stringify({ok:true,screens:{inner:{width:2256,height:2504},cover:{width:1080,height:2520}}});},listWallpapers(){return '{"ok":true,"wallpapers":[]}';}};
  const {elements,api}=setup();
  try {
    elements['open-wallpaper-export'].click();await flush();
    for(const screen of ['inner','cover']) {
      elements['wallpaper-gallery'].click();
      elements['wallpaper-gallery-screen'].value=screen;elements['wallpaper-gallery-screen'].onchange();
      elements['wallpaper-gallery-new'].click();elements['wallpaper-replace-continue'].click();await flush();
      assert.equal(api.draft().screen,screen);assert.equal(api.draft().longest,'native');
      assert.equal(elements['wallpaper-size'].value,'native');assert.equal(api.draft().screenSizes[screen].width,screen==='inner'?2256:1080);
    }
    const imported={...api.draft(),longest:720};
    await elements['wallpaper-draft-file'].onchange({target:{files:[{size:123,text:async()=>JSON.stringify(imported)}],value:'x'}});await flush();
    assert.equal(api.draft().longest,720);
  } finally {await close(elements);delete globalThis.FractalNative;}
});

test('gallery editing extracts the selected screen from a combined design without changing the saved original',async()=>{
  const saved=defaultWallpaperDraft(wallpaperSnapshot(state,palettes)); saved.name='Saved original'; saved.states['open-steady'].view.x='-.4321';
  globalThis.window = new EventTarget();
  globalThis.FractalNative = {
    info(){},listWallpapers(){return JSON.stringify({ok:true,wallpapers:[{id:'a',name:saved.name,bytes:123,active:true,editable:true}]});},
    wallpaperThumbnail(){return '{"ok":true,"image":"data:image/png;base64,YQ=="}';},
    wallpaperDraft(){return JSON.stringify({ok:true,draft:saved});},
  };
  const {elements,api}=setup();
  try {
    elements['open-wallpaper-export'].onclick(); await flush(); elements['wallpaper-gallery'].click();
    elements['wallpaper-gallery-cards'].children[0].children[1].children[2].children[1].click();
    elements['wallpaper-replace-continue'].click(); await flush();
    assert.equal(api.draft().screen,'inner'); assert.deepEqual(api.draft().states['open-steady'],saved.states['open-steady']); assert.equal(Object.keys(api.draft().states).length,2); assert.equal(elements['wallpaper-name'].value,'Saved original');
    api.draft().states['open-steady'].view.x='-.9';
    assert.equal(saved.states['open-steady'].view.x,'-.4321');
  } finally {await close(elements);delete globalThis.FractalNative;}
});

test('cover and main drafts retain separate names, timing, colors and scenes across switches and reload',async()=>{
  const oldStorage=globalThis.localStorage, values=new Map();
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  let current=structuredClone(state);
  try {
    const {elements,api}=setup(true,{getState:()=>current});elements['open-wallpaper-export'].click();await flush();
    assert.equal(api.draft().screen,'inner');assert.equal(elements['wallpaper-state-cards'].children.length,2);
    elements['wallpaper-name'].value='Main A';elements['wallpaper-color-seconds'].value='4';elements['wallpaper-name'].onchange();await flush();
    elements['wallpaper-screen'].value='cover';elements['wallpaper-screen'].onchange();await flush();
    elements['wallpaper-name'].value='Cover B';elements['wallpaper-idle-seconds'].value='4';elements['wallpaper-color-seconds'].value='2';elements['wallpaper-name'].onchange();await flush();
    current={...current,view:{...current.view,x:'.123'}};
    elements['wallpaper-state-cards'].children[1].children[3].children[2].click();await flush();
    assert.equal(api.draft().screen,'cover');assert.equal(api.draft().states['closed-steady'].view.x,'.123');
    elements['wallpaper-screen'].value='inner';elements['wallpaper-screen'].onchange();await flush();
    assert.equal(api.draft().name,'Main A');assert.equal(api.draft().colorSeconds,4);assert.equal(api.draft().idleSeconds,8);
    assert.equal(api.draft().states['open-steady'].view.x,state.view.x);await close(elements);
    const fresh=setup(false);fresh.elements['open-wallpaper-export'].click();await flush();
    assert.equal(fresh.api.draft().name,'Main A');
    fresh.elements['wallpaper-screen'].value='cover';fresh.elements['wallpaper-screen'].onchange();await flush();
    assert.equal(fresh.api.draft().name,'Cover B');assert.equal(fresh.api.draft().states['closed-steady'].view.x,'.123');assert.equal(fresh.api.draft().idleSeconds,4);
    await close(fresh.elements);
  } finally { globalThis.localStorage=oldStorage; }
});

test('native creation sends only the selected screen pair and poster to publication',async()=>{
  const clips=[],posters=[],manifests=[],oldVideo=globalThis.testVideo;
  globalThis.window=new EventTarget();
  globalThis.FractalNative={info(){},beginPack:()=>'{"ok":true}',putPoster:screen=>{posters.push(screen);return '{"ok":true}';},commitPack:json=>{manifests.push(JSON.parse(json));return '{"ok":true}';}};
  globalThis.testVideo={async supportsMP4(){return true;},async mp4Encoder(canvas,plan){clips.push(plan.nativeTarget);return {async add(){},async finish(){},async cancel(){}};}};
  const {elements}=setup();
  try {
    elements['open-wallpaper-export'].click();await flush();
    for(const screen of ['inner','cover']) {
      elements['wallpaper-screen'].value=screen;elements['wallpaper-screen'].onchange();await flush();
      const prefix=screen==='cover'?'closed':'open';
      document.getElementById(`wallpaper-${prefix}-transition-seconds`).value='.5';
      elements['wallpaper-idle-seconds'].value='2';elements['wallpaper-idle-fps'].value='10';
      await elements['wallpaper-create'].onclick();
      assert.equal(manifests.at(-1).screen,screen);assert.equal(Object.keys(manifests.at(-1).clips).length,2);
      assert.deepEqual(Object.keys(manifests.at(-1).posters),[screen]);
    }
    assert.deepEqual(clips,['open-transition','open-steady','closed-transition','closed-steady']);
    assert.deepEqual(posters,['inner','cover']);
  } finally {await close(elements);delete globalThis.FractalNative;globalThis.testVideo=oldVideo;}
});

test('opening a legacy main draft then reloading preserves the unvisited cover draft',async()=>{
  const oldStorage=globalThis.localStorage, legacy=defaultWallpaperDraft(wallpaperSnapshot(state,palettes));
  legacy.states['closed-steady'].view.x='-.314159';legacy.states['open-steady'].view.x='-.271828';
  const values=new Map([['fractal-web-wallpaper-v1',JSON.stringify(legacy)]]);
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  try {
    const first=setup(false);first.elements['open-wallpaper-export'].click();await flush();await close(first.elements);
    const next=setup(false);next.elements['open-wallpaper-export'].click();await flush();
    assert.equal(next.api.draft().states['open-steady'].view.x,'-.271828');
    next.elements['wallpaper-screen'].value='cover';next.elements['wallpaper-screen'].onchange();await flush();
    assert.equal(next.api.draft().states['closed-steady'].view.x,'-.314159');await close(next.elements);
  } finally {globalThis.localStorage=oldStorage;}
});

test('transition start and end edit different saved scenes and the banner names their role',async()=>{
  let applied;
  const chosen={...state,view:{...state.view,x:'-.3456'}};
  const {elements,api}=setup(true,{getState:()=>chosen,applyState:value=>{applied=value;}});
  elements['open-wallpaper-export'].onclick();await flush();
  const original=structuredClone(api.draft().states['open-transition']);
  const card=elements['wallpaper-state-cards'].children[0];
  assert.match(card.children[1].textContent,/START.*END.*Open/);
  card.children[3].children[1].click();await flush();
  assert.deepEqual(applied.view,original.view);assert.match(elements['wallpaper-editing-label'].textContent,/START/);
  elements['wallpaper-overview'].click();await flush();
  card.children[4].children[2].click();await flush();
  assert.equal(applied.view.x,'-.12345');assert.match(elements['wallpaper-editing-label'].textContent,/END \/ steady/);
  elements['wallpaper-save-state'].click();await flush();
  assert.equal(api.draft().states['open-steady'].view.x,'-.3456');
  assert.deepEqual(api.draft().states['open-transition'].view,original.view); assert.deepEqual(api.draft().states['open-transition'].colors,api.draft().states['open-steady'].colors);
  const {wallpaperPlan}=await import(pathToFileURL(root+'wallpaper.mjs')),plans=wallpaperPlan(api.draft()),transition=plans[0];
  assert.deepEqual(transition.sample(transition.frames-1).view,plans[1].sample(0).view);
  await close(elements);
});

test('view-end preview and saved endpoint edits never retain a start-scene caption',async()=>{
  const painted=[];
  const {elements}=setup(true,{paint(canvas,values,metadata){painted.push(metadata.view);}});
  elements['open-wallpaper-export'].onclick();await flush();const card=elements['wallpaper-state-cards'].children[0];
  card.children[4].children[1].click();await flush();
  assert.match(elements['wallpaper-preview-status'].textContent,/END = Open/);assert.equal(painted.at(-1).x,'-.12345');
  card.children[4].children[0].click();await flush();assert.match(elements['wallpaper-preview-status'].textContent,/START/);
  card.children[4].children[2].click();await flush();elements['wallpaper-save-state'].click();await flush();
  assert.doesNotMatch(elements['wallpaper-preview-status'].textContent,/START/);
  await close(elements);
});

test('per-transition curve and duration edits persist independently and invalid timing stops preview',async()=>{
  const {elements,api}=setup();elements['open-wallpaper-export'].onclick();await flush();
  const duration=document.getElementById('wallpaper-open-transition-seconds'),curve=document.getElementById('wallpaper-open-transition-easing');
  duration.value='1.2';curve.value='ease-out-strong';duration.onchange();await flush();
  assert.deepEqual(api.draft().transitions['open-transition'],{seconds:1.2,easing:'ease-out-strong'});
  elements['wallpaper-screen'].value='cover';elements['wallpaper-screen'].onchange();await flush();
  assert.deepEqual(api.draft().transitions['closed-transition'],{seconds:3,easing:'ease-out'});
  elements['wallpaper-screen'].value='inner';elements['wallpaper-screen'].onchange();await flush();
  const currentDuration=document.getElementById('wallpaper-open-transition-seconds');currentDuration.value='';currentDuration.onchange();await flush();
  assert.match(elements['wallpaper-preview-status'].textContent,/transition/);assert.equal(elements['wallpaper-preview-play'].textContent,'Play preview');
  assert.equal(api.draft().transitions['open-transition'].seconds,1.2);
  await close(elements);
});

test('a timing edit requires new rendering while viewing an unchanged endpoint keeps Apply available',async()=>{
  globalThis.window=new EventTarget();
  globalThis.FractalNative={info(){},beginPack:()=>'{"ok":true}',putPoster:()=>'{"ok":true}',commitPack:()=>'{"ok":true}'};
  const {elements}=setup();
  try {
    elements['open-wallpaper-export'].click();await flush();
    document.getElementById('wallpaper-open-transition-seconds').value='.5';document.getElementById('wallpaper-open-transition-seconds').value='.5';
    elements['wallpaper-idle-seconds'].value='2';elements['wallpaper-idle-fps'].value='10';elements['wallpaper-size'].value='480';
    await elements['wallpaper-create'].onclick();
    assert.equal(elements['wallpaper-apply'].hidden,false);
    elements['wallpaper-state-cards'].children[0].children[4].children[1].click();await flush();
    assert.equal(elements['wallpaper-apply'].hidden,false);
    const curve=document.getElementById('wallpaper-open-transition-easing');curve.value='linear';curve.onchange();await flush();
    assert.equal(elements['wallpaper-apply'].hidden,true);assert.match(elements['wallpaper-status'].textContent,/Create the wallpaper again/);
  } finally {await close(elements);delete globalThis.FractalNative;}
});

test('transition editing suppresses ignored motion without mutating the saved design on cancel',async()=>{
  const changes=[],applied=[];
  const {elements,api}=setup(true,{applyState:state=>applied.push(state),onSceneEditingChange:slot=>changes.push(slot?.key??null)});
  const original=api.draft().states['open-transition'];original.automation={julia_x:{enabled:true,target:'-.7',speed:.25,shape:'sine'}};original.wander=true;
  elements['open-wallpaper-export'].click();await flush();
  elements['wallpaper-state-cards'].children[0].children[3].children[1].click();await flush();
  assert.equal(changes.at(-1),'open-transition');assert.deepEqual(applied.at(-1).automation,{});assert.equal(applied.at(-1).wander,false);
  assert.equal(original.automation.julia_x.enabled,true);assert.equal(original.wander,true);
  assert.match(elements['wallpaper-editing-help'].textContent,/disabled/);
  elements['wallpaper-overview'].click();await flush();assert.equal(changes.at(-1),null);
  elements['wallpaper-state-cards'].children[1].children[3].children[1].click();await flush();
  assert.equal(changes.at(-1),'open-steady');assert.equal(applied.at(-1).wander,true);
  elements['wallpaper-overview'].click();await flush();await close(elements);
});

test('saving a transition start strips ignored automation and releases the editing lock',async()=>{
  const changes=[];
  const animated={...state,automation:{julia_x:{enabled:true,target:'-.7',speed:.25,shape:'sine'}},wander:true};
  const {elements,api}=setup(true,{getState:()=>animated,onSceneEditingChange:slot=>changes.push(slot?.key??null)});
  elements['open-wallpaper-export'].click();await flush();
  elements['wallpaper-state-cards'].children[0].children[3].children[1].click();await flush();
  elements['wallpaper-save-state'].click();await flush();
  assert.deepEqual(api.draft().states['open-transition'].automation,{});assert.equal(api.draft().states['open-transition'].wander,false);
  assert.equal(changes.at(-1),null);assert.equal(elements['wallpaper-editing'].hidden,true);
  await close(elements);
});

test('slow draft import blocks export and cancelled reads cannot replace a newer design',async()=>{
  const {elements,api}=setup();elements['open-wallpaper-export'].click();await flush();
  const original=api.draft().name;let release;
  const old=JSON.stringify({...api.draft(),name:'Slow A'});
  const pending=elements['wallpaper-draft-file'].onchange({target:{files:[{size:old.length,text:()=>new Promise(resolve=>{release=resolve;})}],value:'a'}});
  assert.equal(elements['wallpaper-cancel'].hidden,false);assert.equal(elements['wallpaper-cancel'].textContent,'Cancel import');
  const engineCount=engines.length;await elements['wallpaper-create'].onclick();assert.equal(engines.length,engineCount,'export must wait for draft loading');
  elements['wallpaper-cancel'].click();assert.equal(api.draft().name,original);
  const next=JSON.stringify({...api.draft(),name:'Newer B'});
  await elements['wallpaper-draft-file'].onchange({target:{files:[{size:next.length,text:async()=>next}],value:'b'}});
  release(old);await pending;await flush();
  assert.equal(api.draft().name,'Newer B');assert.equal(elements['wallpaper-cancel'].hidden,true);
  await close(elements);
});

test('closing the designer while a file is loading does not reopen it or replace the draft',async()=>{
  const {elements,api}=setup();elements['open-wallpaper-export'].click();await flush();
  const original=api.draft().name;let release;
  const imported=JSON.stringify({...api.draft(),name:'Late file'});
  const pending=elements['wallpaper-draft-file'].onchange({target:{files:[{size:imported.length,text:()=>new Promise(resolve=>{release=resolve;})}],value:'a'}});
  await close(elements);release(imported);await pending;await flush();
  assert.equal(elements['wallpaper-dialog'].open,false);assert.equal(api.draft().name,original);
  elements['open-wallpaper-export'].click();await flush();assert.equal(elements['wallpaper-dialog'].open,true);
  await close(elements);
});

test('custom bitrate remains locked while export is being prepared',async()=>{
  const oldVideo=globalThis.testVideo;let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const {elements}=setup();elements['open-wallpaper-export'].click();await flush();
  elements['wallpaper-quality'].value='custom';elements['wallpaper-bitrate'].value='40';elements['wallpaper-quality'].onchange();await flush();
  globalThis.testVideo={...oldVideo,supportsMP4:()=>gate};
  const job=elements['wallpaper-create'].onclick();await flush();
  try { assert.equal(elements['wallpaper-bitrate'].disabled,true,'in-flight export must keep custom bitrate locked'); }
  finally { elements['wallpaper-cancel'].click();release(true);await job;globalThis.testVideo=oldVideo;await close(elements); }
});
