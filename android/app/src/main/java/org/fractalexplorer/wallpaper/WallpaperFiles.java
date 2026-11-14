package org.fractalexplorer.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
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
          if (file.isFile() && file.getName().matches("[a-f0-9]{32}\\.(mp4|png|image)"))
            file.delete();
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

  static boolean isStatic(SharedPreferences preferences, String screen) {
    return preferences.getBoolean(screen + "_static", false);
  }

  static boolean hasEntry(SharedPreferences preferences, String screen) {
    return preferences.getBoolean(screen + "_has_entry", true);
  }

  static long revision(SharedPreferences preferences, String screen) {
    return preferences.getLong(screen + "_revision", preferences.getLong("revision", 0));
  }

  // Two mirror bits: 0 = original, 1 = left/right, 2 = top/bottom, 3 = 180 degrees.
  static int orientation(SharedPreferences preferences, String screen) {
    int value = preferences.getInt(screen + "_orientation", 0);
    return value >= 0 && value < 4 ? value : 0;
  }

  void validate(File folder, JSONObject manifest) throws Exception {
    String kind = manifest.optString("kind", "animated");
    boolean image = PackPolicy.isStatic(kind);
    String motion = manifest.optString("steadyMotion", "animated");
    if (!"still".equals(motion) && !"animated".equals(motion))
      throw new IOException("Invalid steady-state playback mode");
    if (!"fractal-wallpaper/v1".equals(manifest.getString("format"))
        || manifest.getInt("version") != 1) throw new IOException("Unsupported wallpaper package");
    JSONObject clips = image ? new JSONObject() : manifest.getJSONObject("clips");
    String scope = manifest.optString("screen", "");
    PackPolicy.screens(scope);
    for (int i = 0; i < PackPolicy.KEYS.length; i++) {
      if (!PackPolicy.files(scope, kind).contains(PackPolicy.VIDEOS[i])) continue;
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
      if (image) {
        JSONObject expected = manifest.getJSONObject("images").getJSONObject(screen);
        if (!name.equals(expected.getString("file"))
            || expected.getInt("width") != options.outWidth
            || expected.getInt("height") != options.outHeight)
          throw new IOException("Static image does not match its manifest");
      }
    }
  }

  String publish(File folder, JSONObject manifest) throws Exception {
    synchronized (WallpaperFiles.class) {
      return publishLocked(folder, manifest);
    }
  }

  private String publishLocked(File folder, JSONObject manifest) throws Exception {
    return publishLocked(folder, manifest, true);
  }

  String retain(File folder, JSONObject manifest) throws Exception {
    synchronized (WallpaperFiles.class) {
      return publishLocked(folder, manifest, false);
    }
  }

  private String publishLocked(File folder, JSONObject manifest, boolean activate)
      throws Exception {
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
      if (activate) activateLocked(id, manifest);
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
    activateLocked(id, manifest, selectedScreen, false);
  }

  void activateLocked(String id, JSONObject manifest, String selectedScreen, boolean keepPlayback)
      throws Exception {
    activateLocked(id, manifest, selectedScreen, keepPlayback, 0);
  }

  void activateLocked(
      String id, JSONObject manifest, String selectedScreen, boolean keepPlayback, int orientation)
      throws Exception {
    if (orientation < 0 || orientation > 3) throw new IOException("Invalid wallpaper orientation");
    SharedPreferences preferences = context.getSharedPreferences("wallpaper", 0);
    String scope = manifest.optString("screen", "");
    if (selectedScreen != null && !PackPolicy.supports(scope, selectedScreen))
      throw new IOException("This wallpaper belongs to the other screen");
    String[] screens =
        selectedScreen == null ? PackPolicy.screens(scope) : PackPolicy.screens(selectedScreen);
    SharedPreferences.Editor edit = preferences.edit();
    java.util.List<String> keys = new java.util.ArrayList<>();
    boolean staticWallpaper = PackPolicy.isStatic(manifest.optString("kind", "animated"));
    for (String screen : screens) {
      edit.putBoolean(screen + "_static", staticWallpaper);
      keys.add(screen + "_static");
      edit.putBoolean(
          screen + "_has_entry", PackPolicy.hasEntry(manifest.optString("kind", "animated")));
      keys.add(screen + "_has_entry");
      if (!keepPlayback) {
        edit.putBoolean("shuffle_" + screen, false);
        keys.add("shuffle_" + screen);
      }
      String previous = activeId(preferences, screen);
      boolean orientationChanged = orientation(preferences, screen) != orientation;
      edit.putInt(screen + "_orientation", orientation);
      keys.add(screen + "_orientation");
      if (id.equals(previous)) {
        if (orientationChanged) {
          edit.putLong(screen + "_revision", revision(preferences, screen) + 1);
          keys.add(screen + "_revision");
        }
        continue;
      }
      for (String key : new String[] {"idle", "arrival"}) {
        String saved = "gallery_" + screen + "_" + key + "_";
        boolean fallback =
            "idle".equals(key) && manifest.has("steadyMotion")
                ? "animated".equals(manifest.getString("steadyMotion"))
                : playback(preferences, screen, key);
        boolean value =
            keepPlayback || staticWallpaper
                ? playback(preferences, screen, key)
                : preferences.getBoolean(
                    saved + id, preferences.getBoolean("gallery_" + key + "_" + id, fallback));
        if (!keepPlayback && PackPolicy.validId(previous)) {
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
    if (!keepPlayback) for (String screen : screens) WallpaperGallery.resetShuffle(screen);
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
        if (isStatic(context.getSharedPreferences("wallpaper", 0), prefix))
          throw new IOException("Choose an animated wallpaper before replacing its video clips.");
        JSONObject selectedSteady = new JSONObject();
        String activeId = activeId(context.getSharedPreferences("wallpaper", 0), prefix);
        File activeManifest =
            PackPolicy.validId(activeId)
                ? new File(new File(root(), activeId), "wallpaper.json")
                : null;
        JSONObject previousManifest =
            activeManifest != null && activeManifest.isFile()
                ? new JSONObject(
                    new String(Files.readAllBytes(activeManifest.toPath()), StandardCharsets.UTF_8))
                : null;
        JSONObject previousFlags =
            previousManifest == null ? null : previousManifest.optJSONObject("customSteady");
        String kind =
            slot.endsWith("arrival")
                    || previousManifest == null
                    || PackPolicy.hasEntry(previousManifest.optString("kind", "animated"))
                ? "animated"
                : "loop";
        for (String screen : new String[] {"cover", "inner"})
          selectedSteady.put(
              screen,
              previousFlags == null
                  ? activeFile(context, screen + "-idle.mp4").isFile()
                  : previousFlags.optBoolean(screen, false));
        boolean hasSteady = selectedSteady.getBoolean(prefix);
        for (String name : PackPolicy.files(prefix, kind)) {
          if (name.equals("wallpaper.json") || name.equals(filename)) continue;
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
          if (!PackPolicy.files(prefix, kind).contains(PackPolicy.VIDEOS[i])) continue;
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
                .put("kind", kind)
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

  /** Selects a single imported package; palette batches only add gallery entries. */
  int importZip(InputStream source) throws Exception {
    List<File> folders = new ArrayList<>();
    List<JSONObject> manifests = new ArrayList<>();
    boolean batch;
    try {
      try (ZipInputStream archive = new ZipInputStream(source)) {
        ZipEntry entry = archive.getNextEntry();
        if (entry == null) throw new IOException("This ZIP contains no wallpaper packages");
        batch = entry.getName().endsWith(".zip");
        long[] unpacked = {0};
        if (batch) {
          Set<String> names = new HashSet<>();
          do {
            String name = entry.getName();
            if (entry.isDirectory()
                || !name.matches("[a-z0-9-]+\\.zip")
                || !names.add(name)
                || names.size() > 4)
              throw new IOException("A palette batch must contain 1–4 unique wallpaper ZIPs");
            File folder = staging();
            folders.add(folder);
            PackageInput input = new PackageInput(archive);
            try (ZipInputStream nested = new ZipInputStream(input)) {
              manifests.add(readPackage(nested, nested.getNextEntry(), folder, unpacked));
            } catch (Exception error) {
              throw new IOException("Could not read " + name + ": " + error.getMessage(), error);
            }
            // Nested ZIP readers stop at their directory. Finish the outer entry
            // to check its CRC/size, including bytes buffered by the nested reader.
            byte[] buffer = new byte[65536];
            while (input.read(buffer) != -1) {}
            archive.closeEntry();
          } while ((entry = archive.getNextEntry()) != null);
        } else {
          File folder = staging();
          folders.add(folder);
          manifests.add(readPackage(archive, entry, folder, unpacked));
        }
      }
      // A provider may fail on close. Publish only after all input has succeeded.
      synchronized (WallpaperFiles.class) {
        List<File> published = new ArrayList<>();
        try {
          for (int i = 0; i < folders.size(); i++) {
            String id = publishLocked(folders.get(i), manifests.get(i), !batch);
            published.add(new File(root(), id));
          }
        } catch (Exception error) {
          for (File folder : published)
            try {
              deleteFolder(folder);
            } catch (IOException cleanup) {
              error.addSuppressed(cleanup);
            }
          throw error;
        }
      }
      return folders.size();
    } finally {
      for (File folder : folders) if (folder.exists()) deleteFolder(folder);
    }
  }

  /** Bounded, non-closing view of one outer ZIP entry; recursion is never allowed. */
  private static final class PackageInput extends FilterInputStream {
    private long count;

    PackageInput(InputStream source) {
      super(source);
    }

    private void record(int size) throws IOException {
      if (size > 0 && (count += size) > 512L * 1024 * 1024)
        throw new IOException("A palette wallpaper ZIP exceeds 512 MiB");
    }

    @Override
    public int read() throws IOException {
      int value = in.read();
      record(value < 0 ? 0 : 1);
      return value;
    }

    @Override
    public int read(byte[] bytes, int offset, int length) throws IOException {
      int size = in.read(bytes, offset, length);
      record(size);
      return size;
    }

    @Override
    public void close() {
      /* The outer archive owns the document stream. */
    }
  }

  private JSONObject readPackage(ZipInputStream archive, ZipEntry entry, File folder, long[] total)
      throws Exception {
    Set<String> seen = new HashSet<>();
    if (entry == null) throw new IOException("Empty wallpaper ZIP");
    do {
      if (entry.isDirectory() || !seen.add(entry.getName()) || seen.size() > 7)
        throw new IOException("Invalid or duplicated wallpaper entry");
      File file = PackPolicy.child(folder, entry.getName());
      try (FileOutputStream output = new FileOutputStream(file)) {
        byte[] buffer = new byte[65536];
        int count;
        long size = 0;
        while ((count = archive.read(buffer)) != -1) {
          size += count;
          total[0] += count;
          long limit =
              entry.getName().endsWith(".mp4")
                  ? PackPolicy.MAX_VIDEO_BYTES
                  : entry.getName().endsWith(".json")
                      ? PackPolicy.MAX_JSON_BYTES
                      : PackPolicy.MAX_POSTER_BYTES;
          if (size > limit || total[0] > PackPolicy.MAX_PACKAGE_BYTES)
            throw new IOException("Wallpaper package is too large");
          output.write(buffer, 0, count);
        }
      }
      archive.closeEntry();
    } while ((entry = archive.getNextEntry()) != null);
    if (!seen.contains("wallpaper.json")) throw new IOException("Missing wallpaper.json");
    byte[] bytes =
        java.nio.file.Files.readAllBytes(PackPolicy.child(folder, "wallpaper.json").toPath());
    JSONObject manifest = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    if (!seen.equals(
        PackPolicy.files(manifest.optString("screen", ""), manifest.optString("kind", "animated"))))
      throw new IOException(
          "Wallpaper package does not contain the files required for its type and screen");
    return manifest;
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
