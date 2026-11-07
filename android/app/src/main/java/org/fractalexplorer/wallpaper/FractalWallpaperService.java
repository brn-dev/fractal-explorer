package org.fractalexplorer.wallpaper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.service.wallpaper.WallpaperService;
import android.view.Display;
import android.view.SurfaceHolder;

public class FractalWallpaperService extends WallpaperService {
  // Both public picker entries share fold reveals while keeping independent engines.
  private static final DisplayReveals reveals = new DisplayReveals();

  @Override
  public Engine onCreateEngine() {
    return new FractalEngine();
  }

  private final class FractalEngine extends Engine
      implements SharedPreferences.OnSharedPreferenceChangeListener {
    private VideoRenderer renderer;
    private SharedPreferences preferences;
    private PowerManager power;
    private boolean visible, awake, ready, destroyed;
    private int width, height;
    private boolean reportedActive;
    private int reportedDisplay = -1;
    private PlaybackState.Mode reportedMode;
    private long screenEvent;
    private final BroadcastReceiver receiver =
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context context, Intent intent) {
            awake = !Intent.ACTION_SCREEN_OFF.equals(intent.getAction()) && power.isInteractive();
            update();
          }
        };

    @Override
    public void onCreate(SurfaceHolder holder) {
      super.onCreate(holder);
      setOffsetNotificationsEnabled(false);
      setTouchEventsEnabled(false);
      preferences = getSharedPreferences("wallpaper", MODE_PRIVATE);
      preferences.registerOnSharedPreferenceChangeListener(this);
      power = getSystemService(PowerManager.class);
      awake = power.isInteractive();
      IntentFilter filter = new IntentFilter();
      filter.addAction(Intent.ACTION_SCREEN_OFF);
      filter.addAction(Intent.ACTION_SCREEN_ON);
      filter.addAction(Intent.ACTION_USER_PRESENT);
      filter.addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
      if (Build.VERSION.SDK_INT >= 33)
        registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
      else registerReceiver(receiver, filter);
    }

    @Override
    public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
      super.onSurfaceChanged(holder, format, width, height);
      this.width = width;
      this.height = height;
      ready = holder.getSurface().isValid();
      if (ready && renderer == null) {
        Display target = getDisplayContext().getDisplay();
        renderer =
            new VideoRenderer(
                FractalWallpaperService.this,
                holder.getSurface(),
                !isPreview()
                    && (target == null || target.getDisplayId() == Display.DEFAULT_DISPLAY));
      }
      update();
    }

    private void update() {
      if (destroyed || renderer == null || !ready) return;
      // The real display mode avoids confusing a launcher's oversized scrolling surface with the
      // inner panel.
      int panelWidth = width, panelHeight = height;
      Display display = getDisplayContext().getDisplay();
      if (!isPreview()) WallpaperDisplays.record(FractalWallpaperService.this, display);
      if (display != null) {
        Display.Mode mode = display.getMode();
        panelWidth = mode.getPhysicalWidth();
        panelHeight = mode.getPhysicalHeight();
      }
      PlaybackState.Mode screenMode = PlaybackState.modeFor(panelWidth, panelHeight);
      String screen = screenMode == PlaybackState.Mode.COVER ? "cover" : "inner";
      int displayId = display == null ? Display.DEFAULT_DISPLAY : display.getDisplayId();
      boolean active = visible && awake;
      if (!isPreview()
          && active
          && (!reportedActive || reportedMode != screenMode || reportedDisplay != displayId)) {
        screenEvent = reveals.reveal(displayId, screenMode);
      }
      reportedActive = active;
      reportedMode = screenMode;
      reportedDisplay = displayId;
      renderer.configure(
          width,
          height,
          screenMode,
          visible && awake,
          WallpaperFiles.playback(preferences, screen, "idle"),
          WallpaperFiles.playback(preferences, screen, "arrival"),
          power.isPowerSaveMode(),
          WallpaperFiles.revision(preferences, screen),
          isPreview() ? 0 : screenEvent,
          SystemClock.elapsedRealtime());
    }

    @Override
    public void onVisibilityChanged(boolean value) {
      visible = value;
      awake = power.isInteractive();
      update();
    }

    @Override
    public void onSharedPreferenceChanged(SharedPreferences prefs, String key) {
      if (!"last_error".equals(key)) update();
    }

    @Override
    public void onSurfaceDestroyed(SurfaceHolder holder) {
      ready = false;
      if (renderer != null) {
        renderer.close();
        renderer = null;
      }
      super.onSurfaceDestroyed(holder);
    }

    @Override
    public void onDestroy() {
      destroyed = true;
      preferences.unregisterOnSharedPreferenceChangeListener(this);
      unregisterReceiver(receiver);
      if (renderer != null) {
        renderer.close();
        renderer = null;
      }
      super.onDestroy();
    }
  }
}
