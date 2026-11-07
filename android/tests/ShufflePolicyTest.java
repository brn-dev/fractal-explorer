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
