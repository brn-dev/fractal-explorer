package org.fractalexplorer.curvebench;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Raw traces are immutable inputs. Adjustments are explicit sensitivity analyses. */
public final class PowerAnalysis {
  private static final double MIN_COVERAGE = .9,
      MAX_FLAGGED = .4,
      MIN_FPS = .85,
      MAX_DROPS = .05,
      MAX_TEMP = 3,
      BRIGHTNESS_EPS = .01,
      RELATIVE_GAP = .25,
      ABSOLUTE_GAP = 1,
      TREND_FLOOR = 5,
      TREND_FRACTION = .2,
      ORDER_SIGMAS = 3;
  private static final int MIN_SETTLED_MS = 10000;

  private PowerAnalysis() {}

  public static JSONObject rules() throws Exception {
    return new JSONObject()
        .put("alpha", PowerStats.ALPHA)
        .put("minimumTimeCoverage", MIN_COVERAGE)
        .put("maximumFlaggedTimeFraction", MAX_FLAGGED)
        .put("minimumFpsFraction", MIN_FPS)
        .put("maximumDecoderDropFraction", MAX_DROPS)
        .put("maximumQuartetTemperatureRangeC", MAX_TEMP)
        .put("brightnessTolerance", BRIGHTNESS_EPS)
        .put("minimumActualSettlingMs", MIN_SETTLED_MS)
        .put("rawRobustRelativeGap", RELATIVE_GAP)
        .put("rawRobustAbsoluteGapMw", ABSOLUTE_GAP)
        .put("trendFloorMw", TREND_FLOOR)
        .put("trendRelativeThreshold", TREND_FRACTION)
        .put("orderStandardErrorMultiplier", ORDER_SIGMAS)
        .put("orderAbsoluteFloorMw", 2 * PowerStats.SCALE_FLOOR_MW);
  }

