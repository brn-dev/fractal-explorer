package android.graphics;

public class ColorSpace {
  public enum Named {
    SRGB
  }

  public static ColorSpace get(Named name) {
    return new ColorSpace();
  }
}
