import { BrowserEngine } from './engine.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { animationPlan } from './animation.mjs';
import { animationExport, ditherFrame, exportQualities } from './animation-export.mjs';
import { drawVignette, exportDimensions, gifPaletteSample, wrapPhase } from './export-utils.mjs';

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
  const dialog = $('export-dialog'), animationDialog = $('color-gif-dialog');
  let job = null, preview = null, raf = null, program = null;
  const snapshot = () => ({ ...getState(), aspect: innerHeight / innerWidth, mobile: engine.mobile });
  function vignette(enabled) {
    $('export-vignette').checked = $('color-gif-vignette').checked = enabled;
    $('color-gif-preview-vignette').hidden = !enabled;
  }
  function paintExport(canvas, values, metadata, colors, shade) {
    paint(canvas, values, metadata, colors);
    if (shade) drawVignette(canvas);
  }
  function setBusy(busy) {
    for (const button of document.querySelectorAll('.image-export-action')) button.disabled = busy;
    for (const input of animationDialog.querySelectorAll('input, select')) input.disabled = busy;
    $('color-gif-speed').disabled = $('color-gif-speed-slider').disabled = busy || !$('gif-wander-colors').checked;
    $('color-gif-play').disabled = $('color-gif-restart').disabled = busy;
    $('download-color-gif').disabled = busy || !preview?.ready || !preview?.valid || preview?.mp4 === false || preview?.mp4 === null;
    $('animation-cancel').hidden = !busy;
  }
  async function runJob(status, task) {
    if (job) return;
    const controller = job = new AbortController(); setBusy(true);
    try { await task(controller.signal); }
    catch (error) { $(status).textContent = error.name === 'AbortError' ? 'Export cancelled.' : error.message; }
    finally { if (job === controller) { job = null; setBusy(false); } }
  }
  async function newRenderer(signal, canvas = document.createElement('canvas')) {
    const renderer = new BrowserEngine(canvas, palettes);
    try { await abortable(renderer.init({ forceCPU: !engine.gpu }), signal); return renderer; }
    catch (error) { renderer.destroy(); throw error; }
  }
  $('export').onclick = () => { vignette(false); $('export-status').textContent = ''; dialog.showModal(); };
  dialog.addEventListener('close', () => { if (!animationDialog.open) job?.abort(); });
  $('export-vignette').onchange = () => vignette($('export-vignette').checked);
  $('color-gif-vignette').onchange = () => vignette($('color-gif-vignette').checked);
  $('animation-cancel').onclick = () => job?.abort();
  $('download-png').onclick = () => runJob('export-status', async signal => {
    const state = snapshot(), selection = $('export-size').value, shade = $('export-vignette').checked;
    $('export-status').textContent = 'Rendering on your device…';
    let renderer;
    try {
      let values, metadata;
      if (selection === 'current') ({ values, metadata } = await abortable(getCurrentField(), signal));
      else {
        renderer = await newRenderer(signal); const { width, height } = exportDimensions(state.aspect, Number(selection));
        metadata = (await abortable(renderer.render(state.visibleView ?? state.view, width, height, state.settings), signal)).metadata;
        values = await abortable(renderer.readField(), signal);
      }
      check(signal);
      const output = document.createElement('canvas'); paintExport(output, values, metadata, state.colors, shade);
      const blob = await abortable(new Promise(resolve => output.toBlob(resolve, 'image/png')), signal);
      if (!blob) throw new Error('Could not encode the image.');
      check(signal); await downloadBlob(blob, `fractal-web-${state.view.fractal}-${metadata.width}x${metadata.height}.png`);
      $('export-status').textContent = 'Your image is ready.';
    } finally { renderer?.destroy(); }
  });

  function readOptions() {
    return { mode: $('animation-motion').value, format: $('animation-format').value, quality: $('animation-quality').value,
      longest: Number($('animation-size').value), aspectRatio: $('animation-aspect').value, fps: Number($('animation-fps').value), duration: Number($('gif-duration').value),
      start: Number($('color-gif-phase').value), speed: Number($('color-gif-speed').value), wander: $('gif-wander-colors').checked };
  }
  async function updateOptions() {
    const current = preview; if (!current) return;
    const version = ++current.version; current.renderer?.cancel(); current.start = null; current.elapsed = 0; current.key = null; current.index = null;
    if (current.ready && !job) $('color-gif-status').textContent = 'Preview ready.';
    const isGIF = $('animation-format').value === 'gif';
    for (const option of $('animation-quality').options) option.disabled = isGIF && !!exportQualities[option.value].mp4Only;
    if ($('animation-quality').selectedOptions[0].disabled) $('animation-quality').value = 'high';
    $('animation-quality-note').textContent = isGIF ? 'High uses GIF’s maximum 256 colors. Ultra and Extreme require MP4.' : 'For fine fractal detail, choose Ultra or Extreme. Higher quality produces larger files.';
    $('animation-fps').querySelector('option[value="60"]').disabled = $('animation-format').value === 'gif';
    if ($('animation-format').value === 'gif' && $('animation-fps').value === '60') $('animation-fps').value = '30';
    $('animation-dither-row').hidden = $('animation-format').value !== 'gif';
    $('animation-duration-row').hidden = $('animation-motion').value !== 'zoom';
    try {
      program = animationExport(current.state, readOptions()); current.valid = true;
      const p = program;
      $('color-gif-stage').style.maxWidth = `${220 / p.aspect}px`;
      $('color-gif-phase-slider').value = String(p.start); $('color-gif-speed-slider').value = String(p.speed);
      $('animation-source-note').textContent = p.mode === 'parameters'
        ? 'Targets, cycle shapes, and speeds come from the loop buttons beside the main-view sliders.' : p.mode === 'zoom' ? 'A single journey ending at 8× magnification.' : 'One complete palette cycle, using the current view.';
      $('color-gif-details').textContent = `${p.duration.toFixed(2)} s · ${p.frames} frames · ${p.width} × ${p.height} · ${p.fps} fps · preview up to 480 px`;
      $('download-color-gif').innerHTML = `Download ${p.format.toUpperCase()} <span>↓</span>`;
      current.mp4 = p.format === 'mp4' ? null : true;
      $('animation-codec-note').textContent = p.format === 'gif' ? `${p.paletteSize} colors · GIF timing is rounded to hundredths of a second.` : 'Checking H.264 encoding on this device…';
      setBusy(!!job);
      if (p.format === 'mp4') {
        const { supportsMP4 } = await import('./video-export.js'); const supported = await supportsMP4(p);
        if (preview !== current || version !== current.version) return;
        current.mp4 = supported;
        $('animation-codec-note').textContent = supported ? `H.264 · target ${(p.bitrate / 1e6).toFixed(1)} Mbps · ≈ ${(p.bitrate * p.duration / 8e6).toFixed(1)} MB · every frame is rendered before encoding.` : 'H.264 encoding is unavailable at these settings. Choose a lower quality, a smaller size, or GIF.';
      }
    } catch (error) { current.valid = false; $('color-gif-details').textContent = error.message; }
    setBusy(!!job);
  }
  function previewFrame(index, p) {
    const current = preview;
    if (!current?.ready || current.rendering || !current.valid) return;
    current.index = index;
    const version = current.version, frameView = p.viewAt(index), key = JSON.stringify(frameView);
    current.rendering = (async () => {
      if (key !== current.key) {
        const { width, height } = exportDimensions(p.aspect, Math.min(480, p.longest));
        await abortable(current.renderer.render(frameView, width, height, current.state.settings), current.controller.signal);
        if (version === current.version) current.key = key;
      }
      if (preview === current && version === current.version && !job) {
        current.renderer.paint(current.state.colors.palette, current.state.colors.density, p.phaseAt(index));
        $('color-gif-live-phase').textContent = `${(index / p.fps).toFixed(2)} / ${p.duration.toFixed(2)} s`;
      }
    })().catch(error => {
      if (preview === current && error.name !== 'AbortError') { $('color-gif-status').textContent = error.message; current.paused = true; syncPlay(); }
    }).finally(() => { current.rendering = null; });
  }
  function tick(time) {
    if (!animationDialog.open) return;
    const current = preview;
    if (current?.ready && current.valid && !job && !document.hidden) {
      current.start ??= time - current.elapsed * 1000;
      if (!current.paused) current.elapsed = (time - current.start) / 1000;
      const p = program, index = p.looping ? Math.floor(current.elapsed * p.fps) % p.frames : Math.min(p.frames - 1, Math.floor(current.elapsed * p.fps));
      if (current.index !== index || current.key === null) previewFrame(index, p);
    }
    raf = requestAnimationFrame(tick);
  }
  function syncPlay() {
    $('color-gif-play').textContent = preview?.paused ? 'Play preview' : 'Pause preview';
    $('color-gif-play').setAttribute('aria-pressed', String(!preview?.paused));
  }
  $('color-gif-play').onclick = () => { if (!preview) return; preview.paused = !preview.paused; preview.start = null; syncPlay(); };
  $('color-gif-restart').onclick = updateOptions;
  for (const id of ['animation-motion', 'animation-format', 'animation-size', 'animation-aspect', 'animation-quality', 'animation-fps', 'gif-wander-colors', 'gif-duration']) $(id).onchange = updateOptions;
  for (const name of ['phase', 'speed']) {
    $(`color-gif-${name}-slider`).oninput = () => { $(`color-gif-${name}`).value = $(`color-gif-${name}-slider`).value; updateOptions(); };
  }
  for (const id of ['color-gif-phase', 'color-gif-speed', 'gif-duration']) {
    const input = $(id); let timer;
    const apply = () => { clearTimeout(timer); updateOptions(); };
    input.onchange = input.onblur = apply;
    input.oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 180); };
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } };
  }
  async function openAnimation(mode) {
    let state;
    try { state = snapshot(); } catch (error) { $('export-status').textContent = error.message; return; }
    dialog.close();
    const controller = new AbortController(), current = preview = { state, controller, ready: false, version: 0, elapsed: 0, paused: matchMedia('(prefers-reduced-motion: reduce)').matches };
    const hasParameters = !!animationPlan(state.view, state.automation);
    $('animation-motion').querySelector('option[value="parameters"]').disabled = !hasParameters;
    $('animation-motion').value = mode === 'zoom' ? 'zoom' : hasParameters ? 'parameters' : 'colors';
    $('color-gif-phase').value = String(wrapPhase(state.colors.phase)); $('color-gif-speed').value = String(state.speed);
    $('gif-wander-colors').checked = mode === 'zoom' ? state.wander : hasParameters ? state.wander : true;
    $('animation-format').value = typeof VideoEncoder === 'undefined' ? 'gif' : 'mp4';
    $('gif-duration').value = '4';
    $('animation-format').querySelector('option[value="mp4"]').disabled = typeof VideoEncoder === 'undefined';
    const canvas = document.createElement('canvas'); canvas.id = 'color-gif-preview'; canvas.setAttribute('aria-label', 'Animation preview');
    $('color-gif-preview').replaceWith(canvas);
    syncPlay(); $('color-gif-status').textContent = 'Preparing your view…';
    animationDialog.showModal(); updateOptions(); raf = requestAnimationFrame(tick);
    try {
      current.renderer = await newRenderer(controller.signal, canvas);
      check(controller.signal); current.ready = true;
      $('color-gif-status').textContent = 'Preview ready.'; setBusy(false);
    } catch (error) { if (error.name !== 'AbortError' && preview === current) $('color-gif-status').textContent = error.message; }
  }
  $('open-color-gif').onclick = () => openAnimation('loop');
  $('download-gif').onclick = () => openAnimation('zoom');
  animationDialog.addEventListener('close', () => {
    cancelAnimationFrame(raf); job?.abort(); preview?.controller.abort(); preview?.renderer?.destroy(); preview = null;
    if (!document.body.classList.contains('ui-hidden')) dialog.showModal();
  });
  $('download-color-gif').onclick = () => runJob('color-gif-status', async signal => {
    const current = preview; if (!current?.ready || !current.valid) throw new Error('Wait for a valid preview.');
    const p = animationExport(current.state, readOptions()), shade = $('color-gif-vignette').checked;
    const dither = $('animation-dither').checked;
    if (current.rendering) await abortable(current.rendering, signal);
    const output = document.createElement('canvas'); output.width = p.width; output.height = p.height;
    const gif = p.format === 'gif' ? GIFEncoder() : null;
    const gifPalette = gif ? quantize(gifPaletteSample(colorTable(current.state.colors.palette), shade), p.paletteSize) : null;
    let video, finished = false, key = null, values, metadata;
    const cancel = () => { video?.cancel().catch(() => {}); current.renderer.cancel(); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (p.format === 'mp4') {
        const { mp4Encoder } = await import('./video-export.js');
        const pending = mp4Encoder(output, p);
        pending.then(encoder => { if (signal.aborted) encoder.cancel().catch(() => {}); }, () => {});
        video = await abortable(pending, signal);
      }
      for (let index = 0; index < p.frames; index++) {
        check(signal); $('color-gif-status').textContent = `Rendering & encoding ${index + 1} / ${p.frames}…`;
        const view = p.viewAt(index), next = JSON.stringify(view);
        if (next !== key) {
          // Drain a cancelled render/read before reusing this engine for preview.
          metadata = (await current.renderer.render(view, p.width, p.height, current.state.settings)).metadata;
          check(signal); values = await current.renderer.readField(); check(signal); key = next;
        }
        paintExport(output, values, metadata, { ...current.state.colors, phase: p.phaseAt(index) }, shade);
        if (gif) {
          let rgba = output.getContext('2d').getImageData(0, 0, p.width, p.height).data;
          if (dither) rgba = ditherFrame(rgba, p.width);
          gif.writeFrame(applyPalette(rgba, gifPalette), p.width, p.height, { palette: index ? undefined : gifPalette, delay: p.delay(index), repeat: p.looping ? 0 : -1 });
        } else await abortable(video.add(index), signal);
        current.renderer.paint(current.state.colors.palette, current.state.colors.density, p.phaseAt(index));
        await nextFrame();
      }
      check(signal);
      let blob;
      if (gif) { gif.finish(); blob = new Blob([gif.bytes()], { type: 'image/gif' }); }
      else blob = await abortable(video.finish(), signal);
      check(signal); finished = true;
      await downloadBlob(blob, `fractal-web-${current.state.view.fractal}-${p.mode}.${p.format}`);
      $('color-gif-status').textContent = `Your ${p.duration.toFixed(2)} s ${p.format.toUpperCase()} is ready.`;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (video && !finished) await video.cancel().catch(() => {});
      current.key = null; current.index = null; current.start = null; current.elapsed = 0;
    }
  });
}
