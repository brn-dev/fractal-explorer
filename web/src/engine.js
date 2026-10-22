import arithmetic from './arithmetic.wgsl?raw';
import fractal from './fractal.wgsl?raw';
import color from './color.wgsl?raw';
import customMath from './custom.wgsl?raw';
import { compileFormula, compileCustomInputs, customInputExpressions } from './custom-formula.mjs';
import { customConstantNames } from './custom-constants.mjs';
import { validate, decimal, order } from './decimal.mjs';
import { packWide } from './wide.mjs';
import { renderLimits, validateDimensions } from './resolution.mjs';

import { kinds } from './fractals.mjs';
import { sampleField } from './audio/reactive-analysis.mjs';
const now = () => performance.now();
const makeAbort = () => new DOMException('A newer view is ready.', 'AbortError');

class WorkerClient {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.next = 0; this.pending = new Map();
    this.worker.onmessage = ({ data }) => {
      const promise = this.pending.get(data.id); if (!promise) return;
      this.pending.delete(data.id);
      data.error ? promise.reject(new Error(data.error)) : promise.resolve(data.result);
    };
    this.worker.onerror = event => {
      for (const promise of this.pending.values()) promise.reject(new Error(event.message || 'The computation worker stopped.'));
      this.pending.clear();
    };
  }
  call(method, ...args) {
    return new Promise((resolve, reject) => {
      const id = ++this.next; this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args });
    });
  }
  close() {
    this.worker.terminate();
    for (const promise of this.pending.values()) promise.reject(makeAbort());
    this.pending.clear();
  }
}

