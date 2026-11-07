package org.fractalexplorer.wallpaper.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import java.io.File;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import org.json.JSONObject;

/** Runs the production gallery against real saved media on a disposable Android device. */
final class GalleryChecks {
  private final Instrumentation test;
  private Object bridge;

  GalleryChecks(Instrumentation test) {
    this.test = test;
  }

  private JSONObject call(String name, String... args) throws Exception {
    Class<?>[] types = new Class<?>[args.length];
    Arrays.fill(types, String.class);
    Method method = bridge.getClass().getDeclaredMethod(name, types);
    method.setAccessible(true);
    return new JSONObject((String) method.invoke(bridge, (Object[]) args));
  }

  private JSONObject ok(String name, String... args) throws Exception {
    JSONObject result = call(name, args);
    if (!result.getBoolean("ok")) throw new AssertionError(name + ": " + result);
    return result;
  }

  private static void require(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }

  void run(Activity activity, Bundle result) throws Exception {
    java.lang.reflect.Field field = activity.getClass().getDeclaredField("bridge");
    field.setAccessible(true);
    bridge = field.get(activity);
    SharedPreferences prefs = test.getTargetContext().getSharedPreferences("wallpaper", 0);
    String original = prefs.getString("active_inner", "");
    File root = new File(test.getTargetContext().getFilesDir(), "wallpapers"),
        source = new File(root, original);
    JSONObject manifest =
        new JSONObject(
            new String(
                Files.readAllBytes(new File(source, "wallpaper.json").toPath()),
                StandardCharsets.UTF_8));
    int count = ok("listWallpapers").getJSONArray("wallpapers").length();
    String oldName = ok("wallpaperDraft", original).getJSONObject("draft").getString("name");
    Class<?> storage =
        Class.forName(
            "org.fractalexplorer.wallpaper.WallpaperFiles",
            true,
            test.getTargetContext().getClassLoader());
    java.lang.reflect.Constructor<?> constructor =
        storage.getDeclaredConstructor(android.content.Context.class);
    constructor.setAccessible(true);
    Object store = constructor.newInstance(test.getTargetContext());
    Method staging = storage.getDeclaredMethod("staging"),
        publish = storage.getDeclaredMethod("publish", File.class, JSONObject.class);
    staging.setAccessible(true);
    publish.setAccessible(true);
    String[] created = new String[2];
    for (int i = 0; i < created.length; i++) {
      File stage = (File) staging.invoke(store);
      for (File media : source.listFiles())
        Files.copy(media.toPath(), new File(stage, media.getName()).toPath());
      created[i] =
          (String)
              publish.invoke(
                  store,
                  stage,
                  new JSONObject(manifest.toString()).put("name", "Gallery check " + i));
    }
    require(
        ok("listWallpapers").getJSONArray("wallpapers").length() == count + 2,
        "Older wallpapers were pruned");
    ok("applyWallpaper", original);
    prefs.edit().putBoolean("inner_idle", true).putBoolean("inner_arrival", false).commit();
    ok("applyWallpaper", created[0]);
    ok("applyWallpaper", original);
    require(
        prefs.getBoolean("inner_idle", false) && !prefs.getBoolean("inner_arrival", true),
        "Playback choices lost while switching");
    ok("renameWallpaper", original, "Renamed gallery design");
    require(
        "Renamed gallery design"
            .equals(ok("wallpaperDraft", original).getJSONObject("draft").getString("name")),
        "Renamed design not restored");
    require(
        ok("wallpaperThumbnail", original).getString("image").startsWith("data:image/png;base64,"),
        "Thumbnail unavailable");
    require(!call("deleteWallpaper", original).getBoolean("ok"), "Active wallpaper deleted");
    require(!call("applyWallpaper", "../active").getBoolean("ok"), "Invalid gallery ID accepted");
    for (File media : source.listFiles())
      require(
          Arrays.equals(
                  Files.readAllBytes(media.toPath()),
                  Files.readAllBytes(
                      new File(new File(root, created[0]), media.getName()).toPath()))
              || media.getName().equals("wallpaper.json"),
          "Switch changed rendered media");
    Class<?> settingsType =
        Class.forName(
            "org.fractalexplorer.wallpaper.SettingsActivity",
            true,
            test.getTargetContext().getClassLoader());
    java.lang.reflect.Field running = settingsType.getDeclaredField("workRunning");
    running.setAccessible(true);
    test.runOnMainSync(
        () -> {
          try {
            running.setBoolean(null, true);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    try {
      require(
          !call("applyWallpaper", created[0]).getBoolean("ok"), "Gallery switched during import");
    } finally {
      test.runOnMainSync(
          () -> {
            try {
              running.setBoolean(null, false);
            } catch (Exception e) {
              throw new RuntimeException(e);
            }
          });
    }
    Activity settings =
        test.startActivitySync(
            new Intent()
                .setClassName("org.fractalexplorer.wallpaper", settingsType.getName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    Method changed = settingsType.getDeclaredMethod("changed");
    changed.setAccessible(true);
    changed.invoke(settings);
    ok("applyWallpaper", original);
    require(
        prefs.getBoolean("inner_idle", false) && !prefs.getBoolean("inner_arrival", true),
        "Restore sample forgot outgoing playback choices");
    test.runOnMainSync(settings::finish);
    ok("renameWallpaper", original, oldName);
    for (String id : created) {
      ok("deleteWallpaper", id);
      require(!new File(root, id).exists(), "Deleted media retained");
    }
    require(
        ok("listWallpapers").getJSONArray("wallpapers").length() == count,
        "Gallery deletion lost unrelated entries");
    result.putString(
        "gallery",
        "PASS: three retained packages, switching, editable design, thumbnail, rename, protected"
            + " deletion, import serialization, saved playback choices");
  }
}
