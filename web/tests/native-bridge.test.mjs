import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeBridge, nativeCall, nativeVideoEncoder, nativeDownload } from '../src/native-bridge.mjs';
test('Android video export sends every frame in order and returns a file handle without reloading the movie', async () => {
  const calls=[];
  globalThis.FractalNative={info(){},beginVideo(json){calls.push(['begin',JSON.parse(json)]);return JSON.stringify({ok:true,id:'movie'});},appendVideo(...args){calls.push(['frame',...args]);return '{"ok":true}';},finishVideo(id){calls.push(['finish',id]);return '{"ok":true,"id":"movie","size":123}';},cancelVideo(){throw new Error('Finished videos should not be cancelled');}};
  try {
    const encoder=await nativeVideoEncoder({toDataURL:()=> 'data:image/png;base64,cG5n'}, {width:206,height:480,fps:30,bitrate:500000,nativeTarget:'closed-transition'});
    await encoder.add(0);await encoder.add(1);const result=await encoder.finish();await encoder.cancel();
    assert.equal(calls[0][1].slot,'closed-transition');assert.deepEqual(calls.slice(1),[['frame','movie','cG5n',0],['frame','movie','cG5n',1],['finish','movie']]);
    assert.deepEqual(result,{nativeFile:'movie',size:123,type:'video/mp4'});
  } finally {delete globalThis.FractalNative;}
});
test('browser downloads are streamed to Android in bounded chunks and native files stay native',async()=>{
  const chunks=[],saved=[];
  globalThis.FractalNative={info(){},beginDownload(){return '{"ok":true,"id":"download"}';},appendDownload(id,base64){chunks.push(Buffer.from(base64,'base64'));return '{"ok":true}';},saveNativeFile(id,name){saved.push([id,name]);return '{"ok":true}';}};
  try {
    const source=new Uint8Array(130000).map((_,i)=>i%251);
    await nativeDownload(new Blob([source],{type:'image/png'}),'image.png');
    assert.ok(chunks.every(chunk=>chunk.length<=48*1024));assert.deepEqual(new Uint8Array(Buffer.concat(chunks)),source);
    await nativeDownload({nativeFile:'existing',size:456},'movie.mp4');
    assert.deepEqual(saved,[['download','image.png'],['existing','movie.mp4']]);
  }finally{delete globalThis.FractalNative;}
});
test('Android bridge failures surface the native message and ordinary browsers stay independent',()=>{
  assert.equal(nativeBridge(),null);assert.throws(()=>nativeCall('info'),/Android app/);
  globalThis.FractalNative={info(){return '{"ok":false,"error":"Codec unavailable"}';}};
  try{assert.throws(()=>nativeCall('info'),/Codec unavailable/);}finally{delete globalThis.FractalNative;}
});

test('Maximum forwards dynamic quality and full screen pixels without a fixed bitrate substitution',async()=>{
  let request;
  globalThis.FractalNative={info(){},beginVideo(json){request=JSON.parse(json);return '{"ok":true,"id":"max"}';},cancelVideo(){return '{"ok":true}';}};
  try {
    const encoder=await nativeVideoEncoder({}, {width:2256,height:2504,fps:30,bitrate:null,quantizer:0,nativeTarget:'open-steady'});
    assert.equal(request.quantizer,0);assert.equal(request.bitrate,null);assert.deepEqual([request.width,request.height],[2256,2504]);
    await encoder.cancel();
  } finally {delete globalThis.FractalNative;}
});
