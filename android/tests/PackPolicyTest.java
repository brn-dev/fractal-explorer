package org.fractalexplorer.wallpaper;

import java.io.File;

public final class PackPolicyTest {
  private static void require(boolean value) {
    if (!value) throw new AssertionError();
  }

  public static void main(String[] args) throws Exception {
    require(PackPolicy.filename("closed-transition").equals("cover-arrival.mp4"));
    require(PackPolicy.filename("open-steady").equals("inner-idle.mp4"));
    require(PackPolicy.FILES.size() == 7);
    require(PackPolicy.files("cover").size() == 4);
    require(PackPolicy.files("inner").size() == 4);
    require(PackPolicy.files("").equals(PackPolicy.FILES));
    require(
        PackPolicy.files("cover", "static")
            .equals(
                new java.util.HashSet<>(
                    java.util.Arrays.asList("wallpaper.json", "cover-poster.png"))));
    require(PackPolicy.files("inner", "static").size() == 2);
    require(PackPolicy.files("", "static").size() == 3);
    require(PackPolicy.files("inner", "animated").equals(PackPolicy.files("inner")));
    require(
        PackPolicy.files("cover", "loop")
            .equals(
                new java.util.HashSet<>(
                    java.util.Arrays.asList(
                        "wallpaper.json", "cover-idle.mp4", "cover-poster.png"))));
    require(PackPolicy.files("", "loop").size() == 5);
    require(!PackPolicy.isStatic("loop") && !PackPolicy.hasEntry("loop"));
    require(PackPolicy.hasEntry("animated") && !PackPolicy.hasEntry("static"));
    boolean badKind = false;
    try {
      PackPolicy.files("inner", "unknown");
    } catch (IllegalArgumentException expected) {
      badKind = true;
    }
    require(badKind);
    require(PackPolicy.files("cover").contains("cover-poster.png"));
    require(!PackPolicy.files("cover").contains("inner-idle.mp4"));
    require(PackPolicy.supports("", "cover") && PackPolicy.supports("", "inner"));
    require(!PackPolicy.supports("cover", "inner"));
    boolean badScreen = false;
    try {
      PackPolicy.files("both");
    } catch (IllegalArgumentException expected) {
      badScreen = true;
    }
    require(badScreen);
    File root = new File(args.length == 0 ? "." : args[0]);
    require(
        PackPolicy.child(root, "wallpaper.json").getParentFile().equals(root.getCanonicalFile()));
    for (String path :
        new String[] {"../wallpaper.json", "cover/idle.mp4", "C:\\other.mp4", "unknown.mp4"}) {
      boolean rejected = false;
      try {
        PackPolicy.child(root, path);
      } catch (Exception expected) {
        rejected = true;
      }
      require(rejected);
    }
    require(PackPolicy.validId("0123456789abcdef0123456789abcdef"));
    require(
        PackPolicy.folder(root, "0123456789abcdef0123456789abcdef")
            .getParentFile()
            .equals(root.getCanonicalFile()));
    for (String id :
        new String[] {"../active", "", "pending-0123456789abcdef0123456789abcdef", null}) {
      boolean rejected = false;
      try {
        PackPolicy.folder(root, id);
      } catch (java.io.IOException expected) {
        rejected = true;
      }
      require(rejected);
    }
    require(!PackPolicy.validId("../active"));
    require(!PackPolicy.validId(""));
    System.out.println(
        "Wallpaper package filenames, state mapping, and storage path checks passed.");
  }
}
