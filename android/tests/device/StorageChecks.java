package org.fractalexplorer.wallpaper.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.os.Bundle;
import android.os.SystemClock;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

/** Regression checks through the production settings/import paths. Disposable test device only. */
final class StorageChecks {
  private final Instrumentation test;

  StorageChecks(Instrumentation test) {
    this.test = test;
  }

  private File files() {
    return test.getTargetContext().getFilesDir();
  }

  private android.content.SharedPreferences preferences() {
    return test.getTargetContext().getSharedPreferences("wallpaper", 0);
  }

  private File active() {
    return active("cover");
  }

  private File active(String screen) {
    return new File(
        files(),
        "wallpapers/"
            + preferences()
                .getString("active_" + screen, preferences().getString("active_pack", "")));
  }

  private File selected(String name) {
    return new File(active(name.startsWith("cover-") ? "cover" : "inner"), name);
  }

  private static byte[] bytes(File file) throws Exception {
    return java.nio.file.Files.readAllBytes(file.toPath());
  }

  void concurrentImports(Object store, java.lang.reflect.Method importer) throws Exception {
    byte[] fixture;
    try (java.io.InputStream source =
            new android.os.ParcelFileDescriptor.AutoCloseInputStream(
                test.getUiAutomation()
                    .executeShellCommand("cat /sdcard/Download/fractal-wallpaper-test.zip"));
        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream()) {
      byte[] chunk = new byte[65536];
      int count;
      while ((count = source.read(chunk)) != -1) buffer.write(chunk, 0, count);
      fixture = buffer.toByteArray();
    }
    CountDownLatch start = new CountDownLatch(1);
    AtomicReference<Throwable> failure = new AtomicReference<>();
    Thread[] jobs = new Thread[3];
    for (int i = 0; i < jobs.length; i++) {
      jobs[i] =
          new Thread(
              () -> {
                try {
                  start.await();
                  importer.invoke(store, new java.io.ByteArrayInputStream(fixture));
                } catch (Throwable error) {
                  failure.set(error);
                }
              });
      jobs[i].start();
    }
    start.countDown();
    for (Thread job : jobs) {
      job.join(30000);
      if (job.isAlive()) throw new AssertionError("Import stalled");
    }
    if (failure.get() != null) throw new AssertionError("Concurrent import failed", failure.get());
    for (String name :
        new String[] {
          "cover-arrival.mp4",
          "cover-idle.mp4",
          "inner-arrival.mp4",
          "inner-idle.mp4",
          "cover-poster.png",
          "inner-poster.png",
          "wallpaper.json"
        }) if (!selected(name).isFile()) throw new AssertionError("Concurrent import lost " + name);
  }

  void replaceClip(File source, Bundle result) throws Exception {
    Activity settings =
        test.startActivitySync(
            new Intent()
                .setClassName(
                    "org.fractalexplorer.wallpaper",
                    "org.fractalexplorer.wallpaper.SettingsActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    String[] names = {
      "cover-idle.mp4",
      "inner-arrival.mp4",
      "inner-idle.mp4",
      "cover-poster.png",
      "inner-poster.png"
    };
    byte[][] originals = new byte[names.length][];
    for (int i = 0; i < names.length; i++) originals[i] = bytes(new File(source, names[i]));
    File replacement = new File(source, "inner-arrival.mp4");
    File alternate = new File(test.getTargetContext().getCacheDir(), "smoke-alternate-arrival.mp4");
    java.nio.file.Files.copy(
        new File(source, "cover-arrival.mp4").toPath(),
        alternate.toPath(),
        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    Bitmap alternateExpected;
    try (MediaMetadataRetriever reader = new MediaMetadataRetriever()) {
      reader.setDataSource(alternate.getAbsolutePath());
      long end =
          Long.parseLong(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))
                  * 1000
              - 1;
      alternateExpected = reader.getFrameAtTime(end, MediaMetadataRetriever.OPTION_CLOSEST);
    }
    Bitmap expected;
    try (MediaMetadataRetriever reader = new MediaMetadataRetriever()) {
      reader.setDataSource(replacement.getAbsolutePath());
      long end =
          Long.parseLong(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))
                  * 1000
              - 1;
      expected = reader.getFrameAtTime(end, MediaMetadataRetriever.OPTION_CLOSEST);
    }
    try {
      importClip(settings, replacement);
      for (int i = 0; i < names.length; i++)
        if (!java.util.Arrays.equals(originals[i], bytes(selected(names[i]))))
          throw new AssertionError("Replacing one clip changed " + names[i]);
      if (!java.util.Arrays.equals(originals[1], bytes(selected("cover-arrival.mp4"))))
        throw new AssertionError("Replacement clip differs");
      if (new File(files(), "videos/cover-idle.mp4").exists())
        throw new AssertionError("Fresh import test needs no legacy idle clip");
      preferences().edit().putString("active_cover", "").commit();
      importClip(settings, replacement);
      Bitmap actual =
          BitmapFactory.decodeFile(new File(active(), "cover-poster.png").getAbsolutePath());
      try {
        if (actual.getWidth() != expected.getWidth()
            || actual.getHeight() != expected.getHeight()
            || difference(expected, actual) > .1)
          throw new AssertionError("Arrival fallback does not hold its endpoint");
      } finally {
        actual.recycle();
      }
      importClip(
          settings,
          alternate); // A bundled fallback copied by the first import is not an explicit steady
      // selection.
      checkPoster(alternateExpected, "cover");
      importClip(settings, alternate, "inner-arrival");
      checkPoster(alternateExpected, "inner");
      preferences().edit().putBoolean("inner_idle", true).commit();
      waitRadio(settings, true);
      preferences().edit().putBoolean("inner_idle", false).commit();
      waitRadio(settings, false);
      preferences().edit().putBoolean("inner_arrival", false).commit();
      waitArrival(settings, false);
      preferences().edit().putBoolean("inner_arrival", true).commit();
      waitArrival(settings, true);
      result.putString(
          "individual_import",
          "PASS: other states preserved, arrival endpoint fallback, preference controls"
              + " synchronized");
    } finally {
      expected.recycle();
      alternateExpected.recycle();
      alternate.delete();
      test.runOnMainSync(settings::finish);
    }
  }

