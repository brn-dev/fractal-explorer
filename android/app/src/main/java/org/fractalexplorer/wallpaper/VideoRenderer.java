package org.fractalexplorer.wallpaper;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLUtils;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.view.Surface;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.concurrent.CountDownLatch;

/** Video decoding feeds a texture. Draw only when a new video frame arrives. */
final class VideoRenderer {
  private static final String VERTEX =
      "attribute vec2 aPosition; attribute vec2 aUV; varying mediump vec2 vUV; void"
          + " main(){vUV=aUV;gl_Position=vec4(aPosition,0.,1.);}";
  private static final String BODY =
      "precision mediump float; varying mediump vec2 vUV; uniform mat4 uMatrix; uniform vec2 uCrop;"
          + " ";
  private static final String SAMPLE =
      "void main(){vec2"
          + " uv=(vUV-.5)*uCrop+.5;gl_FragColor=texture2D(uTexture,(uMatrix*vec4(uv,0.,1.)).xy);}";
  private final Context context;
  private final Surface window;
  private final boolean shuffleAllowed;
  private final HandlerThread thread = new HandlerThread("Fractal video");
  private final Handler handler;
  private final PlaybackState state = new PlaybackState();
  private final FloatBuffer vertices = floats(-1, -1, 1, -1, -1, 1, 1, 1);
  private final FloatBuffer coords = floats(0, 0, 1, 0, 0, 1, 1, 1);
  private final float[] videoMatrix = new float[16];
  private final float[] posterMatrix = {1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1};
  private EGLDisplay display = EGL14.EGL_NO_DISPLAY;
  private EGLContext glContext = EGL14.EGL_NO_CONTEXT;
  private EGLSurface eglSurface = EGL14.EGL_NO_SURFACE;
  private SurfaceTexture videoTexture;
  private SurfaceTexture.OnFrameAvailableListener videoFrameListener;
  private Surface videoSurface;
  private MediaPlayer player;
  private int videoProgram, posterProgram, posterId, videoId;
  private int width, height, videoWidth = 1, videoHeight = 1, posterWidth = 1, posterHeight = 1;
  private boolean initialized, showVideo;
  private volatile boolean closed;
  private final CountDownLatch closedDone = new CountDownLatch(1);
  private static EGLDisplay sharedDisplay = EGL14.EGL_NO_DISPLAY;
  private static int displayUsers;

  static synchronized EGLDisplay acquireDisplay() {
    if (displayUsers == 0) {
      EGLDisplay next = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
      int[] version = new int[2];
      if (!EGL14.eglInitialize(next, version, 0, version, 1))
        throw new IllegalStateException("Cannot initialize graphics");
      sharedDisplay = next;
    }
    displayUsers++;
    return sharedDisplay;
  }

  static synchronized void releaseDisplay() {
    if (--displayUsers == 0) {
      EGL14.eglTerminate(sharedDisplay);
      sharedDisplay = EGL14.EGL_NO_DISPLAY;
    }
  }

  static String fragmentPrecision() {
    int[] range = new int[2], precision = new int[1];
    GLES20.glGetShaderPrecisionFormat(
        GLES20.GL_FRAGMENT_SHADER, GLES20.GL_HIGH_FLOAT, range, 0, precision, 0);
    return precision[0] >= 16 ? "highp" : "mediump";
  }

  VideoRenderer(Context context, Surface window) {
    this(context, window, false);
  }

  VideoRenderer(Context context, Surface window, boolean shuffleAllowed) {
    this.context = context.getApplicationContext();
    this.window = window;
    this.shuffleAllowed = shuffleAllowed;
    thread.start();
    handler = new Handler(thread.getLooper());
  }

