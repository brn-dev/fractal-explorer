package android.os;

import java.util.*;

public class Handler {
  public static final List<Handler> all = new ArrayList<>();
  public Runnable callback;
  public long delay;
  public int posts;

  public Handler(Looper looper) {
    all.add(this);
  }

  public boolean post(Runnable callback) {
    callback.run();
    return true;
  }

  public boolean postDelayed(Runnable callback, long delay) {
    this.callback = callback;
    this.delay = delay;
    posts++;
    return true;
  }

  public void removeCallbacks(Runnable callback) {
    if (this.callback == callback) this.callback = null;
  }
}
