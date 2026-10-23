import { MusicEngine } from './music-engine.mjs';
import { extractFeatures, sampleField, ReactiveTracker } from './reactive-analysis.mjs';

export const SOUNDSCAPE_SAMPLE_RATE = 48000;
export const SOUNDSCAPE_WARMUP = 16;
export const SOUNDSCAPE_FADE_IN = 2;
export const SOUNDSCAPE_FADE_OUT = 1;
const check = signal => { if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError'); };

export const soundscapeFrame = (values, metadata, view) => extractFeatures(sampleField(values, metadata.width, metadata.height), view);

export function soundscapeEnvelope(index, length, sampleRate) {
  const fadeIn = Math.min(SOUNDSCAPE_FADE_IN * sampleRate, length / 2);
  const fadeOut = Math.min(SOUNDSCAPE_FADE_OUT * sampleRate, length / 4);
  return Math.max(0, Math.min(1, index / fadeIn, (length - 1 - index) / fadeOut));
}

// Uses its own inaudible context: neither live playback nor fractal render speed
// controls export timing. Only the small feature snapshots of exported frames
// are retained, never another copy of their full-resolution scalar fields.
export async function renderSoundscape({ selection, duration, fps, features = [], phaseAt = () => 0, signal, onProgress = () => {} }) {
  check(signal);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 21 || !Number.isFinite(fps) || fps <= 0) throw new Error('Invalid soundscape duration or frame rate.');
  if (selection.id === 'resonance' && features.length !== Math.round(duration * fps)) throw new Error('Reactive sound requires every exported frame.');
  const OfflineContext = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error('Offline soundscape rendering is unavailable in this browser.');
  const rate = SOUNDSCAPE_SAMPLE_RATE, length = Math.round(duration * rate), warmup = SOUNDSCAPE_WARMUP;
  const context = new OfflineContext(2, warmup * rate + length, rate);
  const player = new MusicEngine({ createContext: () => context }), tracker = new ReactiveTracker();
  try {
    player.initialize(); context.onstatechange = null;
    player.setVolume(selection.volume); player.setIntensity(selection.intensity);
    player.master.gain.value = player.outputLevel; player.active = true;
    const scene = player.createScene(selection); player.scenes.push(scene);
    function tick() {
      const time = context.currentTime;
      const index = Math.max(0, Math.min(Math.round(duration * fps) - 1, Math.round((time - warmup) * fps)));
      if (selection.id === 'resonance') player.setFeatures(tracker.observe(features[index], time));
      player.setPalettePhase(phaseAt(index)); player.tick({ offline: true });
      onProgress(Math.max(0, time - warmup), time < warmup);
    }
    tick();
    // Keep only one suspension ahead, so cancellation can drain immediately.
    const checkpoints = [];
    for (let step = 1; step < warmup * 10; step++) checkpoints.push(step / 10);
    for (let frame = 0; frame < Math.round(duration * fps); frame++) checkpoints.push(warmup + frame / fps);
    let checkpoint = context.suspend(checkpoints[0]);
    const rendering = context.startRendering();
    for (let i = 0; i < checkpoints.length; i++) {
      await Promise.race([checkpoint, rendering.then(() => { throw new Error('Soundscape rendering ended before its scheduled frames.'); })]);
      check(signal); tick();
      if (i + 1 < checkpoints.length) checkpoint = context.suspend(checkpoints[i + 1]);
      await context.resume();
    }
    const rendered = await rendering; check(signal);
    const clipped = context.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const source = rendered.getChannelData(channel), target = clipped.getChannelData(channel);
      for (let i = 0; i < length; i++) target[i] = source[warmup * rate + i] * soundscapeEnvelope(i, length, rate);
    }
    return clipped;
  } finally {
    player.active = false;
    for (const scene of [...player.scenes]) player.disposeScene(scene);
    context.onstatechange = null;
    // OfflineAudioContext has no close/cancel API. Disconnect its graph and let
    // any cancelled render finish silently, without more scheduled suspensions.
    player.master?.disconnect();
    if (context.state === 'suspended') await context.resume().catch(() => {});
  }
}
