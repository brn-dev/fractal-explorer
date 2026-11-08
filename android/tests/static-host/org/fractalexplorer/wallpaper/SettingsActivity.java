package org.fractalexplorer.wallpaper;

/** Host fixture: no Android settings transaction is running during storage tests. */
public final class SettingsActivity {
  static boolean hasPendingChanges() {
    return false;
  }
}
