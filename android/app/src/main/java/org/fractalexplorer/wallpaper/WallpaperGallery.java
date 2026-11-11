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
  private static final ShufflePolicy shufflePolicy = new ShufflePolicy();
  private static final java.util.Random random = new java.util.Random();

  static void resetShuffle(String screen) {
    shufflePolicy.reset(screen);
  }

  private static void checkScreen(String screen) {
    if (!"cover".equals(screen) && !"inner".equals(screen))
      throw new IllegalArgumentException("Choose cover or main screen");
  }

  private Set<String> shuffleIds(String screen) {
    return new java.util.HashSet<>(
        preferences.getStringSet("shuffle_" + screen + "_ids", java.util.Collections.emptySet()));
  }

  private JSONObject shuffleRules(String screen) throws Exception {
    return new JSONObject(preferences.getString("shuffle_" + screen + "_rules", "{}"));
  }

  private static ShufflePolicy.Rule rule(JSONObject rules, String id) throws Exception {
    JSONObject item = rules.optJSONObject(id);
    return item == null
        ? new ShufflePolicy.Rule(1, "any")
        : new ShufflePolicy.Rule(item.getDouble("weight"), item.getString("period"));
  }

  JSONObject solarInfo() throws Exception {
    long now = System.currentTimeMillis();
    ViennaSun sun = ViennaSun.at(now);
    return new JSONObject()
        .put("zone", ViennaSun.ZONE.getId())
        .put("date", sun.date.toString())
        .put("sunrise", sun.sunrise)
        .put("sunset", sun.sunset)
        .put("daytime", sun.daytime(now));
  }

  String selectionContext(String screen, long wallTime) throws Exception {
    if (!preferences.getBoolean("shuffle_" + screen, false)) return "";
    java.util.List<String> ids = new java.util.ArrayList<>(shuffleIds(screen));
    java.util.Collections.sort(ids);
    JSONObject rules = shuffleRules(screen);
    StringBuilder context = new StringBuilder(screen);
    boolean timed = false;
    for (String id : ids) {
      ShufflePolicy.Rule setting = rule(rules, id);
      timed |= !"any".equals(setting.period);
      context
          .append('|')
          .append(id)
          .append(':')
          .append(setting.weight)
          .append(':')
          .append(setting.period);
    }
    if (timed) context.append(ViennaSun.at(wallTime).daytime(wallTime) ? "|day" : "|night");
    context.append(SettingsActivity.hasPendingChanges() ? "|pending" : "|ready");
    return context.toString();
  }

  long nextScheduleChange(String screen, long wallTime) throws Exception {
    if (preferences.getBoolean("shuffle_" + screen, false)) {
      JSONObject rules = shuffleRules(screen);
      for (String id : shuffleIds(screen))
        if (!"any".equals(rule(rules, id).period)) return ViennaSun.at(wallTime).next(wallTime);
    }
    return Long.MAX_VALUE;
  }

  void setShuffleRule(String screen, String id, JSONObject item) throws Exception {
    checkScreen(screen);
    if (!(item.opt("weight") instanceof Number)) throw new IOException("Enter a numeric weight");
    ShufflePolicy.Rule setting =
        new ShufflePolicy.Rule(item.getDouble("weight"), item.getString("period"));
    synchronized (WallpaperFiles.class) {
      requireNoImport();
      JSONObject saved = manifest(folder(id));
      if (!PackPolicy.supports(saved.optString("screen", ""), screen))
        throw new IOException("This wallpaper belongs to the other screen");
      JSONObject rules = shuffleRules(screen);
      rules.put(id, new JSONObject().put("weight", setting.weight).put("period", setting.period));
      commit(
          preferences,
          preferences.edit().putString("shuffle_" + screen + "_rules", rules.toString()),
          "shuffle_" + screen + "_rules");
      shufflePolicy.reset(screen);
    }
  }

  JSONObject shuffle() throws Exception {
    synchronized (WallpaperFiles.class) {
      JSONObject result = new JSONObject();
      for (String screen : new String[] {"cover", "inner"}) {
        JSONArray ids = new JSONArray();
        for (String id : shuffleIds(screen)) ids.put(id);
        result.put(
            screen,
            new JSONObject()
                .put("enabled", preferences.getBoolean("shuffle_" + screen, false))
                .put("ids", ids)
                .put("rules", shuffleRules(screen)));
      }
      return result;
    }
  }

  void setShuffle(String screen, JSONArray selected, boolean enabled) throws Exception {
    checkScreen(screen);
    synchronized (WallpaperFiles.class) {
      requireNoImport();
      if (selected.length() > 1024)
        throw new IOException("Choose up to 1024 wallpapers per shuffle selection");
      Set<String> ids = new java.util.HashSet<>();
      for (int i = 0; i < selected.length(); i++) {
        String id = selected.getString(i);
        JSONObject saved = manifest(folder(id));
        if (!PackPolicy.supports(saved.optString("screen", ""), screen))
          throw new IOException("This wallpaper belongs to the other screen");
        files.validate(folder(id), saved);
        ids.add(id);
      }
      if (enabled && ids.isEmpty())
        throw new IOException("Choose at least one wallpaper for shuffle");
      commit(
          preferences,
          preferences
              .edit()
              .putStringSet("shuffle_" + screen + "_ids", ids)
              .putBoolean("shuffle_" + screen, enabled),
          "shuffle_" + screen + "_ids",
          "shuffle_" + screen);
      shufflePolicy.reset(screen);
    }
  }

  String chooseForArrival(String screen, long event, long now) throws Exception {
    return chooseForArrival(screen, event, now, System.currentTimeMillis());
  }

  String chooseForArrival(String screen, long event, long now, long wallTime) throws Exception {
    checkScreen(screen);
    synchronized (WallpaperFiles.class) {
      String active = WallpaperFiles.activeId(preferences, screen);
      if (!preferences.getBoolean("shuffle_" + screen, false)) return active;
      if (SettingsActivity.hasPendingChanges()) {
        // Imports defer activation, but must not leave out-of-window artwork visible.
        return shuffleIds(screen).contains(active)
                && rule(shuffleRules(screen), active)
                    .eligible(ViennaSun.at(wallTime).daytime(wallTime))
            ? active
            : null;
      }
      Map<String, Double> valid = new HashMap<>();
      Map<String, JSONObject> saved = new HashMap<>();
      JSONObject rules = shuffleRules(screen);
      boolean daytime = ViennaSun.at(wallTime).daytime(wallTime);
      for (String id : shuffleIds(screen))
        try {
          JSONObject item = manifest(folder(id));
          ShufflePolicy.Rule setting = rule(rules, id);
          if (PackPolicy.supports(item.optString("screen", ""), screen)
              && setting.eligible(daytime)) {
            valid.put(id, setting.weight);
            saved.put(id, item);
          }
        } catch (Exception ignored) {
          /* A damaged entry is left intact and skipped. */
        }
      if (valid.isEmpty()) return null;
      java.util.List<String> sorted = new java.util.ArrayList<>(valid.keySet());
      java.util.Collections.sort(sorted);
      String pool = selectionContext(screen, wallTime) + "|eligible=" + sorted;
      String recent = shufflePolicy.recent(screen, pool, active, event, now);
      if (recent != null) return recent;
      String chosen = ShufflePolicy.weightedPick(valid, active, random);
      if (!chosen.equals(active)) files.activateLocked(chosen, saved.get(chosen), screen, true);
      shufflePolicy.remember(screen, pool, chosen, event, now);
      return chosen;
    }
  }

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
    for (String name :
        PackPolicy.files(manifest.optString("screen", ""), manifest.optString("kind", "animated")))
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
          for (String file :
              PackPolicy.files(
                  manifest.optString("screen", ""), manifest.optString("kind", "animated")))
            size += PackPolicy.child(folder, file).length();
          boolean cover = id.equals(WallpaperFiles.activeId(preferences, "cover"));
          boolean inner = id.equals(WallpaperFiles.activeId(preferences, "inner"));
          result.put(
              new JSONObject()
                  .put("id", id)
                  .put("name", name(id, manifest))
                  .put("screen", manifest.optString("screen", ""))
                  .put("kind", manifest.optString("kind", "animated"))
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

  WallpaperPreviewSource previewSource(String id, String screen) throws Exception {
    checkScreen(screen);
    synchronized (WallpaperFiles.class) {
      File directory = folder(id);
      JSONObject saved = manifest(directory);
      if (!PackPolicy.supports(saved.optString("screen", ""), screen))
        throw new IOException("This wallpaper belongs to the other screen");
      String kind = saved.optString("kind", "animated");
      boolean image = PackPolicy.isStatic(kind);
      boolean fallback =
          saved.has("steadyMotion")
              ? "animated".equals(saved.getString("steadyMotion"))
              : WallpaperFiles.playback(preferences, screen, "idle");
      boolean idle =
          id.equals(WallpaperFiles.activeId(preferences, screen))
              ? WallpaperFiles.playback(preferences, screen, "idle")
              : preferences.getBoolean(
                  "gallery_" + screen + "_idle_" + id,
                  preferences.getBoolean("gallery_idle_" + id, fallback));
      BitmapFactory.Options dimensions = new BitmapFactory.Options();
      dimensions.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(
          PackPolicy.child(directory, screen + "-poster.png").getAbsolutePath(), dimensions);
      // A preview deliberately shows the entry when present, even if entry playback
      // is currently disabled on the home screen. Nothing is applied or persisted.
      return new WallpaperPreviewSource(
          directory,
          screen,
          image,
          PackPolicy.hasEntry(kind),
          idle,
          dimensions.outWidth,
          dimensions.outHeight);
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
      if (selected) {
        files.activateLocked(id, manifest, screen);
        return;
      }
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
      for (String screen : new String[] {"cover", "inner"})
        if (preferences.getBoolean("shuffle_" + screen, false) && shuffleIds(screen).contains(id))
          throw new IOException("Remove this wallpaper from shuffle before deleting it");
      JSONObject coverRules = shuffleRules("cover"), innerRules = shuffleRules("inner");
      coverRules.remove(id);
      innerRules.remove(id);
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
                .remove("gallery_inner_arrival_" + id)
                .putString("shuffle_cover_rules", coverRules.toString())
                .putString("shuffle_inner_rules", innerRules.toString()),
            "gallery_name_" + id,
            "gallery_idle_" + id,
            "gallery_arrival_" + id,
            "gallery_cover_idle_" + id,
            "gallery_cover_arrival_" + id,
            "gallery_inner_idle_" + id,
            "gallery_inner_arrival_" + id,
            "shuffle_cover_rules",
            "shuffle_inner_rules");
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
