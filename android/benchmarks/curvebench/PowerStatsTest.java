package org.fractalexplorer.curvebench;

import java.util.ArrayList;
import java.util.List;

public final class PowerStatsTest {
  private static int cases;

  private static void check(boolean value, String reason) {
    cases++;
    if (!value) throw new AssertionError(reason);
  }

  private static void close(double actual, double expected, double tolerance, String reason) {
    check(Math.abs(actual - expected) <= tolerance, reason + ": " + actual + " != " + expected);
  }

  public static void main(String[] args) {
    List<PowerProtocol.Trial> plan = PowerProtocol.plan(new int[] {0, 1}, 0, 9123);
    check(plan.size() == 66, "Each profile has calibration and 32 blocks");
    for (int profile = 0; profile < 2; profile++) {
      int orientation = 0;
      for (int q = 0; q < 8; q++) {
        int offset = profile * 33 + 1 + q * 4;
        PowerProtocol.Trial first = plan.get(offset);
        if (first.bInside) orientation++;
        check(
            plan.get(offset).mode == plan.get(offset + 3).mode
                && plan.get(offset + 1).mode == plan.get(offset + 2).mode
                && plan.get(offset).mode != plan.get(offset + 1).mode,
            "ABBA or BAAB only");
        for (int slot = 0; slot < 4; slot++)
          check(
              plan.get(offset + slot).slot == slot && plan.get(offset + slot).quartet == q,
              "Preassigned slot");
      }
      check(orientation == 4, "Exactly four ABBA and four BAAB per profile");
    }
    check(PowerProtocol.estimatedMs(1) == 1515000, "25 minute 15 second predetermined duration");
    check(
        PowerProtocol.plan(new int[] {0}, 0, 9123).get(1).mode == plan.get(1).mode, "Seed replay");
    List<PowerStats.Sample> constant = new ArrayList<>();
    for (int t = 0; t <= 30000; t += 1000) constant.add(new PowerStats.Sample(t, 2000));
    PowerStats.Block b = PowerStats.block(constant, 0, 30000);
    close(b.raw, 2000, 1e-9, "Constant whole-phone power");
    close(b.adjusted, 2000, 1e-9, "Identity adjustment");
    close(b.coverage, 1, 1e-9, "Complete time coverage");
    close(b.centerMs, 15000, 1e-9, "Observation centroid");
    List<PowerStats.Sample> linear = new ArrayList<>();
    for (int t : new int[] {0, 250, 1500, 3000, 4200, 5000})
      linear.add(new PowerStats.Sample(t, 1000 + t * .02));
    close(
        PowerStats.block(linear, 0, 5000).raw,
        1050,
        1e-9,
        "Time-weighted integral with irregular readings");
    List<PowerStats.Sample> spike = new ArrayList<>();
    for (int t = 0; t <= 30000; t += 1000)
      spike.add(new PowerStats.Sample(t, t >= 10000 && t < 15000 ? 6000 : 2000));
    b = PowerStats.block(spike, 0, 30000);
    check(
        b.raw > 2500 && b.adjusted < 2200,
        "Transient influence is limited separately from raw energy");
    check(b.flaggedWindows > 0, "Spikes remain flagged");
    List<PowerStats.Sample> gap = new ArrayList<>();
    for (int t = 0; t <= 30000; t += 1000)
      if (t < 10000 || t > 20000) gap.add(new PowerStats.Sample(t, 2000));
    b = PowerStats.block(gap, 0, 30000);
    check(b.coverage < .7, "No invented data over long gaps");
    List<PowerStats.Sample> bad = new ArrayList<>(constant);
    bad.add(5, new PowerStats.Sample(4000, 3000));
    bad.add(6, new PowerStats.Sample(2000, 2000));
    b = PowerStats.block(bad, 0, 30000);
    check(b.conflictingDuplicates == 1 && b.outOfOrder == 1, "Sensor time conflicts are explicit");
    double[] time = {0, 50, 130, 200}, power = {2000, 2130, 2210, 2200};
    close(
        PowerStats.contrast(power, time, true), 80, 1e-9, "Actual-time ABBA cancels linear drift");
    check(
        Math.abs(PowerStats.plainContrast(power, true) - 80) > 1,
        "Uncorrected estimate exposes unequal timing drift");
    // Exact finite-population null and interval coverage, not a mirrored implementation.
    for (double tau : new double[] {0, 80, -30}) {
      double[] nuisance = {-50, 8, 25, -17, 60, -12, 9, 180};
      int rejected = 0, missed = 0, total = 0;
      for (int assignment = 0; assignment < 256; assignment++)
        if (Integer.bitCount(assignment) == 4) {
          boolean[] inside = new boolean[8];
          double[] effects = new double[8];
          for (int i = 0; i < 8; i++) {
            inside[i] = ((assignment >> i) & 1) == 1;
            effects[i] = tau + (inside[i] ? 1 : -1) * nuisance[i];
          }
          PowerStats.Inference inf = PowerStats.infer(effects, inside);
          check(inf.assignments == 70, "All allowed balanced assignments");
          if (tau == 0 && inf.pValue <= .05) rejected++;
          if (inf.lower > tau + 1e-7 || inf.upper < tau - 1e-7) missed++;
          total++;
        }
      check(rejected <= 3, "False positives bounded under the randomized null");
      check(missed <= 3 && total == 70, "At least 95% interval coverage under the additive model");
    }
    boolean[] inside = {true, true, true, true, false, false, false, false};
    double[] effect = {80, 80, 80, 80, 80, 80, 80, 80};
    PowerStats.Inference inf = PowerStats.infer(effect, inside);
    close(inf.estimate, 80, 1e-9, "Known treatment effect");
    check(inf.lower > 0 && inf.pValue <= .05, "Repeated positive effect resolved");
    try {
      PowerStats.infer(new double[] {1, 2}, new boolean[] {true, false});
      throw new AssertionError("Partial data must not infer");
    } catch (IllegalArgumentException expected) {
      cases++;
    }
    System.out.println(
        "PASS "
            + cases
            + " randomized design, irregular integration, spikes, gaps, drift and"
            + " exact-randomization coverage checks.");
  }
}
