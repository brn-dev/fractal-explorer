package org.fractalexplorer.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.ImageDecoder;
import android.media.MediaMetadataRetriever;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;
import javax.imageio.ImageIO;
import org.json.*;

/**
 * Production storage, image-import and carousel code with explicit ImageIO/Android host fixtures.
 */
public final class StaticWallpaperTest {
  static int checks;

  static void check(boolean value, String why) {
    checks++;
    if (!value) throw new AssertionError(why);
  }

  interface Work {
    void run() throws Exception;
  }

  static void fails(Work work, String why) throws Exception {
    boolean failed = false;
    try {
      work.run();
    } catch (Exception e) {
      failed = true;
    }
    check(failed, why);
  }

  static final class Prefs implements SharedPreferences {
    final Map<String, Object> data = new HashMap<>();
    boolean fail;

    public Map<String, ?> getAll() {
      return new HashMap<>(data);
    }

    public String getString(String k, String d) {
      return (String) data.getOrDefault(k, d);
    }

    @SuppressWarnings("unchecked")
    public Set<String> getStringSet(String k, Set<String> d) {
      return (Set<String>) data.getOrDefault(k, d);
    }

    public int getInt(String k, int d) {
      return (Integer) data.getOrDefault(k, d);
    }

    public long getLong(String k, long d) {
      return (Long) data.getOrDefault(k, d);
    }

    public float getFloat(String k, float d) {
      return (Float) data.getOrDefault(k, d);
    }

    public boolean getBoolean(String k, boolean d) {
      return (Boolean) data.getOrDefault(k, d);
    }

    public boolean contains(String k) {
      return data.containsKey(k);
    }

    public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}

