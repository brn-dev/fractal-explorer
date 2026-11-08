import test from 'node:test';
import assert from 'node:assert/strict';
import { setupWallpaperGallery } from '../src/wallpaper-gallery.js';

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.hidden = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  close() { this.open = false; }
  showModal() { this.open = true; }
  focus() { this.focused = true; }
  click() { if (!this.disabled) this.onclick?.(); }
}
function setup({ pending = false, allowed = true } = {}) {
  const ids = ['wallpaper-gallery-screen', 'wallpaper-gallery-dialog', 'wallpaper-gallery-status', 'wallpaper-gallery-cards', 'export-dialog', 'open-wallpaper-gallery', 'wallpaper-gallery', 'wallpaper-gallery-new', 'wallpaper-gallery-set'];
  const elements = Object.fromEntries([...ids,'wallpaper-gallery-shuffle','wallpaper-gallery-shuffle-options','wallpaper-gallery-shuffle-note','wallpaper-gallery-sun-note'].map(id => [id, new Element(id)]));
  const entries = [{id:'a',name:'A',bytes:2048,active:true,editable:true}, {id:'b',name:'<B>',bytes:4096,active:false,editable:false}];
  const calls = [], draft = {name:'A',states:{}};
  globalThis.window = new EventTarget(); window.fractalGalleryRequested = pending;
  globalThis.document = new EventTarget(); document.getElementById = id => elements[id]; document.createElement = tag => new Element(tag);
  const reply = value => JSON.stringify({ok:true,...value});
  globalThis.FractalNative = {
    info() {}, listWallpapers() { return reply({wallpapers:entries}); },
    wallpaperThumbnailForScreen(id,screen) { return reply({image:`data:image/png;base64,${id}`}); },
    wallpaperDraft(id) { calls.push(['draft',id]); return reply({draft}); },
    applyWallpaperScreen(id,screen) { calls.push(['apply',id,screen]); for(const entry of entries) entry.active = entry.id === id; return reply(); },
    renameWallpaper(id,name) { calls.push(['rename',id,name]); entries.find(e=>e.id===id).name = name; return reply(); },
    deleteWallpaper(id) { calls.push(['delete',id]); entries.splice(entries.findIndex(e=>e.id===id),1); return reply(); },
    openWallpaperPicker() { calls.push(['picker']); return reply(); },
  };
  setupWallpaperGallery({canOpen:()=>allowed,newWallpaper:screen=>calls.push(['new',screen]),editWallpaper:(value,screen,options)=>calls.push(options?['edit',value,screen,options]:['edit',value,screen]),beforeOpen:()=>calls.push(['before'])});
  const cards = () => elements['wallpaper-gallery-cards'].children;
  const content = i => cards()[i].children[1];
  const actions = i => content(i).children[2].children;
  const cleanup = () => { delete globalThis.FractalNative; };
  return {elements,entries,calls,draft,cards,content,actions,cleanup};
}
test('gallery applies saved videos without requesting a render and protects the active entry',()=>{
  const t = setup(); try {
    t.elements['open-wallpaper-gallery'].click();
    assert.equal(t.cards().length,2); assert.equal(t.actions(0)[0].disabled,true); assert.equal(t.actions(0)[4].disabled,true);
    assert.equal(t.content(1).children[0].textContent,'<B>');
    assert.equal(t.actions(1)[1].disabled,true);
    t.actions(1)[0].click();
    assert.equal(t.actions(1)[0].disabled,true); assert.equal(t.actions(0)[0].disabled,false);
    assert.deepEqual(t.calls.filter(c=>c[0]==='apply'),[['apply','b','inner']]);
    assert.match(t.elements['wallpaper-gallery-status'].textContent,/selected/);
  } finally {t.cleanup();}
});

test('gallery labels raw and editable static images and applies them alongside animated entries',()=>{
  const t=setup();try {
    t.entries[1].kind='static';
    t.elements['open-wallpaper-gallery'].click();
    assert.match(t.content(0).children[1].textContent,/Animated/);
    assert.match(t.content(1).children[1].textContent,/Static image.*imported image/);
    assert.equal(t.actions(1)[1].disabled,true);
    t.actions(1)[0].click();assert.deepEqual(t.calls.at(-1),['apply','b','inner']);
    t.entries[1].editable=true;t.elements['open-wallpaper-gallery'].click();
    assert.doesNotMatch(t.content(1).children[1].textContent,/imported image/);
    t.actions(1)[1].click();assert.deepEqual(t.calls.at(-1),['edit',t.draft,'inner']);
  } finally {t.cleanup();}
});

