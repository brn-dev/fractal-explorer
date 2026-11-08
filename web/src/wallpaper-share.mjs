import { wallpaperPlan, wallpaperJSON, wallpaperScreenDraft } from './wallpaper.mjs';

// Keep links practical for copy/share apps. Bigger designs always have a JSON-file path.
export const MAX_WALLPAPER_LINK_LENGTH = 12000;
export const MAX_WALLPAPER_LINK_BYTES = 128 * 1024;
const encoder = new TextEncoder();

export function wallpaperHandoff(draft) {
  if (!['cover', 'inner'].includes(draft?.screen)) throw new Error('Choose cover or main screen before sending a design to your PC.');
  const next = wallpaperScreenDraft(draft, draft.screen);
  wallpaperPlan(next); // Exact dimensions come from a device preset or a saved phone display.
  wallpaperJSON(next);
  return next;
}

function encode64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function createWallpaperURL(base, draft, { compress = true } = {}) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A wallpaper link needs a website URL.');
  if (encoder.encode(wallpaperJSON(draft)).length > MAX_WALLPAPER_LINK_BYTES) throw new Error('This design is too large for a reliable link. Use Download PC draft instead.');
  let bytes = encoder.encode(wallpaperJSON(wallpaperHandoff(draft))), tag = 'j1';
  if (compress && typeof CompressionStream === 'function') {
    try {
      const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      if (packed.length < bytes.length) { bytes = packed; tag = 'g1'; }
    } catch { /* A small uncompressed design is still portable. */ }
  }
  url.username = ''; url.password = ''; url.search = ''; url.hash = `w=${tag}.${encode64(bytes)}`;
  if (url.href.length > MAX_WALLPAPER_LINK_LENGTH) throw new Error('This design is too large for a reliable link. Use Download PC draft instead.');
  return url.href;
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open compressed wallpaper links. Use a draft file instead.');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_WALLPAPER_LINK_BYTES) { await reader.cancel(); throw new Error('Wallpaper link data exceeds 128 KiB. Use a draft file instead.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function readWallpaperURL(address) {
  const url = new URL(address), params = new URLSearchParams(url.hash.slice(1));
  if (!params.has('w')) return null;
  try {
    const token = params.get('w');
    if (url.href.length > MAX_WALLPAPER_LINK_LENGTH || params.getAll('w').length !== 1 || params.has('s') || !/^[gj]1\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid or incomplete wallpaper link.');
    const binary = atob(token.slice(3).replaceAll('-', '+').replaceAll('_', '/'));
    let bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    if (token.startsWith('g1.')) bytes = await inflate(bytes);
    if (bytes.length > MAX_WALLPAPER_LINK_BYTES) throw new Error('Wallpaper link data exceeds 128 KiB. Use a draft file instead.');
    return wallpaperHandoff(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) { throw new Error(`Could not open this wallpaper link: ${error.message}`); }
}
