package org.fractalexplorer.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Saved packages are immutable; names and per-wallpaper playback choices live in preferences. */
final class WallpaperGallery {
  private static final java.util.concurrent.ExecutorService playbackWrites =
      java.util.concurrent.Executors.newSingleThreadExecutor(
          action -> {
            Thread thread = new Thread(action, "Fractal playback choices");
            thread.setDaemon(true);
            return thread;
          });

  /**
   * Capture the selected artwork now, then serialize its choice with activation off the UI thread.
   */
  static java.util.concurrent.Future<?> queuePlayback(Context context, String key, boolean value) {
    final Context app = context.getApplicationContext();
    final SharedPreferences preferences = app.getSharedPreferences("wallpaper", 0);
    if (!java.util.Arrays.asList("cover_idle", "cover_arrival", "inner_idle", "inner_arrival")
        .contains(key)) throw new IllegalArgumentException("Unknown playback setting");
    final String screen = key.startsWith("cover_") ? "cover" : "inner";
    final String choice = key.substring(screen.length() + 1);
    final String selected = WallpaperFiles.activeId(preferences, screen);
    return playbackWrites.submit(
        () -> {
          synchronized (WallpaperFiles.class) {
            // A queued click must not recreate settings for artwork deleted meanwhile.
            if (PackPolicy.validId(selected)
                && !new File(new File(app.getFilesDir(), "wallpapers"), selected).isDirectory())
              return;
            if (selected.equals(WallpaperFiles.activeId(preferences, screen)))
              setPlayback(preferences, key, value);
            if (PackPolicy.validId(selected))
              preferences
                  .edit()
                  .putBoolean("gallery_" + screen + "_" + choice + "_" + selected, value)
                  .apply();
          }
        });
  }

  private static final Object choiceLock = new Object();

  private static final class PlaybackChoice {
    final boolean value;

    PlaybackChoice(boolean value) {
      this.value = value;
    }
  }

  private static final Map<SharedPreferences, Map<String, PlaybackChoice>> choices =
      new java.util.WeakHashMap<>();

  static void setPlayback(SharedPreferences preferences, String key, boolean value) {
    synchronized (choiceLock) {
      choices
          .computeIfAbsent(preferences, ignored -> new HashMap<>())
          .put(key, new PlaybackChoice(value));
      preferences.edit().putBoolean(key, value).apply();
    }
  }

  private final WallpaperFiles files;
  private final SharedPreferences preferences;

  WallpaperGallery(Context context) {
    files = new WallpaperFiles(context);
    preferences = context.getSharedPreferences("wallpaper", 0);
  }

  // SharedPreferences updates memory even when disk commit fails. Restore only our touched keys.
  @SuppressWarnings("unchecked")
  static void commit(SharedPreferences preferences, SharedPreferences.Editor edit, String... keys)
      throws IOException {
    Map<String, Object> before = new HashMap<>();
    Map<String, PlaybackChoice> observed = new HashMap<>();
    synchronized (choiceLock) {
      Map<String, ?> values = preferences.getAll();
      Map<String, PlaybackChoice> explicit = choices.get(preferences);
      for (String key : keys) {
        before.put(key, values.get(key));
        observed.put(key, explicit == null ? null : explicit.get(key));
      }
    }
    if (edit.commit()) return;
    synchronized (choiceLock) {
      SharedPreferences.Editor rollback = preferences.edit();
      for (Map.Entry<String, ?> entry : before.entrySet()) {
        String key = entry.getKey();
        Object value = entry.getValue();
        Map<String, PlaybackChoice> explicit = choices.get(preferences);
        PlaybackChoice latest = explicit == null ? null : explicit.get(key);
        // Preserve a Settings choice made during the failed disk commit, including
        // a choice equal to the value activation attempted to write.
        if (latest != null && latest != observed.get(key)) value = latest.value;
        if (value == null) rollback.remove(key);
        else if (value instanceof String) rollback.putString(key, (String) value);
        else if (value instanceof Boolean) rollback.putBoolean(key, (Boolean) value);
        else if (value instanceof Long) rollback.putLong(key, (Long) value);
        else if (value instanceof Integer) rollback.putInt(key, (Integer) value);
        else if (value instanceof Float) rollback.putFloat(key, (Float) value);
        else if (value instanceof Set) rollback.putStringSet(key, (Set<String>) value);
      }
      rollback.commit();
    }
    throw new IOException("Cannot save wallpaper settings. Free some storage and try again.");
  }

