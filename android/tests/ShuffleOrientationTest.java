package org.fractalexplorer.wallpaper;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/**
 * Real gallery activation/coalescing and preference rollback, using explicit host media fixtures.
 */
public final class ShuffleOrientationTest {
  private static int checks;

  private static void check(boolean value, String why) {
    checks++;
    if (!value) throw new AssertionError(why);
  }

  private static JSONObject rule(boolean enabled) throws Exception {
    return new JSONObject().put("weight", 1).put("period", "any").put("randomOrientation", enabled);
  }

  public static void main(String[] args) throws Exception {
    for (String screen : new String[] {"cover", "inner"}) {
      StaticWallpaperTest.Fixture f =
          new StaticWallpaperTest.Fixture(
              new File(args[0], "orientation-" + screen + "-" + UUID.randomUUID()));
      String a = f.image(screen), other = screen.equals("cover") ? "inner" : "cover";
      f.image(other);
      JSONObject manifest =
          new JSONObject(
              new String(
                  Files.readAllBytes(new File(f.folder(a), "wallpaper.json").toPath()),
                  StandardCharsets.UTF_8));
      byte[] media = Files.readAllBytes(new File(f.folder(a), screen + "-poster.png").toPath());
      check(WallpaperFiles.orientation(f.prefs, screen) == 0, "manual defaults to original");
      for (int value = 0; value < 4; value++) {
        long before = WallpaperFiles.revision(f.prefs, screen);
        int previous = WallpaperFiles.orientation(f.prefs, screen);
        f.files.activateLocked(a, manifest, screen, true, value);
        check(WallpaperFiles.orientation(f.prefs, screen) == value, "all four orientations stored");
        check(
            WallpaperFiles.revision(f.prefs, screen) == before + (previous == value ? 0 : 1),
            "same-ID transform revisions update only when changed");
      }
      f.gallery.apply(a, screen);
      check(
          WallpaperFiles.orientation(f.prefs, screen) == 0,
          "manual selection restores original even for same ID");
      f.gallery.setShuffle(screen, new JSONArray().put(a), true);
      f.gallery.chooseForArrival(screen, 1, 100);
      check(
          WallpaperFiles.orientation(f.prefs, screen) == 0,
          "old/unspecified shuffle rules default off");
      String beforeContext = f.gallery.selectionContext(screen, System.currentTimeMillis());
      f.gallery.setShuffleRule(screen, a, rule(true));
      check(
          !beforeContext.equals(f.gallery.selectionContext(screen, System.currentTimeMillis())),
          "rule change invalidates reveal context");
      check(
          new WallpaperGallery(f.context)
              .shuffle()
              .getJSONObject(screen)
              .getJSONObject("rules")
              .getJSONObject(a)
              .getBoolean("randomOrientation"),
          "opt-in persists per entry and screen");
      Set<Integer> orientations = new HashSet<>();
      for (int i = 0; i < 128; i++) {
        long event = 100 + i, now = 10000 + i * 3000;
        check(
            f.gallery.chooseForArrival(screen, event, now).equals(a),
            "single wallpaper remains selectable");
        int value = WallpaperFiles.orientation(f.prefs, screen);
        orientations.add(value);
        long revision = WallpaperFiles.revision(f.prefs, screen);
        check(
            new WallpaperGallery(f.context).chooseForArrival(screen, event, now + 1).equals(a),
            "lock/home share arrival ID");
        check(
            WallpaperFiles.orientation(f.prefs, screen) == value
                && WallpaperFiles.revision(f.prefs, screen) == revision,
            "lock/home never reroll orientation or restart playback");
        check(
            WallpaperFiles.orientation(f.prefs, other) == 0, "other screen orientation unchanged");
      }
      check(
          orientations.equals(Set.of(0, 1, 2, 3)),
          "fresh reveals can use all four aspect-preserving choices");
      f.gallery.setShuffleRule(screen, a, new JSONObject().put("weight", 2).put("period", "any"));
      check(
          f.gallery
              .shuffle()
              .getJSONObject(screen)
              .getJSONObject("rules")
              .getJSONObject(a)
              .getBoolean("randomOrientation"),
          "old web clients preserve orientation while editing weight/time");
      f.gallery.setShuffleRule(screen, a, rule(false));
      f.gallery.chooseForArrival(screen, 500, 500000);
      check(
          WallpaperFiles.orientation(f.prefs, screen) == 0,
          "opt-out restores original next activation");
      String b = f.animation(screen);
      f.gallery.setShuffle(screen, new JSONArray().put(a).put(b), true);
      f.gallery.setShuffleRule(screen, a, rule(true));
      for (int i = 0; i < 32; i++) {
        String chosen = f.gallery.chooseForArrival(screen, 600 + i, 600000 + i * 3000);
        if (chosen.equals(b))
          check(
              WallpaperFiles.orientation(f.prefs, screen) == 0,
              "non-opted-in design remains original in mixed pool");
      }
      Map<String, ?> preferences = f.prefs.getAll();
      f.prefs.fail = true;
      StaticWallpaperTest.fails(
          () -> f.files.activateLocked(a, manifest, screen, true, 3), "failed activation rejected");
      check(
          preferences.equals(f.prefs.getAll()),
          "failed activation rolls back ID, orientation and revision together");
      f.prefs.fail = true;
      StaticWallpaperTest.fails(
          () -> f.gallery.setShuffleRule(screen, a, rule(false)), "failed opt-out rejected");
      check(preferences.equals(f.prefs.getAll()), "failed rule write preserves opt-in");
      f.prefs.fail = false;
      StaticWallpaperTest.fails(
          () -> f.gallery.setShuffleRule(screen, a, rule(false).put("randomOrientation", "yes")),
          "non-boolean orientation rejected");
      StaticWallpaperTest.fails(
          () -> f.files.activateLocked(a, manifest, screen, true, 4),
          "axis-swapping transform rejected");
      check(
          Arrays.equals(
              media, Files.readAllBytes(new File(f.folder(a), screen + "-poster.png").toPath())),
          "media is never rewritten");
    }
    System.out.println(
        "PASS "
            + checks
            + " per-wallpaper orientation, reveal coalescing, compatibility and rollback"
            + " assertions.");
  }
}
