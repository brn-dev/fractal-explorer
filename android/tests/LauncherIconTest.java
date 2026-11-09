package org.fractalexplorer.wallpaper;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.os.Build;
import android.os.Handler;
import java.io.File;
import java.lang.reflect.Field;
import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/** Production controller with explicit Android IPC/clock fixtures, never included in the APK. */
public final class LauncherIconTest {
  private static int checks;
  private static final String NS = "http://schemas.android.com/apk/res/android";

  private static void check(boolean value, String message) {
    checks++;
    if (!value) throw new AssertionError(message);
  }

  private static long time(String date, String hour) {
    return LocalDateTime.parse(date + "T" + hour).atZone(ViennaSun.ZONE).toInstant().toEpochMilli();
  }

  private static final class Queue implements Executor {
    final ArrayDeque<Runnable> tasks = new ArrayDeque<>();

    public void execute(Runnable task) {
      tasks.add(task);
    }

    void drain() {
      while (!tasks.isEmpty()) tasks.remove().run();
    }
  }

  private static final class Fixture {
    final Context context = new Context();
    final AlarmManager alarm = new AlarmManager();
    final ShortcutManager shortcuts = new ShortcutManager();
    final LauncherIcon icon;
    final Handler handler;

    Fixture() {
      this(Runnable::run);
    }

    Fixture(Executor executor) {
      context.services.put(AlarmManager.class, alarm);
      context.services.put(ShortcutManager.class, shortcuts);
      icon = new LauncherIcon(context, executor);
      handler = Handler.all.get(Handler.all.size() - 1);
    }

    boolean enabled(String alias) {
      int state =
          context.pm.getComponentEnabledSetting(
              new ComponentName(context, context.getPackageName() + "." + alias));
      return state == 0 ? alias.equals("DayLauncher") : state == 1;
    }

    void expect(boolean day) {
      check(
          enabled("DayLauncher") == day && enabled("NightLauncher") != day,
          "exactly one correct launcher");
    }

    void pin(boolean day) {
      shortcuts.pinned.add(
          new ShortcutInfo.Builder(context, LauncherIcon.SHORTCUT_ID)
              .setLongLabel("Fractal Explorer · " + (day ? "Daytime" : "Nighttime"))
              .build());
    }
  }

  private static void boundaries() {
    for (int sdk : new int[] {30, 32, 33, 36}) {
      Build.VERSION.SDK_INT = sdk;
      for (String date :
          new String[] {
            "2026-01-01", "2026-03-29", "2026-06-21", "2026-10-25", "2026-12-31", "2027-01-01"
          }) {
        Fixture f = new Fixture();
        ViennaSun sun = ViennaSun.at(time(date, "12:00"));
        long[] events = {sun.sunrise - 1, sun.sunrise, sun.sunset - 1, sun.sunset};
        for (int i = 0; i < events.length; i++) {
          f.icon.refreshAt(events[i], false);
          f.expect(i == 1 || i == 2);
          check(f.alarm.type == AlarmManager.RTC, "alarm never wakes the CPU");
          check(
              f.alarm.at == sun.next(events[i]) && f.handler.delay > 0,
              "same next solar boundary as shuffle");
          check(
              f.alarm.intent.intent.action.equals(LauncherIcon.ALARM_ACTION),
              "explicit boundary alarm action");
          check(
              f.alarm.intent.intent.component.name.endsWith(".IconModeReceiver"),
              "alarm stays in our package");
          check((f.alarm.intent.flags & PendingIntent.FLAG_IMMUTABLE) != 0, "immutable callback");
        }
      }
    }
    Build.VERSION.SDK_INT = 36;
  }

