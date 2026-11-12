package org.fractalexplorer.curvebench;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Keep unavailable/noisy power data distinct from measured GPU service times. */
public final class BenchMath {
  private BenchMath() {}

  public static double percentile(List<Double> values, double fraction) {
    if (values.isEmpty()) return Double.NaN;
    List<Double> sorted = new ArrayList<>(values);
    Collections.sort(sorted);
    double position = (sorted.size() - 1) * fraction;
    int low = (int) position, high = Math.min(low + 1, sorted.size() - 1);
    return sorted.get(low) + (sorted.get(high) - sorted.get(low)) * (position - low);
  }

  public static double dischargeMilliwatts(long currentMicroamps, int millivolts, boolean plugged) {
    if (plugged
        || currentMicroamps == Long.MIN_VALUE
        || currentMicroamps == Integer.MIN_VALUE
        || currentMicroamps >= 0
        || millivolts < 2000
        || millivolts > 6000) return Double.NaN;
    return -currentMicroamps * (double) millivolts / 1_000_000;
  }

  public static int[] order() {
    return new int[] {0, 1, 2, 3, 4, 4, 3, 2, 1, 0};
  }

  // Curve samples use exact texel-center coordinates, with linear interpolation.
  public static float lutCoordinate(float input) {
    return (input * 255 + .5f) / 256;
  }

  public static byte[] identityLut() {
    byte[] bytes = new byte[256 * 4];
    for (int i = 0; i < 256; i++) for (int c = 0; c < 4; c++) bytes[4 * i + c] = (byte) i;
    return bytes;
  }
}
