package android.graphics;

import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;

public class Bitmap {
  public enum CompressFormat {
    PNG
  }

  public enum Config {
    ARGB_8888,
    RGBA_F16
  }

  final BufferedImage pixels;
  final Config config;
  public boolean recycled;

  public Bitmap(BufferedImage image) {
    this(image, Config.ARGB_8888);
  }

  public Bitmap(BufferedImage image, Config config) {
    pixels = image;
    this.config = config;
  }

  public Config getConfig() {
    return config;
  }

  public int getWidth() {
    return pixels.getWidth();
  }

  public int getHeight() {
    return pixels.getHeight();
  }

  public Bitmap copy(Config config, boolean mutable) {
    BufferedImage out = new BufferedImage(getWidth(), getHeight(), BufferedImage.TYPE_INT_ARGB);
    java.awt.Graphics2D g = out.createGraphics();
    g.drawImage(pixels, 0, 0, null);
    g.dispose();
    return new Bitmap(out, config);
  }

  public void setHasAlpha(boolean value) {}

  public boolean compress(CompressFormat f, int q, java.io.OutputStream out) {
    try {
      return ImageIO.write(pixels, "png", out);
    } catch (java.io.IOException e) {
      return false;
    }
  }

  public void recycle() {
    recycled = true;
  }
}
