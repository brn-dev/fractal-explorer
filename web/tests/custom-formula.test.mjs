import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFormula, parseFormula, iterateCustom, createCustomIterator, compileInput, compileCustomInputs, defaultCustomInputs } from '../src/custom-formula.mjs';
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

const advanced = (inputs = {}, formula = 'z^2+c') => validate({ ...custom, custom_mode: 'advanced', custom_formula: formula, custom_inputs: inputs });

test('advanced inputs use p and k with complex expressions and scoped names', () => {
  const env = { p: [1, 2], k: [.5, -.25] };
  close(compileInput('p^2+k').evaluate(env), [-2.5, 3.75]);
  close(compileInput('conj(p)/2 + re(k)*i').evaluate(env), [.5, -.5]);
  close(compileInput('ln(-1)+exp(0)+sqrt(-4)+sin(0)').evaluate(env), [1, Math.PI + 2]);
  for (const source of ['z', 'z1', 'c', 'z[n-1]', 'p.x', 'k; z', 'window']) assert.throws(() => compileInput(source));
  assert.throws(() => compileFormula('p+k'), /Unknown name/);
  assert.deepEqual(advanced().custom_inputs, defaultCustomInputs);
  assert.equal(hasConstant(advanced()), true);
  assert.throws(() => advanced({ z: 'c' }), /Initial z/);
  assert.throws(() => advanced({ c: '' }), /Parameter/);
  for (const inputs of ['p', [], { z5: 'p' }, { unrelated: 'k' }]) assert.throws(() => advanced(inputs), /Input mapping/);
});

test('advanced Mandelbrot and Julia inputs reproduce existing saved views exactly', async () => {
  for (const mode of ['mandelbrot', 'julia']) {
    const original = { ...custom, custom_mode: mode, custom_formula: 'z^2+c-0.5*z1+0.1*z2' };
    const inputs = mode === 'julia' ? { z: 'p', c: 'k' } : {};
    const mapped = advanced(inputs, original.custom_formula);
    const a = await softwareRender(original, 25, 17), b = await softwareRender(mapped, 25, 17);
    assert.deepEqual(a.field, b.field);
  }
});

test('mixed, seeded and transformed mappings agree with independently initialized iteration', () => {
  const k = [Number(custom.julia_x), Number(custom.julia_y)];
  for (const [inputs, initialize] of [
    [{ z: 'p', c: 'p+k' }, (x, y) => [x, y, x + k[0], y + k[1]]],
    [{ z: 'k', c: 'p' }, (x, y) => [k[0], k[1], x, y]],
    [{ z: 'sin(p)', c: 'k' }, (x, y) => [Math.sin(x) * Math.cosh(y), Math.cos(x) * Math.sinh(y), ...k]],
  ]) {
    const iterate = createCustomIterator(advanced(inputs));
    for (const [x, y] of [[0, 0], [-.7, .2], [.5, -.6], [1, 1], [-1, 0]]) {
      let [r, i, cr, ci] = initialize(x, y), expected = -1;
      for (let n = 1; n <= custom.iterations; n++) {
        const nextR = r * r - i * i + cr;
        i = 2 * r * i + ci; r = nextR;
        if (Math.hypot(r, i) > custom.bailout) { expected = n; break; }
      }
      assert.equal(iterate(x, y), expected, JSON.stringify(inputs));
    }
  }
});

