package org.fractalexplorer.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

final class WallpaperFiles {
  private final Context context;
  private static volatile boolean recovered;
  private static boolean importsRecovered;
  private static final Object importRecoveryLock = new Object();

  WallpaperFiles(Context context) {
    this.context = context.getApplicationContext();
    if (!recovered)
      synchronized (WallpaperFiles.class) {
        if (!recovered) {
          File[] old = new File(this.context.getFilesDir(), "wallpapers").listFiles();
          if (old != null)
            for (File folder : old) {
              if (folder.getName().matches("pending-[a-f0-9]{32}")) {
                try {
                  deleteFolder(folder);
                } catch (IOException ignored) {
                  /* Retry next process. */
                }
              }
            }
          recovered = true;
        }
      }
  }

  static void recoverImportCache(Context context) {
    synchronized (importRecoveryLock) {
      if (importsRecovered) return;
      File[] abandoned = new File(context.getCacheDir(), "clip-imports").listFiles();
      if (abandoned != null)
        for (File file : abandoned)
          if (file.isFile() && file.getName().matches("[a-f0-9]{32}\\.(mp4|png)")) file.delete();
      // Once per process: later activity recreation must not remove active imports.
      importsRecovered = true;
    }
  }

  static String newId() {
    return UUID.randomUUID().toString().replace("-", "");
  }

  File root() throws IOException {
    File folder = new File(context.getFilesDir(), "wallpapers");
    if (!folder.isDirectory() && !folder.mkdirs())
      throw new IOException("Cannot create wallpaper storage");
    return folder;
  }

  File staging() throws IOException {
    File folder = new File(root(), "pending-" + newId());
    if (!folder.mkdir()) throw new IOException("Cannot create wallpaper draft");
    return folder;
  }

  static File activeFile(Context context, String filename) {
    String screen = filename.startsWith("cover-") ? "cover" : "inner";
    String id = activeId(context.getSharedPreferences("wallpaper", 0), screen);
    if (PackPolicy.validId(id)) {
      File active = new File(new File(new File(context.getFilesDir(), "wallpapers"), id), filename);
      if (active.isFile()) return active;
    }
    return new File(new File(context.getFilesDir(), "videos"), filename);
  }

  static String activeId(SharedPreferences preferences, String screen) {
    return preferences.getString("active_" + screen, preferences.getString("active_pack", ""));
  }

  static boolean playback(SharedPreferences preferences, String screen, String key) {
    return preferences.getBoolean(screen + "_" + key, preferences.getBoolean(key, true));
  }

  static long revision(SharedPreferences preferences, String screen) {
    return preferences.getLong(screen + "_revision", preferences.getLong("revision", 0));
  }