test('duplicate opens a detached named variation without changing native entries or the current selection',()=>{
  const t=setup();try {
    t.draft.states={steady:{colors:{definition:{colors:['#000000','#ffffff']}}}};
    t.entries.push({id:'c',name:'A (copy)',screen:'inner',editable:true,bytes:123});
    t.entries.push({id:'d',name:'A (copy 2)',screen:'cover',editable:true,bytes:123});
    const saved=structuredClone(t.draft),entries=structuredClone(t.entries);
    t.elements['open-wallpaper-gallery'].click();t.actions(0)[2].click();
    const [action,next,screen,options]=t.calls.at(-1);
    assert.equal(action,'edit');assert.equal(screen,'inner');assert.deepEqual(options,{copyOf:'A'});
    assert.equal(next.name,'A (copy 2)');assert.deepEqual(next.states,saved.states);
    next.states.steady.colors.definition.colors[1]='#112233';
    assert.deepEqual(t.draft,saved);assert.deepEqual(t.entries,entries);
    assert.deepEqual(t.calls.map(c=>c[0]),['before','draft','edit']);
    assert.equal(t.actions(1)[2].disabled,true,'pixel/video-only imports have no design to modify');
  } finally {t.cleanup();}
});

test('duplicate uses the current gallery name within the name limit, and read failures preserve the gallery',()=>{
  const t=setup();try {
    t.entries[0].name='Renamed '+ 'a'.repeat(72);
    t.elements['open-wallpaper-gallery'].click();t.actions(0)[2].click();
    const next=t.calls.at(-1)[1];assert.equal(next.name.length,80);assert.ok(next.name.endsWith(' (copy)'));assert.ok(next.name.startsWith('Renamed '));
    FractalNative.wallpaperDraft=()=>'{"ok":false,"error":"Cannot read saved design"}';
    t.actions(0)[2].click();assert.equal(t.elements['wallpaper-gallery-status'].textContent,'Cannot read saved design');
    assert.equal(t.entries[0].active,true);assert.equal(t.cards().length,2);
  } finally {t.cleanup();}
});
test('gallery renames safely, restores editable designs, and requires explicit deletion',()=>{
  const t = setup(); try {
    t.elements['open-wallpaper-gallery'].click(); t.actions(0)[1].click();
    assert.deepEqual(t.calls.at(-1),['edit',t.draft,'inner']);
    t.actions(1)[3].click(); const rename = t.content(1).children[3];
    assert.equal(rename.hidden,false); rename.children[0].children[0].value = 'Renamed'; rename.children[1].click();
    assert.equal(t.content(1).children[0].textContent,'Renamed');
    t.actions(1)[4].click(); const confirm = t.content(1).children[4];
    assert.equal(confirm.hidden,false); assert.equal(t.entries.length,2);
    confirm.children[2].click(); assert.equal(confirm.hidden,true); assert.equal(t.entries.length,2);
    t.actions(1)[4].click(); confirm.children[1].click();
    assert.equal(t.entries.length,1); assert.equal(t.entries[0].id,'a');
  } finally {t.cleanup();}
});
test('native failures leave the collection intact and show the reason',()=>{
  const t = setup(); try {
    t.elements['open-wallpaper-gallery'].click();
    FractalNative.applyWallpaperScreen = () => JSON.stringify({ok:false,error:'Import still running'});
    t.actions(1)[0].click();
    assert.equal(t.entries[0].active,true); assert.equal(t.cards().length,2);
    assert.equal(t.elements['wallpaper-gallery-status'].textContent,'Import still running');
  } finally {t.cleanup();}
});

test('gallery opening errors appear in a visible dialog',()=>{
  const t = setup(); try {
    FractalNative.listWallpapers = () => JSON.stringify({ok:false,error:'Cannot read wallpaper gallery'});
    t.elements['export-dialog'].open = true;
    t.elements['open-wallpaper-gallery'].click();
    assert.equal(t.elements['wallpaper-gallery-dialog'].open,true);
    assert.equal(t.elements['export-dialog'].open,false);
    assert.equal(t.elements['wallpaper-gallery-status'].textContent,'Cannot read wallpaper gallery');
  } finally {t.cleanup();}
});
test('a cold-start native gallery request survives asynchronous app startup',()=>{
  const t = setup({pending:true}); try {
    assert.equal(t.elements['wallpaper-gallery-dialog'].open,true); assert.equal(window.fractalGalleryRequested,false);
    t.elements['wallpaper-gallery-new'].click(); assert.deepEqual(t.calls.at(-1),['new','inner']);
    t.elements['wallpaper-gallery-set'].click(); assert.deepEqual(t.calls.at(-1),['picker']);
  } finally {t.cleanup();}
});

