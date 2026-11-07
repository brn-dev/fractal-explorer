package org.fractalexplorer.wallpaper.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.os.Bundle;
import android.os.Handler;
import android.os.SystemClock;
import android.util.Log;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;

/** Exercises the real APK and native encoder; no mocks, network, or browser server. */
public final class SmokeInstrumentation extends Instrumentation {
  private boolean importFixture;

  @Override
  public void onCreate(Bundle args) {
    super.onCreate(args);
    importFixture = args != null && "true".equals(args.getString("importFixture"));
    start();
  }

  @Override
  public void onStart() {
    Bundle result = new Bundle();
    try {
      File orphan =
          new File(
              getTargetContext().getFilesDir(),
              "wallpapers/pending-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
      if (!orphan.isDirectory() && !orphan.mkdirs())
        throw new AssertionError("Cannot stage recovery fixture");
      java.nio.file.Files.write(new File(orphan, "cover-arrival.mp4").toPath(), new byte[] {1});
      File abandonedImport =
          new File(
              getTargetContext().getCacheDir(),
              "clip-imports/cccccccccccccccccccccccccccccccc.mp4");
      abandonedImport.getParentFile().mkdirs();
      java.nio.file.Files.write(abandonedImport.toPath(), new byte[] {1});
      File export =
          new File(
              getTargetContext().getCacheDir(),
              "exports/ffffffffffffffffffffffffffffffff.download");
      if (!export.getParentFile().isDirectory() && !export.getParentFile().mkdirs())
        throw new AssertionError("No export fixture folder");
      byte[] exportBytes = new byte[32768];
      for (int i = 0; i < exportBytes.length; i++) exportBytes[i] = (byte) i;
      java.nio.file.Files.write(export.toPath(), exportBytes);
      File recoveredFile = new File(getTargetContext().getFilesDir(), "smoke-recovered.bin");
      java.nio.file.Files.write(recoveredFile.toPath(), new byte[65536]);
      getTargetContext()
          .getSharedPreferences("export-copies", 0)
          .edit()
          .putString(export.getName(), android.net.Uri.fromFile(recoveredFile).toString())
          .commit();
      Intent intent =
          new Intent()
              .setClassName(
                  "org.fractalexplorer.wallpaper", "org.fractalexplorer.wallpaper.MainActivity")
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      Activity activity = startActivitySync(intent);
      final WebView[] found = new WebView[1];
      runOnMainSync(() -> found[0] = find(activity.getWindow().getDecorView()));
      WebView web = found[0];
      if (web == null) throw new AssertionError("Explorer WebView not found");
      waitFor(web, "document.getElementById('render-dot')?.dataset.state === 'ready'", 90000);
      if (orphan.exists()) throw new AssertionError("Abandoned package was not recovered");
      if (abandonedImport.exists())
        throw new AssertionError("Abandoned import cache was not recovered");
      if (export.exists()
          || !java.util.Arrays.equals(
              exportBytes, java.nio.file.Files.readAllBytes(recoveredFile.toPath())))
        throw new AssertionError("Interrupted export did not recover/truncate/clean source");
      recoveredFile.delete();
      result.putString(
          "recovery", "PASS: abandoned package removed and interrupted export recovered");
      eval(web, "window.__smokeOldPage=true;localStorage.clear();location.reload();true");
      waitFor(
          web,
          "!window.__smokeOldPage && document.getElementById('render-dot')?.dataset.state ==="
              + " 'ready'",
          60000);
      String capabilities =
          eval(
              web,
              "JSON.stringify({secure:isSecureContext,gpu:!!navigator.gpu,bridge:JSON.parse(FractalNative.info()),worker:typeof"
                  + " Worker,codec:typeof VideoEncoder})");
      Log.i("FractalSmoke", "Capabilities: " + capabilities);
      result.putString("capabilities", capabilities);
      if (!eval(
              web,
              "JSON.parse(FractalNative.supportsVideo(JSON.stringify({width:1920,height:1080,fps:30,bitrate:2000000001}))).supported"
                  + " === false")
          .equals("true")) throw new AssertionError("Native quality was silently downgraded");
      eval(web, "document.getElementById('export').click();true");
      try (android.os.ParcelFileDescriptor command =
          getUiAutomation().executeShellCommand("input keyevent KEYCODE_BACK")) {
        Thread.sleep(300);
      }
      waitFor(web, "!document.getElementById('export-dialog').open", 10000);
      eval(
          web,
          "document.getElementById('iterations-slider').value=100;document.getElementById('iterations-slider').dispatchEvent(new"
              + " Event('input'));document.getElementById('center-y').value='.2';document.getElementById('apply-coordinates').click();true");
      waitFor(web, "document.getElementById('render-dot').dataset.state === 'ready'", 60000);
      eval(
          web,
          "localStorage.removeItem('fractal-web-wallpaper-v1');document.getElementById('export').click();document.getElementById('open-wallpaper-export').click();true");
      waitFor(web, "document.getElementById('wallpaper-dialog').open", 10000);
      android.content.SharedPreferences selections =
          getTargetContext().getSharedPreferences("wallpaper", 0);
      for (String screen : new String[] {"inner", "cover"}) {
        String prefix = "cover".equals(screen) ? "closed" : "open";
        eval(
            web,
            "document.getElementById('wallpaper-screen').value='"
                + screen
                + "';document.getElementById('wallpaper-screen').onchange();true");
        eval(
            web,
            "for(const [id,value] of [['wallpaper-"
                + prefix
                + "-transition-seconds','.5'],['wallpaper-idle-seconds','2'],['wallpaper-size','480'],['wallpaper-idle-fps','10'],['wallpaper-steady-motion','still']]){const"
                + " input=document.getElementById(id);input.value=value;input.dispatchEvent(new"
                + " Event('change'));}document.getElementById('wallpaper-create').click();true");
        waitFor(
            web,
            "document.getElementById('wallpaper-cancel').hidden &&"
                + " document.getElementById('wallpaper-status').textContent.includes('saved and"
                + " selected')",
            180000);
        if (!selections.getString("active_" + screen, "").matches("[a-f0-9]{32}"))
          throw new AssertionError("No active " + screen + " package");
        if (selections.getBoolean(screen + "_idle", true))
          throw new AssertionError("Transition-only choice not activated");
      }
      String id = selections.getString("active_inner", ""),
          coverId = selections.getString("active_cover", "");
      eval(web, "FractalNative.beginPack();FractalNative.cancelPack();true");
      if (!id.equals(selections.getString("active_inner", ""))
          || !coverId.equals(selections.getString("active_cover", "")))
        throw new AssertionError("Cancellation changed a selection");
      for (String screen : new String[] {"cover", "inner"}) {
        File folder =
            new File(
                new File(getTargetContext().getFilesDir(), "wallpapers"),
                selections.getString("active_" + screen, ""));
        for (String name :
            new String[] {
              screen + "-arrival.mp4",
              screen + "-idle.mp4",
              screen + "-poster.png",
              "wallpaper.json"
            }) if (!new File(folder, name).isFile()) throw new AssertionError("Missing " + name);
        Bitmap poster =
            BitmapFactory.decodeFile(new File(folder, screen + "-poster.png").getAbsolutePath());
        try (MediaMetadataRetriever reader = new MediaMetadataRetriever()) {
          reader.setDataSource(new File(folder, screen + "-idle.mp4").getAbsolutePath());
          int width = poster.getWidth(), height = poster.getHeight();
          float scale = 128f / Math.max(width, height);
          Bitmap frame =
              reader.getScaledFrameAtTime(
                  0,
                  MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                  Math.round(width * scale),
                  Math.round(height * scale));
          Bitmap expected =
              Bitmap.createScaledBitmap(poster, frame.getWidth(), frame.getHeight(), true);
          double normal = difference(expected, frame, false),
              flipped = difference(expected, frame, true);
          result.putString(screen + "_rgb_error", String.valueOf(normal));
          Log.i("FractalSmoke", screen + " RGB difference " + normal + ", flipped " + flipped);
          if (normal > 12 || normal > flipped + 1)
            throw new AssertionError("Encoded image differs or is flipped: " + normal);
          expected.recycle();
          frame.recycle();
        } finally {
          poster.recycle();
        }
      }
      testPlayback(activity);
      result.putString(
          "playback",
          "PASS: arrival, static poster with no player, idle toggle, hidden, inner arrival, Battery"
              + " Saver");
      new GalleryChecks(this).run(activity, result);
      eval(web, "FractalNative.applyWallpaperScreen('" + coverId + "','cover');true");
      File fixtureMedia = new File(getTargetContext().getCacheDir(), "smoke-source-media");
      fixtureMedia.mkdirs();
      for (String screen : new String[] {"cover", "inner"}) {
        File folder =
            new File(
                new File(getTargetContext().getFilesDir(), "wallpapers"),
                selections.getString("active_" + screen, ""));
        for (String name :
            new String[] {screen + "-arrival.mp4", screen + "-idle.mp4", screen + "-poster.png"})
          java.nio.file.Files.copy(
              new File(folder, name).toPath(),
              new File(fixtureMedia, name).toPath(),
              java.nio.file.StandardCopyOption.REPLACE_EXISTING);
      }
      new StorageChecks(this).replaceClip(fixtureMedia, result);
      if (importFixture) {
        Class<?> storage =
            Class.forName(
                "org.fractalexplorer.wallpaper.WallpaperFiles",
                true,
                getTargetContext().getClassLoader());
        java.lang.reflect.Constructor<?> constructor =
            storage.getDeclaredConstructor(android.content.Context.class);
        constructor.setAccessible(true);
        Object store = constructor.newInstance(getTargetContext());
        java.lang.reflect.Method importer =
            storage.getDeclaredMethod("importZip", java.io.InputStream.class);
        importer.setAccessible(true);
        try (java.io.InputStream source =
            new android.os.ParcelFileDescriptor.AutoCloseInputStream(
                getUiAutomation()
                    .executeShellCommand("cat /sdcard/Download/fractal-wallpaper-test.zip"))) {
          importer.invoke(store, source);
        }
        if (id.equals(
            getTargetContext().getSharedPreferences("wallpaper", 0).getString("active_inner", "")))
          throw new AssertionError("Desktop package import did not activate");
        if (getTargetContext().getSharedPreferences("wallpaper", 0).getBoolean("inner_idle", true))
          throw new AssertionError("Desktop transition-only preference was not activated");
        result.putString("desktop_import", "PASS");
        new StorageChecks(this).concurrentImports(store, importer);
        result.putString("concurrent_import", "PASS");
        new StorageChecks(this).overlappingSettingsImport();
        result.putString(
            "settings_overlap",
            "PASS: mutation controls stay locked across settings instances until import completes");
      }
      result.putString(
          "result",
          "PASS: offline WebView, real worker rendering, four native H.264 clips, atomic"
              + " activation/cancellation, and encoded pixels");
      finish(Activity.RESULT_OK, result);
    } catch (Throwable error) {
      Log.e("FractalSmoke", "Device test failed", error);
      result.putString("error", Log.getStackTraceString(error));
      finish(Activity.RESULT_CANCELED, result);
    }
  }

  private static Object field(Object target, String name) throws Exception {
    java.lang.reflect.Field f = target.getClass().getDeclaredField(name);
    f.setAccessible(true);
    return f.get(target);
  }

  /** Exercise the production renderer against a real Android surface and real decoders. */
  private void testPlayback(Activity activity) throws Exception {
    SurfaceView[] surface = new SurfaceView[1];
    CountDownLatch ready = new CountDownLatch(1);
    runOnMainSync(
        () -> {
          surface[0] = new SurfaceView(activity);
          surface[0]
              .getHolder()
              .addCallback(
                  new SurfaceHolder.Callback() {
                    public void surfaceCreated(SurfaceHolder holder) {
                      ready.countDown();
                    }

                    public void surfaceChanged(
                        SurfaceHolder holder, int format, int width, int height) {}

                    public void surfaceDestroyed(SurfaceHolder holder) {}
                  });
          activity.addContentView(surface[0], new ViewGroup.LayoutParams(300, 400));
        });
    if (!ready.await(10, TimeUnit.SECONDS)) throw new AssertionError("No playback test surface");
    Class<?> type =
        Class.forName(
            "org.fractalexplorer.wallpaper.VideoRenderer",
            true,
            getTargetContext().getClassLoader());
    java.lang.reflect.Constructor<?> constructor =
        type.getDeclaredConstructor(android.content.Context.class, android.view.Surface.class);
    constructor.setAccessible(true);
    Object renderer =
        constructor.newInstance(getTargetContext(), surface[0].getHolder().getSurface());
    Handler handler = (Handler) field(renderer, "handler");
    java.lang.reflect.Method configure = null;
    for (java.lang.reflect.Method method : type.getDeclaredMethods())
      if (method.getName().equals("configure")) configure = method;
    if (configure == null) throw new AssertionError("Missing renderer configuration");
    configure.setAccessible(true);
    Object[] modes = configure.getParameterTypes()[2].getEnumConstants();
    try {
      configure.invoke(renderer, 300, 400, modes[0], true, false, true, false, 1L, 1L, 0L);
      waitPlayback(renderer, handler, "ARRIVAL:true", false);
      waitPlayback(renderer, handler, "STILL:false:false", true);
      Thread.sleep(700);
      waitPlayback(renderer, handler, "STILL:false:false", true);
      configure.invoke(renderer, 300, 400, modes[0], true, true, true, false, 1L, 1L, 1000L);
      waitPlayback(renderer, handler, "IDLE:true:true", true);
      android.graphics.SurfaceTexture retired =
          (android.graphics.SurfaceTexture) field(renderer, "videoTexture");
      android.graphics.SurfaceTexture.OnFrameAvailableListener retiredListener =
          (android.graphics.SurfaceTexture.OnFrameAvailableListener)
              field(renderer, "videoFrameListener");
      configure.invoke(renderer, 300, 400, modes[0], false, true, true, false, 1L, 1L, 1100L);
      waitPlayback(renderer, handler, "HIDDEN:false", false);
      configure.invoke(renderer, 300, 400, modes[1], true, false, true, false, 1L, 2L, 1200L);
      waitPlayback(renderer, handler, "ARRIVAL:true", false);
      checkRetiredFrame(renderer, handler, retired, retiredListener);
      waitPlayback(renderer, handler, "STILL:false:false", true);
      configure.invoke(renderer, 300, 400, modes[1], true, true, true, true, 1L, 2L, 1300L);
      waitPlayback(renderer, handler, "STILL:false:false", true);
    } finally {
      java.lang.reflect.Method close = type.getDeclaredMethod("close");
      close.setAccessible(true);
      close.invoke(renderer);
      ((Thread) field(renderer, "thread")).join(5000);
      runOnMainSync(() -> ((ViewGroup) surface[0].getParent()).removeView(surface[0]));
    }
  }

  private void checkRetiredFrame(
      Object renderer,
      Handler handler,
      android.graphics.SurfaceTexture retired,
      android.graphics.SurfaceTexture.OnFrameAvailableListener listener)
      throws Exception {
    CountDownLatch checked = new CountDownLatch(1);
    java.util.concurrent.atomic.AtomicReference<Throwable> failure =
        new java.util.concurrent.atomic.AtomicReference<>();
    handler.post(
        () -> {
          try {
            Object currentTexture = field(renderer, "videoTexture"),
                currentPlayer = field(renderer, "player");
            Object stage = field(field(renderer, "state"), "stage"),
                showing = field(renderer, "showVideo");
            if (retired == currentTexture || currentPlayer == null)
              throw new AssertionError("Decoder queue was reused");
            listener.onFrameAvailable(
                retired); // Android can dispatch this after the old player releases.
            if (field(renderer, "videoTexture") != currentTexture
                || field(renderer, "player") != currentPlayer
                || field(field(renderer, "state"), "stage") != stage
                || !field(renderer, "showVideo").equals(showing))
              throw new AssertionError("Retired frame changed current artwork/player");
          } catch (Throwable error) {
            failure.set(error);
          }
          checked.countDown();
        });
    if (!checked.await(5, TimeUnit.SECONDS))
      throw new AssertionError("Retired frame check stalled");
    if (failure.get() != null)
      throw new AssertionError("Retired frame check failed", failure.get());
  }

  private void waitPlayback(Object renderer, Handler handler, String expected, boolean exact)
      throws Exception {
    long deadline = SystemClock.elapsedRealtime() + 10000;
    String[] actual = new String[1];
    while (SystemClock.elapsedRealtime() < deadline) {
      CountDownLatch sampled = new CountDownLatch(1);
      handler.post(
          () -> {
            try {
              actual[0] =
                  field(field(renderer, "state"), "stage")
                      + ":"
                      + (field(renderer, "player") != null)
                      + ":"
                      + field(renderer, "showVideo");
            } catch (Exception error) {
              actual[0] = error.toString();
            }
            sampled.countDown();
          });
      if (!sampled.await(5, TimeUnit.SECONDS)) throw new AssertionError("Renderer thread stalled");
      if (exact ? expected.equals(actual[0]) : actual[0].startsWith(expected)) return;
      Thread.sleep(25);
    }
    android.media.MediaPlayer player = (android.media.MediaPlayer) field(renderer, "player");
    throw new AssertionError(
        "Playback expected "
            + expected
            + ", got "
            + actual[0]
            + "; playing="
            + (player != null && player.isPlaying())
            + "; position="
            + (player == null ? -1 : player.getCurrentPosition()));
  }

  private static WebView find(View view) {
    if (view instanceof WebView) return (WebView) view;
    if (view instanceof ViewGroup)
      for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
        WebView found = find(((ViewGroup) view).getChildAt(i));
        if (found != null) return found;
      }
    return null;
  }

