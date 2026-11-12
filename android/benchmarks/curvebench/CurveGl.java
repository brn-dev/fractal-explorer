package org.fractalexplorer.curvebench;

import android.graphics.SurfaceTexture;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.os.Debug;
import android.os.Handler;
import android.view.Surface;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/** A standalone ES2 reproduction of the wallpaper's external-texture draw pass. */
final class CurveGl {
  static final String VERTEX =
      "attribute vec2 aPosition; attribute vec2 aUV; varying mediump vec2 vUV; void"
          + " main(){vUV=aUV;gl_Position=vec4(aPosition,0.,1.);}";
  static final String BODY =
      "#extension GL_OES_EGL_image_external : require\n"
          + "precision mediump float; varying mediump vec2 vUV; uniform mat4 uMatrix; uniform vec2"
          + " uCrop; uniform samplerExternalOES uTexture;";
  static final String BASE =
      "void main(){vec2"
          + " uv=(vUV-.5)*uCrop+.5;gl_FragColor=texture2D(uTexture,(uMatrix*vec4(uv,0.,1.)).xy);}";
  static final String TONE =
      "uniform sampler2D uCurve; vec4 curve(float x){return"
          + " texture2D(uCurve,vec2((x*255.+.5)/256.,.5));}void main(){vec2"
          + " uv=(vUV-.5)*uCrop+.5;vec3"
          + " c=clamp(texture2D(uTexture,(uMatrix*vec4(uv,0.,1.)).xy).rgb,0.,1.);float"
          + " l=dot(c,vec3(.2126,.7152,.0722));float"
          + " t=curve(l).a;c=l>0.00001?clamp(c*(t/l),0.,1.):vec3(t);";
  static final String RGB = "c=vec3(curve(c.r).r,curve(c.g).g,curve(c.b).b);";
  private EGLDisplay display = EGL14.EGL_NO_DISPLAY;
  private EGLContext context = EGL14.EGL_NO_CONTEXT;
  private EGLSurface output = EGL14.EGL_NO_SURFACE;
  private int program, videoId, lutId;
  private final int mode, width, height;
  private final int position, uv, matrix, crop, texture, curve;
  private final FloatBuffer vertices = floats(-1, -1, 1, -1, -1, 1, 1, 1),
      coords = floats(0, 0, 1, 0, 0, 1, 1, 1);
  private final float[] transform = new float[16];
  final SurfaceTexture videoTexture;
  final Surface decoderSurface;
  final String vendor, renderer, version, precision;
  long drawNanos, threadCpuNanos, serviceNanos;

