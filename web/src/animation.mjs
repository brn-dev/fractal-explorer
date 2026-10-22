import { hasConstant, fractalParameters } from './fractals.mjs';
import { validate, decimal, add, multiply, text, plainText } from './decimal.mjs';

export const LIVE_FPS = 30;
const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);
const sine = t => (1 - Math.cos(Math.PI * t)) / 2;
const easeToMiddle = t => t <= .5 ? smootherstep(2 * t) / 2 : .5 + smootherstep(2 * t - 1) / 2;
export const cycleShapes = {
  sine: { label: 'Sine · gentle', ease: sine },
  smoothstep: { label: 'Smoothstep · soft turns', ease: t => t * t * (3 - 2 * t) },
  smootherstep: { label: 'Smootherstep · lingering turns', ease: smootherstep },
  hold: { label: 'Ease & pause', ease: t => t <= .15 ? 0 : t >= .85 ? 1 : smootherstep((t - .15) / .7) },
  'slow-middle': { label: 'Ease to middle', ease: easeToMiddle },
  'smooth-middle': { label: 'Slow middle · continuous', ease: t => .25 * sine(t) + .75 * easeToMiddle(t) },
  'pause-middle': { label: 'Pause at middle', ease: t => t < .4 ? smootherstep(t / .4) / 2 : t > .6 ? .5 + smootherstep((t - .6) / .4) / 2 : .5 },
  linear: { label: 'Linear · constant speed', ease: t => t },
};
export const cacheMemoryOptionsMiB = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
export function cacheMemorySetting(value, mobile = false) {
  return cacheMemoryOptionsMiB.includes(value) ? value : mobile ? 256 : 2048;
}
export function cacheMemoryLabel(mib) {
  return mib >= 1024 ? `${Number((mib / 1024).toFixed(2))} GB` : `${Math.ceil(mib)} MB`;
}
export function animationParameters(view) {
  const constant = view.fractal === 'newton' ? 'Root target' : view.fractal === 'custom' && view.custom_mode === 'advanced' ? 'Constant k' : 'Constant';
  return [
    ...(hasConstant(view) ? [
      { key: 'julia_x', label: `${constant} · real`, decimal: true, slider: 'julia-x-slider' },
      { key: 'julia_y', label: `${constant} · imaginary`, decimal: true, slider: 'julia-y-slider' },
    ] : []),
    ...fractalParameters(view).map(p => ({ ...p, slider: `parameter-${p.key}-slider` })),
    { key: 'iterations', label: 'Iterations', min: 50, max: 50000, step: 1, slider: 'iterations-slider' },
  ];
}
export function defaultAutomation(view, p) {
  let target;
  if (p.decimal) {
    target = plainText(add(decimal(view[p.key]), decimal('.02')));
    try { validate({ ...view, [p.key]: target }); }
    catch { target = plainText(add(decimal(view[p.key]), decimal('-.02'))); }
  }
  else {
    const step = p.key === 'iterations' ? 200 : p.step === 1 ? 1 : .15;
    target = Math.min(p.max, view[p.key] + step);
    if (target === view[p.key]) target = Math.max(p.min, view[p.key] - step);
    target = Number(target.toPrecision(12));
  }
  return { enabled: true, target: String(target), speed: .25, shape: 'smootherstep' };
}
export function validateAutomation(view, settings = {}) {
  const out = {};
  for (const p of animationParameters(view)) {
    const entry = settings[p.key];
    if (!entry?.enabled) continue;
    const speed = Number(entry.speed), ticks = Math.round(speed * 20);
    if (!Number.isFinite(speed) || speed < .05 || speed > 2 || Math.abs(speed * 20 - ticks) > 1e-8) throw new Error('Cycle speed must be 0.05–2 cycles/s, in steps of 0.05.');
    if (String(entry.target).trim() === '') throw new Error(`Enter a target for ${p.label}.`);
    const target = p.decimal ? String(entry.target) : Number(entry.target);
    validate({ ...view, [p.key]: target });
    // Existing sessions keep their original sine motion when no shape was saved.
    const shape = entry.shape ?? 'sine';
    if (!Object.hasOwn(cycleShapes, shape)) throw new Error('Choose a valid cycle shape.');
    out[p.key] = { enabled: true, target: String(entry.target), speed: ticks / 20, shape };
  }
  return out;
}
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function animationPlan(view, settings, fps = LIVE_FPS, startFrame = 0) {
  const valid = validateAutomation(view, settings), parameters = animationParameters(view).filter(p => valid[p.key]);
  if (!parameters.length) return null;
  const divisor = parameters.map(p => Math.round(valid[p.key].speed * 20)).reduce(gcd);
  // Rates are multiples of 0.05 cycles/s: all parameters share a loop <=20 s.
  const frames = Math.max(2, Math.round(fps * 20 / divisor)), duration = frames / fps;
  const frameOffset = ((Math.round(startFrame) % frames) + frames) % frames;
  const channels = parameters.map(p => ({ ...p, ...valid[p.key], cycles: Math.round(valid[p.key].speed * 20) / divisor }));
  const viewAt = (index, count = frames) => {
    const next = { ...view };
    for (const p of channels) {
      const position = (((index + frameOffset * count / frames) * p.cycles) % count + count) % count;
      const distance = Math.min(position, count - position);
      // Fold integer frame positions before easing so return frames stay exact aliases.
      const amount = Math.max(0, Math.min(1, cycleShapes[p.shape].ease(2 * distance / count)));
      if (amount === 0) continue;
      if (p.decimal) {
        if (amount === 1) next[p.key] = p.target;
        else {
          const from = decimal(view[p.key]), to = decimal(p.target);
          next[p.key] = text(add(from, multiply(add(to, { n: -from.n, e: from.e }), decimal(amount.toPrecision(17)))));
        }
      } else {
        const value = Number(view[p.key]) + (Number(p.target) - Number(view[p.key])) * amount;
        next[p.key] = p.step === 1 ? Math.round(value) : value;
      }
    }
    return validate(next);
  };
  return { frames, fps, duration, channels, settings: valid, frameOffset, viewAt };
}

