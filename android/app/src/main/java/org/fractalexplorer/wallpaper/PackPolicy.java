package org.fractalexplorer.wallpaper;

import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class PackPolicy {
  static final int MAX_JSON_BYTES = 4 * 1024 * 1024;
  static final long MAX_VIDEO_BYTES = 1024L * 1024 * 1024;
  static final long MAX_POSTER_BYTES = 64L * 1024 * 1024;
  static final long MAX_PACKAGE_BYTES = 3L * 1024 * 1024 * 1024;
  static final String[] KEYS = {
    "closed-transition", "closed-steady", "open-transition", "open-steady"
  };
  static final String[] VIDEOS = {
    "cover-arrival.mp4", "cover-idle.mp4", "inner-arrival.mp4", "inner-idle.mp4"
  };
  static final Set<String> FILES =
      new HashSet<>(
          Arrays.asList(
              "wallpaper.json",
              "cover-arrival.mp4",
              "cover-idle.mp4",
              "inner-arrival.mp4",
              "inner-idle.mp4",
              "cover-poster.png",
              "inner-poster.png"));

  static String filename(String slot) {
    for (int i = 0; i < KEYS.length; i++) if (KEYS[i].equals(slot)) return VIDEOS[i];
    throw new IllegalArgumentException("Unknown wallpaper state");
  }

  static String[] screens(String screen) {
    if (screen == null || screen.isEmpty()) return new String[] {"cover", "inner"};
    if ("cover".equals(screen) || "inner".equals(screen)) return new String[] {screen};
    throw new IllegalArgumentException("Choose cover or main screen");
  }

  static Set<String> files(String screen) {
    return files(screen, "animated");
  }

  static boolean isStatic(String kind) {
    if ("static".equals(kind)) return true;
    if ("animated".equals(kind)) return false;
    throw new IllegalArgumentException("Unknown wallpaper type");
  }

  static Set<String> files(String screen, String kind) {
    boolean image = isStatic(kind);
    Set<String> result = new HashSet<>();
    result.add("wallpaper.json");
    for (String target : screens(screen)) {
      if (!image) {
        result.add(target + "-arrival.mp4");
        result.add(target + "-idle.mp4");
      }
      result.add(target + "-poster.png");
    }
    return result;
  }

  static boolean supports(String scope, String screen) {
    screens(screen);
    return Arrays.asList(screens(scope)).contains(screen);
  }

  static File child(File folder, String name) throws IOException {
    if (!FILES.contains(name)) throw new IOException("Unexpected wallpaper file: " + name);
    File result = new File(folder, name).getCanonicalFile();
    if (!folder.getCanonicalFile().equals(result.getParentFile()))
      throw new IOException("Invalid wallpaper path");
    return result;
  }

  static boolean validId(String id) {
    return id != null && id.matches("[a-f0-9]{32}");
  }

  static File folder(File root, String id) throws IOException {
    if (!validId(id)) throw new IOException("Invalid wallpaper ID");
    File folder = new File(root, id).getCanonicalFile();
    if (!root.getCanonicalFile().equals(folder.getParentFile()))
      throw new IOException("Invalid wallpaper storage path");
    return folder;
  }
}