  private static void idempotenceAndClockChanges() {
    Fixture f = new Fixture();
    long day = time("2026-06-21", "12:00"), night = time("2026-06-21", "23:00");
    f.pin(true);
    f.icon.refreshAt(day, false);
    f.expect(true);
    check(f.context.pm.calls.isEmpty(), "default daytime needs no component broadcast");
    for (int i = 0; i < 100; i++) f.icon.refreshAt(day + i * 1000, false);
    check(f.alarm.calls == 1 && f.handler.posts == 1, "no timer polling or repeated alarm writes");
    check(f.shortcuts.updates == 0, "no unchanged pinned-icon writes");
    f.icon.refreshAt(night, false);
    f.expect(false);
    check(
        f.context.pm.calls.size() == 1 && f.context.pm.calls.get(0).equals("atomic"),
        "modern Android changes both aliases atomically");
    check(f.shortcuts.updates == 1, "night pin changes exactly once");
    for (int i = 0; i < 30; i++) f.icon.refreshAt(night + i * 1000, true);
    check(
        f.context.pm.calls.size() == 1 && f.shortcuts.updates == 1,
        "waking/unlocking does not flood launcher changes");
    f.icon.refreshAt(day, true);
    f.expect(true);
    check(f.alarm.at == ViennaSun.at(day).sunset, "backward clock change restores today boundary");
    f.icon.refreshAt(time("2027-01-02", "01:00"), true);
    f.expect(false);
    check(
        f.alarm.at == ViennaSun.at(time("2027-01-02", "01:00")).sunrise,
        "forward date change uses new solar date");
  }

  private static void failures() {
    long night = time("2026-06-21", "23:00");
    Build.VERSION.SDK_INT = 30;
    Fixture f = new Fixture();
    f.context.pm.failEnable = true;
    f.icon.refreshAt(night, false);
    f.expect(true);
    check(
        f.context.pm.calls.size() == 1 && f.context.pm.calls.get(0).endsWith(".NightLauncher=1"),
        "failure enabling replacement leaves old launcher alive");
    f.context.pm.failEnable = false;
    f.context.pm.failDisable = true;
    f.icon.refreshAt(night, false);
    check(
        f.enabled("DayLauncher") && f.enabled("NightLauncher"),
        "disable failure keeps an accessible icon");
    f.context.pm.failDisable = false;
    f.icon.refreshAt(night, false);
    f.expect(false);
    Build.VERSION.SDK_INT = 36;
    f = new Fixture();
    f.context.pm.failBatch = true;
    f.icon.refreshAt(night, false);
    f.expect(true);
    f.context.pm.failBatch = false;
    f.icon.refreshAt(night, false);
    f.expect(false);
    f = new Fixture();
    f.pin(true);
    f.shortcuts.locked = true;
    f.icon.refreshAt(night, false);
    f.expect(false);
    f.shortcuts.locked = false;
    f.shortcuts.updateOK = false;
    f.icon.refreshAt(night, false);
    check(
        f.shortcuts.pinned.get(0).longLabel.endsWith("Daytime"),
        "failed shortcut write does not claim success");
    f.shortcuts.updateOK = true;
    f.icon.refreshAt(night, false);
    check(
        f.shortcuts.pinned.get(0).longLabel.endsWith("Nighttime"),
        "unlock/rate limit recovery retries without losing pin");
    f = new Fixture();
    f.alarm.fail = true;
    f.icon.refreshAt(night, false);
    f.expect(false);
    check(f.handler.callback != null, "in-process boundary works even if alarm service fails");
    f.alarm.fail = false;
    f.icon.refreshAt(night, true);
    check(f.alarm.at > night, "wake retries alarm scheduling");
    f = new Fixture();
    f.context.failReceiver = true;
    f.icon.start();
    check(f.alarm.calls == 1, "receiver failure does not block initialization");
    f = new Fixture();
    f.icon.start();
    f.icon.start();
    check(f.context.registrations == 1, "one app-scoped wake listener");
    check(
        f.context.receiverFlags == Context.RECEIVER_NOT_EXPORTED,
        "runtime receiver is private on modern Android");
  }

