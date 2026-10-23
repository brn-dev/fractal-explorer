import test from 'node:test';
import assert from 'node:assert/strict';
import { soundscapes, resonance, validateSoundscapes, seededRandom, chooseSoundscape, MusicalTimeline } from '../src/audio/soundscapes.mjs';
import { SAMPLE_SIDE, REACTIVE_TIMING, sampleField, extractFeatures, compareFeatures, ReactiveTracker, smooth } from '../src/audio/reactive-analysis.mjs';
import { AudioController, AUDIO_STORAGE_KEY, AUDIO_HINT_STORAGE_KEY, takeAudioHint, defaultAudioSettings, validateAudioSettings, isMajorSceneChange } from '../src/audio/audio-controller.js';
import { MusicEngine } from '../src/audio/music-engine.mjs';
import { newtonColor } from '../src/formulas.mjs';
import { ProgressiveAnimation } from '../src/animation.mjs';

test('eight distinct, bounded soundscapes plus resonance validate', () => {
  assert.equal(soundscapes.length,8); assert.ok(validateSoundscapes());
  assert.equal(new Set(soundscapes.map(d=>d.timbre)).size,6);
  for (const patch of [{id:''},{root:NaN},{chords:[[Infinity]]},{events:[0,1]},{feedback:.99},{harmony:30},{timbre:'saw'},{cutoff:Infinity}]) assert.throws(()=>validateSoundscapes([{...soundscapes[0],...patch}]));
  assert.throws(()=>validateSoundscapes([soundscapes[0],soundscapes[0]]));
});

