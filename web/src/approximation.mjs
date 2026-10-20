import { ZERO, wide, wa, ws, wm, wd, scale, log, sqrt, min, max, cz, ca, cm, cs, magnitude, packComplex } from './wide.mjs';

const positive = a => a.m > 0 ? a : ZERO;
const sum = list => list.reduce(wa, ZERO);

export function prepareApproximation(orbit, span, width, height, mode, tolerance = 1e-7) {
  const start = performance.now();
  const radius = Math.hypot(.5, height / width / 2) * (1 + 1e-12);
  const dc = orbit.julia ? ZERO : scale(span, radius);
  const result = { seriesN: 0, seriesOrder: 0, series: new ArrayBuffer(32), maps: new ArrayBuffer(80), offsets: [], logDc: log(dc), mode };
  if (mode.includes('series')) buildSeries(orbit, span, radius, width, tolerance, result);
  if (mode.includes('bla')) buildBla(orbit, dc, result);
  result.elapsed = performance.now() - start;
  return result;
}

function buildSeries(orbit, span, radius, width, tolerance, result) {
  const degree = 8, powers = Array.from({ length: 17 }, (_, k) => radius ** k);
  let coefficients = Array.from({ length: degree + 1 }, cz), error = ZERO, best;
  if (orbit.julia) coefficients[1] = { r: span, i: ZERO };
  for (let n = 0; n < Math.min(orbit.points.length - 1, orbit.iterations - 1); n++) {
    const z = orbit.points[n], az = magnitude(z);
    const bound = sum(coefficients.slice(1).map((c, k) => scale(magnitude(c), powers[k + 1])));
    const next = Array.from({ length: degree + 1 }, cz);
    let discarded = ZERO;
    for (let k = 1; k <= 2 * degree; k++) {
      let convolution = cz(), absolute = ZERO;
      for (let j = Math.max(1, k - degree); j <= Math.min(degree, k - 1); j++) {
        convolution = ca(convolution, cm(coefficients[j], coefficients[k - j]));
        absolute = wa(absolute, wm(magnitude(coefficients[j]), magnitude(coefficients[k - j])));
      }
      if (k <= degree) next[k] = ca(cs(cm(z, coefficients[k]), 2), convolution);
      else discarded = wa(discarded, scale(absolute, powers[k]));
    }
    if (!orbit.julia) next[1] = ca(next[1], { r: span, i: ZERO });
    const roundoff = scale(wa(wm(wa(scale(az, 2), bound), bound), orbit.julia ? ZERO : span), 2 ** -48);
    error = wa(wa(wm(wa(wa(scale(az, 2), scale(bound, 2)), error), error), discarded), roundoff);
    coefficients = next;
    const size = sum(coefficients.slice(1).map((c, k) => scale(magnitude(c), powers[k + 1])));
    if (log(wa(wa(magnitude(orbit.points[n + 1]), size), error)) >= Math.log2(orbit.bailout)) break;
    if (log(error) > log(scale(max(size, span), tolerance / width))) break;
    if (n + 1 >= 8) best = { n: n + 1, coefficients: coefficients.slice() };
  }
  if (best) {
    result.seriesN = best.n;
    result.seriesOrder = degree;
    result.series = new ArrayBuffer((degree + 1) * 32);
    const data = new DataView(result.series);
    best.coefficients.forEach((c, k) => packComplex(data, 32 * k, c));
    result.coefficients = best.coefficients;
  }
}

function buildBla(orbit, dc, result) {
  const levels = [[]];
  for (let j = 0; j < orbit.points.length - 1; j++) {
    const a = cs(orbit.points[j], 2), b = { r: wide(orbit.julia ? 0 : 1), i: ZERO };
    const gap = positive(ws(ws(wide(orbit.bailout), magnitude(orbit.points[j + 1])), dc));
    const radius = min(wide(.25), wd(gap, wa(magnitude(a), wide(.25))));
    levels[0].push({ a, b, radius, remainder: wide(1) });
  }
  while (levels.at(-1).length >= 2) {
    const previous = levels.at(-1), next = [];
    for (let i = 0; i + 1 < previous.length; i += 2) {
      const x = previous[i], y = previous[i + 1];
      const a = cm(y.a, x.a), b = ca(cm(y.a, x.b), y.b);
      const constant = ws(wa(wm(x.remainder, wm(dc, dc)), wm(magnitude(x.b), dc)), y.radius);
      const linear = wa(magnitude(x.a), scale(wm(x.remainder, dc), 2));
      let radius = ZERO;
      if (constant.m < 0 && x.radius.m > 0 && y.radius.m > 0) {
        const radical = sqrt(ws(wm(linear, linear), scale(wm(x.remainder, constant), 4)));
        radius = scale(min(x.radius, wd(scale(constant, -2), wa(linear, radical))), .99);
      }
      const majorant = wa(max(magnitude(x.a), wa(magnitude(x.b), wide(1))), wm(x.remainder, wa(radius, dc)));
      next.push({ a, b, radius, remainder: wa(wm(magnitude(y.a), x.remainder), wm(y.remainder, wm(majorant, majorant))) });
    }
    levels.push(next);
  }
  const count = levels.reduce((a, l) => a + l.length, 0);
  if (!count) return;
  result.maps = new ArrayBuffer(count * 80);
  result.nodes = levels;
  const data = new DataView(result.maps);
  let node = 0;
  for (const level of levels) {
    result.offsets.push(node);
    for (const map of level) {
      const offset = node++ * 80;
      packComplex(data, offset, map.a); packComplex(data, offset + 32, map.b);
      [log(map.radius), log(map.remainder), log(magnitude(map.a)), log(magnitude(map.b))].forEach((v, k) => data.setFloat32(offset + 64 + 4 * k, Number.isFinite(v) ? v : -1e30, true));
    }
  }
}