  private static void pins() {
    Fixture f = new Fixture();
    List<String> messages = new ArrayList<>();
    f.icon.pinHomeIcon(messages::add);
    ShortcutInfo info = f.shortcuts.requested;
    check(info.id.equals(LauncherIcon.SHORTCUT_ID), "stable shortcut identity");
    check(
        info.intent.component.name.endsWith(".MainActivity"),
        "pin always launches the activity that stays enabled");
    check(info.intent.action.equals(Intent.ACTION_MAIN), "valid shortcut intent action");
    check(
        f.shortcuts.callback.intent.action.equals(LauncherIcon.PIN_ACTION),
        "accepted pin refreshes mode, even across sunset");
    check(
        info.icon.resource == R.mipmap.launcher_day
            || info.icon.resource == R.mipmap.launcher_night,
        "uses actual icon resources");
    check(
        f.shortcuts.pinned.isEmpty(),
        "requesting pin does not assume launcher approval or publish a dynamic shortcut");
    check(messages.get(0).startsWith("Confirm Add"), "reports pending launcher confirmation");
    f.shortcuts.requestOK = false;
    f.icon.pinHomeIcon(messages::add);
    check(messages.get(1).contains("could not"), "rejected pin not reported successful");
    f = new Fixture();
    f.shortcuts.supported = false;
    f.icon.pinHomeIcon(messages::add);
    check(f.shortcuts.requested == null, "unsupported launcher has no pin attempt");
    f = new Fixture();
    f.shortcuts.locked = true;
    f.icon.pinHomeIcon(messages::add);
    check(messages.get(messages.size() - 1).contains("try again"), "locked request is recoverable");
  }

  private static void receiverLifetime() throws Exception {
    Queue queue = new Queue();
    Fixture f = new Fixture(queue);
    Field instance = LauncherIcon.class.getDeclaredField("instance");
    instance.setAccessible(true);
    instance.set(null, f.icon);
    IconModeReceiver a = new IconModeReceiver(), b = new IconModeReceiver();
    a.onReceive(f.context, new Intent(LauncherIcon.ALARM_ACTION));
    b.onReceive(f.context, new Intent(LauncherIcon.PIN_ACTION));
    check(
        a.pending.finishes == 0 && b.pending.finishes == 0,
        "broadcast holds process during background IPC");
    queue.drain();
    check(
        a.pending.finishes == 1 && b.pending.finishes == 1,
        "stale and current broadcasts both finish exactly once");
    check(f.context.pm.calls.size() <= 1, "stale requests cannot apply a superseded mode");
    f.context.pm.failBatch = true;
    f.context.pm.states.put(
        new ComponentName(f.context, f.context.getPackageName() + ".DayLauncher"), 2);
    f.context.pm.states.put(
        new ComponentName(f.context, f.context.getPackageName() + ".NightLauncher"), 2);
    IconModeReceiver failed = new IconModeReceiver();
    failed.onReceive(f.context, new Intent(LauncherIcon.ALARM_ACTION));
    queue.drain();
    check(failed.pending.finishes == 1, "failed PM operation also finishes broadcast");
    instance.set(null, null);
  }

  private static Element xml(File path) throws Exception {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setNamespaceAware(true);
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    return factory.newDocumentBuilder().parse(path).getDocumentElement();
  }

  private static String attr(Element element, String key) {
    return element.getAttributeNS(NS, key);
  }

  private static void manifest(File root) throws Exception {
    Element manifest = xml(new File(root, "AndroidManifest.xml"));
    Element app = (Element) manifest.getElementsByTagName("application").item(0);
    check(
        attr(app, "name").equals(".FractalApplication"),
        "all process entry points initialize icon clock");
    NodeList activities = app.getElementsByTagName("activity");
    Element main = null;
    for (int i = 0; i < activities.getLength(); i++) {
      Element activity = (Element) activities.item(i);
      if (attr(activity, "name").equals(".MainActivity")) main = activity;
    }
    check(
        main != null && !attr(main, "enabled").equals("false"),
        "legacy explicit MainActivity shortcuts stay launchable");
    check(
        main.getElementsByTagName("intent-filter").getLength() == 0,
        "legacy activity does not add a duplicate launcher icon");
    NodeList aliases = app.getElementsByTagName("activity-alias");
    check(aliases.getLength() == 2, "exactly two launcher aliases");
    for (int i = 0; i < aliases.getLength(); i++) {
      Element alias = (Element) aliases.item(i);
      boolean day = attr(alias, "name").equals(".DayLauncher");
      check(day || attr(alias, "name").equals(".NightLauncher"), "known alias name");
      check(
          attr(alias, "enabled").equals(day ? "true" : "false"),
          "only day alias enabled at install");
      check(
          attr(alias, "targetActivity").equals(".MainActivity")
              && attr(alias, "exported").equals("true"),
          "aliases launch unchanged app");
      check(
          (main.compareDocumentPosition(alias) & org.w3c.dom.Node.DOCUMENT_POSITION_FOLLOWING) != 0,
          "target declared before alias");
      check(
          attr((Element) alias.getElementsByTagName("action").item(0), "name")
              .equals(Intent.ACTION_MAIN),
          "alias is a launcher main entry");
      check(
          attr((Element) alias.getElementsByTagName("category").item(0), "name")
              .equals("android.intent.category.LAUNCHER"),
          "alias is visible to launchers");
      for (String layer : new String[] {"foreground", "monochrome"}) {
        Element adaptive =
            xml(
                new File(
                    root,
                    "res/mipmap-anydpi-"
                        + (layer.equals("foreground") ? "v26" : "v33")
                        + "/launcher_"
                        + (day ? "day" : "night")
                        + ".xml"));
        String res = attr((Element) adaptive.getElementsByTagName(layer).item(0), "drawable");
        check(
            new File(root, "res/" + res.substring(1) + ".xml").isFile(),
            "colored and themed glyph exist");
      }
    }
    Element receiver = (Element) app.getElementsByTagName("receiver").item(0);
    check(
        attr(receiver, "name").equals(".IconModeReceiver")
            && attr(receiver, "exported").equals("false"),
        "private manifest receiver");
    NodeList permissions = manifest.getElementsByTagName("uses-permission");
    for (int i = 0; i < permissions.getLength(); i++)
      check(
          !attr((Element) permissions.item(i), "name").contains("EXACT_ALARM"),
          "no exact alarm permission");
  }

