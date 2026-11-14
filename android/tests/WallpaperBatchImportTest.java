package org.fractalexplorer.wallpaper;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;
import org.json.*;

/** Exercises the real archive importer and gallery with explicit host media fixtures. */
public final class WallpaperBatchImportTest {
  private static int checks;

  static void check(boolean value, String message) {
    checks++;
    if (!value) throw new AssertionError(message);
  }

  static byte[] packageZip(String screen, String kind, String name, boolean invalid)
      throws Exception {
    Map<String, byte[]> entries = new LinkedHashMap<>();
    JSONObject manifest =
        StaticWallpaperTest.manifest(screen, invalid ? 161 : 160, 160)
            .put("name", name)
            .put("kind", kind);
    JSONObject clips = new JSONObject();
    if (!"static".equals(kind)) {
      for (int i = 0; i < PackPolicy.KEYS.length; i++) {
        String file = PackPolicy.VIDEOS[i];
        if (!PackPolicy.files(screen, kind).contains(file)) continue;
        entries.put(file, new byte[] {1, 2, 3});
        clips.put(
            PackPolicy.KEYS[i],
            new JSONObject()
                .put("file", file)
                .put("width", invalid ? 161 : 160)
                .put("height", 160)
                .put("duration", 1));
      }
      manifest.put("clips", clips);
    }
    entries.put(screen + "-poster.png", StaticWallpaperTest.png(160, 160, false));
    entries.put("wallpaper.json", manifest.toString().getBytes(StandardCharsets.UTF_8));
    return StaticWallpaperTest.zip(entries);
  }

  static byte[] batch(byte[]... packages) throws Exception {
    Map<String, byte[]> entries = new LinkedHashMap<>();
    for (int i = 0; i < packages.length; i++)
      entries.put("0" + (i + 1) + "-palette.zip", packages[i]);
    return StaticWallpaperTest.zip(entries);
  }

  static void unchanged(StaticWallpaperTest.Fixture f, byte[] archive, String reason)
      throws Exception {
    Map<String, ?> prefs = f.prefs.getAll();
    Set<String> folders = new HashSet<>(Arrays.asList(f.files.root().list()));
    boolean failed = false;
    try {
      f.files.importZip(new ByteArrayInputStream(archive));
    } catch (Exception expected) {
      failed = true;
      check(expected.getMessage() != null, "clear error: " + reason);
    }
    check(failed, "reject " + reason);
    check(f.prefs.getAll().equals(prefs), "preserve preferences: " + reason);
    check(
        new HashSet<>(Arrays.asList(f.files.root().list())).equals(folders),
        "clean all staged/published files: " + reason);
  }

