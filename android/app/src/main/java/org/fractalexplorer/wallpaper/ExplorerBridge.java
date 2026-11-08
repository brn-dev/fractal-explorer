package org.fractalexplorer.wallpaper;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Callable;
import org.json.JSONArray;
import org.json.JSONObject;

/** Available only to the locally served explorer; encoding stays on one EGL thread. */
final class ExplorerBridge {
  interface Host {
    void saveFile(File file, String name);

    void wallpaperPicker();

    default JSONObject webUpdates(String action, String version) throws Exception {
      throw new IOException("Web updates require a newer Android app.");
    }

    default void shareText(String text) throws Exception {
      throw new IOException("Sharing is unavailable. Use Copy PC link instead.");
    }
  }

  private final android.content.Context context;
  private final Host host;
  private final WallpaperFiles files;
  private final WallpaperGallery gallery;
  private final NativeWorkQueue worker = new NativeWorkQueue();
  private final Map<String, File> handles = new HashMap<>();
  private NativeVideoEncoder encoder;
  private String encoderId, encoderSlot;
  private File encoderFile, pack;
  private boolean webReloading;

  ExplorerBridge(android.content.Context context, Host host) {
    this.context = context.getApplicationContext();
    this.host = host;
    files = new WallpaperFiles(context);
    gallery = new WallpaperGallery(context);
  }

  private String call(Callable<JSONObject> action) {
    return call(action, false);
  }

  private String call(Callable<JSONObject> action, boolean duringReload) {
    try {
      // Await the actual outcome. A caller-side timeout could report failure while
      // a queued publication still proceeds; codec operations bound their own waits.
      return worker
          .call(
              () -> {
                if (webReloading && !duringReload)
                  throw new IOException("The explorer is reloading. Try again shortly.");
                return action.call();
              })
          .put("ok", true)
          .toString();
    } catch (Exception error) {
      Throwable cause = error.getCause() == null ? error : error.getCause();
      try {
        return new JSONObject()
            .put("ok", false)
            .put("error", cause.getMessage() == null ? cause.toString() : cause.getMessage())
            .toString();
      } catch (Exception ignored) {
        return "{\"ok\":false,\"error\":\"Android export failed\"}";
      }
    }
  }

  private static JSONObject object(String json) throws Exception {
    if (json == null || json.length() > PackPolicy.MAX_JSON_BYTES)
      throw new IOException("Export request is too large");
    return new JSONObject(json);
  }

  private static byte[] bytes(String base64, int limit) throws IOException {
    if (base64 == null || base64.length() > limit * 4L / 3 + 8)
      throw new IOException("Export frame is too large");
    byte[] data = Base64.decode(base64, Base64.DEFAULT);
    if (data.length > limit) throw new IOException("Export frame is too large");
    return data;
  }

  private File temporary(String suffix) throws IOException {
    File folder = new File(context.getCacheDir(), "exports");
    if (!folder.isDirectory() && !folder.mkdirs())
      throw new IOException("Cannot create export storage");
    return new File(folder, WallpaperFiles.newId() + suffix);
  }

  @JavascriptInterface
  public String info() {
    return "{\"ok\":true,\"version\":2,\"nativeVideo\":true,\"maxEdge\":4096,\"dynamicQuality\":true,\"staticWallpapers\":true,\"shuffleRules\":true}";
  }

  @JavascriptInterface
  public String webUpdates(String action, String version) {
    return call(
        () -> {
          if ("apply".equals(action)) {
            freezeWebReload();
            try {
              return host.webUpdates(action, version);
            } catch (Exception error) {
              webReloading = false;
              throw error;
            }
          }
          if (!"status".equals(action)
              && !"check".equals(action)
              && !"auto".equals(action)
              && !"confirm".equals(action)) throw new IOException("Invalid web update action");
          return host.webUpdates(action, version);
        },
        true);
  }

  private void freezeWebReload() throws IOException {
    if (webReloading) throw new IOException("The explorer is already reloading.");
    if (encoder != null || pack != null)
      throw new IOException("Finish or cancel the current export before updating.");
    webReloading = true;
  }

  void prepareWebReload() throws Exception {
    worker.call(
        () -> {
          freezeWebReload();
          return null;
        });
  }

  void webReloadStarted() throws Exception {
    worker.call(
        () -> {
          webReloading = false;
          return null;
        });
  }

  @JavascriptInterface
  public String wallpaperDisplays() {
    return call(() -> new JSONObject().put("screens", WallpaperDisplays.snapshot(context)));
  }

