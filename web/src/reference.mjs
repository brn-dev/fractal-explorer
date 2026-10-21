import { init } from 'gmp-wasm/dist/index.esm.js';
import { decimal, order, validate, pixelView } from './decimal.mjs';
import { ZERO, wide, packComplex } from './wide.mjs';
import { prepareApproximation } from './approximation.mjs';

let library;
const references = new Map(), preparations = new Map();
export async function mpfr() { return library ??= await init(); }
export function cachePut(cache, key, entry, maximum = 4) {
  cache.delete(key); cache.set(key, entry);
  while (cache.size > maximum) cache.delete(cache.keys().next().value);
  return entry;
}
export function digitsFor(view, extra = 40) {
  return Math.ceil(Math.max(48, -order(decimal(view.span)) + extra) / 64) * 64;
}
function keyFor(v) { return JSON.stringify([v.x, v.y, v.fractal, v.julia_x, v.julia_y, v.iterations, v.bailout, digitsFor(v)]); }
async function spanFor(value) {
  const lib = await mpfr(), b = lib.binding, ctx = lib.getContext({ precisionBits: 128 });
  try {
    const p = ctx.Float(value).mpfr_t, t = ctx.Float(0).mpfr_t;
    const e = b.mpfr_get_exp(p); b.mpfr_mul_2si(t, p, -e, 0);
    return { m: b.mpfr_get_d(t, 0), e };
  } finally { ctx.destroy(); }
}

export async function reference(view) {
  validate(view);
  const key = keyFor(view);
  if (references.has(key)) return { orbit: { ...cachePut(references, key, references.get(key)), span: await spanFor(view.span) }, hit: true, elapsed: 0 };
  const start = performance.now(), lib = await mpfr(), b = lib.binding;
  const digits = digitsFor(view), ctx = lib.getContext({ precisionBits: Math.ceil(digits * Math.LOG2E * Math.LN10), roundingMode: 0 });
  try {
    const f = value => ctx.Float(value).mpfr_t;
    const zr = f(view.fractal === 'julia' ? view.x : 0), zi = f(view.fractal === 'julia' ? view.y : 0);
    const cr = f(view.fractal === 'julia' ? view.julia_x : view.x), ci = f(view.fractal === 'julia' ? view.julia_y : view.y);
    const xx = f(0), yy = f(0), xy = f(0), tmp = f(0), s = f(view.span);
    const component = ptr => {
      if (b.mpfr_zero_p(ptr)) return ZERO;
      const exponent = b.mpfr_get_exp(ptr);
      if (exponent < -100000000) return ZERO;
      b.mpfr_mul_2si(tmp, ptr, -exponent, 0);
      return { m: b.mpfr_get_d(tmp, 0), e: exponent };
    };
    const span = component(s), points = [];
    for (let n = 0; n <= view.iterations; n++) {
      points.push({ r: component(zr), i: component(zi) });
      const x = b.mpfr_get_d(zr, 0), y = b.mpfr_get_d(zi, 0);
      if (x * x + y * y > (view.bailout * 2) ** 2 || n === view.iterations) break;
      b.mpfr_mul(xx, zr, zr, 0); b.mpfr_mul(yy, zi, zi, 0); b.mpfr_mul(xy, zr, zi, 0);
      b.mpfr_sub(zr, xx, yy, 0); b.mpfr_add(zr, zr, cr, 0);
      b.mpfr_mul_2si(zi, xy, 1, 0); b.mpfr_add(zi, zi, ci, 0);
    }
    const buffer = new ArrayBuffer(points.length * 48), data = new DataView(buffer);
    points.forEach((p, k) => {
      for (let axis = 0; axis < 2; axis++) {
        const w = axis ? p.i : p.r, number = w.m * 2 ** w.e;
        const hi = Math.fround(number);
        data.setFloat32(k * 48 + axis * 8, hi, true);
        data.setFloat32(k * 48 + axis * 8 + 4, Math.fround(number - hi), true);
      }
      packComplex(data, k * 48 + 16, p);
    });
    const orbit = { key, digits, span, points, buffer, julia: view.fractal === 'julia', iterations: view.iterations, bailout: view.bailout };
    cachePut(references, key, orbit);
    return { orbit, hit: false, elapsed: performance.now() - start };
  } finally { ctx.destroy(); }
}

