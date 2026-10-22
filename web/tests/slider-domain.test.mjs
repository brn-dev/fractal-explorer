import test from 'node:test';
import assert from 'node:assert/strict';
import { sliderDomain } from '../src/slider-domain.mjs';

const constant = { decimal: true };
const iterations = { min: 50, max: 50000, step: 1 };

test('precision narrows the shared axis and gives continuous sliders finer steps', () => {
  const full = sliderDomain(constant, .2111, .2311);
  const fine = sliderDomain(constant, .2111, .2311, true);
  assert.deepEqual(full, { min: -2, max: 2, step: .0001 });
  assert.ok(Math.abs(fine.max - fine.min - .4) < 1e-12);
  assert.equal(fine.step, .00001);
  assert.ok(fine.min < .2111 && fine.max > .2311);
  const memory = sliderDomain({ min: -1, max: 1, step: .001 }, -.5, -.45, true);
  assert.equal(memory.step, .0001);
});

test('both endpoints stay on the same axis even when reversed or far apart', () => {
  for (const [a, b] of [[-.8, -.78], [.3, -.6], [-2, 2], [2.7, -5.4], [1e6, 999999], [-1e6, -999999]]) {
    for (const precise of [false, true]) {
      const domain = sliderDomain(constant, a, b, precise);
      assert.ok(domain.min <= Math.min(a, b));
      assert.ok(domain.max >= Math.max(a, b));
      assert.ok(domain.min >= -1e6 && domain.max <= 1e6);
      assert.deepEqual(domain, sliderDomain(constant, b, a, precise));
    }
  }
});

test('precision at a boundary keeps the full narrowed width inside valid limits', () => {
  const low = sliderDomain(iterations, 50, 250, true);
  assert.equal(low.min, 50);
  assert.equal(low.step, 1);
  assert.equal(low.max - low.min, 4995);
  const high = sliderDomain(iterations, 50000, 49800, true);
  assert.equal(high.max, 50000);
  assert.equal(high.max - high.min, 4995);
  for (const start of [2, 5, 8]) {
    const power = sliderDomain({ min: 2, max: 8, step: 1 }, start, start, true);
    assert.ok(Number.isInteger(power.min) && Number.isInteger(power.max));
    assert.ok(power.max - power.min >= 2);
    assert.equal(power.step, 1);
  }
});

test('a single endpoint near zero still gets a usable precision window', () => {
  for (const value of ['0', '1e-1000', '-1e-1000', '0.12345678901234567890123456789']) {
    const domain = sliderDomain(constant, value, undefined, true);
    assert.ok(domain.min < Number(value) && domain.max > Number(value));
    assert.ok(domain.max - domain.min > domain.step);
    assert.deepEqual(sliderDomain(constant, value), { min: -2, max: 2, step: .0001 });
  }
});
