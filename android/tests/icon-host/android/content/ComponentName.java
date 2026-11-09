package android.content;

public final class ComponentName {
  public final String name;

  public ComponentName(Context context, String name) {
    this.name = name;
  }

  public ComponentName(Context context, Class<?> type) {
    this(context, type.getName());
  }

  public String getClassName() {
    return name;
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof ComponentName && name.equals(((ComponentName) other).name);
  }

  @Override
  public int hashCode() {
    return name.hashCode();
  }
}
