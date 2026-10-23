// Plays the exact, already warmed-up/faded AudioBuffer supplied to the MP4
// encoder. The audio clock drives visual preview time, including pause/resume.
export class SoundscapePreview {
  constructor({ createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)({ sampleRate: 48000 }) } = {}) {
    this.createContext = createContext; this.offset = 0; this.buffer = null;
  }
  async unlock() {
    if (this.disposed) return false;
    try {
      this.context ??= this.createContext();
      // Called directly from the checkbox / Play gesture, before preparation.
      await this.context.resume();
      return !this.disposed && this.context.state === 'running';
    } catch { return false; }
  }
  get position() {
    return Math.min(this.buffer?.duration ?? 0, this.offset + (this.source ? Math.max(0, this.context.currentTime - this.startedAt) : 0));
  }
  get playing() { return !!this.source && this.context.state === 'running'; }
  get ended() { return !!this.buffer && this.position >= this.buffer.duration; }
  setBuffer(buffer) { this.reset(); this.buffer = buffer; }
  play() {
    if (this.disposed || !this.buffer || this.context?.state !== 'running') return false;
    if (this.source) return true;
    if (this.ended) this.offset = 0;
    const source = this.source = this.context.createBufferSource(), gain = this.gain = this.context.createGain();
    source.buffer = this.buffer; source.connect(gain).connect(this.context.destination);
    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.context.currentTime + .012);
    this.startedAt = this.context.currentTime;
    source.onended = () => {
      source.disconnect(); gain.disconnect();
      if (this.source === source) { this.offset = this.buffer.duration; this.source = this.gain = null; }
    };
    source.start(this.startedAt, this.offset); return true;
  }
  pause() {
    this.offset = this.position;
    const source = this.source, gain = this.gain;
    this.source = this.gain = null;
    if (source) {
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, this.context.currentTime);
      gain.gain.linearRampToValueAtTime(0, this.context.currentTime + .012);
      source.stop(this.context.currentTime + .015);
    }
  }
  reset() { this.pause(); this.offset = 0; }
  clear() { this.reset(); this.buffer = null; }
  async dispose() {
    this.disposed = true; this.clear();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
  }
}
