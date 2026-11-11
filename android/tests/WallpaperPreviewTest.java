package org.fractalexplorer.wallpaper;

import java.io.File;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Production read-only preview selection with explicit Android/ImageIO storage fixtures. */
public final class WallpaperPreviewTest {
  static int checks;

  static void check(boolean value, String reason) {
    checks++;
    if (!value) throw new AssertionError(reason);
  }

  static void fails(StaticWallpaperTest.Work work) throws Exception {
    StaticWallpaperTest.fails(work, "preview must reject invalid media");
    checks++;
  }

  public static void main(String[] args) throws Exception {
    for (String screen : new String[] {"cover", "inner"}) {
      String other = "cover".equals(screen) ? "inner" : "cover";
      StaticWallpaperTest.Fixture f =
          new StaticWallpaperTest.Fixture(new File(args[0], "preview-" + UUID.randomUUID()));
      String animation = f.animation(screen),
          loop = LoopWallpaperTest.publish(f, screen),
          image = f.image(screen);
      f.animation(other);
      f.prefs
          .edit()
          .putBoolean(screen + "_arrival", false)
          .putBoolean("shuffle_" + screen, true)
          .putBoolean("gallery_" + screen + "_idle_" + animation, true)
          .commit();
      Map<String, ?> before = new HashMap<>(f.prefs.getAll());
      WallpaperPreviewSource full = f.gallery.previewSource(animation, screen);
      check(
          full.hasEntry && full.idle && !full.image,
          "full design plays entry then loop despite a different active image");
      check(
          full.file(screen + "-arrival.mp4").getParentFile().equals(f.folder(animation)),
          "reads requested ID, not active wallpaper");
      check(
          full.mode()
              == ("cover".equals(screen) ? PlaybackState.Mode.COVER : PlaybackState.Mode.INNER),
          "screen mode is explicit");
      PlaybackState state = new PlaybackState();
      state.update(full.mode(), true, full.idle, full.hasEntry, false, 1, 0);
      check(state.stage == PlaybackState.Stage.ARRIVAL, "preview begins at the entry");
      state.completed(state.generation);
      check(state.stage == PlaybackState.Stage.IDLE, "entry completes into steady animation");
      WallpaperPreviewSource steady = f.gallery.previewSource(loop, screen),
          still = f.gallery.previewSource(image, screen);
      check(!steady.hasEntry && steady.idle && !steady.image, "loop only does not invent an entry");
      check(still.image && !still.hasEntry && !still.idle, "static opens no video");
      fails(() -> still.file(screen + "-idle.mp4"));
      fails(() -> steady.file(screen + "-arrival.mp4"));
      fails(() -> full.file(other + "-poster.png"));
      fails(() -> full.file("../" + screen + "-poster.png"));
      fails(() -> f.gallery.previewSource(animation, other));
      fails(() -> f.gallery.previewSource("../bad", screen));
      check(
          before.equals(f.prefs.getAll()),
          "preview changes no preference, active selection, playback choice or shuffle rule");
      f.prefs.edit().putBoolean("gallery_" + screen + "_idle_" + animation, false).commit();
      WallpaperPreviewSource paused = f.gallery.previewSource(animation, screen);
      check(!paused.idle && paused.hasEntry, "saved still choice retains the entry");
      WallpaperPreviewSource fit =
          new WallpaperPreviewSource(f.folder(animation), screen, false, true, true, 1080, 2520);
      int[] size = fit.fit(2256, 2504);
      check(
          size[1] == 2504 && size[0] < 2256,
          "cover composition fits inside main screen without cropping");
      size = fit.fit(1080, 2520);
      check(size[0] == 1080 && size[1] == 2520, "native screen uses entire display");
      size = fit.fit(2504, 2256);
      check(size[0] <= 2504 && size[1] <= 2256, "rotation stays within display");
      check(fit.fit(0, 0)[0] == 0, "unmeasured display waits for layout");
      File poster = paused.file(screen + "-poster.png");
      Files.write(poster.toPath(), new byte[] {1});
      fails(() -> f.gallery.previewSource(animation, screen));
      Files.delete(poster.toPath());
      fails(() -> paused.file(screen + "-poster.png"));
    }
    System.out.println(
        "PASS "
            + checks
            + " read-only preview, screen, media and fit assertions; explicit platform fixtures.");
  }
}