test('noise stays far behind pitched voices, with a larger reduction in reactive mode', () => {
  for(const d of [...soundscapes,resonance]) {
    const events=new MusicalTimeline(d,52719).until(40), pitched=events.filter(e=>e.timbre!=='noise');
    assert.deepEqual(pitched,new MusicalTimeline({...d,texture:0},52719).until(40));
    for(const event of events.filter(e=>e.timbre==='noise')) {
      assert.ok(event.level<=d.texture*(d.id==='resonance'?.081:.151));
      assert.ok(event.level<.004);
    }
    assert.ok(pitched.some(e=>e.layer==='foundation'&&e.level===.046));
  }
});
test('seeded randomness and the musical sequence are deterministic across scheduler chunk sizes', () => {
  const a=seededRandom(42), b=seededRandom(42), c=seededRandom(43);
  const first=Array.from({length:100},a); assert.deepEqual(first,Array.from({length:100},b)); assert.notDeepEqual(first,Array.from({length:100},c));
  for (const definition of [...soundscapes,resonance]) {
    const one=new MusicalTimeline(definition,98), chunks=new MusicalTimeline(definition,98);
    const full=one.until(1800), parts=[];
    for(let t=0;t<=1800;t+=.25) parts.push(...chunks.until(t));
    // Harmony voices are staggered slightly after their layer's decision time.
    const order=events=>events.sort((a,b)=>a.at-b.at || a.midi-b.midi);
    assert.deepEqual(order(full),order(parts));
    assert.ok(full.length>70); assert.ok(full.every(e=>Number.isFinite(e.midi+e.at+e.duration+e.level)&&e.duration>0));
    assert.notDeepEqual(full.slice(0,10),new MusicalTimeline(definition,99).until(100).slice(0,10));
  }
});
test('Auto excludes immediate repeats and handles one or zero choices', () => {
  for (const d of soundscapes) for (const n of [0,.4,.999999]) assert.notEqual(chooseSoundscape(d.id,()=>n),d.id);
  assert.equal(chooseSoundscape('celestial',()=>0,[soundscapes[0]]),'celestial'); assert.equal(chooseSoundscape('',()=>0,[]),null);
});
const field = fn => Float32Array.from({length:1024},(_,i)=>fn(i%32,Math.floor(i/32)));
const features = data => extractFeatures(data,{fractal:'julia'});
test('sparse sampling, sentinels, and invalid samples remain finite', () => {
  assert.equal(sampleField(null,32,32),null); assert.equal(sampleField(new Float32Array(2),32,32),null);
  assert.equal(sampleField(new Float32Array(320*320),320,320).length,SAMPLE_SIDE**2);
  assert.equal(extractFeatures(new Float32Array(2)),null);
  const interior=features(field(()=>-1)); assert.equal(interior.interior,1); assert.equal(interior.complexity,0);
  assert.equal(features(field(()=>NaN)),null); assert.equal(features(field(()=>-2)),null);
  const mixed=features(field((x,y)=>x<8?-1:x<10?Infinity:y<2?-2:x+y));
  for (const key of ['complexity','regional','interior','balance']) assert.ok(Number.isFinite(mixed[key]));
  assert.ok(mixed.interior>.2); assert.ok(mixed.complexity>0);
});
test('complexity, local transformation and interior-mask changes are detected', () => {
  const base=field((x,y)=>x+y), a=features(base), b=features(field((x,y)=>x>=12&&x<16&&y>=12&&y<16?-1:x+y));
  const change=compareFeatures(b,a);
  assert.ok(change.change<.03); assert.ok(change.localChange>.9); assert.ok(change.maskChange>0);
  assert.ok(features(field((x,y)=>(x+y)%2?0:40)).complexity>.9);
  assert.ok(features(field(()=>2)).complexity===0);
});
test('palette/color origin and escape-range changes do not masquerade as structural novelty', () => {
  const a=features(field((x,y)=>x+y)), b=features(field((x,y)=>(x+y)*12+800));
  assert.ok(compareFeatures(b,a).change<1e-6);
  const noise=features(field((x,y)=>2+Math.sin(x+y)*.00001)); assert.equal(noise.complexity,0);
  assert.equal(compareFeatures(a,a).change,0);
  const near=features(field((x,y)=>x+y+Math.sin(x)*.0001)); assert.ok(compareFeatures(near,a).change<.0001);
});
test('Newton root and convergence encoding is independent of escape normalization', () => {
  const a=extractFeatures(field((x)=>newtonColor(x<16?1:-.5,x<16?0:Math.sqrt(3)/2,1,0,3,4)),{fractal:'newton',power:3});
  assert.ok(a.complexity>0); assert.ok(a.values[0]<a.values[31]);
  const b=extractFeatures(field(()=>newtonColor(1,0,1,0,3,4)),{fractal:'newton',power:3});
  assert.ok(compareFeatures(a,b).localChange>.2); assert.equal(a.interior,0);
});
test('novelty hysteresis, cooldown, reset, missing and repeated presentations', () => {
  const a=features(field((x,y)=>x+y)), b=features(field((x,y)=>x>=12&&x<16&&y>=12&&y<16?-1:x+y));
  const tracker=new ReactiveTracker(); assert.equal(tracker.observe(a,0).event,false);
  assert.equal(tracker.observe(null,1),null); assert.equal(tracker.observe(b,1).event,true);
  assert.equal(tracker.observe(b,1.02).event,false); assert.equal(tracker.observe(a,1.1).event,false);
  assert.equal(tracker.observe(b,.5),null); // stale timestamps cannot move baseline backwards
  for(let i=1.2;i<1.9;i+=.03) tracker.observe(a,i);
  assert.equal(tracker.observe(b,2).event,true);
  tracker.reset(); assert.equal(tracker.observe(b,17).event,false);
  assert.ok(smooth(0,1,1)>1-smooth(1,0,1)); assert.equal(smooth(.2,.9,0),.2);
});
test('rapid structural animation drives continuous motion and accents within one second', () => {
  const a=features(field((x,y)=>x+y)), b=features(field((x,y)=>x>=12&&x<16&&y>=12&&y<16?-1:x+y));
  const tracker=new ReactiveTracker(), events=[], motion=[];
  for(let i=0;i<90;i++) {
    const time=i/30, changed=time% .8 >= .2&&time% .8 <.4;
    const result=tracker.observe(changed?b:a,time);motion.push(result.motion);if(result.event)events.push(time);
  }
  assert.ok(events.length>=3,`Expected several accents during three seconds: ${events}`);
  assert.ok(events[1]-events[0]<1.1);assert.ok(events.every((time,i)=>!i||time-events[i-1]>=REACTIVE_TIMING.cooldown));
  assert.ok(Math.max(...motion)>.5);assert.equal(tracker.observe(a,4).motion,0);
});
test('short motion window sees gradual per-frame transformations at 30 and 60 fps', () => {
  const base=features(field((x,y)=>x+y));
  const run=fps=>{
    const tracker=new ReactiveTracker(), motion=[];
    for(let frame=0;frame<=fps;frame++) {
      const time=frame/fps, values=base.values.slice();
      for(let y=12;y<16;y++)for(let x=12;x<16;x++)values[y*32+x]+=.7*time;
      const result=tracker.observe({...base,values},time);if(time>.3)motion.push(result.motion);
    }
    return motion.reduce((a,b)=>a+b)/motion.length;
  };
  const slow=run(30), fast=run(60);assert.ok(slow>.04&&fast>.04);assert.ok(Math.abs(slow-fast)<.02);
});

