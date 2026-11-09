package org.fractalexplorer.wallpaper;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Launcher artwork follows exactly the same offline solar clock as shuffle eligibility. */
final class LauncherIcon {
  static final String SHORTCUT_ID = "day-night-explorer";
  static final String ALARM_ACTION = "org.fractalexplorer.wallpaper.ICON_BOUNDARY";
  static final String PIN_ACTION = "org.fractalexplorer.wallpaper.ICON_PINNED";
  private static LauncherIcon instance;
  private final Context context;
  private final Executor worker;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Runnable boundary = () -> refresh(false);
  private long scheduledAt;
  private boolean started;
  private volatile long generation;
  private int shortcutMode = -1;

  static synchronized LauncherIcon get(Context context) {
    if (instance == null)
      instance =
          new LauncherIcon(
              context.getApplicationContext(),
              Executors.newSingleThreadExecutor(
                  r -> {
                    Thread thread = new Thread(r, "launcher-icon");
                    thread.setDaemon(true);
                    return thread;
                  }));
    return instance;
  }

  LauncherIcon(Context context, Executor worker) {
    this.context = context;
    this.worker = worker;
  }

  void start() {
    if (started) return;
    started = true;
    // SCREEN_ON cannot be received from the manifest. If our wallpaper/app is
    // alive, correct immediately on wake, even when an inexact alarm was delayed.
    BroadcastReceiver screen =
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context c, Intent intent) {
            refresh(true);
          }
        };
    IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_ON);
    filter.addAction(Intent.ACTION_USER_PRESENT);
    try {
      if (Build.VERSION.SDK_INT >= 33)
        context.registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED);
      else context.registerReceiver(screen, filter);
    } catch (RuntimeException error) {
      Log.w("FractalIcon", "Cannot watch screen wake", error);
    }
    refresh(true);
  }

  void refresh(boolean resetSchedule) {
    refreshAt(System.currentTimeMillis(), resetSchedule);
  }

  void refresh(boolean resetSchedule, Runnable finished) {
    refreshAt(System.currentTimeMillis(), resetSchedule, finished);
  }

  // Main-thread scheduler; supplied wall time makes sunrise/sunset boundaries testable.
  void refreshAt(long now, boolean resetSchedule) {
    refreshAt(now, resetSchedule, null);
  }

  private void refreshAt(long now, boolean resetSchedule, Runnable finished) {
    ViennaSun sun = ViennaSun.at(now);
    boolean day = sun.daytime(now);
    long next = sun.next(now), request = ++generation;
    if (resetSchedule || scheduledAt != next) {
      main.removeCallbacks(boundary);
      main.postDelayed(boundary, Math.max(1, next - now));
      scheduledAt = next;
      try {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.set(AlarmManager.RTC, next, callback(ALARM_ACTION, 0));
      } catch (RuntimeException error) {
        Log.w("FractalIcon", "Cannot schedule launcher refresh", error);
      }
    }
    worker.execute(
        () -> {
          try {
            if (request != generation) return;
            try {
              selectAlias(day);
            } catch (RuntimeException error) {
              Log.w("FractalIcon", "Cannot update launcher icon", error);
            }
            if (request == generation) updatePinned(day, resetSchedule);
          } finally {
            if (finished != null) finished.run();
          }
        });
  }

  private PendingIntent callback(String action, int request) {
    return PendingIntent.getBroadcast(
        context,
        request,
        new Intent(context, IconModeReceiver.class).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private boolean enabled(PackageManager pm, ComponentName component, boolean defaultValue) {
    int state = pm.getComponentEnabledSetting(component);
    return state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
        ? defaultValue
        : state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
  }

  private void selectAlias(boolean day) {
    PackageManager pm = context.getPackageManager();
    ComponentName dayIcon = new ComponentName(context, context.getPackageName() + ".DayLauncher");
    ComponentName nightIcon =
        new ComponentName(context, context.getPackageName() + ".NightLauncher");
    if (enabled(pm, dayIcon, true) == day && enabled(pm, nightIcon, false) != day) return;
    int on = PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        off = PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
    if (Build.VERSION.SDK_INT >= 33) {
      pm.setComponentEnabledSettings(
          Arrays.asList(
              new PackageManager.ComponentEnabledSetting(
                  dayIcon, day ? on : off, PackageManager.DONT_KILL_APP),
              new PackageManager.ComponentEnabledSetting(
                  nightIcon, day ? off : on, PackageManager.DONT_KILL_APP)));
    } else {
      // Always enable the replacement first, so a failed call cannot hide every
      // launcher entry. The real MainActivity is never disabled.
      pm.setComponentEnabledSetting(day ? dayIcon : nightIcon, on, PackageManager.DONT_KILL_APP);
      pm.setComponentEnabledSetting(day ? nightIcon : dayIcon, off, PackageManager.DONT_KILL_APP);
    }
  }

  private ShortcutInfo shortcut(boolean day) {
    return new ShortcutInfo.Builder(context, SHORTCUT_ID)
        .setShortLabel("Fractal Explorer")
        .setLongLabel("Fractal Explorer · " + (day ? "Daytime" : "Nighttime"))
        .setIcon(
            Icon.createWithResource(context, day ? R.mipmap.launcher_day : R.mipmap.launcher_night))
        .setIntent(
            new Intent(context, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP))
        .build();
  }

  private void updatePinned(boolean day, boolean force) {
    int mode = day ? 1 : 0;
    if (!force && shortcutMode == mode) return;
    try {
      ShortcutManager manager = context.getSystemService(ShortcutManager.class);
      if (manager == null) return;
      for (ShortcutInfo item : manager.getPinnedShortcuts()) {
        if (SHORTCUT_ID.equals(item.getId())) {
          String label = "Fractal Explorer · " + (day ? "Daytime" : "Nighttime");
          if (!label.contentEquals(item.getLongLabel() == null ? "" : item.getLongLabel())
              && !manager.updateShortcuts(Collections.singletonList(shortcut(day)))) return;
          break;
        }
      }
      shortcutMode = mode;
    } catch (RuntimeException error) {
      // Locked users/rate limiting retry on unlock or the next refresh.
      Log.w("FractalIcon", "Cannot update pinned icon", error);
    }
  }

  void pinHomeIcon(Consumer<String> report) {
    worker.execute(
        () -> {
          String message;
          try {
            ShortcutManager manager = context.getSystemService(ShortcutManager.class);
            if (manager == null || !manager.isRequestPinShortcutSupported()) {
              message = "Your launcher does not support adding a day/night shortcut.";
            } else {
              long now = System.currentTimeMillis();
              ShortcutInfo info = shortcut(ViennaSun.at(now).daytime(now));
              // Pinned-only (never published as a dynamic shortcut). Its launch
              // intent always targets the enabled activity, independent of aliases.
              manager.updateShortcuts(Collections.singletonList(info));
              boolean requested =
                  manager.requestPinShortcut(info, callback(PIN_ACTION, 1).getIntentSender());
              message =
                  requested
                      ? "Confirm Add in your launcher to place the day/night icon."
                      : "The launcher could not add the shortcut. Check your home screen settings.";
            }
          } catch (RuntimeException error) {
            Log.w("FractalIcon", "Cannot pin home icon", error);
            message = "Could not add the shortcut. Keep the app open and try again.";
          }
          String result = message;
          main.post(() -> report.accept(result));
        });
  }
}