  public static JSONObject analyze(JSONObject report) throws Exception {
    JSONObject protocol = report.getJSONObject("powerProtocol");
    if (protocol.optInt("version") != 2 || protocol.optInt("quartets") != PowerProtocol.QUARTETS)
      throw new IllegalArgumentException("Unsupported power protocol");
    JSONObject recordedRules = protocol.optJSONObject("analysisRules");
    if (recordedRules != null) {
      JSONObject expected = rules();
      if (recordedRules.length() != expected.length())
        throw new IllegalArgumentException("Analysis rule set changed");
      for (java.util.Iterator<String> keys = expected.keys(); keys.hasNext(); ) {
        String key = keys.next();
        if (Double.compare(recordedRules.optDouble(key, Double.NaN), expected.getDouble(key)) != 0)
          throw new IllegalArgumentException("Analysis rule changed: " + key);
      }
    }
    long seed = Long.parseLong(protocol.getString("seed"));
    int comparison = protocol.getInt("comparison");
    JSONArray profileInput = protocol.getJSONArray("profiles");
    int[] profiles = new int[profileInput.length()];
    for (int i = 0; i < profiles.length; i++) profiles[i] = profileInput.getInt(i);
    List<PowerProtocol.Trial> plan = PowerProtocol.plan(profiles, comparison, seed);
    JSONArray phases = report.getJSONArray("phases"),
        summaries = new JSONArray(),
        blocks = new JSONArray();
    JSONObject[] source = new JSONObject[plan.size()];
    BlockData[] data = new BlockData[plan.size()];
    boolean duplicateOrdinal = false;
    for (int i = 0; i < phases.length(); i++) {
      JSONObject p = phases.getJSONObject(i);
      int ordinal = p.optInt("ordinal", -1);
      if (ordinal < 0 || ordinal >= plan.size() || source[ordinal] != null) {
        duplicateOrdinal = true;
        continue;
      }
      source[ordinal] = p;
      data[ordinal] = readBlock(p, plan.get(ordinal), report.optInt("sampleFps", 15));
      blocks.put(data[ordinal].json);
    }
    for (int profile : profiles) {
      List<String> issues = new ArrayList<>();
      List<double[]> values = new ArrayList<>();
      List<Boolean> orientations = new ArrayList<>();
      JSONArray quartets = new JSONArray();
      int flaggedWindows = 0;
      double baselineSum = 0;
      int baselineCount = 0;
      int brightness = -1;
      double physicalBrightness = Double.NaN;
      if (duplicateOrdinal) issues.add("Duplicate or unknown block ordinal");
      if (!"Completed".equals(report.optString("outcome"))) issues.add("Run did not complete");
      for (int q = -1; q < PowerProtocol.QUARTETS; q++) {
        List<Integer> indices = new ArrayList<>();
        for (int i = 0; i < plan.size(); i++)
          if (plan.get(i).profile == profile && plan.get(i).quartet == q) indices.add(i);
        boolean valid = true;
        double[] raw = new double[4],
            adjusted = new double[4],
            times = new double[4],
            trends = new double[4];
        double minTemperature = Double.POSITIVE_INFINITY, maxTemperature = Double.NEGATIVE_INFINITY;
        int firstThermal = -1;
        for (int i : indices) {
          PowerProtocol.Trial trial = plan.get(i);
          BlockData d = data[i];
          JSONObject p = source[i];
          if (d == null) {
            issues.add(
                "Missing "
                    + (q < 0
                        ? "calibration"
                        : "quartet " + (q + 1) + " block " + (trial.slot + 1)));
            valid = false;
            continue;
          }
          if (!d.issues.isEmpty()) {
            for (String reason : d.issues) issues.add("Block " + (i + 1) + ": " + reason);
            valid = false;
          }
          if (!matches(p, trial)) {
            issues.add("Block " + (i + 1) + ": recorded order does not match randomized plan");
            valid = false;
          }
          if (d.brightness >= 0) {
            if (brightness < 0) brightness = d.brightness;
            else if (brightness != d.brightness) {
              issues.add("Screen brightness setting changed during the profile");
              valid = false;
            }
          }
          if (Double.isFinite(d.physicalBrightness)) {
            if (!Double.isFinite(physicalBrightness)) physicalBrightness = d.physicalBrightness;
            else if (Math.abs(d.physicalBrightness - physicalBrightness) > BRIGHTNESS_EPS) {
              issues.add("Measured display brightness changed during the profile");
              valid = false;
            }
          }
          if (q < 0) continue;
          flaggedWindows += d.power.flaggedWindows;
          raw[trial.slot] = d.power.raw;
          adjusted[trial.slot] = d.power.adjusted;
          times[trial.slot] = d.power.centerMs;
          trends[trial.slot] = d.trend;
          minTemperature = Math.min(minTemperature, d.minTemperature);
          maxTemperature = Math.max(maxTemperature, d.maxTemperature);
          if (firstThermal < 0) firstThermal = d.thermal;
          else if (d.thermal != firstThermal) {
            issues.add("Thermal state changed within quartet " + (q + 1));
            valid = false;
          }
          if (!trial.treatment && Double.isFinite(d.power.raw)) {
            baselineSum += d.power.raw;
            baselineCount++;
          }
        }
        if (q < 0) continue;
        if (maxTemperature - minTemperature > MAX_TEMP) {
          issues.add("Temperature changed by more than 3 C within quartet " + (q + 1));
          valid = false;
        }
        JSONObject row = new JSONObject().put("quartet", q).put("usable", valid);
        if (valid) {
          boolean bInside = plan.get(indices.get(0)).bInside;
          double effect = PowerStats.contrast(raw, times, bInside),
              sensitive = PowerStats.contrast(adjusted, times, bInside),
              plain = PowerStats.plainContrast(raw, bInside);
          row.put("bInside", bInside)
              .put("rawUncorrectedMw", plain)
              .put("rawDriftCorrectedMw", effect)
              .put("robustDriftCorrectedMw", sensitive);
          values.add(
              new double[] {plain, effect, sensitive, PowerStats.plainContrast(trends, bInside)});
          orientations.add(bInside);
        }
        quartets.put(row);
      }
      JSONObject summary =
          new JSONObject()
              .put("profile", profile == 0 ? "cover" : "main")
              .put("comparison", PowerProtocol.LABELS[comparison])
              .put("plannedQuartets", PowerProtocol.QUARTETS)
              .put("usableQuartets", values.size())
              .put("flaggedWindows", flaggedWindows)
              .put("quartets", quartets);
      summary.put(
          "baselineWholePhoneMw",
          number(baselineCount == 0 ? Double.NaN : baselineSum / baselineCount));
      if (values.size() == PowerProtocol.QUARTETS) {
        double[] plain = new double[values.size()],
            raw = new double[values.size()],
            robust = new double[values.size()],
            trends = new double[values.size()];
        boolean[] inside = new boolean[values.size()];
        for (int i = 0; i < values.size(); i++) {
          plain[i] = values.get(i)[0];
          raw[i] = values.get(i)[1];
          robust[i] = values.get(i)[2];
          trends[i] = values.get(i)[3];
          inside[i] = orientations.get(i);
        }
        PowerStats.Inference primary = PowerStats.infer(raw, inside),
            sensitivity = PowerStats.infer(robust, inside);
        summary
            .put("rawUncorrectedMw", PowerStats.mean(plain))
            .put("raw", inference(primary))
            .put("robust", inference(sensitivity));
        PowerStats.Inference trend = PowerStats.infer(trends, inside);
        summary.put("withinBlockTrend", inference(trend));
        if (trend.finiteInterval
            && (trend.lower > 0 || trend.upper < 0)
            && Math.abs(trend.estimate)
                > Math.max(TREND_FLOOR, TREND_FRACTION * Math.abs(primary.estimate)))
          issues.add(
              "Treatment-aligned power is still changing within measurement windows; possible"
                  + " settling, workload evolution or sensor lag");
        double orderDifference = orderDifference(raw, inside),
            orderSe = orderStandardError(raw, inside);
        summary.put("orderInteractionMw", orderDifference).put("orderInteractionSeMw", orderSe);
        if (Math.abs(orderDifference)
            > Math.max(2 * PowerStats.SCALE_FLOOR_MW, ORDER_SIGMAS * orderSe))
          issues.add("Order/carryover sensitivity: ABBA and BAAB disagree");
        double magnitudeGap = Math.abs(primary.estimate - sensitivity.estimate),
            allowedGap =
                Math.max(
                    ABSOLUTE_GAP,
                    RELATIVE_GAP
                        * Math.max(Math.abs(primary.estimate), Math.abs(sensitivity.estimate)));
        boolean intervalsDisagree =
            primary.finiteInterval
                && sensitivity.finiteInterval
                && (primary.lower > sensitivity.upper + ABSOLUTE_GAP
                    || sensitivity.lower > primary.upper + ABSOLUTE_GAP);
        boolean sensitive = magnitudeGap > allowedGap || intervalsDisagree;
        summary.put("anomalySensitive", sensitive);
        if (sensitive)
          issues.add(
              "Raw and robust effect sizes materially disagree; spikes may be real workload costs");
        String verdict = "inconclusive";
        if (issues.isEmpty() && !report.optBoolean("verificationRun")) {
          if (primary.finiteInterval
              && sensitivity.finiteInterval
              && primary.lower > 0
              && sensitivity.lower > 0
              && primary.pValue <= PowerStats.ALPHA
              && sensitivity.pValue <= PowerStats.ALPHA) verdict = "higher-power";
          else if (primary.finiteInterval
              && sensitivity.finiteInterval
              && primary.upper < 0
              && sensitivity.upper < 0
              && primary.pValue <= PowerStats.ALPHA
              && sensitivity.pValue <= PowerStats.ALPHA) verdict = "lower-power";
        }
        if (verdict.equals("inconclusive") && issues.isEmpty())
          issues.add(
              report.optBoolean("verificationRun")
                  ? "Emulator verification is not phone power evidence"
                  : "Difference is not resolved by both raw and robust intervals; this is not"
                      + " evidence of zero overhead");
        summary.put("verdict", verdict);
      } else {
        summary.put("verdict", "inconclusive");
        issues.add(
            "Eight usable quartets are required; no post-hoc replacement or inference from"
                + " individual sensor samples");
      }
      summary.put("qualityIssues", strings(issues));
      summaries.put(summary);
    }
    return new JSONObject()
        .put("version", 2)
        .put("rules", rules())
        .put("profiles", summaries)
        .put("blocks", blocks)
        .put(
            "policy",
            "Raw samples retained. 5 s time-weighted windows; symmetric MAD winsorization is"
                + " sensitivity analysis only. No block is dropped because its power is high."
                + " Actual-time ABBA/BAAB interpolation removes linear drift. Fixed 8-quartet plan,"
                + " all 70 balanced assignments, no significance-based early stopping.")
        .put(
            "intervalAssumptions",
            "95% randomization interval is the conservative hull of inverted tests under a constant"
                + " additive B-A effect and fixed observation timing. Quartets are inference units;"
                + " sensors need not be independent at 1 Hz. Sensor lag/calibration bias,"
                + " unobserved background processes, non-linear drift and carryover are not"
                + " magically removed. This is not isolated GPU power or a calibrated laboratory"
                + " battery measurement.");
  }

