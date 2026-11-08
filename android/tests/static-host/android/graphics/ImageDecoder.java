package android.graphics;

import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/** Java ImageIO stand-in, not Android codec/EXIF/color-management execution. */
public class ImageDecoder {
  public static final int ALLOCATOR_SOFTWARE = 1;
  public static int decodes;
  public static ImageDecoder last;

  public interface OnHeaderDecodedListener {
    void onHeaderDecoded(ImageDecoder d, ImageInfo i, Source s);
  }

  public interface PostProcessor {
    int onPostProcess(Canvas canvas);
  }

  public static class Source {
    final File file;

    Source(File f) {
      file = f;
    }
  }

  public static class Size {
    final int w, h;

    Size(int w, int h) {
      this.w = w;
      this.h = h;
    }

    public int getWidth() {
      return w;
    }

    public int getHeight() {
      return h;
    }
  }

  public static class ImageInfo {
    final Size size;

    ImageInfo(int w, int h) {
      size = new Size(w, h);
    }

    public Size getSize() {
      return size;
    }
  }

  int width, height, allocator;
  ColorSpace space;
  PostProcessor post;

  public static Source createSource(File file) {
    return new Source(file);
  }

  public static Bitmap decodeBitmap(Source source, OnHeaderDecodedListener listener)
      throws java.io.IOException {
    decodes++;
    BufferedImage input = ImageIO.read(source.file);
    if (input == null) throw new java.io.IOException("Invalid image");
    ImageDecoder d = new ImageDecoder();
    last = d;
    d.width = input.getWidth();
    d.height = input.getHeight();
    listener.onHeaderDecoded(d, new ImageInfo(d.width, d.height), source);
    BufferedImage out = new BufferedImage(d.width, d.height, BufferedImage.TYPE_INT_ARGB);
    java.awt.Graphics2D g = out.createGraphics();
    g.drawImage(input, 0, 0, d.width, d.height, null);
    g.dispose();
    if (d.post != null) d.post.onPostProcess(new Canvas(out));
    return new Bitmap(out);
  }

  public void setAllocator(int value) {
    allocator = value;
  }

  public void setTargetColorSpace(ColorSpace value) {
    space = value;
  }

  public void setTargetSize(int w, int h) {
    width = w;
    height = h;
  }

  public void setPostProcessor(PostProcessor post) {
    this.post = post;
  }

  public static boolean normalized() {
    return last != null
        && last.allocator == ALLOCATOR_SOFTWARE
        && last.space != null
        && last.post != null;
  }
}