test('gallery selects each screen separately and protects a combined design still used by the other screen',()=>{
  const t=setup();try {
    const selected={cover:'a',inner:'a'};
    t.entries.push({id:'c',name:'Cover only',screen:'cover',bytes:2048,editable:true});
    FractalNative.listWallpapers=()=>JSON.stringify({ok:true,wallpapers:t.entries.map(entry=>({...entry,activeCover:selected.cover===entry.id,activeInner:selected.inner===entry.id,active:Object.values(selected).includes(entry.id)}))});
    FractalNative.applyWallpaperScreen=(id,screen)=>{selected[screen]=id;return '{"ok":true}';};
    t.elements['open-wallpaper-gallery'].click();assert.equal(t.cards().length,2);
    t.actions(1)[0].click();assert.deepEqual(selected,{cover:'a',inner:'b'});
    assert.equal(t.actions(0)[4].disabled,true,'a is still used by cover');
    t.elements['wallpaper-gallery-screen'].value='cover';t.elements['wallpaper-gallery-screen'].onchange();
    assert.equal(t.cards().length,3);assert.equal(t.actions(0)[0].disabled,true);
    t.actions(2)[0].click();assert.deepEqual(selected,{cover:'c',inner:'b'});
    t.actions(2)[1].click();assert.deepEqual(t.calls.at(-1),['edit',t.draft,'cover']);
    t.elements['wallpaper-gallery-new'].click();assert.deepEqual(t.calls.at(-1),['new','cover']);
  } finally {t.cleanup();}
});
test('gallery stays unavailable while wallpaper rendering is in progress',()=>{
  const t = setup({allowed:false}); try {
    t.elements['open-wallpaper-gallery'].click(); assert.notEqual(t.elements['wallpaper-gallery-dialog'].open,true); assert.equal(t.calls.length,0);
  } finally {t.cleanup();}
});

test('shuffle membership and enablement are independent per screen, and Use only this disables it',()=>{
  const t=setup();try {
    const pools={cover:{enabled:false,ids:[]},inner:{enabled:false,ids:[]}};
    const list=FractalNative.listWallpapers,apply=FractalNative.applyWallpaperScreen;
    FractalNative.listWallpapers=()=>JSON.stringify({...JSON.parse(list()),shuffle:pools});
    FractalNative.setWallpaperShuffle=(screen,json,enabled)=>{pools[screen]={enabled,ids:JSON.parse(json)};return '{"ok":true}';};
    FractalNative.applyWallpaperScreen=(id,screen)=>{pools[screen].enabled=false;return apply(id,screen);};
    // Set up again so capability detection sees the current bridge.
    setupWallpaperGallery({canOpen:()=>true,newWallpaper(){},editWallpaper(){},beforeOpen(){}});
    t.elements['open-wallpaper-gallery'].click();
    const member=i=>t.content(i).children[5].children[0];
    member(0).checked=true;member(0).onchange();member(1).checked=true;member(1).onchange();
    assert.deepEqual(pools.inner,{enabled:false,ids:['a','b']});
    const toggle=t.elements['wallpaper-gallery-shuffle'];toggle.checked=true;toggle.onchange();
    assert.equal(pools.inner.enabled,true);assert.equal(t.actions(0)[0].disabled,false);
    assert.equal(t.actions(0)[0].textContent,'Use only this');assert.equal(t.actions(1)[4].disabled,true);
    t.elements['wallpaper-gallery-screen'].value='cover';t.elements['wallpaper-gallery-screen'].onchange();
    assert.equal(toggle.checked,false);assert.equal(toggle.disabled,true);assert.equal(member(0).checked,false);
    member(1).checked=true;member(1).onchange();toggle.checked=true;toggle.onchange();
    assert.deepEqual(pools.cover,{enabled:true,ids:['b']});assert.deepEqual(pools.inner.ids,['a','b']);
    member(1).checked=false;member(1).onchange();assert.deepEqual(pools.cover,{enabled:false,ids:[]});
    t.elements['wallpaper-gallery-screen'].value='inner';t.elements['wallpaper-gallery-screen'].onchange();
    t.actions(0)[0].click();assert.equal(pools.inner.enabled,false);assert.deepEqual(pools.inner.ids,['a','b']);
  } finally {t.cleanup();}
});

test('failed shuffle writes restore controls from native state and show the failure',()=>{
  const t=setup();try {
    FractalNative.setWallpaperShuffle=()=>'{"ok":false,"error":"Storage full"}';
    FractalNative.listWallpapers=()=>JSON.stringify({ok:true,wallpapers:t.entries,shuffle:{inner:{enabled:true,ids:['a']}}});
    setupWallpaperGallery({canOpen:()=>true,newWallpaper(){},editWallpaper(){},beforeOpen(){}});
    t.elements['open-wallpaper-gallery'].click();
    const toggle=t.elements['wallpaper-gallery-shuffle'];toggle.checked=false;toggle.onchange();
    assert.equal(toggle.checked,true);assert.equal(t.elements['wallpaper-gallery-status'].textContent,'Storage full');
    const member=t.content(1).children[5].children[0];member.checked=true;member.onchange();
    assert.equal(t.content(1).children[5].children[0].checked,false);
  } finally {t.cleanup();}
});

