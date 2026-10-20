// CPU preparation uses binary64 mantissas with separate exponents. This is not
// arbitrary significand precision; the reference orbit itself uses MPFR.
export const ZERO = Object.freeze({ m: 0, e: 0 });
export function wide(m, e = 0) {
  if (!m || e < -100000000) return ZERO;
  if (!Number.isFinite(m)) throw new Error('Non-finite approximation coefficient.');
  const k = Math.floor(Math.log2(Math.abs(m))) + 1;
  // Split scaling avoids 2**1024 overflowing when a finite input is near MAX_VALUE.
  const half = Math.trunc(k / 2);
  return { m: m * 2 ** -half * 2 ** -(k - half), e: e + k };
}
export function wdecimal(s) {
  const [mantissa, exponent = '0'] = String(s).toLowerCase().split('e');
  const v = Number(mantissa);
  if (!v) return ZERO;
  const p = Number(exponent) * Math.LOG2E * Math.LN10;
  const k = Math.floor(p);
  return wide(v * 2 ** (p - k), k);
}
export function wa(a, b) {
  if (!a.m) return b;
  if (!b.m) return a;
  if (a.e < b.e) [a, b] = [b, a];
  if (a.e - b.e > 60) return a;
  return wide(a.m + b.m * 2 ** (b.e - a.e), a.e);
}
export function wn(a) { return { m: -a.m, e: a.e }; }
export function ws(a, b) { return wa(a, wn(b)); }
export function wm(a, b) { return wide(a.m * b.m, a.e + b.e); }
export function wd(a, b) { return wide(a.m / b.m, a.e - b.e); }
export function scale(a, x) { return wide(a.m * x, a.e); }
export function log(a) { return a.m ? Math.log2(Math.abs(a.m)) + a.e : -Infinity; }
export function value(a) { return a.m * 2 ** a.e; }
export function abs(a) { return { m: Math.abs(a.m), e: a.e }; }
export function sqrt(a) { const odd = a.e & 1; return wide(Math.sqrt(a.m * (odd ? 2 : 1)), (a.e - odd) / 2); }
export function max(a, b) { return log(a) >= log(b) ? a : b; }
export function min(a, b) { return log(a) <= log(b) ? a : b; }
export const cz = () => ({ r: ZERO, i: ZERO });
export const ca = (a, b) => ({ r: wa(a.r, b.r), i: wa(a.i, b.i) });
export const cm = (a, b) => ({ r: ws(wm(a.r, b.r), wm(a.i, b.i)), i: wa(wm(a.r, b.i), wm(a.i, b.r)) });
export const cs = (a, x) => ({ r: scale(a.r, x), i: scale(a.i, x) });
export function magnitude(a) {
  const e = Math.max(a.r.m ? a.r.e : -1e8, a.i.m ? a.i.e : -1e8);
  return e === -1e8 ? ZERO : wide(Math.hypot(a.r.m ? a.r.m * 2 ** (a.r.e - e) : 0, a.i.m ? a.i.m * 2 ** (a.i.e - e) : 0), e);
}
export function packWide(data, offset, a) {
  const hi = Math.fround(a.m);
  data.setFloat32(offset, hi, true);
  data.setFloat32(offset + 4, Math.fround(a.m - hi), true);
  data.setInt32(offset + 8, a.e, true);
  data.setInt32(offset + 12, 0, true);
}
export function packComplex(data, offset, a) { packWide(data, offset, a.r); packWide(data, offset + 16, a.i); }
