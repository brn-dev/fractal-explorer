package org.fractalexplorer.wallpaper;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.MimeTypeMap;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity implements ExplorerBridge.Host {
  private static final String ORIGIN = "appassets.androidplatform.net";
  private static final String HOME = "https://" + ORIGIN + "/explorer/index.html";
  private static final int CHOOSE_FILE = 71, SAVE_FILE = 72;
  private WebView web;
  private ExplorerBridge bridge;
  private ValueCallback<Uri[]> fileChooser;
  private File pendingSave;
  private boolean galleryRequested;
  private static boolean recoveredExports;
  private static final java.util.Set<String> copying =
      java.util.concurrent.ConcurrentHashMap.newKeySet();

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    galleryRequested = getIntent().getBooleanExtra("wallpaper_gallery", false);
    WallpaperFiles.recoverImportCache(getApplicationContext());
    if (state != null) {
      String saved = state.getString("pendingSave");
      if (saved != null && saved.matches("[a-f0-9]{32}\\.(download|mp4)"))
        pendingSave = new File(new File(getCacheDir(), "exports"), saved);
    }
    synchronized (MainActivity.class) {
      if (!recoveredExports) {
        recoveredExports = true;
        File[] old = new File(getCacheDir(), "exports").listFiles();
        if (old != null)
          for (File file : old)
            if (file.getName().matches("[a-f0-9]{32}\\.(download|mp4)")
                && !file.equals(pendingSave)
                && !getSharedPreferences("export-copies", 0).contains(file.getName()))
              file.delete();
      }
    }
    setTitle("Fractal Explorer");
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    LinearLayout toolbar = new LinearLayout(this);
    toolbar.setGravity(android.view.Gravity.END);
    Button gallery = new Button(this);
    gallery.setText("Wallpaper gallery");
    gallery.setAllCaps(false);
    gallery.setOnClickListener(view -> showGallery());
    toolbar.addView(gallery, new LinearLayout.LayoutParams(0, -2, 1));
    Button settings = new Button(this);
    settings.setText("Wallpaper settings");
    settings.setAllCaps(false);
    settings.setOnClickListener(view -> startActivity(new Intent(this, SettingsActivity.class)));
    toolbar.addView(settings, new LinearLayout.LayoutParams(0, -2, 1));
    root.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));
    web = new WebView(this);
    root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(root);
    root.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
          root.setPadding(bars.left, bars.top, bars.right, bars.bottom);
          return insets;
        });
    WebSettings config = web.getSettings();
    config.setJavaScriptEnabled(true);
    config.setDomStorageEnabled(true);
    config.setAllowFileAccess(false);
    config.setAllowContentAccess(
        true); // Files explicitly chosen through Android's document picker.
    config.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    config.setJavaScriptCanOpenWindowsAutomatically(false);
    config.setMediaPlaybackRequiresUserGesture(true);
    config.setBlockNetworkLoads(true);
    bridge = new ExplorerBridge(this, this);
    web.addJavascriptInterface(bridge, "FractalNative");
    web.setWebViewClient(
        new WebViewClient() {
          @Override
          public void onPageFinished(WebView view, String url) {
            if (galleryRequested) showGallery();
          }

          @Override
          public WebResourceResponse shouldInterceptRequest(
              WebView view, WebResourceRequest request) {
            return resource(request.getUrl());
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (local(uri)) return false;
            if (request.isForMainFrame()
                && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
              try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
              } catch (Exception ignored) {
              }
            }
            return true;
          }
        });
    ServiceWorkerController.getInstance()
        .setServiceWorkerClient(
            new ServiceWorkerClient() {
              @Override
              public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return resource(request.getUrl());
              }
            });
    web.setWebChromeClient(
        new WebChromeClient() {
          @Override
          public boolean onShowFileChooser(
              WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooser != null) fileChooser.onReceiveValue(null);
            fileChooser = callback;
            try {
              startActivityForResult(params.createIntent(), CHOOSE_FILE);
              return true;
            } catch (Exception error) {
              fileChooser = null;
              return false;
            }
          }
        });
    web.loadUrl(HOME);
    for (Map.Entry<String, ?> job : getSharedPreferences("export-copies", 0).getAll().entrySet()) {
      if (job.getKey().matches("[a-f0-9]{32}\\.(download|mp4)") && job.getValue() instanceof String)
        copyExport(
            new File(new File(getCacheDir(), "exports"), job.getKey()),
            Uri.parse((String) job.getValue()));
    }
  }

  private void showGallery() {
    galleryRequested = true;
    if (web != null && web.getProgress() == 100) {
      galleryRequested = false;
      web.evaluateJavascript(
          "window.fractalGalleryRequested=true;window.dispatchEvent(new"
              + " Event('open-wallpaper-gallery'))",
          null);
    }
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (intent.getBooleanExtra("wallpaper_gallery", false)) showGallery();
  }

  private static boolean local(Uri uri) {
    return "https".equals(uri.getScheme())
        && ORIGIN.equals(uri.getHost())
        && (uri.getPort() == -1 || uri.getPort() == 443)
        && uri.getPath() != null
        && uri.getPath().startsWith("/explorer/");
  }

  private WebResourceResponse resource(Uri uri) {
    try {
      if (!local(uri)) throw new java.io.IOException("External resources are disabled");
      String path = uri.getPath().substring(1);
      for (String segment : path.split("/"))
        if (segment.equals("..")
            || segment.equals(".")
            || segment.indexOf('\\') >= 0
            || segment.indexOf('\0') >= 0) throw new java.io.IOException("Invalid asset path");
      if (path.equals("explorer/")) path += "index.html";
      String ext = MimeTypeMap.getFileExtensionFromUrl(path),
          mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
      if ("js".equals(ext) || "mjs".equals(ext)) mime = "application/javascript";
      if ("wasm".equals(ext)) mime = "application/wasm";
      if ("webmanifest".equals(ext)) mime = "application/manifest+json";
      if (mime == null) mime = "application/octet-stream";
      Map<String, String> headers = new HashMap<>();
      headers.put("Cache-Control", "no-store");
      headers.put("Access-Control-Allow-Origin", "https://" + ORIGIN);
      headers.put(
          "Content-Security-Policy",
          "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';"
              + " style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self';"
              + " frame-src 'none'; object-src 'none'; base-uri 'self'");
      return new WebResourceResponse(
          mime, "UTF-8", 200, "OK", headers, getApplicationContext().getAssets().open(path));
    } catch (Exception error) {
      if (local(uri)) android.util.Log.e("FractalAssets", "Cannot load " + uri, error);
      return new WebResourceResponse(
          "text/plain",
          "UTF-8",
          404,
          "Not found",
          null,
          new ByteArrayInputStream(
              "Bundled resource unavailable".getBytes(StandardCharsets.UTF_8)));
    }
  }

  @Override
  public void saveFile(File file, String name) {
    runOnUiThread(
        () -> {
          if (pendingSave != null) {
            file.delete();
            Toast.makeText(this, "Finish the current save first", Toast.LENGTH_SHORT).show();
            return;
          }
          pendingSave = file;
          Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
          intent.addCategory(Intent.CATEGORY_OPENABLE);
          String mime =
              MimeTypeMap.getSingleton()
                  .getMimeTypeFromExtension(name.substring(name.lastIndexOf('.') + 1));
          intent.setType(mime == null ? "application/octet-stream" : mime);
          intent.putExtra(Intent.EXTRA_TITLE, name);
          try {
            startActivityForResult(intent, SAVE_FILE);
          } catch (Exception error) {
            pendingSave = null;
            file.delete();
            Toast.makeText(this, "Could not open the save picker", Toast.LENGTH_LONG).show();
          }
        });
  }

  @Override
  public void wallpaperPicker() {
    runOnUiThread(() -> startActivity(new Intent(this, WallpaperSetupActivity.class)));
  }

  @Override
  public void shareText(String text) {
    runOnUiThread(
        () -> {
          try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(send, "Send wallpaper design to PC"));
          } catch (Exception error) {
            Toast.makeText(
                    this, "Could not open sharing. Use Copy PC link instead.", Toast.LENGTH_LONG)
                .show();
          }
        });
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == CHOOSE_FILE) {
      if (fileChooser != null)
        fileChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
      fileChooser = null;
    }
    if (request == SAVE_FILE) {
      File source = pendingSave;
      pendingSave = null;
      if (source == null) return;
      if (result != RESULT_OK || data == null || data.getData() == null) {
        source.delete();
        return;
      }
      Uri destination = data.getData();
      try {
        getContentResolver()
            .takePersistableUriPermission(
                destination,
                data.getFlags()
                    & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
      } catch (SecurityException ignored) {
        /* Some document providers only grant temporary access. */
      }
      boolean registered =
          getSharedPreferences("export-copies", 0)
              .edit()
              .putString(source.getName(), destination.toString())
              .commit();
      if (!registered) {
        getSharedPreferences("export-copies", 0).edit().remove(source.getName()).commit();
        source.delete();
        Toast.makeText(
                this,
                "Could not prepare the save. Free some storage and export again.",
                Toast.LENGTH_LONG)
            .show();
        return;
      }
      copyExport(source, destination);
    }
  }

  private void copyExport(File source, Uri destination) {
    if (!copying.add(source.getName())) return;
    if (!source.isFile()) {
      getSharedPreferences("export-copies", 0).edit().remove(source.getName()).apply();
      copying.remove(source.getName());
      return;
    }
    new Thread(
            () -> {
              String message;
              boolean saved = false;
              try {
                try (InputStream input = new FileInputStream(source);
                    OutputStream output =
                        getContentResolver().openOutputStream(destination, "wt")) {
                  if (output == null) throw new java.io.IOException("Cannot open destination");
                  byte[] buffer = new byte[65536];
                  int count;
                  while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                  output.flush();
                }
                saved = true;
                message = "Export saved.";
              } catch (Exception error) {
                message = "Could not save: " + error.getMessage() + ". Reopen the app to retry.";
              } finally {
                if (saved) {
                  getSharedPreferences("export-copies", 0).edit().remove(source.getName()).commit();
                  source.delete();
                  try {
                    getContentResolver()
                        .releasePersistableUriPermission(
                            destination,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                  } catch (SecurityException ignored) {
                  }
                }
                copying.remove(source.getName());
              }
              String text = message;
              runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
            },
            "Save fractal export")
        .start();
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    if (pendingSave != null) state.putString("pendingSave", pendingSave.getName());
    super.onSaveInstanceState(state);
  }

  @Override
  protected void onPause() {
    if (web != null) {
      web.onPause();
      web.pauseTimers();
    }
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    refreshWallpaperDisplay();
    if (web != null) {
      web.resumeTimers();
      web.onResume();
    }
  }

  private void refreshWallpaperDisplay() {
    WallpaperDisplays.record(this, getDisplay());
    if (web != null)
      web.evaluateJavascript(
          "window.dispatchEvent(new Event('wallpaper-displays-changed'));", null);
  }

  @Override
  public void onConfigurationChanged(android.content.res.Configuration configuration) {
    super.onConfigurationChanged(configuration);
    refreshWallpaperDisplay();
  }

  @Override
  public void onBackPressed() {
    if (web == null) {
      super.onBackPressed();
      return;
    }
    web.evaluateJavascript(
        "(()=>{const"
            + " dialog=document.activeElement?.closest('dialog[open]')||Array.from(document.querySelectorAll('dialog[open]')).pop();if(dialog){dialog.close();return"
            + " true;}const"
            + " editing=document.getElementById('wallpaper-editing');if(editing&&!editing.hidden){document.getElementById('wallpaper-overview').click();return"
            + " true;}return false;})()",
        consumed -> {
          if (!"true".equals(consumed)) {
            if (web.canGoBack()) web.goBack();
            else MainActivity.super.onBackPressed();
          }
        });
  }

  @Override
  protected void onDestroy() {
    if (fileChooser != null) fileChooser.onReceiveValue(null);
    if (web != null) {
      web.removeJavascriptInterface("FractalNative");
      web.destroy();
    }
    if (bridge != null) bridge.close();
    super.onDestroy();
  }
}
