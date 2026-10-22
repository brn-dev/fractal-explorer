import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFormula, parseFormula, iterateCustom, createCustomIterator } from '../src/custom-formula.mjs';
import { defaultView, hasConstant, kinds } from '../src/fractals.mjs';
import { validate, navigate } from '../src/decimal.mjs';
import { softwareRender } from '../src/software.mjs';
import { animationParameters, animationPlan } from '../src/animation.mjs';
import { createShareURL, readShareURL } from '../src/share.mjs';
import { juliaView } from '../src/export-utils.mjs';

const base = { x: '-.5', y: '0', span: '3.6', fractal: 'mandelbrot', iterations: 80, bailout: 64, julia_x: '-.7269', julia_y: '.1889' };
const custom = defaultView(base, 'custom');
const env = { z: [1, 2], z1: [3, 4], z2: [5, 6], z3: [7, 8], z4: [9, 10], c: [-.4, .2] };
const close = (got, expected) => got.forEach((v, k) => assert.ok(Math.abs(v - expected[k]) < 1e-10, `${got} vs ${expected}`));
const evaluate = text => compileFormula(text).evaluate(env);

test('custom defaults, mode, limits, and navigation validate without moving existing GPU IDs', () => {
  assert.equal(kinds[10], 'custom');
  assert.deepEqual(validate(custom), custom);
  assert.equal(validate({ ...base, fractal: 'custom' }).custom_formula, 'z^2 + c');
  assert.equal(hasConstant(custom), false);
  assert.equal(hasConstant({ ...custom, custom_mode: 'julia' }), true);
  assert.throws(() => validate({ ...custom, custom_mode: 'pixel' }), /pixel input/);
  assert.throws(() => validate({ ...custom, custom_formula: 'z.foo' }), /Unexpected/);
  assert.throws(() => validate({ ...custom, span: '1e-11' }), /widths/);
  assert.equal(Number(navigate({ view: { ...custom, span: '1e-10' }, factor: 2 }).span), 1e-10);
});

test('complex arithmetic, precedence, right-associative powers, and scientific numbers', () => {
  close(evaluate('z^2 + c'), [-3.4, 4.2]);
  close(evaluate('5*z - 2*z1 + c'), [-1.4, 2.2]);
  close(evaluate('z/z'), [1, 0]);
  close(evaluate('(1+i)*(1-i)'), [2, 0]);
  close(evaluate('2^3^2'), [512, 0]);
  close(evaluate('-2^2 + 2^-2'), [-3.75, 0]);
  close(evaluate('2**3 + 1e-3'), [8.001, 0]);
  close(evaluate('z^0 + 0^2 + pow(i, 4)'), [2, 0]);
  close(evaluate('z^-2 * z^2'), [1, 0]);
});

test('functions use complex values, principal branches, and familiar constants', () => {
  close(evaluate('ln(-1)'), [0, Math.PI]);
  close(evaluate('sqrt(-4)'), [0, 2]);
  close(evaluate('ln(e) + log(e)'), [2, 0]);
  close(evaluate('exp(i*pi) + 1'), [0, 0]);
  close(evaluate('e^(i*pi) + 1'), [0, 0]);
  close(evaluate('sin(i)'), [0, Math.sinh(1)]);
  close(evaluate('cos(i)'), [Math.cosh(1), 0]);
  close(evaluate('tan(i)'), [0, Math.tanh(1)]);
  close(evaluate('sinh(i*pi/2)'), [0, 1]);
  close(evaluate('cosh(i*pi)'), [-1, 0]);
  close(evaluate('abs(z) + conj(z) + re(z)*i + im(z)'), [Math.sqrt(5) + 3, -1]);
});

test('memory aliases reference the four independent earlier values', () => {
  for (let k = 1; k <= 4; k++) close(evaluate(`z${k} - z[n-${k}]`), [0, 0]);
  close(evaluate('z[n]'), env.z);
  // Starting from zero: 1,2,4,8,16,32,63,125; radius 64 is exceeded at step 8.
  assert.equal(iterateCustom({ ...custom, custom_formula: 'z+z1+z2+z3+z4+c' }, 1, 0), 8);
  assert.equal(iterateCustom({ ...custom, custom_formula: 'z1+c', bailout: 4 }, 1, 0), 9);
  assert.equal(iterateCustom({ ...custom, custom_mode: 'julia', custom_formula: 'z1', julia_x: '0', julia_y: '0' }, 100, 0), 2);
  const iterate = createCustomIterator({ ...custom, custom_formula: 'z1+c', bailout: 4 });
  for (const [x, expected] of [[1, 9], [2, 5], [0, -1], [.5, 17], [3, 3], [1, 9]]) assert.equal(iterate(x, 0), expected, 'Each pixel starts with empty history');
});

