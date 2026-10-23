import test from 'node:test';
import assert from 'node:assert/strict';
import { soundscapeEnvelope, soundscapeFrame, renderSoundscape } from '../src/audio/export-audio.mjs';
import { ReactiveTracker } from '../src/audio/reactive-analysis.mjs';

test('soundtrack fades start and end at zero, reaching full level after two seconds', () => {
  const rate=48000,length=11*rate;
  assert.equal(soundscapeEnvelope(0,length,rate),0);
  assert.equal(soundscapeEnvelope(rate,length,rate),.5);
  assert.equal(soundscapeEnvelope(2*rate,length,rate),1);
  assert.equal(soundscapeEnvelope(9*rate,length,rate),1);
  assert.equal(soundscapeEnvelope(length-1,length,rate),0);
  for(const duration of [.5,1,2,10,21]) {
    const size=Math.round(duration*rate);
    for(let i=0;i<size;i+=101) {
      const gain=soundscapeEnvelope(i,size,rate);assert.ok(Number.isFinite(gain)&&gain>=0&&gain<=1);
    }
    assert.equal(soundscapeEnvelope(0,size,rate),0);assert.equal(soundscapeEnvelope(size-1,size,rate),0);
  }
});

test('exported field analysis sees motion then settles on repeated final-frame features', () => {
  const field = moved => Float32Array.from({length:64*64},(_,i)=>moved&&i%64>24&&i%64<40&&i>=24*64&&i<40*64?-1:i%64+Math.floor(i/64));
  const a=soundscapeFrame(field(false),{width:64,height:64},{fractal:'julia'});
  const b=soundscapeFrame(field(true),{width:64,height:64},{fractal:'julia'});
  assert.equal(a.values.length,1024);
  const tracker=new ReactiveTracker();tracker.observe(a,0);
  assert.ok(tracker.observe(b,.1).motion>.4);
  let last;
  for(let i=2;i<20;i++)last=tracker.observe(b,i/10);
  assert.equal(last.motion,0);assert.equal(last.event,false);
});

test('cancelled sound rendering and missing reactive frames fail before allocating a context', async () => {
  const controller=new AbortController();controller.abort();
  await assert.rejects(renderSoundscape({signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(renderSoundscape({selection:{id:'resonance'},duration:2,fps:30,features:[]}),/every exported frame/);
  await assert.rejects(renderSoundscape({selection:{id:'celestial'},duration:102,fps:30}),/duration/);
});