  private static boolean matches(JSONObject p, PowerProtocol.Trial t) {
    return p.optInt("mode", -1) == t.mode
        && p.optInt("quartet", -2) == t.quartet
        && p.optInt("slot", -1) == t.slot
        && p.optBoolean("calibration") == t.calibration
        && p.optBoolean("treatment") == t.treatment
        && p.optBoolean("bInside") == t.bInside
        && p.optString("profile").equals(t.profile == 0 ? "cover" : "main");
  }

  private static final class BlockData {
    PowerStats.Block power;
    JSONObject json;
    List<String> issues = new ArrayList<>();
    int brightness = -1, thermal = -1;
    double trend;
    double physicalBrightness = Double.NaN,
        minTemperature = Double.POSITIVE_INFINITY,
        maxTemperature = Double.NEGATIVE_INFINITY;
  }

  private static BlockData readBlock(JSONObject p, PowerProtocol.Trial trial, int fps)
      throws Exception {
    BlockData out = new BlockData();
    JSONArray samples = p.optJSONArray("batterySamples");
    List<JSONObject> records = new ArrayList<>();
    if (p.optJSONObject("batteryStart") != null) records.add(p.getJSONObject("batteryStart"));
    if (samples != null)
      for (int i = 0; i < samples.length(); i++) records.add(samples.getJSONObject(i));
    if (p.optJSONObject("batteryEnd") != null) records.add(p.getJSONObject("batteryEnd"));
    List<PowerStats.Sample> readings = new ArrayList<>();
    for (JSONObject s : records) {
      double time = s.optDouble("elapsedMs", Double.NaN),
          power =
              BenchMath.dischargeMilliwatts(
                  s.optLong("currentMicroamps", Long.MIN_VALUE),
                  s.optInt("voltageMillivolts", 0),
                  s.optInt("plugged", -1) != 0);
      readings.add(new PowerStats.Sample(time, power));
      if (s.optInt("plugged", -1) != 0) addUnique(out.issues, "Charging or unknown charging state");
      int brightnessMode = s.optInt("brightnessMode", -1),
          brightness = s.optInt("brightnessSetting", -1);
      if (brightnessMode != 0) addUnique(out.issues, "Adaptive or unknown brightness mode");
      if (brightness < 0) addUnique(out.issues, "Unknown brightness setting");
      else if (out.brightness < 0) out.brightness = brightness;
      else if (out.brightness != brightness)
        addUnique(out.issues, "Brightness setting changed inside the block");
      double physical = s.optDouble("displayBrightness", Double.NaN);
      if (Double.isFinite(physical)) {
        if (!Double.isFinite(out.physicalBrightness)) out.physicalBrightness = physical;
        else if (Math.abs(out.physicalBrightness - physical) > BRIGHTNESS_EPS)
          addUnique(out.issues, "Physical display brightness changed inside the block");
      }
      int thermal = s.optInt("thermalStatus", -1);
      if (thermal < 0) addUnique(out.issues, "Unknown thermal state");
      else if (out.thermal < 0) out.thermal = thermal;
      else if (out.thermal != thermal) {
        if (!trial.calibration) addUnique(out.issues, "Thermal state changed inside the block");
        else out.thermal = thermal;
      }
      if (thermal >= 2) addUnique(out.issues, "Thermal throttling state is moderate or higher");
      double temp = s.optDouble("temperatureC", Double.NaN);
      if (Double.isFinite(temp)) {
        out.minTemperature = Math.min(out.minTemperature, temp);
        out.maxTemperature = Math.max(out.maxTemperature, temp);
      }
    }
    double start = p.optDouble("measurementStartElapsedMs", Double.NaN),
        duration = p.optDouble("measuredMs", Double.NaN);
    if (!Double.isFinite(start) || !Double.isFinite(duration) || duration <= 0) {
      out.power = new PowerStats.Block();
      out.issues.add("Missing measurement bounds");
    } else out.power = PowerStats.block(readings, start, start + duration);
    PowerStats.Block b = out.power;
    out.trend =
        b.windows.size() < 2 ? Double.NaN : b.windows.get(b.windows.size() - 1) - b.windows.get(0);
    if (p.has("error") || p.optBoolean("incomplete")) out.issues.add("Failed or incomplete block");
    if (b.coverage < MIN_COVERAGE) out.issues.add("Less than 90% valid time coverage");
    if (b.outOfOrder > 0 || b.conflictingDuplicates > 0)
      out.issues.add("Non-monotonic or conflicting sensor timestamps");
    if (b.windows.size() < 4) out.issues.add("Too few complete-time sensor windows");
    if (!trial.calibration && b.flaggedFraction > MAX_FLAGGED)
      out.issues.add("More than 40% of measured time is sensitivity-flagged");
    if (!Double.isFinite(b.raw) || !Double.isFinite(b.adjusted))
      out.issues.add("No usable battery-current estimate");
    if (!trial.calibration && p.optDouble("settledMs", 0) < MIN_SETTLED_MS)
      out.issues.add("Less than ten seconds of actual decoded settling");
    if (trial.mode != 0
        && !trial.calibration
        && p.optDouble("callbackFramesPerSecond", 0) < fps * MIN_FPS)
      out.issues.add("Playback callbacks below 85% of the requested frame rate");
    JSONObject before = p.optJSONObject("playerMetricsStart"),
        after = p.optJSONObject("playerMetrics");
    boolean decoderCadenceKnown = false;
    if (before != null && after != null) {
      String frames = "android.media.mediaplayer.frames",
          drops = "android.media.mediaplayer.dropped";
      long decoded = after.optLong(frames, -1) - before.optLong(frames, -1),
          dropped = after.optLong(drops, -1) - before.optLong(drops, -1);
      decoderCadenceKnown = before.has(frames) && after.has(frames) && decoded > 0;
      if (before.has(frames)
          && after.has(frames)
          && decoded > 0
          && duration > 0
          && decoded < duration / 1000d * fps * MIN_FPS)
        out.issues.add("Decoder frame count below 85% of requested cadence");
      if (before.has(drops) && after.has(drops) && decoded > 0 && dropped > decoded * MAX_DROPS)
        out.issues.add("More than 5% decoder drops during measurement");
    }
    if (trial.mode == 0 && !trial.calibration && !decoderCadenceKnown)
      out.issues.add("Direct decoder cadence could not be verified");
    out.json =
        new JSONObject()
            .put("ordinal", p.optInt("ordinal", -1))
            .put("calibration", trial.calibration)
            .put("coverage", b.coverage)
            .put("rawMeanMw", number(b.raw))
            .put("robustMeanMw", number(b.adjusted))
            .put("lastMinusFirstWindowMw", number(out.trend))
            .put("timeCenterMs", number(b.centerMs))
            .put("validSamples", b.validSamples)
            .put("invalidSamples", b.invalidSamples)
            .put("duplicateTimestamps", b.duplicates)
            .put("outOfOrderTimestamps", b.outOfOrder)
            .put("flaggedWindows", b.flaggedWindows)
            .put("flaggedTimeFraction", b.flaggedFraction)
            .put("lowerFenceMw", number(b.lowerFence))
            .put("upperFenceMw", number(b.upperFence))
            .put("windowMeansMw", new JSONArray(b.windows))
            .put("windowCoverageMs", new JSONArray(b.weights))
            .put("qualityIssues", strings(out.issues));
    return out;
  }

