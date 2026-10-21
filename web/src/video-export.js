// Loaded only when the export dialog needs MP4 support. No backend or recording
// in real time: timestamps are explicit, so slow fractal frames are never lost.
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality, canEncodeVideo } from 'mediabunny';

export async function supportsMP4(options) {
  if (typeof VideoEncoder === 'undefined') return false;
  return canEncodeVideo('avc', { width: options.width, height: options.height, frameRate: options.fps, quality: new Quality({ bitrate: options.bitrate }) });
}
export async function mp4Encoder(canvas, options) {
  if (!await supportsMP4(options)) throw new Error('MP4 / H.264 encoding is unavailable at these settings in this browser. Choose GIF or a smaller size.');
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: options.bitrate }), keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: options.fps });
  try { await output.start(); } catch (error) { await output.cancel(); throw error; }
  return {
    add: index => source.add(index / options.fps, 1 / options.fps),
    finish: async () => { source.close(); await output.finalize(); return new Blob([target.buffer], { type: 'video/mp4' }); },
    cancel: () => output.cancel(),
  };
}
