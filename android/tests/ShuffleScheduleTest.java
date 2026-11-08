package org.fractalexplorer.wallpaper;

import java.io.File;
import java.time.*;
import org.json.*;

/** Production preferences/storage/scheduling through the explicit static-host platform fixtures. */
public final class ShuffleScheduleTest {
  static int checks;

  static void check(boolean good, String why) {
    checks++;
    if (!good) throw new AssertionError(why);
  }

  static JSONObject rule(double weight, String period) throws Exception {
    return new JSONObject().put("weight", weight).put("period", period);
  }

  public static void main(String[] args) throws Exception {
    long day = ViennaSunTest.local("2026-06-21", "12:00"),
        night = ViennaSunTest.local("2026-06-21", "23:00");
    for (String screen : new String[] {"cover", "inner"}) {
      StaticWallpaperTest.Fixture f =
          new StaticWallpaperTest.Fixture(
              new File(args[0], "rules-" + screen + "-" + java.util.UUID.randomUUID()));
      String a = f.image(screen),
          b = f.animation(screen),
          other = screen.equals("inner") ? "cover" : "inner";
      f.gallery.setShuffle(screen, new JSONArray().put(a).put(b), true);
      check(
          f.gallery.shuffle().getJSONObject(screen).getJSONObject("rules").length() == 0,
          "old selections default to weight1/any");
      f.gallery.setShuffleRule(screen, a, rule(2, "day"));
      f.gallery.setShuffleRule(screen, b, rule(1, "night"));
      check(
          f.gallery.shuffle().getJSONObject(other).getJSONObject("rules").length() == 0,
          "rules separate per screen");
      check(
          new WallpaperGallery(f.context)
                  .shuffle()
                  .getJSONObject(screen)
                  .getJSONObject("rules")
                  .getJSONObject(a)
                  .getDouble("weight")
              == 2,
          "rules persist on reopen");
      check(
          !f.gallery
              .selectionContext(screen, day)
              .equals(f.gallery.selectionContext(screen, night)),
          "schedule phase invalidates coalescing context");
      for (int i = 1; i <= 10; i++)
        check(
            f.gallery.chooseForArrival(screen, i, i * 100, day).equals(a),
            "only daytime image can be selected");
      check(
          f.gallery.chooseForArrival(screen, 10, 1001, night).equals(b),
          "sunset overrides recent daytime choice for same event");
      check(!WallpaperFiles.isStatic(f.prefs, screen), "night can choose animation");
      check(
          f.gallery.chooseForArrival(screen, 10, 1002, night).equals(b),
          "same night reveal coalesces");
      check(
          f.gallery.nextScheduleChange(screen, day) == ViennaSun.at(day).sunset,
          "visible schedule wakeup uses sunset");
      f.gallery.setShuffleRule(screen, b, rule(1, "day"));
      SettingsActivity.pending = true;
      String pendingContext = f.gallery.selectionContext(screen, night);
      check(
          f.gallery.chooseForArrival(screen, 11, 1099, night) == null,
          "an import cannot leave an ineligible active entry visible");
      SettingsActivity.pending = false;
      check(
          !pendingContext.equals(f.gallery.selectionContext(screen, night)),
          "returning after an import retries even during a short visibility handoff");
      check(
          f.gallery.chooseForArrival(screen, 11, 1100, night) == null,
          "empty time window has no out-of-filter fallback");
      check(
          WallpaperFiles.activeId(f.prefs, screen).equals(b),
          "blank fallback keeps saved active ID intact");
      String before = f.prefs.getString("shuffle_" + screen + "_rules", "");
      f.prefs.fail = true;
      StaticWallpaperTest.fails(
          () -> f.gallery.setShuffleRule(screen, a, rule(8, "night")), "failed rule save rejected");
      check(
          f.prefs.getString("shuffle_" + screen + "_rules", "").equals(before),
          "failed settings commit rolls back rules");
      StaticWallpaperTest.fails(
          () -> f.gallery.setShuffleRule(screen, a, rule(0, "day")), "zero weight rejected");
      StaticWallpaperTest.fails(
          () -> f.gallery.setShuffleRule(screen, a, rule(1, "invalid")), "invalid filter rejected");
      StaticWallpaperTest.fails(
          () -> f.gallery.setShuffleRule(other, a, rule(1, "any")), "wrong screen rejected");
      f.gallery.setShuffle(screen, new JSONArray().put(b), false);
      check(
          f.gallery.nextScheduleChange(screen, night) == Long.MAX_VALUE,
          "disabled shuffle has no scheduled work");
      f.gallery.setShuffle(screen, new JSONArray().put(a).put(b), true);
      check(
          f.gallery
                  .shuffle()
                  .getJSONObject(screen)
                  .getJSONObject("rules")
                  .getJSONObject(a)
                  .getDouble("weight")
              == 2,
          "membership changes retain rules");
      f.gallery.setShuffle(screen, new JSONArray().put(b), false);
      f.gallery.apply(b, screen);
      f.gallery.delete(a);
      check(
          !f.gallery.shuffle().getJSONObject(screen).getJSONObject("rules").has(a),
          "deleting an entry cleans its rules");
    }
    System.out.println(
        "PASS "
            + checks
            + " production weighted/scheduled gallery storage assertions; explicit host fixtures.");
  }
}
