package android.content.pm;

import android.content.IntentSender;
import java.util.*;

public class ShortcutManager {
  public final List<ShortcutInfo> pinned = new ArrayList<>();
  public ShortcutInfo requested;
  public IntentSender callback;
  public int updates, reads;
  public boolean supported = true, updateOK = true, requestOK = true, locked;

  public List<ShortcutInfo> getPinnedShortcuts() {
    reads++;
    if (locked) throw new IllegalStateException("locked");
    return new ArrayList<>(pinned);
  }

  public boolean isRequestPinShortcutSupported() {
    return supported;
  }

  public boolean updateShortcuts(List<ShortcutInfo> items) {
    if (locked) throw new IllegalStateException("locked");
    updates++;
    if (!updateOK) return false;
    for (ShortcutInfo item : items)
      for (int i = 0; i < pinned.size(); i++)
        if (pinned.get(i).id.equals(item.id)) pinned.set(i, item);
    return true;
  }

  public boolean requestPinShortcut(ShortcutInfo info, IntentSender callback) {
    this.requested = info;
    this.callback = callback;
    return requestOK;
  }
}
