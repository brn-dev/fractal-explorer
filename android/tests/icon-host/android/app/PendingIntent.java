package android.app;

import android.content.*;

public class PendingIntent {
  public static final int FLAG_UPDATE_CURRENT = 0x08000000, FLAG_IMMUTABLE = 0x04000000;
  public Intent intent;
  public int request, flags;

  public static PendingIntent getBroadcast(Context context, int request, Intent intent, int flags) {
    PendingIntent p = new PendingIntent();
    p.intent = intent;
    p.request = request;
    p.flags = flags;
    return p;
  }

  public IntentSender getIntentSender() {
    return new IntentSender(intent);
  }
}
