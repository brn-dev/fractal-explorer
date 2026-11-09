package org.fractalexplorer.wallpaper;

import android.app.Application;

public final class FractalApplication extends Application {
  @Override
  public void onCreate() {
    super.onCreate();
    LauncherIcon.get(this).start();
  }
}
