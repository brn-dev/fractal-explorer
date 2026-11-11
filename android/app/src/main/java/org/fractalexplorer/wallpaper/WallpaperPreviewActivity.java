package org.fractalexplorer.wallpaper;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Immersive, read-only playback. Touch closes this activity without touching the gallery selection.
 */
public final class WallpaperPreviewActivity extends Activity implements SurfaceHolder.Callback {
  private final ExecutorService loader = Executors.newSingleThreadExecutor();
  private WallpaperPreviewSource source;
  private FrameLayout root;
  private SurfaceView surface;
  private VideoRenderer renderer;
  private boolean resumed, surfaceReady, closing;
  private int width, height;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setBackgroundDrawable(new ColorDrawable(Color.BLACK));
    getWindow().setDecorFitsSystemWindows(false);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    WindowManager.LayoutParams attributes = getWindow().getAttributes();
    attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
    getWindow().setAttributes(attributes);
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    root.setContentDescription("Wallpaper preview. Tap anywhere to return to the gallery.");
    root.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
    root.setOnClickListener(view -> finish());
    surface = new SurfaceView(this);
    surface.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    surface.getHolder().addCallback(this);
    root.addView(surface, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
    root.addOnLayoutChangeListener(
        (view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> fitSurface());
    setContentView(root);
    immersive();
    String id = getIntent().getStringExtra("wallpaper_id");
    String screen = getIntent().getStringExtra("wallpaper_screen");
    loader.execute(
        () -> {
          try {
            WallpaperPreviewSource loaded = new WallpaperGallery(this).previewSource(id, screen);
            runOnUiThread(
                () -> {
                  if (closing || isFinishing() || isDestroyed()) return;
                  source = loaded;
                  fitSurface();
                  startPlayback();
                });
          } catch (Exception error) {
            failed(error);
          }
        });
  }

  private void immersive() {
    WindowInsetsController controller = getWindow().getInsetsController();
    if (controller != null) {
      controller.setSystemBarsBehavior(
          WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      controller.hide(WindowInsets.Type.systemBars());
    }
  }

  private void fitSurface() {
    if (source == null || closing) return;
    int[] fit = source.fit(root.getWidth(), root.getHeight());
    if (fit[0] == 0 || fit[1] == 0) return;
    FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) surface.getLayoutParams();
    if (layout.width != fit[0] || layout.height != fit[1]) {
      layout.width = fit[0];
      layout.height = fit[1];
      surface.setLayoutParams(layout);
    }
  }

  private void startPlayback() {
    if (closing || !resumed || !surfaceReady || source == null || width <= 0 || height <= 0) return;
    // Wait for the selected artwork's aspect ratio before exposing the first frame.
    FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) surface.getLayoutParams();
    if (width != layout.width || height != layout.height) return;
    if (renderer == null)
      renderer = new VideoRenderer(this, surface.getHolder().getSurface(), source, this::failed);
    renderer.configure(
        width,
        height,
        source.mode(),
        true,
        source.idle,
        source.hasEntry,
        false,
        1,
        1,
        SystemClock.elapsedRealtime());
  }

  private void stopPlayback() {
    VideoRenderer previous = renderer;
    renderer = null;
    if (previous != null) previous.closeAsync();
  }

  private void failed(Exception error) {
    runOnUiThread(
        () -> {
          if (closing || isFinishing() || isDestroyed()) return;
          Toast.makeText(
                  this, "Cannot preview this wallpaper: " + error.getMessage(), Toast.LENGTH_LONG)
              .show();
          finish();
        });
  }

  @Override
  public void finish() {
    closing = true;
    stopPlayback();
    super.finish();
  }

  @Override
  protected void onResume() {
    super.onResume();
    resumed = true;
    immersive();
    startPlayback();
  }

  @Override
  protected void onPause() {
    resumed = false;
    stopPlayback();
    if (!isFinishing()) finish();
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    closing = true;
    stopPlayback();
    loader.shutdownNow();
    super.onDestroy();
  }

  @Override
  public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    if (focused) immersive();
  }

  @Override
  public boolean dispatchTouchEvent(MotionEvent event) {
    if (event.getActionMasked() == MotionEvent.ACTION_DOWN) finish();
    return true;
  }

  @Override
  public boolean dispatchGenericMotionEvent(MotionEvent event) {
    if (event.getActionMasked() == MotionEvent.ACTION_BUTTON_PRESS) {
      finish();
      return true;
    }
    return super.dispatchGenericMotionEvent(event);
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_ESCAPE) {
      finish();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  public void surfaceCreated(SurfaceHolder holder) {
    surfaceReady = true;
    startPlayback();
  }

  @Override
  public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
    this.width = width;
    this.height = height;
    startPlayback();
  }

  @Override
  public void surfaceDestroyed(SurfaceHolder holder) {
    surfaceReady = false;
    width = height = 0;
    stopPlayback();
  }
}
