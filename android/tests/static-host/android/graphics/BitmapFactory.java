package android.graphics;

import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class BitmapFactory {
  public static class Options {
    public boolean inJustDecodeBounds;
    public int outWidth, outHeight, inSampleSize;
  }

  public static Bitmap decodeFile(String path, Options options) {
    try {
      BufferedImage image = ImageIO.read(new File(path));
      if (image == null) throw new java.io.IOException();
      options.outWidth = image.getWidth();
      options.outHeight = image.getHeight();
      return options.inJustDecodeBounds ? null : new Bitmap(image);
    } catch (java.io.IOException e) {
      options.outWidth = options.outHeight = -1;
      return null;
    }
  }
}
