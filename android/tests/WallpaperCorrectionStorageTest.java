package org.fractalexplorer.wallpaper;

import java.io.File;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONObject;

public final class WallpaperCorrectionStorageTest {
  static int checks;

  static void check(boolean value, String why) {
    checks++;
    if (!value) throw new AssertionError(why);
  }

  public static void main(String[] args) throws Exception {
    WallpaperColorGrade grade =
        WallpaperColorGrade.parse("{\"tone\":{\"points\":[[0,0.1],[0.5,0.3],[1,1]]}}");
    for (String screen : new String[] {"cover", "inner"}) {
      String other = screen.equals("cover") ? "inner" : "cover";
      StaticWallpaperTest.Fixture f =
          new StaticWallpaperTest.Fixture(new File(args[0], "corrections-" + UUID.randomUUID()));
      String id = f.animation(screen), otherId = f.animation(other);
      Map<String, ?> before = new HashMap<>(f.prefs.getAll());
      File poster = new File(f.folder(id), screen + "-poster.png");
      byte[] original = Files.readAllBytes(poster.toPath());
      f.gallery.setGrade(id, screen, grade);
      check(f.gallery.grade(id, screen).key.equals(grade.key), "Saved correction round trip");
      check(
          f.gallery.previewSource(id, screen).grade.key.equals(grade.key),
          "Full preview uses saved correction");
      check(!f.gallery.grade(otherId, other).active, "Other screen entry remains uncorrected");
      for (Map.Entry<String, ?> entry : before.entrySet())
        check(
            entry.getValue().equals(f.prefs.getAll().get(entry.getKey())),
            "Correction changed playback/shuffle/selection: " + entry.getKey());
      check(
          java.util.Arrays.equals(original, Files.readAllBytes(poster.toPath())),
          "Original image bytes are immutable");
      JSONObject source = f.gallery.correctionSource(id, screen);
      check(
          source.getJSONObject("curves").toString().equals(grade.key),
          "Editor starts with saved grade");
      f.prefs.fail = true;
      try {
        f.gallery.setGrade(id, screen, WallpaperColorGrade.IDENTITY);
        throw new AssertionError("Failed commit was accepted");
      } catch (java.io.IOException expected) {
        checks++;
      }
      check(f.gallery.grade(id, screen).key.equals(grade.key), "Failed write rolls back grade");
      File staged = f.files.staging();
      JSONObject manifest = f.gallery.copyForCorrection(id, screen, staged);
      check(!manifest.has("editor"), "Media copy never claims an editable fractal");
      before = new HashMap<>(f.prefs.getAll());
      String copy = f.files.retain(staged, manifest);
      check(
          before.equals(f.prefs.getAll()), "Retaining a copy does not select it or change shuffle");
      check(!f.gallery.grade(copy, screen).active, "New copy does not inherit a live grade twice");
      check(
          java.util.Arrays.equals(
              original,
              Files.readAllBytes(new File(f.folder(copy), screen + "-poster.png").toPath())),
          "Snapshot copied exact media");
      try {
        f.gallery.setGrade(id, other, grade);
        throw new AssertionError("Wrong screen accepted");
      } catch (java.io.IOException expected) {
        checks++;
      }
      f.animation(screen);
      f.gallery.delete(id);
      check(
          !f.prefs.contains(WallpaperGallery.gradeKey(screen, id)),
          "Deleting removes correction preferences");
    }
    System.out.println(
        "PASS "
            + checks
            + " correction persistence, screen isolation, rollback, immutable media and"
            + " unselected-copy checks.");
  }
}
