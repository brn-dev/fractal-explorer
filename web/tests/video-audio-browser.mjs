import { renderSoundscape, soundscapeFrame, SOUNDSCAPE_SAMPLE_RATE } from '../src/audio/export-audio.mjs';
import { mp4Encoder, supportsMP4Audio, supportsMP4 } from '../src/video-export.js';
import { animationExport } from '../src/animation-export.mjs';
import { Input, BlobSource, ALL_FORMATS, AudioBufferSink } from 'mediabunny';

const $=id=>document.getElementById(id), report=text=>{$('results').textContent+=`${text}\n`;};
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const source=$('source'),ctx=source.getContext('2d');
const scalar=changed=>Float32Array.from({length:32*32},(_,i)=>changed&&i%32>=12&&i%32<16&&i>=384&&i<512?-1:i%32+Math.floor(i/32));
const features=[false,true].map(changed=>soundscapeFrame(scalar(changed),{width:32,height:32},{fractal:'julia'}));
const rms=(buffer,start,end)=>{
  let sum=0,count=0;for(let channel=0;channel<buffer.numberOfChannels;channel++) {
    const data=buffer.getChannelData(channel);for(let i=Math.floor(start*buffer.sampleRate);i<Math.floor(end*buffer.sampleRate);i++){sum+=data[i]**2;count++;}
  }return Math.sqrt(sum/count);
};
const urls=[];
$('run').onclick=async()=>{
  $('run').disabled=true;$('results').textContent='';for(const url of urls)URL.revokeObjectURL(url);urls.length=0;$('previews').replaceChildren();
  let encoder,input;
  try {
    const options=animationExport({view:{fractal:'julia',center_x:'0',center_y:'0',span:'3'},aspect:9/16}, {mode:'zoom',format:'mp4',quality:'high',longest:480,fps:10,duration:10,endHold:1,start:0,speed:.2,wander:true,includeSoundscape:true});
    // Keep fixture encoding small while preserving the production plan's times.
    Object.assign(options,{width:source.width,height:source.height});
    const videoSupport=await supportsMP4(options),audioSupport=await supportsMP4Audio();
    if(!videoSupport||!audioSupport){report(`SKIP: H.264=${videoSupport}, AAC=${audioSupport}, AudioEncoder=${typeof AudioEncoder}`);return;}
    const selection={id:'resonance',seed:52719,volume:.32,intensity:.65};
    const frames=Array.from({length:options.frames},(_,i)=>features[i<options.motionFrames&&(i%8>=2&&i%8<4)?1:0]);
    const audio=await renderSoundscape({selection,duration:options.duration,fps:options.fps,features:frames,phaseAt:options.phaseAt});
    assert(audio.length===11*SOUNDSCAPE_SAMPLE_RATE,'Warm-up changed soundtrack duration');
    for(let channel=0;channel<2;channel++) {
      const data=audio.getChannelData(channel);assert(data.every(Number.isFinite),'Nonfinite output');
      assert(data[0]===0&&data.at(-1)===0,'Fade endpoints are not silent');
    }
    assert(rms(audio,.4,1)>rms(audio,0,.1)*2,'Fade-in did not ramp up');
    assert(rms(audio,2,3)>.0001,'Warm-up did not produce established music');
    assert(rms(audio,10.8,10.99)<rms(audio,9,10),'Fade-out did not reduce the tail');
    report(`PASS reactive warm-up trimmed to ${audio.duration}s; 2s fade-in / 1s fade-out, RMS at 2s ${rms(audio,2,3).toFixed(5)}`);
    const still=await renderSoundscape({selection,duration:options.duration,fps:options.fps,features:Array(options.frames).fill(features[0]),phaseAt:options.phaseAt});
    let delta=0;for(let i=2*SOUNDSCAPE_SAMPLE_RATE;i<9*SOUNDSCAPE_SAMPLE_RATE;i++)delta+=(audio.getChannelData(0)[i]-still.getChannelData(0)[i])**2;
    assert(Math.sqrt(delta/(7*SOUNDSCAPE_SAMPLE_RATE))>.0001,'Reactive changes did not affect rendered audio');
    report('PASS changing exported fields produce different audio from a static field with the same seed');
    const generative=await renderSoundscape({selection:{...selection,id:'celestial'},duration:3,fps:10});
    assert(rms(generative,1,2)>.0001,'Generative soundscape is silent');report('PASS generative soundscape');
    const controller=new AbortController();let cancelled=false;
    try{await renderSoundscape({selection,duration:11,fps:10,features:frames,signal:controller.signal,onProgress:()=>controller.abort()});}catch(error){cancelled=error.name==='AbortError';}
    assert(cancelled,'Offline render cancellation failed');report('PASS soundscape rendering cancellation');
    encoder=await mp4Encoder(source,options);
    for(let i=0;i<options.frames;i++){
      const position=Math.min(i,options.motionFrames-1)/options.motionFrames;
      ctx.fillStyle=`hsl(${options.phaseAt(i)*360} 40% 15%)`;ctx.fillRect(0,0,source.width,source.height);
      ctx.fillStyle='#d5efa3';ctx.fillRect(20+position*230,45,35,80);await encoder.add(i);
    }
    const blob=await encoder.finish(audio);encoder=null;
    input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});
    const track=await input.getPrimaryAudioTrack(),video=await input.getPrimaryVideoTrack();
    assert(track?.codec==='aac','Missing AAC track');assert(video?.codec==='avc','Missing H.264 track');
    const duration=await input.computeDuration();assert(Math.abs(duration-options.duration)<.06,`A/V duration ${duration} differs from ${options.duration}`);
    const decoded=await new AudioBufferSink(track).getBuffer(2);
    assert(decoded&&rms(decoded.buffer,0,decoded.buffer.duration)>.0001,'Encoded audio is silent');
    report(`PASS H.264 + AAC MP4: ${duration.toFixed(3)}s, ${(blob.size/1024).toFixed(1)} KiB, decoded audio audible`);
    const url=URL.createObjectURL(blob);urls.push(url);const player=document.createElement('video');player.controls=true;player.src=url;
    const link=document.createElement('a');link.href=url;link.download='fractal-soundscape-check.mp4';link.textContent='Download reactive MP4';$('previews').append(player,link);
    input.dispose();input=null;
    encoder=await mp4Encoder(source,{...options,includeSoundscape:false});
    for(let index=0;index<5;index++)await encoder.add(index);
    const silent=await encoder.finish();encoder=null;
    input=new Input({source:new BlobSource(silent),formats:ALL_FORMATS});
    assert(await input.getPrimaryAudioTrack()===null,'Silent MP4 unexpectedly has an audio track');
    assert(Math.abs(await input.computeDuration()-.5)<.001,'Silent MP4 duration changed');
    report('PASS soundscape off produces a video-only MP4');
    report('ALL CHECKS PASSED');
  } catch(error){report(`FAIL ${error.stack}`);}finally{if(encoder)await encoder.cancel().catch(()=>{});input?.dispose();$('run').disabled=false;}
};