export function cacheDimensions(dimensions, frames, budget) {
  const pixels = Math.floor(budget / (4 * (frames + 2)));
  const scale = Math.min(1, Math.sqrt(pixels / (dimensions.width * dimensions.height)));
  const width = Math.max(16, Math.floor(dimensions.width * scale)), height = Math.max(16, Math.floor(dimensions.height * scale));
  if (width * height > pixels) throw new Error('This loop does not fit the animation cache. Increase the cycle speed.');
  return { width, height, capped: scale < 1 || dimensions.capped, bytes: width * height * 4 * frames };
}

// One in-flight render. First pass follows deadlines; later passes fill holes.
export class FrameSchedule {
  constructor(count, fps = LIVE_FPS) {
    this.count = count; this.fps = fps; this.ready = new Set(); this.start = null;
    this.cursor = 0; this.firstPass = true; this.pausedAt = null;
  }
  elapsed(time) { return this.start === null ? 0 : Math.max(0, ((this.pausedAt ?? time) - this.start) / 1000); }
  index(time) { return Math.floor(this.elapsed(time) * this.fps) % this.count; }
  pause(time) { this.pausedAt ??= time; }
  resume(time) { if (this.pausedAt !== null) { if (this.start !== null) this.start += time - this.pausedAt; this.pausedAt = null; } }
  complete(indices, time) {
    for (const index of indices) this.ready.add(index);
    if (this.start === null && this.ready.has(0)) this.start = this.pausedAt ?? time;
    this.cursor = Math.max(this.cursor, Math.min(...indices) + 1);
  }
  next(time) {
    if (this.ready.size === this.count) return null;
    if (!this.ready.has(0)) return 0;
    if (this.firstPass) {
      const future = Math.max(this.cursor, Math.floor(this.elapsed(time) * this.fps) + 1);
      for (let index = future; index < this.count; index++) if (!this.ready.has(index)) { this.cursor = index + 1; return index; }
      this.firstPass = false;
    }
    // Prefer the next missing frame near the playhead, but visit every hole.
    const current = this.index(time);
    for (let offset = 0; offset < this.count; offset++) {
      const index = (current + offset) % this.count;
      if (!this.ready.has(index)) return index;
    }
    return null;
  }
  visible(time) {
    const current = this.index(time);
    for (let offset = 0; offset < this.count; offset++) {
      const index = (current - offset + this.count) % this.count;
      if (this.ready.has(index)) return index;
    }
    return null;
  }
}

export class ProgressiveAnimation {
  constructor({ render, cancel = () => {}, present, status = () => {}, error = () => {}, now = () => performance.now() }) {
    Object.assign(this, { render, cancel, present, status, error, now });
    this.version = 0; this.busy = false; this.plan = null; this.frames = []; this.paused = false;
    this.cachedBytes = 0; this.cacheBuffers = new Set();
  }
  configure(plan, dimensions) {
    this.cancel(); this.version++; this.plan = plan; this.dimensions = dimensions;
    this.frames = []; this.lastShown = null; this.lastIndex = null; this.failed = false;
    this.cachedBytes = 0; this.cacheBuffers.clear();
    this.schedule = plan ? new FrameSchedule(plan.frames, plan.fps) : null;
    this.views = plan ? Array.from({ length: plan.frames }, (_, i) => plan.viewAt(i)) : [];
    this.keys = this.views.map(v => JSON.stringify(v)); this.byKey = new Map();
    this.status(this);
  }
  setPaused(paused, time = this.now()) {
    this.paused = paused;
    if (paused) this.schedule?.pause(time);
    else this.schedule?.resume(time);
    this.status(this);
  }
  tick(time, suspended = false, recolor = false) {
    if (!this.plan || this.failed) return;
    if (this.paused || suspended) this.schedule.pause(time);
    else this.schedule.resume(time);
    if (suspended) return;
    // Hold the frame the user actually saw, even if an in-flight render finishes.
    if (this.paused && this.lastShown) {
      if (recolor) this.present(this.lastShown, this.lastIndex);
      return;
    }
    const index = this.schedule.visible(time);
    if (index !== null && (index !== this.lastIndex || this.frames[index] !== this.lastShown || recolor)) {
      this.lastIndex = index; this.lastShown = this.frames[index];
      this.present(this.lastShown, index);
    }
    // A paused view can still refresh frame zero after a pan or settings edit.
    if (this.busy || (this.paused && this.schedule.ready.has(0))) return;
    const next = this.schedule.next(time);
    if (next === null) return;
    const version = this.version, view = this.views[next], dimensions = this.dimensions;
    this.busy = true;
    Promise.resolve().then(() => this.render(view, dimensions)).then(result => {
      if (version !== this.version) return;
      const frame = { ...result, view };
      const buffer = result.field?.buffer;
      if (buffer && !this.cacheBuffers.has(buffer)) {
        this.cacheBuffers.add(buffer); this.cachedBytes += buffer.byteLength;
      }
      this.byKey.set(this.keys[next], frame);
      const aliases = [];
      for (let i = 0; i < this.keys.length; i++) if (this.keys[i] === this.keys[next]) { this.frames[i] = frame; aliases.push(i); }
      this.schedule.complete(aliases, this.now());
      this.status(this);
    }).catch(error => {
      if (version === this.version && error.name !== 'AbortError') { this.failed = true; this.error(error); }
    }).finally(() => { this.busy = false; });
  }
}