test('every memory seed is independent and resets on each pixel', () => {
  for (let lag = 1; lag <= 4; lag++) {
    const v = advanced({ [`z${lag}`]: 'p+2*k', z: '0', c: '0' }, `z${lag}`);
    const iterate = createCustomIterator(v);
    for (const x of [100, 0, -100, 0, 100]) assert.equal(iterate(x, 0), Math.abs(x) > 64 ? 1 : -1, `lag ${lag}, pixel ${x}`);
  }
  const iterate = createCustomIterator(advanced({ z: 'p', z1: 'k', z2: '2*k', z3: '3*k', z4: '4*k', c: 'p+k' }, 'z+z1+z2+z3+z4+c'));
  for (const [x, y] of [[0, 0], [1, 1], [-2, .5]]) {
    let history = [[x, y], ...[1, 2, 3, 4].map(n => [n * Number(custom.julia_x), n * Number(custom.julia_y)])], expected = -1;
    for (let n = 1; n <= custom.iterations; n++) {
      const next = history.reduce(([r, i], [a, b]) => [r + a, i + b], [x + Number(custom.julia_x), y + Number(custom.julia_y)]);
      history = [next, ...history.slice(0, 4)];
      if (Math.hypot(...next) > custom.bailout) { expected = n; break; }
    }
    assert.equal(iterate(x, y), expected);
  }
});

test('singular inputs stop at the first step even when the recurrence ignores them', () => {
  for (const expression of ['1/(p-p)', 'ln(0)', 'im(ln(0))', '0*ln(0)', 'exp(1000)']) {
    assert.equal(iterateCustom(advanced({ z4: expression }, '0'), 0, 0), 1, expression);
  }
  assert.equal(iterateCustom(advanced({ z: '100' }, '0'), 0, 0), -1);
});

test('advanced initialization compiles independently from recurrence and includes every seed', () => {
  const compiled = compileCustomInputs(advanced({ z: 'sin(p)', c: 'p+k', z1: 'k', z4: 'p^2' }));
  assert.match(compiled.wgsl, /custom_sin\(pixel\)/);
  assert.match(compiled.wgsl, /let c=na\(pixel,constant\)/);
  assert.match(compiled.wgsl, /let z1=constant/);
  assert.match(compiled.wgsl, /let z4=custom_ipow\(pixel,2i\)/);
});

test('advanced inputs survive JSON, compressed shares, animations and exact constant edits', async () => {
  const v = advanced({ z: 'sin(p)', c: 'p+k', z1: '0.1*k', z4: 'p/2' }, 'z^2+c+0.2*z1-0.1*z4');
  const automation = { julia_x: { enabled: true, target: '-.7', speed: .25, shape: 'sine' } };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(v))), v);
  for (const compress of [false, true]) {
    const link = await createShareURL('https://example.com/', { view: v, automation }, 6, { compress });
    const restored = await readShareURL(link, 6);
    assert.deepEqual(restored.view, v);
    assert.deepEqual(restored.automation, automation);
  }
  assert.deepEqual(animationPlan(v, automation).viewAt(1).custom_inputs, v.custom_inputs);
  assert.deepEqual(juliaView(v, { x: '0', y: '0' }, .5).custom_inputs, v.custom_inputs);
  const original = validate({ ...base, fractal: 'custom', custom_mode: 'julia', custom_formula: 'z^2+c' });
  assert.equal(Object.hasOwn(original, 'custom_inputs'), false, 'Existing locations keep their original schema');
});

test('named constants are discovered in recurrences and inputs with bounded editable values', () => {
  const v = validate({ ...custom, custom_formula: 'x3*z^2+c', x2: '.123456789012345678901' });
  assert.equal(v.custom_constant_count, 3);
  assert.equal(v.x1, '1'); assert.equal(v.x3, '1'); assert.equal(v.x2, '.123456789012345678901');
  const seeded = advanced({ z: 'x4*p', c: 'p+x2', z3: 'x1*k' });
  assert.equal(seeded.custom_constant_count, 4);
  assert.equal(seeded.x4, '1');
  assert.equal(Object.hasOwn(validate(custom), 'custom_constant_count'), false);
  assert.equal(Object.hasOwn(validate({ ...custom, custom_constant_count: 0, x1: '2' }), 'x1'), false);
  for (const count of [-1, 17, 1.5, '2', NaN]) assert.throws(() => validate({ ...custom, custom_constant_count: count }));
  for (const value of ['NaN', 'Infinity', '1000001', '-1000001', '', '1;alert(1)']) assert.throws(() => validate({ ...custom, custom_formula: 'x1*z+c', x1: value }));
  for (const expression of ['x0', 'x17', 'x01', 'x1.foo']) assert.throws(() => compileFormula(expression));
});

