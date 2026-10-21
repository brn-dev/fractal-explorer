import { chooseSoundscape, getSoundscape, soundscapes } from './soundscapes.mjs';
import { MusicEngine } from './music-engine.mjs';
import { extractFeatures, sampleField, ReactiveTracker } from './reactive-analysis.mjs';

export const AUDIO_STORAGE_KEY = 'fractal-web-audio-v1';
export const majorSceneEvents = new Set(['initial','featured','bookmark','family','reset','import','shared']);
export const isMajorSceneChange = reason => majorSceneEvents.has(reason);
export const defaultAudioSettings = Object.freeze({ enabled: false, muted: false, mode: 'generative', selection: 'auto', manualId: 'celestial', volume: .32, intensity: .45 });
export function validateAudioSettings(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    enabled: v.enabled === true,
    muted: v.muted === true,
    mode: v.mode === 'reactive' ? 'reactive' : 'generative',
    selection: v.selection === 'manual' ? 'manual' : 'auto',
    manualId: soundscapes.some(d => d.id === v.manualId) ? v.manualId : 'celestial',
    volume: Number.isFinite(v.volume) ? Math.max(0,Math.min(1,v.volume)) : defaultAudioSettings.volume,
    intensity: Number.isFinite(v.intensity) ? Math.max(0,Math.min(1,v.intensity)) : defaultAudioSettings.intensity,
  };
}
export class AudioController {
  constructor({ storage, random = Math.random, makeSeed = () => globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * 4294967296), engine, onChange = () => {}, requestAnalysis = () => {} } = {}) {
    Object.assign(this,{ storage, random, makeSeed, onChange, requestAnalysis });
    let saved;
    try { saved = JSON.parse(storage?.getItem(AUDIO_STORAGE_KEY) ?? 'null'); this.settings = validateAudioSettings(saved); }
    catch { this.settings = { ...defaultAudioSettings }; }
    this.player = engine ?? new MusicEngine({ onState: (state,error) => { this.error = error ? 'Playback paused. Press Start to try again.' : ''; this.notify(); } });
    this.player.setVolume(this.settings.volume); this.player.setIntensity(this.settings.intensity);
    this.player.setMuted(this.settings.muted);
    this.tracker = new ReactiveTracker(); this.samples = new WeakMap();
    this.visible = true; this.seed = makeSeed(); this.autoId = soundscapes.some(d => d.id === saved?.lastAutoId) ? saved.lastAutoId : null;
  }
  get id() { return this.settings.mode === 'reactive' ? 'resonance' : this.settings.selection === 'manual' ? this.settings.manualId : this.autoId ?? 'celestial'; }
  get selection() { return { id: this.id, seed: this.seed }; }
  get analyzing() { return this.settings.enabled && !this.settings.muted && this.settings.mode === 'reactive' && this.visible && this.player.state === 'playing'; }
  get state() { return !this.settings.enabled ? 'off' : this.player.state === 'playing' ? this.settings.muted ? 'muted' : 'playing' : 'paused'; }
  notify() { this.onChange(this); }
  persist() { try { this.storage?.setItem(AUDIO_STORAGE_KEY,JSON.stringify({ ...this.settings, lastAutoId: this.autoId })); } catch {} }
  resetAnalysis() { this.tracker.reset(); this.player.resetFeatures(); }
  majorSceneChange(reason) {
    if (!isMajorSceneChange(reason)) return false;
    this.resetAnalysis();
    if (this.settings.mode === 'generative' && this.settings.selection === 'auto') {
      this.autoId = chooseSoundscape(this.autoId,this.random); this.seed = this.makeSeed(); this.player.select(this.selection);
    }
    this.persist(); this.notify(); return true;
  }
  configure(patch) {
    const old = this.id;
    const previous = this.settings;
    this.settings = validateAudioSettings({ ...this.settings, ...patch }); this.error = '';
    if (this.settings.mode === 'generative' && this.settings.selection === 'auto' && (previous.selection !== 'auto' || !this.autoId)) this.autoId = chooseSoundscape(old,this.random);
    this.player.setVolume(this.settings.volume); this.player.setIntensity(this.settings.intensity);
    this.player.setMuted(this.settings.muted);
    if (previous.muted !== this.settings.muted) this.resetAnalysis();
    if (old !== this.id) { this.seed = this.makeSeed(); this.resetAnalysis(); this.player.select(this.selection); }
    this.persist(); this.notify();
    if (this.analyzing) this.requestAnalysis();
  }
  shuffle() {
    const previous = this.id;
    this.settings.mode = 'generative'; this.settings.selection = 'auto';
    this.autoId = chooseSoundscape(previous,this.random); this.seed = this.makeSeed();
    this.resetAnalysis(); this.player.select(this.selection); this.persist(); this.notify();
  }
  async start() {
    this.settings.enabled = true; this.settings.muted = false; this.player.setMuted(false); this.error = ''; this.persist();
    if (!this.autoId) this.autoId = chooseSoundscape(null,this.random);
    const started = await this.player.start(this.selection);
    this.notify(); if (started && this.analyzing) this.requestAnalysis();
    return started;
  }
  stop() { this.settings.enabled = false; this.resetAnalysis(); this.player.stop(); this.persist(); this.notify(); }
  toggleMute() {
    if (!this.settings.enabled || this.player.state !== 'playing') return this.start();
    this.configure({ muted: !this.settings.muted });
  }
  async setVisible(visible) { this.visible = visible; this.resetAnalysis(); await this.player.setVisible(visible); this.notify(); if (this.analyzing) this.requestAnalysis(); }
  present(frame, time = performance.now() / 1000) {
    if (!this.analyzing || !frame?.field || typeof frame.field !== 'object') return;
    let features = this.samples.get(frame);
    if (!features) {
      features = extractFeatures(sampleField(frame.field,frame.metadata.width,frame.metadata.height),frame.view);
      if (features) this.samples.set(frame,features);
    }
    const result = this.tracker.observe(features,time); if (result) this.player.setFeatures(result);
  }
  presentSamples(samples, view, time = performance.now() / 1000) {
    if (!this.analyzing) return;
    const result = this.tracker.observe(extractFeatures(samples,view),time); if (result) this.player.setFeatures(result);
  }
  setPalettePhase(phase) { if (this.analyzing) this.player.setPalettePhase(phase); }
  async destroy() { await this.player.destroy(); this.samples = new WeakMap(); }
}

