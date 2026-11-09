package android.content.pm;

import android.content.ComponentName;
import java.util.*;

public class PackageManager {
  public static final int COMPONENT_ENABLED_STATE_DEFAULT = 0,
      COMPONENT_ENABLED_STATE_ENABLED = 1,
      COMPONENT_ENABLED_STATE_DISABLED = 2,
      DONT_KILL_APP = 1;
  public final Map<ComponentName, Integer> states = new HashMap<>();
  public final List<String> calls = new ArrayList<>();
  public boolean failBatch, failEnable, failDisable;

  public int getComponentEnabledSetting(ComponentName component) {
    return states.getOrDefault(component, 0);
  }

  private void check(ComponentName component, int flags) {
    if (!component.name.endsWith(".DayLauncher") && !component.name.endsWith(".NightLauncher"))
      throw new AssertionError("Changed a real activity: " + component.name);
    if (flags != DONT_KILL_APP) throw new AssertionError("Would kill wallpaper app");
  }

  public void setComponentEnabledSetting(ComponentName component, int state, int flags) {
    check(component, flags);
    calls.add(component.name + "=" + state);
    if ((state == 1 && failEnable) || (state == 2 && failDisable))
      throw new IllegalStateException("PM failed");
    states.put(component, state);
  }

  public void setComponentEnabledSettings(List<ComponentEnabledSetting> settings) {
    calls.add("atomic");
    if (failBatch) throw new IllegalStateException("batch failed");
    if (settings.size() != 2 || settings.get(0).component.equals(settings.get(1).component))
      throw new AssertionError("Non-atomic pair");
    for (ComponentEnabledSetting setting : settings) check(setting.component, setting.flags);
    for (ComponentEnabledSetting setting : settings) states.put(setting.component, setting.state);
  }

  public static class ComponentEnabledSetting {
    public final ComponentName component;
    public final int state, flags;

    public ComponentEnabledSetting(ComponentName component, int state, int flags) {
      this.component = component;
      this.state = state;
      this.flags = flags;
    }
  }
}