  @JavascriptInterface
  public String shareWallpaperLink(String url) {
    return call(
        () -> {
          if (url == null || url.length() > 12000) throw new IOException("Invalid wallpaper link");
          java.net.URI address = new java.net.URI(url);
          if (!"https".equals(address.getScheme())
              || address.getHost() == null
              || address.getUserInfo() != null
              || address.getRawFragment() == null
              || !address.getRawFragment().matches("w=[gj]1\\.[A-Za-z0-9_-]+"))
            throw new IOException("Invalid wallpaper link");
          host.shareText(url);
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String supportsVideo(String json) {
    return call(
        () -> {
          JSONObject p = object(json);
          NativeVideoEncoder.Selection selection;
          try {
            selection =
                NativeVideoEncoder.select(
                    p.getInt("width"),
                    p.getInt("height"),
                    p.getInt("fps"),
                    p.optInt("bitrate", 4000000),
                    p.isNull("quantizer") ? null : p.getInt("quantizer"));
          } catch (IllegalArgumentException error) {
            selection = null;
          }
          JSONObject result = new JSONObject().put("supported", selection != null);
          if (selection != null)
            result.put("qualityMode", selection.mode).put("bitrate", selection.bitrate);
          return result;
        });
  }

  @JavascriptInterface
  public String beginPack() {
    return call(
        () -> {
          cancelPackInternal();
          pack = files.staging();
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String beginVideo(String json) {
    return call(
        () -> {
          if (encoder != null) throw new IOException("Another video export is still running");
          JSONObject p = object(json);
          String slot = p.isNull("slot") ? null : p.optString("slot", null);
          File output =
              slot == null
                  ? temporary(".mp4")
                  : pack == null ? null : PackPolicy.child(pack, PackPolicy.filename(slot));
          if (output == null)
            throw new IOException("Start a wallpaper package before exporting its states");
          String id = WallpaperFiles.newId();
          try {
            encoder =
                new NativeVideoEncoder(
                    output,
                    NativeVideoEncoder.select(
                        p.getInt("width"),
                        p.getInt("height"),
                        p.getInt("fps"),
                        p.optInt("bitrate", 4000000),
                        p.isNull("quantizer") ? null : p.getInt("quantizer")));
          } catch (Exception error) {
            output.delete();
            throw error;
          }
          encoderId = id;
          encoderSlot = slot;
          encoderFile = output;
          handles.put(id, output);
          return new JSONObject()
              .put("id", id)
              .put("qualityMode", encoder.qualityMode)
              .put("bitrate", encoder.targetBitrate);
        });
  }

  @JavascriptInterface
  public String appendVideo(String id, String png, int index) {
    return call(
        () -> {
          if (encoder == null || !id.equals(encoderId))
            throw new IOException("This video export is no longer active");
          byte[] data = bytes(png, 64 * 1024 * 1024);
          Bitmap image = BitmapFactory.decodeByteArray(data, 0, data.length);
          if (image == null) throw new IOException("Cannot decode the exported frame");
          try {
            encoder.add(image, index);
          } finally {
            image.recycle();
          }
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String finishVideo(String id) {
    return call(
        () -> {
          if (encoder == null || !id.equals(encoderId))
            throw new IOException("This video export is no longer active");
          try {
            encoder.finish();
          } finally {
            encoder.close();
            encoder = null;
            encoderId = null;
            encoderSlot = null;
          }
          if (encoderFile.length() == 0 || encoderFile.length() > PackPolicy.MAX_VIDEO_BYTES)
            throw new IOException("Choose a shorter or smaller video");
          return new JSONObject().put("id", id).put("size", encoderFile.length());
        });
  }

  @JavascriptInterface
  public String cancelVideo(String id) {
    return call(
        () -> {
          if (encoder != null && id.equals(encoderId)) {
            encoder.close();
            encoder = null;
            encoderId = null;
            encoderSlot = null;
          }
          File file = handles.remove(id);
          if (file != null) file.delete();
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String putPoster(String screen, String png) {
    return call(
        () -> {
          if (pack == null || !("cover".equals(screen) || "inner".equals(screen)))
            throw new IOException("Invalid wallpaper poster");
          byte[] data = bytes(png, 64 * 1024 * 1024);
          BitmapFactory.Options options = new BitmapFactory.Options();
          options.inJustDecodeBounds = true;
          BitmapFactory.decodeByteArray(data, 0, data.length, options);
          if (options.outWidth < 16
              || options.outHeight < 16
              || Math.max(options.outWidth, options.outHeight) > 4096
              || (long) options.outWidth * options.outHeight > 16000000)
            throw new IOException("Invalid wallpaper poster dimensions");
          try (FileOutputStream output =
              new FileOutputStream(PackPolicy.child(pack, screen + "-poster.png"))) {
            output.write(data);
          }
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String commitPack(String json) {
    return call(
        () -> {
          if (pack == null || encoder != null)
            throw new IOException("The wallpaper videos are not finished");
          File staged = pack;
          String id;
          synchronized (WallpaperFiles.class) {
            WallpaperGallery.requireNoImport();
            id = files.publish(staged, object(json));
          }
          pack = null;
          handles.entrySet().removeIf(entry -> entry.getValue().getParentFile().equals(staged));
          return new JSONObject().put("id", id);
        });
  }

  @JavascriptInterface
  public String listWallpapers() {
    return call(
        () -> {
          synchronized (WallpaperFiles.class) {
            return new JSONObject()
                .put("wallpapers", gallery.list())
                .put("shuffle", gallery.shuffle())
                .put("sun", gallery.solarInfo());
          }
        });
  }

  @JavascriptInterface
  public String setWallpaperShuffle(String screen, String json, boolean enabled) {
    return call(
        () -> {
          if (json == null || json.length() > PackPolicy.MAX_JSON_BYTES)
            throw new IOException("Shuffle selection is too large");
          gallery.setShuffle(screen, new JSONArray(json), enabled);
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String wallpaperDraft(String id) {
    return call(() -> new JSONObject().put("draft", gallery.draft(id)));
  }

  @JavascriptInterface
  public String setWallpaperShuffleRule(String screen, String id, String json) {
    return call(
        () -> {
          if (json == null || json.length() > 1024) throw new IOException("Invalid shuffle rule");
          gallery.setShuffleRule(screen, id, new JSONObject(json));
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String wallpaperThumbnail(String id) {
    return call(() -> new JSONObject().put("image", gallery.thumbnail(id)));
  }

  @JavascriptInterface
  public String wallpaperThumbnailForScreen(String id, String screen) {
    return call(() -> new JSONObject().put("image", gallery.thumbnail(id, screen)));
  }

  @JavascriptInterface
  public String applyWallpaperScreen(String id, String screen) {
    return call(
        () -> {
          if (!"cover".equals(screen) && !"inner".equals(screen))
            throw new IOException("Choose cover or main screen");
          gallery.apply(id, screen);
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String applyWallpaper(String id) {
    return call(
        () -> {
          gallery.apply(id);
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String renameWallpaper(String id, String name) {
    return call(
        () -> {
          gallery.rename(id, name);
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String deleteWallpaper(String id) {
    return call(
        () -> {
          gallery.delete(id);
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String cancelPack() {
    return call(
        () -> {
          cancelPackInternal();
          return new JSONObject();
        });
  }

  private void cancelPackInternal() throws Exception {
    if (pack == null) return;
    if (encoder != null && encoderSlot != null) {
      encoder.close();
      encoder = null;
      encoderId = null;
      encoderSlot = null;
    }
    File staged = pack;
    pack = null;
    handles.entrySet().removeIf(entry -> entry.getValue().getParentFile().equals(staged));
    files.deleteFolder(staged);
  }

  @JavascriptInterface
  public String beginDownload(String name, String mime) {
    return call(
        () -> {
          String id = WallpaperFiles.newId();
          File file = temporary(".download");
          if (!file.createNewFile()) throw new IOException("Cannot create download");
          handles.put(id, file);
          return new JSONObject().put("id", id);
        });
  }

  @JavascriptInterface
  public String appendDownload(String id, String encoded) {
    return call(
        () -> {
          File file = handles.get(id);
          if (file == null || file.length() > PackPolicy.MAX_VIDEO_BYTES)
            throw new IOException("Invalid or oversized download");
          try (FileOutputStream output = new FileOutputStream(file, true)) {
            output.write(bytes(encoded, 64 * 1024));
          }
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String cancelDownload(String id) {
    return call(
        () -> {
          File file = handles.remove(id);
          if (file != null) file.delete();
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String saveNativeFile(String id, String name) {
    return call(
        () -> {
          File file = handles.remove(id);
          if (file == null || !file.isFile()) throw new IOException("Export file is unavailable");
          String safe = name.replaceAll("[^a-zA-Z0-9._-]", "-");
          if (safe.length() > 100) safe = safe.substring(0, 100);
          host.saveFile(file, safe);
          return new JSONObject();
        });
  }

  @JavascriptInterface
  public String openWallpaperPicker() {
    return call(
        () -> {
          host.wallpaperPicker();
          return new JSONObject();
        });
  }

  void close() {
    worker.close(
        () -> {
          try {
            if (encoder != null) {
              encoder.close();
              encoder = null;
            }
            cancelPackInternal();
            for (File file : handles.values()) file.delete();
            handles.clear();
          } catch (Exception ignored) {
          }
        });
  }
}