test('named constants support addition, multiplication, division, powers, and functions', () => {
  const variables = { ...env, x1: [2, 0], x2: [3, 0], x3: [4, 0], x4: [-1, 0] };
  close(compileFormula('(x1*z+x2)/x3+x4').evaluate(variables), [.25, 1]);
  close(compileFormula('z^x1').evaluate(variables), [-3, 4]);
  close(compileFormula('ln(x1)+exp(x4)').evaluate(variables), [Math.log(2) + Math.exp(-1), 0]);
  close(compileInput('x1*p/x2+x4*k').evaluate({ ...variables, p: [3, 6], k: [1, 2] }), [1, 2]);
  assert.match(compileFormula('x16*z/x1').wgsl, /custom_constant\(15u\)/);
  assert.match(compileFormula('x16*z/x1').wgsl, /custom_constant\(0u\)/);
});

test('constant changes affect CPU rendering and integer variable powers preserve quadratic iteration', async () => {
  const a = validate({ ...custom, custom_formula: 'z^x1+c/x2+x3', x1: '2', x2: '1', x3: '0' });
  const direct = await softwareRender(custom, 25, 17), parametric = await softwareRender(a, 25, 17);
  assert.deepEqual(parametric.field, direct.field);
  const changed = await softwareRender({ ...a, x1: '3', x2: '2', x3: '.1' }, 25, 17);
  assert.notDeepEqual(changed.field, parametric.field);
  assert.equal(iterateCustom(validate({ ...custom, custom_formula: 'z/x1', x1: '0' }), 0, 0), 1);
  assert.equal(iterateCustom(validate({ ...custom, custom_formula: 'x16', x16: '65' }), 0, 0), 1);
});

test('every named constant can automate with exact targets and independent rates', () => {
  const v = validate({ ...custom, custom_formula: 'x1*z^2+c/x2', custom_constant_count: 16, x1: '1', x2: '2', x16: '.123456789012345678901' });
  const parameters = animationParameters(v);
  for (let n = 1; n <= 16; n++) assert.ok(parameters.some(p => p.key === `x${n}` && p.decimal));
  const settings = {
    x1: { enabled: true, target: '3', speed: .25, shape: 'smootherstep' },
    x2: { enabled: true, target: '4', speed: .5, shape: 'sine' },
    x16: { enabled: true, target: '.123456789012345678903', speed: .25, shape: 'smootherstep' },
  };
  const plan = animationPlan(v, settings);
  assert.equal(plan.viewAt(plan.frames / 2).x1, '3');
  assert.equal(plan.viewAt(plan.frames / 2).x2, '2');
  assert.equal(plan.viewAt(plan.frames / 4).x2, '4');
  assert.equal(plan.viewAt(plan.frames / 2).x16, settings.x16.target);
  assert.equal(plan.viewAt(plan.frames).x16, v.x16);
  assert.equal(plan.viewAt(1).custom_formula, v.custom_formula);
});

test('named constants and their automation survive JSON and both share formats', async () => {
  const v = validate({ ...advanced({ z: 'sin(p)/x2', c: 'p+x1*k', z4: 'x3' }, 'x1*z^2+c/x2+x3*z1'), x1: '.75', x2: '2', x3: '-.123456789012345678901' });
  const automation = { x3: { enabled: true, target: '.123456789012345678901', speed: .1, shape: 'pause-middle' } };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(v))), v);
  for (const compress of [false, true]) {
    const link = await createShareURL('https://example.com/', { view: v, automation }, 6, { compress });
    const restored = await readShareURL(link, 6);
    assert.deepEqual(restored.view, v);
    assert.deepEqual(restored.automation, automation);
  }
});
