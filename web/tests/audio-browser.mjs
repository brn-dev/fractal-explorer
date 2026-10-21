import { MusicEngine, MIX_GAIN } from '../src/audio/music-engine.mjs';
import { soundscapes, resonance } from '../src/audio/soundscapes.mjs';
import { sampleField, extractFeatures, ReactiveTracker } from '../src/audio/reactive-analysis.mjs';
import { BrowserEngine } from '../src/engine.js';

const results = document.querySelector('#results');
const report = message => { results.textContent += `${message}\n`; };
const assert = (ok,message) => { if (!ok) throw Error(message); };
function wav(buffer) {
  const length=buffer.length, bytes=new ArrayBuffer(44+length*4), v=new DataView(bytes);
  const text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  text(0,'RIFF');v.setUint32(4,36+length*4,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,length*4,true);
  for(let channel=0;channel<2;channel++) { const data=buffer.getChannelData(channel); for(let i=0;i<length;i++) v.setInt16(44+i*4+channel*2,Math.max(-32768,Math.min(32767,Math.round(data[i]*32767))),true); }
  return new Blob([bytes],{type:'audio/wav'});
}
async function render(d) {
  const c=new OfflineAudioContext(2,24*22050,22050), player=new MusicEngine({createContext:()=>c});
  player.initialize();player.master.gain.value=.32*MIX_GAIN;
  const scene=player.createScene({id:d.id,seed:52719});player.scenes.push(scene);
  function schedule(until) { for(const event of scene.timeline.until(until)) player.voice(scene,{...event,at:event.at+scene.origin}); }
  schedule(4);
  const pauses=[];
  for(let at=4;at<24;at+=4) pauses.push(c.suspend(at).then(()=>{schedule(at+4);return c.resume();}));
  const buffer=await c.startRendering();await Promise.all(pauses);
  let peak=0,sum=0,jump=0,previous=0;
  for(let channel=0;channel<2;channel++) {
    const data=buffer.getChannelData(channel);
    for(let i=0;i<data.length;i++){assert(Number.isFinite(data[i]),'Nonfinite audio');peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]**2;if(i)jump=Math.max(jump,Math.abs(data[i]-previous));previous=data[i];}
  }
  assert(peak>.0005&&peak<.8,`${d.id}: silent or excessive output`);
  assert(jump<.12,`${d.id}: discontinuity`);
  const rms=Math.sqrt(sum/(buffer.length*2));
  report(`PASS ${d.name}: peak ${peak.toFixed(4)}, RMS ${(20*Math.log10(rms)).toFixed(1)} dBFS, max sample step ${jump.toFixed(4)}`);
  const article=document.createElement('article'), label=document.createElement('strong'), audio=document.createElement('audio');
  label.textContent=d.name;audio.controls=true;audio.preload='none';audio.src=URL.createObjectURL(wav(buffer));article.append(label,audio);document.querySelector('#previews').append(article);
  player.disposeScene(scene);player.context.onstatechange=null;
}
async function sampling(forceCPU) {
  const palettes=[{colors:['#000000','#ffffff']}], engine=new BrowserEngine(document.createElement('canvas'),palettes);
  try {
    const hardware=await engine.init({forceCPU});
    if(!forceCPU&&!hardware.gpu){report(`SKIP WebGPU: ${hardware.error}`);return;}
    const width=257,height=193,field=Float32Array.from({length:width*height},(_,i)=>i%11===0?-1:Math.sin(i/width)*50+60);
    engine.presentCached(field,{width,height,color_origin:0});
    const start=performance.now(),actual=await engine.readAudioSamples(),elapsed=performance.now()-start,expected=sampleField(field,width,height);
    assert(actual.every((n,i)=>n===expected[i]),'Sparse sampling differs from CPU reference');
    report(`PASS ${hardware.gpu?'WebGPU':'CPU'}: 1,024 samples match (${elapsed.toFixed(2)} ms, ${actual.byteLength} readback bytes)`);
    const begin=performance.now();for(let i=0;i<1000;i++)extractFeatures(actual,{fractal:'julia'});
    report(`Analysis ${( (performance.now()-begin)/1000 ).toFixed(3)} ms/new frame; retained representation ~5.1 KiB/frame.`);
  } finally { engine.destroy(); }
}
async function reactiveMotion() {
  const c=new OfflineAudioContext(2,12*22050,22050);
  // Advance the real scheduler at offline suspension checkpoints. Nodes and
  // automation are native Web Audio; only the scheduler's running-state check
  // is overridden while the OfflineAudioContext is deliberately suspended.
  const runtime=new Proxy(c,{get(target,key){if(key==='state')return 'running';const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;},set(target,key,value){return Reflect.set(target,key,value,target);}});
  const player=new MusicEngine({createContext:()=>runtime});player.initialize();c.onstatechange=null;
  player.master.gain.value=.32*MIX_GAIN;player.active=true;
  const scene=player.createScene({id:'resonance',seed:52719});player.scenes.push(scene);
  const scalar=changed=>Float32Array.from({length:1024},(_,i)=>changed&&i%32>=12&&i%32<16&&i>=384&&i<512?-1:i%32+Math.floor(i/32));
  const a=extractFeatures(scalar(false),{fractal:'julia'}),b=extractFeatures(scalar(true),{fractal:'julia'}),tracker=new ReactiveTracker();
  let accents=0,maximumMotion=0,maximumResonator=0;
  function tick(){
    const time=c.currentTime, moving=time>=6&&time<9, phase=(time-6)% .8;
    const result=tracker.observe(moving&&phase>=.2&&phase<.4?b:a,time);
    if(result.event)accents++;player.setFeatures(result);player.tick();
    if(moving){maximumMotion=Math.max(maximumMotion,player.motion);maximumResonator=Math.max(maximumResonator,scene.resonators[1].gain.gain.value);}
  }
  tick();const pauses=[];
  for(let frame=1;frame<120;frame++)pauses.push(c.suspend(frame/10).then(()=>{tick();if(frame===100)player.setMuted(true);if(frame===110)player.setMuted(false);return c.resume();}));
  const buffer=await c.startRendering();await Promise.all(pauses);
  assert(maximumMotion>.4&&accents>=2,'Fast structure changes did not produce motion/accents');
  let peak=0,muted=0;
  for(let channel=0;channel<2;channel++){
    const data=buffer.getChannelData(channel);
    for(let i=0;i<data.length;i++){assert(Number.isFinite(data[i]),'Nonfinite reactive output');peak=Math.max(peak,Math.abs(data[i]));if(i>10.3*22050&&i<10.9*22050)muted=Math.max(muted,Math.abs(data[i]));}
  }
  assert(peak>0&&peak<.8,'Reactive peak out of range');assert(muted<.000001,'Mute did not silence the output');
  report(`PASS fast reactive motion: ${accents} accents during 3 s of changing structure, peak ${peak.toFixed(4)}, mute ${muted.toFixed(7)}`);
  const article=document.createElement('article'),label=document.createElement('strong'),audio=document.createElement('audio');
  label.textContent='Fractal Resonance · static 0–6 s, fast changes 6–9 s, muted 10–11 s';audio.controls=true;audio.src=URL.createObjectURL(wav(buffer));article.append(label,audio);document.querySelector('#previews').append(article);
  player.disposeScene(scene);
}
document.querySelector('#run').onclick=async event=>{
  event.target.disabled=true;results.textContent='Running…\n';
  try { for(const d of [...soundscapes,resonance])await render(d);await reactiveMotion();await sampling(false);await sampling(true);report('ALL CHECKS PASSED'); }
  catch(error){report(`FAIL ${error.stack}`);}
  finally{event.target.disabled=false;}
};