export async function prepare(view, width, height, mode, anchor) {
  const center = anchor ? pixelView(view, anchor.col, anchor.row, width, height) : view;
  const r = await reference(center);
  const key = JSON.stringify([r.orbit.key, view.span, width, height, mode]);
  const hit = preparations.has(key);
  const approximation = hit ? cachePut(preparations, key, preparations.get(key))
    : cachePut(preparations, key, prepareApproximation(r.orbit, r.orbit.span, width, height, mode));
  return { orbit: r.orbit, approximation, timings: { reference_ms: r.elapsed, preparation_ms: hit ? 0 : approximation.elapsed }, referenceHit: r.hit, preparationHit: hit };
}

// This independent MPFR loop is also used as an oracle and final pixel repair.
export async function exactPixels(view, points, width, height, extra = 80) {
  validate(view);
  if (!['mandelbrot', 'julia', 'burning-ship', 'tricorn', 'cubic'].includes(view.fractal)) throw new Error('The MPFR pixel oracle supports the original five formulas; this formula uses direct iteration.');
  const lib = await mpfr(), b = lib.binding;
  const d = digitsFor(view);
  const ctx = lib.getContext({ precisionBits: Math.ceil((d * (view.fractal === 'julia' ? 2 : 1) + extra) * Math.LOG2E * Math.LN10), roundingMode: 0 });
  const started = performance.now();
  try {
    const f = value => ctx.Float(value).mpfr_t;
    const cx = f(view.x), cy = f(view.y), span = f(view.span), jx = f(view.julia_x), jy = f(view.julia_y);
    const x = f(0), y = f(0), cr = f(0), ci = f(0), zr = f(0), zi = f(0), xx = f(0), yy = f(0), xy = f(0), nr = f(0), ni = f(0), t = f(0);
    const values = new Float32Array(points.length);
    let lastYield = performance.now();
    for (let p = 0; p < points.length; p++) {
      const [col, row] = points[p];
      // Rational pixel offsets are constructed before rounding at MPFR precision.
      b.mpfr_mul_si(x, span, 2 * col + 1 - width, 0); b.mpfr_div_ui(x, x, 2 * width, 0); b.mpfr_add(x, x, cx, 0);
      b.mpfr_mul_si(y, span, height - 2 * row - 1, 0); b.mpfr_div_ui(y, y, 2 * width, 0); b.mpfr_add(y, y, cy, 0);
      const julia = view.fractal === 'julia' || view.fractal === 'cubic';
      b.mpfr_set(cr, julia ? jx : x, 0); b.mpfr_set(ci, julia ? jy : y, 0);
      if (julia) { b.mpfr_set(zr, x, 0); b.mpfr_set(zi, y, 0); }
      else { b.mpfr_set_ui(zr, 0, 0); b.mpfr_set_ui(zi, 0, 0); }
      let answer = -1;
      for (let n = 1; n <= view.iterations; n++) {
        if (view.fractal === 'tricorn') b.mpfr_neg(zi, zi, 0);
        b.mpfr_mul(xx, zr, zr, 0); b.mpfr_mul(yy, zi, zi, 0); b.mpfr_mul(xy, zr, zi, 0);
        b.mpfr_sub(nr, xx, yy, 0); b.mpfr_mul_2si(ni, xy, 1, 0);
        if (view.fractal === 'cubic') {
          b.mpfr_mul(t, nr, zr, 0); b.mpfr_mul(x, ni, zi, 0); b.mpfr_sub(t, t, x, 0);
          b.mpfr_mul(x, nr, zi, 0); b.mpfr_mul(y, ni, zr, 0); b.mpfr_add(ni, x, y, 0);
          b.mpfr_set(nr, t, 0);
        }
        b.mpfr_add(zr, nr, cr, 0); b.mpfr_add(zi, ni, ci, 0);
        if (view.fractal === 'burning-ship') { b.mpfr_abs(zr, zr, 0); b.mpfr_abs(zi, zi, 0); }
        b.mpfr_mul(xx, zr, zr, 0); b.mpfr_mul(yy, zi, zi, 0); b.mpfr_add(t, xx, yy, 0);
        const mag = b.mpfr_get_d(t, 0);
        if (mag > view.bailout ** 2) { answer = Math.max(0, n + 1 - Math.log(Math.log(Math.sqrt(mag))) / Math.log(view.fractal === 'cubic' ? 3 : 2)); break; }
      }
      values[p] = answer;
      if (performance.now() - lastYield > 12) { await new Promise(resolve => setTimeout(resolve, 0)); lastYield = performance.now(); }
    }
    return { values, elapsed: performance.now() - started };
  } finally { ctx.destroy(); }
}
export function clearCaches() { references.clear(); preparations.clear(); }
