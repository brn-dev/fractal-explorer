package org.fractalexplorer.wallpaper.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;
import org.json.*;

/** Uses real browser ZIPs through the production settings result callback. Emulator only. */
public final class BatchImportInstrumentation extends Instrumentation {
  private int checks;
  private Class<?> storeType, settingsType;
  private Object store;
  private Activity settings;
  private final List<File> temporary = new ArrayList<>();

  @Override
  public void onCreate(Bundle args) {
    super.onCreate(args);
    start();
  }

  private void check(boolean value, String message) {
    checks++;
    if (!value) throw new AssertionError(message);
  }

  private static Field field(Class<?> type, String name) throws Exception {
    Field f = type.getDeclaredField(name);
    f.setAccessible(true);
    return f;
  }

  private Map<String, byte[]> unzip(byte[] bytes) throws Exception {
    Map<String, byte[]> files = new LinkedHashMap<>();
    try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
      ZipEntry entry;
      while ((entry = zip.getNextEntry()) != null) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[65536];
        int n;
        while ((n = zip.read(buffer)) != -1) output.write(buffer, 0, n);
        files.put(entry.getName(), output.toByteArray());
      }
    }
    return files;
  }

  private File local(String name, byte[] bytes) throws Exception {
    File file = new File(getTargetContext().getCacheDir(), "batch-test-" + name);
    Files.write(file.toPath(), bytes);
    temporary.add(file);
    return file;
  }

  private Set<String> ids() {
    File root = new File(getTargetContext().getFilesDir(), "wallpapers");
    Set<String> ids = new HashSet<>();
    File[] folders = root.listFiles();
    if (folders != null)
      for (File folder : folders)
        if (folder.getName().matches("[a-f0-9]{32}")) ids.add(folder.getName());
    return ids;
  }

  private String importThroughSettings(File zip) throws Exception {
    Method callback =
        settingsType.getDeclaredMethod("onActivityResult", int.class, int.class, Intent.class);
    callback.setAccessible(true);
    int request = field(settingsType, "PICK_PACKAGE").getInt(null);
    final Throwable[] error = new Throwable[1];
    runOnMainSync(
        () -> {
          try {
            callback.invoke(
                settings, request, Activity.RESULT_OK, new Intent().setData(Uri.fromFile(zip)));
          } catch (Throwable e) {
            error[0] = e;
          }
        });
    if (error[0] != null) throw new AssertionError(error[0]);
    long until = SystemClock.elapsedRealtime() + 20000;
    while (field(settingsType, "workRunning").getBoolean(null)
        && SystemClock.elapsedRealtime() < until) Thread.sleep(20);
    check(!field(settingsType, "workRunning").getBoolean(null), "Import did not finish");
    final String[] text = new String[1];
    runOnMainSync(
        () -> {
          try {
            text[0] = ((TextView) field(settingsType, "status").get(settings)).getText().toString();
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    return text[0];
  }

  @Override
  public void onStart() {
    Bundle result = new Bundle();
    try {
      check(
          android.os.Build.HARDWARE.contains("ranchu")
              || android.os.Build.HARDWARE.contains("goldfish"),
          "Emulator only");
      storeType =
          getTargetContext()
              .getClassLoader()
              .loadClass("org.fractalexplorer.wallpaper.WallpaperFiles");
      settingsType =
          getTargetContext()
              .getClassLoader()
              .loadClass("org.fractalexplorer.wallpaper.SettingsActivity");
      Constructor<?> constructor = storeType.getDeclaredConstructor(android.content.Context.class);
      constructor.setAccessible(true);
      store = constructor.newInstance(getTargetContext());
      Method importer = storeType.getDeclaredMethod("importZip", InputStream.class);
      importer.setAccessible(true);
      settings =
          startActivitySync(
              new Intent()
                  .setClassName(getTargetContext(), settingsType.getName())
                  .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      waitForIdleSync();
      Map<String, ?> rawBefore;
      byte[] batch;
      try (InputStream input =
              new android.os.ParcelFileDescriptor.AutoCloseInputStream(
                  getUiAutomation()
                      .executeShellCommand(
                          "cat /sdcard/Download/fractal-wallpaper-palettes-test.zip"));
          ByteArrayOutputStream output = new ByteArrayOutputStream()) {
        byte[] buffer = new byte[65536];
        int n;
        while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
        batch = output.toByteArray();
      }
      Map<String, byte[]> packages = unzip(batch);
      check(packages.size() == 4, "Expected four real browser packages");
      Map<String, byte[]> first = unzip(packages.values().iterator().next());
      JSONObject firstManifest = new JSONObject(new String(first.get("wallpaper.json"), "UTF-8"));
      String screen = firstManifest.getString("screen");
      check(
          ((Integer)
                  importer.invoke(
                      store, new ByteArrayInputStream(packages.values().iterator().next())))
              == 1,
          "Flat browser package remains importable");
      SharedPreferences prefs = getTargetContext().getSharedPreferences("wallpaper", 0);
      String active = prefs.getString("active_" + screen, "");
      check(!active.isEmpty(), "Flat import activates target screen");
      prefs
          .edit()
          .putBoolean("shuffle_" + screen, true)
          .putStringSet("shuffle_" + screen + "_ids", Collections.singleton(active))
          .commit();
      rawBefore = new HashMap<>(prefs.getAll());
      Set<String> before = ids();
      String status = importThroughSettings(local("palettes.zip", batch));
      check(status.startsWith("4 wallpapers imported."), "Import count not visible: " + status);
      check(prefs.getAll().equals(rawBefore), "Batch changed active/playback/shuffle choices");
      Set<String> added = ids();
      added.removeAll(before);
      check(added.size() == 4, "Not all palettes were imported");
      Map<String, Map<String, byte[]>> expected = new HashMap<>();
      for (byte[] zip : packages.values()) {
        Map<String, byte[]> files = unzip(zip);
        JSONObject manifest = new JSONObject(new String(files.get("wallpaper.json"), "UTF-8"));
        expected.put(manifest.getString("name"), files);
      }
      for (String id : added) {
        File folder = new File(getTargetContext().getFilesDir(), "wallpapers/" + id);
        JSONObject manifest =
            new JSONObject(
                new String(
                    Files.readAllBytes(new File(folder, "wallpaper.json").toPath()), "UTF-8"));
        Map<String, byte[]> files = expected.remove(manifest.getString("name"));
        check(files != null, "Missing palette name");
        check(manifest.has("editor"), "Missing editable draft");
        for (Map.Entry<String, byte[]> file : files.entrySet())
          if (!file.getKey().equals("wallpaper.json"))
            check(
                Arrays.equals(
                    file.getValue(), Files.readAllBytes(new File(folder, file.getKey()).toPath())),
                "Media bytes changed");
      }
      check(expected.isEmpty(), "Some palettes not found");
      // A later malformed child must leave no entries, even through the asynchronous UI callback.
      ByteArrayOutputStream malformed = new ByteArrayOutputStream();
      try (ZipOutputStream zip = new ZipOutputStream(malformed)) {
        zip.putNextEntry(new ZipEntry("01-valid.zip"));
        zip.write(packages.values().iterator().next());
        zip.closeEntry();
        zip.putNextEntry(new ZipEntry("02-broken.zip"));
        zip.write(new byte[] {1, 2, 3});
        zip.closeEntry();
      }
      Set<String> after = ids();
      status = importThroughSettings(local("broken.zip", malformed.toByteArray()));
      check(status.startsWith("Could not import wallpaper:"), "Error not visible: " + status);
      check(
          after.equals(ids()) && prefs.getAll().equals(rawBefore),
          "Failed batch changed gallery or choices");
      runOnMainSync(
          () -> {
            try {
              TextView label = (TextView) field(settingsType, "status").get(settings);
              ViewGroup parent = (ViewGroup) label.getParent();
              check(parent.indexOfChild(label) > 0, "Status missing from page");
              android.view.View previous = parent.getChildAt(parent.indexOfChild(label) - 1);
              check(
                  previous instanceof Button
                      && ((Button) previous)
                          .getText()
                          .toString()
                          .equals("Import wallpaper package"),
                  "Status not immediately after Import button");
              check(
                  label.getGlobalVisibleRect(new android.graphics.Rect()),
                  "Import result is off-screen");
            } catch (Exception e) {
              throw new RuntimeException(e);
            }
          });
      android.graphics.Bitmap screenshot = getUiAutomation().takeScreenshot();
      try (FileOutputStream output =
          new FileOutputStream(
              new File(getTargetContext().getFilesDir(), "batch-import-result.png"))) {
        screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output);
      } finally {
        screenshot.recycle();
      }
      result.putString(
          "result",
          "PASS "
              + checks
              + " real browser ZIP, Android codec validation, settings feedback, unchanged"
              + " selection and rollback checks.");
      finish(Activity.RESULT_OK, result);
    } catch (Throwable error) {
      result.putString("failure", android.util.Log.getStackTraceString(error));
      finish(Activity.RESULT_CANCELED, result);
    } finally {
      if (settings != null) runOnMainSync(settings::finish);
      for (File file : temporary) file.delete();
    }
  }
}