  public static void main(String[] args) throws Exception {
    File root = new File(args[0], "palette-import-" + UUID.randomUUID());
    check(root.mkdirs(), "isolated test folder");
    for (String screen : new String[] {"cover", "inner"}) {
      StaticWallpaperTest.Fixture f = new StaticWallpaperTest.Fixture(new File(root, screen));
      String selected = f.image(screen);
      f.image(screen.equals("cover") ? "inner" : "cover");
      f.gallery.setShuffle(screen, new JSONArray().put(selected), true);
      Map<String, ?> prefs = f.prefs.getAll();
      int before = f.gallery.list().length();
      byte[] animated = packageZip(screen, "animated", "Warm sky", false);
      byte[] loop = packageZip(screen, "loop", "Cool sky", false);
      byte[] image = packageZip(screen, "static", "Dark sky", false);
      int count = f.files.importZip(new ByteArrayInputStream(batch(animated, loop, image, image)));
      check(count == 4, "four palette import count");
      check(f.gallery.list().length() == before + 4, "every package has a separate gallery entry");
      check(
          f.prefs.getAll().equals(prefs),
          "batch preserves active, playback and shuffle preferences on both screens");
      Map<String, Integer> names = new HashMap<>();
      JSONArray list = f.gallery.list();
      for (int i = 0; i < list.length(); i++) {
        JSONObject row = list.getJSONObject(i);
        if (!row.getString("name").endsWith("sky")) continue;
        names.merge(row.getString("name"), 1, Integer::sum);
        JSONObject manifest =
            new JSONObject(
                new String(
                    Files.readAllBytes(
                        new File(f.folder(row.getString("id")), "wallpaper.json").toPath()),
                    StandardCharsets.UTF_8));
        check(
            manifest.getJSONObject("editor").getString("kind").equals("static"),
            "editable metadata retained byte-for-byte");
        check(manifest.getString("screen").equals(screen), "screen scope retained");
      }
      check(
          names.get("Warm sky") == 1 && names.get("Cool sky") == 1 && names.get("Dark sky") == 2,
          "names and duplicate artwork kept independently");
      check(
          f.files.importZip(new ByteArrayInputStream(batch(loop))) == 1,
          "one-package batch supported");
      check(f.prefs.getAll().equals(prefs), "one-package batch is also selection-neutral");
      unchanged(
          f,
          batch(image, packageZip(screen, "static", "Broken image", true)),
          "later invalid image after first publish");
      unchanged(
          f,
          batch(image, packageZip(screen, "animated", "Broken video", true)),
          "later invalid video after first publish");
      unchanged(f, batch(image, new byte[] {1, 2, 3}), "invalid nested ZIP");
      unchanged(f, batch(image, batch(loop)), "recursive archive");
      unchanged(f, batch(image, image, image, image, image), "five packages");
      byte[] duplicate =
          new String(batch(image, loop), StandardCharsets.ISO_8859_1)
              .replace("02-palette.zip", "01-palette.zip")
              .getBytes(StandardCharsets.ISO_8859_1);
      unchanged(f, duplicate, "duplicate outer names");
      unchanged(
          f,
          batch(image, StaticWallpaperTest.zip(Map.of("../inner-poster.png", new byte[] {1}))),
          "nested path traversal");
      unchanged(f, StaticWallpaperTest.zip(Map.of("../unsafe.zip", image)), "outer path traversal");
      unchanged(
          f,
          StaticWallpaperTest.zip(
              Map.of("01-palette.zip", image, "wallpaper.json", new byte[] {1})),
          "mixed batch and flat files");
      unchanged(
          f,
          StaticWallpaperTest.zip(Map.of("inner-poster.png", new byte[] {1})),
          "missing manifest");
      unchanged(f, StaticWallpaperTest.zip(Map.of()), "empty archive");
      byte[] oversized = new byte[PackPolicy.MAX_JSON_BYTES + 1];
      unchanged(
          f,
          batch(image, StaticWallpaperTest.zip(Map.of("wallpaper.json", oversized))),
          "oversized expanded metadata");
      // Stored outer entries reproduce the browser writer and exercise the outer CRC.
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      try (ZipOutputStream zip = new ZipOutputStream(output)) {
        ZipEntry entry = new ZipEntry("01-palette.zip");
        CRC32 crc = new CRC32();
        crc.update(image);
        entry.setMethod(ZipEntry.STORED);
        entry.setSize(image.length);
        entry.setCompressedSize(image.length);
        entry.setCrc(crc.getValue());
        zip.putNextEntry(entry);
        zip.write(image);
        zip.closeEntry();
      }
      check(
          f.files.importZip(new ByteArrayInputStream(output.toByteArray())) == 1,
          "browser-style stored batch imports");
      byte[] corrupt = output.toByteArray();
      corrupt[14] ^= 1;
      unchanged(f, corrupt, "outer CRC mismatch");
      Set<String> folders = new HashSet<>(Arrays.asList(f.files.root().list()));
      try {
        f.files.importZip(
            new ByteArrayInputStream(batch(image, loop)) {
              @Override
              public void close() throws IOException {
                throw new IOException("Provider close failed");
              }
            });
        throw new AssertionError("Provider close must fail import");
      } catch (IOException expected) {
        check(expected.getMessage().contains("Provider close"), "provider error preserved");
      }
      check(f.prefs.getAll().equals(prefs), "provider close failure preserves all preferences");
      check(
          new HashSet<>(Arrays.asList(f.files.root().list())).equals(folders),
          "provider close failure publishes nothing and cleans staging");
      check(f.files.importZip(new ByteArrayInputStream(image)) == 1, "flat import still supported");
      check(
          !WallpaperFiles.activeId(f.prefs, screen).equals(selected),
          "flat import still selects new wallpaper");
      check(
          !f.prefs.getBoolean("shuffle_" + screen, true),
          "flat import retains existing shuffle behavior");
    }
    System.out.println(
        "PASS " + checks + " batch-import/storage assertions with explicit host media fixtures.");
  }
}
