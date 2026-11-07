import { BrowserEngine } from './engine.js';
import { wallpaperStates, wallpaperSlots, wallpaperScreenDraft, wallpaperScreenName, wallpaperColorCycle, wallpaperSnapshot, validateWallpaperSnapshot, defaultWallpaperDraft, wallpaperPlan, wallpaperManifest, wallpaperJSON, MAX_WALLPAPER_JSON_BYTES, wallpaperTransition, transitionCurves } from './wallpaper.mjs';
import { wrapPhase } from './export-utils.mjs';
import { wallpaperZip } from './zip-store.mjs';
import { nativeBridge, nativeCall } from './native-bridge.mjs';
import { ExportFieldCache, exportCacheBudget } from './export-field-cache.mjs';
import { setupWallpaperGallery } from './wallpaper-gallery.js';
import { validateDimensions } from './resolution.mjs';
import { createWallpaperURL, readWallpaperURL, wallpaperHandoff } from './wallpaper-share.mjs';
import { shareBaseURL } from './share.mjs';
import { WallpaperFrameRenderer } from './wallpaper-renderer.mjs';

const $ = id => document.getElementById(id);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const check = signal => { if (signal?.aborted) throw new DOMException('Wallpaper export cancelled.', 'AbortError'); };
const png = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode a wallpaper frame.')), 'image/png'));
const STORAGE = 'fractal-web-wallpaper-v1';

