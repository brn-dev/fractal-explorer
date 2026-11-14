package org.fractalexplorer.wallpaper.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Surface;
import java.io.*;
import java.lang.reflect.*;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Real renderer pixels for all aspect-preserving orientations; disposable emulator only. */
public final class OrientationInstrumentation extends Instrumentation {
  private int checks;
  private int[] reference;
  private final List<File> folders = new ArrayList<>();
  private Class<?> filesType, rendererType, modeType;
  private Object files;

  @Override
  public void onCreate(Bundle args) {
    super.onCreate(args);
    start();
  }

  private void check(boolean value, String message) {
    checks++;
    if (!value) throw new AssertionError(message);
  }

  private Class<?> type(String name) throws Exception {
    return getTargetContext().getClassLoader().loadClass("org.fractalexplorer.wallpaper." + name);
  }

  private Object make(Class<?> type, Class<?>[] signature, Object... args) throws Exception {
    Constructor<?> c = type.getDeclaredConstructor(signature);
    c.setAccessible(true);
    return c.newInstance(args);
  }

  private Object call(Object object, String name, Class<?>[] signature, Object... args)
      throws Exception {
    Method m = object.getClass().getDeclaredMethod(name, signature);
    m.setAccessible(true);
    return m.invoke(object, args);
  }

  private Object field(Object object, String name) throws Exception {
    Field f = object.getClass().getDeclaredField(name);
    f.setAccessible(true);
    return f.get(object);
  }

  private Bitmap frame() {
    int[] pixels = new int[128 * 96];
    int[] colors = {0xffd03020, 0xff20c040, 0xff2040d0, 0xffb0a020};
    for (int y = 0; y < 96; y++)
      for (int x = 0; x < 128; x++)
        pixels[y * 128 + x] = colors[(x >= 64 ? 1 : 0) + (y >= 48 ? 2 : 0)];
    return Bitmap.createBitmap(pixels, 128, 96, Bitmap.Config.ARGB_8888);
  }

  private File video() throws Exception {
    File file = new File(getTargetContext().getCacheDir(), "orientation-video.mp4");
    Object encoder =
        make(
            type("NativeVideoEncoder"),
            new Class[] {File.class, int.class, int.class, int.class, int.class},
            file,
            128,
            96,
            15,
            5000000);
    Bitmap image = frame();
    try {
      for (int i = 0; i < 15; i++)
        call(encoder, "add", new Class[] {Bitmap.class, int.class}, image, i);
      call(encoder, "finish", new Class[] {});
    } finally {
      image.recycle();
      call(encoder, "close", new Class[] {});
    }
    return file;
  }

  private String fixture(String screen, boolean image, File video) throws Exception {
    File folder = (File) call(files, "staging", new Class[] {});
    Bitmap bitmap = frame();
    try (FileOutputStream output = new FileOutputStream(new File(folder, screen + "-poster.png"))) {
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
    } finally {
      bitmap.recycle();
    }
    JSONObject manifest =
        new JSONObject()
            .put("format", "fractal-wallpaper/v1")
            .put("version", 1)
            .put("screen", screen)
            .put("kind", image ? "static" : "animated")
            .put("name", "Orientation fixture");
    if (image) {
      manifest.put(
          "images",
          new JSONObject()
              .put(
                  screen,
                  new JSONObject()
                      .put("file", screen + "-poster.png")
                      .put("width", 128)
                      .put("height", 96)));
    } else {
      JSONObject clips = new JSONObject();
      String prefix = screen.equals("cover") ? "closed" : "open";
      for (String slot : new String[] {"arrival", "idle"}) {
        String filename = screen + "-" + slot + ".mp4";
        Files.copy(video.toPath(), new File(folder, filename).toPath());
        clips.put(
            prefix + (slot.equals("arrival") ? "-transition" : "-steady"),
            new JSONObject()
                .put("file", filename)
                .put("width", 128)
                .put("height", 96)
                .put("duration", 1));
      }
      manifest.put("clips", clips);
    }
    String id =
        (String)
            call(files, "publish", new Class[] {File.class, JSONObject.class}, folder, manifest);
    folders.add(new File(getTargetContext().getFilesDir(), "wallpapers/" + id));
    return id;
  }

  private int[] sample(ImageReader reader) throws Exception {
    try (Image image = reader.acquireLatestImage()) {
      if (image == null) return null;
      check(image.getWidth() == 128 && image.getHeight() == 96, "Output dimensions changed");
      Image.Plane plane = image.getPlanes()[0];
      ByteBuffer bytes = plane.getBuffer();
      int[] result = new int[4];
      for (int corner = 0; corner < 4; corner++) {
        int x = (corner & 1) == 0 ? 16 : 112, y = (corner & 2) == 0 ? 12 : 84;
        int offset = y * plane.getRowStride() + x * plane.getPixelStride();
        result[corner] =
            ((bytes.get(offset) & 255) << 16)
                | ((bytes.get(offset + 1) & 255) << 8)
                | (bytes.get(offset + 2) & 255);
      }
      return result;
    }
  }

