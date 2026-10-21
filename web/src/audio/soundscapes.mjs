// Musical decisions live here, independent of Web Audio and the render clock.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ state >>> 15, 1 | state);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
export const soundscapes = [
  { id: 'celestial', name: 'Celestial Choir', root: 48, chords: [[0,7,14,16],[0,5,12,19],[0,7,11,14]], change: [48,76], timbre: 'choir', foundation: [0,7], harmony: 3, interval: [13,21], duration: [22,34], attack: 6, events: [17,29], eventVoice: 'choir', register: 12, texture: .008, cutoff: 1900, wet: .46, delay: .62, feedback: .18, width: .55 },
  { id: 'void', name: 'Deep Void', root: 33, chords: [[0,7,12,19]], change: [100,160], timbre: 'dark', foundation: [0,12], harmony: 1, interval: [24,39], duration: [32,48], attack: 9, events: [29,49], eventVoice: 'bell', register: 24, texture: .013, cutoff: 520, wet: .56, delay: .93, feedback: .26, width: .8 },
  { id: 'glass', name: 'Glass Constellations', root: 57, chords: [[0,2,7,9],[0,5,7,14]], change: [64,100], timbre: 'glass', foundation: [0], harmony: 0, interval: [21,36], duration: [12,20], attack: 2, events: [5,12], eventVoice: 'glass', register: 24, texture: 0, cutoff: 5200, wet: .64, delay: .79, feedback: .3, width: .95 },
  { id: 'tides', name: 'Harmonic Tides', root: 45, chords: [[0,7,12,16],[2,9,14,17],[5,12,16,19],[0,7,14,16]], change: [37,57], timbre: 'pad', foundation: [0], harmony: 3, interval: [11,18], duration: [26,38], attack: 10, events: [22,37], eventVoice: 'pad', register: 12, texture: .009, cutoff: 2400, wet: .4, delay: .71, feedback: .2, width: .7 },
  { id: 'glacial', name: 'Glacial Light', root: 60, chords: [[0,6,7,14,21]], change: [95,140], timbre: 'air', foundation: [0], harmony: 2, interval: [19,32], duration: [28,44], attack: 8, events: [16,30], eventVoice: 'glass', register: 12, texture: .018, cutoff: 4300, wet: .59, delay: .47, feedback: .15, width: .9 },
  { id: 'cathedral', name: 'Infinite Cathedral', root: 41, chords: [[0,7,12,15,22],[0,5,12,19,26],[0,7,12,17,22]], change: [68,105], timbre: 'organ', foundation: [0,12], harmony: 4, interval: [22,32], duration: [38,50], attack: 9, events: [32,53], eventVoice: 'choir', register: 12, texture: 0, cutoff: 2800, wet: .68, delay: .86, feedback: .16, width: .6 },
  { id: 'dust', name: 'Quantum Dust', root: 55, chords: [[0,2,7,10,14],[0,5,7,14,17]], change: [51,83], timbre: 'air', foundation: [0], harmony: 1, interval: [22,34], duration: [18,29], attack: 5, events: [1.8,5.2], eventVoice: 'grain', register: 24, texture: .024, cutoff: 3800, wet: .48, delay: .37, feedback: .33, width: 1 },
  { id: 'orbit', name: 'Slow Orbit', root: 50, chords: [[0,7,12,14],[0,5,12,14],[0,7,9,16]], change: [49,78], timbre: 'pad', foundation: [0], harmony: 2, interval: [17,26], duration: [24,36], attack: 7, events: [4,8], eventVoice: 'round', register: 12, texture: 0, cutoff: 1700, wet: .4, delay: .67, feedback: .35, width: .95 },
];
export const resonance = { ...soundscapes[0], id: 'resonance', name: 'Fractal Resonance', root: 43, chords: [[0,7,12,14,19],[0,5,12,14,21]], timbre: 'pad', harmony: 2, events: [18,32], eventVoice: 'bell', texture: .013, cutoff: 1700, wet: .56 };
export function validateSoundscapes(definitions = [...soundscapes, resonance]) {
  const ids = new Set();
  const timbres = ['choir','dark','bell','glass','pad','air','organ','grain','round'];
  for (const d of definitions) {
    if (!d.id || ids.has(d.id) || !d.name || !Number.isInteger(d.root) || d.root < 24 || d.root > 72) throw new Error('Invalid soundscape identity or root');
    ids.add(d.id);
    if (!d.chords?.length || d.chords.some(c => !c.length || c.some(n => !Number.isInteger(n) || n < 0 || n > 36))) throw new Error('Invalid harmony');
    for (const key of ['change','interval','duration','events']) if (d[key]?.length !== 2 || !d[key].every(Number.isFinite) || d[key][0] <= 0 || d[key][1] < d[key][0]) throw new Error(`Invalid ${key}`);
    if (!timbres.includes(d.timbre) || !timbres.includes(d.eventVoice) || !d.foundation?.length || d.foundation.some(n => !Number.isFinite(n)) || !Number.isInteger(d.harmony) || d.harmony < 0 || d.harmony > 4) throw new Error('Invalid layers');
    for (const key of ['wet','feedback','width','texture']) if (!Number.isFinite(d[key]) || d[key] < 0 || d[key] > (key === 'feedback' ? .5 : 1)) throw new Error(`Invalid ${key}`);
    if (!(d.attack > 0 && d.attack < d.duration[0] && d.cutoff >= 200 && d.cutoff <= 8000 && d.delay > 0 && d.delay < 2 && Number.isFinite(d.register))) throw new Error('Invalid timbre');
  }
  return true;
}
export function chooseSoundscape(previous, random = Math.random, definitions = soundscapes) {
  const choices = definitions.filter(d => d.id !== previous);
  const pool = choices.length ? choices : definitions;
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].id : null;
}
export const getSoundscape = id => id === resonance.id ? resonance : soundscapes.find(d => d.id === id) ?? soundscapes[0];

