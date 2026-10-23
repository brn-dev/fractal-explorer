// Loaded only when the export dialog needs MP4 support. No backend or recording
// in real time: timestamps are explicit, so slow fractal frames are never lost.
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality, canEncodeVideo, canEncodeAudio } from 'mediabunny';
import { SOUNDSCAPE_SAMPLE_RATE } from './audio/export-audio.mjs';

const audioEncoding = { codec: 'aac', quality: new Quality({ bitrate: 256000 }) };
let audioSupport;
export function supportsMP4Audio() {
  return audioSupport ??= (async () => {
    const options = { numberOfChannels: 2, sampleRate: SOUNDSCAPE_SAMPLE_RATE, quality: audioEncoding.quality };
    if (await canEncodeAudio('aac', options)) return true;
    // The bundled worker keeps MP4 audio available in browsers without native
    // AAC encoding, and works offline without a server or a separate download.
    try {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      return await canEncodeAudio('aac', options);
    } catch { return false; }
  })();
}

function encodingOptions(options) {
  return {
    codec: 'avc', latencyMode: 'quality', contentHint: 'detail',
    // Maximum must use the requested quantizer: no silent bitrate fallback.
    quality: new Quality(options.quantizer != null ? { quantizer: options.quantizer } : { bitrate: options.bitrate }),
  };
}
export async function supportsMP4(options) {
  if (typeof VideoEncoder === 'undefined') return false;
  const { codec, ...encoding } = encodingOptions(options);
  return canEncodeVideo(codec, { width: options.width, height: options.height, frameRate: options.fps, ...encoding });
}
export async function mp4Encoder(canvas, options) {
  if (!await supportsMP4(options)) throw new Error('MP4 / H.264 encoding is unavailable at these settings in this browser. Choose a lower quality, a smaller size, or GIF.');
  if (options.includeSoundscape && !await supportsMP4Audio()) throw new Error('MP4 soundscape encoding is unavailable in this browser. Turn off Include soundscape.');
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new CanvasSource(canvas, { ...encodingOptions(options), keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: options.fps });
  const audio = options.includeSoundscape ? new AudioBufferSource(audioEncoding) : null;
  if (audio) output.addAudioTrack(audio);
  try { await output.start(); } catch (error) { await output.cancel(); throw error; }
  return {
    add: index => source.add(index / options.fps, 1 / options.fps),
    finish: async audioBuffer => {
      source.close();
      if (audio) {
        if (!audioBuffer) throw new Error('The soundscape has not finished rendering.');
        await audio.add(audioBuffer); audio.close();
      }
      await output.finalize(); return new Blob([target.buffer], { type: 'video/mp4' });
    },
    cancel: () => output.cancel(),
  };
}