export class BrowserEngine {
  constructor(canvas, palettes) {
    this.canvas = canvas; this.palettes = palettes; this.worker = new WorkerClient();
    this.packets = new Map(); this.pipelines = new Map(); this.version = 0;
    this.mobile = matchMedia('(pointer:coarse)').matches;
    this.paletteIndex = -1; this.last = null;
  }
  async init({ forceCPU = false } = {}) {
    await this.worker.call('init');
    if (this.destroyed) throw makeAbort();
    try {
      if (forceCPU) throw new Error('CPU fallback requested.');
      if (!navigator.gpu) throw new Error('WebGPU is unavailable in this browser.');
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('No WebGPU adapter is available.');
      this.device = await adapter.requestDevice();
      if (this.destroyed) throw makeAbort();
      this.deviceName = adapter.info?.description || [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' ') || 'Local GPU';
      this.device.lost.then(info => { this.lost = info.message || 'GPU device lost. Reload to reconnect.'; });
      this.module = await this.compile(arithmetic + '\n' + fractal);
      this.colorModule = await this.compile(color);
      this.colorPipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module: this.colorModule, entryPoint: 'vertex' }, fragment: { module: this.colorModule, entryPoint: 'fragment', targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] }, primitive: { topology: 'triangle-list' } });
      await this.probeArithmetic();
      if (this.destroyed) throw makeAbort();
      // Check availability before claiming the canvas, so a failed GPU setup can use 2D.
      this.context = this.canvas.getContext('webgpu');
      this.context.configure({ device: this.device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
      this.colorUniform = this.buffer(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      this.paletteBuffer = this.buffer(4096 * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.gpu = true;
      return { gpu: true, device: this.deviceName, paired: this.pairedOK };
    } catch (error) {
      if (this.destroyed) { this.device?.destroy(); throw makeAbort(); }
      this.gpuError = error.message;
      this.device?.destroy(); this.device = null;
      this.cpuContext = this.canvas.getContext('2d', { alpha: false });
      if (!this.cpuContext) throw new Error(`Cannot initialize a drawing context: ${error.message}`);
      this.gpu = false;
      return { gpu: false, device: 'Local CPU · WebAssembly worker', error: error.message };
    }
  }
  async compile(code) {
    const module = this.device.createShaderModule({ code });
    const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(errors.map(m => `Shader line ${m.lineNum}: ${m.message}`).join('\n'));
    return module;
  }
  buffer(size, usage, data) {
    const b = this.device.createBuffer({ size: Math.max(4, Math.ceil(size / 4) * 4), usage });
    if (data) this.device.queue.writeBuffer(b, 0, data);
    return b;
  }
  async probeArithmetic() {
    const cases = [[1, 2 ** -30, 1, -(2 ** -31)], [.9999999403953552, 2 ** -49, .5000000596046448, -(2 ** -48)], [1.0000001192092896, 0, .9999998807907104, 0], [-.8123456239700317, 1e-9, .7333332896232605, -2e-9]];
    const source = arithmetic + `\n@group(0) @binding(0) var<storage,read> input:array<vec4f>;\n@group(0) @binding(1) var<storage,read_write> output:array<vec4f>;\n@compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3u){let v=input[id.x];output[id.x]=vec4f(ra(v.xy,v.zw),rm(v.xy,v.zw));}\n@compute @workgroup_size(1) fn coordinate_probe(@builtin(global_invocation_id) id:vec3u){let v=input[id.x];output[id.x]=vec4f(rd(v.xy,v.zw),0,0);}`;
    const module = await this.compile(source);
    const pipeline = await this.device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'probe', constants: { PAIRED: true } } });
    const values = new Float32Array(cases.flat());
    const input = this.buffer(values.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, values);
    const output = this.buffer(values.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const read = this.buffer(values.byteLength, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    try {
      const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [input, output].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(cases.length); pass.end();
      encoder.copyBufferToBuffer(output, 0, read, 0, values.byteLength); this.device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ); const got = new Float32Array(read.getMappedRange().slice(0)); read.unmap();
      this.pairedOK = cases.every((_, k) => {
        const a = values[4 * k] + values[4 * k + 1], b = values[4 * k + 2] + values[4 * k + 3];
        return Math.abs(got[4 * k] + got[4 * k + 1] - (a + b)) < 2e-13 && Math.abs(got[4 * k + 2] + got[4 * k + 3] - a * b) < 2e-13;
      });
      const coordinateValues = new Float32Array([-959.5,0,1920,0,-539.5,0,1920,0,.5,0,4096,0,1.5,0,3001,0]);
      const coordinatePipeline = await this.device.createComputePipelineAsync({ layout:'auto',compute:{module,entryPoint:'coordinate_probe',constants:{PAIRED:true}} });
      this.device.queue.writeBuffer(input,0,coordinateValues);
      const coordinateGroup = this.device.createBindGroup({layout:coordinatePipeline.getBindGroupLayout(0),entries:[input,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
      const coordinateEncoder=this.device.createCommandEncoder(), coordinatePass=coordinateEncoder.beginComputePass();
      coordinatePass.setPipeline(coordinatePipeline);coordinatePass.setBindGroup(0,coordinateGroup);coordinatePass.dispatchWorkgroups(4);coordinatePass.end();
      coordinateEncoder.copyBufferToBuffer(output,0,read,0,values.byteLength);this.device.queue.submit([coordinateEncoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);const coords=new Float32Array(read.getMappedRange().slice(0));read.unmap();
      this.pairedOK &&= [0,1,2,3].every(k=>Math.abs(coords[4*k]+coords[4*k+1]-coordinateValues[4*k]/coordinateValues[4*k+2])<2e-13);
      if (!this.pairedOK) throw new Error('GPU paired-arithmetic probes failed. Using the CPU worker for accuracy.');
    } finally { input.destroy(); output.destroy(); read.destroy(); }
  }
  cancel() { this.version++; }
  get renderLimits() { return renderLimits(this.gpu ? this.device.limits : null); }
  options(view, settings) {
    settings = { arithmetic:'auto',range_mode:'auto',acceleration:'auto',...settings };
    const depth = order(decimal(view.span));
    const perturb = ['mandelbrot', 'julia'].includes(view.fractal) && depth < -7;
    const arithmetic = settings.arithmetic === 'fp32' ? 'fp32' : 'double-single';
    const extended = perturb && (settings.range_mode === 'floatexp' || settings.range_mode === 'scaled' || depth < -15);
    if (settings.range_mode === 'standard' && perturb && depth < -15) throw new Error('Standard exponent range is unsafe here. Select Auto or extended range.');
    const acceleration = !perturb ? 'none' : settings.acceleration === 'auto' ? (depth < -15 ? 'series' : 'none') : settings.acceleration;
    return { perturb, arithmetic, extended, acceleration, custom: view.fractal === 'custom' ? { formula: view.custom_formula, inputs: customInputExpressions(view) } : null };
  }
  async pipeline(options) {
    const key = JSON.stringify([options.arithmetic, options.extended, options.custom]);
    if (!this.pipelines.has(key)) {
      let module = this.module;
      if (options.custom) {
        const inputCode = compileCustomInputs({ custom_mode: 'advanced', custom_inputs: options.custom.inputs }).wgsl;
        const code = fractal.replace(/fn custom_step[^\n]+/, customMath + '\n' + compileFormula(options.custom.formula).wgsl).replace(/fn custom_initial[^\n]+/, inputCode);
        module = await this.compile(arithmetic + '\n' + code);
      }
      this.pipelines.set(key, await this.device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'iterate', constants: { PAIRED: options.arithmetic !== 'fp32', EXTENDED: options.extended } } }));
      while (this.pipelines.size > 16) this.pipelines.delete(this.pipelines.keys().next().value);
    }
    return this.pipelines.get(key);
  }
  async packet(view, width, height, options, anchor) {
    if (!options.perturb) return { reference: this.emptyReference ??= this.buffer(48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, new Uint8Array(48)), series: this.emptySeries ??= this.buffer(32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, new Uint8Array(32)), maps: this.emptyMaps ??= this.buffer(80, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, new Uint8Array(80)), length: 1, span: this.numberWide(Number(view.span)), seriesN: 0, seriesOrder: 0, offsets: [], logDc: -1e30, timings: {}, digits: 14 };
    const cacheId = JSON.stringify([view, width, height, options.acceleration, anchor]);
    if (this.packetIds?.has(cacheId) && this.packets.has(this.packetIds.get(cacheId))) {
      return { ...this.packets.get(this.packetIds.get(cacheId)), referenceHit: true, preparationHit: true, uploadHit: true, timings: { reference_ms: 0, preparation_ms: 0, upload_ms: 0 } };
    }
    const prepared = await this.worker.call('prepare', view, width, height, options.acceleration, anchor);
    this.packetIds ??= new Map();
    this.packetIds.set(cacheId, prepared.key);
    while (this.packetIds.size > 16) this.packetIds.delete(this.packetIds.keys().next().value);
    if (this.packets.has(prepared.key)) {
      const packet = this.packets.get(prepared.key); this.packets.delete(prepared.key); this.packets.set(prepared.key, packet);
      return { ...packet, timings: prepared.timings, referenceHit: prepared.referenceHit, preparationHit: prepared.preparationHit, uploadHit: true };
    }
    const start = now();
    const packet = { ...prepared,
      reference: this.buffer(prepared.reference.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, prepared.reference),
      series: this.buffer(prepared.series.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, prepared.series),
      maps: this.buffer(prepared.maps.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, prepared.maps),
      uploadHit: false };
    packet.timings.upload_ms = now() - start;
    this.packets.set(prepared.key, packet);
    while (this.packets.size > 4) { const key = this.packets.keys().next().value; const old = this.packets.get(key); old.reference.destroy(); old.series.destroy(); old.maps.destroy(); this.packets.delete(key); }
    return packet;
  }
  numberWide(number) {
    if (!number) return { m: 0, e: 0 };
    const e = Math.floor(Math.log2(Math.abs(number))) + 1; return { m: number * 2 ** -e, e };
  }
  params(view, width, height, options, packet, tile, anchor, repair) {
    const bytes = new ArrayBuffer(384), d = new DataView(bytes);
    const uint = (offset, value) => d.setUint32(offset, value, true), float = (offset, value) => d.setFloat32(offset, value, true);
    uint(0, width); uint(4, height); uint(8, view.iterations); uint(12, kinds.indexOf(view.fractal)); float(16, view.bailout); uint(20, options.perturb ? 1 : 0); uint(24, packet.seriesN); uint(28, packet.seriesOrder);
    packWide(d, 32, packet.span);
    [view.x, view.y, view.julia_x, view.julia_y].forEach((v, k) => { const x = Number(v), hi = Math.fround(x); float(48 + k * 8, hi); float(52 + k * 8, x - hi); });
    float(80, anchor ? anchor.col + .5 : width / 2); float(84, anchor ? anchor.row + .5 : height / 2);
    tile.forEach((v, k) => uint(96 + k * 4, v)); uint(112, repair ? 1 : 0); uint(120, packet.offsets.length);
    float(128, Number.isFinite(packet.logDc) ? packet.logDc : -1e30); float(132, Math.log2(1e-7));
    packet.offsets.forEach((v, k) => uint(144 + k * 4, v));
    float(208, view.power ?? 2);
    for (const [offset, value] of [[212, view.memory ?? 0], [224, view.relaxation ?? 1]]) {
      const hi = Math.fround(value); float(offset, hi); float(offset + 4, value - hi);
    }
    customConstantNames.forEach((name, index) => {
      const value = Number(view[name] ?? 1), hi = Math.fround(value);
      float(240 + index * 8, hi); float(244 + index * 8, value - hi);
    });
    return bytes;
  }
  ensureOutput(width, height) {
    if (this.width === width && this.height === height && this.output) return;
    this.output?.destroy(); this.stats?.destroy(); this.readStats?.destroy(); this.uniform?.destroy(); this.cpuField = null;
    this.width = width; this.height = height;
    this.output = this.buffer(width * height * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    this.stats = this.buffer(32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    this.readStats = this.buffer(32, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.uniform = this.buffer(384, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  }
  resetStats() {
    const initial = new Uint32Array(8); initial[1] = 0xffffffff; initial[2] = 0x7f7fffff;
    this.device.queue.writeBuffer(this.stats, 0, initial);
  }
  async readStatistics() {
    const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(this.stats, 0, this.readStats, 0, 32); this.device.queue.submit([encoder.finish()]);
    await this.readStats.mapAsync(GPUMapMode.READ); const result = new Uint32Array(this.readStats.getMappedRange().slice(0)); this.readStats.unmap(); return result;
  }
  async dispatch(view, width, height, options, packet, tile, token, anchor, repair = false) {
    const pipeline = await this.pipeline(options);
    const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [this.uniform, packet.reference, packet.series, packet.maps, this.output, this.stats].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const remaining = Math.max(1, view.iterations - packet.seriesN);
    const target = this.mobile ? 2e7 : 2e10;
    const rows = Math.min(tile[3], Math.max(4, Math.floor(target / (tile[2] * remaining * (options.extended ? 4 : 1)))));
    const started = now();
    for (let y = tile[1]; y < tile[1] + tile[3]; y += rows) {
      if (token !== this.version) throw makeAbort();
      const h = Math.min(rows, tile[1] + tile[3] - y);
      this.device.queue.writeBuffer(this.uniform, 0, this.params(view, width, height, options, packet, [tile[0], y, tile[2], h], anchor, repair));
      const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(tile[2] / 8), Math.ceil(h / 8)); pass.end();
      this.device.queue.submit([encoder.finish()]);
      // Bound each submission for mobile watchdogs and give newer navigation a turn.
      await this.device.queue.onSubmittedWorkDone();
      if (this.lost) throw new Error(this.lost);
    }
    return now() - started;
  }
  async render(view, width, height, settings = {}) {
    view = validate(view);
    validateDimensions(width, height, this.renderLimits);
    const token = ++this.version, start = now(), options = this.options(view, settings);
    if (!this.gpu) {
      const result = await this.worker.call('cpu', view, width, height, options.acceleration === 'none' ? 'none' : 'series');
      if (token !== this.version) throw makeAbort();
      this.last = result; return result;
    }
    if (this.lost) throw new Error(this.lost);
    this.ensureOutput(width, height); this.resetStats();
    const compileStart = now(); await this.pipeline(options); const compilation = now() - compileStart;
    const packet = await this.packet(view, width, height, options);
    let kernel = await this.dispatch(view, width, height, options, packet, [0, 0, width, height], token);
    let stats = await this.readStatistics(), repairs = 0, referenceRepairs = 0, repairMs = 0;
    let minimum = new Float32Array(stats.buffer)[2];
    const nativeSteps = stats[4] + stats[5] * 4294967296, skipped = stats[6] + stats[7] * 4294967296;
    if (stats[0]) {
      const repairStart = now();
      // Download the field only when a precision glitch needs investigation.
      let values = await this.readField();
      const tiles = new Map();
      for (let id = 0; id < values.length; id++) if (values[id] === -2) {
        const col = id % width, row = Math.floor(id / width), tx = Math.floor(col / 128), ty = Math.floor(row / 128);
        const key = `${tx},${ty}`; if (!tiles.has(key)) tiles.set(key, { x: tx * 128, y: ty * 128, col, row });
      }
      // A capped set of new reference tiles handles widespread cancellation cheaply.
      for (const tile of [...tiles.values()].slice(0, 16)) {
        if (token !== this.version) throw makeAbort();
        const repairOptions = { ...options, arithmetic: 'double-single', acceleration: 'none' };
        const anchor = { col: tile.col, row: tile.row };
        const extra = await this.packet(view, width, height, repairOptions, anchor);
        this.resetStats();
        kernel += await this.dispatch(view, width, height, repairOptions, extra, [tile.x, tile.y, Math.min(128, width - tile.x), Math.min(128, height - tile.y)], token, anchor, true);
        referenceRepairs++;
      }
      values = await this.readField();
      const points = [], ids = [];
      for (let id = 0; id < values.length; id++) if (values[id] === -2) { points.push([id % width, Math.floor(id / width)]); ids.push(id); }
      if (points.length > 4096) throw new Error(`Precision repair needs ${points.length.toLocaleString()} pixels. Reduce quality or move slightly; no incomplete image was accepted.`);
      if (points.length) {
        const exact = await this.worker.call('exact', view, points, width, height);
        if (token !== this.version) throw makeAbort();
        ids.forEach((id, k) => { values[id] = exact.values[k]; });
        this.device.queue.writeBuffer(this.output, 0, values);
      }
      minimum = Infinity; for (const v of values) if (v >= 0) minimum = Math.min(minimum, v);
      repairs = stats[0]; this.cpuField = values; repairMs = now() - repairStart;
    }
    const metadata = { width, height, backend: 'webgpu', arithmetic: options.arithmetic, range_mode: options.extended ? 'scaled' : 'standard', acceleration: options.acceleration, perturbation: options.perturb,
      digits: packet.digits, repaired: repairs, reference_repairs: referenceRepairs, color_origin: view.fractal === 'newton' ? 0 : Number.isFinite(minimum) && minimum < 1e30 ? minimum : 0,
      elapsed_ms: now() - start, reference_cache_hit: packet.referenceHit, preparation_cache_hit: packet.preparationHit, device_cache_hit: packet.uploadHit,
      mean_native_steps: nativeSteps / (width * height), mean_skipped_steps: skipped / (width * height), series_prefix: packet.seriesN,
      timings: { ...packet.timings, compile_ms: compilation, kernel_ms: kernel, repair_ms: repairMs }, experimental: options.arithmetic === 'fp32' };
    this.last = { field: true, metadata }; return this.last;
  }
  async readField() {
    if (!this.gpu) return this.last.field.slice();
    const bytes = this.width * this.height * 4;
    const read = this.buffer(bytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    try {
      const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(this.output, 0, read, 0, bytes); this.device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ); const result = new Float32Array(read.getMappedRange().slice(0)); read.unmap(); return result;
    } finally { read.destroy(); }
  }
  async readAudioSamples() {
    if (!this.last) return null;
    const { width, height } = this.last.metadata;
    if (!this.gpu) return sampleField(this.last.field,width,height);
    // Gather 32 x 32 scalar samples on the GPU. Only 4 KiB crosses the bus,
    // once per new static field; palette-only paints never call this method.
    if (!this.audioSamplePipeline) {
      const module = this.device.createShaderModule({ code: `
        @group(0) @binding(0) var<storage,read> field:array<f32>;
        @group(0) @binding(1) var<storage,read_write> samples:array<f32>;
        @group(0) @binding(2) var<uniform> size:vec2u;
        @compute @workgroup_size(8,8) fn sample(@builtin(global_invocation_id) id:vec3u) {
          if(id.x>=32u || id.y>=32u){return;}
          let x=min(size.x-1u,(2u*id.x+1u)*size.x/64u);
          let y=min(size.y-1u,(2u*id.y+1u)*size.y/64u);
          samples[id.y*32u+id.x]=field[y*size.x+x];
        }` });
      this.audioSamplePipeline = this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'sample' } });
    }
    const output = this.buffer(4096,GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const read = this.buffer(4096,GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const size = this.buffer(8,GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,new Uint32Array([width,height]));
    try {
      const group = this.device.createBindGroup({ layout: this.audioSamplePipeline.getBindGroupLayout(0), entries: [this.output,output,size].map((buffer,binding) => ({ binding, resource: { buffer } })) });
      const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(this.audioSamplePipeline); pass.setBindGroup(0,group); pass.dispatchWorkgroups(4,4); pass.end();
      encoder.copyBufferToBuffer(output,0,read,0,4096); this.device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const samples = new Float32Array(read.getMappedRange().slice(0)); read.unmap(); return samples;
    } finally { output.destroy(); read.destroy(); size.destroy(); }
  }
  presentCached(field, metadata) {
    if (this.gpu) {
      this.ensureOutput(metadata.width, metadata.height);
      this.device.queue.writeBuffer(this.output, 0, field);
    }
    this.last = { field: this.gpu ? true : field, metadata };
  }
  palette(index) {
    const colors = this.palettes[index].colors.map(s => s.match(/[0-9a-f]{2}/gi).map(v => parseInt(v, 16)));
    const data = new Float32Array(4096 * 4);
    for (let i = 0; i < 4096; i++) {
      const t = i / 4096 * (colors.length - 1), k = Math.floor(t), f = t - k;
      for (let axis = 0; axis < 3; axis++) data[4 * i + axis] = (colors[k][axis] * (1 - f) + colors[k + 1][axis] * f) / 255;
      data[4 * i + 3] = 1;
    }
    return data;
  }
  paint(palette, density, phase) {
    if (!this.last) return;
    const meta = this.last.metadata;
    if (this.canvas.width !== meta.width) this.canvas.width = meta.width;
    if (this.canvas.height !== meta.height) this.canvas.height = meta.height;
    if (!this.gpu) {
      const image = this.cpuContext.createImageData(meta.width, meta.height), table = this.palette(palette), values = this.last.field;
      for (let i = 0; i < values.length; i++) {
        const n = values[i], t = ((Math.log1p(Math.max(0, n - meta.color_origin)) * .2 * density + phase) % 1 + 1) % 1, k = Math.min(4095, Math.floor(t * 4096));
        for (let a = 0; a < 3; a++) image.data[4 * i + a] = n < 0 ? [8, 17, 18][a] : Math.round(table[k * 4 + a] * 255);
        image.data[4 * i + 3] = 255;
      }
      this.cpuContext.putImageData(image, 0, 0); return;
    }
    if (this.paletteIndex !== palette || this.paletteDefinition !== this.palettes[palette]) {
      this.device.queue.writeBuffer(this.paletteBuffer, 0, this.palette(palette));
      this.paletteIndex = palette; this.paletteDefinition = this.palettes[palette];
    }
    const bytes = new ArrayBuffer(48), d = new DataView(bytes);
    d.setUint32(0, meta.width, true); d.setUint32(4, meta.height, true); d.setFloat32(8, density, true); d.setFloat32(12, phase, true); d.setFloat32(16, meta.color_origin, true);
    this.device.queue.writeBuffer(this.colorUniform, 0, bytes);
    const group = this.device.createBindGroup({ layout: this.colorPipeline.getBindGroupLayout(0), entries: [this.colorUniform, this.output, this.paletteBuffer].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const encoder = this.device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: .03, g: .06, b: .07, a: 1 } }] });
    pass.setPipeline(this.colorPipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end(); this.device.queue.submit([encoder.finish()]);
  }
  async clearCaches() {
    for (const p of this.packets.values()) { p.reference.destroy(); p.series.destroy(); p.maps.destroy(); }
    this.packets.clear(); this.packetIds?.clear(); await this.worker.call('clear');
  }
  destroy() { this.destroyed = true; this.cancel(); this.worker.close(); this.device?.destroy(); }
}