  void validate(File folder, JSONObject manifest) throws Exception {
    String motion = manifest.optString("steadyMotion", "animated");
    if (!"still".equals(motion) && !"animated".equals(motion))
      throw new IOException("Invalid steady-state playback mode");
    if (!"fractal-wallpaper/v1".equals(manifest.getString("format"))
        || manifest.getInt("version") != 1) throw new IOException("Unsupported wallpaper package");
    JSONObject clips = manifest.getJSONObject("clips");
    String scope = manifest.optString("screen", "");
    PackPolicy.screens(scope);
    for (int i = 0; i < PackPolicy.KEYS.length; i++) {
      if (!PackPolicy.files(scope).contains(PackPolicy.VIDEOS[i])) continue;
      JSONObject expected = clips.getJSONObject(PackPolicy.KEYS[i]);
      if (!PackPolicy.VIDEOS[i].equals(expected.getString("file")))
        throw new IOException("Unexpected wallpaper clip");
      File file = PackPolicy.child(folder, PackPolicy.VIDEOS[i]);
      if (!file.isFile() || file.length() == 0 || file.length() > PackPolicy.MAX_VIDEO_BYTES)
        throw new IOException("Missing or oversized wallpaper video");
      try (MediaMetadataRetriever reader = new MediaMetadataRetriever()) {
        reader.setDataSource(file.getAbsolutePath());
        int width =
            Integer.parseInt(
                reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
        int height =
            Integer.parseInt(
                reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
        long duration =
            Long.parseLong(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
        if (width != expected.getInt("width")
            || height != expected.getInt("height")
            || width < 16
            || height < 16
            || Math.max(width, height) > 4096
            || duration < 400
            || duration > 61000)
          throw new IOException("Wallpaper video does not match its manifest");
      }
    }
    for (String screen : PackPolicy.screens(scope)) {
      String name = screen + "-poster.png";
      File poster = PackPolicy.child(folder, name);
      if (!poster.isFile() || poster.length() > PackPolicy.MAX_POSTER_BYTES)
        throw new IOException("Invalid wallpaper poster size");
      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(PackPolicy.child(folder, name).getAbsolutePath(), options);
      if (options.outWidth < 16
          || options.outHeight < 16
          || Math.max(options.outWidth, options.outHeight) > 4096)
        throw new IOException("Invalid wallpaper poster");
    }
  }

  String publish(File folder, JSONObject manifest) throws Exception {
    synchronized (WallpaperFiles.class) {
      return publishLocked(folder, manifest);
    }
  }

  private String publishLocked(File folder, JSONObject manifest) throws Exception {
    validate(folder, manifest);
    byte[] encoded = manifest.toString().getBytes(StandardCharsets.UTF_8);
    if (encoded.length > PackPolicy.MAX_JSON_BYTES)
      throw new IOException("Wallpaper draft exceeds 4 MiB");
    try (FileOutputStream output =
        new FileOutputStream(PackPolicy.child(folder, "wallpaper.json"))) {
      output.write(encoded);
    }
    String id = newId();
    File destination = new File(root(), id);
    if (!folder.renameTo(destination)) throw new IOException("Cannot finish the wallpaper package");
    try {
      activateLocked(id, manifest);
    } catch (Exception error) {
      deleteFolder(destination);
      throw error;
    }
    // Completed packages are gallery entries. Only an explicit Delete removes them.
    return id;
  }

  void activateLocked(String id, JSONObject manifest) throws Exception {
    activateLocked(id, manifest, null);
  }

  void activateLocked(String id, JSONObject manifest, String selectedScreen) throws Exception {
    SharedPreferences preferences = context.getSharedPreferences("wallpaper", 0);
    String scope = manifest.optString("screen", "");
    if (selectedScreen != null && !PackPolicy.supports(scope, selectedScreen))
      throw new IOException("This wallpaper belongs to the other screen");
    String[] screens =
        selectedScreen == null ? PackPolicy.screens(scope) : PackPolicy.screens(selectedScreen);
    SharedPreferences.Editor edit = preferences.edit();
    java.util.List<String> keys = new java.util.ArrayList<>();
    for (String screen : screens) {
      String previous = activeId(preferences, screen);
      if (id.equals(previous)) continue;
      for (String key : new String[] {"idle", "arrival"}) {
        String saved = "gallery_" + screen + "_" + key + "_";
        boolean fallback =
            "idle".equals(key) && manifest.has("steadyMotion")
                ? "animated".equals(manifest.getString("steadyMotion"))
                : playback(preferences, screen, key);
        boolean value =
            preferences.getBoolean(
                saved + id, preferences.getBoolean("gallery_" + key + "_" + id, fallback));
        if (PackPolicy.validId(previous)) {
          edit.putBoolean(saved + previous, playback(preferences, screen, key));
          keys.add(saved + previous);
        }
        edit.putBoolean(screen + "_" + key, value);
        keys.add(screen + "_" + key);
      }
      edit.putString("active_" + screen, id)
          .putLong(screen + "_revision", revision(preferences, screen) + 1);
      keys.add("active_" + screen);
      keys.add(screen + "_revision");
    }
    // Preserve the legacy pointer for callers importing an older combined pack.
    if (selectedScreen == null && scope.isEmpty()) {
      edit.putString("active_pack", id);
      keys.add("active_pack");
    }
    edit.remove("last_error");
    keys.add("last_error");
    WallpaperGallery.commit(preferences, edit, keys.toArray(new String[0]));
  }

  /** Replace one clip while preserving every other currently selected state. */
  void replaceVideo(String slot, File video, File poster) throws Exception {
    String filename = slot + ".mp4";
    if (!java.util.Arrays.asList(PackPolicy.VIDEOS).contains(filename))
      throw new IOException("Unknown wallpaper clip");
    synchronized (WallpaperFiles.class) {
      File folder = staging();
      boolean complete = false;
      try {
        String prefix = slot.substring(0, slot.indexOf('-'));
        JSONObject selectedSteady = new JSONObject();
        String activeId = activeId(context.getSharedPreferences("wallpaper", 0), prefix);
        File activeManifest =
            PackPolicy.validId(activeId)
                ? new File(new File(root(), activeId), "wallpaper.json")
                : null;
        JSONObject previousFlags =
            activeManifest != null && activeManifest.isFile()
                ? new JSONObject(
                        new String(
                            Files.readAllBytes(activeManifest.toPath()), StandardCharsets.UTF_8))
                    .optJSONObject("customSteady")
                : null;
        for (String screen : new String[] {"cover", "inner"})
          selectedSteady.put(
              screen,
              previousFlags == null
                  ? activeFile(context, screen + "-idle.mp4").isFile()
                  : previousFlags.optBoolean(screen, false));
        boolean hasSteady = selectedSteady.getBoolean(prefix);
        for (String name : PackPolicy.files(prefix)) {
          if (name.equals("wallpaper.json")) continue;
          File selected = activeFile(context, name);
          try (InputStream source =
              selected.isFile()
                  ? new java.io.FileInputStream(selected)
                  : context.getAssets().open(name)) {
            Files.copy(source, PackPolicy.child(folder, name).toPath());
          }
        }
        Files.copy(
            video.toPath(),
            PackPolicy.child(folder, filename).toPath(),
            StandardCopyOption.REPLACE_EXISTING);
        if (slot.endsWith("idle") || !hasSteady)
          Files.copy(
              poster.toPath(),
              PackPolicy.child(folder, prefix + "-poster.png").toPath(),
              StandardCopyOption.REPLACE_EXISTING);
        if (slot.endsWith("idle")) selectedSteady.put(prefix, true);
        JSONObject clips = new JSONObject();
        for (int i = 0; i < PackPolicy.VIDEOS.length; i++) {
          if (!PackPolicy.VIDEOS[i].startsWith(prefix + "-")) continue;
          try (MediaMetadataRetriever reader = new MediaMetadataRetriever()) {
            reader.setDataSource(PackPolicy.child(folder, PackPolicy.VIDEOS[i]).getAbsolutePath());
            clips.put(
                PackPolicy.KEYS[i],
                new JSONObject()
                    .put("file", PackPolicy.VIDEOS[i])
                    .put(
                        "width",
                        Integer.parseInt(
                            reader.extractMetadata(
                                MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)))
                    .put(
                        "height",
                        Integer.parseInt(
                            reader.extractMetadata(
                                MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)))
                    .put(
                        "duration",
                        Long.parseLong(
                                reader.extractMetadata(
                                    MediaMetadataRetriever.METADATA_KEY_DURATION))
                            / 1000.0)
                    .put("loop", PackPolicy.VIDEOS[i].contains("-idle")));
          }
        }
        JSONObject manifest =
            new JSONObject()
                .put("format", "fractal-wallpaper/v1")
                .put("version", 1)
                .put("screen", prefix)
                .put("name", "My imported fractals")
                .put("customSteady", selectedSteady)
                .put("clips", clips);
        publishLocked(folder, manifest);
        complete = true;
      } finally {
        if (!complete) deleteFolder(folder);
      }
    }
  }

  void importZip(InputStream source) throws Exception {
    File folder = null;
    boolean complete = false;
    Set<String> seen = new HashSet<>();
    long total = 0;
    try {
      try (ZipInputStream archive = new ZipInputStream(source)) {
        folder = staging();
        ZipEntry entry;
        while ((entry = archive.getNextEntry()) != null) {
          if (entry.isDirectory() || !seen.add(entry.getName()) || seen.size() > 7)
            throw new IOException("Invalid or duplicated wallpaper entry");
          File file = PackPolicy.child(folder, entry.getName());
          try (FileOutputStream output = new FileOutputStream(file)) {
            byte[] buffer = new byte[65536];
            int count;
            long size = 0;
            while ((count = archive.read(buffer)) != -1) {
              size += count;
              total += count;
              long limit =
                  entry.getName().endsWith(".mp4")
                      ? PackPolicy.MAX_VIDEO_BYTES
                      : entry.getName().endsWith(".json")
                          ? PackPolicy.MAX_JSON_BYTES
                          : PackPolicy.MAX_POSTER_BYTES;
              if (size > limit || total > PackPolicy.MAX_PACKAGE_BYTES)
                throw new IOException("Wallpaper package is too large");
              output.write(buffer, 0, count);
            }
          }
          archive.closeEntry();
        }
      }
      // A document provider can fail while closing. Do not activate until all
      // input I/O has succeeded, so a reported import failure keeps the old pack.
      byte[] bytes =
          java.nio.file.Files.readAllBytes(PackPolicy.child(folder, "wallpaper.json").toPath());
      JSONObject manifest = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
      if (!seen.equals(PackPolicy.files(manifest.optString("screen", ""))))
        throw new IOException(
            "Wallpaper package must contain its screen's transition, loop, poster, and manifest");
      publish(folder, manifest);
      complete = true;
    } finally {
      if (!complete && folder != null) deleteFolder(folder);
    }
  }

  void deleteFolder(File folder) throws IOException {
    File canonical = folder.getCanonicalFile(), parent = root().getCanonicalFile();
    String name = canonical.getName();
    if (!parent.equals(canonical.getParentFile())
        || !(PackPolicy.validId(name) || name.matches("pending-[a-f0-9]{32}")))
      throw new IOException("Invalid wallpaper storage path");
    File[] children = canonical.listFiles();
    if (children != null)
      for (File file : children) {
        File safe = PackPolicy.child(canonical, file.getName());
        if (safe.isDirectory() || (!safe.delete() && safe.exists()))
          throw new IOException("Cannot remove wallpaper file");
      }
    if (!canonical.delete() && canonical.exists())
      throw new IOException("Cannot remove wallpaper folder");
  }
}
