package org.fractalexplorer.curvebench;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Deterministic analysis; inference uses whole randomized quartets, never 1 Hz readings as n. */
public final class PowerStats {
  public static final double ALPHA = .05;
  public static final double WINDOW_MS = 5000,
      MAX_GAP_MS = 2500,
      SCALE_FLOOR_MW = 20,
      MAD_MULTIPLIER = 1.4826,
      OUTLIER_Z = 3.5;

  public static final class Sample {
    public final double timeMs, powerMw;

    public Sample(double timeMs, double powerMw) {
      this.timeMs = timeMs;
      this.powerMw = powerMw;
    }
  }

  public static final class Block {
    public double raw = Double.NaN,
        adjusted = Double.NaN,
        centerMs = Double.NaN,
        coverage,
        flaggedFraction;
    public int validSamples,
        invalidSamples,
        duplicates,
        outOfOrder,
        conflictingDuplicates,
        flaggedWindows;
    public final List<Double> windows = new ArrayList<>(), weights = new ArrayList<>();
    public double lowerFence = Double.NaN, upperFence = Double.NaN;
  }

  public static Block block(List<Sample> input, double start, double end) {
    if (!Double.isFinite(start) || !Double.isFinite(end) || end <= start)
      throw new IllegalArgumentException("Invalid measurement bounds");
    Block result = new Block();
    List<Sample> samples = new ArrayList<>();
    for (Sample s : input) {
      if (!Double.isFinite(s.timeMs)) {
        result.invalidSamples++;
        continue;
      }
      if (!samples.isEmpty()) {
        Sample previous = samples.get(samples.size() - 1);
        if (s.timeMs < previous.timeMs) {
          result.outOfOrder++;
          continue;
        }
        if (s.timeMs == previous.timeMs) {
          result.duplicates++;
          if (Double.compare(s.powerMw, previous.powerMw) != 0) result.conflictingDuplicates++;
          continue;
        }
      }
      samples.add(s);
      if (s.timeMs >= start && s.timeMs <= end) {
        if (Double.isFinite(s.powerMw)) result.validSamples++;
        else result.invalidSamples++;
      }
    }
    int count = (int) Math.ceil((end - start) / WINDOW_MS);
    double[] areas = new double[count], covered = new double[count];
    double timeArea = 0, totalArea = 0, totalCovered = 0;
    for (int i = 1; i < samples.size(); i++) {
      Sample a = samples.get(i - 1), b = samples.get(i);
      if (!Double.isFinite(a.powerMw)
          || !Double.isFinite(b.powerMw)
          || b.timeMs - a.timeMs > MAX_GAP_MS) continue;
      double low = Math.max(start, a.timeMs), high = Math.min(end, b.timeMs);
      while (low < high) {
        int bin = Math.min(count - 1, (int) ((low - start) / WINDOW_MS));
        double stop = Math.min(high, start + (bin + 1) * WINDOW_MS), dt = stop - low;
        double left =
            a.powerMw + (b.powerMw - a.powerMw) * (low - a.timeMs) / (b.timeMs - a.timeMs);
        double right =
            a.powerMw + (b.powerMw - a.powerMw) * (stop - a.timeMs) / (b.timeMs - a.timeMs);
        double area = (left + right) * .5 * dt;
        areas[bin] += area;
        covered[bin] += dt;
        totalArea += area;
        totalCovered += dt;
        timeArea += (low + stop) * .5 * dt;
        low = stop;
      }
    }
    result.coverage = totalCovered / (end - start);
    if (totalCovered == 0) return result;
    result.raw = totalArea / totalCovered;
    result.centerMs = timeArea / totalCovered;
    for (int i = 0; i < count; i++)
      if (covered[i] > 0) {
        result.windows.add(areas[i] / covered[i]);
        result.weights.add(covered[i]);
      }
    double median = BenchMath.percentile(result.windows, .5);
    List<Double> deviations = new ArrayList<>();
    for (double value : result.windows) deviations.add(Math.abs(value - median));
    double scale = Math.max(SCALE_FLOOR_MW, MAD_MULTIPLIER * BenchMath.percentile(deviations, .5));
    result.lowerFence = median - OUTLIER_Z * scale;
    result.upperFence = median + OUTLIER_Z * scale;
    double adjustedArea = 0, flaggedTime = 0;
    for (int i = 0; i < result.windows.size(); i++) {
      double value = result.windows.get(i),
          weight = result.weights.get(i),
          limited = Math.max(result.lowerFence, Math.min(result.upperFence, value));
      adjustedArea += limited * weight;
      if (value < result.lowerFence || value > result.upperFence) {
        result.flaggedWindows++;
        flaggedTime += weight;
      }
    }
    result.adjusted = adjustedArea / totalCovered;
    result.flaggedFraction = flaggedTime / totalCovered;
    return result;
  }

