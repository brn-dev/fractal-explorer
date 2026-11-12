package org.fractalexplorer.curvebench.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.view.KeyEvent;
import android.widget.Button;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import org.json.JSONObject;

/** Integration checks on an emulator only; never sends a report to another app. */
public final class ReportInstrumentation extends Instrumentation {
  private int checks;

  @Override
  public void onCreate(Bundle args) {
    super.onCreate(args);
    start();
  }

  private void check(boolean value, String message) {
    checks++;
    if (!value) throw new AssertionError(message);
  }

  private JSONObject fixture(String name) throws Exception {
    try (InputStream input = getContext().getAssets().open(name)) {
      java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
      byte[] buffer = new byte[16384];
      for (int n; (n = input.read(buffer)) != -1; ) bytes.write(buffer, 0, n);
      return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
    }
  }

  private void same(Object actual, Object expected) throws Exception {
    if (expected instanceof JSONObject) {
      check(actual instanceof JSONObject, "Object type");
      JSONObject a = (JSONObject) actual, e = (JSONObject) expected;
      check(a.length() == e.length(), "Object keys");
      for (java.util.Iterator<String> keys = e.keys(); keys.hasNext(); ) {
        String key = keys.next();
        check(a.has(key), "Missing key " + key);
        same(a.get(key), e.get(key));
      }
    } else if (expected instanceof org.json.JSONArray) {
      check(actual instanceof org.json.JSONArray, "Array type");
      org.json.JSONArray a = (org.json.JSONArray) actual, e = (org.json.JSONArray) expected;
      check(a.length() == e.length(), "Array length");
      for (int i = 0; i < e.length(); i++) same(a.get(i), e.get(i));
    } else if (expected instanceof Number) {
      check(
          actual instanceof Number
              && Math.abs(((Number) actual).doubleValue() - ((Number) expected).doubleValue())
                  <= Math.max(1e-7, Math.abs(((Number) expected).doubleValue()) * 1e-10),
          "Numeric analysis matches host");
    } else check(expected.equals(actual), "Value matches host");
  }

