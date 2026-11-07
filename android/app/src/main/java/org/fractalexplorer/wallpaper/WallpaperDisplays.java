package org.fractalexplorer.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.display.DisplayManager;
import android.view.Display;
import org.json.JSONObject;

/** Remember actual panel modes as the phone opens/closes; never infer pixels from WebView DPI. */
final class WallpaperDisplays {
  static void record(Context context, Display display) {
    if (display == null || display.getDisplayId() != Display.DEFAULT_DISPLAY) return;
    Display.Mode mode = display.getMode();
    int width = Math.min(mode.getPhysicalWidth(), mode.getPhysicalHeight());
    int height = Math.max(mode.getPhysicalWidth(), mode.getPhysicalHeight());
    if (width < 16 || height > 4096 || width % 2 != 0 || height % 2 != 0) return;
    String screen =
        PlaybackState.modeFor(width, height) == PlaybackState.Mode.COVER ? "cover" : "inner";
    SharedPreferences preferences = context.getSharedPreferences("wallpaper-displays", 0);
    if (preferences.getInt(screen + "_width", 0) == width
        && preferences.getInt(screen + "_height", 0) == height) return;
    preferences.edit().putInt(screen + "_width", width).putInt(screen + "_height", height).apply();
  }

  static JSONObject snapshot(Context context) throws Exception {
    DisplayManager manager = context.getSystemService(DisplayManager.class);
    if (manager != null) record(context, manager.getDisplay(Display.DEFAULT_DISPLAY));
    SharedPreferences preferences = context.getSharedPreferences("wallpaper-displays", 0);
    JSONObject screens = new JSONObject();
    for (String screen : new String[] {"cover", "inner"}) {
      int width = preferences.getInt(screen + "_width", 0),
          height = preferences.getInt(screen + "_height", 0);
      if (width >= 16 && height >= 16)
        screens.put(screen, new JSONObject().put("width", width).put("height", height));
    }
    return screens;
  }
}
