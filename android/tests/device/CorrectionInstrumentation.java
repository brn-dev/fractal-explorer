package org.fractalexplorer.wallpaper.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaExtractor;
import android.media.MediaMetadataRetriever;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES20;
import android.opengl.GLUtils;
import android.os.Bundle;
import android.os.SystemClock;
import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.json.JSONObject;

/** Real GLES correction and surface-to-surface transcode checks; emulator only. */
public final class CorrectionInstrumentation extends Instrumentation {
  private int checks;
  private final List<File> folders = new ArrayList<>();
  private Class<?> gradeClass, filesClass, galleryClass;
  private Object grade;
  private final String curves =
      "{\"tone\":{\"points\":[[0,0.1],[0.5,0.35],[1,0.9]]},\"red\":{\"points\":[[0,0],[1,0.8]]}}";

  @Override
  public void onCreate(Bundle b) {
    super.onCreate(b);
    start();
  }

  private void check(boolean value, String why) {
    checks++;
    if (!value) throw new AssertionError(why);
  }

  private Class<?> type(String name) throws Exception {
    return Class.forName(
        "org.fractalexplorer.wallpaper." + name, true, getTargetContext().getClassLoader());
  }

  private Object make(Class<?> type, Class<?>[] types, Object... args) throws Exception {
    Constructor<?> c = type.getDeclaredConstructor(types);
    c.setAccessible(true);
    return c.newInstance(args);
  }

  private Object invoke(Object target, String name, Class<?>[] types, Object... args)
      throws Exception {
    Class<?> t = target instanceof Class ? (Class<?>) target : target.getClass();
    Method m = t.getDeclaredMethod(name, types);
    m.setAccessible(true);
    return m.invoke(target instanceof Class ? null : target, args);
  }

  private int corrected(int color) throws Exception {
    return (Integer) invoke(grade, "color", new Class[] {int.class}, color);
  }

