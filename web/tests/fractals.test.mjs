import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultView, fractals, kinds } from '../src/fractals.mjs';
import { validate, navigate } from '../src/decimal.mjs';
import { softwareRender } from '../src/software.mjs';
import { iterateAdditional, newtonColor } from '../src/formulas.mjs';
import { juliaView } from '../src/export-utils.mjs';
import { readFile } from 'node:fs/promises';

const base = { x: '-.5', y: '0', span: '3.6', fractal: 'mandelbrot', iterations: 800, bailout: 64, julia_x: '-.7269', julia_y: '.1889' };
const added = kinds.slice(5);
const oracle = JSON.parse(await readFile(new URL('./families-oracle.json', import.meta.url), 'utf8'));

test('formula IDs preserve existing shaders and every new default validates', () => {
  assert.deepEqual(kinds.slice(0, 5), ['mandelbrot', 'julia', 'burning-ship', 'tricorn', 'cubic']);
  assert.equal(added.length, 5);
  for (const kind of added) {
    const view = defaultView(base, kind);
    assert.deepEqual(validate(view), view);
    for (const p of fractals[kind].parameters ?? []) {
      assert.throws(() => validate({ ...view, [p.key]: p.min - 1 }));
      assert.throws(() => validate({ ...view, [p.key]: p.max + 1 }));
      assert.throws(() => validate({ ...view, [p.key]: NaN }));
      if (p.step === 1) assert.throws(() => validate({ ...view, [p.key]: p.min + .5 }));
      assert.equal(validate({ ...view, [p.key]: undefined })[p.key], view[p.key]);
    }
    assert.throws(() => validate({ ...view, span: '1e-11' }));
    assert.equal(Number(navigate({ view: { ...view, span: '1e-10' }, factor: 2 }).span), 1e-10);
    assert.deepEqual(validate(JSON.parse(JSON.stringify(view))), view);
  }
  assert.throws(() => validate({ ...base, fractal: '__proto__' }));
});

for (const kind of added) test(`independent 80/120-digit oracle: ${kind}`, async () => {
  for (const c of oracle.cases.filter(c => c.view.fractal === kind)) {
    const got = await softwareRender(c.view, c.width, c.height);
    c.points.forEach(([x, y], k) => assert.ok(Math.abs(got.field[y * c.width + x] - c.expected[k]) < .002, `${c.name} pixel ${x},${y}: ${got.field[y * c.width + x]} vs ${c.expected[k]}`));
    assert.ok(got.field.every(Number.isFinite));
    assert.equal(got.metadata.perturbation, false);
    if (kind === 'newton') assert.equal(got.metadata.color_origin, 0);
  }
});

test('special parameter values reduce to existing formulas', async () => {
  const pairs = [
    [{ ...base, fractal: 'multibrot', power: 2 }, base],
    [{ ...base, fractal: 'multijulia', power: 3 }, { ...base, fractal: 'cubic' }],
    [{ ...base, fractal: 'phoenix', memory: 0 }, { ...base, fractal: 'julia' }],
  ];
  for (const [a, b] of pairs) {
    const x = await softwareRender(a, 27, 19), y = await softwareRender(b, 27, 19);
    x.field.forEach((value, i) => assert.ok(Math.abs(value - y.field[i]) < .002));
  }
});

test('Newton recognizes each root, handles a singular derivative, and colors convergence', () => {
  const v = defaultView(base, 'newton');
  for (let k = 0; k < 3; k++) {
    const angle = 2 * Math.PI * k / 3;
    const got = iterateAdditional(v, Math.cos(angle), Math.sin(angle));
    assert.ok(Math.abs(Math.log1p(got) * .2 - k / 3) < 1e-12);
  }
  assert.equal(iterateAdditional(v, 0, 0), -1);
  assert.equal(iterateAdditional({ ...v, julia_x: '0' }, 0, 0), 0);
  assert.equal(newtonColor(-.1, .2, 0, 0, 3, 20), newtonColor(.1, -.2, 0, 0, 3, 20));
  assert.ok(newtonColor(1, 0, 1, 0, 3, 20) > newtonColor(1, 0, 1, 0, 3, 2));
  const r = Math.sqrt(2), c = { ...v, power: 4, julia_x: '4' };
  assert.equal(iterateAdditional(c, r, 0), 0);
});

test('new constant families can evolve in GIFs without changing their other parameters', () => {
  for (const kind of added.filter(kind => fractals[kind].constant)) {
    const v = defaultView(base, kind), target = { x: '.1234567890123456789012345', y: '-.2' };
    const end = juliaView(v, target, .5, true);
    assert.equal(end.julia_x, target.x); assert.equal(end.julia_y, target.y);
    for (const p of fractals[kind].parameters ?? []) assert.equal(end[p.key], v[p.key]);
    assert.deepEqual(juliaView(v, target, 1, true), v);
  }
  assert.throws(() => juliaView(defaultView(base, 'multibrot'), { x: '0', y: '0' }, .5));
});