  /** Interpolate the outside blocks at the inside blocks' actual time centroid. */
  public static double contrast(double[] values, double[] times, boolean bInside) {
    if (values.length != 4 || times.length != 4 || times[3] <= times[0])
      throw new IllegalArgumentException("Four ordered blocks required");
    for (int i = 0; i < 4; i++)
      if (!Double.isFinite(values[i])
          || !Double.isFinite(times[i])
          || (i > 0 && times[i] <= times[i - 1]))
        throw new IllegalArgumentException("Invalid block centers");
    double fraction = ((times[1] + times[2]) * .5 - times[0]) / (times[3] - times[0]);
    double outside = values[0] + (values[3] - values[0]) * fraction,
        inside = (values[1] + values[2]) * .5;
    return (inside - outside) * (bInside ? 1 : -1);
  }

  public static double plainContrast(double[] values, boolean bInside) {
    return ((values[1] + values[2]) - (values[0] + values[3])) * .5 * (bInside ? 1 : -1);
  }

  public static final class Inference {
    public double estimate, median, pValue, lower, upper;
    public int units, assignments;
    public boolean finiteInterval;
  }

  /** Enumerate all 70 balanced assignments in the planned 8-quartet experiment. */
  public static Inference infer(double[] effects, boolean[] bInside) {
    int n = effects.length;
    if (n != PowerProtocol.QUARTETS || bInside.length != n)
      throw new IllegalArgumentException("Eight complete quartets required");
    int positive = 0;
    for (int i = 0; i < n; i++) {
      if (!Double.isFinite(effects[i]))
        throw new IllegalArgumentException("Finite effects required");
      if (bInside[i]) positive++;
    }
    if (positive != n / 2) throw new IllegalArgumentException("Balanced randomized order required");
    Inference result = new Inference();
    result.units = n;
    result.estimate = mean(effects);
    List<Double> effectList = new ArrayList<>();
    for (double e : effects) effectList.add(e);
    result.median = BenchMath.percentile(effectList, .5);
    List<double[]> alternatives = new ArrayList<>();
    for (int mask = 0; mask < (1 << n); mask++)
      if (Integer.bitCount(mask) == n / 2) {
        double a = 0, b = 0;
        for (int j = 0; j < n; j++) {
          double alignment = (((mask >> j) & 1) == 1 ? 1 : -1) * (bInside[j] ? 1 : -1);
          a += alignment * effects[j] / n;
          b += alignment / n;
        }
        alternatives.add(new double[] {a, b});
      }
    result.assignments = alternatives.size();
    result.pValue = pValue(alternatives, result.estimate, 0);
    // Invert the randomization test for a constant additive B-A effect.
    // Its acceptance region can be disconnected; return a conservative hull.
    List<Double> boundaries = new ArrayList<>();
    boundaries.add(result.estimate);
    for (double[] alternative : alternatives) {
      double a = alternative[0], b = alternative[1];
      if (Math.abs(1 - b) > 1e-12) boundaries.add((result.estimate - a) / (1 - b));
      if (Math.abs(1 + b) > 1e-12) boundaries.add((result.estimate + a) / (1 + b));
    }
    Collections.sort(boundaries);
    List<Double> unique = new ArrayList<>();
    for (double point : boundaries)
      if (Double.isFinite(point)
          && (unique.isEmpty() || Math.abs(point - unique.get(unique.size() - 1)) > 1e-9))
        unique.add(point);
    double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
    for (double point : unique)
      if (pValue(alternatives, result.estimate, point) > ALPHA) {
        min = Math.min(min, point);
        max = Math.max(max, point);
      }
    for (int i = 1; i < unique.size(); i++) {
      double lo = unique.get(i - 1), hi = unique.get(i);
      if (pValue(alternatives, result.estimate, lo + (hi - lo) * .5) > ALPHA) {
        min = Math.min(min, lo);
        max = Math.max(max, hi);
      }
    }
    double span =
        Math.max(1, Math.abs(unique.get(0)) + Math.abs(unique.get(unique.size() - 1)) + 1);
    boolean left = pValue(alternatives, result.estimate, unique.get(0) - span) > ALPHA;
    boolean right =
        pValue(alternatives, result.estimate, unique.get(unique.size() - 1) + span) > ALPHA;
    result.lower = left ? Double.NEGATIVE_INFINITY : min;
    result.upper = right ? Double.POSITIVE_INFINITY : max;
    result.finiteInterval = Double.isFinite(result.lower) && Double.isFinite(result.upper);
    return result;
  }

  private static double pValue(List<double[]> alternatives, double estimate, double candidate) {
    double observed = Math.abs(estimate - candidate), tolerance = 1e-9 * Math.max(1, observed);
    int count = 0;
    for (double[] p : alternatives)
      if (Math.abs(p[0] - p[1] * candidate) >= observed - tolerance) count++;
    return count / (double) alternatives.size();
  }

  public static double mean(double[] values) {
    double sum = 0;
    for (double v : values) sum += v;
    return sum / values.length;
  }
}
