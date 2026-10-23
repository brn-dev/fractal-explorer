import { BrowserEngine } from '../src/engine.js';
import { animationExport } from '../src/animation-export.mjs';
import { ExportFieldCache, temporaryFieldStore } from '../src/export-field-cache.mjs';

const report=text=>{document.querySelector('#results').textContent+=`${text}\n`;};
const assert=(ok,message)=>{if(!ok)throw Error(message);};
document.querySelector('#run').onclick=async event=>{
  event.target.disabled=true;document.querySelector('#results').textContent='';
  const engine=new BrowserEngine(document.createElement('canvas'),[{colors:['#000000','#ffffff']}]);
  const names=[];
  const createStore=async signal=>{const store=await temporaryFieldStore(signal);names.push(store.name);return store;};
  let cache;
  try{
    await engine.init({forceCPU:true});
    const state={view:{fractal:'julia',x:'0',y:'0',span:'3.6',iterations:100,bailout:64,julia_x:'-.8',julia_y:'.156'},automation:{julia_x:{enabled:true,target:'-.7',speed:.25}},aspect:9/16};
    const p=animationExport(state,{mode:'parameters',format:'mp4',quality:'high',longest:480,fps:10,start:0,speed:.12,wander:true,repeats:3,endHold:1});
    cache=new ExportFieldCache({memoryBudget:64*36*4,createStore});
    let computed=0,hits=0;const expected=new Map();
    for(let index=0;index<p.frames;index++){
      const view=p.viewAt(index),key=JSON.stringify(view);let frame=await cache.get(key);
      if(!frame){const result=await engine.render(view,64,36,{});frame={values:await engine.readField(),metadata:result.metadata};computed++;expected.set(key,frame.values.slice());await cache.put(key,frame);}
      else{hits++;assert(frame.values instanceof Float32Array,'Stored field lost its numeric type');assert(frame.values.every((value,i)=>Object.is(value,expected.get(key)[i])),'Stored field changed its pixels');}
      assert(frame.metadata.width===64&&frame.metadata.height===36,'Cache changed the resolution');
      assert(cache.memoryBytes<=64*36*4,'Cache exceeded RAM budget');
    }
    const unique=new Set(Array.from({length:p.cycleFrames},(_,i)=>JSON.stringify(p.viewAt(i)))).size;
    assert(computed===unique,`Computed ${computed} states instead of ${unique}`);assert(names.length===1,'Disk cache was not exercised');
    await cache.dispose();cache=null;
    report(`PASS ${p.repeats} repeats / ${p.frames} frames: ${computed} unique states computed, ${hits} cached frames; exact Float32 pixels and resolution preserved`);
    const active=await createStore();await active.put('active',{values:new Float32Array([7]),metadata:{width:1,height:1}});
    const second=await createStore();
    try{assert((await active.get('active')).values[0]===7,'Another active export cache was removed');}
    finally{await second.dispose();await active.dispose();}
    report('PASS another active export cache survives abandoned-cache cleanup');
    if(navigator.locks&&indexedDB.databases){
      const orphan=`fractal-export-cache-test-orphan-${crypto.randomUUID()}`;
      await new Promise((resolve,reject)=>{const request=indexedDB.open(orphan,1);request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);});
      const replacement=await createStore();
      try{assert(!(await indexedDB.databases()).some(db=>db.name===orphan),'Abandoned cache was not removed');}
      finally{await replacement.dispose();}
      report('PASS abandoned cache removed without deleting an active cache');
    }
    const controller=new AbortController();cache=new ExportFieldCache({memoryBudget:0,createStore,signal:controller.signal});
    await cache.put('cancel',{values:new Float32Array([1,-1,3,4]),metadata:{width:2,height:2}});controller.abort();
    let cancelled=false;try{await cache.get('cancel');}catch(error){cancelled=error.name==='AbortError';}
    assert(cancelled,'Cancellation was ignored');await cache.dispose();cache=null;
    if(indexedDB.databases){const databases=await indexedDB.databases();assert(!databases.some(db=>names.includes(db.name)),'Temporary cache remained after cleanup');}
    report('PASS temporary databases removed after completion and cancellation');report('ALL CHECKS PASSED');
  }catch(error){report(`FAIL ${error.stack}`);}finally{await cache?.dispose();engine.destroy();event.target.disabled=false;}
};
