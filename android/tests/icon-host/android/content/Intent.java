package android.content;

public class Intent {
  public static final String ACTION_MAIN = "android.intent.action.MAIN",
      ACTION_SCREEN_ON = "android.intent.action.SCREEN_ON",
      ACTION_USER_PRESENT = "android.intent.action.USER_PRESENT";
  public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000, FLAG_ACTIVITY_CLEAR_TOP = 0x04000000;
  public ComponentName component;
  public String action;
  public int flags;

  public Intent(Context context, Class<?> type) {
    component = new ComponentName(context, type);
  }

  public Intent(String action) {
    this.action = action;
  }

  public Intent setAction(String action) {
    this.action = action;
    return this;
  }

  public Intent addFlags(int flags) {
    this.flags |= flags;
    return this;
  }
}
