import { ZERO, wide, wa, wm, log, value, cz, ca, cm, cs, magnitude } from './wide.mjs';
import { prepare, exactPixels } from './reference.mjs';
import { decimal, order } from './decimal.mjs';

function finish(n, mag, power = 2) { return Math.max(0, n + 1 - Math.log(Math.log(Math.sqrt(mag))) / Math.log(power)); }
export async function softwareRender(view, width, height, mode = 'series') {
  const start = performance.now();
  const perturb = ['mandelbrot', 'julia'].includes(view.fractal) && order(decimal(view.span)) < -7;
  const prepared = perturb ? await prepare(view, width, height, mode) : null;
  const orbit = prepared?.orbit, approximation = prepared?.approximation;
  const field = new Float32Array(width * height), glitches = [];
  let minimum = Infinity, skipped = 0, lastYield = performance.now();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ux = (col + .5) / width - .5, uy = (height / 2 - row - .5) / width;
      let answer = -1;
      if (!perturb) {
        const x = Number(view.x) + ux * Number(view.span), y = Number(view.y) + uy * Number(view.span);
        const julia = ['julia', 'cubic'].includes(view.fractal);
        const cr = julia ? Number(view.julia_x) : x, ci = julia ? Number(view.julia_y) : y;
        let zr = julia ? x : 0, zi = julia ? y : 0;
        if (view.fractal === 'mandelbrot') {
          const q = (x - .25) ** 2 + y * y;
          if (q * (q + x - .25) < .25 * y * y - 1e-14 || (x + 1) ** 2 + y * y < .0625 - 1e-14) { field[row * width + col] = -1; continue; }
        }
        for (let n = 1; n <= view.iterations; n++) {
          if (view.fractal === 'tricorn') zi = -zi;
          const a = zr * zr - zi * zi, b = 2 * zr * zi;
          if (view.fractal === 'cubic') [zr, zi] = [a * zr - b * zi + cr, a * zi + b * zr + ci];
          else [zr, zi] = [a + cr, b + ci];
          if (view.fractal === 'burning-ship') [zr, zi] = [Math.abs(zr), Math.abs(zi)];
          const mag = zr * zr + zi * zi;
          if (mag > view.bailout ** 2) { answer = finish(n, mag, view.fractal === 'cubic' ? 3 : 2); break; }
        }
      } else {
        const u = { r: wide(ux), i: wide(uy) };
        const offset = { r: wm(orbit.span, u.r), i: wm(orbit.span, u.i) };
        const dc = orbit.julia ? cz() : offset;
        let d = orbit.julia ? offset : cz(), n = 0, j = 0;
        if (approximation.seriesN) {
          const c = approximation.coefficients;
          let v = c[approximation.seriesOrder];
          for (let k = approximation.seriesOrder - 1; k >= 1; k--) v = ca(cm(v, u), c[k]);
          d = cm(v, u); n = j = approximation.seriesN; skipped += n;
        }
        while (n < view.iterations) {
          if (j + 1 >= orbit.points.length) { answer = -2; break; }
          d = ca(ca(cs(cm(orbit.points[j], d), 2), cm(d, d)), dc); n++; j++;
          const rn = orbit.points[j], actual = ca(rn, d);
          const x = value(actual.r), y = value(actual.i), mag = x * x + y * y;
          if (mag > view.bailout ** 2) { answer = finish(n, mag); break; }
          if (log(magnitude(actual)) < log(magnitude(rn)) - 15) { answer = -2; break; }
          if (!orbit.julia && (log(magnitude(actual)) < log(magnitude(d)) || j + 1 === orbit.points.length)) { d = actual; j = 0; }
        }
      }
      const id = row * width + col;
      field[id] = answer;
      if (answer === -2) glitches.push([col, row]);
      else if (answer >= 0) minimum = Math.min(minimum, answer);
    }
    if (performance.now() - lastYield > 12) { await new Promise(resolve => setTimeout(resolve, 0)); lastYield = performance.now(); }
  }
  if (glitches.length > 4096) throw new Error('CPU precision repair budget exceeded. Reduce quality or move slightly.');
  if (glitches.length) {
    const exact = await exactPixels(view, glitches, width, height);
    glitches.forEach(([col, row], k) => { field[row * width + col] = exact.values[k]; if (exact.values[k] >= 0) minimum = Math.min(minimum, exact.values[k]); });
  }
  return { field, metadata: { width, height, backend: 'cpu', arithmetic: 'fp64', range_mode: perturb ? 'floatexp' : 'standard', acceleration: approximation?.seriesN ? 'series' : 'none', perturbation: perturb, digits: orbit?.digits ?? 16, repaired: glitches.length, color_origin: Number.isFinite(minimum) ? minimum : 0, elapsed_ms: performance.now() - start, mean_skipped_steps: skipped / field.length, timings: prepared?.timings ?? {} } };
}