  private File folder(String id) throws IOException {
    File folder = PackPolicy.folder(files.root(), id);
    if (!folder.isDirectory()) throw new IOException("This wallpaper is no longer in the gallery");
    return folder;
  }

  private JSONObject manifest(File folder) throws Exception {
    File json = PackPolicy.child(folder, "wallpaper.json");
    if (!json.isFile() || json.length() > PackPolicy.MAX_JSON_BYTES)
      throw new IOException("Invalid saved wallpaper");
    JSONObject manifest =
        new JSONObject(new String(Files.readAllBytes(json.toPath()), StandardCharsets.UTF_8));
    if (!"fractal-wallpaper/v1".equals(manifest.optString("format"))
        || manifest.optInt("version") != 1) throw new IOException("Unsupported saved wallpaper");
    for (String name : PackPolicy.files(manifest.optString("screen", "")))
      if (!PackPolicy.child(folder, name).isFile() || PackPolicy.child(folder, name).length() == 0)
        throw new IOException("Saved wallpaper is missing " + name);
    return manifest;
  }

  private String name(String id, JSONObject manifest) {
    return preferences.getString(
        "gallery_name_" + id, manifest.optString("name", "My fractal wallpaper"));
  }

  JSONArray list() throws Exception {
    synchronized (WallpaperFiles.class) {
      JSONArray result = new JSONArray();
      File[] folders = files.root().listFiles();
      if (folders == null) return result;
      Arrays.sort(
          folders,
          Comparator.comparingLong(File::lastModified).reversed().thenComparing(File::getName));
      for (File folder : folders) {
        String id = folder.getName();
        if (!PackPolicy.validId(id)) continue;
        try {
          JSONObject manifest = manifest(folder);
          long size = 0;
          for (String file : PackPolicy.files(manifest.optString("screen", "")))
            size += PackPolicy.child(folder, file).length();
          boolean cover = id.equals(WallpaperFiles.activeId(preferences, "cover"));
          boolean inner = id.equals(WallpaperFiles.activeId(preferences, "inner"));
          result.put(
              new JSONObject()
                  .put("id", id)
                  .put("name", name(id, manifest))
                  .put("screen", manifest.optString("screen", ""))
                  .put("active", cover || inner)
                  .put("activeCover", cover)
                  .put("activeInner", inner)
                  .put("editable", manifest.optJSONObject("editor") != null)
                  .put("bytes", size)
                  .put("created", folder.lastModified()));
        } catch (Exception ignored) {
          // Leave a damaged entry intact so a read failure never deletes someone's artwork.
        }
      }
      return result;
    }
  }

  JSONObject draft(String id) throws Exception {
    synchronized (WallpaperFiles.class) {
      JSONObject manifest = manifest(folder(id)), draft = manifest.optJSONObject("editor");
      if (draft == null) throw new IOException("This imported wallpaper has no editable design");
      return draft.put("name", name(id, manifest));
    }
  }

  String thumbnail(String id) throws Exception {
    synchronized (WallpaperFiles.class) {
      String scope = manifest(folder(id)).optString("screen", "");
      return thumbnail(id, "cover".equals(scope) ? "cover" : "inner");
    }
  }