export function setupWallpaper({ engine, palettes, getState, applyState, paint, downloadBlob, onSceneEditingChange = () => {} }) {
  const dialog = $('wallpaper-dialog');
  if (typeof ResizeObserver === 'function') new ResizeObserver(entries => {
    document.documentElement.style.setProperty('--wallpaper-editing-space', `${Math.ceil(entries[0].target.getBoundingClientRect().height) + 28}px`);
  }).observe($('wallpaper-editing'));
  let draft, editing = null, selected = 'open-transition', preview, job, playing = false, previewCaption = '', renderedDraft = null;
  let loadingDraft = false, draftLoadVersion = 0;
  let handoffLoad = 0, pendingHandoff = null;
  let screen = 'inner', cardsScreen = null;
  const drafts = {};
  const designPlan = value => wallpaperPlan(value, { previewLongest: 480 });
  function screenSizes() {
    if (!nativeBridge() || typeof nativeBridge().wallpaperDisplays !== 'function') return {};
    try { return nativeCall('wallpaperDisplays').screens ?? {}; } catch { return {}; }
  }
  let detectedSizes = screenSizes();
  function assignScreenSizes(profile) {
    // Native resolution means this device, not dimensions embedded by an
    // imported draft from another phone. Browser exports may use saved sizes.
    profile.screenSizes = typeof nativeBridge()?.wallpaperDisplays === 'function'
      ? detectedSizes[profile.screen] ? { [profile.screen]: { ...detectedSizes[profile.screen] } } : {}
      : { ...profile.screenSizes, ...detectedSizes };
  }
  function newWorkingDraft(target) {
    const next = defaultWallpaperDraft(wallpaperSnapshot(getState(), palettes), target);
    if (typeof nativeBridge()?.wallpaperDisplays === 'function') next.longest = 'native';
    next.resolutionVersion = 1; assignScreenSizes(next);
    return next;
  }
  const encodingInfo = new Map();
  const sampleCanvases = new WeakMap();
  const frameRenderers = new WeakMap();
  function encodingSummary() {
    try {
      const plans = wallpaperPlan(draft), first = plans[0];
      const resolution = `${first.width} × ${first.height}`;
      const describe = plan => {
        if (typeof nativeBridge()?.supportsVideo === 'function') {
          const request = JSON.stringify({ width: plan.width, height: plan.height, fps: plan.fps, bitrate: plan.bitrate, quantizer: plan.quantizer });
          if (!encodingInfo.has(request)) encodingInfo.set(request, nativeCall('supportsVideo', request));
          const info = encodingInfo.get(request);
          if (!info.supported) return 'unsupported at this quality';
          if (info.qualityMode === 'maximum-cq') return 'maximum quality · dynamic bitrate';
          if (info.qualityMode === 'maximum-vbr') return `maximum variable bitrate · up to ${(info.bitrate / 1e6).toFixed(1)} Mbps`;
        }
        return plan.quantizer === 0 ? 'maximum quality · dynamic bitrate' : `${(plan.bitrate / 1e6).toFixed(1)} Mbps`;
      };
      $('wallpaper-encoding-note').textContent = `${resolution} · Transition: ${describe(plans[0])}. Steady: ${describe(plans[1])}.`;
    } catch (error) { $('wallpaper-encoding-note').textContent = error.message; }
  }
  try {
    const old = JSON.parse(localStorage.getItem(STORAGE));
    if (old) {
      designPlan(old);
      for (const target of old.screen ? [old.screen] : ['cover', 'inner']) drafts[target] = wallpaperScreenDraft(old, target);
      screen = old.screen ?? 'inner';
    }
  } catch {}
  for (const target of ['cover', 'inner']) try {
    const saved = JSON.parse(localStorage.getItem(`${STORAGE}-${target}`));
    if (saved?.screen === target) { designPlan(saved); drafts[target] = saved; }
  } catch {}
  if (typeof nativeBridge()?.wallpaperDisplays === 'function') {
    for (const profile of Object.values(drafts)) if (profile.resolutionVersion !== 1) {
      profile.longest = 'native'; profile.resolutionVersion = 1;
    }
  }
  draft = drafts[screen];
  function save() {
    if (renderedDraft !== null && JSON.stringify(draft) !== renderedDraft) {
      $('wallpaper-apply').hidden = true;
      $('wallpaper-status').textContent = 'Design changed. Create the wallpaper again to update its rendered animations.';
    }
    drafts[draft.screen] = draft;
    try {
      // Persist both migrated halves before replacing the combined legacy value.
      // If storage fills, keep the original combined draft available on reload.
      for (const [target, profile] of Object.entries(drafts)) localStorage.setItem(`${STORAGE}-${target}`, JSON.stringify(profile));
      localStorage.setItem(STORAGE, JSON.stringify(draft));
    }
    catch { $('wallpaper-status').textContent = 'Draft storage is unavailable. Use Save draft to keep a copy.'; }
  }
  function readOptions() {
    const transitions = Object.fromEntries(wallpaperSlots(draft).filter(slot => slot.transition).map(slot => [slot.key, {
      seconds: Number($(`wallpaper-${slot.key}-seconds`).value), easing: $(`wallpaper-${slot.key}-easing`).value,
    }]));
    const next = { ...draft, transitions, name: $('wallpaper-name').value,
      idleSeconds: Number($('wallpaper-idle-seconds').value), longest: $('wallpaper-size').value === 'native' ? 'native' : Number($('wallpaper-size').value),
      quality: $('wallpaper-quality').value, bitrateMbps: Number($('wallpaper-bitrate').value),
      supersampling: Number($('wallpaper-supersampling').value),
      idleFps: Number($('wallpaper-idle-fps').value), steadyMotion: $('wallpaper-steady-motion').value,
      colorWander: $('wallpaper-color-motion').value === 'cycle', colorSeconds: Number($('wallpaper-color-seconds').value) };
    designPlan(next); draft = next; save();
    const cycle = wallpaperColorCycle(draft);
    $('wallpaper-color-note').textContent = cycle.enabled ? `Same palette and ${cycle.seconds.toFixed(2)} s color cycle in the transition and steady loop. ${cycle.cycles} whole cycle${cycle.cycles === 1 ? '' : 's'} per loop; the handoff matches exactly.` : 'The transition and steady scene share one still palette. Edit either scene to change it.';
    const plans = designPlan(draft), steady = plans.find(plan => !plan.transition);
    $('wallpaper-loop-note').textContent = `${steady.duration.toFixed(3)} s exported loop. Duration fits your parameter speeds exactly; speeds are never rounded to make the loop fit.`;
    $('wallpaper-bitrate').disabled = !!job || loadingDraft || draft.quality !== 'custom';
    updateResolutionNote();
    encodingSummary();
  }
  function updateResolutionNote() {
    const size = draft.screenSizes?.[draft.screen];
    $('wallpaper-resolution-note').textContent = size ? `${wallpaperScreenName(draft.screen)}: ${size.width} × ${size.height} pixels.${draft.longest === 'native' ? ' Export uses this exact resolution.' : ' Export keeps this screen’s proportions.'}` : `Open the app on the ${wallpaperScreenName(draft.screen).toLowerCase()} once, then tap Detect resolution. Smaller export sizes remain available.`;
  }
  function rendererNote(renderer = engine) {
    $('wallpaper-renderer-note').textContent = renderer.gpu ? `GPU rendering${renderer.deviceName ? ' · ' + renderer.deviceName : ''}. Creation runs on this device; the finished package can be imported on your phone.`
      : `CPU rendering. For large supersampled wallpapers, use Render on PC, or enable Retry GPU under Rendering on your PC before creating the package.`;
  }
  function refreshSizes() {
    detectedSizes = screenSizes();
    if (job || loadingDraft) return;
    for (const profile of Object.values(drafts)) assignScreenSizes(profile);
    if (draft) { assignScreenSizes(draft); updateResolutionNote(); }
  }
  function capture(key) {
    const visible = draft.steadyMotion === 'still' || wallpaperStates.some(slot => slot.key === key && slot.transition);
    const snapshot = wallpaperSnapshot(getState(), palettes, { visible });
    if (wallpaperStates.some(slot => slot.key === key && slot.transition)) {
      snapshot.automation = {}; snapshot.wander = false;
    }
    return snapshot;
  }
  function storeScene(key) {
    const snapshot = capture(key), slot = wallpaperStates.find(slot => slot.key === key);
    draft.supersampling = snapshot.supersampling ?? 1;
    $('wallpaper-supersampling').value = draft.supersampling;
    if (slot.transition) {
      const plan = designPlan(draft).find(plan => plan.key === key), cycle = wallpaperColorCycle(draft);
      if (cycle.enabled) snapshot.colors.phase = wrapPhase(snapshot.colors.phase + (plan.frames - 1) / plan.fps / cycle.seconds);
    } else {
      draft.colorWander = snapshot.wander; draft.colorSeconds = 1 / snapshot.speed;
    }
    for (const state of Object.values(draft.states)) state.colors = structuredClone(snapshot.colors);
    draft.states[key] = snapshot;
    save();
  }
  function stopPreview() {
    playing = false; $('wallpaper-preview-play').textContent = 'Play preview';
    if (preview) { preview.controller.abort(); cancelAnimationFrame(preview.raf); preview.renderer.destroy(); preview = null; }
  }
  function busy(value) {
    for (const element of dialog.querySelectorAll('button, input, select')) element.disabled = value;
    $('wallpaper-cancel').hidden = !value; $('wallpaper-cancel').disabled = false;
    $('wallpaper-cancel').textContent = loadingDraft ? 'Cancel import' : 'Cancel export';
    $('wallpaper-bitrate').disabled = value || draft?.quality !== 'custom';
    $('wallpaper-create').textContent = `${nativeBridge() ? 'Create' : 'Download'} ${screen === 'cover' ? 'cover' : 'main'} wallpaper`;
  }
  async function renderSample(renderer, canvas, plan, index, fields, signal) {
    const sample = plan.sample(index);
    const width = plan.renderWidth, height = plan.renderHeight;
    if (renderer.renderLimits) validateDimensions(width, height, renderer.renderLimits);
    let surfaces = sampleCanvases.get(canvas);
    if (!surfaces) { surfaces = { work: document.createElement('canvas'), layer: document.createElement('canvas') }; sampleCanvases.set(canvas, surfaces); }
    const work = plan.supersampling > 1 ? surfaces.work : canvas;
    let painter = frameRenderers.get(renderer);
    if (!painter) { painter = new WallpaperFrameRenderer(renderer, fields, paint, signal); frameRenderers.set(renderer, painter); }
    const cache = sample.crossfade || (!plan.transition && Object.keys(plan.parameterCycles ?? {}).length > 0);
    const field = (view, settings) => painter.field(view, settings, width, height, cache);
    if (!sample.crossfade) {
      const frame = await field(sample.view, plan.destination.settings);
      await painter.paint(work, frame, sample.colors);
    } else {
      const layer = surfaces.layer;
      const from = await field(sample.from.view, sample.from.settings);
      await painter.paint(work, from, sample.from.colors);
      const to = await field(sample.to.view, sample.to.settings);
      await painter.paint(layer, to, sample.to.colors);
      const context = work.getContext('2d'); context.globalAlpha = sample.amount; context.drawImage(layer, 0, 0); context.globalAlpha = 1;
    }
    if (work !== canvas) {
      const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(work, 0, 0, plan.width, plan.height);
    }
  }
  async function startPreview(play = false) {
    stopPreview();
    if (!dialog.open || job) return;
    let plans;
    try { readOptions(); plans = designPlan(draft); }
    catch (error) { $('wallpaper-preview-status').textContent = error.message; return; }
    const controller = new AbortController(), renderer = new BrowserEngine(document.createElement('canvas'), palettes);
    const current = preview = { controller, renderer, raf: null };
    const fields = new ExportFieldCache({ memoryBudget: 16 * 1024 ** 2, signal: controller.signal });
    fields.writable = false;
    controller.signal.addEventListener('abort', () => fields.dispose().catch(() => {}), { once: true });
    playing = play; $('wallpaper-preview-play').textContent = play ? 'Stop preview' : 'Play preview';
    const initial = plans.find(p => p.key === selected), steady = initial.transition ? plans.find(p => p.key === initial.target) : initial;
    const canvas = $('wallpaper-preview'); canvas.width = initial.width; canvas.height = initial.height;
    $('wallpaper-preview-stage').style.setProperty('--wallpaper-aspect', String(initial.aspect));
    $('wallpaper-preview-status').textContent = 'Preparing preview…';
    try {
      await renderer.init({ forceCPU: !engine.gpu }); check(controller.signal);
      let active = initial, index = 0, nextAt = performance.now();
      async function tick(time = performance.now()) {
        if (preview !== current || controller.signal.aborted) return;
        if (play && time < nextAt) { current.raf = requestAnimationFrame(t => tick(t).catch(showError)); return; }
        const p = active;
        const still = draft.steadyMotion === 'still' && !p.transition;
        await renderSample(renderer, canvas, p, index, fields, controller.signal); check(controller.signal);
        $('wallpaper-preview-status').textContent = !play && previewCaption ? previewCaption : `${p.title} · ${p.transition ? 'saved start → ' + steady.title + ' first frame' : still ? 'still image' : 'steady loop'} · preview`;
        if (play && !still && !document.hidden) {
          // Never skip arrival frames/endpoints when a CPU render is slower than
          // the preview cadence. Expensive previews run slower than the final video.
          nextAt = Math.max(nextAt + 1000 / p.fps, performance.now());
          if (p.transition && index === p.frames - 1) { active = steady; index = 0; }
          else index = (index + 1) % p.frames;
          current.raf = requestAnimationFrame(t => tick(t).catch(showError));
        }
        else { playing = false; $('wallpaper-preview-play').textContent = 'Play preview'; }
      }
      await tick();
    } catch (error) { showError(error); }
    function showError(error) { if (preview === current && error.name !== 'AbortError') $('wallpaper-preview-status').textContent = error.message; }
  }
  function editScene(key, fromTransition = null) {
    let entered = false;
    try {
      const slot = wallpaperStates.find(slot => slot.key === key);
      const snapshot = validateWallpaperSnapshot(draft.states[key]);
      snapshot.supersampling = draft.supersampling ?? 1;
      if (slot.transition) { snapshot.automation = {}; snapshot.wander = false; snapshot.colors = designPlan(draft).find(plan => plan.key === key).sample(0).colors; }
      else { snapshot.wander = draft.colorWander ?? snapshot.wander; snapshot.speed = 1 / wallpaperColorCycle(draft).seconds; }
      onSceneEditingChange(slot, { idleSeconds: draft.idleSeconds, idleFps: draft.idleFps }); entered = true;
      applyState(snapshot); editing = key; dialog.close();
      $('wallpaper-editing-label').textContent = slot.transition ? `Editing START scene · ${slot.title}` : `Editing END / steady scene · ${slot.title}`;
      $('wallpaper-editing-help').textContent = slot.transition ? `Choose the start geometry. Parameter animation is disabled here; the transition curve moves it into ${wallpaperStates.find(s => s.key === slot.target).title}. Palette changes also update the steady scene; color cycling is shared in the overview.`
        : `This is the transition endpoint and the ${slot.screen === 'cover' ? 'cover' : 'main'} loop's first frame. Palette and color speed also apply to the transition.`;
      $('wallpaper-save-state').textContent = slot.transition ? 'Save start scene' : 'Save end / steady scene';
      if (fromTransition) selected = fromTransition;
      $('wallpaper-editing').hidden = false;
    } catch (error) { if (entered) onSceneEditingChange(null); $('wallpaper-status').textContent = error.message; }
  }
  function finishEditing() {
    if (editing !== null) onSceneEditingChange(null);
    editing = null; $('wallpaper-editing').hidden = true;
  }
  function showScene(key, caption) { selected = key; previewCaption = caption; startPreview(); $('wallpaper-preview-stage').scrollIntoView({block:'nearest'}); }
  function cards() {
    const container = $('wallpaper-state-cards');
    if (cardsScreen !== draft.screen) { container.replaceChildren(); cardsScreen = draft.screen; }
    for (const [index, slot] of wallpaperSlots(draft).entries()) {
      const section = document.createElement('section'); section.className = 'wallpaper-state';
      const heading = document.createElement('h3'); heading.textContent = slot.title;
      const end = wallpaperStates.find(s => s.key === slot.target);
      const description = document.createElement('p'); description.textContent = slot.transition ? `START: saved ${slot.title} scene → END: ${end.title}, the ${slot.screen === 'cover' ? 'cover' : 'inner'} steady scene.`
        : `Transition endpoint + first frame of the ${slot.screen === 'cover' ? 'cover' : 'inner'} ${draft.steadyMotion === 'still' ? 'still image' : 'loop'}.`;
      const current = draft.states[slot.key], automated = Object.values(current.automation ?? {}).some(p => p?.enabled);
      const detail = document.createElement('p'); detail.className = 'export-note'; detail.textContent = slot.transition ? `Start: ${current.view.fractal} → End: ${draft.states[slot.target].view.fractal} · linked to ${end.title}` : `${current.view.fractal} · ${slot.screen === 'cover' ? 'small screen' : 'large screen'} · ${draft.steadyMotion === 'still' ? 'still image' : automated ? 'parameter loop' : current.wander ? 'color loop' : 'still view'}`;
      // Keep the buttons mounted: a number input can emit change on blur between a
      // button's pointer-down and click, and replacing it would swallow that click.
      const existing = container.children[index];
      if (existing) {
        const labels = existing.querySelectorAll('p'); labels[0].textContent = description.textContent; labels[1].textContent = detail.textContent;
        if (slot.transition) {
          const timing = wallpaperTransition(draft, slot.key);
          $(`wallpaper-${slot.key}-seconds`).value = timing.seconds; $(`wallpaper-${slot.key}-easing`).value = timing.easing;
        }
        continue;
      }
      const actions = document.createElement('div'); actions.className = 'wallpaper-state-actions';
      for (const [label, action] of [
        [slot.transition ? 'Play transition' : 'Play steady preview', () => { selected = slot.key; previewCaption = ''; startPreview(true); $('wallpaper-preview-stage').scrollIntoView({ block: 'nearest' }); }],
        [slot.transition ? 'Edit start scene' : 'Edit end / steady scene', () => editScene(slot.key)],
        [slot.transition ? 'Use current view as start' : 'Use current view as end', () => { try { storeScene(slot.key); open(); showScene(slot.key, slot.transition ? `${slot.title} · saved START scene` : `${slot.title} · saved END / steady first frame`); } catch (error) { $('wallpaper-status').textContent = error.message; } }],
      ]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = label; button.onclick = action; actions.append(button);
      }
      section.append(heading, description, detail, actions); container.append(section);
      if (slot.transition) {
        const endpoints = document.createElement('div'); endpoints.className = 'wallpaper-state-actions';
        for (const [label, action] of [
          ['View start', () => showScene(slot.key, `${slot.title} · saved START scene`)],
          ['View end', () => showScene(slot.target, `${slot.title} · END = ${end.title} first frame`)],
          ['Edit end / steady scene', () => editScene(slot.target, slot.key)],
        ]) { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = label; button.onclick = action; endpoints.append(button); }
        const timing = wallpaperTransition(draft, slot.key), controls = document.createElement('div'); controls.className = 'wallpaper-transition-timing';
        const durationLabel = document.createElement('label'); durationLabel.className = 'field-label'; durationLabel.textContent = 'Transition · seconds';
        const duration = document.createElement('input'); duration.id = `wallpaper-${slot.key}-seconds`; duration.type = 'number'; duration.min = '.5'; duration.max = '10'; duration.step = '.1'; duration.value = timing.seconds; durationLabel.append(duration);
        const curveLabel = document.createElement('label'); curveLabel.className = 'field-label'; curveLabel.textContent = 'Motion curve';
        const curve = document.createElement('select'); curve.id = `wallpaper-${slot.key}-easing`;
        for (const item of transitionCurves) { const option = document.createElement('option'); option.value = item.value; option.textContent = item.label; curve.append(option); }
        curve.value = timing.easing; curveLabel.append(curve);
        for (const control of [duration, curve]) control.onchange = () => {
          try { readOptions(); cards(); selected = slot.key; previewCaption = ''; startPreview(true); }
          catch (error) { stopPreview(); $('wallpaper-preview-status').textContent = error.message; }
        };
        const note = document.createElement('p'); note.className = 'export-note'; note.textContent = 'Fast start moves immediately, then slows into the exact end scene. Timing changes take effect when you create the wallpaper again.';
        controls.append(durationLabel, curveLabel); section.append(endpoints, controls, note);
      }
    }
  }
  function open() {
    if (job || loadingDraft) return;
    try {
      finishEditing();
      previewCaption = '';
      if (!draft) {
        draft = newWorkingDraft(screen);
      }
      assignScreenSizes(draft);
      screen = draft.screen;
      if (!draft.states[selected]) selected = wallpaperSlots(draft)[0].key;
      $('wallpaper-screen').value = screen;
      $('wallpaper-name').value = draft.name;
      $('wallpaper-idle-seconds').value = draft.idleSeconds;
      $('wallpaper-size').value = draft.longest; $('wallpaper-idle-fps').value = draft.idleFps;
      $('wallpaper-steady-motion').value = draft.steadyMotion ?? 'animated';
      $('wallpaper-quality').value = draft.quality ?? 'high';
      $('wallpaper-supersampling').value = draft.supersampling ?? 1;
      $('wallpaper-bitrate').value = draft.bitrateMbps ?? 40;
      const steady = draft.states[wallpaperSlots(draft).find(slot => !slot.transition).key];
      $('wallpaper-color-motion').value = (draft.colorWander ?? steady.wander) ? 'cycle' : 'still';
      $('wallpaper-color-seconds').value = draft.colorSeconds ?? 1 / steady.speed;
      rendererNote();
      $('export-dialog').close(); if (!dialog.open) dialog.showModal(); cards(); busy(false); startPreview();
    } catch (error) { $('export-menu-status').textContent = error.message; }
  }
  $('open-wallpaper-export').onclick = open;
  $('wallpaper-save-state').onclick = () => {
    if (!editing) return;
    try { storeScene(editing); selected = editing; finishEditing(); open(); }
    catch (error) { $('wallpaper-editing-label').textContent = error.message; }
  };
  $('wallpaper-overview').onclick = open;
  $('wallpaper-preview-play').onclick = () => startPreview(!playing);
  $('wallpaper-screen').onchange = () => {
    if (job || loadingDraft) return;
    screen = $('wallpaper-screen').value; draft = drafts[screen]; renderedDraft = null;
    $('wallpaper-apply').hidden = true; open();
  };
  $('wallpaper-detect-resolution').onclick = () => { refreshSizes(); if (!job && !loadingDraft) { readOptions(); startPreview(); } };
  globalThis.window?.addEventListener('wallpaper-displays-changed', () => { refreshSizes(); if (dialog.open && !job && !loadingDraft) { readOptions(); startPreview(); } });
  for (const id of ['wallpaper-name', 'wallpaper-idle-seconds', 'wallpaper-size', 'wallpaper-idle-fps', 'wallpaper-steady-motion', 'wallpaper-color-motion', 'wallpaper-color-seconds', 'wallpaper-quality', 'wallpaper-bitrate', 'wallpaper-supersampling']) $(id).onchange = () => {
    try { readOptions(); cards(); startPreview(); }
    catch (error) { stopPreview(); $('wallpaper-preview-status').textContent = error.message; }
  };
  function cancelDraftLoad(showMessage = true) {
    draftLoadVersion++; loadingDraft = false; busy(false);
    if (showMessage) $('wallpaper-status').textContent = 'Draft import cancelled. Your previous design is unchanged.';
  }
  dialog.addEventListener('close', () => { stopPreview(); job?.abort(); if (loadingDraft) cancelDraftLoad(false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPreview(); });
  $('wallpaper-cancel').onclick = () => { if (loadingDraft) cancelDraftLoad(); else job?.abort(); };
  $('wallpaper-apply').onclick = () => { try { nativeCall('openWallpaperPicker'); } catch (error) { $('wallpaper-status').textContent = error.message; } };
  $('wallpaper-save-draft').onclick = async () => { try { readOptions(); await downloadBlob(new Blob([wallpaperJSON(draft, true)], { type: 'application/json' }), 'fractal-wallpaper-draft.json'); } catch (error) { $('wallpaper-status').textContent = error.message; } };
  const pcDialog = $('wallpaper-pc-dialog'), pcLink = $('wallpaper-pc-link'), pcStatus = $('wallpaper-pc-status');
  let handoff = null, handoffVersion = 0;
  pcDialog.addEventListener('close', () => { handoffVersion++; handoff = null; });
  $('wallpaper-pc').onclick = async () => {
    if (job || loadingDraft) return;
    const version = ++handoffVersion;
    try {
      refreshSizes(); readOptions(); handoff = wallpaperHandoff(draft); stopPreview();
      const plan = wallpaperPlan(handoff)[0];
      $('wallpaper-pc-summary').textContent = `${handoff.name} · ${wallpaperScreenName(handoff.screen)} · ${plan.width} × ${plan.height} · ${plan.supersampling}× supersampling. Both saved scenes and their animation settings are included.`;
      pcLink.value = ''; $('wallpaper-pc-copy').disabled = $('wallpaper-pc-share').disabled = true;
      $('wallpaper-pc-share').hidden = typeof navigator.share !== 'function' && typeof nativeBridge()?.shareWallpaperLink !== 'function';
      pcStatus.textContent = 'Preparing PC link…'; if (!pcDialog.open) pcDialog.showModal();
      const url = await createWallpaperURL(shareBaseURL(location.href, import.meta.env?.VITE_SHARE_BASE_URL), handoff);
      if (version !== handoffVersion || !pcDialog.open) return;
      pcLink.value = url; $('wallpaper-pc-copy').disabled = $('wallpaper-pc-share').disabled = false;
      pcStatus.textContent = 'Ready. Send the link to your PC, or download the draft file.';
    } catch (error) {
      if (version === handoffVersion) (pcDialog.open ? pcStatus : $('wallpaper-status')).textContent = error.message;
    }
  };
  pcLink.onclick = () => pcLink.select();
  $('wallpaper-pc-copy').onclick = async () => {
    if (!pcLink.value) return;
    try { await navigator.clipboard.writeText(pcLink.value); pcStatus.textContent = 'PC link copied.'; }
    catch { pcLink.focus(); pcLink.select(); pcStatus.textContent = 'Select and copy the PC link above.'; }
  };
  $('wallpaper-pc-share').onclick = async () => {
    if (!pcLink.value) return;
    try {
      if (typeof nativeBridge()?.shareWallpaperLink === 'function') nativeCall('shareWallpaperLink', pcLink.value);
      else await navigator.share({ title: 'Render fractal wallpaper on PC', url: pcLink.value });
    } catch (error) { if (error.name !== 'AbortError') pcStatus.textContent = error.message; }
  };
  $('wallpaper-pc-file').onclick = async () => {
    if (!handoff) return;
    const saved = handoff, version = handoffVersion;
    try {
      await downloadBlob(new Blob([wallpaperJSON(saved, true)], { type: 'application/json' }), `fractal-wallpaper-${saved.screen}-draft.json`);
      if (version === handoffVersion && pcDialog.open) pcStatus.textContent = 'Draft prepared. Transfer it to your PC and use Open wallpaper draft in the wallpaper designer.';
    } catch (error) { if (version === handoffVersion && pcDialog.open) pcStatus.textContent = error.message; }
  };
  $('wallpaper-open-draft').onclick = () => $('wallpaper-draft-file').click();
  $('wallpaper-draft-file').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    if (job) { event.target.value = ''; return; }
    const version = ++draftLoadVersion;
    loadingDraft = true; stopPreview(); busy(true); $('wallpaper-status').textContent = 'Opening wallpaper draft…';
    try {
      if (file.size > MAX_WALLPAPER_JSON_BYTES) throw new Error('Wallpaper draft exceeds 4 MiB.');
      const json = await file.text();
      if (version !== draftLoadVersion || !dialog.open) return;
      const next = JSON.parse(json); designPlan(next); draft = wallpaperScreenDraft(next, next.screen ?? screen); draft.resolutionVersion = 1; save();
      loadingDraft = false; open();
    } catch (error) { if (version === draftLoadVersion && dialog.open) $('wallpaper-status').textContent = error.message; }
    finally { if (version === draftLoadVersion) { loadingDraft = false; busy(false); } event.target.value = ''; }
  };
  $('wallpaper-create').onclick = async () => {
    if (job || loadingDraft) return;
    refreshSizes();
    let renderer, video, fields, pack = false;
    const controller = job = new AbortController(), signal = controller.signal;
    stopPreview(); $('wallpaper-apply').hidden = true; busy(true);
    try {
      readOptions(); const saved = structuredClone(draft), plans = wallpaperPlan(saved), native = !!nativeBridge();
      const manifest = wallpaperManifest(saved, plans); // Check metadata size before rendering any video.
      const { mp4Encoder, supportsMP4 } = await import('./video-export.js');
      for (const p of plans) if (!await supportsMP4({ ...p, ...(native ? { nativeTarget: p.key } : {}) })) throw new Error('This encoder cannot use the selected resolution and quality. Choose a smaller size or another quality; your settings have not been lowered.');
      check(signal);
      if (native) { nativeCall('beginPack'); pack = true; }
      renderer = new BrowserEngine(document.createElement('canvas'), palettes);
      renderer.onBackendChange = () => rendererNote(renderer);
      signal.addEventListener('abort', () => renderer.destroy(), { once: true });
      await renderer.init({ forceCPU: !engine.gpu }); check(signal);
      rendererNote(renderer);
      if (renderer.renderLimits) for (const plan of plans) {
        try { validateDimensions(plan.renderWidth, plan.renderHeight, renderer.renderLimits); }
        catch { throw new Error(`${plan.supersampling}× supersampling at ${plan.width} × ${plan.height} exceeds this renderer's limits. Choose a lower sampling level or smaller resolution.`); }
      }
      fields = new ExportFieldCache({ memoryBudget: exportCacheBudget(engine.mobile), signal });
      const entries = [], canvas = document.createElement('canvas');
      const total = plans.reduce((sum, p) => sum + p.frames, 0); let complete = 0;
      for (const p of plans) {
        canvas.width = p.width; canvas.height = p.height;
        video = await mp4Encoder(canvas, { ...p, nativeTarget: p.key });
        for (let index = 0; index < p.frames; index++) {
          check(signal); $('wallpaper-status').textContent = `${p.title} · frame ${index + 1} / ${p.frames} · ${Math.round(100 * complete / total)}%`;
          await renderSample(renderer, canvas, p, index, fields, signal);
          if (!p.transition && index === 0) {
            const filename = `${p.screen}-poster.png`;
            if (native) nativeCall('putPoster', p.screen, canvas.toDataURL('image/png').split(',')[1]);
            else entries.push([filename, await png(canvas)]);
          }
          await video.add(index); complete++; await nextFrame();
        }
        check(signal); const blob = await video.finish(); video = null;
        if (!native) entries.push([p.file, blob]);
      }
      check(signal);
      if (native) {
        nativeCall('commitPack', wallpaperJSON(manifest)); pack = false; renderedDraft = JSON.stringify(saved); $('wallpaper-apply').hidden = false;
        $('wallpaper-status').textContent = `${wallpaperScreenName(saved.screen)} transition and loop saved and selected. The other screen is unchanged. Use Set up if Samsung still shows another wallpaper.`;
      } else {
        entries.push(['wallpaper.json', new Blob([wallpaperJSON(manifest)], { type: 'application/json' })]);
        const blob = await wallpaperZip(entries); check(signal); await downloadBlob(blob, 'fractal-wallpaper.zip');
        $('wallpaper-status').textContent = 'Wallpaper package ready. Open it with Import wallpaper package in the Android app.';
      }
    } catch (error) { $('wallpaper-status').textContent = error.name === 'AbortError' ? 'Wallpaper creation cancelled. Your previous wallpaper is still active.' : error.message; }
    finally {
      await video?.cancel().catch(() => {}); if (pack) { try { nativeCall('cancelPack'); } catch {} }
      renderer?.destroy(); await fields?.dispose().catch(() => {}); job = null; busy(false);
    }
  };
  function replaceWorkingDraft(next, { isCurrent = () => true, fromLink = false } = {}) {
    designPlan(next); wallpaperJSON(next);
    const replace = () => {
      pendingHandoff = null;
      if (!isCurrent()) return;
      draft = structuredClone(next); draft.resolutionVersion = 1; save(); finishEditing(); selected = wallpaperSlots(draft)[0].key;
      $('wallpaper-editing').hidden = true; $('wallpaper-apply').hidden = true;
      $('wallpaper-status').textContent = ''; $('wallpaper-gallery-dialog').close(); open();
    };
    if (!draft) { replace(); return; }
    const confirm = $('wallpaper-replace-dialog');
    pendingHandoff = fromLink ? isCurrent : null;
    $('wallpaper-replace-continue').onclick = () => { confirm.close(); replace(); };
    confirm.showModal();
  }
  setupWallpaperGallery({
    getScreen: () => draft?.screen ?? screen,
    canOpen: () => {
      if (!job && !loadingDraft) return true;
      $('wallpaper-status').textContent = loadingDraft ? 'Finish or cancel draft import before opening the gallery.' : 'Finish or cancel wallpaper creation before opening the gallery.'; return false;
    },
    beforeOpen: stopPreview,
    newWallpaper: target => replaceWorkingDraft(newWorkingDraft(target)),
    editWallpaper: (next, target) => replaceWorkingDraft(wallpaperScreenDraft(next, target)),
  });
  globalThis.window?.addEventListener('hashchange', () => {
    if (pendingHandoff && !pendingHandoff()) { pendingHandoff = null; $('wallpaper-replace-dialog').close(); }
  });
  async function openHandoff(address, { isCurrent = () => true } = {}) {
    const version = ++handoffLoad, importVersion = draftLoadVersion;
    const current = () => version === handoffLoad && importVersion === draftLoadVersion && isCurrent();
    const next = await readWallpaperURL(address);
    if (!next || !current()) return false;
    if (job || loadingDraft || editing) throw new Error('Finish the current wallpaper task before opening a PC link.');
    replaceWorkingDraft(next, { isCurrent: current, fromLink: true });
    return true;
  }
  return { openHandoff };
}
