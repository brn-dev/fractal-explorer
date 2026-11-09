package org.fractalexplorer.wallpaper;

import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;
import org.json.*;

/** Production publication/import/selection with explicit platform metadata and ImageIO fixtures. */
public final class LoopWallpaperTest {
  private static int checks;

  static void check(boolean value, String why) {
    checks++;
    if (!value) throw new AssertionError(why);
  }

  static JSONObject manifest(String screen) throws Exception {
    String key = screen.equals("cover") ? "closed-steady" : "open-steady";
    return new JSONObject()
        .put("format", "fractal-wallpaper/v1")
        .put("version", 1)
        .put("kind", "loop")
        .put("name", "Just a loop")
        .put("screen", screen)
        .put("steadyMotion", "animated")
        .put("editor", new JSONObject().put("entryTransition", false))
        .put(
            "clips",
            new JSONObject()
                .put(
                    key,
                    new JSONObject()
                        .put("file", screen + "-idle.mp4")
                        .put("width", 160)
                        .put("height", 160)
                        .put("duration", 1)));
  }

  static String publish(StaticWallpaperTest.Fixture f, String screen) throws Exception {
    File folder = f.files.staging();
    Files.write(new File(folder, screen + "-idle.mp4").toPath(), new byte[] {1, 2, 3});
    Files.write(
        new File(folder, screen + "-poster.png").toPath(),
        StaticWallpaperTest.png(160, 160, false));
    return f.files.publish(folder, manifest(screen));
  }

  static byte[] zip(StaticWallpaperTest.Fixture f, String id, boolean extra) throws Exception {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
      for (File file : f.folder(id).listFiles()) {
        zip.putNextEntry(new ZipEntry(file.getName()));
        zip.write(Files.readAllBytes(file.toPath()));
        zip.closeEntry();
      }
      if (extra) {
        zip.putNextEntry(new ZipEntry("inner-arrival.mp4"));
        zip.write(new byte[] {1, 2, 3});
        zip.closeEntry();
      }
    }
    return bytes.toByteArray();
  }

  public static void main(String[] args) throws Exception {
    for (String screen : new String[] {"cover", "inner"}) {
      StaticWallpaperTest.Fixture f =
          new StaticWallpaperTest.Fixture(
              new File(args[0], "loops-" + screen + "-" + UUID.randomUUID()));
      String other = screen.equals("cover") ? "inner" : "cover",
          full = f.animation(screen),
          otherId = f.animation(other);
      f.prefs
          .edit()
          .putBoolean(screen + "_arrival", true)
          .putBoolean(screen + "_idle", true)
          .commit();
      String loop = publish(f, screen);
      check(!WallpaperFiles.hasEntry(f.prefs, screen), "loop advertises no entry");
      check(WallpaperFiles.hasEntry(f.prefs, other), "other screen keeps its entry");
      check(!WallpaperFiles.isStatic(f.prefs, screen), "loop stays animated");
      check(
          WallpaperFiles.playback(f.prefs, screen, "arrival"),
          "screen entry preference is preserved for other designs");
      check(WallpaperFiles.activeId(f.prefs, other).equals(otherId), "other selection unchanged");
      check(
          f.folder(loop).listFiles().length == 3
              && !new File(f.folder(loop), screen + "-arrival.mp4").exists(),
          "no entry media saved");
      JSONObject listed = null;
      for (int i = 0; i < f.gallery.list().length(); i++) {
        JSONObject row = f.gallery.list().getJSONObject(i);
        if (row.getString("id").equals(loop)) listed = row;
      }
      check(listed != null && listed.getString("kind").equals("loop"), "loop is listed in gallery");
      check(
          !f.gallery.draft(loop).getBoolean("entryTransition"),
          "edit/duplicate retains entry choice");
      f.gallery.apply(full, screen);
      check(
          WallpaperFiles.hasEntry(f.prefs, screen),
          "transition design restores entry availability");
      f.gallery.apply(loop, screen);
      check(!WallpaperFiles.hasEntry(f.prefs, screen), "selection restores loop-only behavior");
      f.prefs.fail = true;
      boolean failed = false;
      try {
        f.gallery.apply(full, screen);
      } catch (IOException expected) {
        failed = true;
      }
      check(
          failed
              && !WallpaperFiles.hasEntry(f.prefs, screen)
              && WallpaperFiles.activeId(f.prefs, screen).equals(loop),
          "failed selection rolls back capability and ID together");
      f.gallery.setShuffle(screen, new JSONArray().put(full).put(loop), true);
      for (int i = 1; i <= 4; i++) {
        String selected = f.gallery.chooseForArrival(screen, i, 3000L * i);
        check(
            WallpaperFiles.hasEntry(f.prefs, screen) == selected.equals(full),
            "shuffle follows each design entry capability");
        check(
            WallpaperFiles.playback(f.prefs, screen, "arrival"),
            "shuffle preserves global entry choice");
      }
      byte[] packageBytes = zip(f, loop, false);
      f.files.importZip(new ByteArrayInputStream(packageBytes));
      check(!WallpaperFiles.hasEntry(f.prefs, screen), "ZIP import starts without entry");
      String imported = WallpaperFiles.activeId(f.prefs, screen);
      check(f.folder(imported).listFiles().length == 3, "ZIP import retains just one clip");
      String before = WallpaperFiles.activeId(f.prefs, screen);
      failed = false;
      try {
        f.files.importZip(new ByteArrayInputStream(zip(f, loop, true)));
      } catch (IOException expected) {
        failed = true;
      }
      check(
          failed && WallpaperFiles.activeId(f.prefs, screen).equals(before),
          "loop package with extra entry video rejected without replacing selection");
      File replacement = new File(f.context.getCacheDir(), "replacement.mp4"),
          poster = new File(f.context.getCacheDir(), "replacement.png");
      replacement.getParentFile().mkdirs();
      Files.write(replacement.toPath(), new byte[] {7, 8});
      Files.write(poster.toPath(), StaticWallpaperTest.png(160, 160, false));
      f.files.replaceVideo(screen + "-idle", replacement, poster);
      check(
          !WallpaperFiles.hasEntry(f.prefs, screen),
          "replacing loop does not resurrect a sample entry");
      f.files.replaceVideo(screen + "-arrival", replacement, poster);
      check(WallpaperFiles.hasEntry(f.prefs, screen), "explicit arrival import adds a transition");
      check(
          f.folder(WallpaperFiles.activeId(f.prefs, screen)).listFiles().length == 4,
          "entry import publishes a complete pair");
    }
    System.out.println(
        "PASS "
            + checks
            + " loop-only import/gallery/shuffle/rollback assertions; explicit platform fixtures.");
  }
}
