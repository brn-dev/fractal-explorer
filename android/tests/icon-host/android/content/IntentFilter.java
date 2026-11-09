package android.content;

import java.util.*;

public class IntentFilter {
  public final List<String> actions = new ArrayList<>();

  public IntentFilter(String action) {
    addAction(action);
  }

  public void addAction(String action) {
    actions.add(action);
  }
}
