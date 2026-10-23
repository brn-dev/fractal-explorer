import { decimal, add, multiply, text, validate } from './decimal.mjs';
import { hasConstant } from './fractals.mjs';

export const wrapPhase = phase => ((phase % 1) + 1) % 1;
export const advancePhase = (phase, speed, seconds) => wrapPhase(phase + speed * Math.max(0, seconds));

export function exportDimensions(aspect, longest) {
  return {
    width: Math.max(16, 2 * Math.round(longest / Math.max(1, aspect) / 2)),
    height: Math.max(16, 2 * Math.round(longest * Math.min(1, aspect) / 2)),
  };
}

export function animationFrames(duration) {
  if (!Number.isFinite(duration) || duration < .5 || duration > 20) throw new Error('Choose a duration from 0.5 to 20 seconds.');
  const ticks = Math.round(duration * 100), frames = Math.min(400, Math.max(10, Math.round(ticks / 5)));
  return { frames, duration: ticks / 100, delay: frame => (Math.floor((frame + 1) * ticks / frames) - Math.floor(frame * ticks / frames)) * 10 };
}

export function colorCycle(startPhase, speed) {
  if (!Number.isFinite(startPhase) || startPhase < 0 || startPhase > 1) throw new Error('Choose a start phase from 0 to 1.');
  if (!Number.isFinite(speed) || speed < .05 || speed > 2) throw new Error('Choose a speed from 0.05 to 2 cycles per second.');
  // GIF delays use hundredths of a second. Distribute rounding across frames
  // so the complete cycle keeps the requested duration, without a duplicate end frame.
  const plan = animationFrames(1 / speed);
  return {
    ...plan, phase: frame => wrapPhase(startPhase + frame / plan.frames),
  };
}

export function juliaView(view, target, progress, returning = true) {
  if (!hasConstant(view)) throw new Error('Choose a fractal with an adjustable complex constant.');
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Animation progress must be between 0 and 1.');
  const end = validate({ ...view, julia_x: target.x, julia_y: target.y });
  const amount = returning ? (1 - Math.cos(progress * Math.PI * 2)) / 2 : (1 - Math.cos(progress * Math.PI)) / 2;
  if (amount === 0) return { ...view };
  if (amount === 1) return end;
  const blend = (from, to) => {
    const a = decimal(from), b = decimal(to);
    const difference = add(b, { n: -a.n, e: a.e });
    return text(add(a, multiply(difference, decimal(amount.toPrecision(17)))));
  };
  return validate({ ...view, julia_x: blend(view.julia_x, end.julia_x), julia_y: blend(view.julia_y, end.julia_y) });
}

export function drawVignette(canvas) {
  const context = canvas.getContext('2d'), { width, height } = canvas;
  // CSS lists the vertical gradient first, so it is composited last.
  const horizontal = context.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, '#0a130b42'); horizontal.addColorStop(.35, 'transparent'); horizontal.addColorStop(1, 'transparent');
  context.fillStyle = horizontal; context.fillRect(0, 0, width, height);
  const vertical = context.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, '#08110da6'); vertical.addColorStop(.35, 'transparent');
  vertical.addColorStop(.6, 'transparent'); vertical.addColorStop(1, '#0b1511ed');
  context.fillStyle = vertical; context.fillRect(0, 0, width, height);
}

export function createColorFrames(values, metadata, density, table) {
  let minimum = metadata.color_origin ?? Infinity;
  if (!Number.isFinite(minimum)) {
    minimum = Infinity;
    for (const value of values) if (value >= 0 && value < minimum) minimum = value;
    if (!Number.isFinite(minimum)) minimum = 0;
  }
  const offsets = Float64Array.from(values, value => value < 0 ? -1 : wrapPhase(Math.log1p(Math.max(0, value - minimum)) * .2 * density));
  const output = document.createElement('canvas'); output.width = metadata.width; output.height = metadata.height;
  const context = output.getContext('2d'), image = context.createImageData(output.width, output.height);
  const overlay = document.createElement('canvas'); overlay.width = output.width; overlay.height = output.height;
  drawVignette(overlay);
  return phase => {
    const bytes = image.data;
    for (let i = 0; i < offsets.length; i++) {
      const index = i * 4;
      if (offsets[i] < 0) { bytes[index] = 8; bytes[index + 1] = 17; bytes[index + 2] = 18; }
      else {
        const k = Math.min(4095, Math.floor(wrapPhase(offsets[i] + phase) * 4096)) * 3;
        bytes[index] = table[k]; bytes[index + 1] = table[k + 1]; bytes[index + 2] = table[k + 2];
      }
      bytes[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return { canvas: output, context, overlay };
  };
}

export function gifPaletteSample(table, vignette) {
  // Sample the whole color ramp, including colors absent from the first frame.
  // Distribute it over the canvas so vignette shading is represented too.
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const context = canvas.getContext('2d'), image = context.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < image.data.length / 4; i++) {
    const k = (i * 17 % 4096) * 3;
    image.data.set([table[k], table[k + 1], table[k + 2], 255], i * 4);
  }
  // Include the interior color as well as escaped points.
  for (let i = 0; i < canvas.width; i++) image.data.set([8, 17, 18, 255], i * 4);
  context.putImageData(image, 0, 0);
  if (vignette) drawVignette(canvas);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}
