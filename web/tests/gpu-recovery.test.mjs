import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {computePipeline,renderPipeline,gpuBackendFailure,GPUBackendError,specializeFractal} from '../src/gpu-recovery.mjs';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
const {BrowserEngine}=await server.ssrLoadModule('/src/engine.js');
// Vite SSR has its own module identity for instanceof checks; use errors with real API fields.
await server.close();
const internal=()=>Object.assign(new Error('CreateComputePipelines failed with VK_ERROR_UNKNOWN'),{reason:'internal'});
const view={fractal:'mandelbrot',x:'-.5',y:'0',span:'3.6',julia_x:'-.8',julia_y:'.156',iterations:80,bailout:64};
globalThis.GPUBufferUsage??={UNIFORM:64,COPY_DST:8};
globalThis.GPUShaderStage??={COMPUTE:4};

test('GPU recovery recognizes driver failures but preserves validation, abort and numeric errors',()=>{
  for(const error of [internal(),Object.assign(internal(),{reason:'validation'}),Object.assign(new Error('Internal compiler error'),{reason:'internal'}),new GPUBackendError(new Error('lost'))])assert.equal(gpuBackendFailure(error),true);
  for(const error of [Object.assign(new Error('invalid WGSL'),{reason:'validation'}),new DOMException('cancel','AbortError'),new Error('Precision repair needs 5000 pixels'),new Error('Invalid formula')])assert.equal(gpuBackendFailure(error),false);
});
test('a transient Vulkan compile failure retries without changing precision or descriptor',async()=>{
  const calls=[],descriptor={compute:{constants:{PAIRED:true,EXTENDED:true}}};
  const device={async createComputePipelineAsync(value){calls.push(value);if(calls.length<3)throw internal();return 'pipeline';}};
  assert.equal(await computePipeline(device,descriptor),'pipeline');assert.equal(calls.length,3);assert.ok(calls.every(value=>value===descriptor));
});
test('persistent internal failures are bounded and do not poison later compilation',async()=>{
  let calls=0;const device={async createComputePipelineAsync(){calls++;throw internal();}};
  await assert.rejects(computePipeline(device,{}),GPUBackendError);assert.equal(calls,3);
  assert.equal(await renderPipeline({async createRenderPipelineAsync(){return 'color';}},{}),'color');
});
test('validation errors are not retried',async()=>{
  let calls=0;const error=Object.assign(new Error('bad shader'),{reason:'validation'});
  await assert.rejects(computePipeline({async createComputePipelineAsync(){calls++;throw error;}},{}),value=>value===error);assert.equal(calls,1);
});
test('compilation is serialized across devices and cancelled queued work never reaches the driver',async()=>{
  let release;const first=computePipeline({createComputePipelineAsync:()=>new Promise(resolve=>{release=resolve;})},{});
  await new Promise(resolve=>setImmediate(resolve));let calls=0,cancelled=false;
  const second=computePipeline({async createComputePipelineAsync(){calls++;return 'second';}},{},()=>cancelled);
  cancelled=true;release('first');assert.equal(await first,'first');await assert.rejects(second,{name:'AbortError'});assert.equal(calls,0);
});
test('specialized kernels bake formula and direct/deep mode while retaining the uniform ABI',async()=>{
  const source=await readFile(new URL('../src/fractal.wgsl',import.meta.url),'utf8');
  for(let kind=0;kind<=10;kind++)for(const perturb of [false,true]){
    const code=specializeFractal(source,kind,perturb);
    assert.doesNotMatch(code,/\bp\.(kind|perturb)\b/);assert.match(code,/size:vec2u,limit:u32,kind:u32/);
    assert.ok(code.includes(`if(${perturb?'1u':'0u'}==0u)`));
  }
  assert.throws(()=>specializeFractal(source,-1,false));
});
test('pipeline cache separates formula/depth variants, shares in-flight work and keeps explicit bindings',async()=>{
  const engine=Object.create(BrowserEngine.prototype),codes=[],layouts=[];engine.pipelines=new Map();engine.arithmeticSource='';engine.arithmeticGuard={};
  engine.compile=async code=>{codes.push(code);return {};};engine.computePipeline=async descriptor=>descriptor;
  engine.device={createBindGroupLayout:descriptor=>{layouts.push(descriptor);return descriptor;},createPipelineLayout:descriptor=>descriptor};
  const a=engine.options(view,{}),b=engine.options({...view,fractal:'julia'},{}),deep=engine.options({...view,span:'1e-10'},{});
  const [first,shared]=await Promise.all([engine.pipeline(a),engine.pipeline(a)]);assert.equal(first,shared);assert.equal(codes.length,1);
  await engine.pipeline(b);await engine.pipeline(deep);assert.equal(codes.length,3);assert.equal(engine.pipelines.size,3);
  assert.equal(layouts[0].entries.length,6);assert.equal(layouts[1].entries[0].binding,0);assert.equal(first.compute.constants.PAIRED,true);
});
function runtimeEngine(error){
  const engine=Object.create(BrowserEngine.prototype),calls=[];let destroyed=0,replaced=0;
  const context={createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData:()=>calls.push('painted')};
  const replacement={getContext:kind=>kind==='2d'?context:null};
  engine.canvas={getContext:()=>null,cloneNode:()=>replacement,replaceWith:node=>{assert.equal(node,replacement);replaced++;}};
  engine.onCanvasChange=node=>calls.push(node);engine.device={limits:{maxTextureDimension2D:4096,maxStorageBufferBindingSize:16777216,maxBufferSize:16777216},destroy:()=>destroyed++};
  engine.version=0;engine.gpu=true;engine.last={field:true};engine.pipelines=new Map();engine.packets=new Map();engine.palettes=[{colors:['#000000','#ffffff']}];
  engine.renderGPU=async()=>{throw error;};
  engine.worker={async call(method,...args){calls.push([method,...args]);return {field:new Float32Array(args[1]*args[2]).fill(3),metadata:{width:args[1],height:args[2],color_origin:0,backend:'cpu'}};}};
  return {engine,calls,replacement,destroyed:()=>destroyed,replaced:()=>replaced};
}
test('runtime driver failure replaces the locked GPU canvas and preserves explicit render dimensions',async()=>{
  const t=runtimeEngine(internal());const result=await t.engine.render(view,32,24);
  assert.equal(t.engine.gpu,false);assert.equal(t.destroyed(),1);assert.equal(t.replaced(),1);assert.equal(t.engine.canvas,t.replacement);
  assert.deepEqual(t.calls[1],['cpu',view,32,24,'none']);assert.equal(result.field.length,32*24);assert.equal((await t.engine.readField())[0],3);
  t.engine.paint(0,1,0);assert.ok(t.calls.includes('painted'));
});
test('main-view backend notification can reschedule at CPU budget before oversized CPU work starts',async()=>{
  const t=runtimeEngine(internal());t.engine.onBackendChange=()=>t.engine.cancel();
  await assert.rejects(t.engine.render(view,1000,1000),{name:'AbortError'});
  assert.equal(t.engine.gpu,false);assert.equal(t.calls.filter(c=>Array.isArray(c)&&c[0]==='cpu').length,0);
});
test('a GPU failure refuses supersampled work above CPU limits before allocating its fallback field',async()=>{
  const t=runtimeEngine(internal());
  t.engine.device.limits={maxTextureDimension2D:8192,maxStorageBufferBindingSize:134217728,maxBufferSize:134217728};
  await assert.rejects(t.engine.render(view,4512,5008),/dimensions.*4096/i);
  assert.equal(t.engine.gpu,false);
  assert.equal(t.calls.filter(c=>Array.isArray(c)&&c[0]==='cpu').length,0);
});
test('cancellation, validation and numeric repair failures never silently change backends',async()=>{
  for(const error of [new DOMException('cancel','AbortError'),Object.assign(new Error('bad shader'),{reason:'validation'}),new Error('Precision repair needs 5000 pixels')]){
    const t=runtimeEngine(error);await assert.rejects(t.engine.render(view,32,24),value=>value===error);assert.equal(t.engine.gpu,true);assert.equal(t.destroyed(),0);
  }
});
test('a superseded GPU failure does not switch the current view to CPU',async()=>{
  const t=runtimeEngine(internal());t.engine.renderGPU=async()=>{t.engine.cancel();throw internal();};
  await assert.rejects(t.engine.render(view,32,24),{name:'AbortError'});assert.equal(t.engine.gpu,true);
});

