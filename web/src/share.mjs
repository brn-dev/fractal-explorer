import { validate } from './decimal.mjs';
import { fractalParameters } from './fractals.mjs';
import { validateAutomation } from './animation.mjs';
import { paletteSelection } from './palettes.mjs';

export const MAX_SHARE_BYTES = 128 * 1024;
const MAX_TOKEN_LENGTH = 180000;
const publishedURL = 'https://brn-dev.github.io/fractal-explorer/';
const encoder = new TextEncoder();

function number(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
  return value;
}
function boolean(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${name}.`);
  return value;
}
export function sharedState(data, paletteCount) {
  if (!data || data.version !== 1) throw new Error('Unsupported share-link version.');
  const validated = validate(data.view ?? {});
  const keys = ['fractal', 'x', 'y', 'span', 'iterations', 'bailout', 'julia_x', 'julia_y', ...fractalParameters(validated).map(p => p.key)];
  if (validated.fractal === 'custom') keys.push('custom_formula', 'custom_mode');
  if (validated.fractal === 'custom' && validated.custom_mode === 'advanced') keys.push('custom_inputs');
  if (validated.fractal === 'custom' && validated.custom_constant_count) keys.push('custom_constant_count');
  const view = Object.fromEntries(keys.map(key => [key, validated[key]]));
  return {
    version: 1, view, automation: validateAutomation(view, data.automation ?? {}), ...paletteSelection(data, paletteCount),
    density: number(data.density ?? 1, .2, 4, 'color density'),
    phase: number(data.phase ?? 0, 0, 1, 'color phase'),
    wanderingSpeed: number(data.wanderingSpeed ?? .12, .05, 2, 'wandering speed'),
    wander: boolean(data.wander, false, 'color animation'),
    vignetteEnabled: boolean(data.vignetteEnabled, true, 'vignette'),
    paused: boolean(data.paused, false, 'animation playback'),
  };
}

export function shareBaseURL(current, configured) {
  const url = new URL(current);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  const base = new URL(configured || (local ? publishedURL : new URL('.', url).href));
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Share links require a website URL.');
  base.username = ''; base.password = ''; base.search = ''; base.hash = '';
  return base.href;
}
function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unbase64url(value) {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
async function unpack(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open compressed share links.');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SHARE_BYTES) { await reader.cancel(); throw new Error('Shared settings are too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export async function createShareURL(base, state, paletteCount, { compress = true } = {}) {
  let bytes = encoder.encode(JSON.stringify(sharedState({ ...state, version: 1 }, paletteCount))), tag = 'j1';
  if (bytes.length > MAX_SHARE_BYTES) throw new Error('Shared settings are too large.');
  if (compress && typeof CompressionStream === 'function') {
    try {
      const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      if (packed.length < bytes.length) { bytes = packed; tag = 'g1'; }
    } catch { /* Uncompressed links work when compression is unavailable. */ }
  }
  const url = new URL(base); url.search = ''; url.hash = `s=${tag}.${base64url(bytes)}`;
  return url.href;
}
export async function readShareURL(address, paletteCount) {
  const params = new URLSearchParams(new URL(address).hash.slice(1));
  if (!params.has('s')) return null;
  try {
    const token = params.get('s');
    if (params.getAll('s').length !== 1 || token.length > MAX_TOKEN_LENGTH || !/^[gj]1\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid or incomplete share link.');
    let bytes = unbase64url(token.slice(3));
    if (bytes.length > MAX_SHARE_BYTES) throw new Error('Shared settings are too large.');
    if (token.startsWith('g1.')) bytes = await unpack(bytes);
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return sharedState(data, paletteCount);
  } catch (error) { throw new Error(`Could not open this share link: ${error.message}`); }
}
