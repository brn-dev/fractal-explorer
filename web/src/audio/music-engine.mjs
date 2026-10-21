import { MusicalTimeline, getSoundscape, seededRandom } from './soundscapes.mjs';
import { smooth, REACTIVE_TIMING } from './reactive-analysis.mjs';

const clamp = n => Math.max(0,Math.min(1,n));
// Voices are deliberately quiet before summing. Calibrate the listening level
// here, before the high-pass and peak limiter, with room for overlapping scenes.
export const MIX_GAIN = 2.4;
const midiHz = n => 440 * 2 ** ((n - 69) / 12);
function hold(param, time) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(time);
  else { const value = param.value; param.cancelScheduledValues(time); param.setValueAtTime(value,time); }
}
function fade(param, value, time, duration) { hold(param,time); param.linearRampToValueAtTime(value,time + duration); }
function disconnect(nodes) { for (const node of nodes) node.disconnect(); }

// One lazy context, one limiter, at most two scene graphs. Timers fill a small
// AudioContext-time lookahead; oscillators never depend on animation frames.
export class MusicEngine {
  constructor({ createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(), onState = () => {}, timers = globalThis } = {}) {
    Object.assign(this,{ createContext, onState, timers });
    this.scenes = []; this.volume = .32; this.intensity = .45;
    this.visible = true; this.active = false; this.operation = 0;
    this.muted = false;
    this.reactive = { complexity: .08, regional: .1, interior: .5, balance: 0, novelty: 0 };
    this.energy = .12; this.motion = 0; this.phase = 0; this.lastFeaturesAt = -Infinity;
  }
  initialize() {
    if (this.context?.state === 'closed') {
      this.clearScheduler();
      for (const scene of [...this.scenes]) this.disposeScene(scene);
      disconnect([this.master,this.highpass,this.limiter]); this.context = null;
    }
    if (this.context) return;
    const c = this.context = this.createContext();
    this.master = c.createGain(); this.master.gain.value = 0;
    this.highpass = c.createBiquadFilter(); this.highpass.type = 'highpass'; this.highpass.frequency.value = 45; this.highpass.Q.value = .5;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -14; this.limiter.knee.value = 10; this.limiter.ratio.value = 8;
    this.limiter.attack.value = .008; this.limiter.release.value = .4;
    this.master.connect(this.highpass).connect(this.limiter).connect(c.destination);
    const random = seededRandom(73041);
    this.impulse = c.createBuffer(2,Math.ceil(c.sampleRate * 3.8),c.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = this.impulse.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < data.length; i++) {
        low = .62 * low + .38 * (random() * 2 - 1);
        data[i] = low * (1 - i / data.length) ** 2.8 * Math.min(1,i / (c.sampleRate * .025));
      }
    }
    this.noise = c.createBuffer(1,c.sampleRate * 4,c.sampleRate);
    const noise = this.noise.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = random() * 2 - 1;
    this.waves = {};
    for (const [name,partials] of Object.entries({ choir: [1,.12,.32,.08,.12,.03], organ: [1,.45,.32,.17,.12,.07,.04], pad: [1,.18,.12,.045], air: [1,0,.10,0,.04] })) {
      const real = new Float32Array(partials.length + 1), imag = new Float32Array([0,...partials]);
      this.waves[name] = c.createPeriodicWave(real,imag);
    }
    c.onstatechange = () => {
      if (c.state !== 'running') this.clearScheduler();
      else if (this.active && this.visible && this.interval == null) this.schedule();
      this.onState(this.state);
    };
  }
  get state() { return this.active ? this.context?.state === 'running' && this.visible ? 'playing' : 'paused' : 'off'; }
  get outputLevel() { return this.muted ? 0 : this.volume * MIX_GAIN; }
  async start(selection) {
    const token = ++this.operation;
    this.timers.clearTimeout(this.stopTimer); this.stopTimer = null;
    try {
      this.initialize();
      // Invoked directly by the Sound/Start gesture, before its first await.
      await this.context.resume();
      if (token !== this.operation) return false;
      if (this.context.state !== 'running') throw new Error('Playback needs another interaction.');
      this.active = true;
      this.select(selection);
      if (this.visible) {
        fade(this.master.gain,this.outputLevel,this.context.currentTime,1.2);
        this.schedule();
      } else await this.setVisible(false);
      this.onState(this.state); return true;
    } catch (error) {
      if (token !== this.operation) return false;
      this.active = false; this.clearScheduler();
      this.onState('paused',error); return false;
    }
  }
  setVolume(volume) {
    this.volume = clamp(volume);
    if (this.context && this.state === 'playing') { hold(this.master.gain,this.context.currentTime); this.master.gain.setTargetAtTime(this.outputLevel,this.context.currentTime,.25); }
  }
  setMuted(muted) {
    this.muted = !!muted;
    if (this.context && this.state === 'playing') fade(this.master.gain,this.outputLevel,this.context.currentTime,.08);
  }
  setIntensity(value) { this.intensity = clamp(value); }
  setPalettePhase(phase) { if (Number.isFinite(phase)) this.phase = phase; }
  setFeatures(features) {
    if (!features) return;
    this.reactive = features;
    this.lastFeaturesAt = this.context?.currentTime ?? 0;
    if (features.event && this.active && this.visible) this.accent = Math.max(.3,clamp(features.novelty));
  }
  resetFeatures() {
    this.reactive = { complexity: .08, regional: .1, interior: .5, balance: 0, novelty: 0 };
    this.accent = null;
    this.motion = 0; this.lastFeaturesAt = -Infinity;
  }
  select(selection) {
    this.selection = selection;
    if (!this.active || !this.context) return;
    const current = this.scenes.find(s => !s.retiring);
    if (current?.id === selection.id && current.seed === selection.seed) return;
    const now = this.context.currentTime;
    // Rapid shuffles still have a strict graph/voice bound. The oldest, already
    // retiring graph gets a short click-free release before replacement.
    for (const scene of this.scenes.filter(s => s.retiring)) {
      scene.retireAt = Math.min(scene.retireAt,now + .15);
      fade(scene.output.gain,0,now,.15);
    }
    if (current) { current.retiring = true; current.retireAt = now + 5; fade(current.output.gain,0,now,5); }
    // Defer allocation while an older tail retires: newest request wins.
    this.pendingSelection = selection;
    this.tick();
  }
  createScene({ id, seed }) {
    const c = this.context, d = getSoundscape(id), now = c.currentTime;
    const input = c.createGain(), upper = c.createGain(), filter = c.createBiquadFilter(), output = c.createGain();
    upper.gain.value = id === 'resonance' ? .15 : .55 + this.intensity * .55;
    input.gain.value = .8; upper.connect(input);
    filter.type = 'lowpass'; filter.frequency.value = d.cutoff; filter.Q.value = .45;
    input.connect(filter); output.gain.value = 0; output.connect(this.master);
    const dry = c.createGain(), wet = c.createGain(), reverb = c.createConvolver();
    dry.gain.value = .82; wet.gain.value = d.wet; reverb.buffer = this.impulse;
    filter.connect(dry).connect(output); filter.connect(reverb).connect(wet).connect(output);
    const delay = c.createDelay(2), feedback = c.createGain(), damp = c.createBiquadFilter(), echo = c.createGain();
    delay.delayTime.value = d.delay; feedback.gain.value = d.feedback; damp.frequency.value = 2100; echo.gain.value = .14;
    filter.connect(delay).connect(damp).connect(feedback).connect(delay); damp.connect(echo).connect(output);
    const scene = { id, seed, d, input, upper, filter, output, voices: new Set(), timeline: new MusicalTimeline(d,seed), origin: now + .08, nodes: [input,upper,filter,output,dry,wet,reverb,delay,feedback,damp,echo] };
    if (id === 'resonance') {
      // Persistent, harmonically related resonators make every structural
      // movement audible through gain/timbre, without scheduling notes per frame.
      scene.resonators = [12,19,26].map((interval,i) => {
        const source = c.createOscillator(), gain = c.createGain(), pan = c.createStereoPanner();
        source.type = 'sine'; source.frequency.value = midiHz(d.root + interval);
        gain.gain.value = 0; pan.pan.value = (i - 1) * .45;
        source.connect(gain).connect(pan).connect(input); source.start(now);
        const voice = { sources: [source], nodes: [source,gain,pan], end: Infinity };
        scene.voices.add(voice); return { gain, pan };
      });
      scene.accentStep = 0;
    }
    fade(output.gain,1,now,5); return scene;
  }
  schedule() {
    this.clearScheduler(); this.lastTick = this.context.currentTime;
    this.tick(); this.interval = this.timers.setInterval(() => this.tick(),100);
  }
  clearScheduler() { if (this.interval != null) this.timers.clearInterval(this.interval); this.interval = null; }
  tick() {
    if (!this.active || !this.visible || this.context.state !== 'running') return;
    const c = this.context, now = c.currentTime, dt = Math.min(.5,Math.max(0,now - (this.lastTick ?? now))); this.lastTick = now;
    for (const scene of [...this.scenes]) if (scene.retiring && scene.retireAt <= now) this.disposeScene(scene);
    if (this.pendingSelection && this.scenes.length < 2) { this.scenes.push(this.createScene(this.pendingSelection)); this.pendingSelection = null; }
    const age = now - this.lastFeaturesAt;
    const movement = (this.reactive.motion ?? 0) * Math.exp(-Math.max(0,age - .15) / .2);
    this.motion = smooth(this.motion,clamp(movement),dt,REACTIVE_TIMING.attack,REACTIVE_TIMING.release);
    this.energy = smooth(this.energy,clamp(this.reactive.complexity * 1.8 + this.reactive.regional * .45),dt,.12,.7);
    for (const scene of this.scenes) {
      if (scene.retiring) continue;
      const reactive = scene.id === 'resonance';
      const activity = reactive ? clamp(this.energy * .65 + this.motion * .9) : .35;
      const brightness = reactive ? .45 + activity * 2.2 + (1 - this.reactive.interior) * .25 + .035 * Math.sin(this.phase * Math.PI * 2) : .72 + .35 * Math.sin((now - scene.origin) / 29);
      scene.filter.frequency.setTargetAtTime(scene.d.cutoff * brightness * (.65 + this.intensity * .7),now,reactive ? .055 : 4);
      scene.upper.gain.setTargetAtTime(reactive ? (.10 + activity * .95) * (.35 + this.intensity) : .4 + this.intensity * .8,now,reactive ? .08 : activity > .3 ? 1.2 : 5);
      scene.input.gain.setTargetAtTime(reactive ? .55 + activity * .35 : .8,now,reactive ? .13 : 3);
      scene.resonators?.forEach(({gain,pan},i) => {
        const level = (.002 * this.energy + .028 * this.motion ** (1 + i * .35)) * (.35 + this.intensity * .65) / Math.sqrt(i + 1);
        gain.gain.setTargetAtTime(level,now,.045);
        pan.pan.setTargetAtTime((i - 1) * .45 + this.reactive.balance * .18,now,.12);
      });
      const events = scene.timeline.until(now - scene.origin + .35);
      for (const event of events) {
        const at = scene.origin + event.at;
        // A browser suspension without a visibility event must not catch up by
        // playing a backlog of accents all at once.
        if (at < now - .5) continue;
        this.voice(scene,{ ...event, at: Math.max(now + .015,at), level: event.level * (event.layer === 'foundation' ? 1 : .5 + this.intensity), pan: reactive ? Math.max(-.9,Math.min(.9,event.pan + this.reactive.balance * .2)) : event.pan });
      }
      if (reactive && this.accent) {
        const chord = scene.d.chords[scene.timeline.chord];
        const pitch = chord[(scene.accentStep++ * 2 + 1) % chord.length];
        this.voice(scene,{ at: now + .015, midi: scene.d.root + pitch + 12, timbre: 'bell', duration: 2.4, attack: .035, level: .010 + .014 * this.accent * this.intensity, pan: this.reactive.balance * .4, drift: .08, detune: 3, upper: true, accent: true });
        this.accent = null;
      }
    }
  }
  voice(scene,event) {
    if (scene.voices.size >= (scene.id === 'resonance' && !event.accent ? 10 : 12)) return;
    if (event.accent && [...scene.voices].filter(v => v.accent).length >= 3) return;
    const c = this.context, at = event.at, duration = event.duration, end = at + duration;
    const envelope = c.createGain(), pan = c.createStereoPanner(), filter = c.createBiquadFilter();
    const nodes = [envelope,pan,filter], sources = [];
    const bell = ['glass','bell','grain'].includes(event.timbre), attack = Math.min(duration * .35,event.attack);
    envelope.gain.setValueAtTime(0,at); envelope.gain.linearRampToValueAtTime(event.level,at + attack);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.00001,event.level * .52),at + Math.max(attack,duration * .48));
    envelope.gain.linearRampToValueAtTime(0,end);
    pan.pan.setValueAtTime(event.pan,at); pan.pan.linearRampToValueAtTime(Math.max(-1,Math.min(1,event.pan + event.drift)),end);
    filter.type = event.timbre === 'noise' ? 'bandpass' : 'lowpass';
    filter.frequency.setValueAtTime(event.timbre === 'dark' ? 650 : event.timbre === 'noise' ? 2400 : bell ? 6500 : 3600,at);
    filter.Q.value = event.timbre === 'noise' ? .7 : .4;
    filter.connect(envelope).connect(pan).connect(event.upper ? scene.upper : scene.input);
    const frequency = midiHz(event.midi);
    const oscillator = (ratio,level,detune = 0) => {
      const osc = c.createOscillator(), gain = c.createGain(); nodes.push(osc,gain); sources.push(osc);
      osc.frequency.setValueAtTime(frequency * ratio,at);
      osc.detune.setValueAtTime(detune,at); osc.detune.linearRampToValueAtTime(-detune * .7,end);
      if (this.waves[event.timbre]) osc.setPeriodicWave(this.waves[event.timbre]); else osc.type = 'sine';
      gain.gain.value = level; osc.connect(gain).connect(filter); return osc;
    };
    if (event.timbre === 'noise') {
      const source = c.createBufferSource(); source.buffer = this.noise; source.loop = true; sources.push(source); nodes.push(source); source.connect(filter);
    } else if (bell) {
      const carrier = oscillator(1,.7);
      const mod = c.createOscillator(), depth = c.createGain(); nodes.push(mod,depth); sources.push(mod);
      mod.frequency.value = frequency * (event.timbre === 'glass' ? 2.71 : 2);
      depth.gain.setValueAtTime(frequency * .65,at); depth.gain.exponentialRampToValueAtTime(.1,at + duration * .8);
      mod.connect(depth).connect(carrier.frequency);
      if (event.timbre !== 'grain') oscillator(event.timbre === 'glass' ? 4.07 : 3,.07);
    } else {
      oscillator(1,.55,event.detune);
      oscillator(event.timbre === 'dark' ? 2 : 1,event.timbre === 'dark' ? .12 : .45,-event.detune);
    }
    const voice = { sources, nodes, end, accent: !!event.accent }; scene.voices.add(voice);
    let remaining = sources.length;
    for (const source of sources) {
      source.onended = () => { if (--remaining === 0) { disconnect(nodes); scene.voices.delete(voice); } };
      source.start(at); source.stop(end + .05);
    }
  }
  disposeScene(scene) {
    for (const voice of scene.voices) {
      for (const source of voice.sources) { source.onended = null; try { source.stop(); } catch {} }
      disconnect(voice.nodes);
    }
    scene.voices.clear(); disconnect(scene.nodes);
    this.scenes = this.scenes.filter(s => s !== scene);
  }
  async stop() {
    const token = ++this.operation; this.active = false; this.pendingSelection = null; this.accent = null;
    this.clearScheduler(); this.timers.clearTimeout(this.stopTimer);
    if (!this.context) { this.onState('off'); return; }
    fade(this.master.gain,0,this.context.currentTime,.5);
    this.stopTimer = this.timers.setTimeout(async () => {
      if (token !== this.operation) return;
      for (const scene of [...this.scenes]) this.disposeScene(scene);
      try { await this.context.suspend(); } catch {}
    },550);
    this.onState('off');
  }
  async setVisible(visible) {
    this.visible = visible;
    if (!this.active || !this.context) return;
    const token = ++this.operation;
    this.timers.clearTimeout(this.stopTimer);
    if (!visible) {
      this.clearScheduler(); fade(this.master.gain,0,this.context.currentTime,.35);
      this.stopTimer = this.timers.setTimeout(() => { if (token === this.operation) this.context.suspend().catch(() => {}); },400);
    } else {
      try {
        await this.context.resume();
        if (token !== this.operation || !this.active || !this.visible) return;
        if (this.context.state === 'running') { fade(this.master.gain,this.outputLevel,this.context.currentTime,1.2); this.schedule(); }
      } catch (error) { this.onState('paused',error); return; }
    }
    this.onState(this.state);
  }
  async destroy() {
    ++this.operation; this.active = false; this.clearScheduler(); this.timers.clearTimeout(this.stopTimer);
    for (const scene of [...this.scenes]) this.disposeScene(scene);
    if (this.context) { this.context.onstatechange = null; disconnect([this.master,this.highpass,this.limiter]); if (this.context.state !== 'closed') await this.context.close(); }
    this.context = null; this.impulse = this.noise = null;
  }
}
