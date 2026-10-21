// Direct binary64 fallback for the additional families. GPU counterparts use
// paired FP32. These never enter the quadratic perturbation/reference path.
function power(r, i, d) {
  let a = 1, b = 0;
  for (let k = 0; k < d; k++) [a, b] = [a * r - b * i, a * i + b * r];
  return [a, b];
}
export function newtonColor(r, i, cr, ci, degree, steps) {
  const angle = Math.atan2(ci, cr) / degree;
  const root = cr === 0 && ci === 0 ? 0 : ((Math.round((Math.atan2(i, r) - angle) * degree / (2 * Math.PI)) % degree) + degree) % degree;
  // Invert the shared logarithmic palette map to encode root + convergence rate.
  return Math.expm1(5 * (root / degree + Math.min(steps, 50) * 0.004));
}
export function iterateAdditional(view, x, y) {
  const kind = view.fractal, d = kind === 'multibrot' || kind === 'multijulia' || kind === 'newton' ? view.power : 2;
  const parameterPlane = kind === 'multibrot';
  const cr = parameterPlane ? x : Number(view.julia_x), ci = parameterPlane ? y : Number(view.julia_y);
  let r = parameterPlane ? 0 : x, i = parameterPlane ? 0 : y, pr = 0, pi = 0;
  if (kind === 'newton') {
    for (let n = 0; n <= view.iterations; n++) {
      if (r * r + i * i > 1e8 || !Number.isFinite(r + i)) return -1;
      const [dr, di] = power(r, i, d - 1);
      const fr = dr * r - di * i - cr, fi = dr * i + di * r - ci;
      if (fr * fr + fi * fi < 1e-12) return newtonColor(r, i, cr, ci, d, n);
      if (n === view.iterations) break;
      const a = d * dr, b = d * di, norm = a * a + b * b;
      if (norm < 1e-24) return -1;
      r -= view.relaxation * (fr * a + fi * b) / norm;
      i -= view.relaxation * (fi * a - fr * b) / norm;
    }
    return -1;
  }
  for (let n = 1; n <= view.iterations; n++) {
    // A large initial Julia coordinate cannot safely be raised to degree 8 on
    // an FP32 GPU. Treat it as already escaped; use the same rule on the CPU.
    if (r * r + i * i > 1e8) return Math.max(0, n - Math.log(Math.log(Math.hypot(r, i))) / Math.log(d));
    const oldR = r, oldI = i;
    if (kind === 'ship-julia') { r = Math.abs(r); i = Math.abs(i); }
    const [a, b] = power(r, i, d);
    r = a + cr + (kind === 'phoenix' ? view.memory * pr : 0);
    i = b + ci + (kind === 'phoenix' ? view.memory * pi : 0);
    pr = oldR; pi = oldI;
    // hypot avoids overflow when a high power escapes far beyond the radius.
    const magnitude = Math.hypot(r, i);
    if (magnitude > view.bailout) return Math.max(0, n + 1 - Math.log(Math.log(magnitude)) / Math.log(d));
  }
  return -1;
}
