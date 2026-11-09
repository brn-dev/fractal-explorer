package android.content;

public abstract class BroadcastReceiver {
  public PendingResult pending;

  public abstract void onReceive(Context context, Intent intent);

  public PendingResult goAsync() {
    return pending = new PendingResult();
  }

  public static class PendingResult {
    public int finishes;

    public void finish() {
      finishes++;
    }
  }
}
