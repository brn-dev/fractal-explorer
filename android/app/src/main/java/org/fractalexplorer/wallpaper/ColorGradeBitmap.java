package org.fractalexplorer.wallpaper;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

final class ColorGradeBitmap {
  static void apply(Bitmap bitmap, WallpaperColorGrade grade) {
    apply(bitmap, grade, () -> {});
  }

  static void apply(Bitmap bitmap, WallpaperColorGrade grade, Runnable check) {
    if (!grade.active) return;
    int width = bitmap.getWidth();
    int[] row = new int[width];
    for (int y = 0; y < bitmap.getHeight(); y++) {
      if (y % 32 == 0) check.run();
      bitmap.getPixels(row, 0, width, 0, y, width, 1);
      for (int x = 0; x < width; x++) row[x] = grade.color(row[x]);
      bitmap.setPixels(row, 0, width, 0, y, width, 1);
    }
  }

  static void bake(File input, File output, WallpaperColorGrade grade) throws Exception {
    bake(input, output, grade, () -> {});
  }

  static void bake(File input, File output, WallpaperColorGrade grade, Runnable check)
      throws Exception {
    BitmapFactory.Options options = new BitmapFactory.Options();
    options.inMutable = true;
    options.inPreferredConfig = Bitmap.Config.ARGB_8888;
    Bitmap bitmap = BitmapFactory.decodeFile(input.getAbsolutePath(), options);
    if (bitmap == null) throw new IOException("Cannot decode wallpaper image");
    try (FileOutputStream stream = new FileOutputStream(output)) {
      apply(bitmap, grade, check);
      check.run();
      if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream))
        throw new IOException("Cannot save corrected image");
    } finally {
      bitmap.recycle();
    }
  }
}
