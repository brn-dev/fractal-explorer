package org.fractalexplorer.wallpaper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Explicit non-waking alarm, completed pin requests, and protected system clock/boot broadcasts.
 */
public final class IconModeReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    PendingResult pending = goAsync();
    try {
      LauncherIcon.get(context).refresh(true, pending::finish);
    } catch (RuntimeException error) {
      pending.finish();
      android.util.Log.w("FractalIcon", "Cannot refresh launcher", error);
    }
  }
}