  void configure(
      int width,
      int height,
      PlaybackState.Mode mode,
      boolean visible,
      boolean idle,
      boolean arrival,
      boolean saving,
      long revision,
      long screenEvent,
      long now) {
    handler.post(
        () -> {
          if (closed) return;
          try {
            this.width = width;
            this.height = height;
            boolean newArtwork = state.mode != mode;
            if (!initialized) initialize();
            state.screenEvent(screenEvent);
            long currentRevision = revision;
            boolean currentIdle = idle, currentArrival = arrival;
            if (shuffleAllowed) {
              android.content.SharedPreferences preferences =
                  context.getSharedPreferences("wallpaper", 0);
              String screen = mode == PlaybackState.Mode.COVER ? "cover" : "inner";
              // Preference callbacks can be queued before an automatic selection commits.
              // Resolve content when the renderer executes, never rewind to that old snapshot.
              currentRevision = WallpaperFiles.revision(preferences, screen);
              currentIdle = WallpaperFiles.playback(preferences, screen, "idle");
              currentArrival = WallpaperFiles.playback(preferences, screen, "arrival");
            }
            boolean changed =
                state.update(
                    mode, visible, currentIdle, currentArrival, saving, currentRevision, now);
            if (shuffleAllowed && changed && state.arrivalReveal) {
              try {
                String screen = state.prefix();
                new WallpaperGallery(context).chooseForArrival(screen, screenEvent, now);
                currentRevision =
                    WallpaperFiles.revision(context.getSharedPreferences("wallpaper", 0), screen);
                changed |=
                    state.update(
                        mode, visible, currentIdle, currentArrival, saving, currentRevision, now);
              } catch (Exception error) {
                report(error);
              }
            }
            if (newArtwork || posterId == 0 || this.revision != currentRevision) {
              loadPoster();
              showVideo = false;
              this.revision = currentRevision;
            }
            if (changed) applyStage();
            else if (state.stage != PlaybackState.Stage.HIDDEN) draw();
          } catch (Exception error) {
            report(error);
            stopPlayer();
            if (!initialized) close();
          }
        });
  }

  private long revision = -1;