  private String eval(WebView web, String script) throws Exception {
    CountDownLatch ready = new CountDownLatch(1);
    String[] value = new String[1];
    runOnMainSync(
        () ->
            web.evaluateJavascript(
                script,
                json -> {
                  value[0] = json;
                  ready.countDown();
                }));
    if (!ready.await(30, TimeUnit.SECONDS))
      throw new AssertionError("WebView JavaScript timed out");
    if (value[0] == null || value[0].equals("null")) return "null";
    return new JSONArray("[" + value[0] + "]").get(0).toString();
  }

  private void waitFor(WebView web, String condition, long timeout) throws Exception {
    long end = SystemClock.elapsedRealtime() + timeout;
    while (SystemClock.elapsedRealtime() < end) {
      if (eval(web, condition).equals("true")) return;
      Thread.sleep(250);
    }
    throw new AssertionError(
        "WebView condition timed out: "
            + condition
            + "; "
            + eval(web, "document.body.innerText.slice(-2500)"));
  }

  private static double difference(Bitmap expected, Bitmap actual, boolean flip) {
    long sum = 0;
    int w = expected.getWidth(), h = expected.getHeight();
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) {
        int a = expected.getPixel(x, y), b = actual.getPixel(x, flip ? h - 1 - y : y);
        sum +=
            Math.abs(((a >> 16) & 255) - ((b >> 16) & 255))
                + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255))
                + Math.abs((a & 255) - (b & 255));
      }
    return sum / (double) (w * h * 3);
  }
}
