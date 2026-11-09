package android.content.pm;

import android.content.*;
import android.graphics.drawable.Icon;

public class ShortcutInfo {
  public String id, label, longLabel;
  public Intent intent;
  public Icon icon;

  public String getId() {
    return id;
  }

  public CharSequence getLongLabel() {
    return longLabel;
  }

  public static class Builder {
    private final ShortcutInfo info = new ShortcutInfo();

    public Builder(Context context, String id) {
      info.id = id;
    }

    public Builder setShortLabel(String label) {
      info.label = label;
      return this;
    }

    public Builder setLongLabel(String label) {
      info.longLabel = label;
      return this;
    }

    public Builder setIcon(Icon icon) {
      info.icon = icon;
      return this;
    }

    public Builder setIntent(Intent intent) {
      info.intent = intent;
      return this;
    }

    public ShortcutInfo build() {
      return info;
    }
  }
}
