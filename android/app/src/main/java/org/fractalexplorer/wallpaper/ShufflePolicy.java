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

  static final class Rule {
    final double weight;
    final String period;

    Rule(double weight, String period) {
      if (!Double.isFinite(weight) || weight < 0.1 || weight > 100)
        throw new IllegalArgumentException("Choose a weight between 0.1 and 100");
      if (!"any".equals(period) && !"day".equals(period) && !"night".equals(period))
        throw new IllegalArgumentException("Choose Any time, Daytime or Nighttime");
      this.weight = weight;
      this.period = period;
    }

    boolean eligible(boolean daytime) {
      return "any".equals(period) || (daytime ? "day" : "night").equals(period);
    }
  }

  static String weightedPick(
      java.util.Map<String, Double> candidates, String current, Random random) {
    if (candidates.isEmpty()) return null;
    List<String> ids = new ArrayList<>(candidates.keySet());
    java.util.Collections.sort(ids);
    double first = candidates.get(ids.get(0)), total = 0;
    boolean equal = true;
    for (String id : ids) {
      double weight = candidates.get(id);
      new Rule(weight, "any");
      equal &= weight == first;
      total += weight;
    }
    // Preserve existing behavior at equal odds. With unequal odds, excluding the
    // current item would destroy the requested ratios (two entries would alternate).
    if (equal) return pick(ids, current, random);
    double choice = random.nextDouble() * total;
    for (String id : ids) {
      choice -= candidates.get(id);
      if (choice < 0) return id;
    }
    return ids.get(ids.size() - 1);
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
