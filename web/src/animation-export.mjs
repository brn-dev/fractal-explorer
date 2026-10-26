import { animationPlan } from './animation.mjs';
import { compare, decimal, divide, multiply, order, plainText, text, validate } from './decimal.mjs';
import { minimumSpan } from './fractals.mjs';
import { exportAspect, exportDimensions, wrapPhase } from './export-utils.mjs';

export const exportQualities = {
  draft: { colors: 64, bits: .06, maxBitrate: 80e6 },
  balanced: { colors: 128, bits: .12, maxBitrate: 80e6 },
  high: { colors: 256, bits: .24, maxBitrate: 80e6 },
  ultra: { colors: 256, bits: .96, maxBitrate: 240e6, mp4Only: true },
  extreme: { colors: 256, bits: 2.4, maxBitrate: 600e6, mp4Only: true },
  maximum: { colors: 256, quantizer: 0, mp4Only: true },
};

const overviewSpan = decimal('3.6');
function zoomText(value) {
  const exponent = order(value);
  return exponent > -4 && exponent < 6 ? plainText(value)
    : `${plainText({ n: value.n, e: value.e - exponent })}e${exponent}`;
}
export function zoomJourneyDefaults(view) {
  return { startZoom: '1', endZoom: zoomText(divide(overviewSpan, decimal(view.span), 16)) };
}
function zoomJourney(view, options) {
  view = validate(view);
  const defaults = zoomJourneyDefaults(view), minimum = decimal('.225'), maximum = divide(overviewSpan, decimal(minimumSpan(view.fractal)));
  const endpoint = (value, label) => {
    let zoom;
    try { zoom = decimal(value); }
    catch { throw new Error(`${label} zoom must be a positive number; scientific notation such as 1e12 works.`); }
    if (zoom.n <= 0n) throw new Error(`${label} zoom must be a positive number.`);
    if (compare(zoom, minimum) < 0 || compare(zoom, maximum) > 0) throw new Error(`${label} zoom must be between ${zoomText(minimum)}× and ${zoomText(maximum)}× for this formula.`);
    // The editable default is a short magnification. Preserve the viewport's
    // exact width when it is used, including widths with long decimal mantissas.
    const span = compare(zoom, decimal(defaults.endZoom)) === 0 ? view.span : text(divide(overviewSpan, zoom));
    return { zoom: zoomText(zoom), view: validate({ ...view, span }) };
  };
  const from = endpoint(options.startZoom ?? defaults.startZoom, 'Start'), to = endpoint(options.endZoom ?? defaults.endZoom, 'End');
  const first = decimal(from.view.span), last = decimal(to.view.span);
  const mantissa = value => Number(plainText({ n: value.n, e: -order(value) + value.e }));
  // Interpolate in log space without converting full widths or magnifications
  // to Number: the supported journey can cross thousands of decimal orders.
  const distance = order(last) - order(first) + Math.log10(mantissa(last) / mantissa(first));
  return {
    startZoom: from.zoom, endZoom: to.zoom,
    viewAt: amount => {
      if (amount <= 0 || compare(first, last) === 0) return from.view;
      if (amount >= 1) return to.view;
      const step = distance * amount, exponent = Math.floor(step);
      const scale = decimal(`${10 ** (step - exponent)}e${exponent}`);
      return validate({ ...view, span: text(multiply(first, scale)) });
    },
  };
}

export function animationExport(state, options) {
  const { mode, format, quality, longest, fps, start, speed, wander, aspectRatio = 'view', endHold = 0, repeats = 1 } = options;
  if (!['parameters', 'colors', 'zoom'].includes(mode) || !['gif', 'mp4'].includes(format) || !Object.hasOwn(exportQualities, quality)) throw new Error('Choose valid animation export settings.');
  if (format === 'gif' && exportQualities[quality].mp4Only) throw new Error('Ultra, Extreme, and Maximum quality require MP4. Choose High for GIF.');
  const aspect = exportAspect(state.aspect, aspectRatio);
  if (![480, 720, 1080, 1920, 2560, 3840].includes(longest)) throw new Error('Choose an export resolution.');
  if (![10, 15, 24, 30, 60].includes(fps) || (format === 'gif' && fps > 30)) throw new Error('GIF supports up to 30 fps; MP4 supports up to 60 fps.');
  if (!Number.isFinite(start) || start < 0 || start > 1 || !Number.isFinite(speed) || speed < .05 || speed > 2) throw new Error('Choose a phase from 0 to 1 and a speed from 0.05 to 2 cycles/s.');
  const parameters = mode === 'parameters' ? animationPlan(state.view, state.automation) : null;
  if (mode === 'parameters' && !parameters) throw new Error('Enable automation in a parameter header in the main view first.');
  const duration = parameters ? parameters.duration : mode === 'colors' ? 1 / speed : Number(options.duration);
  if (!Number.isFinite(duration) || duration < .5 || duration > 20) throw new Error('Choose a duration from 0.5 to 20 seconds.');
  if (![0, .5, 1].includes(endHold) || (format === 'gif' && endHold !== 0)) throw new Error('Choose an MP4 end hold of 0, 0.5, or 1 second.');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5 || ((format === 'gif' || mode === 'zoom') && repeats !== 1)) throw new Error('Choose 1–5 repeats for an MP4 parameter or color loop.');
  const cycleFrames = Math.max(2, Math.round(duration * fps)), motionFrames = cycleFrames * repeats, holdFrames = Math.round(endHold * fps), frames = motionFrames + holdFrames;
  const { width, height } = exportDimensions(aspect, longest);
  if (format === 'gif' && width * height * frames > (state.mobile ? 160e6 : 480e6)) throw new Error('This GIF would be too large to encode in memory. Choose MP4, a smaller size, or fewer frames.');
  const colorCycles = mode === 'colors' ? 1 : format === 'mp4' || mode === 'zoom' ? speed * cycleFrames / fps : Math.max(1, Math.round(speed * cycleFrames / fps));
  const zoom = mode === 'zoom' ? zoomJourney(state.visibleView ?? state.view, options) : null;
  return {
    ...options, repeats, aspectRatio, aspect, width, height, frames, cycleFrames, motionFrames, holdFrames, endHold: holdFrames / fps, motionDuration: motionFrames / fps, duration: frames / fps, looping: mode !== 'zoom', parameters,
    ...(zoom ? { startZoom: zoom.startZoom, endZoom: zoom.endZoom } : {}),
    bitrate: exportQualities[quality].quantizer === undefined ? Math.min(exportQualities[quality].maxBitrate, Math.max(500000, Math.round(width * height * fps * exportQualities[quality].bits))) : null,
    quantizer: exportQualities[quality].quantizer ?? null,
    paletteSize: exportQualities[quality].colors,
    delay: index => 10 * (Math.round((index + 1) * 100 / fps) - Math.round(index * 100 / fps)),
    phaseAt: index => wrapPhase(start + (wander ? colorCycles * index / cycleFrames : 0)),
    viewAt: index => parameters ? parameters.viewAt(Math.min(index, motionFrames - 1) % cycleFrames, cycleFrames) : zoom
      ? zoom.viewAt(Math.min(index, motionFrames - 1) / (motionFrames - 1))
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
