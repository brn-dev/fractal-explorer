import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCustomPalette, customPaletteDefinition, paletteSelection, MAX_PALETTE_COLORS, validateInteriorColor, interiorColorRGB } from '../src/palettes.mjs';
import { createShareURL, readShareURL } from '../src/share.mjs';

const custom = { name: '  Twilight  ', colors: ['#2233AA', '#FFCC88', '#221133'], loop: true };
const normalized = { name: 'Twilight', colors: ['#2233aa', '#ffcc88', '#221133'], loop: true };

test('interior colors keep the legacy default and accept black and normalized RGB colors', () => {
  assert.equal(validateInteriorColor(), '#081112');
  assert.deepEqual(interiorColorRGB(), [8, 17, 18]);
  assert.deepEqual(interiorColorRGB('#000000'), [0, 0, 0]);
  assert.equal(validateInteriorColor('#12ABEF'), '#12abef');
  assert.deepEqual(interiorColorRGB('#12ABEF'), [18, 171, 239]);
  for (const bad of [null, '', '#123', '#12345678', 'red', 0, {}, '#zzzzzz'])
    assert.throws(() => validateInteriorColor(bad), /interior color/);
});

test('custom palettes normalize safely and preserve an independent editable color list', () => {
  const result = validateCustomPalette(custom);
  assert.deepEqual(result, normalized);
  result.colors[0] = '#000000';
  assert.equal(custom.colors[0], '#2233AA');
  assert.equal(validateCustomPalette({ name: ' ', colors: ['#000000', '#ffffff'] }).name, 'My palette');
  assert.equal(validateCustomPalette({ ...custom, loop: undefined }).loop, true);
});

test('smooth loops return to the first color without changing or duplicating editable stops', () => {
  const closed = customPaletteDefinition(custom);
  assert.deepEqual(closed.colors, [...normalized.colors, normalized.colors[0]]);
  assert.equal(custom.colors.length, 3);
  assert.deepEqual(customPaletteDefinition({ ...custom, loop: false }).colors, normalized.colors);
  assert.deepEqual(customPaletteDefinition({ ...custom, colors: ['#000000', '#ffffff', '#000000'] }).colors,
    ['#000000', '#ffffff', '#000000']);
});

test('invalid palettes are rejected before reaching the renderer or persistence', () => {
  for (const data of [null, {}, { ...custom, name: 'x'.repeat(41) }, { ...custom, name: 3 },
    { ...custom, colors: [] }, { ...custom, colors: ['#000000'] },
    { ...custom, colors: Array(MAX_PALETTE_COLORS + 1).fill('#000000') },
    ...['red', '#abc', '#12345g', '#ffffff00', 'url(https://example.com)', null].map(color => ({ ...custom, colors: [color, '#ffffff'] })),
    { ...custom, loop: 'yes' }]) assert.throws(() => validateCustomPalette(data));
  assert.equal(validateCustomPalette({ ...custom, colors: Array(MAX_PALETTE_COLORS).fill('#000000') }).colors.length, MAX_PALETTE_COLORS);
});

test('location palette selections keep numeric compatibility and custom definitions remain portable', () => {
  assert.deepEqual(paletteSelection({}, 12), { palette: 0 });
  for (let palette = 0; palette < 12; palette++) assert.deepEqual(paletteSelection({ palette }, 12), { palette });
  assert.deepEqual(paletteSelection({ palette: 'custom', customPalette: custom }, 12), { palette: 'custom', customPalette: normalized });
  for (const palette of [-1, 12, .5, '3', NaN]) assert.throws(() => paletteSelection({ palette }, 12));
  assert.throws(() => paletteSelection({ palette: 'custom' }, 12));
});

test('custom palette share links round-trip independently of the number of built-in palettes', async () => {
  const source = { palette: 'custom', customPalette: custom, density: 2.3, phase: .75,
    view: { fractal: 'mandelbrot', x: '-.5', y: '0', span: '3.6', iterations: 800, bailout: 64, julia_x: '-.8', julia_y: '.156' } };
  for (const compress of [true, false]) {
    const link = await createShareURL('https://example.com/', source, 12, { compress });
    const restored = await readShareURL(link, 20);
    assert.equal(restored.palette, 'custom'); assert.deepEqual(restored.customPalette, normalized);
    assert.equal(restored.density, source.density); assert.equal(restored.phase, source.phase);
    assert.deepEqual(paletteSelection(JSON.parse(JSON.stringify(restored)), 12), { palette: 'custom', customPalette: normalized });
  }
  await assert.rejects(createShareURL('https://example.com/', { ...source, customPalette: undefined }, 12), /palette/);
});

test('the expanded preset list preserves original palette indices and all colors can render', async () => {
  const palettes = JSON.parse(await readFile(new URL('../public/palettes.json', import.meta.url)));
  assert.deepEqual(palettes.slice(0, 12).map(p => p.name), ['Ember & ice', 'Lunar moss', 'Electric dusk', 'Solar flare', 'Oceanic', 'Monochrome', 'Aurora', 'Candy nebula', 'Abyssal glow', 'Desert bloom', 'Rose quartz', 'Prism']);
  assert.equal(palettes.length, 25);
  assert.equal(new Set(palettes.map(p => p.name)).size, palettes.length);
  for (const preset of palettes) {
    assert.ok(preset.colors.length >= 2);
    for (const color of preset.colors) assert.match(color, /^#[0-9a-f]{6}$/);
  }
});

test('Midnight stars is mostly near black with four separated colored highlights and a closed loop', async () => {
  const palettes = JSON.parse(await readFile(new URL('../public/palettes.json', import.meta.url)));
  const preset = palettes.find(p=>p.name==='Midnight stars · sparse');
  assert.equal(preset.name, 'Midnight stars · sparse');
  assert.equal(preset.colors.length, 65);
  const bright = preset.colors.map((hex,index) => ({ index, rgb:hex.slice(1).match(/../g).map(v=>parseInt(v,16)) })).filter(p=>Math.max(...p.rgb)>32);
  assert.deepEqual(bright.map(p=>p.index), [8,24,40,56]);
  assert.equal(new Set(bright.map(p=>p.rgb.join(','))).size,4);
  assert.equal(preset.colors[0],preset.colors.at(-1));
  const editable=validateCustomPalette({name:preset.name,colors:preset.colors.slice(0,-1),loop:true});
  assert.deepEqual(customPaletteDefinition(editable),preset,'editing preserves exact accent spacing');
});

test('natural night-sky options use restrained star colors and a quieter faint variant', async () => {
  const palettes=JSON.parse(await readFile(new URL('../public/palettes.json',import.meta.url)));
  const variants=palettes.filter(p=>p.name.startsWith('Night sky · '));
  assert.deepEqual(variants.map(p=>p.name),['Night sky · silver','Night sky · cool','Night sky · warm','Night sky · faint']);
  for(const preset of variants) {
    assert.equal(preset.colors.length,65);assert.equal(preset.colors[0],preset.colors.at(-1));
    const highlights=preset.colors.map(hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16))).filter(rgb=>Math.max(...rgb)>32);
    assert.equal(highlights.length,preset.name.endsWith('faint')?2:4);
    for(const rgb of highlights)assert.ok(Math.max(...rgb)-Math.min(...rgb)<=36,'stars have only faint color tints');
    assert.ok(highlights.every(rgb=>Math.max(...rgb)<=(preset.name.endsWith('faint')?174:213)));
    assert.deepEqual(customPaletteDefinition({name:preset.name,colors:preset.colors.slice(0,-1),loop:true}),preset);
  }
});
