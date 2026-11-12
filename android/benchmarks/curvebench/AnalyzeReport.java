package org.fractalexplorer.curvebench;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.json.JSONObject;

/** Host-only replay of exactly the analyzer bundled in the APK. */
public final class AnalyzeReport {
  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("Supply a benchmark JSON report");
    JSONObject report =
        new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8));
    System.out.println(PowerAnalysis.analyze(report).toString(2));
  }
}