  private void initialize() {
    display = acquireDisplay();
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
      EGL14.EGL_ALPHA_SIZE,
      0,
      EGL14.EGL_NONE
    };
    EGLConfig[] configs = new EGLConfig[1];
    int[] count = new int[1];
    if (!EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, count, 0) || count[0] == 0)
      throw new IllegalStateException("No graphics configuration");
    glContext =
        EGL14.eglCreateContext(
            display,
            configs[0],
            EGL14.EGL_NO_CONTEXT,
            new int[] {EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE},
            0);
    eglSurface =
        EGL14.eglCreateWindowSurface(display, configs[0], window, new int[] {EGL14.EGL_NONE}, 0);
    if (glContext == EGL14.EGL_NO_CONTEXT
        || eglSurface == EGL14.EGL_NO_SURFACE
        || !EGL14.eglMakeCurrent(display, eglSurface, eglSurface, glContext))
      throw new IllegalStateException("Cannot attach wallpaper graphics");
    String precision = fragmentPrecision();
    videoProgram =
        program(
            "#extension GL_OES_EGL_image_external : require\n"
                + BODY
                + "uniform samplerExternalOES uTexture;"
                + SAMPLE,
            precision);
    posterProgram = program(BODY + "uniform sampler2D uTexture;" + SAMPLE, precision);
    initialized = true;
  }

  private void createVideoSurface(final int token) {
    videoId = texture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES);
    videoTexture = new SurfaceTexture(videoId);
    videoFrameListener =
        texture -> {
          if (closed || texture != videoTexture || state.generation != token || player == null)
            return;
          try {
            texture.updateTexImage();
            if (state.stage != PlaybackState.Stage.ARRIVAL
                && state.stage != PlaybackState.Stage.IDLE) return;
            texture.getTransformMatrix(videoMatrix);
            showVideo = true;
            draw();
          } catch (RuntimeException error) {
            state.failed(state.generation);
            stopPlayer();
            report(error);
          }
        };
    videoTexture.setOnFrameAvailableListener(videoFrameListener, handler);
    videoSurface = new Surface(videoTexture);
  }

  private void applyStage() {
    try {
      applyStageContents();
    } catch (Exception error) {
      // Completion/error listeners run directly on the renderer thread. A lost
      // surface during handoff must not escape and kill that thread/process.
      state.failed(state.generation);
      try {
        stopPlayer();
      } catch (RuntimeException cleanup) {
        error.addSuppressed(cleanup);
      }
      report(error);
    }
  }

  private void applyStageContents() {
    stopPlayer();
    if (state.stage == PlaybackState.Stage.HIDDEN) return;
    draw();
    if (state.stage == PlaybackState.Stage.STILL) return;
    final int token = state.generation;
    try {
      createVideoSurface(token);
      final MediaPlayer current = new MediaPlayer();
      player = current;
      File custom = WallpaperFiles.activeFile(context, state.clip());
      if (custom.isFile()) {
        try (FileInputStream source = new FileInputStream(custom)) {
          current.setDataSource(source.getFD());
        }
      } else {
        try (AssetFileDescriptor source = context.getAssets().openFd(state.clip())) {
          current.setDataSource(
              source.getFileDescriptor(), source.getStartOffset(), source.getLength());
        }
      }
      current.setSurface(videoSurface);
      current.setVolume(0, 0);
      current.setLooping(state.stage == PlaybackState.Stage.IDLE);
      current.setOnVideoSizeChangedListener(
          (mp, w, h) -> {
            if (player == mp && w > 0 && h > 0) {
              videoWidth = w;
              videoHeight = h;
            }
          });
      current.setOnPreparedListener(
          mp -> {
            if (!closed && player == mp && state.generation == token) {
              try {
                mp.start();
              } catch (RuntimeException error) {
                if (state.failed(token)) {
                  stopPlayer();
                  report(error);
                }
              }
            }
          });
      current.setOnCompletionListener(
          mp -> {
            if (!closed && player == mp && state.completed(token)) applyStage();
          });
      current.setOnErrorListener(
          (mp, what, extra) -> {
            if (!closed && player == mp && state.failed(token)) {
              report(new IOException("Video playback failed (" + what + ", " + extra + ")"));
              applyStage();
            }
            return true;
          });
      current.prepareAsync();
    } catch (Exception error) {
      if (state.failed(token)) {
        report(error);
        stopPlayer();
        draw();
      }
    }
  }

  private void loadPoster() throws IOException {
    Bitmap bitmap;
    File custom = WallpaperFiles.activeFile(context, state.prefix() + "-poster.png");
    if (custom.isFile()) bitmap = BitmapFactory.decodeFile(custom.getAbsolutePath());
    else
      try (java.io.InputStream source = context.getAssets().open(state.prefix() + "-poster.png")) {
        bitmap = BitmapFactory.decodeStream(source);
      }
    if (bitmap == null) throw new IOException("Cannot decode wallpaper poster");
    if (posterId == 0) posterId = texture(GLES20.GL_TEXTURE_2D);
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, posterId);
    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
    posterWidth = bitmap.getWidth();
    posterHeight = bitmap.getHeight();
    bitmap.recycle();
  }

  private void draw() {
    if (closed
        || !initialized
        || width <= 0
        || height <= 0
        || state.stage == PlaybackState.Stage.HIDDEN) return;
    int selected = showVideo ? videoProgram : posterProgram;
    int imageWidth = showVideo ? videoWidth : posterWidth,
        imageHeight = showVideo ? videoHeight : posterHeight;
    float ratio = (imageWidth / (float) imageHeight) / (width / (float) height);
    GLES20.glViewport(0, 0, width, height);
    GLES20.glUseProgram(selected);
    int position = GLES20.glGetAttribLocation(selected, "aPosition"),
        uv = GLES20.glGetAttribLocation(selected, "aUV");
    GLES20.glEnableVertexAttribArray(position);
    GLES20.glEnableVertexAttribArray(uv);
    GLES20.glVertexAttribPointer(position, 2, GLES20.GL_FLOAT, false, 0, vertices);
    GLES20.glVertexAttribPointer(uv, 2, GLES20.GL_FLOAT, false, 0, coords);
    GLES20.glUniform2f(
        GLES20.glGetUniformLocation(selected, "uCrop"),
        ratio > 1 ? 1 / ratio : 1,
        ratio < 1 ? ratio : 1);
    GLES20.glUniformMatrix4fv(
        GLES20.glGetUniformLocation(selected, "uMatrix"),
        1,
        false,
        showVideo ? videoMatrix : posterMatrix,
        0);
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
    GLES20.glBindTexture(
        showVideo ? GLES11Ext.GL_TEXTURE_EXTERNAL_OES : GLES20.GL_TEXTURE_2D,
        showVideo ? videoId : posterId);
    GLES20.glUniform1i(GLES20.glGetUniformLocation(selected, "uTexture"), 0);
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    if (!EGL14.eglSwapBuffers(display, eglSurface))
      throw new IllegalStateException("Wallpaper surface unavailable");
  }

  private void stopPlayer() {
    showVideo = false;
    MediaPlayer previous = player;
    player = null;
    if (previous != null) {
      previous.setOnCompletionListener(null);
      previous.setOnErrorListener(null);
      previous.release();
    }
    // A fresh queue per decoder makes callbacks from retired artwork harmless.
    if (videoSurface != null) {
      videoSurface.release();
      videoSurface = null;
    }
    if (videoTexture != null) {
      videoTexture.release();
      videoTexture = null;
    }
    videoFrameListener = null;
    if (videoId != 0) {
      GLES20.glDeleteTextures(1, new int[] {videoId}, 0);
      videoId = 0;
    }
  }

  private void report(Exception error) {
    Log.e("FractalWallpaper", "Wallpaper playback", error);
    try {
      context
          .getSharedPreferences("wallpaper", 0)
          .edit()
          .putString("last_error", error.toString())
          .apply();
    } catch (RuntimeException savingError) {
      Log.e("FractalWallpaper", "Cannot save playback error", savingError);
    }
  }

  void close() {
    boolean begin;
    synchronized (this) {
      begin = !closed;
      closed = true;
    }
    if (Thread.currentThread() == thread) {
      if (begin) release();
      return; // Never wait for cleanup queued behind this renderer callback.
    }
    if (begin) handler.post(this::release);
    boolean interrupted = false;
    try {
      for (; ; ) {
        try {
          closedDone.await();
          return;
        } catch (InterruptedException error) {
          interrupted = true;
        }
      }
    } finally {
      if (interrupted) Thread.currentThread().interrupt();
    }
  }

  private void release() {
    try {
      try {
        stopPlayer();
      } finally {
        if (display != EGL14.EGL_NO_DISPLAY) {
          EGL14.eglMakeCurrent(
              display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
          if (eglSurface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, eglSurface);
          if (glContext != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, glContext);
          releaseDisplay();
          EGL14.eglReleaseThread();
        }
      }
    } catch (RuntimeException error) {
      report(error);
    } finally {
      thread.quitSafely();
      closedDone.countDown();
    }
  }

  private static FloatBuffer floats(float... values) {
    FloatBuffer buffer =
        ByteBuffer.allocateDirect(values.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
    buffer.put(values).position(0);
    return buffer;
  }

  private static int texture(int target) {
    int[] names = new int[1];
    GLES20.glGenTextures(1, names, 0);
    GLES20.glBindTexture(target, names[0]);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
    return names[0];
  }

  private static int shader(int type, String source) {
    int shader = GLES20.glCreateShader(type);
    GLES20.glShaderSource(shader, source);
    GLES20.glCompileShader(shader);
    int[] okay = new int[1];
    GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, okay, 0);
    if (okay[0] == 0) throw new IllegalStateException(GLES20.glGetShaderInfoLog(shader));
    return shader;
  }

  private static int program(String fragment, String precision) {
    int vertex = shader(GLES20.GL_VERTEX_SHADER, VERTEX.replace("mediump", precision)),
        pixel = shader(GLES20.GL_FRAGMENT_SHADER, fragment.replace("mediump", precision));
    int program = GLES20.glCreateProgram();
    GLES20.glAttachShader(program, vertex);
    GLES20.glAttachShader(program, pixel);
    GLES20.glLinkProgram(program);
    GLES20.glDeleteShader(vertex);
    GLES20.glDeleteShader(pixel);
    int[] okay = new int[1];
    GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, okay, 0);
    if (okay[0] == 0) throw new IllegalStateException(GLES20.glGetProgramInfoLog(program));
    return program;
  }
}
