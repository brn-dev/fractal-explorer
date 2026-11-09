package android.graphics.drawable;

import android.content.Context;

public class Icon {
  public int resource;

  public static Icon createWithResource(Context context, int resource) {
    Icon icon = new Icon();
    icon.resource = resource;
    return icon;
  }
}
