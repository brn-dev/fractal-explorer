package org.fractalexplorer.wallpaper;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** The normal Android picker targets the currently active panel on Samsung Folds. */
public final class WallpaperSetupActivity extends Activity {
  private static final int PICK_WALLPAPER = 61;
  private TextView current, status;
  private Button cover, inner;
  private PlaybackState.Mode pending;
  private String lastMessage = "";
  private DisplayManager displays;
  private final DisplayManager.DisplayListener displayListener =
      new DisplayManager.DisplayListener() {
        public void onDisplayChanged(int id) {
          refresh();
        }

        public void onDisplayAdded(int id) {
          refresh();
        }

        public void onDisplayRemoved(int id) {
          refresh();
        }
      };

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    setTitle("Set wallpaper on both screens");
    displays = getSystemService(DisplayManager.class);
    if (saved != null) {
      lastMessage = saved.getString("message", "");
      String value = saved.getString("pending");
      if ("COVER".equals(value)) pending = PlaybackState.Mode.COVER;
      else if ("INNER".equals(value)) pending = PlaybackState.Mode.INNER;
    }
    ScrollView scroll = new ScrollView(this);
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    int gap = Math.round(20 * getResources().getDisplayMetrics().density);
    content.setPadding(gap, gap, gap, gap);
    scroll.addView(content);
    setContentView(scroll);
    scroll.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
          content.setPadding(gap + bars.left, gap + bars.top, gap + bars.right, gap + bars.bottom);
          return insets;
        });
    text(content, "Two displays. Two setup steps.", 25);
    text(
        content,
        "On Samsung Fold, choosing Home and lock screens can apply only to the display you are"
            + " using. Set Fractal Wallpaper once while open and once while folded.",
        16);
    current = text(content, "", 18);
    text(content, "1 · Inner screen", 21);
    text(
        content,
        "Open the phone. Tap below, then choose Home and lock screens in Android's preview.",
        16);
    inner =
        button(content, "Set inner screen", () -> launchPicker(PlaybackState.Mode.INNER, false));
    text(content, "2 · Cover screen", 21);
    text(
        content,
        "Fold the phone, wake and unlock the small screen, and reopen this app if needed. Tap below"
            + " and choose Home and lock screens again.",
        16);
    cover =
        button(content, "Set cover screen", () -> launchPicker(PlaybackState.Mode.COVER, false));
    text(
        content,
        "After both steps, check the home and lock screens on each display. New gallery selections"
            + " then reuse the same live wallpaper service; you do not need to repeat setup unless"
            + " a display is changed to a different wallpaper.",
        15);
    text(content, "Still seeing Samsung's wallpaper on the cover?", 19);
    text(
        content,
        "The cover step uses a separate entry, Fractal Wallpaper · Cover, so Android can offer it"
            + " even when Fractal Wallpaper is already selected for the inner screen. Both use your"
            + " current gallery selection. If the direct preview has no Set button, try the live"
            + " wallpaper list below while folded and select Fractal Wallpaper · Cover.",
        15);
    button(content, "Open live wallpapers on this screen", () -> launchPicker(currentMode(), true));
    status = text(content, lastMessage, 15);
  }

  private TextView text(LinearLayout parent, String value, int size) {
    TextView text = new TextView(this);
    text.setText(value);
    text.setTextSize(size);
    add(parent, text);
    return text;
  }

  private Button button(LinearLayout parent, String label, Runnable action) {
    Button button = new Button(this);
    button.setText(label);
    button.setAllCaps(false);
    button.setOnClickListener(view -> action.run());
    add(parent, button);
    return button;
  }

  private void add(LinearLayout parent, android.view.View view) {
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
    params.bottomMargin = Math.round(16 * getResources().getDisplayMetrics().density);
    parent.addView(view, params);
  }

  private PlaybackState.Mode currentMode() {
    Display display = getDisplay();
    if (display != null) {
      Display.Mode mode = display.getMode();
      return PlaybackState.modeFor(mode.getPhysicalWidth(), mode.getPhysicalHeight());
    }
    android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
    return PlaybackState.modeFor(metrics.widthPixels, metrics.heightPixels);
  }

  private void refresh() {
    if (current == null) return;
    boolean folded = currentMode() == PlaybackState.Mode.COVER;
    current.setText(
        folded ? "Using the cover screen · phone folded" : "Using the inner screen · phone open");
    inner.setEnabled(!folded);
    cover.setEnabled(folded);
  }

  private void launchPicker(PlaybackState.Mode expected, boolean chooser) {
    if (currentMode() != expected) {
      lastMessage =
          expected == PlaybackState.Mode.COVER
              ? "Fold the phone and reopen this screen first."
              : "Open the phone first.";
      status.setText(lastMessage);
      refresh();
      return;
    }
    Intent intent =
        new Intent(
            chooser
                ? WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER
                : WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
    if (!chooser)
      intent.putExtra(
          WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
          new ComponentName(
              this,
              expected == PlaybackState.Mode.COVER
                  ? CoverWallpaperService.class
                  : FractalWallpaperService.class));
    pending = expected;
    try {
      startActivityForResult(intent, PICK_WALLPAPER);
    } catch (android.content.ActivityNotFoundException error) {
      pending = null;
      lastMessage =
          "This system wallpaper picker is unavailable. Use Samsung Settings → Wallpaper and style"
              + " while on this screen.";
      status.setText(lastMessage);
    }
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == PICK_WALLPAPER && pending != null) {
      lastMessage =
          "Returned from the "
              + (pending == PlaybackState.Mode.COVER ? "cover" : "inner")
              + " screen picker. Check both home and lock screens there; Android does not confirm"
              + " the other display was changed.";
      pending = null;
      status.setText(lastMessage);
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    refresh();
  }

  @Override
  protected void onStart() {
    super.onStart();
    displays.registerDisplayListener(displayListener, null);
  }

  @Override
  protected void onStop() {
    displays.unregisterDisplayListener(displayListener);
    super.onStop();
  }

  @Override
  public void onConfigurationChanged(Configuration config) {
    super.onConfigurationChanged(config);
    refresh();
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state);
    state.putString("message", lastMessage);
    if (pending != null) state.putString("pending", pending.name());
  }
}
