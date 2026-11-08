package org.fractalexplorer.wallpaper;

import java.util.Arrays;
import java.util.Collections;
import java.util.Random;

public final class ShufflePolicyTest {
  static void require(boolean value) {
    if (!value) throw new AssertionError();
  }

  public static void main(String[] args) {
    Random random = new Random(321);
    require(ShufflePolicy.pick(Collections.emptyList(), "a", random) == null);
    require(ShufflePolicy.pick(Collections.singleton("a"), "a", random).equals("a"));
    int b = 0, c = 0;
    for (int i = 0; i < 10000; i++) {
      String selected = ShufflePolicy.pick(Arrays.asList("a", "b", "c"), "a", random);
      require(!selected.equals("a"));
      if (selected.equals("b")) b++;
      else c++;
    }
    require(b > 4500 && c > 4500);
    ShufflePolicy policy = new ShufflePolicy();
    java.util.Map<String, Double> weighted = new java.util.HashMap<>();
    weighted.put("a", 5.0);
    weighted.put("b", 1.0);
    int heavy = 0;
    random = new Random(321);
    for (int i = 0; i < 30000; i++)
      if (ShufflePolicy.weightedPick(weighted, "a", random).equals("a")) heavy++;
    require(
        heavy > 24500
            && heavy
                < 25500); // Weight 5 actually gets five times the odds, even with only two designs.
    weighted.put("a", 1.0);
    for (int i = 0; i < 100; i++)
      require(ShufflePolicy.weightedPick(weighted, "a", random).equals("b"));
    require(ShufflePolicy.weightedPick(Collections.emptyMap(), "a", random) == null);
    for (double invalid :
        new double[] {0, -1, Double.NaN, Double.POSITIVE_INFINITY, .099, 100.01}) {
      boolean rejected = false;
      try {
        new ShufflePolicy.Rule(invalid, "any");
      } catch (IllegalArgumentException expected) {
        rejected = true;
      }
      require(rejected);
    }
    require(new ShufflePolicy.Rule(1, "day").eligible(true));
    require(!new ShufflePolicy.Rule(1, "day").eligible(false));
    require(new ShufflePolicy.Rule(1, "night").eligible(false));
    require(!new ShufflePolicy.Rule(1, "night").eligible(true));
    require(new ShufflePolicy.Rule(.1, "any").eligible(false));
    policy.remember("cover", "[a, b]", "b", 1, 100);
    require(policy.recent("cover", "[a, b]", "b", 1, 200).equals("b"));
    require(policy.recent("inner", "[a, b]", "b", 1, 200) == null);
    require(policy.recent("cover", "[a, b]", "b", 2, 200) == null);
    require(policy.recent("cover", "[a, c]", "b", 1, 200) == null);
    require(policy.recent("cover", "[a, b]", "a", 1, 200) == null);
    require(
        policy
            .recent("cover", "[a, b]", "b", 1, 99)
            .equals("b")); // render threads can run out of order
    require(policy.recent("cover", "[a, b]", "b", 1, 2100) == null);
    policy.reset("cover");
    require(policy.recent("cover", "[a, b]", "b", 1, 200) == null);
    System.out.println(
        "Shuffle selection, no repeats, distribution, and per-screen reveal coalescing passed.");
  }
}
