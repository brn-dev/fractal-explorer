import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDimensions, renderLimits, validateDimensions } from '../src/resolution.mjs';

const gpuLimits = { maxTextureDimension2D: 8192, maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456 };
const limits = renderLimits(gpuLimits);

test('higher quality really renders above the old width cap, including an 8K-sized field', () => {
  for (const scale of [2, 3, 4]) {
    const size = renderDimensions(1920, 1080, scale, { gpu: true, limits });
    assert.deepEqual(size, { width: 1920 * scale, height: 1080 * scale, capped: false });
    validateDimensions(size.width, size.height, limits);
  }
});

test('dimensions fit storage, texture, and pixel budgets in both orientations', () => {
  const constrained = renderLimits({ ...gpuLimits, maxTextureDimension2D: 2048, maxBufferSize: 4 * 1048576 });
  assert.equal(constrained.maxPixels, 1048576);
  for (const [width, height] of [[1920, 1080], [1080, 1920], [3840, 2160], [1, 20000], [20000, 1], [100000, 100000]]) {
    for (const quality of [.5, 1, 1.5, 2, 3, 4]) {
      const result = renderDimensions(width, height, quality, { gpu: true, limits: constrained });
      assert.ok(result.width <= 2048 && result.height <= 2048);
      assert.ok(result.width * result.height <= 1048576);
      validateDimensions(result.width, result.height, constrained);
    }
  }
  assert.throws(() => validateDimensions(8192, 8192, limits));
  assert.throws(() => validateDimensions(8193, 16, limits));
  assert.throws(() => validateDimensions(NaN, 16, limits));
});

test('mobile and CPU high quality increase detail within smaller budgets', () => {
  for (const device of [{ gpu: true, mobile: true, limits }, { gpu: false, limits: renderLimits() }]) {
    const native = renderDimensions(1920, 1080, 1, device);
    const extreme = renderDimensions(1920, 1080, 4, device);
    assert.ok(extreme.width * extreme.height > native.width * native.height);
    assert.ok(native.width * native.height <= (device.gpu ? 1500000 : 120000));
    assert.ok(extreme.width * extreme.height <= (device.gpu ? 6000000 : 960000));
    assert.equal(extreme.capped, true);
  }
});

test('ordinary quality retains its budget and unrecognized saved values use Native', () => {
  const options = { gpu: true, limits };
  const native = renderDimensions(3840, 2160, 1, options);
  assert.equal(native.width, 2560);
  assert.ok(native.width * native.height <= 8000000);
  assert.deepEqual(renderDimensions(3840, 2160, 'unknown', options), native);
});
