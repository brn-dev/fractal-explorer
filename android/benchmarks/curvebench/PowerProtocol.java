package org.fractalexplorer.curvebench;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

/** Fixed in advance: no outcome-dependent stopping, retrying or order changes. */
public final class PowerProtocol {
  public static final int QUARTETS = 8;
  public static final int SETTLE_MS = 15000;
  public static final int MEASURE_MS = 30000;
  public static final int CALIBRATION_MS = 60000;
  public static final int[][] COMPARISONS = {{2, 4}, {2, 3}, {1, 2}, {1, 0}};
  public static final String[] LABELS = {
    "Cached GPU vs Tone + RGB curves", "Cached GPU vs brightness curve",
    "Current GPU vs cached GPU", "Current GPU vs direct decoder"
  };

  public static final class Trial {
    public final int profile, mode, quartet, slot;
    public final boolean calibration, treatment, bInside;

    Trial(
        int profile,
        int mode,
        int quartet,
        int slot,
        boolean calibration,
        boolean treatment,
        boolean bInside) {
      this.profile = profile;
      this.mode = mode;
      this.quartet = quartet;
      this.slot = slot;
      this.calibration = calibration;
      this.treatment = treatment;
      this.bInside = bInside;
    }
  }

  public static List<Trial> plan(int[] profiles, int comparison, long seed) {
    if (comparison < 0 || comparison >= COMPARISONS.length)
      throw new IllegalArgumentException("Unknown comparison");
    if (profiles == null
        || profiles.length == 0
        || profiles.length > 2
        || (profiles.length == 2 && profiles[0] == profiles[1]))
      throw new IllegalArgumentException("Choose distinct target profiles");
    Random random = new Random(seed);
    List<Trial> result = new ArrayList<>();
    int a = COMPARISONS[comparison][0], b = COMPARISONS[comparison][1];
    for (int profile : profiles) {
      if (profile != 0 && profile != 1) throw new IllegalArgumentException("Unknown profile");
      result.add(new Trial(profile, a, -1, 0, true, false, false));
      List<Boolean> orientation = new ArrayList<>();
      for (int i = 0; i < QUARTETS; i++) orientation.add(i < QUARTETS / 2);
      Collections.shuffle(orientation, random);
      for (int q = 0; q < QUARTETS; q++)
        for (int slot = 0; slot < 4; slot++) {
          boolean inside = slot == 1 || slot == 2, treatment = inside == orientation.get(q);
          result.add(
              new Trial(profile, treatment ? b : a, q, slot, false, treatment, orientation.get(q)));
        }
    }
    return Collections.unmodifiableList(result);
  }

  public static long estimatedMs(int profiles) {
    return profiles
        * ((long) (SETTLE_MS + CALIBRATION_MS) + QUARTETS * 4L * (SETTLE_MS + MEASURE_MS));
  }
}
