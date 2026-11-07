export const nativeBridge = () => globalThis.FractalNative?.info ? globalThis.FractalNative : null;
export function nativeCall(method, ...args) {
  const bridge = nativeBridge();
  if (!bridge || typeof bridge[method] !== 'function') throw new Error('This action needs the Fractal Explorer Android app.');
  const result = JSON.parse(bridge[method](...args));
  if (!result.ok) throw new Error(result.error || 'The Android operation failed.');
  return result;
}
export const hasNativeVideo = () => !!nativeBridge();
export async function nativeVideoEncoder(canvas, options) {
  const { id } = nativeCall('beginVideo', JSON.stringify({ slot: options.nativeTarget ?? null, width: options.width, height: options.height, fps: options.fps, bitrate: options.bitrate, quantizer: options.quantizer ?? null }));
  let done = false;
  return {
    add: async index => { nativeCall('appendVideo', id, canvas.toDataURL('image/png').split(',')[1], index); },
    finish: async () => { const file = nativeCall('finishVideo', id); done = true; return { nativeFile: file.id, size: file.size, type: 'video/mp4' }; },
    cancel: async () => { if (!done) { nativeCall('cancelVideo', id); done = true; } },
  };
}
export async function nativeDownload(blob, name) {
  if (blob.nativeFile) { nativeCall('saveNativeFile', blob.nativeFile, name); return; }
  const { id } = nativeCall('beginDownload', name, blob.type || 'application/octet-stream');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    for (let offset = 0; offset < bytes.length; offset += 48 * 1024) {
      let text = ''; for (const byte of bytes.subarray(offset, offset + 48 * 1024)) text += String.fromCharCode(byte);
      nativeCall('appendDownload', id, btoa(text));
    }
    nativeCall('saveNativeFile', id, name);
  } catch (error) { nativeCall('cancelDownload', id); throw error; }
}
