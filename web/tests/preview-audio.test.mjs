import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundscapePreview } from '../src/audio/preview-audio.mjs';

class Context {
  constructor(){this.currentTime=0;this.state='suspended';this.sources=[];this.destination={};}
  async resume(){this.state='running';}
  async close(){this.state='closed';}
  createGain(){return {gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){},cancelScheduledValues(){}},connect:v=>v,disconnect(){}};}
  createBufferSource(){
    const source={connect:v=>v,disconnect(){this.disconnected=true;},start(time,offset){this.offset=offset;},stop(){this.stopped=true;}};
    this.sources.push(source);return source;
  }
}
test('preview uses the audio clock, pauses at its exact position, and resumes without restarting the fade',async()=>{
  const context=new Context(),preview=new SoundscapePreview({createContext:()=>context}),buffer={duration:13};
  preview.setBuffer(buffer);assert.equal(preview.play(),false);
  assert.equal(await preview.unlock(),true);assert.equal(preview.play(),true);
  assert.equal(context.sources[0].buffer,buffer);
  context.currentTime=4.2;assert.equal(preview.position,4.2);
  preview.pause();context.currentTime=8;assert.equal(preview.position,4.2);
  preview.play();assert.equal(context.sources[1].offset,4.2);
  // A retiring source's callback cannot end the replacement source.
  context.sources[0].onended();assert.equal(preview.playing,true);
  context.currentTime=9;assert.equal(preview.position,5.2);
  preview.reset();assert.equal(preview.position,0);
  preview.play();context.currentTime=23;assert.equal(preview.position,13);assert.equal(preview.ended,true);
  context.sources.at(-1).onended();preview.play();assert.equal(context.sources.at(-1).offset,0);
  await preview.dispose();assert.equal(context.state,'closed');assert.equal(preview.buffer,null);
  assert.ok(context.sources.every(s=>s.stopped||s.disconnected));
});
test('blocked audio remains recoverable and a closed preview cannot restart',async()=>{
  const context=new Context(),preview=new SoundscapePreview({createContext:()=>context});
  context.resume=async()=>{throw Error('blocked');};assert.equal(await preview.unlock(),false);
  context.resume=async()=>{context.state='running';};assert.equal(await preview.unlock(),true);
  await preview.dispose();assert.equal(await preview.unlock(),false);assert.equal(preview.play(),false);
});