  private static JSONObject inference(PowerStats.Inference value) throws Exception {
    return new JSONObject()
        .put("estimateMw", value.estimate)
        .put("quartetMedianMw", value.median)
        .put("pValue", value.pValue)
        .put("ciLowerMw", number(value.lower))
        .put("ciUpperMw", number(value.upper))
        .put("finiteInterval", value.finiteInterval)
        .put("inferenceUnits", value.units)
        .put("assignments", value.assignments);
  }

  private static double orderDifference(double[] effects, boolean[] inside) {
    double a = 0, b = 0;
    int na = 0, nb = 0;
    for (int i = 0; i < effects.length; i++)
      if (inside[i]) {
        a += effects[i];
        na++;
      } else {
        b += effects[i];
        nb++;
      }
    return a / na - b / nb;
  }

  private static double orderStandardError(double[] effects, boolean[] inside) {
    double a = 0, b = 0;
    int n = effects.length / 2;
    for (int i = 0; i < effects.length; i++)
      if (inside[i]) a += effects[i] / n;
      else b += effects[i] / n;
    double va = 0, vb = 0;
    for (int i = 0; i < effects.length; i++)
      if (inside[i]) va += (effects[i] - a) * (effects[i] - a);
      else vb += (effects[i] - b) * (effects[i] - b);
    return Math.sqrt(va / (n * (n - 1)) + vb / (n * (n - 1)));
  }

