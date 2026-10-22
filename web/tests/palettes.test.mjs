import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCustomPalette, customPaletteDefinition, paletteSelection, MAX_PALETTE_COLORS } from '../src/palettes.mjs';
import { createShareURL, readShareURL } from '../src/share.mjs';

const custom = { name: '  Twilight  ', colors: ['#2233AA', '#FFCC88', '#221133'], loop: true };
const normalized = { name: 'Twilight', colors: ['#2233aa', '#ffcc88', '#221133'], loop: true };

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
  assert.deepEqual(palettes.slice(0, 6).map(p => p.name), ['Ember & ice', 'Lunar moss', 'Electric dusk', 'Solar flare', 'Oceanic', 'Monochrome']);
  assert.equal(palettes.length, 12);
  assert.equal(new Set(palettes.map(p => p.name)).size, palettes.length);
  for (const preset of palettes) {
    assert.ok(preset.colors.length >= 2);
    for (const color of preset.colors) assert.match(color, /^#[0-9a-f]{6}$/);
  }
});