export function setupAudioControls({ requestAnalysis }) {
  const $ = id => document.getElementById(id);
  const supported = !!(globalThis.AudioContext ?? globalThis.webkitAudioContext);
  const controller = new AudioController({ storage: safeStorage(), requestAnalysis, onChange: sync });
  const select = $('audio-soundscape');
  for (const d of soundscapes) select.add(new Option(d.name,d.id));
  function sync() {
    const s = controller.settings, reactive = s.mode === 'reactive';
    $('audio-enabled').checked = s.enabled;
    const silent = controller.state !== 'playing', mute = $('audio-mute');
    mute.setAttribute('aria-pressed',String(silent));
    mute.setAttribute('aria-label',silent ? 'Unmute sound' : 'Mute sound');
    mute.title = silent ? 'Unmute sound' : 'Mute sound';
    $('audio-mode').value = s.mode; select.value = s.selection === 'auto' ? 'auto' : s.manualId;
    $('audio-generative').hidden = reactive; $('audio-reactive').hidden = !reactive;
    $('audio-resolved').textContent = getSoundscape(controller.id).name;
    for (const key of ['volume','intensity']) { $(`audio-${key}`).value = s[key]; $(`audio-${key}-value`).textContent = `${Math.round(s[key] * 100)}%`; }
    $('audio-status').textContent = !supported ? 'Web Audio unavailable in this browser.' : controller.error || (controller.state === 'playing' ? 'Playing' : controller.state === 'muted' ? 'Muted' : controller.state === 'off' ? 'Off' : controller.visible ? 'Paused · press Start to listen' : 'Paused · tab hidden');
    $('audio-start').hidden = !supported || !s.enabled || ['playing','muted'].includes(controller.state) || !controller.visible;
  }
  $('audio-enabled').disabled = !supported;
  $('audio-mute').disabled = !supported;
  $('audio-mute').onclick = () => controller.toggleMute();
  $('audio-enabled').onchange = () => $('audio-enabled').checked ? controller.start() : controller.stop();
  $('audio-start').onclick = () => controller.start();
  $('audio-mode').onchange = () => controller.configure({ mode: $('audio-mode').value });
  select.onchange = () => controller.configure(select.value === 'auto' ? { selection: 'auto' } : { selection: 'manual', manualId: select.value });
  $('audio-shuffle').onclick = () => controller.shuffle();
  for (const key of ['volume','intensity']) $(`audio-${key}`).oninput = () => controller.configure({ [key]: Number($(`audio-${key}`).value) });
  document.addEventListener('visibilitychange',() => controller.setVisible(!document.hidden));
  addEventListener('pagehide',event => { if (!event.persisted) controller.destroy(); else controller.setVisible(false); });
  addEventListener('pageshow',event => { if (event.persisted) controller.setVisible(!document.hidden); });
  controller.visible = !document.hidden; controller.player.visible = !document.hidden;
  sync(); return controller;
}
function safeStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
