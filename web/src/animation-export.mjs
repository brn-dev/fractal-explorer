import { animationPlan } from './animation.mjs';
import { navigate } from './decimal.mjs';
import { wrapPhase } from './export-utils.mjs';

export const exportQualities = { draft: { colors: 64, bits: .06 }, balanced: { colors: 128, bits: .12 }, high: { colors: 256, bits: .24 } };
export function animationExport(state, options) {
  const { mode, format, quality, longest, fps, start, speed, wander } = options;
  if (!['parameters', 'colors', 'zoom'].includes(mode) || !['gif', 'mp4'].includes(format) || !Object.hasOwn(exportQualities, quality)) throw new Error('Choose valid animation export settings.');
  if (![480, 720, 1080, 1920, 2560, 3840].includes(longest)) throw new Error('Choose an export resolution.');
  if (![10, 15, 24, 30, 60].includes(fps) || (format === 'gif' && fps > 30)) throw new Error('GIF supports up to 30 fps; MP4 supports up to 60 fps.');
  if (!Number.isFinite(start) || start < 0 || start > 1 || !Number.isFinite(speed) || speed < .05 || speed > 2) throw new Error('Choose a phase from 0 to 1 and a speed from 0.05 to 2 cycles/s.');
  const parameters = mode === 'parameters' ? animationPlan(state.view, state.automation) : null;
  if (mode === 'parameters' && !parameters) throw new Error('Enable automation in a parameter header in the main view first.');
  const duration = parameters ? parameters.duration : mode === 'colors' ? 1 / speed : Number(options.duration);
  if (!Number.isFinite(duration) || duration < .5 || duration > 20) throw new Error('Choose a duration from 0.5 to 20 seconds.');
  const frames = Math.max(2, Math.round(duration * fps));
  const width = Math.max(16, 2 * Math.round(longest / Math.max(1, state.aspect) / 2));
  const height = Math.max(16, 2 * Math.round(longest * Math.min(1, state.aspect) / 2));
  if (format === 'gif' && width * height * frames > (state.mobile ? 160e6 : 480e6)) throw new Error('This GIF would be too large to encode in memory. Choose MP4, a smaller size, or fewer frames.');
  const colorCycles = mode === 'colors' ? 1 : mode === 'zoom' ? speed * frames / fps : Math.max(1, Math.round(speed * frames / fps));
  return {
    ...options, width, height, frames, duration: frames / fps, looping: mode !== 'zoom', parameters,
    bitrate: Math.min(80e6, Math.max(500000, Math.round(width * height * fps * exportQualities[quality].bits))),
    paletteSize: exportQualities[quality].colors,
    delay: index => 10 * (Math.round((index + 1) * 100 / fps) - Math.round(index * 100 / fps)),
    phaseAt: index => wrapPhase(start + (wander ? colorCycles * index / frames : 0)),
    viewAt: index => parameters ? parameters.viewAt(index, frames) : mode === 'zoom'
      ? navigate({ view: state.visibleView ?? state.view, factor: 8 ** (index / (frames - 1)) })
      : state.visibleView ?? state.view,
  };
}

export function ditherFrame(rgba, width) {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const result = new Uint8ClampedArray(rgba);
  for (let i = 0; i < result.length; i += 4) {
    const pixel = i / 4, noise = (bayer[(Math.floor(pixel / width) % 4) * 4 + pixel % 4] - 7.5) * .6;
    // Keep the exact interior color out of the dither pattern.
    if (rgba[i] === 8 && rgba[i + 1] === 17 && rgba[i + 2] === 18) continue;
    for (let c = 0; c < 3; c++) result[i + c] += noise;
  }
  return result;
}