// Each layer has its own clock. All random draws are deterministic in timeline
// order; render frames never advance this state in generative mode.
export class MusicalTimeline {
  constructor(definition, seed) {
    this.definition = definition; this.random = seededRandom(seed); this.chord = 0;
    this.next = { foundation: 0, harmony: 2, event: 6, texture: 0 };
    this.changeAt = this.range(definition.change); this.step = 0;
    this.motif = [0, 1, 2, 1, 3, 2];
  }
  range([a,b]) { return a + (b - a) * this.random(); }
  until(time) {
    const d = this.definition, events = [];
    while (Math.min(...Object.values(this.next), this.changeAt) <= time) {
      const at = Math.min(...Object.values(this.next), this.changeAt);
      if (at === this.changeAt) {
        this.chord = (this.chord + 1) % d.chords.length;
        this.changeAt += this.range(d.change);
        // Occasional small motif mutations preserve recognizable relationships.
        this.motif[Math.floor(this.random() * this.motif.length)] = Math.floor(this.random() * 4);
        continue;
      }
      const layer = Object.keys(this.next).find(k => this.next[k] === at), chord = d.chords[this.chord];
      const common = { at, layer, pan: (this.random() * 2 - 1) * d.width, drift: this.range([-.16,.16]), detune: this.range([2,6]) };
      if (layer === 'foundation') {
        for (const pitch of d.foundation) events.push({ ...common, midi: d.root + pitch - 12, timbre: 'dark', duration: 36, attack: 7, level: .046 });
        this.next[layer] += 27;
      } else if (layer === 'harmony') {
        for (let i = 0; i < d.harmony; i++) events.push({ ...common, at: at + i * .7, midi: d.root + chord[(i + this.step) % chord.length], timbre: d.timbre, duration: this.range(d.duration), attack: d.attack, level: .026 / Math.sqrt(Math.max(1,d.harmony)), upper: i > 0 });
        this.next[layer] += this.range(d.interval);
      } else if (layer === 'texture') {
        if (d.texture) events.push({ ...common, midi: d.root + 24, timbre: 'noise', duration: 32, attack: 10, level: d.texture });
        this.next[layer] += 25;
      } else {
        const index = this.motif[this.step++ % this.motif.length] % chord.length;
        events.push({ ...common, midi: d.root + chord[index] + d.register, timbre: d.eventVoice, duration: d.eventVoice === 'grain' ? this.range([1.2,3.8]) : this.range([9,17]), attack: d.eventVoice === 'glass' || d.eventVoice === 'bell' ? .06 : 1.2, level: d.eventVoice === 'grain' ? .012 : .025, upper: true });
        this.next[layer] += this.range(d.events);
      }
    }
    return events.sort((a,b) => a.at - b.at);
  }
}
