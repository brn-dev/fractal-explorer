package org.fractalexplorer.wallpaper;

import android.content.SharedPreferences;
import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Runs on the host JVM: Android's failed commits still change the in-memory preferences. */
public final class GalleryPreferencesTest {
  private static final class Preferences implements SharedPreferences {
    final Map<String, Object> values = new HashMap<>();
    boolean fail;
    Runnable duringFailure;

    public Map<String, ?> getAll() {
      return new HashMap<>(values);
    }

    public String getString(String key, String fallback) {
      return (String) values.getOrDefault(key, fallback);
    }

    @SuppressWarnings("unchecked")
    public Set<String> getStringSet(String key, Set<String> fallback) {
      return (Set<String>) values.getOrDefault(key, fallback);
    }

    public int getInt(String key, int fallback) {
      return (Integer) values.getOrDefault(key, fallback);
    }

    public long getLong(String key, long fallback) {
      return (Long) values.getOrDefault(key, fallback);
    }

    public float getFloat(String key, float fallback) {
      return (Float) values.getOrDefault(key, fallback);
    }

    public boolean getBoolean(String key, boolean fallback) {
      return (Boolean) values.getOrDefault(key, fallback);
    }

    public boolean contains(String key) {
      return values.containsKey(key);
    }

    public void registerOnSharedPreferenceChangeListener(
        OnSharedPreferenceChangeListener listener) {}

    public void unregisterOnSharedPreferenceChangeListener(
        OnSharedPreferenceChangeListener listener) {}

    public Editor edit() {
      return new Editor() {
        final Map<String, Object> pending = new HashMap<>();
        final Set<String> removed = new HashSet<>();
        boolean clear;

        public Editor putString(String key, String value) {
          pending.put(key, value);
          return this;
        }

        public Editor putStringSet(String key, Set<String> value) {
          pending.put(key, value);
          return this;
        }

        public Editor putInt(String key, int value) {
          pending.put(key, value);
          return this;
        }

        public Editor putLong(String key, long value) {
          pending.put(key, value);
          return this;
        }

        public Editor putFloat(String key, float value) {
          pending.put(key, value);
          return this;
        }

        public Editor putBoolean(String key, boolean value) {
          pending.put(key, value);
          return this;
        }

        public Editor remove(String key) {
          removed.add(key);
          return this;
        }

        public Editor clear() {
          clear = true;
          return this;
        }

        public boolean commit() {
          if (clear) values.clear();
          for (String key : removed) values.remove(key);
          values.putAll(pending);
          if (fail) {
            fail = false;
            if (duringFailure != null) duringFailure.run();
            return false;
          }
          return true;
        }

        public void apply() {
          commit();
        }
      };
    }
  }

  public static void main(String[] args) throws Exception {
    Preferences prefs = new Preferences();
    prefs
        .edit()
        .putString("active_pack", "a")
        .putBoolean("idle", false)
        .putBoolean("arrival", true)
        .putLong("revision", 3)
        .putString("last_error", "old error")
        .putString("gallery_name_a", "A")
        .commit();
    prefs.fail = true;
    prefs.duringFailure = () -> prefs.values.put("gallery_name_b", "Concurrent rename");
    try {
      WallpaperGallery.commit(
          prefs,
          prefs
              .edit()
              .putString("active_pack", "b")
              .putBoolean("idle", true)
              .putLong("revision", 4)
              .remove("last_error")
              .putBoolean("gallery_idle_a", false),
          "active_pack",
          "idle",
          "revision",
          "last_error",
          "gallery_idle_a");
      throw new AssertionError("Failed commit reported success");
    } catch (IOException expected) {
    }
    if (!"a".equals(prefs.getString("active_pack", ""))
        || prefs.getBoolean("idle", true)
        || prefs.getLong("revision", 0) != 3
        || !"old error".equals(prefs.getString("last_error", ""))
        || prefs.contains("gallery_idle_a"))
      throw new AssertionError("Failed activation was not rolled back");
    if (!"Concurrent rename".equals(prefs.getString("gallery_name_b", "")))
      throw new AssertionError("Rollback clobbered unrelated concurrent settings");
    WallpaperGallery.commit(
        prefs, prefs.edit().putString("gallery_name_a", "Renamed"), "gallery_name_a");
    if (!"Renamed".equals(prefs.getString("gallery_name_a", "")))
      throw new AssertionError("Rename not saved");
    for (boolean attempted : new boolean[] {false, true}) {
      prefs.edit().putBoolean("cover_idle", false).commit();
      prefs.fail = true;
      prefs.duringFailure = () -> WallpaperGallery.setPlayback(prefs, "cover_idle", true);
      try {
        WallpaperGallery.commit(
            prefs,
            prefs.edit().putBoolean("cover_idle", attempted).putString("active_cover", "failed"),
            "cover_idle",
            "active_cover");
        throw new AssertionError("Failed activation reported success");
      } catch (IOException expected) {
      }
      if (!prefs.getBoolean("cover_idle", false) || prefs.contains("active_cover"))
        throw new AssertionError("Rollback erased a newer explicit playback choice");
    }
    System.out.println(
        "Gallery preference commit, failed activation rollback, and unrelated concurrent writes"
            + " passed.");
  }
}