  private static Object field(Object target, String name) throws Exception {
    java.lang.reflect.Field value = target.getClass().getDeclaredField(name);
    value.setAccessible(true);
    return value.get(target);
  }

  void overlappingSettingsImport() throws Exception {
    File fixture = new File(test.getTargetContext().getCacheDir(), "smoke-overlap.zip");
    try (java.io.InputStream source =
        new android.os.ParcelFileDescriptor.AutoCloseInputStream(
            test.getUiAutomation()
                .executeShellCommand("cat /sdcard/Download/fractal-wallpaper-test.zip"))) {
      java.nio.file.Files.copy(
          source, fixture.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }
    String previous = preferences().getString("active_inner", "");
    Activity first = openSettings(), second = null;
    try {
      Class<?> storage =
          Class.forName(
              "org.fractalexplorer.wallpaper.WallpaperFiles",
              true,
              test.getTargetContext().getClassLoader());
      synchronized (storage) { // Keep the real package worker pending at its storage boundary.
        java.lang.reflect.Method result =
            first
                .getClass()
                .getDeclaredMethod("onActivityResult", int.class, int.class, Intent.class);
        result.setAccessible(true);
        test.runOnMainSync(
            () -> {
              try {
                result.invoke(
                    first,
                    42,
                    Activity.RESULT_OK,
                    new Intent().setData(android.net.Uri.fromFile(fixture)));
              } catch (Exception error) {
                throw new RuntimeException(error);
              }
            });
        checkMutationControls(first, previous);
        second = openSettings(); // A recreated/new settings screen must share the same busy state.
        checkMutationControls(second, previous);
        test.runOnMainSync(first::finish);
      }
      Activity current = second;
      long deadline = SystemClock.elapsedRealtime() + 30000;
      boolean finished = false;
      while (SystemClock.elapsedRealtime() < deadline) {
        boolean[] busy = new boolean[1];
        String[] message = new String[1];
        test.runOnMainSync(
            () -> {
              try {
                busy[0] = (Boolean) field(current, "importing");
                message[0] =
                    ((android.widget.TextView) field(current, "status")).getText().toString();
              } catch (Exception error) {
                throw new RuntimeException(error);
              }
            });
        if (!busy[0]) {
          if (!message[0].contains("Wallpaper imported")) throw new AssertionError(message[0]);
          finished = true;
          break;
        }
        Thread.sleep(25);
      }
      if (!finished || previous.equals(preferences().getString("active_inner", "")))
        throw new AssertionError("Pending package did not finish");
    } finally {
      Activity current = second;
      test.runOnMainSync(
          () -> {
            first.finish();
            if (current != null) current.finish();
          });
      fixture.delete();
    }
  }

  private Activity openSettings() {
    return test.startActivitySync(
        new Intent()
            .setClassName(
                "org.fractalexplorer.wallpaper", "org.fractalexplorer.wallpaper.SettingsActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK));
  }

  private void checkMutationControls(Activity settings, String expectedActive) {
    test.runOnMainSync(
        () -> {
          try {
            if (!(Boolean) field(settings, "importing"))
              throw new AssertionError("Settings lost in-flight work state");
            java.util.List<?> buttons = (java.util.List<?>) field(settings, "importButtons");
            for (Object entry : buttons)
              if (((android.widget.Button) entry).isEnabled())
                throw new AssertionError("Mutating control enabled during import");
            ((android.widget.Button) buttons.get(buttons.size() - 1)).performClick();
            if (!expectedActive.equals(preferences().getString("active_inner", "")))
              throw new AssertionError("Restore overtook pending import");
          } catch (Exception error) {
            throw new RuntimeException(error);
          }
        });
  }

  private void importClip(Activity settings, File file) throws Exception {
    importClip(settings, file, "cover-arrival");
  }

  private void checkPoster(Bitmap expected, String screen) {
    Bitmap actual = BitmapFactory.decodeFile(selected(screen + "-poster.png").getAbsolutePath());
    try {
      if (actual == null
          || actual.getWidth() != expected.getWidth()
          || actual.getHeight() != expected.getHeight()
          || difference(expected, actual) > .1)
        throw new AssertionError("A copied fallback hid the new " + screen + " arrival endpoint");
    } finally {
      if (actual != null) actual.recycle();
    }
  }

  private void importClip(Activity settings, File file, String slot) throws Exception {
    java.lang.reflect.Field pending = settings.getClass().getDeclaredField("pendingSlot");
    pending.setAccessible(true);
    java.lang.reflect.Method receiver =
        settings
            .getClass()
            .getDeclaredMethod("onActivityResult", int.class, int.class, Intent.class);
    receiver.setAccessible(true);
    test.runOnMainSync(
        () -> {
          try {
            pending.set(settings, slot);
            receiver.invoke(
                settings,
                41,
                Activity.RESULT_OK,
                new Intent().setData(android.net.Uri.fromFile(file)));
          } catch (Exception error) {
            throw new RuntimeException(error);
          }
        });
    long deadline = SystemClock.elapsedRealtime() + 30000;
    while (SystemClock.elapsedRealtime() < deadline) {
      boolean[] busy = new boolean[1];
      String[] status = new String[1];
      test.runOnMainSync(
          () -> {
            try {
              busy[0] = (Boolean) field(settings, "importing");
              status[0] =
                  ((android.widget.TextView) field(settings, "status")).getText().toString();
            } catch (Exception error) {
              throw new RuntimeException(error);
            }
          });
      if (!busy[0]) {
        if (!status[0].contains("Video saved")) throw new AssertionError(status[0]);
        return;
      }
      Thread.sleep(50);
    }
    throw new AssertionError("Clip import timed out");
  }

  private void waitRadio(Activity settings, boolean expected) throws Exception {
    long deadline = SystemClock.elapsedRealtime() + 5000;
    while (SystemClock.elapsedRealtime() < deadline) {
      boolean[] checked = new boolean[1];
      test.runOnMainSync(
          () -> {
            try {
              checked[0] = ((android.widget.RadioButton) field(settings, "animated")).isChecked();
            } catch (Exception error) {
              throw new RuntimeException(error);
            }
          });
      if (checked[0] == expected) return;
      Thread.sleep(25);
    }
    throw new AssertionError("Playback controls are stale");
  }

  private void waitArrival(Activity settings, boolean expected) throws Exception {
    long deadline = SystemClock.elapsedRealtime() + 5000;
    while (SystemClock.elapsedRealtime() < deadline) {
      boolean[] checked = new boolean[1];
      test.runOnMainSync(
          () -> {
            try {
              checked[0] = ((android.widget.Switch) field(settings, "arrivalSwitch")).isChecked();
            } catch (Exception error) {
              throw new RuntimeException(error);
            }
          });
      if (checked[0] == expected) return;
      Thread.sleep(25);
    }
    throw new AssertionError("Arrival control is stale");
  }

  private static double difference(Bitmap expected, Bitmap actual) {
    long sum = 0;
    int width = expected.getWidth(), height = expected.getHeight();
    for (int y = 0; y < height; y++)
      for (int x = 0; x < width; x++) {
        int a = expected.getPixel(x, y), b = actual.getPixel(x, y);
        sum +=
            Math.abs(((a >> 16) & 255) - ((b >> 16) & 255))
                + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255))
                + Math.abs((a & 255) - (b & 255));
      }
    return sum / (double) (width * height * 3);
  }
}