  private void gpu() throws Exception {
    Class<?> renderer = type("VideoRenderer");
    EGLDisplay display = (EGLDisplay) invoke(renderer, "acquireDisplay", new Class[] {});
    EGLContext context = EGL14.EGL_NO_CONTEXT;
    EGLSurface surface = EGL14.EGL_NO_SURFACE;
    Object draw = null;
    Bitmap bitmap = null;
    try {
      EGLConfig[] configs = new EGLConfig[1];
      int[] count = new int[1];
      check(
          EGL14.eglChooseConfig(
                  display,
                  new int[] {
                    EGL14.EGL_SURFACE_TYPE,
                    EGL14.EGL_PBUFFER_BIT,
                    EGL14.EGL_RENDERABLE_TYPE,
                    EGL14.EGL_OPENGL_ES2_BIT,
                    EGL14.EGL_RED_SIZE,
                    8,
                    EGL14.EGL_GREEN_SIZE,
                    8,
                    EGL14.EGL_BLUE_SIZE,
                    8,
                    EGL14.EGL_ALPHA_SIZE,
                    8,
                    EGL14.EGL_NONE
                  },
                  0,
                  configs,
                  0,
                  1,
                  count,
                  0)
              && count[0] > 0,
          "No test GLES config");
      context =
          EGL14.eglCreateContext(
              display,
              configs[0],
              EGL14.EGL_NO_CONTEXT,
              new int[] {EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE},
              0);
      surface =
          EGL14.eglCreatePbufferSurface(
              display,
              configs[0],
              new int[] {EGL14.EGL_WIDTH, 8, EGL14.EGL_HEIGHT, 8, EGL14.EGL_NONE},
              0);
      check(
          EGL14.eglMakeCurrent(display, surface, surface, context),
          "Cannot bind GLES test surface");
      int[] pixels = new int[64];
      for (int i = 0; i < pixels.length; i++)
        pixels[i] = 0xff000000 | ((i * 37 % 256) << 16) | ((i * 73 % 256) << 8) | (i * 101 % 256);
      bitmap = Bitmap.createBitmap(pixels, 8, 8, Bitmap.Config.ARGB_8888);
      int[] texture = new int[1];
      GLES20.glGenTextures(1, texture, 0);
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture[0]);
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
      GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
      draw = make(type("ColorGradeGl"), new Class[] {boolean.class}, false);
      float[] matrix = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
      for (boolean active : new boolean[] {false, true}) {
        if (active) invoke(draw, "setGrade", new Class[] {gradeClass}, grade);
        invoke(
            draw,
            "draw",
            new Class[] {int.class, float[].class, float.class, float.class, int.class, int.class},
            texture[0],
            matrix,
            1f,
            1f,
            8,
            8);
        ByteBuffer bytes = ByteBuffer.allocateDirect(256).order(ByteOrder.nativeOrder());
        GLES20.glReadPixels(0, 0, 8, 8, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, bytes);
        for (int i = 0; i < 64; i++) {
          int expected = active ? corrected(pixels[i]) : pixels[i];
          for (int c = 0; c < 3; c++)
            check(
                Math.abs((bytes.get(i * 4 + c) & 255) - ((expected >> ((2 - c) * 8)) & 255))
                    <= (active ? 2 : 0),
                "GLES/CPU pixel mismatch " + active + "/" + i + "/" + c);
        }
      }
      check(GLES20.glGetError() == GLES20.GL_NO_ERROR, "Unexpected GLES error");
    } finally {
      if (draw != null) invoke(draw, "close", new Class[] {});
      if (bitmap != null) bitmap.recycle();
      EGL14.eglMakeCurrent(
          display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
      if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface);
      if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context);
      invoke(renderer, "releaseDisplay", new Class[] {});
      EGL14.eglReleaseThread();
    }
  }

  private Bitmap frame(int index) {
    int[] pixels = new int[128 * 96];
    int[] colors = {0xffd03020, 0xff20c040, 0xff2040d0, 0xffb0a020};
    for (int y = 0; y < 96; y++)
      for (int x = 0; x < 128; x++) {
        int quadrant = (x >= 64 ? 1 : 0) + (y >= 48 ? 2 : 0);
        pixels[y * 128 + x] =
            (y >= 42 && y < 54)
                ? (0xff000000 | ((index * 7) << 16) | ((index * 3) << 8) | index)
                : colors[quadrant];
      }
    return Bitmap.createBitmap(pixels, 128, 96, Bitmap.Config.ARGB_8888);
  }

  private void encode(File file) throws Exception {
    Object encoder =
        make(
            type("NativeVideoEncoder"),
            new Class[] {File.class, int.class, int.class, int.class, int.class},
            file,
            128,
            96,
            15,
            5000000);
    try {
      for (int i = 0; i < 30; i++) {
        Bitmap bitmap = frame(i);
        try {
          invoke(encoder, "add", new Class[] {Bitmap.class, int.class}, bitmap, i);
        } finally {
          bitmap.recycle();
        }
      }
      invoke(encoder, "finish", new Class[] {});
    } finally {
      invoke(encoder, "close", new Class[] {});
    }
  }

  private long[] timestamps(File file) throws Exception {
    MediaExtractor e = new MediaExtractor();
    try {
      e.setDataSource(file.getAbsolutePath());
      e.selectTrack(0);
      List<Long> list = new ArrayList<>();
      while (e.getSampleTime() >= 0) {
        list.add(e.getSampleTime());
        e.advance();
      }
      long[] result = new long[list.size()];
      for (int i = 0; i < result.length; i++) result[i] = list.get(i);
      Arrays.sort(result);
      return result;
    } finally {
      e.release();
    }
  }

  private void compareVideos(File original, File copy) throws Exception {
    long[] a = timestamps(original), b = timestamps(copy);
    check(a.length == 30 && b.length == a.length, "Baking dropped or duplicated frames");
    for (int i = 0; i < a.length; i++) check(Math.abs(a[i] - b[i]) <= 2, "Frame timestamp changed");
    try (MediaMetadataRetriever input = new MediaMetadataRetriever();
        MediaMetadataRetriever output = new MediaMetadataRetriever()) {
      input.setDataSource(original.getAbsolutePath());
      output.setDataSource(copy.getAbsolutePath());
      check(
          output.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH).equals("128")
              && output
                  .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
                  .equals("96"),
          "Native dimensions changed");
      for (long time : new long[] {0, 1000000, 1933333}) {
        Bitmap first = input.getFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST),
            second = output.getFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST);
        check(first != null && second != null, "Cannot decode converted frame");
        try {
          for (int[] point : new int[][] {{12, 12}, {115, 12}, {12, 83}, {115, 83}, {64, 47}}) {
            int expected = corrected(first.getPixel(point[0], point[1])),
                actual = second.getPixel(point[0], point[1]);
            for (int c = 0; c < 3; c++)
              check(
                  Math.abs(((expected >> (c * 8)) & 255) - ((actual >> (c * 8)) & 255)) <= 16,
                  "Encoded correction/orientation differs at "
                      + time
                      + "/"
                      + point[0]
                      + ","
                      + point[1]);
          }
        } finally {
          first.recycle();
          second.recycle();
        }
      }
    }
  }

  private void jobs() throws Exception {
    Context context = getTargetContext();
    String activeBefore =
        context.getSharedPreferences("wallpaper", 0).getString("active_inner", "");
    Object files = make(filesClass, new Class[] {Context.class}, context),
        gallery = make(galleryClass, new Class[] {Context.class}, context);
    File staged = (File) invoke(files, "staging", new Class[] {});
    folders.add(staged);
    encode(new File(staged, "inner-idle.mp4"));
    Files.copy(
        new File(staged, "inner-idle.mp4").toPath(),
        new File(staged, "inner-arrival.mp4").toPath());
    Bitmap poster = frame(0);
    try (java.io.FileOutputStream stream =
        new java.io.FileOutputStream(new File(staged, "inner-poster.png"))) {
      check(poster.compress(Bitmap.CompressFormat.PNG, 100, stream), "Poster save failed");
    } finally {
      poster.recycle();
    }
    JSONObject clip =
        new JSONObject()
            .put("width", 128)
            .put("height", 96)
            .put("fps", 15)
            .put("frames", 30)
            .put("duration", 2);
    JSONObject manifest =
        new JSONObject()
            .put("format", "fractal-wallpaper/v1")
            .put("version", 1)
            .put("screen", "inner")
            .put("name", "Correction fixture")
            .put("kind", "animated")
            .put("steadyMotion", "animated")
            .put(
                "clips",
                new JSONObject()
                    .put(
                        "open-steady",
                        new JSONObject(clip.toString()).put("file", "inner-idle.mp4"))
                    .put(
                        "open-transition",
                        new JSONObject(clip.toString()).put("file", "inner-arrival.mp4")));
    String original =
        (String)
            invoke(files, "retain", new Class[] {File.class, JSONObject.class}, staged, manifest);
    File source = new File(context.getFilesDir(), "wallpapers/" + original);
    folders.add(source);
    byte[] originalVideo = Files.readAllBytes(new File(source, "inner-idle.mp4").toPath());
    JSONObject options =
        new JSONObject().put("name", "Corrected fixture").put("quality", "dynamic-high");
    Object job =
        invoke(
            type("WallpaperBakeJobs"),
            "start",
            new Class[] {Context.class, String.class, String.class, gradeClass, JSONObject.class},
            context,
            original,
            "inner",
            grade,
            options);
    JSONObject status = null;
    long deadline = SystemClock.elapsedRealtime() + 120000;
    while (SystemClock.elapsedRealtime() < deadline) {
      status = (JSONObject) invoke(job, "status", new Class[] {});
      if (!status.getString("state").equals("running")
          && !status.getString("state").equals("committing")) break;
      SystemClock.sleep(100);
    }
    check(
        status != null && status.optString("state").equals("completed"),
        "Baking failed: " + status);
    File result = new File(context.getFilesDir(), "wallpapers/" + status.getString("id"));
    folders.add(result);
    check(
        Arrays.equals(
            originalVideo, Files.readAllBytes(new File(source, "inner-idle.mp4").toPath())),
        "Original video modified");
    compareVideos(new File(source, "inner-idle.mp4"), new File(result, "inner-idle.mp4"));
    compareVideos(new File(source, "inner-arrival.mp4"), new File(result, "inner-arrival.mp4"));
    JSONObject saved =
        new JSONObject(
            new String(Files.readAllBytes(new File(result, "wallpaper.json").toPath()), "UTF-8"));
    check(
        saved.has("renderCorrection") && !saved.has("editor"), "Saved media copy metadata invalid");
    check(
        context
            .getSharedPreferences("wallpaper", 0)
            .getString("active_inner", "")
            .equals(activeBefore),
        "Copy was selected automatically");
    // Cancellation happens before publication and leaves the immutable original usable.
    Object cancelled =
        invoke(
            type("WallpaperBakeJobs"),
            "start",
            new Class[] {Context.class, String.class, String.class, gradeClass, JSONObject.class},
            context,
            original,
            "inner",
            grade,
            options);
    invoke(cancelled, "cancel", new Class[] {});
    deadline = SystemClock.elapsedRealtime() + 15000;
    do {
      status = (JSONObject) invoke(cancelled, "status", new Class[] {});
      if (status.optString("state").equals("cancelled")) break;
      SystemClock.sleep(50);
    } while (SystemClock.elapsedRealtime() < deadline);
    check(status.optString("state").equals("cancelled"), "Cancellation did not finish: " + status);
    // Cancel after decoded frames have actually passed through GLES and the encoder.
    Class<?> progressType = type("WallpaperTranscoder$Progress");
    java.util.concurrent.atomic.AtomicInteger rendered =
        new java.util.concurrent.atomic.AtomicInteger();
    Object cancelProgress =
        java.lang.reflect.Proxy.newProxyInstance(
            progressType.getClassLoader(),
            new Class[] {progressType},
            (p, m, args) -> {
              if (m.getName().equals("update")) rendered.incrementAndGet();
              if (m.getName().equals("check") && rendered.get() >= 5)
                throw new java.util.concurrent.CancellationException(
                    "Test mid-decode cancellation");
              return null;
            });
    java.lang.reflect.Field users = type("VideoRenderer").getDeclaredField("displayUsers");
    users.setAccessible(true);
    int beforeUsers = users.getInt(null);
    File partial =
        new File(context.getCacheDir(), "correction-cancel-" + UUID.randomUUID() + ".mp4");
    try {
      try {
        invoke(
            type("WallpaperTranscoder"),
            "convert",
            new Class[] {
              File.class,
              File.class,
              JSONObject.class,
              gradeClass,
              String.class,
              double.class,
              progressType
            },
            new File(source, "inner-idle.mp4"),
            partial,
            clip,
            grade,
            "dynamic-high",
            20d,
            cancelProgress);
        throw new AssertionError("Mid-conversion cancellation was ignored");
      } catch (java.lang.reflect.InvocationTargetException e) {
        check(
            e.getCause() instanceof java.util.concurrent.CancellationException,
            "Unexpected cancellation failure: " + e.getCause());
      }
      check(
          rendered.get() >= 5 && users.getInt(null) == beforeUsers,
          "Cancelled conversion leaked its EGL display");
    } finally {
      partial.delete();
    }
    // Exercise the actual bridge contract for static media and identity loop copies.
    Class<?> host = type("ExplorerBridge$Host");
    java.util.concurrent.atomic.AtomicInteger
        wakeStarts = new java.util.concurrent.atomic.AtomicInteger(),
        wakeEnds = new java.util.concurrent.atomic.AtomicInteger();
    Object proxy =
        java.lang.reflect.Proxy.newProxyInstance(
            host.getClassLoader(),
            new Class[] {host},
            (p, m, args) -> {
              if (m.getName().equals("correctionCopyRunning")) {
                if ((Boolean) args[1]) wakeStarts.incrementAndGet();
                else wakeEnds.incrementAndGet();
              }
              return null;
            });
    Object bridge = make(type("ExplorerBridge"), new Class[] {Context.class, host}, context, proxy);
    try {
      for (String kind : new String[] {"static", "loop"}) {
        File stage = (File) invoke(files, "staging", new Class[] {});
        folders.add(stage);
        Files.copy(
            new File(source, "inner-poster.png").toPath(),
            new File(stage, "cover-poster.png").toPath());
        JSONObject next =
            new JSONObject()
                .put("format", "fractal-wallpaper/v1")
                .put("version", 1)
                .put("screen", "cover")
                .put("kind", kind)
                .put("name", "Bridge " + kind);
        if (kind.equals("loop")) {
          Files.copy(
              new File(source, "inner-idle.mp4").toPath(),
              new File(stage, "cover-idle.mp4").toPath());
          next.put(
              "clips",
              new JSONObject()
                  .put(
                      "closed-steady",
                      new JSONObject(clip.toString()).put("file", "cover-idle.mp4")));
        } else
          next.put(
              "images",
              new JSONObject()
                  .put(
                      "cover",
                      new JSONObject()
                          .put("file", "cover-poster.png")
                          .put("width", 128)
                          .put("height", 96)));
        String sourceId =
            (String)
                invoke(files, "retain", new Class[] {File.class, JSONObject.class}, stage, next);
        File sourceFolder = new File(context.getFilesDir(), "wallpapers/" + sourceId);
        folders.add(sourceFolder);
        JSONObject reply =
            new JSONObject(
                (String)
                    invoke(
                        bridge,
                        "setWallpaperCorrection",
                        new Class[] {String.class, String.class, String.class},
                        sourceId,
                        "cover",
                        curves));
        check(reply.getBoolean("ok"), "Live bridge save failed");
        JSONObject edit =
            new JSONObject(
                (String)
                    invoke(
                        bridge,
                        "wallpaperCorrectionSource",
                        new Class[] {String.class, String.class},
                        sourceId,
                        "cover"));
        check(
            edit.getBoolean("ok")
                && edit.getJSONObject("curves").has("tone")
                && edit.getString("image").startsWith("data:image/png;base64,"),
            "Correction editor source failed");
        JSONObject request =
            new JSONObject()
                .put("name", "Bridge corrected " + kind)
                .put("quality", "dynamic-high")
                .put("curves", kind.equals("loop") ? new JSONObject() : new JSONObject(curves));
        JSONObject start =
            new JSONObject(
                (String)
                    invoke(
                        bridge,
                        "beginWallpaperCorrectionCopy",
                        new Class[] {String.class, String.class, String.class},
                        sourceId,
                        "cover",
                        request.toString()));
        check(start.getBoolean("ok"), "Bridge copy start failed: " + start);
        String token = start.getString("job");
        deadline = SystemClock.elapsedRealtime() + 15000;
        do {
          status =
              new JSONObject(
                  (String)
                      invoke(
                          bridge,
                          "wallpaperCorrectionCopyStatus",
                          new Class[] {String.class},
                          token));
          if (status.optString("state").equals("completed")
              || status.optString("state").equals("failed")) break;
          SystemClock.sleep(50);
        } while (SystemClock.elapsedRealtime() < deadline);
        check(status.optString("state").equals("completed"), "Bridge copy failed: " + status);
        check(
            wakeStarts.get() == wakeEnds.get() && wakeStarts.get() > 0,
            "Copy kept its screen-awake lease after completion");
        File baked = new File(context.getFilesDir(), "wallpapers/" + status.getString("id"));
        folders.add(baked);
        if (kind.equals("loop")) {
          check(
              Arrays.equals(
                  Files.readAllBytes(new File(sourceFolder, "cover-idle.mp4").toPath()),
                  Files.readAllBytes(new File(baked, "cover-idle.mp4").toPath())),
              "Identity bake needlessly re-encoded video");
          check(!new File(baked, "cover-arrival.mp4").exists(), "Loop-only bake invented an entry");
        } else {
          check(!new File(baked, "cover-idle.mp4").exists(), "Static bake created a video");
          Bitmap
              before =
                  BitmapFactory.decodeFile(
                      new File(sourceFolder, "cover-poster.png").getAbsolutePath()),
              after =
                  BitmapFactory.decodeFile(new File(baked, "cover-poster.png").getAbsolutePath());
          try {
            check(
                after.getPixel(12, 12) == corrected(before.getPixel(12, 12)),
                "Baked PNG differs from the correction reference");
          } finally {
            before.recycle();
            after.recycle();
          }
        }
      }
      invoke(bridge, "pauseCorrectionCopy", new Class[] {});
      JSONObject paused =
          new JSONObject(
              (String)
                  invoke(
                      bridge,
                      "beginWallpaperCorrectionCopy",
                      new Class[] {String.class, String.class, String.class},
                      original,
                      "inner",
                      new JSONObject(options.toString())
                          .put("curves", new JSONObject(curves))
                          .toString()));
      check(
          !paused.getBoolean("ok") && paused.getString("error").contains("open"),
          "Background bridge started a conversion");
    } finally {
      invoke(bridge, "close", new Class[] {});
    }
  }

  private void awakeWindow() throws Exception {
    Activity activity =
        startActivitySync(
            new android.content.Intent()
                .setClassName(
                    "org.fractalexplorer.wallpaper", "org.fractalexplorer.wallpaper.MainActivity")
                .addFlags(
                    android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                        | android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK));
    int flag = android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
    try {
      invoke(
          activity,
          "correctionCopyRunning",
          new Class[] {String.class, boolean.class},
          "first",
          true);
      waitForIdleSync();
      check(
          (activity.getWindow().getAttributes().flags & flag) != 0,
          "Conversion did not keep screen awake");
      invoke(
          activity,
          "correctionCopyRunning",
          new Class[] {String.class, boolean.class},
          "second",
          true);
      invoke(
          activity,
          "correctionCopyRunning",
          new Class[] {String.class, boolean.class},
          "first",
          false);
      waitForIdleSync();
      check(
          (activity.getWindow().getAttributes().flags & flag) != 0,
          "Old completion released a newer conversion lease");
      invoke(
          activity,
          "correctionCopyRunning",
          new Class[] {String.class, boolean.class},
          "second",
          false);
      waitForIdleSync();
      check(
          (activity.getWindow().getAttributes().flags & flag) == 0,
          "Completed conversion kept screen awake");
      invoke(
          activity,
          "correctionCopyRunning",
          new Class[] {String.class, boolean.class},
          "late",
          true);
      waitForIdleSync();
      getUiAutomation()
          .injectInputEvent(
              new android.view.KeyEvent(
                  android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME),
              true);
      getUiAutomation()
          .injectInputEvent(
              new android.view.KeyEvent(
                  android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME),
              true);
      SystemClock.sleep(500);
      waitForIdleSync();
      check(
          (activity.getWindow().getAttributes().flags & flag) == 0,
          "Leaving the app retained the awake flag");
      invoke(
          activity,
          "correctionCopyRunning",
          new Class[] {String.class, boolean.class},
          "delayed",
          true);
      waitForIdleSync();
      check(
          (activity.getWindow().getAttributes().flags & flag) == 0,
          "Late callback kept a background activity awake");
    } finally {
      runOnMainSync(activity::finish);
      waitForIdleSync();
    }
  }

  @Override
  public void onStart() {
    Bundle result = new Bundle();
    try {
      check(
          android.os.Build.HARDWARE.contains("ranchu")
              || android.os.Build.HARDWARE.contains("goldfish"),
          "Emulator only");
      gradeClass = type("WallpaperColorGrade");
      filesClass = type("WallpaperFiles");
      galleryClass = type("WallpaperGallery");
      grade = make(gradeClass, new Class[] {JSONObject.class}, new JSONObject(curves));
      gpu();
      jobs();
      awakeWindow();
      result.putString(
          "result",
          "PASS "
              + checks
              + " GLES/reference pixels, native surface conversion, frame counts/timestamps,"
              + " orientation, immutable originals and cancellation checks.");
      finish(Activity.RESULT_OK, result);
    } catch (Throwable error) {
      result.putString("failure", android.util.Log.getStackTraceString(error));
      finish(Activity.RESULT_CANCELED, result);
    } finally {
      for (File folder : folders)
        if (folder.exists()) {
          File[] children = folder.listFiles();
          if (children != null) for (File file : children) file.delete();
          folder.delete();
          String id = folder.getName();
          if (id.matches("[a-f0-9]{32}"))
            getTargetContext()
                .getSharedPreferences("wallpaper", 0)
                .edit()
                .remove("gallery_grade_cover_" + id)
                .remove("gallery_grade_inner_" + id)
                .commit();
        }
    }
  }
}