  private static double brightness(String hex) {
    return .2126 * Integer.parseInt(hex.substring(1, 3), 16)
        + .7152 * Integer.parseInt(hex.substring(3, 5), 16)
        + .0722 * Integer.parseInt(hex.substring(5, 7), 16);
  }

  private static void artwork(File root) throws Exception {
    Element day = xml(new File(root, "res/drawable/launcher_day_foreground.xml"));
    Element night = xml(new File(root, "res/drawable/launcher_night_foreground.xml"));
    NodeList dayPaths = day.getElementsByTagName("path"),
        nightPaths = night.getElementsByTagName("path");
    check(
        dayPaths.getLength() == 4 && nightPaths.getLength() == 4,
        "four prebuilt fractal contour layers");
    for (int i = 0; i < dayPaths.getLength(); i++) {
      Element a = (Element) dayPaths.item(i), b = (Element) nightPaths.item(i);
      String shape = attr(a, "pathData");
      check(shape.equals(attr(b, "pathData")), "mode recolors the same fractal geometry");
      check(
          brightness(attr(a, "fillColor")) > brightness(attr(b, "fillColor")),
          "night palette is darker on every layer");
      check(
          shape.length() > 500 && shape.length() < 30000 && !shape.contains("NaN"),
          "finite fractal contour within Android string limits");
      java.util.regex.Matcher numbers =
          java.util.regex.Pattern.compile("-?\\d+(?:\\.\\d+)?").matcher(shape);
      double maxRadius = 0;
      int count = 0;
      while (numbers.find()) {
        double x = Double.parseDouble(numbers.group());
        check(numbers.find(), "paired path coordinates");
        double y = Double.parseDouble(numbers.group());
        maxRadius = Math.max(maxRadius, Math.hypot(x - 54, y - 54));
        count++;
      }
      check(count > 30 && maxRadius < 31.1, "artwork stays inside adaptive circular safe zone");
    }
    String dayMono =
        attr(
            (Element)
                xml(new File(root, "res/mipmap-anydpi-v33/launcher_day.xml"))
                    .getElementsByTagName("monochrome")
                    .item(0),
            "drawable");
    String nightMono =
        attr(
            (Element)
                xml(new File(root, "res/mipmap-anydpi-v33/launcher_night.xml"))
                    .getElementsByTagName("monochrome")
                    .item(0),
            "drawable");
    check(dayMono.equals(nightMono), "themed geometry is shared; system owns its colors");
  }

  public static void main(String[] args) throws Exception {
    boundaries();
    idempotenceAndClockChanges();
    failures();
    pins();
    receiverLifetime();
    manifest(new File(args[0]));
    artwork(new File(args[0]));
    System.out.println(
        "Launcher icon: " + checks + " checks passed (explicit Android platform fixtures).");
  }
}
