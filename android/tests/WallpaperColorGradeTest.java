package org.fractalexplorer.wallpaper;

import java.io.File;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;

public final class WallpaperColorGradeTest {
  private static int checks;

  static void check(boolean v, String why) {
    checks++;
    if (!v) throw new AssertionError(why);
  }

  static void fails(String json) throws Exception {
    try {
      WallpaperColorGrade.parse(json);
      throw new AssertionError("Accepted invalid grade");
    } catch (org.json.JSONException | java.io.IOException expected) {
      checks++;
    }
  }

  public static void main(String[] args) throws Exception {
    JSONArray fixtures =
        new JSONArray(
            new String(
                Files.readAllBytes(new File(args[0]).toPath()),
                java.nio.charset.StandardCharsets.UTF_8));
    for (int f = 0; f < fixtures.length(); f++) {
      JSONObject row = fixtures.getJSONObject(f);
      WallpaperColorGrade grade = new WallpaperColorGrade(row.getJSONObject("curves"));
      byte[] lut = grade.lut();
      JSONArray expectedLut = row.getJSONArray("lut"),
          source = row.getJSONArray("source"),
          expected = row.getJSONArray("expected");
      for (int i = 0; i < lut.length; i++)
        check(
            (lut[i] & 255) == expectedLut.getInt(i),
            "LUT differs from web curve at " + f + "/" + i);
      for (int i = 0; i < source.length(); i += 4) {
        int argb =
            (source.getInt(i + 3) << 24)
                | (source.getInt(i) << 16)
                | (source.getInt(i + 1) << 8)
                | source.getInt(i + 2);
        int actual = grade.color(argb);
        for (int c = 0; c < 4; c++)
          check(
              ((actual >> (c == 3 ? 24 : (2 - c) * 8)) & 255) == expected.getInt(i + c),
              "Native/web pixel mismatch " + f + "/" + i + "/" + c);
      }
      check(
          new WallpaperColorGrade(new JSONObject(grade.key)).key.equals(grade.key),
          "Canonical persistence round trip");
    }
    for (String bad :
        new String[] {
          "null",
          "[]",
          "{\"wrong\":{}}",
          "{\"tone\":null}",
          "{\"red\":{\"points\":[[0,0],[1,2]]}}",
          "{\"tone\":{\"points\":[[0,0],[0.5,1],[0.5,0],[1,1]]}}",
          "{\"tone\":{\"points\":[[0,0],[1,1]],\"bends\":[2]}}"
        }) fails(bad);
    check(!WallpaperColorGrade.IDENTITY.active, "No default cost");
    System.out.println(
        "PASS "
            + checks
            + " native/web LUT, decoded RGB, alpha, interpolation and validation checks.");
  }
}
