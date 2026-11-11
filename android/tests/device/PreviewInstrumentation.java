package org.fractalexplorer.wallpaper.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.os.Handler;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.WindowInsets;
import android.webkit.WebView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real media, immersive activity and touch dismissal checks. Run on an emulator only. */
public final class PreviewInstrumentation extends Instrumentation {
  private final List<File> fixtures = new ArrayList<>();
  private final Bundle results = new Bundle();
  private int checks;
  private boolean quick;

  @Override
  public void onCreate(Bundle args) {
    super.onCreate(args);
    quick = args != null && "true".equals(args.getString("quick"));
    start();
  }

  private void check(boolean value, String message) {
    checks++;
    if (!value) throw new AssertionError(message);
  }

  private static Object field(Object object, String name) throws Exception {
    Field f = object.getClass().getDeclaredField(name);
    f.setAccessible(true);
    return f.get(object);
  }

  private void flush(Object renderer) throws Exception {
    CountDownLatch ready = new CountDownLatch(1);
    ((Handler) field(renderer, "handler")).post(ready::countDown);
    check(ready.await(5, TimeUnit.SECONDS), "Renderer thread did not respond");
  }

  private String fixture(String screen, String kind) throws Exception {
    String id = UUID.randomUUID().toString().replace("-", "");
    File directory = new File(getTargetContext().getFilesDir(), "wallpapers/" + id);
    check(directory.mkdirs(), "Cannot stage preview fixture");
    fixtures.add(directory);
    boolean image = "static".equals(kind), entry = "animated".equals(kind) || "still".equals(kind);
    List<String> files = new ArrayList<>();
    files.add(screen + "-poster.png");
    if (!image) files.add(screen + "-idle.mp4");
    if (entry) files.add(screen + "-arrival.mp4");
    for (String name : files)
      try (InputStream in = getTargetContext().getAssets().open(name);
          FileOutputStream out = new FileOutputStream(new File(directory, name))) {
        byte[] buffer = new byte[32768];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
      }
    JSONObject manifest =
        new JSONObject()
            .put("format", "fractal-wallpaper/v1")
            .put("version", 1)
            .put("screen", screen)
            .put("kind", "still".equals(kind) ? "animated" : kind)
            .put("name", "Preview " + screen + " " + kind)
            .put("steadyMotion", "still".equals(kind) ? "still" : "animated");
    JSONObject clips = new JSONObject();
    for (String name : files)
      if (name.endsWith(".mp4")) {
        String key =
            ("cover".equals(screen) ? "closed" : "open")
                + (name.endsWith("arrival.mp4") ? "-transition" : "-steady");
        clips.put(key, new JSONObject().put("file", name));
      }
    manifest.put("clips", clips);
    java.nio.file.Files.write(
        new File(directory, "wallpaper.json").toPath(),
        manifest.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    return id;
  }

  private String eval(WebView web, String code) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    String[] value = new String[1];
    runOnMainSync(
        () ->
            web.evaluateJavascript(
                code,
                result -> {
                  value[0] = result;
                  done.countDown();
                }));
    check(done.await(10, TimeUnit.SECONDS), "JavaScript timed out");
    return value[0] == null ? "null" : value[0];
  }

  private void waitJS(WebView web, String condition) throws Exception {
    long until = SystemClock.elapsedRealtime() + 60000;
    while (SystemClock.elapsedRealtime() < until) {
      if ("true".equals(eval(web, condition))) return;
      Thread.sleep(100);
    }
    throw new AssertionError("Gallery condition timed out: " + condition);
  }

  private static WebView web(android.view.View view) {
    if (view instanceof WebView) return (WebView) view;
    if (view instanceof android.view.ViewGroup)
      for (int i = 0; i < ((android.view.ViewGroup) view).getChildCount(); i++) {
        WebView found = web(((android.view.ViewGroup) view).getChildAt(i));
        if (found != null) return found;
      }
    return null;
  }

  private Object renderer(Activity preview) throws Exception {
    long until = SystemClock.elapsedRealtime() + 15000;
    while (SystemClock.elapsedRealtime() < until) {
      Object renderer = field(preview, "renderer");
      if (renderer != null) return renderer;
      if (preview.isFinishing()) throw new AssertionError("Preview closed during startup");
      Thread.sleep(50);
    }
    throw new AssertionError("Preview renderer never started");
  }

