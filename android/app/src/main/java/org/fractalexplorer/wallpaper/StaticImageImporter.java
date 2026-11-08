package org.fractalexplorer.wallpaper;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.ColorSpace;
import android.graphics.ImageDecoder;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import org.json.JSONObject;

/** Normalize an explicitly selected image into an opaque, image-only gallery entry. */
final class StaticImageImporter {
  static String importImage(Context context, InputStream source, String screen, String name)
      throws Exception {
    WallpaperFiles files = null;
    File input = null;
    File folder = null;
    Bitmap decoded = null, image = null;
    boolean complete = false;
    try {
      try (InputStream owned = source) {
        if (!"cover".equals(screen) && !"inner".equals(screen))
          throw new IOException("Choose cover or main screen");
        if (owned == null) throw new IOException("Cannot read this image");
        files = new WallpaperFiles(context);
        File cache = new File(context.getCacheDir(), "clip-imports");
        if (!cache.isDirectory() && !cache.mkdirs())
          throw new IOException("Cannot create image import storage");
        input = new File(cache, WallpaperFiles.newId() + ".image");
        try (FileOutputStream output = new FileOutputStream(input)) {
          byte[] buffer = new byte[65536];
          long size = 0;
          int count;
          while ((count = owned.read(buffer)) != -1) {
            size += count;
            if (size > PackPolicy.MAX_POSTER_BYTES)
              throw new IOException("Choose an image under 64 MiB");
            output.write(buffer, 0, count);
          }
        }
      }
      decoded =
          ImageDecoder.decodeBitmap(
              ImageDecoder.createSource(input),
              (decoder, info, data) -> {
                int width = info.getSize().getWidth(), height = info.getSize().getHeight();
                double scale = Math.min(1, 4096.0 / Math.max(width, height));
                int targetWidth = (int) Math.floor(width * scale),
                    targetHeight = (int) Math.floor(height * scale);
                if (targetWidth < 16 || targetHeight < 16)
                  throw new IllegalArgumentException(
                      "Choose an image at least 16 pixels per side with ordinary proportions");
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB));
                decoder.setTargetSize(targetWidth, targetHeight);
                decoder.setPostProcessor(
                    canvas -> {
                      canvas.drawColor(Color.BLACK, PorterDuff.Mode.DST_OVER);
                      return PixelFormat.OPAQUE;
                    });
              });
      image =
          decoded.getConfig() == Bitmap.Config.ARGB_8888
              ? decoded
              : decoded.copy(Bitmap.Config.ARGB_8888, false);
      if (image == null) throw new IOException("Cannot decode this image");
      image.setHasAlpha(false);
      folder = files.staging();
      String filename = screen + "-poster.png";
      try (FileOutputStream output = new FileOutputStream(PackPolicy.child(folder, filename))) {
        if (!image.compress(Bitmap.CompressFormat.PNG, 100, output))
          throw new IOException("Cannot save imported image");
        output.getFD().sync();
      }
      String title = name == null ? "Imported image" : name.trim();
      if (title.isEmpty()) title = "Imported image";
      JSONObject manifest =
          new JSONObject()
              .put("format", "fractal-wallpaper/v1")
              .put("version", 1)
              .put("kind", "static")
              .put("screen", screen)
              .put("name", title.substring(0, Math.min(80, title.length())))
              .put("steadyMotion", "still")
              .put("clips", new JSONObject())
              .put(
                  "images",
                  new JSONObject()
                      .put(
                          screen,
                          new JSONObject()
                              .put("file", filename)
                              .put("width", image.getWidth())
                              .put("height", image.getHeight())))
              .put("posters", new JSONObject().put(screen, filename));
      String id = files.publish(folder, manifest);
      complete = true;
      return id;
    } finally {
      if (image != null && image != decoded) image.recycle();
      if (decoded != null) decoded.recycle();
      if (input != null) input.delete();
      if (!complete && folder != null) files.deleteFolder(folder);
    }
  }
}