  CurveGl(Surface window, int width, int height, int mode, Handler handler, Runnable frame) {
    this.width = width;
    this.height = height;
    this.mode = mode;
    SurfaceTexture createdTexture = null;
    Surface createdSurface = null;
    try {
      display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
      int[] eglVersion = new int[2];
      check(EGL14.eglInitialize(display, eglVersion, 0, eglVersion, 1), "eglInitialize");
      int[] attrs = {
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
      check(
          EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, count, 0) && count[0] > 0,
          "eglChooseConfig");
      context =
          EGL14.eglCreateContext(
              display,
              configs[0],
              EGL14.EGL_NO_CONTEXT,
              new int[] {EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE},
              0);
      output =
          EGL14.eglCreateWindowSurface(display, configs[0], window, new int[] {EGL14.EGL_NONE}, 0);
      check(
          context != EGL14.EGL_NO_CONTEXT
              && output != EGL14.EGL_NO_SURFACE
              && EGL14.eglMakeCurrent(display, output, output, context),
          "eglMakeCurrent");
      vendor = GLES20.glGetString(GLES20.GL_VENDOR);
      renderer = GLES20.glGetString(GLES20.GL_RENDERER);
      version = GLES20.glGetString(GLES20.GL_VERSION);
      int[] range = new int[2], bits = new int[1];
      GLES20.glGetShaderPrecisionFormat(
          GLES20.GL_FRAGMENT_SHADER, GLES20.GL_HIGH_FLOAT, range, 0, bits, 0);
      precision = bits[0] >= 16 ? "highp" : "mediump";
      String body = mode < 3 ? BASE : TONE + (mode == 4 ? RGB : "") + "gl_FragColor=vec4(c,1.);}";
      program =
          program(
              VERTEX.replace("mediump", precision), (BODY + body).replace("mediump", precision));
      position = GLES20.glGetAttribLocation(program, "aPosition");
      uv = GLES20.glGetAttribLocation(program, "aUV");
      matrix = GLES20.glGetUniformLocation(program, "uMatrix");
      crop = GLES20.glGetUniformLocation(program, "uCrop");
      texture = GLES20.glGetUniformLocation(program, "uTexture");
      curve = GLES20.glGetUniformLocation(program, "uCurve");
      videoId = texture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES);
      createdTexture = new SurfaceTexture(videoId);
      createdTexture.setOnFrameAvailableListener(t -> frame.run(), handler);
      createdSurface = new Surface(createdTexture);
      if (mode >= 3) {
        lutId = texture(GLES20.GL_TEXTURE_2D);
        ByteBuffer data = ByteBuffer.allocateDirect(1024);
        data.put(BenchMath.identityLut()).position(0);
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D,
            0,
            GLES20.GL_RGBA,
            256,
            1,
            0,
            GLES20.GL_RGBA,
            GLES20.GL_UNSIGNED_BYTE,
            data);
      }
      check(GLES20.glGetError() == GLES20.GL_NO_ERROR, "GL setup");
    } catch (RuntimeException error) {
      if (createdSurface != null) createdSurface.release();
      if (createdTexture != null) createdTexture.release();
      releaseEgl();
      throw error;
    }
    videoTexture = createdTexture;
    decoderSurface = createdSurface;
  }

  void draw(boolean synchronize) {
    long start = synchronize ? System.nanoTime() : 0;
    videoTexture.updateTexImage();
    videoTexture.getTransformMatrix(transform);
    long begin = synchronize ? System.nanoTime() : 0,
        cpu = synchronize ? Debug.threadCpuTimeNanos() : 0;
    GLES20.glViewport(0, 0, width, height);
    GLES20.glUseProgram(program);
    int p = position, u = uv, m = matrix, c = crop, t = texture;
    // Mode 1 reproduces the existing per-frame location lookups. Mode 2 caches them.
    if (mode == 1) {
      p = GLES20.glGetAttribLocation(program, "aPosition");
      u = GLES20.glGetAttribLocation(program, "aUV");
      m = GLES20.glGetUniformLocation(program, "uMatrix");
      c = GLES20.glGetUniformLocation(program, "uCrop");
      t = GLES20.glGetUniformLocation(program, "uTexture");
    }
    GLES20.glEnableVertexAttribArray(p);
    GLES20.glEnableVertexAttribArray(u);
    GLES20.glVertexAttribPointer(p, 2, GLES20.GL_FLOAT, false, 0, vertices);
    GLES20.glVertexAttribPointer(u, 2, GLES20.GL_FLOAT, false, 0, coords);
    GLES20.glUniform2f(c, 1, 1);
    GLES20.glUniformMatrix4fv(m, 1, false, transform, 0);
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, videoId);
    GLES20.glUniform1i(t, 0);
    if (mode >= 3) {
      GLES20.glActiveTexture(GLES20.GL_TEXTURE1);
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutId);
      GLES20.glUniform1i(curve, 1);
    }
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    if (synchronize) {
      GLES20.glFinish();
      drawNanos = System.nanoTime() - begin;
      threadCpuNanos = Debug.threadCpuTimeNanos() - cpu;
    }
    check(EGL14.eglSwapBuffers(display, output), "eglSwapBuffers");
    if (synchronize) serviceNanos = System.nanoTime() - start;
  }

  private static int texture(int target) {
    int[] ids = new int[1];
    GLES20.glGenTextures(1, ids, 0);
    GLES20.glBindTexture(target, ids[0]);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
    return ids[0];
  }

  private static FloatBuffer floats(float... data) {
    FloatBuffer b =
        ByteBuffer.allocateDirect(data.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
    b.put(data).position(0);
    return b;
  }

  private static void check(boolean ok, String where) {
    if (!ok)
      throw new IllegalStateException(
          where + " failed, EGL=" + Integer.toHexString(EGL14.eglGetError()));
  }

  private static int shader(int kind, String source) {
    int id = GLES20.glCreateShader(kind);
    GLES20.glShaderSource(id, source);
    GLES20.glCompileShader(id);
    int[] ok = new int[1];
    GLES20.glGetShaderiv(id, GLES20.GL_COMPILE_STATUS, ok, 0);
    if (ok[0] == 0) {
      String log = GLES20.glGetShaderInfoLog(id);
      GLES20.glDeleteShader(id);
      throw new IllegalStateException(log);
    }
    return id;
  }

  private static int program(String vertex, String fragment) {
    int v = shader(GLES20.GL_VERTEX_SHADER, vertex), f = 0, id = 0;
    try {
      f = shader(GLES20.GL_FRAGMENT_SHADER, fragment);
      id = GLES20.glCreateProgram();
      GLES20.glAttachShader(id, v);
      GLES20.glAttachShader(id, f);
      GLES20.glLinkProgram(id);
      int[] ok = new int[1];
      GLES20.glGetProgramiv(id, GLES20.GL_LINK_STATUS, ok, 0);
      if (ok[0] == 0) throw new IllegalStateException(GLES20.glGetProgramInfoLog(id));
      return id;
    } catch (RuntimeException e) {
      if (id != 0) GLES20.glDeleteProgram(id);
      throw e;
    } finally {
      GLES20.glDeleteShader(v);
      if (f != 0) GLES20.glDeleteShader(f);
    }
  }

  void close() {
    videoTexture.setOnFrameAvailableListener(null);
    decoderSurface.release();
    videoTexture.release();
    releaseEgl();
  }

  private void releaseEgl() {
    if (display == EGL14.EGL_NO_DISPLAY) return;
    if (context != EGL14.EGL_NO_CONTEXT) {
      if (program != 0) GLES20.glDeleteProgram(program);
      int[] ids = {videoId, lutId};
      GLES20.glDeleteTextures(2, ids, 0);
    }
    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
    if (output != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, output);
    if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context);
    EGL14.eglTerminate(display);
    display = EGL14.EGL_NO_DISPLAY;
  }
}