  @Override
  public void onStart() {
    Bundle results = new Bundle();
    int resultCode = Activity.RESULT_CANCELED;
    Activity activity = null;
    File file = null, latest = null;
    byte[] original = null;
    try {
      check(
          Build.FINGERPRINT.contains("generic")
              || Build.HARDWARE.contains("ranchu")
              || Build.HARDWARE.contains("goldfish"),
          "Emulator only");
      java.lang.reflect.Method analyze =
          Class.forName("org.fractalexplorer.curvebench.PowerAnalysis")
              .getMethod("analyze", JSONObject.class);
      for (String name : new String[] {"steady", "burst", "lag", "missing"})
        same(analyze.invoke(null, fixture(name + "-input.json")), fixture(name + "-expected.json"));
      results.putString(
          "numericFixtures",
          "PASS 4 synthetic reports match the host analyzer on Android, including effect intervals"
              + " and anomaly/quality decisions. These are not phone measurements.");
      File directory = new File(getTargetContext().getFilesDir(), "reports");
      check(directory.isDirectory() || directory.mkdirs(), "Report directory");
      String name = "report-" + UUID.randomUUID().toString().replace("-", "") + ".json";
      file = new File(directory, name);
      JSONObject json =
          new JSONObject()
              .put("version", "1.1")
              .put("verificationRun", true)
              .put("summary", "Large report sharing verification; no phone power measurement.")
              .put("shareFile", name);
      char[] padding = new char[3 * 1024 * 1024];
      Arrays.fill(padding, 'x');
      json.put("verificationPadding", new String(padding));
      byte[] bytes = json.toString().getBytes(StandardCharsets.UTF_8);
      try (FileOutputStream output = new FileOutputStream(file)) {
        output.write(bytes);
      }
      Uri uri = Uri.parse("content://org.fractalexplorer.curvebench.reports/" + name);
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      int total = 0;
      try (InputStream input = getTargetContext().getContentResolver().openInputStream(uri)) {
        byte[] buffer = new byte[32768];
        for (int n; (n = input.read(buffer)) != -1; ) {
          digest.update(buffer, 0, n);
          total += n;
        }
      }
      check(total == bytes.length && total > 3 * 1024 * 1024, "Multi-megabyte stream length");
      check(
          Arrays.equals(digest.digest(), MessageDigest.getInstance("SHA-256").digest(bytes)),
          "Stream is byte exact");
      try (Cursor cursor =
          getTargetContext().getContentResolver().query(uri, null, null, null, null)) {
        check(cursor != null && cursor.moveToFirst(), "Openable report metadata");
        check(
            cursor.getLong(cursor.getColumnIndexOrThrow(OpenableColumns.SIZE)) == bytes.length,
            "Correct reported size");
      }
      check(
          "application/json".equals(getTargetContext().getContentResolver().getType(uri)),
          "JSON MIME type");
      for (String bad :
          new String[] {
            "../latest-report.json", "%2e%2e%2flatest-report.json", "latest-report.json"
          }) {
        try {
          InputStream input =
              getTargetContext()
                  .getContentResolver()
                  .openInputStream(
                      Uri.parse("content://org.fractalexplorer.curvebench.reports/" + bad));
          if (input != null) input.close();
          throw new AssertionError("Arbitrary path accepted");
        } catch (java.io.FileNotFoundException expected) {
          checks++;
        }
      }
      try {
        ParcelFileDescriptor fd =
            getTargetContext().getContentResolver().openFileDescriptor(uri, "rw");
        if (fd != null) fd.close();
        throw new AssertionError("Writable report accepted");
      } catch (java.io.FileNotFoundException expected) {
        checks++;
      }
      latest = new File(getTargetContext().getFilesDir(), "latest-report.json");
      if (latest.isFile()) original = Files.readAllBytes(latest.toPath());
      try (FileOutputStream output = new FileOutputStream(latest)) {
        output.write(bytes);
      }
      activity =
          startActivitySync(
              new Intent()
                  .setClassName(
                      "org.fractalexplorer.curvebench",
                      "org.fractalexplorer.curvebench.BenchActivity")
                  .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      waitForIdleSync();
      Field field = activity.getClass().getDeclaredField("reportUri");
      field.setAccessible(true);
      check(uri.equals(field.get(activity)), "Activity restores immutable shared report");
      Field text = activity.getClass().getDeclaredField("lastSummary");
      text.setAccessible(true);
      check(
          ((String) text.get(activity)).length() < 2000, "Summary stays below Binder size limits");
      Field button = activity.getClass().getDeclaredField("share");
      button.setAccessible(true);
      Button share = (Button) button.get(activity);
      check(share.isEnabled(), "Sharing enabled for restored large report");
      runOnMainSync(() -> share.performClick());
      boolean chooserVisible = false;
      for (int i = 0; i < 50; i++) {
        android.view.accessibility.AccessibilityNodeInfo root =
            getUiAutomation().getRootInActiveWindow();
        String pkg =
            root == null || root.getPackageName() == null ? "" : root.getPackageName().toString();
        if (pkg.equals("com.android.intentresolver") || pkg.equals("android")) {
          chooserVisible = true;
          break;
        }
        android.os.SystemClock.sleep(100);
      }
      check(chooserVisible, "System sharing chooser is visible before dismissing it");
      // The chooser opens; do not choose a recipient or send anything.
      getUiAutomation()
          .injectInputEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK), true);
      getUiAutomation()
          .injectInputEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK), true);
      waitForIdleSync();
      getUiAutomation().waitForIdle(300, 5000);
      check(!activity.isFinishing(), "Large-report chooser did not crash the app");
      results.putString(
          "result",
          "PASS "
              + checks
              + " report stream, metadata, path/read-only protection and >3 MiB chooser checks; no"
              + " recipient selected.");
      resultCode = Activity.RESULT_OK;
    } catch (Throwable error) {
      results.putString("failure", error.toString());
    } finally {
      if (activity != null) {
        final Activity owned = activity;
        runOnMainSync(owned::finish);
      }
      try {
        if (latest != null) {
          if (original != null)
            try (FileOutputStream output = new FileOutputStream(latest)) {
              output.write(original);
            }
          else latest.delete();
        }
      } catch (Exception ignored) {
      }
      if (file != null) file.delete();
    }
    finish(resultCode, results);
  }
}