  private static void addUnique(List<String> issues, String issue) {
    if (!issues.contains(issue)) issues.add(issue);
  }

  private static JSONArray strings(List<String> values) {
    List<String> unique = new ArrayList<>();
    for (String value : values) if (!unique.contains(value)) unique.add(value);
    return new JSONArray(unique);
  }

  private static Object number(double value) {
    return Double.isFinite(value) ? value : JSONObject.NULL;
  }

  public static String summary(JSONObject analysis) throws Exception {
    StringBuilder text = new StringBuilder();
    JSONArray profiles = analysis.getJSONArray("profiles");
    for (int i = 0; i < profiles.length(); i++) {
      JSONObject p = profiles.getJSONObject(i);
      text.append(p.getString("profile"))
          .append(" · ")
          .append(p.getString("comparison"))
          .append('\n')
          .append(p.getString("verdict"))
          .append('\n');
      if (p.has("rawUncorrectedMw"))
        text.append(
            String.format(
                Locale.US, "Before drift correction: %+.0f mW\n", p.getDouble("rawUncorrectedMw")));
      for (String key : new String[] {"raw", "robust"}) {
        JSONObject value = p.optJSONObject(key);
        if (value != null)
          text.append(key.equals("raw") ? "Raw, drift-adjusted: " : "Spike-limited sensitivity: ")
              .append(String.format(Locale.US, "%+.0f mW", value.getDouble("estimateMw")))
              .append("; 95% interval ")
              .append(
                  !value.optBoolean("finiteInterval")
                      ? "unbounded"
                      : String.format(
                          Locale.US,
                          "[%+.0f, %+.0f] mW",
                          value.getDouble("ciLowerMw"),
                          value.getDouble("ciUpperMw")))
              .append('\n');
      }
      text.append(p.getInt("usableQuartets"))
          .append(" / ")
          .append(PowerProtocol.QUARTETS)
          .append(" usable quartets · ")
          .append(p.getInt("flaggedWindows"))
          .append(" flagged windows\n");
      JSONArray issues = p.getJSONArray("qualityIssues");
      for (int j = 0; j < Math.min(3, issues.length()); j++)
        text.append("• ").append(issues.getString(j)).append('\n');
    }
    return text.append(
            "B − A is whole-phone power under this test. Raw data and all flags are retained;"
                + " anomalies are not proof of background work.\n")
        .toString();
  }
}