class Player {
  constructor(){this.state='off';this.selections=[];this.features=[];}
  setVolume(v){this.volume=v;} setIntensity(v){this.intensity=v;}
  setMuted(v){this.muted=v;}
  select(v){this.selections.push(v);} resetFeatures(){} setPalettePhase(){}
  setFeatures(v){this.features.push(v);}
  async start(){this.state='playing';return true;} stop(){this.state='off';}
  async setVisible(v){this.state=v?'playing':'paused';} async destroy(){}
}
function controller(saved) {
  const entries=new Map(saved?[[AUDIO_STORAGE_KEY,JSON.stringify(saved)]]:[]), player=new Player(); let seed=0;
  const storage={getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)};
  return { audio:new AudioController({storage,engine:player,makeSeed:()=>++seed,random:()=>.3}),player,storage,entries };
}

test('the soundscape invitation appears once without enabling audio or changing saved preferences', () => {
  const {audio,storage,entries,player}=controller();
  assert.equal(audio.settings.enabled,false); assert.equal(player.state,'off');
  assert.equal(takeAudioHint(storage,audio.settings),true);
  assert.equal(entries.get(AUDIO_HINT_STORAGE_KEY),'1');
  assert.equal(entries.has(AUDIO_STORAGE_KEY),false);
  assert.equal(takeAudioHint(storage,audio.settings),false);
  const returning=new AudioController({storage,engine:new Player()});
  assert.equal(returning.settings.enabled,false);
  assert.equal(takeAudioHint(storage,returning.settings),false);
});

test('previously enabled or muted sound skips the invitation and stays remembered after switching off', async () => {
  for (const saved of [{enabled:true},{enabled:true,muted:true},{muted:true}]) {
    const {audio,storage}=controller(saved);
    assert.equal(takeAudioHint(storage,audio.settings),false);
    audio.stop();
    const returning=new AudioController({storage,engine:new Player()});
    assert.equal(returning.settings.enabled,false);
    assert.equal(returning.settings.muted,!!saved.muted);
    assert.equal(takeAudioHint(storage,returning.settings),false);
  }
  const {audio,storage}=controller();
  await audio.start();
  assert.equal(new AudioController({storage,engine:new Player()}).settings.enabled,true);
});

