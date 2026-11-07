import { animationPlan, animationParameters } from './animation.mjs';
import { decimal, add, multiply, compare, order, plainText, text, boundedText, validate } from './decimal.mjs';
import { exportDimensions, wrapPhase } from './export-utils.mjs';
import { customPaletteDefinition, validateCustomPalette } from './palettes.mjs';
import { exportQualities } from './animation-export.mjs';

export const WALLPAPER_FORMAT = 'fractal-wallpaper/v1';
export const MAX_WALLPAPER_JSON_BYTES = 4 * 1024 ** 2;
export function wallpaperJSON(value, pretty = false) {
  const json = JSON.stringify(value, null, pretty ? 2 : undefined);
  if (new TextEncoder().encode(json).byteLength > MAX_WALLPAPER_JSON_BYTES) throw new Error('Wallpaper data exceeds 4 MiB.');
  return json;
}
export const wallpaperStates = [
  { key: 'closed-transition', title: 'Just closed', description: 'Plays once on the cover screen, then settles into Closed.', file: 'cover-arrival.mp4', screen: 'cover', transition: true, target: 'closed-steady' },
  { key: 'closed-steady', title: 'Closed', description: 'A repeating loop for the small cover screen.', file: 'cover-idle.mp4', screen: 'cover' },
  { key: 'open-transition', title: 'Just opened', description: 'Plays once on the inner screen, then settles into Open.', file: 'inner-arrival.mp4', screen: 'inner', transition: true, target: 'open-steady' },
  { key: 'open-steady', title: 'Open', description: 'A repeating loop for the large inner screen.', file: 'inner-idle.mp4', screen: 'inner' },
];
export const wallpaperScreenName = screen => screen === 'cover' ? 'Cover screen' : 'Main screen';
export function wallpaperSlots(draft) {
  if (draft.screen === undefined) return wallpaperStates;
  if (!['cover', 'inner'].includes(draft.screen)) throw new Error('Choose cover or main screen.');
  return wallpaperStates.filter(slot => slot.screen === draft.screen);
}
export function wallpaperScreenDraft(draft, screen) {
  if (!['cover', 'inner'].includes(screen) || (draft.screen !== undefined && draft.screen !== screen)) throw new Error('This design belongs to the other screen.');
  const next = structuredClone(draft); next.screen = screen;
  next.states = Object.fromEntries(wallpaperSlots(next).map(slot => [slot.key, next.states[slot.key]]));
  next.transitions = Object.fromEntries(wallpaperSlots(next).filter(slot => slot.transition).map(slot => [slot.key, wallpaperTransition(draft, slot.key)]));
  return next;
}
export function wallpaperColorCycle(draft) {
  if (!draft.screen) return null;
  const steady = draft.states[wallpaperSlots(draft).find(slot => !slot.transition).key];
  const seconds = draft.colorSeconds ?? 1 / (steady.speed || .12);
  if (!Number.isFinite(seconds) || seconds < .5 || seconds > 20) throw new Error('Choose a 0.5–20 second color cycle.');
  if (draft.colorWander !== undefined && typeof draft.colorWander !== 'boolean') throw new Error('Choose whether colors should cycle.');
  const duration = wallpaperLoopTiming(steady.view, steady.automation, draft.idleSeconds, draft.idleFps).duration;
  const cycles = Math.min(Math.floor(duration * 2 + 1e-9), Math.max(1, Math.round(duration / seconds)));
  return { enabled: draft.colorWander ?? steady.wander, seconds: duration / cycles, cycles };
}
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function wallpaperLoopTiming(view, settings, seconds, fps) {
  const plan = animationPlan(view, settings ?? {}, fps);
  const requested = Math.max(2, Math.round(seconds * fps));
  if (!plan) return { frames: requested, duration: requested / fps };
  // At the selected frame rate every channel completes integer cycles without
  // changing any speed. Extend the clip, rather than rounding each rate.
  const divisor = plan.channels.map(channel => Math.round(channel.speed * 20)).reduce(gcd, 20 * fps);
  const period = 20 * fps / divisor, frames = Math.ceil(requested / period) * period;
  return { frames, duration: frames / fps };
}
export function wallpaperDimensions(draft, screen, previewLongest) {
  const size = draft.screenSizes?.[screen];
  const valid = size && [size.width, size.height].every(value => Number.isInteger(value) && value >= 16 && value <= 4096 && value % 2 === 0);
  if (size && !valid) throw new Error('Screen dimensions must be even pixels from 16 to 4096.');
  const native = draft.longest === 'native';
  if (native && !valid && !previewLongest) throw new Error(`Open the app on the ${wallpaperScreenName(screen).toLowerCase()} once to detect its resolution, or choose a smaller export size.`);
  const aspect = valid ? size.height / size.width : screen === 'cover' ? draft.coverAspect : draft.innerAspect;
  if (!Number.isFinite(aspect) || aspect < .5 || aspect > 3) throw new Error('Invalid screen proportions.');
  return native && valid && !previewLongest ? { width: size.width, height: size.height } : exportDimensions(aspect, previewLongest ?? Number(draft.longest));
}
export function wallpaperEncoding(width, height, fps, draft) {
  const quality = draft.quality ?? 'high';
  if (quality === 'custom') {
    if (!Number.isFinite(draft.bitrateMbps) || draft.bitrateMbps < .5 || draft.bitrateMbps > 600) throw new Error('Choose a bitrate from 0.5 to 600 Mbps.');
    return { quality, bitrate: Math.round(draft.bitrateMbps * 1e6), quantizer: null };
  }
  if (!Object.hasOwn(exportQualities, quality)) throw new Error('Choose a wallpaper video quality.');
  const preset = exportQualities[quality];
  return { quality, bitrate: preset.quantizer === undefined ? Math.min(preset.maxBitrate, Math.max(500000, Math.round(width * height * fps * preset.bits))) : null, quantizer: preset.quantizer ?? null };
}
export function wallpaperSnapshot(state, palettes, { visible = false } = {}) {
  const colors = { ...state.colors };
  let definition = colors.definition;
  if (!definition && colors.customPalette) definition = customPaletteDefinition(colors.customPalette);
  if (!definition) definition = palettes?.[colors.palette];
  if (!definition) throw new Error('Choose a wallpaper palette.');
  const captureView = state.visibleViewReady === false ? state.requestedView ?? state.view
    : state.visibleView ?? state.requestedView ?? state.view;
  return {
    view: validate(visible ? captureView : state.view), automation: structuredClone(state.automation ?? {}),
    settings: structuredClone(state.settings ?? {}), wander: !!state.wander,
    speed: Number(state.speed ?? .12),
    colors: { density: Number(colors.density ?? 1), phase: wrapPhase(Number(!visible && Number.isFinite(state.loopColorPhase) ? state.loopColorPhase : colors.phase ?? 0)),
      definition: { name: String(definition.name ?? 'Wallpaper'), colors: [...definition.colors] } },
  };
}
export function validateWallpaperSnapshot(snapshot) {
  const out = structuredClone(snapshot);
  out.view = validate(out.view);
  animationPlan(out.view, out.automation ?? {});
  const stops = out.colors.definition.colors;
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 13 || stops.some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) throw new Error('Invalid wallpaper palette.');
  const normalized = stops.map(color => color.toLowerCase()), closed = stops.length > 2 && normalized.at(-1) === normalized[0];
  const palette = validateCustomPalette({ name: out.colors.definition.name ?? 'Wallpaper', colors: closed ? normalized.slice(0, -1) : normalized, loop: closed });
  out.colors.definition = { name: palette.name, colors: normalized };
  if (!Number.isFinite(out.speed) || out.speed < .05 || out.speed > 2) throw new Error('Invalid wallpaper color speed.');
  if (!Number.isFinite(out.colors.density) || out.colors.density < .2 || out.colors.density > 4 || !Number.isFinite(out.colors.phase)) throw new Error('Invalid wallpaper colors.');
  out.colors.phase = wrapPhase(out.colors.phase);
  return out;
}
export function defaultWallpaperDraft(snapshot, screen) {
  const states = Object.fromEntries(wallpaperStates.map(({ key }) => [key, structuredClone(snapshot)]));
  for (const slot of wallpaperStates) if (!slot.transition && !animationPlan(snapshot.view, snapshot.automation)) states[slot.key].wander = true;
  for (const slot of wallpaperStates) if (slot.transition) {
    const span = multiply(decimal(snapshot.view.span), decimal('1.3'));
    states[slot.key].view = validate({ ...snapshot.view, span: compare(span, decimal('16')) > 0 ? '16' : text(span) });
  }
  const draft = { format: WALLPAPER_FORMAT, name: 'My fractal wallpaper', quality: 'maximum', steadyMotion: 'animated', arrivalSeconds: 3, idleSeconds: 8,
    longest: 1080, arrivalFps: 30, idleFps: 15, coverAspect: 2520 / 1080, innerAspect: 2504 / 2256,
    states, transitions: Object.fromEntries(wallpaperStates.filter(slot => slot.transition).map(slot => [slot.key, {seconds:3,easing:'ease-out'}])) };
  return screen ? wallpaperScreenDraft(draft, screen) : draft;
}
const mixDecimal = (a, b, t) => t <= 0 ? String(a) : t >= 1 ? String(b)
  : boundedText(add(decimal(a), multiply(add(decimal(b), multiply(decimal(a), decimal('-1'))), decimal(t.toPrecision(17)))));
