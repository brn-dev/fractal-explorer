package org.fractalexplorer.curvebench;

import java.util.Arrays;
import java.util.Collections;

public final class BenchMathTest {
  private static int checks;

  private static void check(boolean ok) {
    checks++;
    if (!ok) throw new AssertionError("check " + checks);
  }

  public static void main(String[] args) {
    check(Double.isNaN(BenchMath.percentile(Collections.emptyList(), .5)));
    check(BenchMath.percentile(Arrays.asList(4d, 1d, 3d, 2d), .5) == 2.5);
    check(Math.abs(BenchMath.percentile(Arrays.asList(4d, 1d, 3d, 2d), .95) - 3.85) < 1e-9);
    check(BenchMath.dischargeMilliwatts(-200000, 4000, false) == 800);
    for (long value : new long[] {0, 200000, Long.MIN_VALUE, Integer.MIN_VALUE})
      check(Double.isNaN(BenchMath.dischargeMilliwatts(value, 4000, false)));
    check(Double.isNaN(BenchMath.dischargeMilliwatts(-200000, 4000, true)));
    check(Double.isNaN(BenchMath.dischargeMilliwatts(-200000, 0, false)));
    int[] order = BenchMath.order();
    for (int mode = 0; mode < 5; mode++) {
      int count = 0, sum = 0;
      for (int i = 0; i < order.length; i++)
        if (order[i] == mode) {
          count++;
          sum += i;
        }
      check(count == 2);
      check(sum == 9);
    }
    byte[] lut = BenchMath.identityLut();
    for (int i = 0; i < 256; i++) {
      for (int c = 0; c < 4; c++) check((lut[4 * i + c] & 255) == i);
      check(Math.abs(BenchMath.lutCoordinate(i / 255f) - (i + .5) / 256d) < 1e-7);
    }
    System.out.println(
        "PASS "
            + checks
            + " benchmark statistics, unavailable power sensors, counterbalancing and LUT checks.");
  }
}