test('unavailable hint storage still permits quiet first-use discovery', () => {
  const broken={getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}};
  assert.equal(takeAudioHint(undefined,defaultAudioSettings),true);
  assert.equal(takeAudioHint(broken,defaultAudioSettings),true);
  assert.equal(takeAudioHint(broken,{...defaultAudioSettings,enabled:true}),false);
});
test('major navigation alone switches Auto once; manual selection survives every scene', () => {
  const {audio,player}=controller(); audio.majorSceneChange('initial'); const first=audio.id;
  for(const reason of ['pan','zoom','parameter','automation','animation-start','animation-stop','palette','quality','resize','cache','pause','resume']) {
    assert.equal(isMajorSceneChange(reason),false); assert.equal(audio.majorSceneChange(reason),false);
  }
  assert.equal(player.selections.length,1);
  for(const reason of ['featured','bookmark','family','reset','import','shared']) { const last=audio.id; audio.majorSceneChange(reason); assert.notEqual(audio.id,last); }
  audio.configure({selection:'manual',manualId:first}); const stable={...audio.selection}, count=player.selections.length;
  for(const reason of ['initial','featured','bookmark','family','reset','import','shared']) audio.majorSceneChange(reason);
  assert.deepEqual(audio.selection,stable); assert.equal(player.selections.length,count);
  audio.shuffle(); assert.equal(audio.settings.selection,'auto'); assert.notEqual(audio.id,first);
});
test('settings are local, validated, tolerant of old/malformed/unavailable storage, and never autoplay', () => {
  assert.deepEqual(validateAudioSettings(null),defaultAudioSettings);
  assert.deepEqual(validateAudioSettings({view:{fractal:'julia'},mode:'bad',manualId:'__proto__'}),defaultAudioSettings);
  assert.equal(validateAudioSettings({volume:Infinity}).volume,.32); assert.equal(validateAudioSettings({volume:2}).volume,1);
  const {audio,player,storage}=controller({enabled:true,mode:'reactive',selection:'manual',manualId:'void',volume:.2,intensity:.7});
  assert.equal(audio.state,'paused'); assert.equal(audio.analyzing,false); assert.equal(player.state,'off');
  audio.configure({volume:.19}); const next=new AudioController({storage,engine:new Player()}); assert.equal(next.settings.volume,.19); assert.equal(next.settings.manualId,'void');
  const broken=new AudioController({storage:{getItem(){throw Error();},setItem(){throw Error();}},engine:new Player()}); broken.configure({volume:.1});
  assert.equal(broken.state,'off');
});

test('export preview suppresses live sound without changing saved preferences or resuming in a hidden tab', async () => {
  const {audio,player}=controller({enabled:true,mode:'reactive'});await audio.start();
  const settings={...audio.settings};
  await audio.setPreviewing(true);assert.equal(player.state,'paused');assert.equal(audio.analyzing,false);
  await audio.setVisible(false);await audio.setPreviewing(false);assert.equal(player.state,'paused');
  await audio.setVisible(true);assert.equal(player.state,'playing');assert.equal(audio.analyzing,true);
  assert.deepEqual(audio.settings,settings);
});
test('Auto remembers its previous choice across visits without starting audio', () => {
  const {audio,storage}=controller();audio.majorSceneChange('initial');const previous=audio.id;
  const next=new AudioController({storage,engine:new Player(),random:()=>.3});next.majorSceneChange('initial');
  assert.notEqual(next.id,previous);assert.equal(next.state,'off');
});
test('header mute preserves the scene, volume and local preferences; unmute can start audio', async () => {
  const {audio,player,storage}=controller();audio.configure({selection:'manual',manualId:'glass',volume:.27});
  await audio.toggleMute();assert.equal(audio.state,'playing');
  const selection={...audio.selection};audio.toggleMute();assert.equal(audio.state,'muted');assert.equal(player.muted,true);
  assert.deepEqual(audio.selection,selection);assert.equal(audio.settings.volume,.27);assert.equal(audio.analyzing,false);
  const restored=new AudioController({storage,engine:new Player()});assert.equal(restored.settings.muted,true);assert.equal(restored.state,'paused');
  audio.toggleMute();assert.equal(audio.state,'playing');assert.equal(player.muted,false);assert.deepEqual(audio.selection,selection);
  audio.stop();assert.equal(audio.state,'off');await audio.toggleMute();assert.equal(audio.state,'playing');
});
test('reactive comparisons follow display order, never asynchronous cache completion', async () => {
  const {audio,player}=controller({enabled:true,mode:'reactive'}); await audio.start();
  const frames=[field((x,y)=>x+y),field((x,y)=>x<4&&y<4?-1:x+y),field((x,y)=>x+y+200)];
  let complete, time=0;
  const animation=new ProgressiveAnimation({now:()=>time,render:()=>new Promise(r=>{complete=r;}),present:frame=>audio.present(frame,time/1000)});
  animation.configure({frames:3,fps:1,viewAt:i=>({fractal:'julia',index:i})},{width:32,height:32});
  animation.tick(0); await Promise.resolve();
  complete({field:frames[0],metadata:{width:32,height:32}}); await new Promise(r=>setImmediate(r));
  assert.equal(player.features.length,0); animation.tick(0); assert.equal(player.features.length,1);
  await Promise.resolve(); complete({field:frames[1],metadata:{width:32,height:32}}); await new Promise(r=>setImmediate(r));
  assert.equal(player.features.length,1); // ready frame 1 has not been displayed
  time=1000; animation.tick(time); assert.equal(player.features.length,2); assert.ok(player.features.at(-1).localChange>.8);
  audio.present(null,2); assert.equal(player.features.length,2);
  audio.present(animation.lastShown,2); assert.equal(player.features.at(-1).change,0);
  audio.stop(); audio.present(animation.lastShown,3); assert.equal(player.features.length,3);
});

