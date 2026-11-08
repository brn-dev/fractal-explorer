package org.fractalexplorer.wallpaper;

/** Host fixture for an in-progress Android settings import. */
public final class SettingsActivity {
  static boolean pending;

  static boolean hasPendingChanges() {
    return pending;
  }
}
