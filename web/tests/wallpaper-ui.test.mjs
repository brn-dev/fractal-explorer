import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL, fileURLToPath} from 'node:url';
import { largeWallpaperDraft } from './wallpaper-fixtures.mjs';
import { createWallpaperURL, readWallpaperURL } from '../src/wallpaper-share.mjs';
const root = fileURLToPath(new URL('../src/', import.meta.url));
const {defaultWallpaperDraft, wallpaperSnapshot} = await import(pathToFileURL(root+'wallpaper.mjs'));
let source = await readFile(root+'wallpaper-ui.js','utf8');
source = source.replace("import { BrowserEngine } from './engine.js';", 'const BrowserEngine = globalThis.TestEngine;');
source = source.replace("import { openCurveEditor } from './curve-ui.js';", 'const openCurveEditor = options => { globalThis.testCurveEditor = options; };');
source = source.replace("await import('./video-export.js')", 'globalThis.testVideo');
source = source.replaceAll(/from '(\.\/[^']+)'/g, (_, p) => `from '${pathToFileURL(root+p).href}'`);
source = source.replace('return { openHandoff };', 'return { openHandoff, draft:()=>draft };');
let hold = null;
let slowRender = null;
const engines = [];
const renderedSizes = [];
globalThis.TestEngine = class {
  constructor() { this.destroyCalls=0; engines.push(this); }
  async gate(stage) { if (hold===stage) await new Promise((resolve,reject)=>{this.pending={resolve,reject};}); }
  async init() { await this.gate('init'); }
  async render(view,width,height,settings) { await this.gate('render'); slowRender?.(); renderedSizes.push([width,height]); return {metadata:{width,height,color_origin:0,view}}; }
  async readField() { return new Float32Array(1); }
  cancel() {}
  destroy() { this.destroyCalls++; this.destroyed=true; this.pending?.reject(new DOMException('cancel','AbortError')); }
};
class Element extends EventTarget {
  constructor(id) { super(); this.id=id; this.tag=id; this.children=[]; this.open=false; this.value=''; this.style={setProperty(){}};const classes=new Set();this.classList={toggle:(name,on)=>{if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() {}
  select() { this.selected=true; }
  setAttribute(name,value) { this[name]=String(value); }
  click() { this.onclick?.(); }
  querySelectorAll(selector) { const tags=selector.split(',').map(x=>x.trim()),out=[]; const walk=e=>{ for(const c of e.children){if(tags.includes(c.tag))out.push(c);walk(c);} }; walk(this); return out; }
  close() { if(this.open){this.open=false;setImmediate(()=>this.dispatchEvent(new Event('close')));} }
  showModal() { this.open=true; }
  scrollIntoView() {}
  getContext() { return this.context??= {globalAlpha:1,drawImage:(...args)=>{(this.draws??=[]).push(args);}}; }
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
  if (!globalThis.FractalNative) globalThis.window=new EventTarget();
  if(reset){const draft=defaultWallpaperDraft(wallpaperSnapshot(state,palettes));draft.states['open-steady'].view.x='-.12345';storage=JSON.stringify(draft);}
  const extra=['wallpaper-palettes','wallpaper-palette-count','wallpaper-entry-transition','wallpaper-entry-note','wallpaper-endpoints-note','wallpaper-arrival-note','wallpaper-steady-note','wallpaper-kind','wallpaper-static-note','wallpaper-download-image','wallpaper-device','wallpaper-gallery-screen','wallpaper-gallery-dialog','wallpaper-gallery-status','wallpaper-gallery-cards','open-wallpaper-gallery','wallpaper-gallery','wallpaper-gallery-new','wallpaper-gallery-set','wallpaper-replace-dialog','wallpaper-replace-continue','wallpaper-editing-help'];
  const elements=Object.fromEntries([...ids,...extra,'wallpaper-supersampling','wallpaper-gallery-shuffle','wallpaper-gallery-shuffle-options','wallpaper-gallery-shuffle-note','wallpaper-renderer-note','wallpaper-pc','wallpaper-pc-dialog','wallpaper-pc-link','wallpaper-pc-status','wallpaper-pc-summary','wallpaper-pc-copy','wallpaper-pc-share','wallpaper-pc-file'].map(id=>[id,new Element(id)]));
  const find=(node,id)=>node.id===id?node:node.children.map(child=>find(child,id)).find(Boolean);
  globalThis.document={hidden:false,getElementById:id=>elements[id]??Object.values(elements).map(node=>find(node,id)).find(Boolean),createElement:tag=>new Element(tag),addEventListener(){}};
  globalThis.location={href:'https://appassets.androidplatform.net/explorer/index.html'};
  const api=setupWallpaper({engine:{gpu:false,mobile:false},palettes,getState:()=>state,applyState(){},paint(){},downloadBlob(){},...overrides});
  return {elements,api};
}
async function close(elements){elements['wallpaper-dialog'].close();await flush();}

test('palette selection limits the batch, persists independently per screen and routes native creation to PC',async()=>{
  const options=[...palettes,...['A','B','C','D'].map((name,i)=>({name,colors:[`#00000${i}`,'#abcdef']}))];
  let packs=0;
  const {elements,api}=setup(true,{paletteOptions:options});
  try {
    elements['open-wallpaper-export'].click();await flush();
    const inputs=elements['wallpaper-palettes'].children.map(row=>row.children[0]);
    assert.equal(inputs[0].checked,true);assert.equal(inputs[0].disabled,true);
    for(const index of [1,2,3]){inputs[index].checked=true;inputs[index].onchange();}
    assert.deepEqual(api.draft().paletteVariants.map(p=>p.name),['A','B','C']);
    assert.equal(inputs[4].disabled,true);assert.match(elements['wallpaper-create'].textContent,/4 palette/);
    inputs[3].checked=false;inputs[3].onchange();assert.equal(inputs[4].disabled,false);
    elements['wallpaper-screen'].value='cover';elements['wallpaper-screen'].onchange();await flush();
    assert.equal(api.draft().paletteVariants,undefined);
    elements['wallpaper-screen'].value='inner';elements['wallpaper-screen'].onchange();await flush();
    assert.deepEqual(api.draft().paletteVariants.map(p=>p.name),['A','B']);
    globalThis.FractalNative={info(){},beginPack(){packs++;return '{"ok":true}';}};
    elements['wallpaper-create'].onclick();await flush();
    assert.equal(elements['wallpaper-pc-dialog'].open,true);assert.match(elements['wallpaper-pc-summary'].textContent,/3 palette variants/);assert.equal(packs,0);
  } finally {delete globalThis.FractalNative;elements['wallpaper-pc-dialog'].close();await close(elements);}
});

test('entry toggle hides start editing, preserves it for later and stays independent per screen',async()=>{
  const {elements,api}=setup();
  try {
    elements['open-wallpaper-export'].click();await flush();
    const before=structuredClone(api.draft());
    elements['wallpaper-entry-transition'].checked=false;elements['wallpaper-entry-transition'].onchange();await flush();
    assert.equal(api.draft().entryTransition,false);assert.equal(elements['wallpaper-state-cards'].children.length,1);
    assert.equal(elements['wallpaper-endpoints-note'].hidden,true);
    const buttons=elements['wallpaper-state-cards'].querySelectorAll('button');
    assert.ok(buttons.some(b=>b.textContent==='Edit steady scene'));assert.ok(!buttons.some(b=>b.textContent.includes('start')));
    assert.match(elements['wallpaper-encoding-note'].textContent,/Steady only/);
    assert.deepEqual(api.draft().states,before.states);assert.deepEqual(api.draft().transitions,before.transitions);
    buttons.find(b=>b.textContent==='Edit steady scene').click();assert.match(elements['wallpaper-editing-label'].textContent,/STEADY/);
    elements['wallpaper-overview'].click();
    elements['wallpaper-screen'].value='cover';elements['wallpaper-screen'].onchange();await flush();
    assert.equal(elements['wallpaper-entry-transition'].checked,true);
    elements['wallpaper-screen'].value='inner';elements['wallpaper-screen'].onchange();await flush();
    assert.equal(elements['wallpaper-entry-transition'].checked,false);
    elements['wallpaper-entry-transition'].checked=true;elements['wallpaper-entry-transition'].onchange();await flush();
    assert.equal(elements['wallpaper-state-cards'].children.length,2);assert.deepEqual(api.draft().states,before.states);
  }finally{await close(elements);}
});

test('native entry-free export encodes one steady clip per screen and retains its choice in the editor',async()=>{
  const clips=[],manifests=[],oldVideo=globalThis.testVideo;
  globalThis.window=new EventTarget();globalThis.FractalNative={info(){},beginPack:()=>'{"ok":true}',putPoster:()=>'{"ok":true}',commitPack:json=>{manifests.push(JSON.parse(json));return '{"ok":true}';}};
  globalThis.testVideo={async supportsMP4(){return true;},async mp4Encoder(canvas,plan){clips.push(plan.nativeTarget);return{async add(){},async finish(){},async cancel(){}};}};
  const {elements}=setup();
  try {
    elements['open-wallpaper-export'].click();await flush();
    for(const screen of ['inner','cover']) {
      elements['wallpaper-screen'].value=screen;elements['wallpaper-screen'].onchange();await flush();
      elements['wallpaper-entry-transition'].checked=false;elements['wallpaper-entry-transition'].onchange();await flush();
      elements['wallpaper-idle-seconds'].value='2';elements['wallpaper-idle-fps'].value='10';
      await elements['wallpaper-create'].onclick();
      assert.equal(manifests.at(-1).kind,'loop');assert.equal(manifests.at(-1).editor.entryTransition,false);
      assert.equal(Object.keys(manifests.at(-1).clips).length,1);assert.match(elements['wallpaper-status'].textContent,/without entry transition/);
    }
    assert.deepEqual(clips,['open-steady','closed-steady']);
  }finally{await close(elements);delete globalThis.FractalNative;globalThis.testVideo=oldVideo;}
});

test('static mode edits one still target scene and preserves animation settings when toggled back',async()=>{
  const applied=[],contexts=[];
  const {elements,api}=setup(true,{applyState:s=>applied.push(s),onSceneEditingChange:(slot,context)=>contexts.push({slot,context})});
  try {
    elements['open-wallpaper-export'].click();await flush();
    const original=structuredClone(api.draft());
    elements['wallpaper-kind'].value='static';elements['wallpaper-kind'].onchange();await flush();
    assert.equal(api.draft().kind,'static');assert.equal(elements['wallpaper-state-cards'].children.length,1);
    assert.equal(elements['wallpaper-preview-play'].hidden,true);assert.equal(elements['wallpaper-download-image'].hidden,false);
    assert.equal(elements['wallpaper-quality'].disabled,true);assert.equal(elements['wallpaper-dialog'].classList.contains('wallpaper-static'),true);
    elements['wallpaper-state-cards'].children[0].children[3].children[0].click();await flush();
    assert.equal(contexts.at(-1).context.static,true);assert.equal(contexts.at(-1).slot.key,'open-steady');
    assert.deepEqual(applied.at(-1).automation,{});assert.equal(applied.at(-1).wander,false);assert.equal(elements['wallpaper-save-state'].textContent,'Save image scene');
    elements['wallpaper-overview'].click();await flush();
    elements['wallpaper-kind'].value='animated';elements['wallpaper-kind'].onchange();await flush();
    assert.equal(elements['wallpaper-state-cards'].children.length,2);assert.deepEqual(api.draft().states,original.states);
    assert.deepEqual(api.draft().transitions,original.transitions);assert.equal(api.draft().idleSeconds,original.idleSeconds);
    assert.equal(elements['wallpaper-quality'].disabled,false);assert.equal(elements['wallpaper-download-image'].hidden,true);
  } finally {await close(elements);}
});

test('static browser export renders once without a codec and offers an editable ZIP or raw PNG',async()=>{
  const oldVideo=globalThis.testVideo,downloads=[];
  globalThis.testVideo={supportsMP4(){throw Error('must not probe video');},mp4Encoder(){throw Error('must not encode video');}};
  const {elements}=setup(true,{downloadBlob:async(blob,name)=>downloads.push({blob,name})});
  try {
    elements['open-wallpaper-export'].click();await flush();
    elements['wallpaper-kind'].value='static';elements['wallpaper-kind'].onchange();await flush();
    elements['wallpaper-size'].value='480';elements['wallpaper-supersampling'].value='2';
    const before=renderedSizes.length;await elements['wallpaper-create'].onclick();
    assert.equal(renderedSizes.length,before+1);assert.equal(downloads[0].name,'fractal-wallpaper.zip');
    const bytes=Buffer.from(await downloads[0].blob.arrayBuffer()),text=bytes.toString();
    assert.match(text,/inner-poster.png/);assert.match(text,/"kind":"static"/);assert.doesNotMatch(text,/\.mp4/);
    const end=bytes.length-22;assert.equal(bytes.readUInt16LE(end+10),2,'only PNG and editable manifest');
    await elements['wallpaper-download-image'].onclick();assert.equal(downloads[1].name,'inner-fractal-wallpaper.png');
    assert.equal(await downloads[1].blob.text(),'png');assert.match(elements['wallpaper-status'].textContent,/Import static image/);
  } finally {globalThis.testVideo=oldVideo;await close(elements);}
});

test('native static creation publishes one image and manifest, never video, for either screen',async()=>{
  const calls=[];
  globalThis.window=new EventTarget();
  globalThis.FractalNative={info:()=>'{"ok":true,"staticWallpapers":true}',beginPack:()=>{calls.push('begin');return '{"ok":true}';},putPoster:(screen)=>{calls.push(screen);return '{"ok":true}';},commitPack:json=>{calls.push(JSON.parse(json));return '{"ok":true}';}};
  const {elements}=setup();
  try {
    elements['open-wallpaper-export'].click();await flush();
    for(const screen of ['inner','cover']) {
      elements['wallpaper-screen'].value=screen;elements['wallpaper-screen'].onchange();await flush();
      elements['wallpaper-kind'].value='static';elements['wallpaper-kind'].onchange();await flush();
      elements['wallpaper-size'].value='480';assert.equal(elements['wallpaper-download-image'].hidden,true);
      await elements['wallpaper-create'].onclick();assert.equal(elements['wallpaper-apply'].hidden,false);
      const [begin,poster,manifest]=calls.splice(0);assert.equal(begin,'begin');assert.equal(poster,screen);assert.equal(manifest.kind,'static');assert.equal(manifest.screen,screen);assert.deepEqual(manifest.clips,{});
    }
  } finally {await close(elements);delete globalThis.FractalNative;}
});

test('PC device preset creates exact Fold dimensions and supplies them while editing both endpoints',async()=>{
  const changes=[];
  const {elements,api}=setup(true,{onSceneEditingChange:(slot,context)=>changes.push({key:slot?.key??null,context})});
  try {
    elements['open-wallpaper-export'].click();await flush();
    for(const [screen,size] of [['inner',{width:2256,height:2504}],['cover',{width:1080,height:2520}]]) {
      elements['wallpaper-screen'].value=screen;elements['wallpaper-screen'].onchange();await flush();
      elements['wallpaper-device'].value='fold8-ultra';elements['wallpaper-device'].onchange();await flush();
      assert.equal(api.draft().longest,'native');assert.equal(api.draft().displayProfile,'fold8-ultra');assert.deepEqual(api.draft().screenSizes[screen],size);
      assert.match(elements['wallpaper-resolution-note'].textContent,new RegExp(`${size.width} × ${size.height}`));
      for(const index of [0,1]) {
        elements['wallpaper-state-cards'].children[index].children[3].children[1].click();await flush();
        assert.deepEqual(changes.at(-1).context.target,size);
        elements['wallpaper-overview'].click();await flush();assert.equal(changes.at(-1).key,null);
      }
      elements['wallpaper-detect-resolution'].click();assert.equal(api.draft().displayProfile,'fold8-ultra','PC detect cannot replace the preset');
    }
  } finally {await close(elements);}
});

test('an explicit device preset survives native refresh; Detect resolution selects the current phone instead',async()=>{
  globalThis.window=new EventTarget();
  globalThis.FractalNative={info(){},wallpaperDisplays:()=>JSON.stringify({ok:true,screens:{inner:{width:1968,height:2184}}})};
  const {elements,api}=setup();
  try {
    elements['open-wallpaper-export'].click();await flush();
    elements['wallpaper-device'].value='fold8-ultra';elements['wallpaper-device'].onchange();await flush();
    window.dispatchEvent(new Event('wallpaper-displays-changed'));await flush();
    assert.deepEqual(api.draft().screenSizes.inner,{width:2256,height:2504});
    elements['wallpaper-detect-resolution'].click();await flush();
    assert.equal(api.draft().displayProfile,undefined);assert.equal(elements['wallpaper-device'].value,'auto');
    assert.deepEqual(api.draft().screenSizes.inner,{width:1968,height:2184});
  } finally {await close(elements);delete globalThis.FractalNative;}
});

test('PC handoff captures native dimensions and sampling without starting an export, and file matches link',async()=>{
  const downloads=[],shared=[];
  globalThis.window=new EventTarget();
  globalThis.FractalNative={info(){},wallpaperDisplays:()=>JSON.stringify({ok:true,screens:{inner:{width:2256,height:2504},cover:{width:1080,height:2520}}}),shareWallpaperLink:url=>{shared.push(url);return '{"ok":true}';}};
  const {elements}=setup(true,{downloadBlob:async(blob,name)=>{downloads.push({text:await blob.text(),name});}});
  try {
    elements['open-wallpaper-export'].click();await flush();
    elements['wallpaper-size'].value='native';elements['wallpaper-supersampling'].value='2';elements['wallpaper-name'].value='PC design';
    document.getElementById('wallpaper-open-transition-seconds').value='1.7';
    const count=engines.length;
    await elements['wallpaper-pc'].onclick();assert.equal(engines.length,count,'handoff must not create another renderer');
    assert.equal(engines.at(-1).destroyed,true,'phone preview stops during handoff');
    assert.equal(elements['wallpaper-pc-dialog'].open,true);assert.equal(elements['wallpaper-pc-share'].hidden,false);
    const url=elements['wallpaper-pc-link'].value,next=await readWallpaperURL(url);
    assert.equal(new URL(url).host,'brn-dev.github.io');assert.equal(next.name,'PC design');assert.equal(next.longest,'native');
    assert.deepEqual(next.screenSizes.inner,{width:2256,height:2504});assert.equal(next.supersampling,2);assert.equal(next.transitions['open-transition'].seconds,1.7);
    await elements['wallpaper-pc-share'].onclick();assert.deepEqual(shared,[url]);
    elements['wallpaper-name'].value='Changed after link';
    await elements['wallpaper-pc-file'].onclick();assert.equal(downloads[0].name,'fractal-wallpaper-inner-draft.json');assert.deepEqual(JSON.parse(downloads[0].text),next);
  } finally {elements['wallpaper-pc-dialog'].close();await close(elements);delete globalThis.FractalNative;}
});

test('a PC link asks before replacing an existing working draft and retains the phone pixels on PC',async()=>{
  const incoming=defaultWallpaperDraft(wallpaperSnapshot({...state,supersampling:2},palettes),'cover');
  incoming.name='From phone';incoming.longest='native';incoming.screenSizes={cover:{width:1080,height:2520}};
  const url=await createWallpaperURL('https://example.org/',incoming),{elements,api}=setup();
  const before=structuredClone(api.draft());
  try {
    assert.equal(await api.openHandoff(url),true);assert.deepEqual(api.draft(),before);assert.equal(elements['wallpaper-replace-dialog'].open,true);
    elements['wallpaper-replace-continue'].click();await flush();
    assert.equal(elements['wallpaper-dialog'].open,true);assert.equal(api.draft().name,'From phone');assert.equal(api.draft().screen,'cover');
    assert.deepEqual(api.draft().screenSizes,{cover:{width:1080,height:2520}});assert.equal(api.draft().supersampling,2);assert.equal(elements['wallpaper-size'].value,'native');
    const saved=structuredClone(api.draft());await assert.rejects(api.openHandoff('https://example.org/#w=g1.broken'),/Could not open/);assert.deepEqual(api.draft(),saved);
    assert.equal(await api.openHandoff('https://example.org/'),false);
  } finally {await close(elements);}
});

test('a superseded PC link read leaves the working draft and replacement prompt untouched',async()=>{
  const incoming=defaultWallpaperDraft(wallpaperSnapshot(state,palettes),'inner');incoming.name='Outdated request';
  const {elements,api}=setup(),before=structuredClone(api.draft());
  try {
    assert.equal(await api.openHandoff(await createWallpaperURL('https://example.org/',incoming),{isCurrent:()=>false}),false);
    assert.deepEqual(api.draft(),before);assert.equal(elements['wallpaper-replace-dialog'].open,false);
  } finally {await close(elements);}
});

test('a PC link confirmation cannot replace a draft after navigation makes its request stale',async()=>{
  const incoming=defaultWallpaperDraft(wallpaperSnapshot(state,palettes),'inner');incoming.name='Stale confirmation';
  const {elements,api}=setup(),before=structuredClone(api.draft());let current=true;
  try {
    await api.openHandoff(await createWallpaperURL('https://example.org/',incoming),{isCurrent:()=>current});
    assert.equal(elements['wallpaper-replace-dialog'].open,true);
    current=false;window.dispatchEvent(new Event('hashchange'));
    assert.equal(elements['wallpaper-replace-dialog'].open,false);
    elements['wallpaper-replace-continue'].click();assert.deepEqual(api.draft(),before);
  } finally {await close(elements);}
});

test('a phone design renders on PC into a portable ZIP at the phone output size and sampling',async()=>{
  const incoming=defaultWallpaperDraft(wallpaperSnapshot({...state,supersampling:2},palettes),'inner');
  incoming.name='PC exported';incoming.longest='native';incoming.screenSizes={inner:{width:2256,height:2504}};
  incoming.transitions['open-transition'].seconds=.5;incoming.idleSeconds=2;incoming.idleFps=10;
  const oldVideo=globalThis.testVideo,outputs=[];let downloaded;
  const {elements,api}=setup(true,{engine:{gpu:true,mobile:false},downloadBlob:async(blob)=>{downloaded=blob;}});
  globalThis.testVideo={async supportsMP4(){return true;},async mp4Encoder(canvas,plan){outputs.push(plan);return {async add(){},async finish(){return new Blob(['mp4']);},async cancel(){}};}};
  try {
    await api.openHandoff(await createWallpaperURL('https://example.org/',incoming));elements['wallpaper-replace-continue'].click();await flush();
    renderedSizes.length=0;await elements['wallpaper-create'].onclick();
    assert.equal(outputs.length,2);assert.ok(outputs.every(p=>p.width===2256&&p.height===2504&&p.supersampling===2));
    assert.ok(renderedSizes.length>0);assert.ok(renderedSizes.every(([w,h])=>w===4512&&h===5008));
    const bytes=new Uint8Array(await downloaded.arrayBuffer()),data=new DataView(bytes.buffer),files=new Map();let at=0;
    while(data.getUint32(at,true)===0x04034b50) {
      const size=data.getUint32(at+18,true),names=data.getUint16(at+26,true),extra=data.getUint16(at+28,true),start=at+30+names+extra;
      files.set(new TextDecoder().decode(bytes.subarray(at+30,at+30+names)),bytes.slice(start,start+size));at=start+size;
    }
    assert.deepEqual([...files.keys()].sort(),['inner-arrival.mp4','inner-idle.mp4','inner-poster.png','wallpaper.json']);
    const manifest=JSON.parse(new TextDecoder().decode(files.get('wallpaper.json')));
    assert.equal(manifest.screen,'inner');assert.equal(manifest.editor.supersampling,2);assert.deepEqual(manifest.editor.screenSizes,incoming.screenSizes);
    assert.match(elements['wallpaper-status'].textContent,/Import wallpaper package/);
  } finally {globalThis.testVideo=oldVideo;await close(elements);}
});

test('wallpaper export reports the actual CQ or VBR fallback without rewriting the selected dynamic preset',async()=>{
  const oldVideo=globalThis.testVideo;
  globalThis.testVideo={async supportsMP4(){return true;},async mp4Encoder(canvas,plan){return {encodingInfo:plan.transition?{qualityMode:'dynamic-vbr',bitrate:30000000}:{qualityMode:'dynamic-quantizer',quantizer:22,bitrate:null},async add(){},async finish(){return new Blob(['mp4']);},async cancel(){}};}};
  const {elements,api}=setup();
  try {
    elements['open-wallpaper-export'].click();await flush();assert.equal(api.draft().quality,'dynamic-high');
    document.getElementById('wallpaper-open-transition-seconds').value='.5';elements['wallpaper-idle-seconds'].value='2';elements['wallpaper-idle-fps'].value='10';
    await elements['wallpaper-create'].onclick();
    assert.match(elements['wallpaper-encoding-note'].textContent,/Transition: variable bitrate.*30.0 Mbps.*fallback.*Steady: constant quality.*QP 22/);
    assert.match(elements['wallpaper-encoding-note'].textContent,/file average/);
    assert.equal(api.draft().quality,'dynamic-high');
    elements['wallpaper-quality'].value='maximum';elements['wallpaper-quality'].onchange();await flush();assert.equal(api.draft().quality,'maximum');
  } finally {globalThis.testVideo=oldVideo;await close(elements);}
});

test('capturing a scene inherits explorer sampling and export downsamples before encoding',async()=>{
  let applied; const outputs=[],painted=[],oldVideo=globalThis.testVideo;
  const {elements,api}=setup(true,{getState:()=>({...state,supersampling:2}),applyState:value=>{applied=value;},paint(canvas,values,metadata){canvas.width=metadata.width;canvas.height=metadata.height;painted.push([metadata.width,metadata.height]);}});
  globalThis.testVideo={async supportsMP4(){return true;},async mp4Encoder(canvas,plan){outputs.push({canvas,plan});return {async add(){},async finish(){return new Blob(['mp4']);},async cancel(){}};}};
  try {
    elements['open-wallpaper-export'].click();await flush();
    elements['wallpaper-state-cards'].children[1].children[3].children[2].click();await flush();
    assert.equal(api.draft().supersampling,2);assert.equal(Number(elements['wallpaper-supersampling'].value),2);
    elements['wallpaper-state-cards'].children[1].children[3].children[1].click();assert.equal(applied.supersampling,2);
    elements['wallpaper-overview'].click();await flush();
    document.getElementById('wallpaper-open-transition-seconds').value='.5';
    elements['wallpaper-idle-seconds'].value='2';elements['wallpaper-idle-fps'].value='10';
    renderedSizes.length=0;painted.length=0;
    await elements['wallpaper-create'].onclick();
    assert.equal(outputs.length,2);
    const {canvas,plan}=outputs[0];assert.deepEqual([canvas.width,canvas.height],[plan.width,plan.height]);
    assert.ok(renderedSizes.length>0);assert.ok(renderedSizes.every(([w,h])=>w===plan.width*2&&h===plan.height*2));
    assert.ok(painted.every(([w,h])=>w===plan.width*2&&h===plan.height*2));
    assert.ok(canvas.draws.length>0);assert.ok(canvas.draws.every(args=>args[3]===plan.width&&args[4]===plan.height));
    assert.equal(canvas.context.imageSmoothingQuality,'high');
  } finally {globalThis.testVideo=oldVideo;await close(elements);}
});

test('unsupported supersampling fails before encoding and retains the requested factor',async()=>{
  const oldVideo=globalThis.testVideo;let encoders=0;
  const {elements,api}=setup();
  Object.defineProperty(TestEngine.prototype,'renderLimits',{configurable:true,get:()=>({maxDimension:4096,maxPixels:16000000})});
  globalThis.testVideo={async supportsMP4(){return true;},async mp4Encoder(){encoders++;throw new Error('must not start');}};
  try {
    elements['open-wallpaper-export'].click();await flush();
    elements['wallpaper-supersampling'].value='4';elements['wallpaper-supersampling'].onchange();await flush();
    await elements['wallpaper-create'].onclick();
    assert.match(elements['wallpaper-status'].textContent,/4× supersampling.*exceeds/);
    assert.equal(encoders,0);assert.equal(api.draft().supersampling,4);
  } finally {delete TestEngine.prototype.renderLimits;globalThis.testVideo=oldVideo;await close(elements);}
});

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
    elements['wallpaper-gallery-cards'].children[0].children[1].children[2].children.find(button=>button.textContent==='Edit design').click();
    elements['wallpaper-replace-continue'].click(); await flush();
    assert.equal(api.draft().screen,'inner'); assert.deepEqual(api.draft().states['open-steady'],saved.states['open-steady']); assert.equal(Object.keys(api.draft().states).length,2); assert.equal(elements['wallpaper-name'].value,'Saved original');
    api.draft().states['open-steady'].view.x='-.9';
    assert.equal(saved.states['open-steady'].view.x,'-.4321');
  } finally {await close(elements);delete globalThis.FractalNative;}
});

