package org.fractalexplorer.wallpaper;

import java.io.File;
import java.io.IOException;

/** Read-only media and playback choices for one gallery entry, independent of active selections. */
final class WallpaperPreviewSource {
  final File folder;
  final String screen;
  final boolean image, hasEntry, idle;
  final int width, height;

  WallpaperPreviewSource(
      File folder,
      String screen,
      boolean image,
      boolean hasEntry,
      boolean idle,
      int width,
      int height)
      throws IOException {
    if (!"cover".equals(screen) && !"inner".equals(screen))
      throw new IOException("Choose cover or main screen");
    if (width < 1 || height < 1) throw new IOException("Invalid wallpaper dimensions");
    this.folder = folder.getCanonicalFile();
    this.screen = screen;
    this.image = image;
    this.hasEntry = !image && hasEntry;
    this.idle = !image && idle;
    this.width = width;
    this.height = height;
  }

  PlaybackState.Mode mode() {
    return "cover".equals(screen) ? PlaybackState.Mode.COVER : PlaybackState.Mode.INNER;
  }

  File file(String name) throws IOException {
    if (!(name.equals(screen + "-poster.png")
        || (!image && name.equals(screen + "-idle.mp4"))
        || (hasEntry && name.equals(screen + "-arrival.mp4"))))
      throw new IOException("Unexpected preview media");
    File file = new File(folder, name).getCanonicalFile();
    if (!folder.equals(file.getParentFile()) || !file.isFile() || file.length() == 0)
      throw new IOException("Saved wallpaper is missing " + name);
    return file;
  }

  int[] fit(int availableWidth, int availableHeight) {
    if (availableWidth <= 0 || availableHeight <= 0) return new int[] {0, 0};
    double scale = Math.min(availableWidth / (double) width, availableHeight / (double) height);
    return new int[] {
      Math.min(availableWidth, Math.max(1, (int) Math.round(width * scale))),
      Math.min(availableHeight, Math.max(1, (int) Math.round(height * scale)))
    };
  }
}
