import { wallpaperPaletteDrafts, wallpaperPlan, wallpaperManifest, wallpaperJSON } from './wallpaper.mjs';
import { WallpaperFrameRenderer } from './wallpaper-renderer.mjs';
import { wallpaperZip, wallpaperBatchZip } from './zip-store.mjs';

const check = signal => { if (signal?.aborted) throw new DOMException('Wallpaper export cancelled.', 'AbortError'); };
const png = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode a wallpaper frame.')), 'image/png'));
const canvas = () => document.createElement('canvas');

// All palettes consume a field before computing the next one. Even a crossfade
// computes its two fields only once, without spilling one field per palette.
export async function paintPaletteFrame(painter, plans, index, outputs, work, layer, signal) {
  check(signal);
  const plan = plans[0], samples = plans.map(p => p.sample(index)), sample = samples[0];
  const cache = sample.crossfade || (!plan.transition && Object.keys(plan.parameterCycles ?? {}).length > 0);
  const field = (view, settings) => painter.field(view, settings, plan.renderWidth, plan.renderHeight, cache);
  const draw = async (frame, colors, target, alpha = 1) => {
    await painter.paint(work, frame, colors); check(signal);
    const context = target.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.globalAlpha = alpha;
    try { context.drawImage(work, 0, 0, plan.width, plan.height); }
    finally { context.globalAlpha = 1; }
  };
  if (!sample.crossfade) {
    const frame = await field(sample.view, plan.destination.settings);
    for (let i = 0; i < outputs.length; i++) await draw(frame, samples[i].colors, outputs[i]);
  } else {
    const from = await field(sample.from.view, sample.from.settings);
    for (let i = 0; i < outputs.length; i++) await draw(from, samples[i].from.colors, outputs[i]);
    const to = await field(sample.to.view, sample.to.settings);
    for (let i = 0; i < outputs.length; i++) {
      await draw(to, samples[i].to.colors, layer);
      const context = outputs[i].getContext('2d'); context.globalAlpha = sample.amount;
      try { context.drawImage(layer, 0, 0); } finally { context.globalAlpha = 1; }
    }
  }
}

export async function renderPaletteBatch({ draft, renderer, fields, paint, codecs, signal, onProgress = () => {}, onEncoding = () => {}, yieldFrame = () => Promise.resolve() }) {
  check(signal);
  const drafts = wallpaperPaletteDrafts(draft);
  if (drafts.length < 2) throw new Error('Select an additional palette for a batch.');
  const variants = drafts.map(draft => {
    const plans = wallpaperPlan(draft), manifest = wallpaperManifest(draft, plans);
    return { draft, plans, manifest, entries: [], output: canvas() };
  });
  const painter = new WallpaperFrameRenderer(renderer, fields, paint, signal), work = canvas(), layer = canvas();
  const total = variants[0].plans.reduce((sum, plan) => sum + plan.frames, 0); let complete = 0;
  let encoders = [];
  try {
    for (let slot = 0; slot < variants[0].plans.length; slot++) {
      check(signal);
      const plans = variants.map(variant => variant.plans[slot]), plan = plans[0];
      for (const variant of variants) { variant.output.width = plan.width; variant.output.height = plan.height; }
      layer.width = plan.width; layer.height = plan.height;
      if (!plan.static) for (const variant of variants) {
        check(signal);
        try { encoders.push(await codecs.mp4Encoder(variant.output, variant.plans[slot])); }
        catch (error) { check(signal); throw new Error(`Could not start all palette encoders: ${error.message}. Choose fewer palettes or a smaller resolution.`); }
      }
      if (encoders.length) onEncoding({ plan, encodings: encoders.map(encoder => encoder.encodingInfo) });
      for (let index = 0; index < plan.frames; index++) {
        check(signal); onProgress({ plan, index, complete, total, palettes: variants.length });
        await paintPaletteFrame(painter, plans, index, variants.map(v => v.output), work, layer, signal);
        for (let i = 0; i < variants.length; i++) {
          check(signal); const variant = variants[i];
          if (plan.static || (!plan.transition && index === 0)) variant.entries.push([`${plan.screen}-poster.png`, await png(variant.output)]);
          if (!plan.static) await encoders[i].add(index);
        }
        complete++; await yieldFrame();
      }
      for (let i = 0; i < encoders.length; i++) {
        check(signal); variants[i].entries.push([plan.file, await encoders[i].finish()]);
      }
      encoders = [];
    }
    const packages = [];
    for (const [index, variant] of variants.entries()) {
      check(signal);
      variant.entries.push(['wallpaper.json', new Blob([wallpaperJSON(variant.manifest)], { type: 'application/json' })]);
      const title = variant.plans.find(plan => !plan.transition).snapshot.colors.definition.name;
      const slug = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'palette';
      packages.push([`${String(index + 1).padStart(2, '0')}-${slug}.zip`, await wallpaperZip(variant.entries)]);
    }
    check(signal); const archive = await wallpaperBatchZip(packages); check(signal);
    return { archive, count: variants.length };
  } finally {
    await Promise.allSettled(encoders.map(encoder => encoder.cancel()));
    for (const target of [work, layer, ...variants.map(v => v.output)]) target.width = target.height = 1;
  }
}