test('duplicate protects the working draft until confirmation and creates a separate static/animated variation',async()=>{
  for(const [screen,kind] of [['cover','animated'],['inner','static']]) {
    const saved=defaultWallpaperDraft(wallpaperSnapshot(state,palettes));saved.name='Original';saved.kind=kind;
    saved.transitions={'open-transition':{seconds:.5,easing:'linear'},'closed-transition':{seconds:.5,easing:'ease-out'}};saved.idleSeconds=2;saved.idleFps=10;saved.longest=480;
    const original=structuredClone(saved),calls=[],committed=[];
    globalThis.window=new EventTarget();
    globalThis.FractalNative={info:()=>'{"ok":true,"staticWallpapers":true}',
      listWallpapers:()=>JSON.stringify({ok:true,wallpapers:[{id:'original',name:saved.name,kind,bytes:123,active:true,editable:true}]}),
      wallpaperDraft:()=>JSON.stringify({ok:true,draft:saved}),
      beginPack(){calls.push('begin');return '{"ok":true}';},putPoster(){calls.push('poster');return '{"ok":true}';},
      commitPack(json){committed.push(JSON.parse(json));calls.push('commit');return '{"ok":true}';},
    };
    const {elements,api}=setup();
    try {
      elements['open-wallpaper-export'].click();await flush();const working=structuredClone(api.draft());
      elements['wallpaper-gallery'].click();elements['wallpaper-gallery-screen'].value=screen;elements['wallpaper-gallery-screen'].onchange();
      const duplicate=()=>elements['wallpaper-gallery-cards'].children[0].children[1].children[2].children.find(button=>button.textContent==='Duplicate & edit').click();
      duplicate();assert.equal(elements['wallpaper-replace-dialog'].open,true);assert.deepEqual(api.draft(),working);
      elements['wallpaper-replace-dialog'].close();await flush();assert.deepEqual(api.draft(),working);assert.deepEqual(calls,[]);
      duplicate();elements['wallpaper-replace-continue'].click();await flush();
      assert.equal(api.draft().screen,screen);assert.equal(api.draft().kind,kind);assert.equal(api.draft().name,'Original (copy)');
      const prefix=screen==='cover'?'closed':'open';assert.equal(Object.keys(api.draft().states).length,2);
      assert.deepEqual(api.draft().states[`${prefix}-steady`],saved.states[`${prefix}-steady`]);
      assert.equal(api.draft().transitions[`${prefix}-transition`].easing,screen==='cover'?'ease-out':'linear');
      assert.equal(elements['wallpaper-apply'].hidden,true);assert.match(elements['wallpaper-status'].textContent,/Editing a copy.*original is kept/);assert.deepEqual(calls,[]);
      api.draft().states[`${prefix}-steady`].colors.definition.colors=['#010203','#203040','#010203'];
      await elements['wallpaper-create'].onclick();
      assert.equal(committed.length,1);assert.equal(committed[0].screen,screen);assert.equal(committed[0].editor.name,'Original (copy)');
      assert.deepEqual(committed[0].editor.states[`${prefix}-steady`].colors.definition.colors,['#010203','#203040','#010203']);
      assert.deepEqual(saved,original,'the saved source is retained after editing/rendering its copy');
    } finally {await close(elements);delete globalThis.FractalNative;}
  }
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

test('copy start to end replaces either screen independently and the copied geometry can be edited separately',async()=>{
  const {elements,api}=setup();elements['open-wallpaper-export'].click();await flush();
  try {
    for(const [screen,prefix]of [['inner','open'],['cover','closed']]) {
      elements['wallpaper-screen'].value=screen;elements['wallpaper-screen'].onchange();await flush();
      const from=api.draft().states[`${prefix}-transition`];from.automation={iterations:{enabled:true,target:'200',speed:.25,shape:'sine'}};
      const before=structuredClone(from);
      const startCard=elements['wallpaper-state-cards'].children[0],copy=startCard.children[3].children[3];
      assert.equal(copy.textContent,'Copy start → end');copy.click();await flush();
      const end=api.draft().states[`${prefix}-steady`];assert.deepEqual(end.view,before.view);assert.deepEqual(end.settings,before.settings);
      assert.deepEqual(end.automation,{},'ignored start motion must not become a steady loop');
      assert.match(elements['wallpaper-state-cards'].children[1].children[2].textContent,/color loop/);
      assert.deepEqual(api.draft().states[`${prefix}-transition`],before);
      assert.notEqual(end.view,api.draft().states[`${prefix}-transition`].view);
      end.view.x='.123';assert.equal(api.draft().states[`${prefix}-transition`].view.x,before.view.x);
      assert.match(elements['wallpaper-preview-status'].textContent,/copied END/);
      const {wallpaperPlan}=await import(pathToFileURL(root+'wallpaper.mjs')),plans=wallpaperPlan(api.draft());
      assert.deepEqual(plans[0].sample(plans[0].frames-1).view,plans[1].sample(0).view);
    }
    elements['wallpaper-screen'].value='inner';elements['wallpaper-screen'].onchange();await flush();
    assert.equal(api.draft().states['open-steady'].view.x,'.123','copying cover must not replace the main draft');
  } finally {await close(elements);}
});

test('copy end to start preserves the source loop but strips motion from the copied start',async()=>{
  const {elements,api}=setup();elements['open-wallpaper-export'].click();await flush();
  try {
    const draft=api.draft(),end=draft.states['open-steady'];end.view.fractal='julia';end.settings={arithmetic:'double-single'};
    end.automation={julia_x:{enabled:true,target:'-.7',speed:.25,shape:'sine'}};end.wander=true;
    const before=structuredClone(end),options={quality:draft.quality,supersampling:draft.supersampling,transitions:structuredClone(draft.transitions),colorSeconds:draft.colorSeconds,colorWander:draft.colorWander};
    const copy=elements['wallpaper-state-cards'].children[1].children[3].children[3];assert.equal(copy.textContent,'Copy end → start');copy.click();await flush();
    const next=api.draft(),start=next.states['open-transition'];assert.deepEqual(start.view,before.view);assert.deepEqual(start.settings,before.settings);
    assert.deepEqual(start.automation,{});assert.equal(start.wander,false);assert.deepEqual(next.states['open-steady'],before);
    assert.deepEqual({quality:next.quality,supersampling:next.supersampling,transitions:next.transitions,colorSeconds:next.colorSeconds,colorWander:next.colorWander},options);
    start.view.x='.25';assert.equal(next.states['open-steady'].view.x,before.view.x);
    assert.match(elements['wallpaper-status'].textContent,/end \/ steady.*start/);assert.match(elements['wallpaper-preview-status'].textContent,/copied START/);
  } finally {await close(elements);}
});

test('copying is blocked during export setup even if a stale click is delivered',async()=>{
  const {elements,api}=setup();elements['open-wallpaper-export'].click();await flush();
  elements['wallpaper-dialog'].append(elements['wallpaper-state-cards']);
  const oldVideo=globalThis.testVideo;let release;
  try {
    const before=structuredClone(api.draft().states);
    const gate=new Promise(resolve=>{release=resolve;});globalThis.testVideo={...oldVideo,supportsMP4:()=>gate};
    const job=elements['wallpaper-create'].onclick();await flush();
    const copy=elements['wallpaper-state-cards'].children[0].children[3].children[3];assert.equal(copy.disabled,true);copy.click();assert.deepEqual(api.draft().states,before);
    elements['wallpaper-cancel'].click();release(true);await job;
  } finally {release?.(true);globalThis.testVideo=oldVideo;await close(elements);}
});

test('copying over a rendered endpoint invalidates Apply and requests new rendering',async()=>{
  globalThis.window=new EventTarget();
  globalThis.FractalNative={info(){},beginPack:()=>'{"ok":true}',putPoster:()=>'{"ok":true}',commitPack:()=>'{"ok":true}'};
  const {elements}=setup();elements['open-wallpaper-export'].click();await flush();
  try {
    document.getElementById('wallpaper-open-transition-seconds').value='.5';elements['wallpaper-idle-seconds'].value='2';elements['wallpaper-idle-fps'].value='10';
    await elements['wallpaper-create'].onclick();assert.equal(elements['wallpaper-apply'].hidden,false);
    elements['wallpaper-state-cards'].children[0].children[3].children[3].click();await flush();
    assert.equal(elements['wallpaper-apply'].hidden,true);assert.match(elements['wallpaper-status'].textContent,/Create the wallpaper again/);
  } finally {await close(elements);delete globalThis.FractalNative;}
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

test('custom motion edits survive unchanged option refresh, persist through timing edits and cancel safely',async()=>{
  const {elements,api}=setup();elements['open-wallpaper-export'].onclick();await flush();
  const select=document.getElementById('wallpaper-open-transition-easing');select.value='custom';select.onchange();
  assert.equal(select.value,'ease-out');assert.equal(globalThis.testCurveEditor.mode,'transition');
  assert.equal(globalThis.testCurveEditor.presets.length,4);
  const spec=globalThis.testCurveEditor.presets[1].curve();
  // Browser blur can re-read identical settings after the modal opens.
  elements['wallpaper-name'].onchange();await flush();
  globalThis.testCurveEditor.onApply({curve:spec});await flush();
  assert.equal(api.draft().transitions['open-transition'].easing,'custom');
  assert.deepEqual(api.draft().transitions['open-transition'].curve,spec);
  assert.equal(document.getElementById('wallpaper-open-transition-curve-edit').hidden,false);
  const duration=document.getElementById('wallpaper-open-transition-seconds');duration.value='1.1';duration.onchange();await flush();
  assert.deepEqual(api.draft().transitions['open-transition'],{seconds:1.1,easing:'custom',curve:spec});
  select.value='linear';select.onchange();await flush();select.value='custom';select.onchange();globalThis.testCurveEditor.onCancel();
  assert.equal(select.value,'linear');assert.equal(api.draft().transitions['open-transition'].easing,'linear');
  select.value='custom';select.onchange();elements['wallpaper-name'].value='Changed elsewhere';elements['wallpaper-name'].onchange();await flush();
  assert.throws(()=>globalThis.testCurveEditor.onApply({curve:spec}),/wallpaper changed/);
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