    public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}

    public Editor edit() {
      return new Editor() {
        final Map<String, Object> values = new HashMap<>();
        final Set<String> removed = new HashSet<>();
        boolean clear;

        public Editor putString(String k, String v) {
          values.put(k, v);
          return this;
        }

        public Editor putStringSet(String k, Set<String> v) {
          values.put(k, new HashSet<>(v));
          return this;
        }

        public Editor putInt(String k, int v) {
          values.put(k, v);
          return this;
        }

        public Editor putLong(String k, long v) {
          values.put(k, v);
          return this;
        }

        public Editor putFloat(String k, float v) {
          values.put(k, v);
          return this;
        }

        public Editor putBoolean(String k, boolean v) {
          values.put(k, v);
          return this;
        }

        public Editor remove(String k) {
          removed.add(k);
          return this;
        }

        public Editor clear() {
          clear = true;
          return this;
        }

        public boolean commit() {
          if (clear) data.clear();
          removed.forEach(data::remove);
          data.putAll(values);
          if (fail) {
            fail = false;
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

  static final class Fixture {
    final Prefs prefs = new Prefs();
    final Context context;
    final WallpaperFiles files;
    final WallpaperGallery gallery;

    Fixture(File root) {
      context = new Context(root, prefs);
      files = new WallpaperFiles(context);
      gallery = new WallpaperGallery(context);
    }

    String image(String screen) throws Exception {
      return StaticImageImporter.importImage(
          context, new ByteArrayInputStream(png(160, 160, true)), screen, "Still " + screen);
    }

    String animation(String screen) throws Exception {
      File folder = files.staging();
      JSONObject clips = new JSONObject();
      for (int i = 0; i < PackPolicy.VIDEOS.length; i++)
        if (PackPolicy.VIDEOS[i].startsWith(screen + "-")) {
          Files.write(new File(folder, PackPolicy.VIDEOS[i]).toPath(), new byte[] {1, 2, 3});
          clips.put(
              PackPolicy.KEYS[i],
              new JSONObject()
                  .put("file", PackPolicy.VIDEOS[i])
                  .put("width", 160)
                  .put("height", 160)
                  .put("duration", 1));
        }
      Files.write(new File(folder, screen + "-poster.png").toPath(), png(160, 160, false));
      return files.publish(
          folder,
          new JSONObject()
              .put("format", "fractal-wallpaper/v1")
              .put("version", 1)
              .put("screen", screen)
              .put("name", "Animation")
              .put("steadyMotion", "animated")
              .put("clips", clips));
    }

    File folder(String id) throws Exception {
      return PackPolicy.folder(files.root(), id);
    }
  }

  static byte[] png(int width, int height, boolean alpha) throws Exception {
    BufferedImage image =
        new BufferedImage(
            width, height, alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
    image.setRGB(width / 2, height / 2, 0xffff5500);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    check(ImageIO.write(image, "png", out), "encode source PNG");
    return out.toByteArray();
  }

  static JSONObject manifest(String screen, int width, int height) throws Exception {
    return new JSONObject()
        .put("format", "fractal-wallpaper/v1")
        .put("version", 1)
        .put("kind", "static")
        .put("screen", screen)
        .put("name", "Static package")
        .put("steadyMotion", "still")
        .put(
            "images",
            new JSONObject()
                .put(
                    screen,
                    new JSONObject()
                        .put("file", screen + "-poster.png")
                        .put("width", width)
                        .put("height", height)))
        .put("editor", new JSONObject().put("kind", "static"));
  }

  static byte[] zip(Map<String, byte[]> files) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try (ZipOutputStream zip = new ZipOutputStream(out)) {
      for (Map.Entry<String, byte[]> entry : files.entrySet()) {
        zip.putNextEntry(new ZipEntry(entry.getKey()));
        zip.write(entry.getValue());
        zip.closeEntry();
      }
    }
    return out.toByteArray();
  }

  static void imports(File root) throws Exception {
    for (String screen : new String[] {"cover", "inner"}) {
      Fixture f = new Fixture(new File(root, "imports-" + screen));
      f.prefs
          .edit()
          .putBoolean(screen + "_idle", true)
          .putBoolean(screen + "_arrival", true)
          .commit();
      int decoders = MediaMetadataRetriever.instances;
      byte[] input = png(240, 360, true);
      String id =
          StaticImageImporter.importImage(
              f.context, new ByteArrayInputStream(input), screen, "My PNG");
      check(WallpaperFiles.isStatic(f.prefs, screen), "static type stored on selected screen");
      check(
          !WallpaperFiles.isStatic(f.prefs, screen.equals("cover") ? "inner" : "cover"),
          "other screen type unchanged");
      check(
          WallpaperFiles.playback(f.prefs, screen, "idle")
              && WallpaperFiles.playback(f.prefs, screen, "arrival"),
          "image activation preserves animation preferences");
      check(
          MediaMetadataRetriever.instances == decoders,
          "image import never opens video metadata decoder");
      File poster = new File(f.folder(id), screen + "-poster.png");
      BufferedImage decoded = ImageIO.read(poster);
      check(decoded.getWidth() == 240 && decoded.getHeight() == 360, "image dimensions preserved");
      check(decoded.getRGB(0, 0) == 0xff000000, "transparent pixels become black");
      check(decoded.getRGB(120, 180) == 0xffff5500, "opaque image pixels preserved");
      check(ImageDecoder.normalized(), "software sRGB/opaque normalization requested");
      check(f.folder(id).list().length == 2, "image entry contains only PNG and manifest");
      JSONObject row = f.gallery.list().getJSONObject(0);
      check(
          row.getString("kind").equals("static") && !row.getBoolean("editable"),
          "raw image gallery entry identified without fractal editor");
      check(
          f.gallery.thumbnail(id, screen).startsWith("data:image/png;base64,"),
          "image thumbnail available");
      fails(
          () -> f.files.replaceVideo(screen + "-idle", poster, poster),
          "cannot replace a video slot in an image-only entry");
      check(
          Arrays.stream(new File(f.context.getCacheDir(), "clip-imports").list())
              .noneMatch(n -> n.endsWith(".image")),
          "source cache cleaned");
      String before = WallpaperFiles.activeId(f.prefs, screen);
      long revision = WallpaperFiles.revision(f.prefs, screen);
      int count = f.gallery.list().length();
      for (byte[] invalid : new byte[][] {new byte[] {1, 2, 3}, png(15, 20, false)})
        fails(
            () ->
                StaticImageImporter.importImage(
                    f.context, new ByteArrayInputStream(invalid), screen, "Bad image"),
            "invalid image rejected");
      int decodedBefore = ImageDecoder.decodes;
      fails(
          () ->
              StaticImageImporter.importImage(
                  f.context,
                  new ByteArrayInputStream(input) {
                    @Override
                    public void close() throws IOException {
                      throw new IOException("provider close failed");
                    }
                  },
                  screen,
                  "Close failure"),
          "provider close failure prevents publication");
      check(ImageDecoder.decodes == decodedBefore, "provider closes before decoding/publishing");
      check(
          before.equals(WallpaperFiles.activeId(f.prefs, screen))
              && revision == WallpaperFiles.revision(f.prefs, screen)
              && count == f.gallery.list().length(),
          "failed imports preserve active entry and gallery");
      f.prefs.fail = true;
      fails(() -> f.image(screen), "failed preference commit rejects publication");
      check(
          before.equals(WallpaperFiles.activeId(f.prefs, screen))
              && WallpaperFiles.isStatic(f.prefs, screen),
          "failed publication rolls back image flag and active selection");
      byte[] huge = png(5000, 1000, false);
      String scaled =
          StaticImageImporter.importImage(
              f.context, new ByteArrayInputStream(huge), screen, "Large image");
      BufferedImage image = ImageIO.read(new File(f.folder(scaled), screen + "-poster.png"));
      check(
          image.getWidth() == 4096 && image.getHeight() == 819,
          "oversized image scaled into texture limits without upscaling");
    }
    Fixture jpg = new Fixture(new File(root, "jpeg"));
    BufferedImage photo = new BufferedImage(160, 160, BufferedImage.TYPE_INT_RGB);
    photo.setRGB(80, 80, 0xff1188ee);
    ByteArrayOutputStream encoded = new ByteArrayOutputStream();
    ImageIO.write(photo, "jpg", encoded);
    String id =
        StaticImageImporter.importImage(
            jpg.context, new ByteArrayInputStream(encoded.toByteArray()), "inner", "JPEG");
    check(
        ImageIO.read(new File(jpg.folder(id), "inner-poster.png")) != null,
        "JPEG source normalized to PNG");
  }

  static void packagesAndShuffle(File root) throws Exception {
    for (String screen : new String[] {"cover", "inner"}) {
      Fixture f = new Fixture(new File(root, "carousel-" + screen));
      String video = f.animation(screen), still = f.image(screen);
      String other = screen.equals("cover") ? "inner" : "cover";
      f.prefs
          .edit()
          .putBoolean(screen + "_arrival", true)
          .putBoolean(screen + "_idle", true)
          .commit();
      f.gallery.setShuffle(screen, new JSONArray().put(video).put(still), true);
      long revision = WallpaperFiles.revision(f.prefs, screen);
      String pick = f.gallery.chooseForArrival(screen, 10, 100);
      check(
          pick.equals(video) && !WallpaperFiles.isStatic(f.prefs, screen),
          "carousel switches from image to animation");
      check(
          WallpaperFiles.playback(f.prefs, screen, "idle")
              && WallpaperFiles.playback(f.prefs, screen, "arrival"),
          "animation settings survive static entry");
      check(
          f.gallery.chooseForArrival(screen, 10, 101).equals(pick)
              && WallpaperFiles.revision(f.prefs, screen) == revision + 1,
          "same reveal coalesces without selecting twice");
      check(
          f.gallery.chooseForArrival(screen, 11, 200).equals(still)
              && WallpaperFiles.isStatic(f.prefs, screen),
          "carousel switches back to static image");
      check(
          WallpaperFiles.activeId(f.prefs, other).isEmpty(),
          "mixed shuffle keeps other screen unchanged");
      f.gallery.setShuffle(screen, new JSONArray().put(still), true);
      check(
          f.gallery.chooseForArrival(screen, 12, 300).equals(still),
          "one-image shuffle remains valid");
      f.prefs.fail = true;
      fails(
          () -> f.gallery.apply(video, screen), "failed animated activation rolls back image type");
      check(
          WallpaperFiles.isStatic(f.prefs, screen)
              && WallpaperFiles.activeId(f.prefs, screen).equals(still),
          "failed mixed activation preserves image selection");
      Map<String, byte[]> pkg = new LinkedHashMap<>();
      pkg.put(screen + "-poster.png", png(160, 160, false));
      pkg.put(
          "wallpaper.json",
          manifest(screen, 160, 160).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
      f.files.importZip(new ByteArrayInputStream(zip(pkg)));
      String active = WallpaperFiles.activeId(f.prefs, screen);
      boolean editable = false;
      JSONArray entries = f.gallery.list();
      for (int index = 0; index < entries.length(); index++) {
        JSONObject entry = entries.getJSONObject(index);
        if (active.equals(entry.getString("id"))) editable = entry.getBoolean("editable");
      }
      check(editable, "static package preserves editable draft");
      pkg.put(
          "wallpaper.json",
          manifest(screen, 161, 160).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
      fails(
          () -> f.files.importZip(new ByteArrayInputStream(zip(pkg))),
          "wrong image dimensions rejected");
      pkg.put(
          "wallpaper.json",
          manifest(screen, 160, 160).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
      pkg.put(screen + "-idle.mp4", new byte[] {1});
      fails(
          () -> f.files.importZip(new ByteArrayInputStream(zip(pkg))),
          "image package with video members rejected");
      check(
          active.equals(WallpaperFiles.activeId(f.prefs, screen)),
          "bad packages preserve selection");
      f.gallery.apply(video, screen);
      check(
          !WallpaperFiles.isStatic(f.prefs, screen),
          "manual animation selection clears static type");
    }
  }

  public static void main(String[] args) throws Exception {
    File root = new File(args[0], "static-" + UUID.randomUUID());
    check(root.mkdirs(), "create isolated test root");
    imports(root);
    packagesAndShuffle(root);
    if (args.length > 1) {
      Fixture f = new Fixture(new File(root, "browser-export"));
      try (InputStream in = new FileInputStream(args[1])) {
        f.files.importZip(in);
      }
      check(
          f.gallery.list().getJSONObject(0).getString("kind").equals("static"),
          "real browser static package imports through native storage");
    }
    System.out.println(
        "PASS "
            + checks
            + " production static import/storage/carousel assertions; Android codecs/media use"
            + " explicit ImageIO/metadata host fixtures, not device execution.");
  }
}