test('unsafe, ambiguous, oversized, and malformed formulas are rejected', () => {
  for (const input of ['', ' ', null, {}, 'z5', 'z[n-5]', 'z[n+1]', 'z[t-1]', '5z', 'Math.exp(z)', 'window', 'constructor', 'z; alert(1)', 'z = c', 'z ? c : 0', 'z[0]', 'ln()', 'sin(z,c)', 'pow(z)', 'pow(z,c,2)', 'z+', '(z', 'z)', 'exp z', '1e999', '1e-99', 'z'.repeat(1025), '('.repeat(40) + 'z' + ')'.repeat(40), '-'.repeat(40) + 'z', Array(120).fill('z').join('+')]) {
    assert.throws(() => parseFormula(input), undefined, String(input));
  }
});

test('generated WGSL contains only parsed identifiers and supported helpers', () => {
  assert.match(compileFormula('z^2+c').wgsl, /custom_ipow\(z,2i\)/);
  assert.match(compileFormula('e^z').wgsl, /custom_exp\(z\)/);
  assert.match(compileFormula('0.1*z').wgsl, /custom_real\(1\.000000015e-1,-1\.490116142e-9\)/);
  assert.throws(() => parseFormula(Array(40).fill('z').join('^')), /nesting/);
  assert.throws(() => parseFormula('1e-999'), /Numbers/);
  for (const name of ['ln', 'exp', 'sqrt', 'sin', 'cos', 'tan', 'sinh', 'cosh', 'abs', 'conj', 're', 'im']) assert.match(compileFormula(`${name}(z4)+c`).wgsl, new RegExp(`custom_${name}\\(z4\\)`));
});

test('pixel mapping reproduces quadratic membership in both planes', async () => {
  for (const mode of ['mandelbrot', 'julia']) {
    const actual = await softwareRender({ ...custom, custom_mode: mode }, 25, 17);
    const standard = await softwareRender({ ...base, fractal: mode }, 25, 17);
    actual.field.forEach((value, i) => assert.equal(value < 0, standard.field[i] < 0, `${mode} pixel ${i}`));
    assert.ok(actual.field.every(Number.isFinite));
    assert.equal(actual.metadata.perturbation, false);
  }
});

test('singular and overflowing final values escape with finite iteration counts', async () => {
  for (const formula of ['1/z', 'ln(z)', 'exp(1000)', 'z^16+c', 'sin(z)+c', 'ln(z^2+1)+c']) {
    const rendered = await softwareRender({ ...custom, custom_formula: formula }, 9, 7);
    assert.ok(rendered.field.every(value => Number.isFinite(value) && (value === -1 || value >= 1)));
  }
  assert.equal(iterateCustom({ ...custom, custom_formula: '1/z' }, 0, 0), 1);
});

test('formula and mapping survive JSON, compressed shares, and constant animations', async () => {
  const v = { ...custom, custom_mode: 'julia', custom_formula: 'z^3+c+0.2*z1-0.1*z2+0.01*z4' };
  const automation = { julia_x: { enabled: true, target: '-.7', speed: .25, shape: 'sine' } };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(v))), v);
  for (const compress of [false, true]) {
    const link = await createShareURL('https://example.com/', { view: v, automation }, 6, { compress });
    const restored = await readShareURL(link, 6);
    assert.deepEqual(restored.view, v);
    assert.deepEqual(restored.automation, automation);
  }
  assert.ok(animationParameters(v).some(p => p.key === 'julia_x'));
  assert.ok(!animationParameters(custom).some(p => p.key === 'julia_x'));
  assert.equal(animationPlan(v, automation).viewAt(1).custom_formula, v.custom_formula);
  assert.equal(juliaView(v, { x: '0', y: '0' }, .5).custom_formula, v.custom_formula);
  assert.throws(() => juliaView(custom, { x: '0', y: '0' }, .5));
});