class Param {
  constructor(){this.value=0;}
  setValueAtTime(v){this.value=v;} linearRampToValueAtTime(v){this.value=v;} exponentialRampToValueAtTime(v){this.value=v;}
  setTargetAtTime(v){this.value=v;} cancelAndHoldAtTime(){} cancelScheduledValues(){}
}
class Node {
  constructor(ctx){this.ctx=ctx;ctx.nodes.push(this);this.gain=new Param();this.frequency=new Param();this.Q=new Param();this.pan=new Param();this.detune=new Param();this.delayTime=new Param();this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();}
  connect(other){return other;} disconnect(){this.disconnected=true;} start(){this.started=true;} stop(){this.stopped=true;} setPeriodicWave(){}
}
class Context {
  constructor(){this.currentTime=0;this.sampleRate=100;this.state='suspended';this.nodes=[];this.destination=new Node(this);}
  createGain(){return new Node(this);} createBiquadFilter(){return new Node(this);} createDynamicsCompressor(){return new Node(this);}
  createConvolver(){return new Node(this);} createDelay(){return new Node(this);} createStereoPanner(){return new Node(this);}
  createOscillator(){return new Node(this);} createBufferSource(){return new Node(this);} createPeriodicWave(){return {};}
  createBuffer(ch,n){const data=Array.from({length:ch},()=>new Float32Array(n));return {getChannelData:i=>data[i]};}
  async resume(){this.state='running';this.onstatechange?.();} async suspend(){this.state='suspended';this.onstatechange?.();} async close(){this.state='closed';}
}
function engine() {
  const context=new Context(), intervals=new Map(), timeouts=new Map();let index=0,creates=0;
  const timers={setInterval:fn=>{intervals.set(++index,fn);return index;},clearInterval:i=>intervals.delete(i),setTimeout:fn=>{timeouts.set(++index,fn);return index;},clearTimeout:i=>timeouts.delete(i)};
  const player=new MusicEngine({createContext:()=>{creates++;return context;},timers});
  return {player,context,intervals,timeouts,get creates(){return creates;},flush:async()=>{const queued=[...timeouts.values()];timeouts.clear();for(const fn of queued) await fn();}};
}
test('lazy Web Audio lifecycle, bounded rapid crossfades, node cleanup and context reuse', async () => {
  const e=engine(); assert.equal(e.creates,0); await e.player.start({id:'celestial',seed:2}); assert.equal(e.creates,1); assert.equal(e.intervals.size,1);
  for(let i=0;i<30;i++) { e.player.select({id:soundscapes[i%8].id,seed:i}); e.context.currentTime+=.05; e.player.tick(); assert.ok(e.player.scenes.length<=2); for(const s of e.player.scenes) assert.ok(s.voices.size<=12); }
  e.context.currentTime+=6;e.player.tick();assert.ok(e.player.scenes.length<=2);
  await e.player.stop();assert.equal(e.intervals.size,0);await e.flush();assert.equal(e.player.scenes.length,0);assert.equal(e.context.state,'suspended');
  assert.ok(e.context.nodes.filter(n=>n.started).every(n=>n.stopped&&n.disconnected));
  await e.player.start({id:'glass',seed:42});assert.equal(e.creates,1);assert.equal(e.intervals.size,1);
  await e.player.destroy();assert.equal(e.context.state,'closed');assert.equal(e.intervals.size,0);assert.equal(e.timeouts.size,0);
});
test('hidden tabs suspend scheduling; visibility and resume failure remain recoverable', async () => {
  const e=engine();await e.player.start({id:'resonance',seed:1});
  await e.player.setVisible(false);assert.equal(e.intervals.size,0);await e.flush();assert.equal(e.player.state,'paused');
  await e.player.setVisible(true);assert.equal(e.player.state,'playing');assert.equal(e.intervals.size,1);
  e.context.resume=async()=>{throw Error('blocked');};await e.player.setVisible(false);await e.flush();await e.player.setVisible(true);assert.equal(e.player.state,'paused');
  assert.equal(await e.player.start({id:'void',seed:2}),false);assert.equal(e.intervals.size,0);
  await e.player.destroy();
});
test('rapid off/on and hide/show cancel stale suspension callbacks', async () => {
  const e=engine();await e.player.start({id:'orbit',seed:8});e.player.stop();await e.player.start({id:'orbit',seed:8});await e.flush();assert.equal(e.player.state,'playing');
  await e.player.setVisible(false);await e.player.setVisible(true);await e.flush();assert.equal(e.player.state,'playing');assert.equal(e.intervals.size,1);await e.player.destroy();
});
test('browser-initiated suspension and resume restart exactly one scheduler', async () => {
  const e=engine();await e.player.start({id:'void',seed:1});await e.context.suspend();assert.equal(e.intervals.size,0);
  await e.context.resume();assert.equal(e.intervals.size,1);assert.equal(e.player.state,'playing');await e.player.destroy();
});
test('a closed context can be replaced on the next user start', async () => {
  const contexts=[],player=new MusicEngine({createContext:()=>{const c=new Context();contexts.push(c);return c;}});
  await player.start({id:'celestial',seed:1});await contexts[0].close();await player.start({id:'glass',seed:2});
  assert.equal(contexts.length,2);assert.equal(player.state,'playing');assert.ok(contexts[0].nodes.filter(n=>n.started).every(n=>n.disconnected));
  await player.destroy();
});
test('continuous resonators respond within a few scheduler ticks and decay when frames stop', async () => {
  const e=engine();await e.player.start({id:'resonance',seed:1});const scene=e.player.scenes[0];
  assert.equal(scene.resonators.length,3);const initial=scene.resonators[1].gain.gain.value;
  for(let i=1;i<=3;i++) {e.context.currentTime=i*.1;e.player.setFeatures({complexity:.4,regional:.5,interior:.2,balance:.3,motion:.8,novelty:.4,event:true});e.player.tick();}
  assert.ok(e.player.motion>.7);assert.ok(scene.resonators[1].gain.gain.value>initial+.005);
  assert.ok([...scene.voices].filter(v=>v.accent).length<=3);assert.ok(scene.voices.size<=12);
  for(let i=4;i<=24;i++){e.context.currentTime=i*.1;e.player.tick();}assert.ok(e.player.motion<.03);
  await e.player.destroy();
});
test('mute restores the same graph and volume without scheduling another scene', async () => {
  const e=engine();await e.player.start({id:'glass',seed:1});const scene=e.player.scenes[0], volume=e.player.volume;
  e.player.setMuted(true);assert.equal(e.player.master.gain.value,0);e.player.setVolume(.5);assert.equal(e.player.master.gain.value,0);
  e.player.setMuted(false);assert.equal(e.player.master.gain.value,.5*2.4);assert.equal(e.player.scenes[0],scene);
  e.player.setVolume(volume);await e.player.destroy();
});