test('startup preflights the selected formula before claiming a GPU canvas',async()=>{
  const engine=Object.create(BrowserEngine.prototype),contexts=[],options=[];
  engine.worker={call:async()=>true};engine.canvas={getContext:kind=>{contexts.push(kind);return {};}};
  engine.initArithmetic=async()=>{};engine.pipeline=async value=>{options.push(value);throw internal();};
  let destroyed=false;
  const device={lost:new Promise(()=>{}),destroy:()=>{destroyed=true;}};
  const original=Object.getOwnPropertyDescriptor(navigator,'gpu');
  Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:async()=>({requestDevice:async()=>device})}});
  try {
    const hardware=await engine.init({initialView:{...view,fractal:'julia',span:'1e-20'},settings:{arithmetic:'double-single'}});
    assert.equal(hardware.gpu,false);assert.equal(destroyed,true);assert.deepEqual(contexts,['2d']);
    assert.equal(options[0].kind,1);assert.equal(options[0].perturb,true);assert.equal(options[0].arithmetic,'double-single');
  } finally {if(original)Object.defineProperty(navigator,'gpu',original);else delete navigator.gpu;}
});
test('superseding a compiling deep view prevents obsolete worker preparation',async()=>{
  const t=runtimeEngine(internal());delete t.engine.renderGPU;
  t.engine.ensureOutput=()=>{};t.engine.resetStats=()=>{};t.engine.pipeline=async()=>{t.engine.cancel();};
  t.engine.packet=async()=>{throw new Error('Obsolete preparation should not run');};
  await assert.rejects(t.engine.render({...view,span:'1e-40'},32,24),{name:'AbortError'});assert.equal(t.engine.gpu,true);
});
