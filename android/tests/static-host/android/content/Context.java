package android.content;

import android.content.res.AssetManager;
import java.io.*;

public class Context {
  public final File base;
  public final SharedPreferences prefs;

  public Context(File base, SharedPreferences prefs) {
    this.base = base;
    this.prefs = prefs;
    getFilesDir().mkdirs();
    getCacheDir().mkdirs();
  }

  public Context getApplicationContext() {
    return this;
  }

  public File getFilesDir() {
    return new File(base, "files");
  }

  public File getCacheDir() {
    return new File(base, "cache");
  }

  public SharedPreferences getSharedPreferences(String name, int mode) {
    return prefs;
  }

  public AssetManager getAssets() {
    return new AssetManager(new File(base, "assets"));
  }
}
