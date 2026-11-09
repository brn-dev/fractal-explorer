package android.app;

public class AlarmManager {
  public static final int RTC = 1;
  public int type, calls;
  public long at;
  public PendingIntent intent;
  public boolean fail;

  public void set(int type, long at, PendingIntent intent) {
    calls++;
    if (fail) throw new IllegalStateException("alarm failed");
    this.type = type;
    this.at = at;
    this.intent = intent;
  }
}