  String thumbnail(String id, String screen) throws Exception {
    synchronized (WallpaperFiles.class) {
      if (!PackPolicy.supports(manifest(folder(id)).optString("screen", ""), screen))
        throw new IOException("This wallpaper belongs to the other screen");
      File poster = PackPolicy.child(folder(id), screen + "-poster.png");
      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(poster.getAbsolutePath(), options);
      if (options.outWidth < 16
          || options.outHeight < 16
          || Math.max(options.outWidth, options.outHeight) > 4096)
        throw new IOException("Cannot read this wallpaper's thumbnail");
      options.inSampleSize = 1;
      while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 320)
        options.inSampleSize *= 2;
      options.inJustDecodeBounds = false;
      Bitmap image = BitmapFactory.decodeFile(poster.getAbsolutePath(), options);
      if (image == null) throw new IOException("Cannot read this wallpaper's thumbnail");
      try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
        if (!image.compress(Bitmap.CompressFormat.PNG, 100, output))
          throw new IOException("Cannot create thumbnail");
        return "data:image/png;base64,"
            + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
      } finally {
        image.recycle();
      }
    }
  }

  void apply(String id) throws Exception {
    apply(id, null);
  }

  void apply(String id, String screen) throws Exception {
    synchronized (WallpaperFiles.class) {
      requireNoImport();
      File folder = folder(id);
      JSONObject manifest = manifest(folder);
      String scope = manifest.optString("screen", "");
      if (screen != null && !PackPolicy.supports(scope, screen))
        throw new IOException("This wallpaper belongs to the other screen");
      boolean selected = true;
      for (String target : PackPolicy.screens(screen == null ? scope : screen))
        selected &= id.equals(WallpaperFiles.activeId(preferences, target));
      if (selected) return;
      files.validate(folder, manifest);
      files.activateLocked(id, manifest, screen);
    }
  }

  static void requireNoImport() throws IOException {
    if (SettingsActivity.hasPendingChanges())
      throw new IOException(
          "Wait for the current wallpaper import to finish before switching wallpapers");
  }

  void rename(String id, String name) throws Exception {
    synchronized (WallpaperFiles.class) {
      manifest(folder(id));
      if (name == null || name.trim().isEmpty() || name.trim().length() > 80)
        throw new IOException("Give the wallpaper a name of 1–80 characters");
      commit(
          preferences,
          preferences.edit().putString("gallery_name_" + id, name.trim()),
          "gallery_name_" + id);
    }
  }

  void delete(String id) throws Exception {
    synchronized (WallpaperFiles.class) {
      File folder = folder(id);
      if (id.equals(WallpaperFiles.activeId(preferences, "cover"))
          || id.equals(WallpaperFiles.activeId(preferences, "inner")))
        throw new IOException(
            "Select another wallpaper on every screen using this design before deleting it");
      // A crash after this rename is recovered by the existing pending-package cleanup.
      File removed = new File(files.root(), "pending-" + WallpaperFiles.newId());
      if (!folder.renameTo(removed)) throw new IOException("Cannot remove this wallpaper");
      try {
        commit(
            preferences,
            preferences
                .edit()
                .remove("gallery_name_" + id)
                .remove("gallery_idle_" + id)
                .remove("gallery_arrival_" + id)
                .remove("gallery_cover_idle_" + id)
                .remove("gallery_cover_arrival_" + id)
                .remove("gallery_inner_idle_" + id)
                .remove("gallery_inner_arrival_" + id),
            "gallery_name_" + id,
            "gallery_idle_" + id,
            "gallery_arrival_" + id,
            "gallery_cover_idle_" + id,
            "gallery_cover_arrival_" + id,
            "gallery_inner_idle_" + id,
            "gallery_inner_arrival_" + id);
      } catch (Exception error) {
        folder = PackPolicy.folder(files.root(), id);
        removed.renameTo(folder);
        throw error;
      }
      try {
        files.deleteFolder(removed);
      } catch (IOException ignored) {
        /* Retry next process. */
      }
    }
  }
}
