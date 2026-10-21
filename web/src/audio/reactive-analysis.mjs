export const SAMPLE_SIDE = 32;
export const REACTIVE_TIMING = Object.freeze({ window: .12, cooldown: .65, attack: .09, release: .45 });
const clamp = n => Math.max(0, Math.min(1, n));
export function sampleField(field, width, height, side = SAMPLE_SIDE) {
  if (!field || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || field.length < width * height) return null;
  const values = new Float32Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) values[y * side + x] = field[Math.min(height - 1, Math.floor((y + .5) * height / side)) * width + Math.min(width - 1, Math.floor((x + .5) * width / side))];
  return values;
}

export function extractFeatures(samples, view = {}, side = SAMPLE_SIDE) {
  if (!samples || samples.length !== side * side) return null;
  const values = new Float32Array(samples.length), mask = new Int8Array(samples.length), finite = [];
  for (let i = 0; i < samples.length; i++) {
    const n = samples[i];
    // -1 is interior/unclassified; -2 is an unresolved repair, not interior.
    mask[i] = n === -1 ? 1 : Number.isFinite(n) && n >= 0 ? 0 : -1;
    if (mask[i] === 0) finite.push(n);
  }
  if (!mask.some(n => n !== -1)) return null;
  finite.sort((a,b) => a-b);
  const lo = finite[Math.floor(finite.length * .05)] ?? 0, hi = finite[Math.min(finite.length - 1, Math.floor(finite.length * .95))] ?? lo;
  const span = hi - lo;
  for (let i = 0; i < samples.length; i++) {
    if (mask[i] !== 0) continue;
    // Newton encodes root/degree + capped convergence steps in log1p(n)/5.
    // Preserve that combined basin/convergence coordinate, not escape semantics.
    values[i] = view.fractal === 'newton' ? clamp(Math.log1p(samples[i]) / 6) : span > 1e-4 * Math.max(1, Math.abs(lo), Math.abs(hi)) ? clamp((samples[i] - lo) / span) : .5;
  }
  const regions = new Float32Array(64), counts = new Uint16Array(64);
  let edges = 0, complexity = 0, interior = 0, valid = 0, left = 0, right = 0, nl = 0, nr = 0;
  const difference = (i,j) => mask[i] !== mask[j] ? 1 : Math.abs(values[i] - values[j]);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = y * side + x;
    if (mask[i] < 0) continue;
    valid++; interior += mask[i];
    const value = mask[i] ? 0 : values[i];
    if (x < side / 2) { left += value; nl++; } else { right += value; nr++; }
    const region = Math.min(7, Math.floor(y * 8 / side)) * 8 + Math.min(7, Math.floor(x * 8 / side));
    for (const j of [x + 1 < side ? i + 1 : -1, y + 1 < side ? i + side : -1]) if (j >= 0 && mask[j] >= 0) {
      const delta = difference(i,j); complexity += delta; edges++; regions[region] += delta; counts[region]++;
    }
  }
  for (let i = 0; i < 64; i++) regions[i] /= Math.max(1,counts[i]);
  const regional = [...regions].sort((a,b)=>a-b)[57];
  return { values, mask, side, family: view.fractal, complexity: complexity / Math.max(1,edges), regional, interior: interior / Math.max(1,valid), balance: (right / Math.max(1,nr) - left / Math.max(1,nl)) };
}

export function compareFeatures(current, previous) {
  const empty = { change: 0, localChange: 0, maskChange: 0, complexityChange: 0 };
  if (!current || !previous || current.side !== previous.side || current.family !== previous.family) return empty;
  const sums = new Float32Array(64), counts = new Uint16Array(64);
  let total = 0, valid = 0, masks = 0;
  for (let i = 0; i < current.values.length; i++) {
    if (current.mask[i] < 0 || previous.mask[i] < 0) continue;
    const changed = current.mask[i] !== previous.mask[i];
    const delta = changed ? 1 : Math.max(0, Math.abs(current.values[i] - previous.values[i]) - .004);
    const x = i % current.side, y = Math.floor(i / current.side), region = Math.floor(y * 8 / current.side) * 8 + Math.floor(x * 8 / current.side);
    total += delta; masks += changed ? 1 : 0; valid++; sums[region] += delta; counts[region]++;
  }
  for (let i = 0; i < 64; i++) sums[i] /= Math.max(1,counts[i]);
  return { change: total / Math.max(1,valid), localChange: Math.max(...sums), maskChange: masks / Math.max(1,valid), complexityChange: current.complexity - previous.complexity };
}

// Called for displayed fields only. Completion order and frame indices do not
// enter the comparison; missing cache slots simply hold the previous field.
export class ReactiveTracker {
  constructor() { this.reset(); }
  reset() { this.previous = null; this.history = []; this.baseline = .02; this.armed = true; this.lastEvent = -Infinity; this.lastTime = null; this.lastScore = 0; }
  observe(features, time) {
    if (!features) return null;
    if (this.lastTime !== null && time < this.lastTime) return null;
    const delta = compareFeatures(features, this.previous);
    // A short display-time window captures transformations spread over several
    // frames. Consecutive-frame deltas alone become tiny at high playback fps.
    while (this.history.length > 1 && this.history[1].time <= time - REACTIVE_TIMING.window) this.history.shift();
    const reference = this.history[0];
    const motionDelta = compareFeatures(features, reference?.features);
    const interval = reference ? Math.max(1/120,time - reference.time) : REACTIVE_TIMING.window;
    const rate = interval <= .25 ? Math.min(2,REACTIVE_TIMING.window / interval) : 1;
    const score = clamp(Math.max(motionDelta.change * 2, motionDelta.localChange * .85, motionDelta.maskChange * 2.5) * rate);
    const dt = this.lastTime === null ? 0 : Math.min(2, Math.max(0,time - this.lastTime));
    const novelty = Math.max(0, score - this.baseline * 1.25);
    const onset = this.armed || score - this.lastScore > .14;
    const event = !!this.previous && onset && novelty > .14 && score > .20 && time - this.lastEvent >= REACTIVE_TIMING.cooldown;
    if (event) { this.lastEvent = time; this.armed = false; }
    if (score < .10) this.armed = true;
    this.baseline += (score - this.baseline) * (1 - Math.exp(-dt / 1.5));
    this.history.push({ features, time });
    if (this.history.length > 20) this.history.shift();
    this.previous = features; this.lastTime = time; this.lastScore = score;
    return { ...features, ...delta, motion: score, novelty, event };
  }
}
export function smooth(current, target, seconds, attack = 1.4, release = 6) {
  return current + (target - current) * (1 - Math.exp(-Math.max(0,seconds) / (target > current ? attack : release)));
}