test('an enabled pool with unavailable entries can still be switched off',()=>{
  const t=setup();try {
    let pool={enabled:true,ids:['missing']};
    FractalNative.setWallpaperShuffle=(screen,json,enabled)=>{pool={enabled,ids:JSON.parse(json)};return '{"ok":true}';};
    FractalNative.listWallpapers=()=>JSON.stringify({ok:true,wallpapers:t.entries,shuffle:{inner:pool}});
    setupWallpaperGallery({canOpen:()=>true,newWallpaper(){},editWallpaper(){},beforeOpen(){}});
    t.elements['open-wallpaper-gallery'].click();
    const toggle=t.elements['wallpaper-gallery-shuffle'];assert.equal(toggle.checked,true);assert.equal(toggle.disabled,false);
    toggle.checked=false;toggle.onchange();assert.deepEqual(pool,{enabled:false,ids:[]});
  } finally {t.cleanup();}
});

test('shuffle rules default to weight one and any time, save separately by screen, and show Vienna times',()=>{
  const t=setup();try {
    const pools={cover:{enabled:false,ids:['a'],rules:{}},inner:{enabled:true,ids:['a'],rules:{}}},calls=[];
    FractalNative.setWallpaperShuffle=()=>'{"ok":true}';
    FractalNative.listWallpapers=()=>JSON.stringify({ok:true,wallpapers:t.entries,shuffle:pools,sun:{date:'2026-06-21',sunrise:Date.parse('2026-06-21T02:53Z'),sunset:Date.parse('2026-06-21T18:58Z'),daytime:true}});
    FractalNative.setWallpaperShuffleRule=(screen,id,json)=>{pools[screen].rules[id]=JSON.parse(json);calls.push([screen,id]);return '{"ok":true}';};
    setupWallpaperGallery({canOpen:()=>true,newWallpaper(){},editWallpaper(){},beforeOpen(){}});
    t.elements['open-wallpaper-gallery'].click();
    const fields=()=>t.content(0).children[6].children[0],weight=()=>fields().children[0].children[0],period=()=>fields().children[1].children[0];
    assert.equal(weight().value,1);assert.equal(period().value,'any');assert.equal(t.content(1).children.length,6,'unselected entry has no rule controls');
    assert.match(t.elements['wallpaper-gallery-sun-note'].textContent,/04:53.*20:58.*1 eligible now/);
    weight().value='3';period().value='night';t.content(0).children[6].children[2].click();
    assert.deepEqual(calls,[['inner','a']]);assert.deepEqual(pools.inner.rules.a,{weight:3,period:'night'});assert.deepEqual(pools.cover.rules,{});
    assert.equal(weight().value,3);assert.match(t.elements['wallpaper-gallery-sun-note'].textContent,/0 eligible now/);
    assert.equal(t.entries[0].active,true);assert.deepEqual(pools.inner.ids,['a']);
    t.elements['wallpaper-gallery-screen'].value='cover';t.elements['wallpaper-gallery-screen'].onchange();
    assert.equal(weight().value,1);assert.equal(period().value,'any');
  } finally {t.cleanup();}
});

test('invalid or failed rule saves keep the last native rule and selection intact',()=>{
  const t=setup();try {
    let calls=0;
    FractalNative.setWallpaperShuffle=()=>'{"ok":true}';
    FractalNative.listWallpapers=()=>JSON.stringify({ok:true,wallpapers:t.entries,shuffle:{inner:{enabled:true,ids:['a'],rules:{a:{weight:2,period:'day'}}}}});
    FractalNative.setWallpaperShuffleRule=()=>{calls++;return '{"ok":false,"error":"Storage full"}';};
    setupWallpaperGallery({canOpen:()=>true,newWallpaper(){},editWallpaper(){},beforeOpen(){}});
    t.elements['open-wallpaper-gallery'].click();
    const form=()=>t.content(0).children[6],weight=()=>form().children[0].children[0].children[0];
    weight().value='0';form().children[2].click();assert.equal(calls,0);assert.match(t.elements['wallpaper-gallery-status'].textContent,/between 0.1 and 100/);
    weight().value='4';form().children[2].click();assert.equal(calls,1);assert.equal(weight().value,2);assert.equal(t.elements['wallpaper-gallery-status'].textContent,'Storage full');
    assert.equal(t.entries[0].active,true);
  } finally {t.cleanup();}
});
