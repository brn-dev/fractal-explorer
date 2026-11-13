package org.fractalexplorer.wallpaper;

import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/** One existing sampling pass, cached locations, and a LUT uploaded only when the grade changes. */
final class ColorGradeGl {
  private static final String VERTEX =
      "attribute vec2 aPosition;attribute vec2 aUV;varying mediump vec2 vUV;void"
          + " main(){vUV=aUV;gl_Position=vec4(aPosition,0.,1.);}";
  private final boolean external;
  private final String precision;
  private final FloatBuffer vertices = floats(-1, -1, 1, -1, -1, 1, 1, 1),
      uv = floats(0, 0, 1, 0, 0, 1, 1, 1);
  private final Program base;
  private Program corrected;
  private WallpaperColorGrade grade = WallpaperColorGrade.IDENTITY;
  private int lut;

  private static final class Program {
    int id, position, uv, matrix, crop, image, curve, tone, rgb;
  }

  ColorGradeGl(boolean external) {
    this.external = external;
    precision = VideoRenderer.fragmentPrecision();
    base = compile(false);
  }

  void setGrade(WallpaperColorGrade next) {
    if (next.key.equals(grade.key)) return;
    if (next.active) {
      if (corrected == null) corrected = compile(true);
      if (lut == 0) {
        int[] names = new int[1];
        GLES20.glGenTextures(1, names, 0);
        lut = names[0];
      }
      GLES20.glActiveTexture(GLES20.GL_TEXTURE1);
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lut);
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
      GLES20.glTexParameteri(
          GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
      GLES20.glTexParameteri(
          GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
      ByteBuffer data = ByteBuffer.allocateDirect(WallpaperColorGrade.LUT_SIZE * 4);
      data.put(next.lut()).position(0);
      GLES20.glTexImage2D(
          GLES20.GL_TEXTURE_2D,
          0,
          GLES20.GL_RGBA,
          WallpaperColorGrade.LUT_SIZE,
          1,
          0,
          GLES20.GL_RGBA,
          GLES20.GL_UNSIGNED_BYTE,
          data);
      if (GLES20.glGetError() != GLES20.GL_NO_ERROR)
        throw new IllegalStateException("Cannot upload color correction");
    }
    grade = next;
  }

  void draw(int texture, float[] matrix, float cropX, float cropY, int width, int height) {
    Program p = grade.active ? corrected : base;
    GLES20.glViewport(0, 0, width, height);
    GLES20.glUseProgram(p.id);
    GLES20.glEnableVertexAttribArray(p.position);
    GLES20.glEnableVertexAttribArray(p.uv);
    GLES20.glVertexAttribPointer(p.position, 2, GLES20.GL_FLOAT, false, 0, vertices);
    GLES20.glVertexAttribPointer(p.uv, 2, GLES20.GL_FLOAT, false, 0, uv);
    GLES20.glUniformMatrix4fv(p.matrix, 1, false, matrix, 0);
    GLES20.glUniform2f(p.crop, cropX, cropY);
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
    GLES20.glBindTexture(
        external ? GLES11Ext.GL_TEXTURE_EXTERNAL_OES : GLES20.GL_TEXTURE_2D, texture);
    GLES20.glUniform1i(p.image, 0);
    if (grade.active) {
      GLES20.glActiveTexture(GLES20.GL_TEXTURE1);
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lut);
      GLES20.glUniform1i(p.curve, 1);
      GLES20.glUniform1i(p.tone, grade.tone ? 1 : 0);
      GLES20.glUniform1i(p.rgb, grade.rgb ? 1 : 0);
    }
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
  }

  void close() {
    GLES20.glDeleteProgram(base.id);
    if (corrected != null) GLES20.glDeleteProgram(corrected.id);
    if (lut != 0) GLES20.glDeleteTextures(1, new int[] {lut}, 0);
  }

  private Program compile(boolean correction) {
    String body =
        (external ? "#extension GL_OES_EGL_image_external : require\n" : "")
            + "precision mediump float;varying mediump vec2 vUV;uniform mat4 uMatrix;uniform vec2"
            + " uCrop;uniform "
            + (external ? "samplerExternalOES" : "sampler2D")
            + " uTexture;";
    if (correction)
      body +=
          "uniform sampler2D uCurve;uniform bool uTone;uniform bool uRGB;vec4 curve(float x){return"
              + " texture2D(uCurve,vec2((clamp(x,0.,1.)*"
              + (WallpaperColorGrade.LUT_SIZE - 1)
              + ".+.5)/"
              + WallpaperColorGrade.LUT_SIZE
              + ".,.5));}";
    body +=
        "void main(){vec2 uv=(vUV-.5)*uCrop+.5;vec4"
            + " pixel=texture2D(uTexture,(uMatrix*vec4(uv,0.,1.)).xy);";
    if (correction)
      body +=
          "vec3 c=clamp(pixel.rgb,0.,1.);if(uTone){float l=dot(c,vec3(.2126,.7152,.0722));float"
              + " t=curve(l).a;c=l>.00001?clamp(c*(t/l),0.,1.):vec3(t);}if(uRGB)c=vec3(curve(c.r).r,curve(c.g).g,curve(c.b).b);pixel=vec4(c,pixel.a);";
    body += "gl_FragColor=pixel;}";
    Program p = new Program();
    int vertex = shader(GLES20.GL_VERTEX_SHADER, VERTEX.replace("mediump", precision)),
        fragment = 0;
    try {
      fragment = shader(GLES20.GL_FRAGMENT_SHADER, body.replace("mediump", precision));
      p.id = GLES20.glCreateProgram();
      GLES20.glAttachShader(p.id, vertex);
      GLES20.glAttachShader(p.id, fragment);
      GLES20.glLinkProgram(p.id);
      int[] status = new int[1];
      GLES20.glGetProgramiv(p.id, GLES20.GL_LINK_STATUS, status, 0);
      if (status[0] == 0) throw new IllegalStateException(GLES20.glGetProgramInfoLog(p.id));
      p.position = GLES20.glGetAttribLocation(p.id, "aPosition");
      p.uv = GLES20.glGetAttribLocation(p.id, "aUV");
      p.matrix = GLES20.glGetUniformLocation(p.id, "uMatrix");
      p.crop = GLES20.glGetUniformLocation(p.id, "uCrop");
      p.image = GLES20.glGetUniformLocation(p.id, "uTexture");
      if (correction) {
        p.curve = GLES20.glGetUniformLocation(p.id, "uCurve");
        p.tone = GLES20.glGetUniformLocation(p.id, "uTone");
        p.rgb = GLES20.glGetUniformLocation(p.id, "uRGB");
      }
      return p;
    } catch (RuntimeException e) {
      if (p.id != 0) GLES20.glDeleteProgram(p.id);
      throw e;
    } finally {
      GLES20.glDeleteShader(vertex);
      if (fragment != 0) GLES20.glDeleteShader(fragment);
    }
  }

  private static int shader(int kind, String source) {
    int id = GLES20.glCreateShader(kind);
    GLES20.glShaderSource(id, source);
    GLES20.glCompileShader(id);
    int[] ok = new int[1];
    GLES20.glGetShaderiv(id, GLES20.GL_COMPILE_STATUS, ok, 0);
    if (ok[0] == 0) {
      String error = GLES20.glGetShaderInfoLog(id);
      GLES20.glDeleteShader(id);
      throw new IllegalStateException(error);
    }
    return id;
  }

  private static FloatBuffer floats(float... values) {
    FloatBuffer data =
        ByteBuffer.allocateDirect(values.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
    data.put(values).position(0);
    return data;
  }
}