  private void pixels(int[] colors, int orientation, int tolerance) {
    if (reference == null) {
      reference = colors.clone();
      Set<Integer> distinct = new HashSet<>();
      for (int c : colors) distinct.add(c);
      check(distinct.size() == 4, "Asymmetric reference lost its four colors");
    }
    for (int i = 0; i < 4; i++)
      for (int c = 0; c < 3; c++)
        check(
            Math.abs(
                    ((colors[i] >> (c * 8)) & 255)
                        - ((reference[i ^ orientation] >> (c * 8)) & 255))
                <= tolerance,
            "Pixel mismatch for orientation " + orientation + ", corner " + i);
  }

  private void stage(
      Object renderer, ImageReader reader, String stage, int orientation, boolean video)
      throws Exception {
    long until = SystemClock.elapsedRealtime() + 7000;
    boolean sampled = false;
    while (SystemClock.elapsedRealtime() < until) {
      int[] colors = sample(reader);
      if (colors != null) {
        pixels(colors, orientation, 20);
        sampled = true;
      }
      Object state = field(renderer, "state");
      if (sampled
          && field(state, "stage").toString().equals(stage)
          && (!video || (Boolean) field(renderer, "showVideo"))) {
        check(
            (Integer) field(renderer, "orientation") == orientation,
            "Renderer changed orientation within playback");
        return;
      }
      Thread.sleep(12);
    }
    throw new AssertionError(
        "Renderer never reached " + stage + ": " + field(field(renderer, "state"), "stage"));
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  private void test(String screen, String id, boolean image, int orientation) throws Exception {
    android.content.SharedPreferences prefs =
        getTargetContext().getSharedPreferences("wallpaper", 0);
    JSONObject manifest =
        new JSONObject(
            new String(
                Files.readAllBytes(
                    new File(
                            getTargetContext().getFilesDir(),
                            "wallpapers/" + id + "/wallpaper.json")
                        .toPath()),
                "UTF-8"));
    call(
        files,
        "activateLocked",
        new Class[] {String.class, JSONObject.class, String.class, boolean.class, int.class},
        id,
        manifest,
        screen,
        true,
        orientation);
    long revision = prefs.getLong(screen + "_revision", 0);
    Object mode = Enum.valueOf((Class) modeType, screen.equals("cover") ? "COVER" : "INNER");
    try (ImageReader reader = ImageReader.newInstance(128, 96, PixelFormat.RGBX_8888, 4)) {
      Object renderer =
          make(
              rendererType,
              new Class[] {android.content.Context.class, Surface.class, boolean.class},
              getTargetContext(),
              reader.getSurface(),
              false);
      try {
        Class<?>[] signature = {
          int.class,
          int.class,
          modeType,
          boolean.class,
          boolean.class,
          boolean.class,
          boolean.class,
          long.class,
          long.class,
          long.class
        };
        call(
            renderer,
            "configure",
            signature,
            128,
            96,
            mode,
            true,
            true,
            !image,
            false,
            revision,
            1L,
            SystemClock.elapsedRealtime());
        stage(renderer, reader, image ? "STILL" : "ARRIVAL", orientation, !image);
        if (!image) {
          stage(renderer, reader, "IDLE", orientation, true);
          call(
              renderer,
              "configure",
              signature,
              128,
              96,
              mode,
              true,
              true,
              true,
              true,
              revision,
              1L,
              SystemClock.elapsedRealtime());
          stage(renderer, reader, "STILL", orientation, false);
          check(field(renderer, "player") == null, "Battery Saver retained a video decoder");
        }
      } finally {
        call(renderer, "close", new Class[] {});
        check(
            ((CountDownLatch) field(renderer, "closedDone")).await(5, TimeUnit.SECONDS),
            "Renderer did not close");
      }
    }
  }

  @Override
  public void onStart() {
    Bundle result = new Bundle();
    File video = null;
    try {
      check(
          android.os.Build.HARDWARE.contains("ranchu")
              || android.os.Build.HARDWARE.contains("goldfish"),
          "Emulator only");
      filesType = type("WallpaperFiles");
      rendererType = type("VideoRenderer");
      modeType = type("PlaybackState$Mode");
      files = make(filesType, new Class[] {android.content.Context.class}, getTargetContext());
      video = video();
      for (String screen : new String[] {"cover", "inner"}) {
        String still = fixture(screen, true, video), animated = fixture(screen, false, video);
        for (boolean image : new boolean[] {true, false})
          for (int orientation = 0; orientation < 4; orientation++)
            test(screen, image ? still : animated, image, orientation);
      }
      result.putString(
          "result",
          "PASS "
              + checks
              + " actual renderer pixel, unchanged aspect, static/entry/loop/Battery Saver and"
              + " both-screen orientation checks.");
      finish(Activity.RESULT_OK, result);
    } catch (Throwable error) {
      result.putString("failure", android.util.Log.getStackTraceString(error));
      finish(Activity.RESULT_CANCELED, result);
    } finally {
      if (video != null) video.delete();
      for (File folder : folders) {
        File[] children = folder.listFiles();
        if (children != null) for (File file : children) file.delete();
        folder.delete();
      }
    }
  }
}