function mixSpan(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const first = decimal(a), last = decimal(b);
  const mantissa = d => Number(plainText({ n: d.n, e: d.e - order(d) }));
  const distance = order(last) - order(first) + Math.log10(mantissa(last) / mantissa(first));
  const step = distance * t, exponent = Math.floor(step);
  const mixed = multiply(first, decimal(`${10 ** (step - exponent)}e${exponent}`));
  const low = compare(first, last) <= 0 ? first : last, high = compare(first, last) <= 0 ? last : first;
  return boundedText(compare(mixed, low) < 0 ? low : compare(mixed, high) > 0 ? high : mixed);
}
export function wallpaperViewPath(from, to) {
  const keys = new Map([['x', {}], ['y', {}], ['span', {}], ['bailout', { numeric: true }],
    ...animationParameters(to).map(p => [p.key, { numeric: !p.decimal, integer: p.step === 1 || p.key === 'iterations' }])]);
  const compatible = from.fractal === to.fractal && [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .every(key => keys.has(key) || JSON.stringify(from[key]) === JSON.stringify(to[key]));
  return { compatible, viewAt: amount => {
    if (amount <= 0) return from;
    if (amount >= 1) return to;
    if (!compatible) return null;
    const out = { ...from };
    for (const [key, p] of keys) {
      if (from[key] === undefined || to[key] === undefined || from[key] === to[key]) continue;
      if (key === 'span') out[key] = mixSpan(from[key], to[key], amount);
      else if (p.numeric) {
        const a = Number(from[key]), b = Number(to[key]);
        const value = Math.max(Math.min(a, b), Math.min(Math.max(a, b), a + (b - a) * amount));
        out[key] = p.integer ? Math.round(value) : value;
      }
      else out[key] = mixDecimal(from[key], to[key], amount);
    }
    return validate(out);
  } };
}
export const transitionCurves = [
  { value: 'ease-out', label: 'Fast start · smooth finish' },
  { value: 'ease-out-strong', label: 'Very fast start · long glide' },
  { value: 'linear', label: 'Constant speed' },
  { value: 'ease-in-out', label: 'Slow start · smooth finish' },
];
export function wallpaperTransition(draft, key) {
  if (!wallpaperStates.some(slot => slot.key === key && slot.transition)) throw new Error('Unknown wallpaper transition.');
  if (draft.transitions !== undefined && (!draft.transitions || typeof draft.transitions !== 'object' || Array.isArray(draft.transitions))) throw new Error('Invalid transition timing.');
  const saved = draft.transitions?.[key];
  if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved))) throw new Error('Invalid transition timing.');
  const seconds = saved?.seconds ?? draft.arrivalSeconds, easing = saved?.easing ?? 'ease-out';
  if (!Number.isFinite(seconds) || seconds < .5 || seconds > 10) throw new Error('Choose a 0.5–10 second transition.');
  if (!transitionCurves.some(curve => curve.value === easing)) throw new Error('Choose a transition motion curve.');
  return { seconds, easing };
}
export function transitionProgress(t, easing) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (easing === 'ease-out') return 1 - (1 - t) ** 3;
  if (easing === 'ease-out-strong') return 1 - (1 - t) ** 5;
  if (easing === 'linear') return t;
  if (easing === 'ease-in-out') return t * t * t * (t * (t * 6 - 15) + 10);
  throw new Error('Choose a transition motion curve.');
}
export function wallpaperPlan(draft, { previewLongest } = {}) {
  if (draft.format !== WALLPAPER_FORMAT) throw new Error('This is not a Fractal Explorer wallpaper.');
  if (!['animated', 'still'].includes(draft.steadyMotion ?? 'animated')) throw new Error('Choose a steady-state playback mode.');
  if (draft.longest !== 'native' && ![480, 720, 1080, 1920, 2560, 3840].includes(Number(draft.longest))) throw new Error('Choose a wallpaper resolution.');
  if (!Number.isFinite(draft.arrivalSeconds) || draft.arrivalSeconds < .5 || draft.arrivalSeconds > 10 ||
      !Number.isFinite(draft.idleSeconds) || draft.idleSeconds < 2 || draft.idleSeconds > 20) throw new Error('Choose a 0.5–10 second arrival and a 2–20 second idle loop.');
  if (![15, 24, 30].includes(draft.arrivalFps) || ![10, 15, 24, 30].includes(draft.idleFps)) throw new Error('Choose a wallpaper frame rate.');
  const slots = wallpaperSlots(draft), colorCycle = wallpaperColorCycle(draft);
  const states = Object.fromEntries(slots.map(({ key }) => [key, validateWallpaperSnapshot(draft.states[key])]));
  return slots.map(slot => {
    const snapshot = states[slot.key], destination = states[slot.target] ?? snapshot;
    const fps = slot.transition ? draft.arrivalFps : draft.idleFps;
    const timing = slot.transition ? wallpaperTransition(draft, slot.key) : null;
    const loop = wallpaperLoopTiming(snapshot.view, snapshot.automation, draft.idleSeconds, fps);
    const frames = slot.transition ? Math.max(2, Math.round(timing.seconds * fps)) : draft.screen ? loop.frames : Math.max(2, Math.round(draft.idleSeconds * fps));
    const dimensions = wallpaperDimensions(draft, slot.screen, previewLongest), aspect = dimensions.height / dimensions.width;
    const path = wallpaperViewPath(snapshot.view, destination.view);
    const samePalette = JSON.stringify(snapshot.colors.definition.colors) === JSON.stringify(destination.colors.definition.colors);
    const sameSettings = JSON.stringify(snapshot.settings ?? {}) === JSON.stringify(destination.settings ?? {});
    const crossfade = slot.transition && (!path.compatible || (!colorCycle && !samePalette) || !sameSettings);
    const automation = !slot.transition ? animationPlan(snapshot.view, snapshot.automation, fps) : null;
    const channels = automation?.channels.map(channel => ({ key: channel.key,
      cycles: Math.max(1, Math.round(channel.speed * frames / fps)),
      plan: draft.screen ? null : animationPlan(snapshot.view, { [channel.key]: automation.settings[channel.key] }, fps) })) ?? [];
    const cycles = colorCycle ? colorCycle.enabled ? colorCycle.cycles : 0 : snapshot.wander ? Math.max(1, Math.round((snapshot.speed || .12) * frames / fps)) : 0;
    return { ...slot, ...dimensions, fps, frames, duration: frames / fps, easing: timing?.easing, aspect, snapshot, destination,
      crossfade, ...wallpaperEncoding(dimensions.width, dimensions.height, fps, draft),
      colorCycleSeconds: colorCycle?.seconds, parameterCycles: Object.fromEntries(channels.map(channel => [channel.key, channel.cycles])),
      sample(index) {
        if (!Number.isInteger(index) || index < 0 || index >= frames) throw new Error('Invalid wallpaper frame.');
        const amount = slot.transition ? transitionProgress(index / (frames - 1), timing.easing) : 0;
        const colors = colorCycle ? { ...destination.colors, phase: wrapPhase(destination.colors.phase + (colorCycle.enabled ? (slot.transition ? (index - frames + 1) / fps / colorCycle.seconds : cycles * index / frames) : 0)) }
          : slot.transition && amount >= 1 ? destination.colors : slot.transition && amount <= 0 ? snapshot.colors : slot.transition ? { ...destination.colors,
          density: snapshot.colors.density + (destination.colors.density - snapshot.colors.density) * amount,
          phase: wrapPhase(snapshot.colors.phase + (destination.colors.phase - snapshot.colors.phase) * amount) }
          : { ...snapshot.colors, phase: wrapPhase(snapshot.colors.phase + cycles * index / frames) };
        const animated = draft.screen && automation ? automation.viewAt(index) : channels.length ? { ...snapshot.view } : snapshot.view;
        if (!draft.screen) for (const channel of channels) animated[channel.key] = channel.plan.viewAt(index * channel.cycles / channel.plan.channels[0].cycles, frames)[channel.key];
        return { view: slot.transition ? path.viewAt(amount) : animated,
          colors, amount, crossfade,
          from: colorCycle ? { ...snapshot, colors } : snapshot, to: colorCycle ? { ...destination, colors } : destination };
      },
    };
  });
}

export function wallpaperManifest(draft, clips) {
  const manifest = { format: WALLPAPER_FORMAT, version: 1, name: String(draft.name || 'My fractal wallpaper').slice(0, 80), steadyMotion: draft.steadyMotion ?? 'animated',
    ...(draft.screen ? { screen: draft.screen } : {}),
    playback: Object.fromEntries((draft.screen ? [draft.screen] : ['cover', 'inner']).map(screen => screen === 'cover' ? ['just-closed', ['closed-transition', 'closed-steady']] : ['just-opened', ['open-transition', 'open-steady']])),
    clips: Object.fromEntries(clips.map(clip => [clip.key, { file: clip.file, width: clip.width, height: clip.height, fps: clip.fps, frames: clip.frames, duration: clip.duration, loop: !clip.transition, quality: clip.quality, bitrate: clip.bitrate, quantizer: clip.quantizer }])),
    posters: Object.fromEntries([...new Set(clips.map(clip => clip.screen))].map(screen => [screen, `${screen}-poster.png`])), editor: draft };
  wallpaperJSON(manifest);
  return manifest;
}
