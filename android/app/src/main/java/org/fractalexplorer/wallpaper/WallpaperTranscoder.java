package org.fractalexplorer.wallpaper;

import android.graphics.SurfaceTexture;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.view.Surface;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import org.json.JSONObject;

/** Offline, timestamp-preserving surface decode -> correction shader -> hardware encoder. */
final class WallpaperTranscoder {
  interface Progress {
    void update(double fraction);

    void check();
  }

  static JSONObject convert(
      File source,
      File destination,
      JSONObject expected,
      WallpaperColorGrade grade,
      String quality,
      double bitrateMbps,
      Progress progress)
      throws Exception {
    MediaExtractor extractor = new MediaExtractor();
    MediaCodec decoder = null;
    NativeVideoEncoder encoder = null;
    Input input = null;
    try {
      extractor.setDataSource(source.getAbsolutePath());
      MediaFormat format = null;
      String mime = null;
      for (int i = 0; i < extractor.getTrackCount(); i++) {
        MediaFormat candidate = extractor.getTrackFormat(i);
        String type = candidate.getString(MediaFormat.KEY_MIME);
        if (type != null && type.startsWith("video/")) {
          if (format != null) throw new IOException("Baking needs a single video track");
          format = candidate;
          mime = type;
          extractor.selectTrack(i);
        }
      }
      if (format == null) throw new IOException("Wallpaper has no video track");
      if (format.containsKey(MediaFormat.KEY_ROTATION)
          && format.getInteger(MediaFormat.KEY_ROTATION) != 0)
        throw new IOException(
            "Rotated imported videos support live correction; baking requires an unrotated video");
      if (format.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) {
        int transfer = format.getInteger(MediaFormat.KEY_COLOR_TRANSFER);
        if (transfer == MediaFormat.COLOR_TRANSFER_ST2084
            || transfer == MediaFormat.COLOR_TRANSFER_HLG)
          throw new IOException(
              "HDR videos support playback; baking corrections requires an SDR video");
      }
      int width = expected.getInt("width"), height = expected.getInt("height");
      double nominal = expected.optDouble("fps", 30);
      if (format.containsKey(MediaFormat.KEY_FRAME_RATE)) {
        try {
          nominal = format.getInteger(MediaFormat.KEY_FRAME_RATE);
        } catch (ClassCastException e) {
          nominal = format.getFloat(MediaFormat.KEY_FRAME_RATE);
        }
      }
      int fps = (int) Math.round(nominal);
      if (fps < 1 || fps > 60) throw new IOException("Baking supports 1–60 fps");
      int bitrate;
      Integer quantizer;
      if ("custom".equals(quality)) {
        bitrate = (int) Math.round(bitrateMbps * 1000000);
        quantizer = null;
      } else if ("maximum".equals(quality)) {
        bitrate = 500000;
        quantizer = 0;
      } else {
        boolean balanced = "dynamic-balanced".equals(quality);
        bitrate =
            (int)
                Math.min(
                    balanced ? 35000000 : 60000000,
                    Math.max(
                        500000,
                        Math.round((double) width * height * fps * (balanced ? .10 : .18))));
        quantizer = balanced ? 26 : 22;
      }
      NativeVideoEncoder.Selection selection =
          NativeVideoEncoder.select(width, height, fps, bitrate, quantizer);
      encoder = new NativeVideoEncoder(destination, selection);
      encoder.setDecodedGrade(grade);
      input = new Input();
      decoder = MediaCodec.createDecoderByType(mime);
      format.setInteger("allow-frame-drop", 0);
      decoder.configure(format, input.surface, null, 0);
      decoder.start();
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      boolean inputDone = false, outputDone = false;
      int fed = 0, drawn = 0;
      long firstTime = -1, lastProgress = SystemClock.elapsedRealtime();
      double duration = expected.optDouble("duration", 60) * 1000000;
      while (!outputDone) {
        progress.check();
        if (!inputDone) {
          int index = decoder.dequeueInputBuffer(10000);
          if (index >= 0) {
            ByteBuffer buffer = decoder.getInputBuffer(index);
            if (buffer == null) throw new IOException("Decoder input unavailable");
            int size = extractor.readSampleData(buffer, 0);
            if (size < 0) {
              decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
              inputDone = true;
            } else {
              long pts = extractor.getSampleTime();
              decoder.queueInputBuffer(index, 0, size, pts, 0);
              extractor.advance();
              fed++;
              if (fed > 7200) throw new IOException("Too many wallpaper frames");
            }
            lastProgress = SystemClock.elapsedRealtime();
          }
        }
        int index = decoder.dequeueOutputBuffer(info, 10000);
        if (index >= 0) {
          boolean render = info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0;
          long stamp = input.stamp();
          decoder.releaseOutputBuffer(index, render);
          if (render) {
            input.await(stamp, progress);
            input.texture.updateTexImage();
            input.texture.getTransformMatrix(input.matrix);
            if (firstTime < 0) firstTime = info.presentationTimeUs;
            encoder.addDecoded(input.id, input.matrix, info.presentationTimeUs - firstTime);
            drawn++;
            progress.update(
                Math.max(0, Math.min(1, (info.presentationTimeUs - firstTime) / duration)));
          }
          outputDone = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
          lastProgress = SystemClock.elapsedRealtime();
        } else if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED)
          lastProgress = SystemClock.elapsedRealtime();
        if (SystemClock.elapsedRealtime() - lastProgress > 30000)
          throw new IOException("Video decoder stalled");
      }
      if (drawn != fed || drawn < 2)
        throw new IOException(
            "Decoder did not preserve every video frame (" + drawn + " / " + fed + ")");
      decoder.stop();
      decoder.release();
      decoder = null;
      input.close();
      input = null;
      progress.check();
      encoder.finish();
      return new JSONObject(expected.toString())
          .put("frames", drawn)
          .put("fps", nominal)
          .put("quality", quality)
          .put("qualityMode", encoder.qualityMode)
          .put("bitrate", encoder.targetBitrate)
          .put("quantizer", quantizer == null ? JSONObject.NULL : quantizer);
    } finally {
      if (decoder != null) {
        try {
          decoder.stop();
        } catch (RuntimeException ignored) {
        }
        try {
          decoder.release();
        } catch (RuntimeException ignored) {
        }
      }
      try {
        if (input != null) input.close();
      } finally {
        try {
          if (encoder != null) encoder.close();
        } finally {
          extractor.release();
        }
      }
    }
  }

  private static final class Input {
    final HandlerThread callbacks = new HandlerThread("Corrected video frames");
    final int id;
    final SurfaceTexture texture;
    final Surface surface;
    final float[] matrix = new float[16];
    private long frames;
    private boolean closed;

    Input() {
      int[] ids = new int[1];
      GLES20.glGenTextures(1, ids, 0);
      id = ids[0];
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, id);
      GLES20.glTexParameteri(
          GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
      GLES20.glTexParameteri(
          GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
      GLES20.glTexParameteri(
          GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
      GLES20.glTexParameteri(
          GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
      SurfaceTexture createdTexture = null;
      Surface createdSurface = null;
      try {
        createdTexture = new SurfaceTexture(id);
        createdSurface = new Surface(createdTexture);
        callbacks.start();
        createdTexture.setOnFrameAvailableListener(
            t -> {
              synchronized (this) {
                frames++;
                notifyAll();
              }
            },
            new Handler(callbacks.getLooper()));
        texture = createdTexture;
        surface = createdSurface;
      } catch (RuntimeException e) {
        if (createdSurface != null) createdSurface.release();
        if (createdTexture != null) createdTexture.release();
        GLES20.glDeleteTextures(1, new int[] {id}, 0);
        callbacks.quitSafely();
        throw e;
      }
    }

    synchronized long stamp() {
      return frames;
    }

    synchronized void await(long before, Progress progress) throws Exception {
      long deadline = SystemClock.elapsedRealtime() + 10000;
      while (frames == before) {
        progress.check();
        if (SystemClock.elapsedRealtime() > deadline)
          throw new IOException("Decoded frame did not reach the correction surface");
        wait(100);
      }
    }

    void close() {
      if (closed) return;
      closed = true;
      try {
        texture.setOnFrameAvailableListener(null);
      } catch (RuntimeException ignored) {
      }
      try {
        surface.release();
      } catch (RuntimeException ignored) {
      }
      try {
        texture.release();
      } catch (RuntimeException ignored) {
      }
      GLES20.glDeleteTextures(1, new int[] {id}, 0);
      callbacks.quitSafely();
    }
  }
}
