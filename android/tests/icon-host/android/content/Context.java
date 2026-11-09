package android.content;

import android.content.pm.PackageManager;
import java.util.*;

public class Context {
  public static final int RECEIVER_NOT_EXPORTED = 4;
  public final Map<Class<?>, Object> services = new HashMap<>();
  public final PackageManager pm = new PackageManager();
  public BroadcastReceiver screenReceiver;
  public int registrations, receiverFlags;
  public boolean failReceiver;

  public Context getApplicationContext() {
    return this;
  }

  public String getPackageName() {
    return "org.fractalexplorer.wallpaper";
  }

  public PackageManager getPackageManager() {
    return pm;
  }

  public <T> T getSystemService(Class<T> type) {
    return type.cast(services.get(type));
  }

  public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter) {
    return registerReceiver(receiver, filter, 0);
  }

  public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter, int flags) {
    if (failReceiver) throw new IllegalStateException("receiver failed");
    screenReceiver = receiver;
    registrations++;
    receiverFlags = flags;
    return null;
  }
}
