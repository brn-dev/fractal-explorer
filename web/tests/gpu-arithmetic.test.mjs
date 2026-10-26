import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { arithmeticCases, coordinateCases, checkArithmetic } from '../src/gpu-arithmetic.mjs';

// Load the engine through Vite so tests exercise its actual WGSL raw imports.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const { BrowserEngine } = await server.ssrLoadModule('/src/engine.js');
const { GPUArithmeticError } = await server.ssrLoadModule('/src/gpu-arithmetic.mjs');
await server.close();
globalThis.GPUBufferUsage ??= { UNIFORM: 64, COPY_DST: 8 };

function referenceResults() {
  const values = new Float32Array(arithmeticCases.length), coordinates = new Float32Array(coordinateCases.length);
  const pair = (array, offset, value) => {
    array[offset] = value; array[offset + 1] = value - array[offset];
  };
  for (let k = 0; k < arithmeticCases.length / 4; k++) {
    const a = arithmeticCases[4 * k] + arithmeticCases[4 * k + 1];
    const b = arithmeticCases[4 * k + 2] + arithmeticCases[4 * k + 3];
    pair(values, 4 * k, a + b); pair(values, 4 * k + 2, a * b);
    pair(coordinates, 4 * k, coordinateCases[4 * k] / coordinateCases[4 * k + 2]);
  }
  return { values, coordinates };
}

test('precision probes accept paired references and detect discarded rounding corrections', () => {
  const { values, coordinates } = referenceResults();
  assert.equal(checkArithmetic(values, coordinates).passed, true);
  values[1] = 0;
  coordinates[1] = 0;
  const report = checkArithmetic(values, coordinates);
  assert.equal(report.passed, false);
  assert.ok(report.checks.some(check => !check.passed && check.operation === 'sum' && check.sample === 1));
  assert.ok(report.checks.some(check => !check.passed && check.operation === 'coordinate division'));
  assert.match(new GPUArithmeticError(report).message, /WebGPU is available.*sum #1.*coordinate division/);
});

test('precision probes reject non-finite and incomplete GPU output', () => {
  const { values, coordinates } = referenceResults();
  for (const invalid of [NaN, Infinity, -Infinity]) {
    values[2] = invalid;
    assert.equal(checkArithmetic(values, coordinates).passed, false);
  }
  assert.equal(checkArithmetic([], []).passed, false);
});

function engineWithProbes(outcomes) {
  const engine = Object.create(BrowserEngine.prototype), attempts = [], buffers = [];
  engine.buffer = (size, usage, data) => {
    const buffer = { size, usage, data }; buffers.push(buffer); return buffer;
  };
  engine.probeArithmetic = async () => {
    attempts.push(engine.arithmeticMode);
    const result = outcomes.shift();
    if (result instanceof Error) throw result;
    engine.pairedOK = result;
    if (!result) throw new GPUArithmeticError({ checks: [{ operation: 'product', sample: 1, passed: false }] });
  };
  return { engine, attempts, buffers };
}

test('passing native precision uses the original shader path with no runtime mask', async () => {
  const { engine, attempts, buffers } = engineWithProbes([true]);
  await engine.initArithmetic();
  assert.deepEqual(attempts, ['native']);
  assert.equal(engine.pairedOK, true);
  assert.equal(buffers.length, 0);
  assert.doesNotMatch(engine.arithmeticSource, /var<uniform> arithmetic_mask/);
});

test('native precision failure retries the same arithmetic with a runtime all-ones mask', async () => {
  const { engine, attempts, buffers } = engineWithProbes([false, true]);
  await engine.initArithmetic();
  assert.deepEqual(attempts, ['native', 'guarded']);
  assert.equal(engine.pairedOK, true);
  assert.match(engine.arithmeticSource, /bitcast<u32>\(x\)&arithmetic_mask/);
  assert.equal(buffers[0].data[0], 0xffffffff);
  assert.equal(buffers[0].size, 16);
});

test('guard bindings reuse each pipeline layout across tiled dispatches', () => {
  const engine = Object.create(BrowserEngine.prototype), created = [], bound = [];
  engine.arithmeticGuard = {};
  engine.device = { createBindGroup: descriptor => { created.push(descriptor); return descriptor; } };
  const first = { getBindGroupLayout: () => 'first layout' }, second = { getBindGroupLayout: () => 'second layout' };
  const pass = { setBindGroup: (index, group) => bound.push({ index, group }) };
  engine.bindArithmeticGuard(pass, first);
  engine.bindArithmeticGuard(pass, first);
  engine.bindArithmeticGuard(pass, second);
  assert.equal(created.length, 2);
  assert.equal(bound[0].group, bound[1].group);
  assert.equal(bound[2].group.layout, 'second layout');
  assert.ok(bound.every(entry => entry.index === 1 && entry.group.entries[0].resource.buffer === engine.arithmeticGuard));
});

test('a second precision failure remains a CPU fallback and other GPU errors do not retry', async () => {
  const { engine, attempts } = engineWithProbes([false, false]);
  await assert.rejects(engine.initArithmetic(), /paired precision failed.*product #1/);
  assert.deepEqual(attempts, ['native', 'guarded']);
  assert.equal(engine.pairedOK, false);
  const compileError = new Error('Shader compilation failed');
  const other = engineWithProbes([compileError]);
  await assert.rejects(other.engine.initArithmetic(), error => error === compileError);
  assert.deepEqual(other.attempts, ['native']);
});

test('failed precision destroys the GPU device and leaves the canvas available for CPU drawing', async () => {
  const { engine, attempts } = engineWithProbes([false, false]);
  const contexts = [], cpuContext = {};
  let destroyed = false;
  engine.canvas = { getContext: kind => { contexts.push(kind); return cpuContext; } };
  engine.worker = { call: async () => true };
  const device = { lost: new Promise(() => {}), destroy: () => { destroyed = true; } };
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
  Object.defineProperty(globalThis.navigator, 'gpu', { configurable: true, value: {
    requestAdapter: async () => ({ info: { description: 'Test GPU' }, requestDevice: async () => device }),
  } });
  try {
    const hardware = await engine.init();
    assert.equal(hardware.gpu, false);
    assert.equal(engine.gpu, false);
    assert.equal(destroyed, true);
    assert.deepEqual(attempts, ['native', 'guarded']);
    assert.deepEqual(contexts, ['2d']);
    assert.equal(engine.cpuContext, cpuContext);
    assert.match(hardware.error, /WebGPU is available.*product #1/);
  } finally {
    if (original) Object.defineProperty(globalThis.navigator, 'gpu', original);
    else delete globalThis.navigator.gpu;
  }
});
