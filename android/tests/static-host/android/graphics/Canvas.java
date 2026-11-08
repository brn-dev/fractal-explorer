package android.graphics;

import java.awt.image.BufferedImage;

public class Canvas {
  final BufferedImage image;

  public Canvas(BufferedImage image) {
    this.image = image;
  }

  public void drawColor(int color, PorterDuff.Mode mode) {
    java.awt.Graphics2D g = image.createGraphics();
    g.setComposite(java.awt.AlphaComposite.DstOver);
    g.setColor(new java.awt.Color(color, true));
    g.fillRect(0, 0, image.getWidth(), image.getHeight());
    g.dispose();
  }
}
