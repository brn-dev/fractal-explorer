package org.fractalexplorer.wallpaper;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Random;

/** Per-screen reveal coordination: lock/home engines must share one choice for the same arrival. */
final class ShufflePolicy {
  private final java.util.Map<String, Choice> choices = new java.util.HashMap<>();

  private static final class Choice {
    long event, time;
    String id, pool;
  }

  static String pick(Collection<String> candidates, String current, Random random) {
    List<String> available = new ArrayList<>(candidates);
    java.util.Collections.sort(available);
    if (available.size() > 1) available.remove(current);
    return available.isEmpty() ? null : available.get(random.nextInt(available.size()));
  }

  String recent(String screen, String pool, String active, long event, long now) {
    Choice choice = choices.get(screen);
    return choice != null
            && choice.event == event
            && choice.pool.equals(pool)
            && choice.id.equals(active)
            && Math.abs(now - choice.time) < 2000
        ? choice.id
        : null;
  }

  void remember(String screen, String pool, String id, long event, long now) {
    Choice choice = new Choice();
    choice.pool = pool;
    choice.id = id;
    choice.event = event;
    choice.time = now;
    choices.put(screen, choice);
  }

  void reset(String screen) {
    choices.remove(screen);
  }
}