  private void stage(Object renderer, String expected, boolean video) throws Exception {
    long until = SystemClock.elapsedRealtime() + 15000;
    while (SystemClock.elapsedRealtime() < until) {
      flush(renderer);
      Object state = field(renderer, "state");
      String actual = field(state, "stage").toString();
      if (expected.equals(actual) && (!video || (Boolean) field(renderer, "showVideo"))) return;
      Thread.sleep(50);
    }
    throw new AssertionError(
        "Preview did not reach "
            + expected
            + "; actual="
            + field(field(renderer, "state"), "stage"));
  }

  private void screenshot(String name) throws Exception {
    File folder = getTargetContext().getExternalFilesDir("preview-tests");
    if (folder == null) return;
    folder.mkdirs();
    Bitmap image = getUiAutomation().takeScreenshot();
    check(image != null, "Screenshot unavailable");
    try (FileOutputStream out = new FileOutputStream(new File(folder, name))) {
      image.compress(Bitmap.CompressFormat.PNG, 100, out);
    } finally {
      image.recycle();
    }
  }

  private void tap(Activity preview, float x, float y) {
    long now = SystemClock.uptimeMillis();
    MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0),
        up = MotionEvent.obtain(now, now + 30, MotionEvent.ACTION_UP, x, y, 0);
    down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    check(getUiAutomation().injectInputEvent(down, true), "Touch down was not injected");
    check(getUiAutomation().injectInputEvent(up, true), "Touch up was not injected");
    down.recycle();
    up.recycle();
  }

  @Override
  public void onStart() {
    Activity main = null;
    try {
      // Avoid accidentally running fixture creation on a physical phone.
      check(
          android.os.Build.FINGERPRINT.contains("generic")
              || android.os.Build.MODEL.contains("sdk_gphone"),
          "Emulator only");
      // Android's one-time system tutorial otherwise intercepts test taps above
      // the preview. This setup applies only to the disposable emulator.
      try (android.os.ParcelFileDescriptor ignored =
          getUiAutomation()
              .executeShellCommand("settings put secure immersive_mode_confirmations confirmed")) {
        Thread.sleep(100);
      }
      Map<String, String> ids = new HashMap<>();
      for (String screen : new String[] {"cover", "inner"})
        for (String kind : new String[] {"animated", "loop", "static", "still"})
          ids.put(screen + ":" + kind, fixture(screen, kind));
      main =
          startActivitySync(
              new Intent()
                  .setClassName(getTargetContext(), "org.fractalexplorer.wallpaper.MainActivity")
                  .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                  .putExtra("wallpaper_gallery", true));
      WebView[] found = new WebView[1];
      Activity parent = main;
      runOnMainSync(() -> found[0] = web(parent.getWindow().getDecorView()));
      WebView web = found[0];
      check(web != null, "Explorer WebView missing");
      waitJS(
          web,
          "document.getElementById('wallpaper-gallery-dialog').open &&"
              + " document.querySelectorAll('.wallpaper-gallery-card').length > 0");
      SharedPreferences prefs = getTargetContext().getSharedPreferences("wallpaper", 0);
      Map<String, ?> before = new HashMap<>(prefs.getAll());
      Thread.sleep(300);
      screenshot("gallery.png");
      for (String screen : quick ? new String[] {"inner"} : new String[] {"cover", "inner"})
        for (String kind :
            quick ? new String[] {"loop"} : new String[] {"animated", "loop", "static", "still"}) {
          String id = ids.get(screen + ":" + kind);
          eval(
              web,
              "document.getElementById('wallpaper-gallery-screen').value='"
                  + screen
                  + "';document.getElementById('wallpaper-gallery-screen').dispatchEvent(new"
                  + " Event('change'));true");
          ActivityMonitor monitor =
              addMonitor("org.fractalexplorer.wallpaper.WallpaperPreviewActivity", null, false);
          String title = "Preview " + screen + " " + kind;
          String button =
              "Array.from(Array.from(document.querySelectorAll('.wallpaper-gallery-card')).find(c=>c.querySelector('h3').textContent==="
                  + JSONObject.quote(title)
                  + ").querySelectorAll('button')).find(b=>b.textContent==='Preview')";
          if (quick) {
            eval(
                web,
                "window.__previewButton="
                    + button
                    + ";__previewButton.scrollIntoView({block:'center'});true");
            Thread.sleep(400);
            screenshot("gallery-button.png");
            String encoded =
                eval(
                    web,
                    "JSON.stringify((()=>{const r=__previewButton.getBoundingClientRect();return"
                        + " {x:r.left+r.width/2,y:r.top+r.height/2,viewport:innerWidth};})())");
            JSONObject location = new JSONObject(new JSONArray("[" + encoded + "]").getString(0));
            int[] origin = new int[2];
            runOnMainSync(() -> web.getLocationOnScreen(origin));
            float scale = web.getWidth() / (float) location.getDouble("viewport");
            tap(
                main,
                origin[0] + (float) location.getDouble("x") * scale,
                origin[1] + (float) location.getDouble("y") * scale);
          } else eval(web, button + ".click();true");
          Activity preview = monitor.waitForActivityWithTimeout(10000);
          removeMonitor(monitor);
          check(preview != null, "Preview button did not launch native activity");
          Object renderer = renderer(preview);
          if ("animated".equals(kind) || "still".equals(kind)) {
            stage(renderer, "ARRIVAL", true);
            MediaPlayer entry = (MediaPlayer) field(renderer, "player");
            check(!entry.isLooping(), "Entry must play once");
            screenshot(screen + "-entry.png");
            stage(renderer, "still".equals(kind) ? "STILL" : "IDLE", !"still".equals(kind));
          } else stage(renderer, "static".equals(kind) ? "STILL" : "IDLE", !"static".equals(kind));
          if ("static".equals(kind) || "still".equals(kind))
            check(field(renderer, "player") == null, "Still state kept a decoder alive");
          else
            check(
                ((MediaPlayer) field(renderer, "player")).isLooping(),
                "Steady animation must loop");
          boolean[] bars = new boolean[1];
          runOnMainSync(
              () ->
                  bars[0] =
                      preview
                          .getWindow()
                          .getDecorView()
                          .getRootWindowInsets()
                          .isVisible(WindowInsets.Type.systemBars()));
          check(!bars[0], "Preview is not immersive");
          screenshot(screen + "-" + kind + ".png");
          if ("loop".equals(kind) && "inner".equals(screen)) {
            try (android.os.ParcelFileDescriptor ignored =
                getUiAutomation().executeShellCommand("input keyevent KEYCODE_BACK")) {
              Thread.sleep(100);
            }
          } else {
            android.view.View decor = preview.getWindow().getDecorView();
            tap(
                preview,
                decor.getWidth() / 2f,
                "inner".equals(screen) ? 100 : decor.getHeight() / 2f);
          }
          long until = SystemClock.elapsedRealtime() + 5000;
          while (!preview.isFinishing() && SystemClock.elapsedRealtime() < until) Thread.sleep(30);
          check(preview.isFinishing(), "Touch or Back did not dismiss preview");
          check(
              ((CountDownLatch) field(renderer, "closedDone")).await(5, TimeUnit.SECONDS),
              "Decoder cleanup did not finish");
          check(field(renderer, "player") == null, "Decoder survived preview dismissal");
          waitJS(web, "document.getElementById('wallpaper-gallery-dialog').open");
          check(
              ("\"" + screen + "\"")
                  .equals(eval(web, "document.getElementById('wallpaper-gallery-screen').value")),
              "Gallery returned to wrong screen");
          check(
              before.equals(prefs.getAll()),
              "Preview modified active wallpaper, playback settings or shuffle");
          results.putString(
              screen + "-" + kind,
              "PASS: real media, immersive, entry/steady, tap/back, cleanup, unchanged selection");
          sendStatus(0, results);
        }
      check(
          "true"
              .equals(
                  eval(
                      web,
                      "!JSON.parse(FractalNative.previewWallpaper('bad','inner')).ok &&"
                          + " document.getElementById('wallpaper-gallery-dialog').open")),
          "Bad preview request changed gallery");
      results.putInt("checks", checks);
      finish(Activity.RESULT_OK, results);
    } catch (Throwable error) {
      results.putString("failure", android.util.Log.getStackTraceString(error));
      finish(Activity.RESULT_CANCELED, results);
    } finally {
      if (main != null) {
        Activity parent = main;
        runOnMainSync(parent::finish);
      }
      for (File folder : fixtures) {
        File[] files = folder.listFiles();
        if (files != null) for (File file : files) file.delete();
        folder.delete();
      }
    }
  }
}
