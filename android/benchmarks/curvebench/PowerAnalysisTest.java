package org.fractalexplorer.curvebench;

import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public final class PowerAnalysisTest {
  private static int cases;

  private static void check(boolean value, String reason) {
    cases++;
    if (!value) throw new AssertionError(reason);
  }

  private static JSONObject reading(long time, double power, int brightness) throws Exception {
    return new JSONObject()
        .put("elapsedMs", time)
        .put("currentMicroamps", -Math.round(power / 0.004))
        .put("voltageMillivolts", 4000)
        .put("plugged", 0)
        .put("brightnessMode", 0)
        .put("brightnessSetting", brightness)
        .put("temperatureC", 30)
        .put("thermalStatus", 0)
        .put("powerSaveMode", false);
  }

  private static JSONObject fixture(double effect, String fault) throws Exception {
    return fixture(effect, fault, 0);
  }

  private static JSONObject fixture(double effect, String fault, int comparison) throws Exception {
    long seed = 82;
    List<PowerProtocol.Trial> plan = PowerProtocol.plan(new int[] {0}, comparison, seed);
    JSONArray phases = new JSONArray();
    JSONObject report =
        new JSONObject()
            .put("outcome", "Completed")
            .put("verificationRun", false)
            .put("sampleFps", 15)
            .put("phases", phases)
            .put(
                "powerProtocol",
                new JSONObject()
                    .put("version", 2)
                    .put("seed", Long.toString(seed))
                    .put("comparison", comparison)
                    .put("quartets", 8)
                    .put("analysisRules", PowerAnalysis.rules())
                    .put("profiles", new JSONArray(new int[] {0})));
    for (int i = 0; i < plan.size(); i++) {
      PowerProtocol.Trial trial = plan.get(i);
      long start = 100000 + i * 45000L + (i % 3) * 170;
      int duration = trial.calibration ? 60000 : 30000;
      JSONArray samples = new JSONArray();
      for (int t = 0; t <= duration; t += 1000) {
        if (fault.equals("missing") && i == 6 && t >= 10000 && t <= 20000) continue;
        // Linear drift plus deterministic within-block sensor noise, common to both methods.
        double power =
            2000 + (start + t) * .0003 + (trial.treatment ? effect : 0) + Math.sin(t * .001) * 2;
        if (fault.equals("isolated-spike") && i == 6 && t >= 10000 && t < 13000) power += 3000;
        if (fault.equals("whole-block") && i == 6) power += 1500;
        if (fault.equals("genuine-bursts") && trial.treatment && t >= 10000 && t < 13000)
          power += 800;
        if (fault.equals("sensor-lag") && trial.treatment) power += t / (double) duration * 100;
        JSONObject sample =
            reading(start + t, power, fault.equals("brightness") && i == 6 ? 130 : 128);
        if (fault.equals("unsupported")) sample.put("currentMicroamps", Long.MIN_VALUE);
        if (fault.equals("thermal") && i == 6) sample.put("thermalStatus", 2);
        samples.put(sample);
      }
      JSONObject p =
          new JSONObject()
              .put("ordinal", i)
              .put("profile", "cover")
              .put("mode", trial.mode)
              .put("quartet", trial.quartet)
              .put("slot", trial.slot)
              .put("calibration", trial.calibration)
              .put("treatment", trial.treatment)
              .put("bInside", trial.bInside)
              .put("measurementStartElapsedMs", start)
              .put("measuredMs", duration)
              .put("settledMs", 15000)
              .put("callbackFramesPerSecond", 15)
              .put(
                  "playerMetricsStart",
                  new JSONObject()
                      .put("android.media.mediaplayer.frames", 100)
                      .put("android.media.mediaplayer.dropped", 0))
              .put(
                  "playerMetrics",
                  new JSONObject()
                      .put("android.media.mediaplayer.frames", 100 + duration * 15 / 1000)
                      .put("android.media.mediaplayer.dropped", 0))
              .put("batteryStart", samples.getJSONObject(0))
              .put("batteryEnd", samples.getJSONObject(samples.length() - 1))
              .put("batterySamples", samples);
      phases.put(p);
    }
    return report;
  }

  private static JSONObject summary(JSONObject report) throws Exception {
    return PowerAnalysis.analyze(report).getJSONArray("profiles").getJSONObject(0);
  }

  public static void main(String[] args) throws Exception {
    JSONObject clean = summary(fixture(80, "none"));
    JSONObject altered = fixture(80, "none");
    altered
        .getJSONObject("powerProtocol")
        .getJSONObject("analysisRules")
        .put("minimumTimeCoverage", .1);
    try {
      PowerAnalysis.analyze(altered);
      throw new AssertionError("Changed rules accepted");
    } catch (IllegalArgumentException expected) {
      cases++;
    }
    JSONObject noCadence = fixture(-80, "none", 3);
    for (int i = 0; i < noCadence.getJSONArray("phases").length(); i++) {
      JSONObject p = noCadence.getJSONArray("phases").getJSONObject(i);
      if (p.getInt("mode") == 0) p.remove("playerMetricsStart");
    }
    check(
        summary(noCadence).getString("verdict").equals("inconclusive"),
        "Direct output cannot win with unverified decoded cadence");
    for (int comparison : new int[] {1, 2, 3}) {
      JSONObject result = summary(fixture(comparison == 1 ? 80 : -80, "none", comparison));
      check(
          result.getString("verdict").equals(comparison == 1 ? "higher-power" : "lower-power"),
          "Both directions and all comparison mappings: " + comparison);
    }
    check(clean.getString("verdict").equals("higher-power"), "Known sustained effect resolves");
    check(
        Math.abs(clean.getJSONObject("raw").getDouble("estimateMw") - 80) < 1,
        "Linear drift correction recovers effect");
    JSONObject zero = summary(fixture(0, "none"));
    check(zero.getString("verdict").equals("inconclusive"), "No fake zero-overhead claim");
    for (String fault : new String[] {"missing", "unsupported", "brightness", "thermal"}) {
      JSONObject result = summary(fixture(80, fault));
      check(
          result.getString("verdict").equals("inconclusive"),
          "Quality failure cannot manufacture a win: " + fault);
      check(result.getJSONArray("qualityIssues").length() > 0, "Reason is recorded: " + fault);
    }
    JSONObject raw = fixture(0, "isolated-spike");
    String before = raw.toString();
    JSONObject adjusted = PowerAnalysis.analyze(raw);
    check(raw.toString().equals(before), "All raw inputs remain byte-equivalent in memory");
    check(
        adjusted
            .getJSONArray("profiles")
            .getJSONObject(0)
            .getString("verdict")
            .equals("inconclusive"),
        "One foreign burst cannot decide the winner");
    check(
        adjusted.getJSONArray("profiles").getJSONObject(0).getInt("flaggedWindows") > 0,
        "Transient windows identified separately");
    JSONObject sustained = summary(fixture(80, "whole-block"));
    check(
        sustained.getString("verdict").equals("inconclusive"),
        "A whole-block disturbance widens uncertainty");
    JSONObject genuine = summary(fixture(0, "genuine-bursts"));
    check(
        genuine.getString("verdict").equals("inconclusive")
            && genuine.getBoolean("anomalySensitive"),
        "Repeated workload bursts cannot be silently corrected away");
    JSONObject lag = summary(fixture(0, "sensor-lag"));
    check(
        lag.getString("verdict").equals("inconclusive")
            && lag.getJSONArray("qualityIssues").toString().contains("still changing"),
        "Unsettled method-aligned sensor response cannot masquerade as a steady-state estimate");
    JSONObject partial = fixture(80, "none");
    partial.getJSONArray("phases").remove(32);
    partial.put("outcome", "Stopped by you");
    check(
        summary(partial).getString("verdict").equals("inconclusive"),
        "Partial run has no formal verdict");
    JSONObject emulator = fixture(80, "none").put("verificationRun", true);
    check(
        summary(emulator).getString("verdict").equals("inconclusive"),
        "Emulator never becomes phone evidence");
    check(
        clean.getJSONObject("raw").getInt("inferenceUnits") == 8
            && clean.getJSONObject("raw").getInt("assignments") == 70,
        "No pseudoreplication of individual readings");
    check(
        PowerAnalysis.summary(adjusted).contains("Raw, drift-adjusted")
            && PowerAnalysis.summary(adjusted).contains("Spike-limited sensitivity"),
        "Both analyses visible");
    System.out.println(
        "PASS "
            + cases
            + " simulated power experiments: sustained effects, drift, background bursts, invalid"
            + " sensors, controls, partial runs and preserved raw data.");
    if (args.length == 1) {
      java.nio.file.Path directory = java.nio.file.Paths.get(args[0]);
      java.nio.file.Files.createDirectories(directory);
      for (String name : new String[] {"steady", "burst", "lag", "missing"}) {
        JSONObject input =
            fixture(
                    name.equals("steady") ? 80 : 0,
                    name.equals("steady")
                        ? "none"
                        : name.equals("burst")
                            ? "isolated-spike"
                            : name.equals("lag") ? "sensor-lag" : "missing")
                .put("syntheticTestFixture", true);
        java.nio.file.Files.write(
            directory.resolve(name + "-input.json"),
            input.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        java.nio.file.Files.write(
            directory.resolve(name + "-expected.json"),
            PowerAnalysis.analyze(input)
                .toString()
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
      }
    }
  }
}
