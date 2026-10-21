import { BrowserEngine } from './engine.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { navigate, decimal, add, text } from './decimal.mjs';
import { animationFrames, colorCycle, createColorFrames, drawVignette, gifPaletteSample, juliaView, wrapPhase } from './export-utils.mjs';
import { fractals } from './fractals.mjs';

const $ = id => document.getElementById(id);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const check = signal => { if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError'); };
function abortable(promise, signal) {
  check(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Export cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function setupImageExports({ engine, palettes, getState, getCurrentField, paint, colorTable, downloadBlob }) {
  const dialog = $('export-dialog'), colorDialog = $('color-gif-dialog');
  let job = null, preview = null, previewFrame = null, previewStarted = null, previewPaused = false;
  let previewPhase = 0, previewLastPaint = 0;
  let previewElapsed = 0;
  let previewOptions = { start: 0, speed: .12, cycle: colorCycle(0, .12) };
  const size = (snapshot, longest = 720) => {
    const aspect = snapshot.aspect;
    return { width: Math.max(16, Math.round(longest / Math.max(1, aspect))), height: Math.max(16, Math.round(longest * Math.min(1, aspect))) };
  };
  const snapshot = () => ({ ...getState(), aspect: innerHeight / innerWidth });
  function includeVignette(enabled) {
    $('export-vignette').checked = $('color-gif-vignette').checked = enabled;
    $('color-gif-preview-vignette').hidden = !enabled;
  }
  function paintExport(canvas, values, metadata, colors, vignette) {
    paint(canvas, values, metadata, colors);
    if (vignette) drawVignette(canvas);
  }
  function setBusy(busy) {
    for (const button of document.querySelectorAll('.image-export-action')) button.disabled = busy;
    for (const input of colorDialog.querySelectorAll('input')) input.disabled = busy;
    if (!busy && !$('gif-wander-colors').checked) {
      $('color-gif-speed').disabled = $('color-gif-speed-slider').disabled = true;
    }
    $('download-color-gif').disabled = busy || !preview?.ready || !preview?.optionsValid;
  }
  async function runJob(status, task) {
    if (job) return;
    const controller = job = new AbortController();
    setBusy(true);
    try { await task(controller.signal); }
    catch (error) { if (error.name !== 'AbortError') $(status).textContent = error.message; }
    finally { if (job === controller) { job = null; setBusy(false); } }
  }
  async function newRenderer(signal) {
    const renderer = new BrowserEngine(document.createElement('canvas'), palettes);
    try { await abortable(renderer.init({ forceCPU: !engine.gpu }), signal); return renderer; }
    catch (error) { renderer.destroy(); throw error; }
  }
  $('export').onclick = () => {
    includeVignette(false);
    $('export-status').textContent = '';
    dialog.showModal();
  };
  dialog.addEventListener('close', () => { if (!colorDialog.open) job?.abort(); });
  $('export-vignette').onchange = () => includeVignette($('export-vignette').checked);
  $('color-gif-vignette').onchange = () => includeVignette($('color-gif-vignette').checked);
  $('download-png').onclick = () => runJob('export-status', async signal => {
    const state = snapshot(), selection = $('export-size').value, vignette = $('export-vignette').checked;
    $('export-status').textContent = 'Rendering on your device…';
    let renderer;
    try {
      let values, metadata;
      if (selection === 'current') ({ values, metadata } = await abortable(getCurrentField(), signal));
      else {
        renderer = await newRenderer(signal);
        const { width, height } = size(state, Number(selection));
        metadata = (await abortable(renderer.render(state.view, width, height, state.settings), signal)).metadata;
        values = await abortable(renderer.readField(), signal);
      }
      check(signal);
      const output = document.createElement('canvas');
      paintExport(output, values, metadata, state.colors, vignette);
      const blob = await abortable(new Promise(resolve => output.toBlob(resolve, 'image/png')), signal);
      if (!blob) throw new Error('Could not encode the image.');
      check(signal);
      await downloadBlob(blob, `fractal-web-${state.view.fractal}-${metadata.width}x${metadata.height}.png`);
      $('export-status').textContent = 'Your image is ready.';
    } finally { renderer?.destroy(); }
  });
  $('download-gif').onclick = () => runJob('export-status', async signal => {
    const state = snapshot(), vignette = $('export-vignette').checked;
    if (state.view.iterations > 10000) throw new Error('Zoom GIF export supports up to 10,000 iterations.');
    const { width, height } = size(state);
    let renderer;
    try {
      renderer = await newRenderer(signal);
      const gif = GIFEncoder(), output = document.createElement('canvas');
      let current = state.view, gifPalette;
      for (let frame = 0; frame < 24; frame++) {
        check(signal);
        $('export-status').textContent = `Rendering frame ${frame + 1} / 24 on your device…`;
        const metadata = (await abortable(renderer.render(current, width, height, state.settings), signal)).metadata;
        const values = await abortable(renderer.readField(), signal);
        paintExport(output, values, metadata, state.colors, vignette);
        const rgba = output.getContext('2d').getImageData(0, 0, width, height).data;
        gifPalette ??= quantize(rgba, 256);
        gif.writeFrame(applyPalette(rgba, gifPalette), width, height, { palette: frame ? undefined : gifPalette, delay: 80, repeat: 0 });
        if (frame < 23) current = navigate({ view: current, factor: 8 ** (1 / 23) });
        await nextFrame();
      }
      check(signal); gif.finish();
      await downloadBlob(new Blob([gif.bytes()], { type: 'image/gif' }), 'fractal-web-zoom.gif');
      $('export-status').textContent = 'Your 8× zoom journey is ready.';
    } finally { renderer?.destroy(); }
  });

  function options() {
    const start = Number($('color-gif-phase').value), speed = Number($('color-gif-speed').value);
    const wander = $('gif-wander-colors').checked, evolve = $('gif-evolve-julia').checked;
    const color = colorCycle(start, speed);
    if (!evolve) return { start, speed, wander, evolve, returning: true, cycle: { ...color, progress: () => 0, phaseAt: u => wrapPhase(start + u), phase: frame => wander ? color.phase(frame) : wrapPhase(start) } };
    const target = { x: $('gif-julia-x').value, y: $('gif-julia-y').value };
    const returning = $('gif-return').checked, plan = animationFrames(Number($('gif-duration').value));
    juliaView(preview.state.view, target, 0, returning);
    const cycles = returning ? Math.max(1, Math.round(speed * plan.duration)) : speed * plan.duration;
    const phaseAt = progress => wrapPhase(start + (wander ? cycles * progress : 0));
    const progress = frame => frame / (returning ? plan.frames : plan.frames - 1);
    return { start, speed, wander, evolve, target, returning, cycles, cycle: { ...plan, progress, phaseAt, phase: frame => phaseAt(progress(frame)) } };
  }
  function paintPreview(phase) {
    if (!preview?.ready) return;
    preview.renderer.paint(preview.state.colors.palette, preview.state.colors.density, phase);
    $('color-gif-live-phase').textContent = `Phase ${phase.toFixed(3)}`;
  }
  function updateOptions() {
    $('gif-julia-fields').hidden = !$('gif-evolve-julia').checked;
    try {
      const opts = options(), { start, speed, cycle } = opts;
      previewOptions = opts;
      $('color-gif-phase-slider').value = String(start);
      $('color-gif-speed-slider').value = String(speed);
      const extra = opts.evolve && opts.returning && opts.wander ? ` · ${opts.cycles} complete color cycle${opts.cycles === 1 ? '' : 's'} (${(opts.cycles / cycle.duration).toFixed(2)} cycles/s)` : '';
      $('color-gif-details').textContent = `${cycle.duration.toFixed(2)} s ${opts.returning ? 'loop' : 'one pass'} · ${cycle.frames} frames · 720 px longest edge${extra}`;
      previewStarted = null; previewElapsed = 0; previewPhase = wrapPhase(start);
      if (preview) { preview.needsPaint = true; preview.version++; preview.optionsValid = opts.wander || opts.evolve; }
      if (!opts.wander && !opts.evolve) $('color-gif-details').textContent = 'Enable color wander or constant evolution to animate.';
    } catch (error) {
      if (preview) preview.optionsValid = false;
      $('color-gif-details').textContent = error.message;
    }
    setBusy(!!job);
  }
  function renderPreview(progress, phase, opts) {
    const current = preview;
    if (!current?.ready || current.renderPromise) return;
    current.needsPaint = false;
    const version = current.version;
    current.renderPromise = (async () => {
      const frameView = opts.evolve ? juliaView(current.state.view, opts.target, progress, opts.returning) : current.state.view;
      const key = JSON.stringify(frameView);
      if (key !== current.lastViewKey) {
        const { width, height } = current.metadata;
        await abortable(current.renderer.render(frameView, width, height, current.state.settings), current.controller.signal);
        current.lastViewKey = key;
      }
      if (preview === current && version === current.version && !job) paintPreview(phase);
    })().catch(error => {
      if (error.name !== 'AbortError' && preview === current) {
        $('color-gif-status').textContent = error.message;
        previewPaused = true; $('color-gif-play').textContent = 'Play preview';
        $('color-gif-play').setAttribute('aria-pressed', 'false');
      }
    }).finally(() => { current.renderPromise = null; });
  }
  function tick(time) {
    if (!colorDialog.open) return;
    if (preview?.ready && (!previewPaused || preview.needsPaint) && !job) {
      const opts = previewOptions, { start, speed, cycle } = opts;
      previewStarted ??= time - previewElapsed * 1000;
      if (!previewPaused) previewElapsed = (time - previewStarted) / 1000;
      if (time - previewLastPaint >= 32) {
        const progress = opts.evolve ? (opts.returning ? previewElapsed / cycle.duration % 1 : Math.min(1, previewElapsed / cycle.duration)) : 0;
        previewPhase = opts.evolve ? cycle.phaseAt(progress) : wrapPhase(start + (opts.wander ? previewElapsed * speed : 0));
        renderPreview(progress, previewPhase, opts); previewLastPaint = time;
      }
    }
    previewFrame = requestAnimationFrame(tick);
  }
  for (const id of ['gif-wander-colors', 'gif-evolve-julia', 'gif-return']) $(id).onchange = updateOptions;
  for (const id of ['gif-julia-x', 'gif-julia-y', 'gif-duration']) $(id).oninput = updateOptions;
  for (const name of ['phase', 'speed']) {
    $(`color-gif-${name}`).oninput = updateOptions;
    $(`color-gif-${name}-slider`).oninput = () => {
      $(`color-gif-${name}`).value = $(`color-gif-${name}-slider`).value; updateOptions();
    };
  }
  $('color-gif-play').onclick = () => {
    previewPaused = !previewPaused;
    if (!previewPaused) {
      previewStarted = performance.now() - previewElapsed * 1000;
    }
    $('color-gif-play').textContent = previewPaused ? 'Play preview' : 'Pause preview';
    $('color-gif-play').setAttribute('aria-pressed', String(!previewPaused));
  };
  $('color-gif-restart').onclick = updateOptions;
  $('open-color-gif').onclick = async () => {
    let state;
    try { state = snapshot(); }
    catch (error) { $('export-status').textContent = error.message; return; }
    const controller = new AbortController();
    dialog.close();
    const renderer = new BrowserEngine($('color-gif-preview'), palettes);
    const current = preview = { state, renderer, controller, ready: false, version: 0 };
    $('color-gif-phase').value = String(wrapPhase(state.colors.phase));
    $('color-gif-speed').value = String(state.speed);
    $('gif-wander-colors').checked = true;
    $('gif-evolve-julia').checked = false; $('gif-return').checked = true;
    $('gif-duration').value = '6';
    $('gif-julia-option').hidden = !fractals[state.view.fractal].constant;
    $('gif-constant-label').textContent = state.view.fractal === 'newton' ? 'Evolve root target' : 'Evolve constant';
    $('gif-julia-x').value = state.view.julia_x;
    $('gif-julia-y').value = text(add(decimal(state.view.julia_y), decimal('.02')));
    previewPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('color-gif-play').textContent = previewPaused ? 'Play preview' : 'Pause preview';
    $('color-gif-play').setAttribute('aria-pressed', String(!previewPaused));
    $('color-gif-status').textContent = 'Preparing your view…';
    $('download-color-gif').disabled = true;
    $('color-gif-stage').style.maxWidth = `${220 / state.aspect}px`;
    colorDialog.showModal(); updateOptions();
    previewFrame = requestAnimationFrame(tick);
    try {
      await abortable(renderer.init({ forceCPU: !engine.gpu }), controller.signal);
      const { width, height } = size(state);
      current.metadata = (await abortable(renderer.render(state.view, width, height, state.settings), controller.signal)).metadata;
      current.values = await abortable(renderer.readField(), controller.signal);
      check(controller.signal); current.ready = true; current.lastViewKey = JSON.stringify(state.view);
      updateOptions();
      $('color-gif-status').textContent = 'Preview ready.';
    } catch (error) {
      if (error.name !== 'AbortError') $('color-gif-status').textContent = error.message;
      renderer.destroy();
    }
  };
  colorDialog.addEventListener('close', () => {
    cancelAnimationFrame(previewFrame); job?.abort();
    preview?.controller.abort(); preview?.renderer.destroy(); preview = null;
    if (!document.body.classList.contains('ui-hidden')) dialog.showModal();
  });
  $('download-color-gif').onclick = () => runJob('color-gif-status', async signal => {
    if (!preview?.ready) throw new Error('Wait for the preview to finish preparing.');
    const current = preview, opts = options(), { cycle } = opts, vignette = $('color-gif-vignette').checked;
    if (!opts.evolve && !opts.wander) throw new Error('Enable color wander or constant evolution to animate.');
    if (current.renderPromise) await abortable(current.renderPromise, signal);
    if (!opts.evolve && current.lastViewKey !== JSON.stringify(current.state.view)) {
      await abortable(current.renderer.render(current.state.view, current.metadata.width, current.metadata.height, current.state.settings), signal);
      current.lastViewKey = JSON.stringify(current.state.view);
    }
    const table = colorTable(current.state.colors.palette);
    const paintPhase = createColorFrames(current.values, current.metadata, current.state.colors.density, table);
    const gifPalette = quantize(gifPaletteSample(table, vignette), 256), gif = GIFEncoder();
    const { width, height } = current.metadata;
    const output = document.createElement('canvas');
    for (let frame = 0; frame < cycle.frames; frame++) {
      check(signal);
      let canvas, context;
      if (opts.evolve) {
        const frameView = juliaView(current.state.view, opts.target, cycle.progress(frame), opts.returning);
        const metadata = (await abortable(current.renderer.render(frameView, width, height, current.state.settings), signal)).metadata;
        current.lastViewKey = JSON.stringify(frameView);
        const values = await abortable(current.renderer.readField(), signal);
        paintExport(output, values, metadata, { ...current.state.colors, phase: cycle.phase(frame) }, vignette);
        canvas = output; context = canvas.getContext('2d');
      } else {
        const result = paintPhase(cycle.phase(frame));
        canvas = result.canvas; context = result.context;
        if (vignette) context.drawImage(result.overlay, 0, 0);
      }
      const rgba = context.getImageData(0, 0, width, height).data;
      gif.writeFrame(applyPalette(rgba, gifPalette), width, height, { palette: frame ? undefined : gifPalette, delay: cycle.delay(frame), repeat: opts.returning ? 0 : -1 });
      $('color-gif-status').textContent = `Encoding frame ${frame + 1} / ${cycle.frames}…`;
      // Keep the preview synchronized with the frame being encoded.
      paintPreview(cycle.phase(frame));
      await nextFrame();
    }
    check(signal); gif.finish();
    await downloadBlob(new Blob([gif.bytes()], { type: 'image/gif' }), opts.evolve ? `fractal-web-${current.state.view.fractal}-animation.gif` : 'fractal-web-colors.gif');
    $('color-gif-status').textContent = `Your ${cycle.duration.toFixed(2)} s ${opts.evolve ? 'fractal animation' : 'color loop'} is ready.`;
    previewStarted = null; previewElapsed = 0; current.needsPaint = true;
  });
}
