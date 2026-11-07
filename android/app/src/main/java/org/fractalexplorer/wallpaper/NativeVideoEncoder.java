package org.fractalexplorer.wallpaper;

import android.graphics.Bitmap;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLExt;
import android.opengl.EGLSurface;
import android.opengl.GLES20;
import android.opengl.GLUtils;
import android.view.Surface;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/** Offline H.264 encoding with explicit timestamps; rendering speed never drops frames. */
final class NativeVideoEncoder {
  private MediaCodec codec;
  private MediaMuxer muxer;
  private Surface surface;
  private EGLDisplay display = EGL14.EGL_NO_DISPLAY;
  private EGLContext context = EGL14.EGL_NO_CONTEXT;
  private EGLSurface window = EGL14.EGL_NO_SURFACE;
  private int texture, program, track = -1, frames;
  private final int width, height, fps;
  final String qualityMode;
  final int targetBitrate;
  private boolean started, closed;
  private final FloatBuffer vertices = buffer(-1, -1, 1, -1, -1, 1, 1, 1);
  private final FloatBuffer uv = buffer(0, 1, 1, 1, 0, 0, 1, 0);
  private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

  static MediaFormat format(int width, int height, int fps, int bitrate) {
    if (width < 16
        || height < 16
        || width % 2 != 0
        || height % 2 != 0
        || Math.max(width, height) > 4096
        || (long) width * height > 16000000
        || fps < 1
        || fps > 60
        || bitrate < 500000
        || bitrate > 2000000000)
      throw new IllegalArgumentException(
          "Choose even dimensions up to 4096 px / 16 MP, 1–60 fps, and a supported bitrate");
    MediaFormat format = MediaFormat.createVideoFormat("video/avc", width, height);
    format.setInteger(
        MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
    format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate);
    format.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
    format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2);
    return format;
  }

  static String codecName(MediaFormat format) {
    String fallback = null;
    for (MediaCodecInfo candidate :
        new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
      if (!candidate.isEncoder()) continue;
      try {
        MediaCodecInfo.CodecCapabilities caps = candidate.getCapabilitiesForType("video/avc");
        if (!surfaceInput(caps)) continue;
        if (!caps.isFormatSupported(format)) continue;
        if (candidate.isHardwareAccelerated()) return candidate.getName();
        if (fallback == null) fallback = candidate.getName();
      } catch (IllegalArgumentException ignored) {
      }
    }
    return fallback;
  }

  static final class Selection {
    final String name, mode;
    final MediaFormat format;
    final int bitrate;

    Selection(String name, MediaFormat format, String mode, int bitrate) {
      this.name = name;
      this.format = format;
      this.mode = mode;
      this.bitrate = bitrate;
    }
  }

  private static boolean surfaceInput(MediaCodecInfo.CodecCapabilities caps) {
    for (int color : caps.colorFormats)
      if (color == MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface) return true;
    return false;
  }

  static Selection select(int width, int height, int fps, int bitrate, Integer quantizer) {
    if (quantizer != null && (quantizer < 0 || quantizer > 51))
      throw new IllegalArgumentException("Choose an H.264 quantizer from 0 to 51");
    boolean maximum = quantizer != null && quantizer == 0;
    format(width, height, fps, maximum ? 500000 : bitrate);
    MediaCodecInfo[] codecs = new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos();
    // Prefer constant quality. Moderate modes use their supplied VBR fallback;
    // Maximum retains its existing highest-quality / maximum-VBR behavior.
    for (int tier = quantizer == null ? 1 : 0; tier <= 1; tier++) {
      for (boolean hardware : new boolean[] {true, false})
        for (MediaCodecInfo candidate : codecs) {
          if (!candidate.isEncoder() || candidate.isHardwareAccelerated() != hardware) continue;
          try {
            MediaCodecInfo.CodecCapabilities caps = candidate.getCapabilitiesForType("video/avc");
            if (!surfaceInput(caps)) continue;
            MediaCodecInfo.EncoderCapabilities encoder = caps.getEncoderCapabilities();
            boolean cq = tier == 0;
            int mode =
                cq
                    ? MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CQ
                    : MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR;
            if (!encoder.isBitrateModeSupported(mode)) continue;
            int target =
                cq
                    ? 0
                    : !maximum
                        ? bitrate
                        : Math.min(
                            2000000000, caps.getVideoCapabilities().getBitrateRange().getUpper());
            MediaFormat configured = format(width, height, fps, cq ? 500000 : target);
            configured.setInteger(MediaFormat.KEY_BITRATE_MODE, mode);
            if (cq) {
              int lower = encoder.getQualityRange().getLower();
              int upper = encoder.getQualityRange().getUpper();
              if (!maximum && lower == upper) continue; // No moderate CQ level exists.
              int quality =
                  maximum
                      ? upper
                      : (int)
                          (upper
                              - Math.max(1L, Math.round(((long) upper - lower) * quantizer / 51d)));
              configured.removeKey(MediaFormat.KEY_BIT_RATE);
              configured.setInteger(MediaFormat.KEY_QUALITY, quality);
            }
            for (MediaCodecInfo.CodecProfileLevel profile : caps.profileLevels) {
              if (profile.profile == MediaCodecInfo.CodecProfileLevel.AVCProfileHigh) {
                configured.setInteger(
                    MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileHigh);
                break;
              }
            }
            if (!caps.isFormatSupported(configured)) {
              // A codec may expose its largest sizes/rates under another AVC
              // profile. Let it choose that profile without lowering our request.
              configured.removeKey(MediaFormat.KEY_PROFILE);
              if (!caps.isFormatSupported(configured)) continue;
            }
            return new Selection(
                candidate.getName(),
                configured,
                cq
                    ? maximum ? "maximum-cq" : "dynamic-cq"
                    : maximum ? "maximum-vbr" : quantizer == null ? "vbr" : "dynamic-vbr",
                target);
          } catch (IllegalArgumentException ignored) {
          }
        }
    }
    return null;
  }

  NativeVideoEncoder(File file, int width, int height, int fps, int bitrate) throws Exception {
    this(file, select(width, height, fps, bitrate, null));
  }

  NativeVideoEncoder(File file, Selection selection) throws Exception {
    if (selection == null)
      throw new IOException("This device cannot encode the requested resolution and quality");
    this.width = selection.format.getInteger(MediaFormat.KEY_WIDTH);
    this.height = selection.format.getInteger(MediaFormat.KEY_HEIGHT);
    this.fps = selection.format.getInteger(MediaFormat.KEY_FRAME_RATE);
    this.qualityMode = selection.mode;
    this.targetBitrate = selection.bitrate;
    try {
      codec = MediaCodec.createByCodecName(selection.name);
      codec.configure(selection.format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
      surface = codec.createInputSurface();
      codec.start();
      muxer = new MediaMuxer(file.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
      display = VideoRenderer.acquireDisplay();
      int[] attributes = {
        EGL14.EGL_RENDERABLE_TYPE,
        EGL14.EGL_OPENGL_ES2_BIT,
        EGL14.EGL_SURFACE_TYPE,
        EGL14.EGL_WINDOW_BIT,
        EGL14.EGL_RED_SIZE,
        8,
        EGL14.EGL_GREEN_SIZE,
        8,
        EGL14.EGL_BLUE_SIZE,
        8,
        0x3142,
        1,
        EGL14.EGL_NONE
      };
      EGLConfig[] configs = new EGLConfig[1];
      int[] count = new int[1];
      if (!EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, count, 0) || count[0] == 0)
        throw new IOException("No video encoder graphics configuration");
      context =
          EGL14.eglCreateContext(
              display,
              configs[0],
              EGL14.EGL_NO_CONTEXT,
              new int[] {EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE},
              0);
      window =
          EGL14.eglCreateWindowSurface(display, configs[0], surface, new int[] {EGL14.EGL_NONE}, 0);
      if (context == EGL14.EGL_NO_CONTEXT
          || window == EGL14.EGL_NO_SURFACE
          || !EGL14.eglMakeCurrent(display, window, window, context))
        throw new IOException("Cannot initialize video encoding surface");
      String precision = VideoRenderer.fragmentPrecision();
      if (!"highp".equals(precision) && Math.max(width, height) > 1024)
        throw new IOException("This GPU cannot preserve detail at this resolution. Choose 720 px.");
      int vertex =
          shader(
              GLES20.GL_VERTEX_SHADER,
              ("attribute vec2 p;attribute vec2 t;varying mediump vec2 uv;void"
                      + " main(){uv=t;gl_Position=vec4(p,0.,1.);}")
                  .replace("mediump", precision));
      int pixel =
          shader(
              GLES20.GL_FRAGMENT_SHADER,
              ("precision mediump float;varying mediump vec2 uv;uniform sampler2D image;void"
                      + " main(){gl_FragColor=texture2D(image,uv);}")
                  .replace("mediump", precision));
      program = GLES20.glCreateProgram();
      GLES20.glAttachShader(program, vertex);
      GLES20.glAttachShader(program, pixel);
      GLES20.glLinkProgram(program);
      GLES20.glDeleteShader(vertex);
      GLES20.glDeleteShader(pixel);
      int[] okay = new int[1];
      GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, okay, 0);
      if (okay[0] == 0) throw new IOException(GLES20.glGetProgramInfoLog(program));
      int[] names = new int[1];
      GLES20.glGenTextures(1, names, 0);
      texture = names[0];
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture);
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
      GLES20.glTexParameteri(
          GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
      GLES20.glTexParameteri(
          GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
    } catch (Exception error) {
      close();
      throw error;
    }
  }

  void add(Bitmap bitmap, int index) throws Exception {
    if (closed
        || index != frames
        || index >= fps * 120
        || bitmap.getWidth() != width
        || bitmap.getHeight() != height) throw new IOException("Invalid video frame sequence");
    drain(false);
    GLES20.glViewport(0, 0, width, height);
    GLES20.glUseProgram(program);
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture);
    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
    int p = GLES20.glGetAttribLocation(program, "p"), t = GLES20.glGetAttribLocation(program, "t");
    GLES20.glEnableVertexAttribArray(p);
    GLES20.glEnableVertexAttribArray(t);
    GLES20.glVertexAttribPointer(p, 2, GLES20.GL_FLOAT, false, 0, vertices);
    GLES20.glVertexAttribPointer(t, 2, GLES20.GL_FLOAT, false, 0, uv);
    GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "image"), 0);
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    EGLExt.eglPresentationTimeANDROID(display, window, index * 1000000000L / fps);
    if (!EGL14.eglSwapBuffers(display, window)) throw new IOException("Cannot submit video frame");
    frames++;
    drain(false);
  }

  void finish() throws Exception {
    if (closed || frames < 2) throw new IOException("The video has no animation frames");
    try {
      codec.signalEndOfInputStream();
      drain(true);
      if (!started) throw new IOException("The video encoder produced no track");
      // Finalization is part of success, unlike best-effort cancellation cleanup.
      // A failed stop must reach the caller rather than returning a corrupt file.
      started = false;
      muxer.stop();
    } finally {
      close();
    }
  }

  private void drain(boolean ending) throws Exception {
    long deadline = android.os.SystemClock.elapsedRealtime() + 30000;
    while (true) {
      int index = codec.dequeueOutputBuffer(info, ending ? 10000 : 0);
      if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
        if (!ending) return;
        if (android.os.SystemClock.elapsedRealtime() > deadline)
          throw new IOException("Video encoder timed out");
      } else if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (started) throw new IOException("Video format changed unexpectedly");
        track = muxer.addTrack(codec.getOutputFormat());
        muxer.start();
        started = true;
      } else if (index >= 0) {
        ByteBuffer bytes = codec.getOutputBuffer(index);
        if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
        if (info.size > 0) {
          if (!started || bytes == null) throw new IOException("Video encoder output is not ready");
          bytes.position(info.offset);
          bytes.limit(info.offset + info.size);
          muxer.writeSampleData(track, bytes, info);
        }
        boolean end = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
        codec.releaseOutputBuffer(index, false);
        if (end) return;
      }
    }
  }

  void close() {
    if (closed) return;
    closed = true;
    if (display != EGL14.EGL_NO_DISPLAY) {
      final EGLDisplay oldDisplay = display;
      final EGLSurface oldWindow = window;
      final EGLContext oldContext = context;
      display = EGL14.EGL_NO_DISPLAY;
      window = EGL14.EGL_NO_SURFACE;
      context = EGL14.EGL_NO_CONTEXT;
      cleanup(
          () ->
              EGL14.eglMakeCurrent(
                  oldDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT));
      if (oldWindow != EGL14.EGL_NO_SURFACE)
        cleanup(() -> EGL14.eglDestroySurface(oldDisplay, oldWindow));
      if (oldContext != EGL14.EGL_NO_CONTEXT)
        cleanup(() -> EGL14.eglDestroyContext(oldDisplay, oldContext));
      cleanup(VideoRenderer::releaseDisplay);
      cleanup(EGL14::eglReleaseThread);
    }
    if (surface != null) {
      Surface old = surface;
      surface = null;
      cleanup(old::release);
    }
    if (codec != null) {
      MediaCodec old = codec;
      codec = null;
      cleanup(old::stop);
      cleanup(old::release);
    }
    if (muxer != null) {
      MediaMuxer old = muxer;
      muxer = null;
      boolean wasStarted = started;
      started = false;
      if (wasStarted) cleanup(old::stop);
      cleanup(old::release);
    }
  }

  private static void cleanup(Runnable action) {
    try {
      action.run();
    } catch (RuntimeException ignored) {
      /* Attempt every remaining release. */
    }
  }

  private static FloatBuffer buffer(float... values) {
    FloatBuffer data =
        ByteBuffer.allocateDirect(values.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
    data.put(values).position(0);
    return data;
  }

  private static int shader(int type, String source) throws IOException {
    int shader = GLES20.glCreateShader(type);
    GLES20.glShaderSource(shader, source);
    GLES20.glCompileShader(shader);
    int[] okay = new int[1];
    GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, okay, 0);
    if (okay[0] == 0) throw new IOException(GLES20.glGetShaderInfoLog(shader));
    return shader;
  }
}
