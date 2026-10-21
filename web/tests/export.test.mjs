import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePhase, animationFrames, colorCycle, juliaView, wrapPhase } from '../src/export-utils.mjs';
import { add, compare, decimal, text } from '../src/decimal.mjs';

test('normal-view wandering speed keeps the same phase at different frame rates', () => {
  for (const fps of [5, 30, 60, 144]) {
    let phase = .8;
    for (let frame = 0; frame < fps * 3; frame++) phase = advancePhase(phase, .12, 1 / fps);
    assert.ok(Math.abs(phase - .16) < 1e-12);
  }
  assert.ok(Math.abs(advancePhase(.8, .12, 3) - .16) < 1e-12);
});

test('a color GIF completes a full cycle at the chosen speed within GIF timing precision', () => {
  for (const speed of [.05, .12, .33, .57, 1, 1.99, 2]) {
    const cycle = colorCycle(.25, speed);
    const delays = Array.from({ length: cycle.frames }, (_, i) => cycle.delay(i));
    assert.ok(delays.every(delay => delay >= 40 && delay <= 60 && delay % 10 === 0));
    assert.equal(delays.reduce((a, b) => a + b, 0), cycle.duration * 1000);
    assert.ok(Math.abs(cycle.duration - 1 / speed) <= .005001);
    assert.ok(cycle.frames >= 10 && cycle.frames <= 400);
  }
});

test('phase controls wrap across the loop seam without a duplicate end frame', () => {
  const cycle = colorCycle(.975, .12);
  const phases = Array.from({ length: cycle.frames }, (_, i) => cycle.phase(i));
  assert.ok(Math.abs(phases[0] - .975) < 1e-12);
  assert.ok(phases.every(phase => phase >= 0 && phase < 1));
  assert.equal(new Set(phases).size, cycle.frames);
  for (let i = 0; i < phases.length; i++) {
    const next = phases[(i + 1) % phases.length];
    assert.ok(Math.abs(wrapPhase(next - phases[i]) - 1 / phases.length) < 1e-12);
  }
  assert.equal(colorCycle(1, 1).phase(0), 0);
  assert.equal(wrapPhase(-.25), .75);
});

test('invalid phases or speeds cannot start an unbounded export', () => {
  for (const phase of [NaN, Infinity, -.1, 1.01]) assert.throws(() => colorCycle(phase, .12));
  for (const speed of [NaN, Infinity, 0, -.1, .049, 2.01]) assert.throws(() => colorCycle(0, speed));
});

const julia = { x: '0', y: '0', span: '3.6', fractal: 'julia', julia_x: '-.8', julia_y: '.156', iterations: 800, bailout: 64 };
test('Julia paths reach exact endpoints and return smoothly while keeping the camera fixed', () => {
  const target = { x: '-.72', y: '.19' };
  assert.deepEqual(juliaView(julia, target, 0), julia);
  assert.deepEqual(juliaView(julia, target, 1), julia);
  const end = juliaView(julia, target, .5);
  assert.equal(end.julia_x, target.x); assert.equal(end.julia_y, target.y);
  assert.equal(end.x, julia.x); assert.equal(end.y, julia.y); assert.equal(end.span, julia.span);
  assert.equal(juliaView(julia, target, 1, false).julia_x, target.x);
  assert.equal(juliaView({ ...julia, fractal: 'cubic' }, target, .5).julia_y, target.y);
});

test('Julia animation preserves constant changes smaller than floating-point coordinates can represent', () => {
  const target = { x: text(add(decimal(julia.julia_x), decimal('1e-100'))), y: julia.julia_y };
  const middle = juliaView(julia, target, .25);
  assert.equal(Number(middle.julia_x), Number(julia.julia_x));
  assert.equal(compare(decimal(middle.julia_x), decimal(julia.julia_x)), 1);
  assert.equal(compare(decimal(middle.julia_x), decimal(target.x)), -1);
  assert.equal(juliaView(julia, target, .5).julia_x, target.x);
});

test('Julia duration and endpoint validation keep frames and inputs bounded', () => {
  for (const duration of [.5, 1, 6, 20]) {
    const plan = animationFrames(duration);
    assert.equal(plan.frames, duration * 20);
    assert.equal(Array.from({ length: plan.frames }, (_, i) => plan.delay(i)).reduce((a, b) => a + b), duration * 1000);
  }
  for (const duration of [0, .49, 21, NaN]) assert.throws(() => animationFrames(duration));
  assert.throws(() => juliaView(julia, { x: 'NaN', y: '0' }, .5));
  assert.throws(() => juliaView(julia, { x: '1000001', y: '0' }, .5));
  assert.throws(() => juliaView({ ...julia, fractal: 'mandelbrot' }, { x: '0', y: '0' }, .5));
});
