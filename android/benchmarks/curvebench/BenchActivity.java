package org.fractalexplorer.curvebench;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.AssetFileDescriptor;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Point;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.os.Process;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Foreground-only, standalone measurement tool. It never accesses wallpaper storage. */
public final class BenchActivity extends Activity implements SurfaceHolder.Callback {
  private static final String[] MODES = {
    "Direct decoder → screen",
    "Current GPU playback",
    "Cached GPU playback",
    "Brightness curve",
    "Tone + RGB curves"
  };
  private static final int[][] SIZES = {{1080, 2520}, {2256, 2504}};
  private final Handler main = new Handler();
  private HandlerThread thread;
  private Handler worker;
  private SurfaceView video;
  private Spinner sizes, frameRates;
  private ScrollView controls;
  private int panelHeight;
  private TextView status, details;
  private Button quick, power, stop, share, copy;
  private volatile boolean running, foreground, surfaceReady;
  private volatile int generation;
  private Surface window;
  private MediaPlayer player;
  private CurveGl gl;
  private JSONObject report, phase;
  private JSONArray phases;
  private String reportText, lastSummary = "";
  private int[] profiles;
  private int cursor, mode, width, height;
  private boolean powerTest, measuring, firstFrame, verification;
  private long measurementStart, phaseCpuStart, lastFrame, firstFrameWait;
  private int frames, longGaps;
  private double maxGap;
  private final List<Double> drawMs = new ArrayList<>(),
      cpuMs = new ArrayList<>(),
      serviceMs = new ArrayList<>();
  private JSONArray batterySamples;
  private JSONObject startBattery;
  private int warmMs, measureMs, fps;

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    thread = new HandlerThread("Playback benchmark");
    thread.start();
    worker = new Handler(thread.getLooper());
    verification =
        getIntent().getBooleanExtra("verify", false)
            && (Build.FINGERPRINT.contains("generic")
                || Build.HARDWARE.contains("ranchu")
                || Build.HARDWARE.contains("goldfish"));
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    video = new SurfaceView(this);
    video.getHolder().addCallback(this);
    root.addView(video, new FrameLayout.LayoutParams(-1, -1));
    ScrollView scroll = new ScrollView(this);
    controls = scroll;
    scroll.setBackgroundColor(0xee101813);
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(18), dp(14), dp(18), dp(16));
    scroll.addView(box);
    TextView title = text("Fractal playback benchmark", 21);
    box.addView(title);
    details =
        text(
            "Compares the same clip across five playback paths. Identity curves keep screen"
                + " colors the same.\n\n"
                + "Quick test: about 1 minute per target; measures rendering time, not battery %."
                + " Optional power test: about 6 minutes, unplugged, with whole-phone"
                + " battery-current readings. Background activity can swamp small differences.\n\n"
                + "Fold/unfold before starting. Keep this app open; Stop, Home, screen lock or"
                + " resizing ends the test. It does not change your wallpapers or settings.",
            13);
    box.addView(details);
    sizes = new Spinner(this);
    sizes.setAdapter(
        new ArrayAdapter<>(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            new String[] {
              "Current screen profile",
              "Cover · 1080 × 2520",
              "Main · 2256 × 2504",
              "Both Fold target sizes"
            }));
    box.addView(sizes);
    frameRates = new Spinner(this);
    frameRates.setAdapter(
        new ArrayAdapter<>(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            new String[] {"15 fps · steady playback", "30 fps · entry / smoother loops"}));
    box.addView(frameRates);
    quick = button("Run quick comparison", box, () -> start(false));
    power = button("Run unplugged power comparison", box, () -> start(true));
    stop = button("Stop", box, () -> cancel("Stopped by you"));
    stop.setVisibility(View.GONE);
    status =
        text("Ready. Use a fixed brightness and leave other apps idle for the power test.", 14);
    status.setPadding(0, dp(10), 0, dp(6));
    box.addView(status);
    share =
        button(
            "Share report",
            box,
            () -> {
              if (reportText != null) {
                Intent intent =
                    new Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, "Fractal playback benchmark")
                        .putExtra(Intent.EXTRA_TEXT, reportText);
                startActivity(Intent.createChooser(intent, "Share benchmark report"));
              }
            });
    copy =
        button(
            "Copy report",
            box,
            () -> {
              if (reportText != null) {
                ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE))
                    .setPrimaryClip(
                        ClipData.newPlainText("Fractal playback benchmark", reportText));
                status.setText(lastSummary + "\nReport copied.");
              }
            });
    share.setEnabled(false);
    copy.setEnabled(false);
    FrameLayout.LayoutParams panel = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
    panel.height = Math.min(dp(710), getResources().getDisplayMetrics().heightPixels - dp(40));
    panelHeight = panel.height;
    root.addView(scroll, panel);
    setContentView(root);
    try {
      File previous = new File(getFilesDir(), "latest-report.json");
      if (previous.isFile()) {
        reportText =
            new String(java.nio.file.Files.readAllBytes(previous.toPath()), StandardCharsets.UTF_8);
        share.setEnabled(true);
        copy.setEnabled(true);
      }
    } catch (Exception ignored) {
    }
  }

  private TextView text(String value, int sp) {
    TextView view = new TextView(this);
    view.setText(value);
    view.setTextSize(sp);
    view.setTextColor(0xffdae5df);
    return view;
  }

  private Button button(String label, LinearLayout parent, Runnable action) {
    Button b = new Button(this);
    b.setText(label);
    b.setAllCaps(false);
    b.setOnClickListener(v -> action.run());
    parent.addView(b, new LinearLayout.LayoutParams(-1, dp(48)));
    return b;
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }

  @Override
  protected void onResume() {
    super.onResume();
    foreground = true;
    if (verification && surfaceReady && !running && report == null)
      main.postDelayed(() -> start(getIntent().getBooleanExtra("power", false)), 400);
  }

  @Override
  protected void onPause() {
    foreground = false;
    cancel("App left the foreground");
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    worker.post(
        () -> {
          release();
          thread.quitSafely();
        });
    super.onDestroy();
  }

  @Override
  public void onConfigurationChanged(Configuration config) {
    super.onConfigurationChanged(config);
    panelHeight = Math.min(dp(710), getResources().getDisplayMetrics().heightPixels - dp(40));
    if (!running) {
      FrameLayout.LayoutParams panel = (FrameLayout.LayoutParams) controls.getLayoutParams();
      panel.height = panelHeight;
      controls.setLayoutParams(panel);
    }
    cancel("Screen configuration changed; rerun on this screen");
  }

  @Override
  public void surfaceCreated(SurfaceHolder holder) {
    surfaceReady = true;
    window = holder.getSurface();
    if (verification && foreground && report == null)
      main.postDelayed(() -> start(getIntent().getBooleanExtra("power", false)), 400);
  }

  @Override
  public void surfaceChanged(SurfaceHolder holder, int format, int w, int h) {
    window = holder.getSurface();
  }

  @Override
  public void surfaceDestroyed(SurfaceHolder holder) {
    surfaceReady = false;
    cancel("Video surface closed");
  }

  private void start(boolean battery) {
    if (running || !foreground) return;
    if (!surfaceReady) {
      status.setText("Wait for the video surface, then try again.");
      return;
    }
    JSONObject batteryNow = battery();
    if (battery && batteryNow.optInt("plugged", 0) != 0 && !verification) {
      status.setText(
          "Unplug the charger/USB cable before the power test. Quick comparison also works while"
              + " charging.");
      return;
    }
    long charge = batteryNow.optLong("chargeMicroampHours", Long.MIN_VALUE);
    if (battery
        && !verification
        && batteryNow.isNull("estimatedDischargeMilliwatts")
        && (charge == Long.MIN_VALUE || charge == Integer.MIN_VALUE || charge <= 0)) {
      status.setText(
          "This phone is not exposing usable battery-current or charge-counter readings. Use the"
              + " quick comparison; a power test would not produce a battery estimate.");
      return;
    }
    if (thermal() >= PowerManager.THERMAL_STATUS_SEVERE) {
      status.setText("Let the phone cool before testing.");
      return;
    }
    int selected = sizes.getSelectedItemPosition();
    Point physical = new Point();
    getWindowManager().getDefaultDisplay().getRealSize(physical);
    profiles =
        selected == 3
            ? new int[] {0, 1}
            : new int[] {
              selected == 1
                  ? 0
                  : selected == 2 ? 1 : Math.min(physical.x, physical.y) < 1500 ? 0 : 1
            };
    if (verification && getIntent().getBooleanExtra("both", false)) profiles = new int[] {0, 1};
    fps = frameRates.getSelectedItemPosition() == 1 ? 30 : 15;
    if (verification && getIntent().getIntExtra("fps", fps) == 30) fps = 30;
    powerTest = battery;
    warmMs = verification ? 200 : battery ? 5000 : 2000;
    measureMs = verification ? 1000 : battery ? 30000 : 4000;
    cursor = 0;
    running = true;
    int token = ++generation;
    reportText = null;
    quick.setEnabled(false);
    power.setEnabled(false);
    sizes.setEnabled(false);
    frameRates.setEnabled(false);
    share.setEnabled(false);
    copy.setEnabled(false);
    stop.setVisibility(View.VISIBLE);
    for (View control : new View[] {quick, power, sizes, frameRates, share, copy, details})
      control.setVisibility(View.GONE);
    FrameLayout.LayoutParams compact = (FrameLayout.LayoutParams) controls.getLayoutParams();
    compact.height = dp(205);
    controls.setLayoutParams(compact);
    controls.scrollTo(0, 0);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    try {
      report = new JSONObject();
      phases = new JSONArray();
      report
          .put("format", "fractal-playback-benchmark/v1")
          .put("version", "1.0")
          .put("runKind", battery ? "power-estimate" : "synchronized-render-service")
          .put("verificationRun", verification)
          .put(
              "startedAt",
              new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(new Date()))
          .put("phases", phases)
          .put("device", Build.MANUFACTURER + " " + Build.MODEL)
          .put("fingerprint", Build.FINGERPRINT)
          .put("androidApi", Build.VERSION.SDK_INT)
          .put("windowPixels", new JSONArray(new int[] {physical.x, physical.y}))
          .put("displayRefreshHz", getWindowManager().getDefaultDisplay().getRefreshRate())
          .put("sampleFps", fps)
          .put("warmupMs", warmMs)
          .put("measurementMs", measureMs)
          .put("identityCurves", true)
          .put(
              "method",
              "MediaPlayer decoding the same local H.264 clip. Direct output or ES2"
                  + " external-texture rendering. 2 counterbalanced passes; same source/output size"
                  + " and visible colors. No continuous redraw between video frames. Quick test"
                  + " glFinish measures driver+GPU service time, not GPU-only timer-query time."
                  + " Power test omits glFinish. Battery sensor values are whole-phone estimates,"
                  + " not isolated GPU power.")
          .put(
              "limitations",
              "SurfaceView activity proxy, not the live wallpaper compositor. OEM overlay"
                  + " selection, codec, refresh policy, other apps, temperature and battery-sensor"
                  + " update rate affect results. No battery percentage claim from render timings."
                  + " Identity LUT performance may differ from a particular non-identity grade; a"
                  + " dark grade also changes OLED panel power. Upscaled prerecorded fractal"
                  + " fixtures do not represent every wallpaper bitrate or detail level.")
          .put(
              "brightnessMode",
              Settings.System.getInt(
                  getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, -1))
          .put(
              "brightnessSetting",
              Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, -1))
          .put("startBattery", batteryNow)
          .put("decoders", decoders());
      worker.post(() -> beginPhase(token));
    } catch (Exception error) {
      finish("Could not start: " + error.getMessage());
    }
  }

  private JSONArray decoders() {
    JSONArray result = new JSONArray();
    for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.ALL_CODECS).getCodecInfos())
      if (!info.isEncoder())
        for (String type : info.getSupportedTypes())
          if (type.equalsIgnoreCase("video/avc")) {
            JSONObject row = new JSONObject();
            try {
              row.put("name", info.getName())
                  .put("hardwareAccelerated", info.isHardwareAccelerated())
                  .put("softwareOnly", info.isSoftwareOnly());
              result.put(row);
            } catch (Exception ignored) {
            }
          }
    return result;
  }

  private int thermal() {
    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
    return pm == null ? 0 : pm.getCurrentThermalStatus();
  }

  private JSONObject battery() {
    JSONObject value = new JSONObject();
    try {
      Intent state = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
      BatteryManager manager = (BatteryManager) getSystemService(BATTERY_SERVICE);
      long current = manager.getLongProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW),
          charge = manager.getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER);
      int voltage = state == null ? 0 : state.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0),
          plugged = state == null ? -1 : state.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1);
      value
          .put("elapsedMs", SystemClock.elapsedRealtime())
          .put("currentMicroamps", current)
          .put("chargeMicroampHours", charge)
          .put("voltageMillivolts", voltage)
          .put("plugged", plugged)
          .put(
              "temperatureC",
              state == null
                  ? JSONObject.NULL
                  : state.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10d)
          .put("thermalStatus", thermal());
      double mw = BenchMath.dischargeMilliwatts(current, voltage, plugged != 0);
      value.put("estimatedDischargeMilliwatts", Double.isFinite(mw) ? mw : JSONObject.NULL);
    } catch (Exception e) {
      try {
        value.put("error", e.toString());
      } catch (Exception ignored) {
      }
    }
    return value;
  }

  private void beginPhase(int token) {
    if (!active(token)) return;
    release();
    if (cursor >= profiles.length * BenchMath.order().length) {
      finish("Completed");
      return;
    }
    int profile = profiles[cursor / BenchMath.order().length];
    mode = BenchMath.order()[cursor % BenchMath.order().length];
    boolean smallFixture = verification && !getIntent().getBooleanExtra("native", false);
    width = smallFixture ? 96 : SIZES[profile][0];
    height = smallFixture ? 128 : SIZES[profile][1];
    measuring = false;
    firstFrame = false;
    frames = longGaps = 0;
    lastFrame = 0;
    maxGap = 0;
    drawMs.clear();
    cpuMs.clear();
    serviceMs.clear();
    batterySamples = new JSONArray();
    try {
      phase =
          new JSONObject()
              .put("ordinal", cursor)
              .put("mode", mode)
              .put("name", MODES[mode])
              .put("profile", profile == 0 ? "cover" : "main")
              .put("width", width)
              .put("height", height);
      main.post(
          () -> {
            if (!active(token)) return;
            video.getHolder().setFixedSize(width, height);
            details.setVisibility(View.GONE);
            status.setText(
                String.format(
                    Locale.US,
                    "%d / %d · %s\n%d × %d · warming up…",
                    cursor + 1,
                    profiles.length * 10,
                    MODES[mode],
                    width,
                    height));
            // SurfaceHolder size changes are asynchronous. Start once the new size arrives.
            worker.postDelayed(() -> prepare(token, profile, 0), 100);
          });
    } catch (Exception error) {
      phaseError(token, error);
    }
  }

  private void prepare(int token, int profile, int tries) {
    if (!active(token)) return;
    if (video.getHolder().getSurfaceFrame().width() != width
        || video.getHolder().getSurfaceFrame().height() != height) {
      if (tries >= 40) {
        phaseError(token, new IllegalStateException("Surface did not reach target dimensions"));
        return;
      }
      worker.postDelayed(() -> prepare(token, profile, tries + 1), 50);
      return;
    }
    try {
      final JSONObject expected = phase;
      if (mode != 0) {
        gl =
            new CurveGl(
                window,
                width,
                height,
                mode,
                worker,
                () -> {
                  if (phase == expected) onFrame(token);
                });
        phase
            .put("gpuVendor", gl.vendor)
            .put("gpuRenderer", gl.renderer)
            .put("glVersion", gl.version)
            .put("precision", gl.precision);
      }
      player = new MediaPlayer();
      player.setSurface(gl == null ? window : gl.decoderSurface);
      player.setVolume(0, 0);
      player.setLooping(true);
      String asset =
          (width == 96 ? "verify" : profile == 0 ? "cover" : "main")
              + (fps == 30 ? "-30" : "")
              + ".mp4";
      try (AssetFileDescriptor file = getAssets().openFd(asset)) {
        player.setDataSource(file.getFileDescriptor(), file.getStartOffset(), file.getLength());
      }
      phase.put("asset", asset);
      firstFrameWait = SystemClock.elapsedRealtime();
      player.setOnErrorListener(
          (p, what, extra) -> {
            if (active(token) && p == player && phase == expected)
              phaseError(token, new IllegalStateException("MediaPlayer " + what + " / " + extra));
            return true;
          });
      player.setOnInfoListener(
          (p, what, extra) -> {
            if (active(token)
                && p == player
                && phase == expected
                && mode == 0
                && what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) renderingStarted(token);
            return false;
          });
      player.setOnPreparedListener(
          p -> {
            if (active(token) && p == player && phase == expected) p.start();
          });
      player.prepareAsync();
      final JSONObject pending = phase;
      worker.postDelayed(
          () -> {
            if (active(token) && phase == pending && !firstFrame)
              phaseError(token, new IllegalStateException("No decoded frame within 15 seconds"));
          },
          15000);
    } catch (Exception error) {
      phaseError(token, error);
    }
  }

  private boolean active(int token) {
    return running && foreground && surfaceReady && generation == token;
  }

  private void renderingStarted(int token) {
    if (firstFrame || !active(token)) return;
    firstFrame = true;
    try {
      phase.put("firstFrameLatencyMs", SystemClock.elapsedRealtime() - firstFrameWait);
    } catch (Exception ignored) {
    }
    JSONObject currentPhase = phase;
    worker.postDelayed(
        () -> {
          if (active(token) && phase == currentPhase) startMeasurement(token);
        },
        warmMs);
  }

  private void onFrame(int token) {
    if (!active(token) || gl == null) return;
    try {
      gl.draw(measuring && !powerTest);
      renderingStarted(token);
      if (measuring) {
        long time = SystemClock.elapsedRealtime();
        frames++;
        if (lastFrame != 0) {
          long gap = time - lastFrame;
          maxGap = Math.max(maxGap, gap);
          if (gap > 120) longGaps++;
        }
        lastFrame = time;
        drawMs.add(gl.drawNanos / 1e6);
        cpuMs.add(gl.threadCpuNanos / 1e6);
        serviceMs.add(gl.serviceNanos / 1e6);
      }
    } catch (Exception error) {
      phaseError(token, error);
    }
  }

  private void startMeasurement(int token) {
    if (!active(token)) return;
    measuring = true;
    measurementStart = SystemClock.elapsedRealtime();
    phaseCpuStart = Process.getElapsedCpuTime();
    startBattery = battery();
    sampleBattery(token, phase);
    main.post(
        () -> {
          if (active(token))
            status.setText(
                String.format(
                    Locale.US,
                    "%d / %d · %s\n%d × %d · measuring %d s",
                    cursor + 1,
                    profiles.length * 10,
                    MODES[mode],
                    width,
                    height,
                    measureMs / 1000));
        });
    JSONObject currentPhase = phase;
    worker.postDelayed(
        () -> {
          if (active(token) && phase == currentPhase) endPhase(token);
        },
        measureMs);
  }

  private void sampleBattery(int token, JSONObject expected) {
    if (!active(token) || !measuring || phase != expected) return;
    JSONObject sample = battery();
    batterySamples.put(sample);
    if (sample.optInt("thermalStatus", 0) >= PowerManager.THERMAL_STATUS_SEVERE) {
      cancel("Stopped because the phone became hot");
      return;
    }
    if (powerTest && !verification && sample.optInt("plugged", -1) != 0) {
      cancel("Power test stopped: charger connected");
      return;
    }
    worker.postDelayed(() -> sampleBattery(token, expected), 1000);
  }

  private void endPhase(int token) {
    if (!active(token)) return;
    measuring = false;
    try {
      long duration = SystemClock.elapsedRealtime() - measurementStart;
      phase
          .put("measuredMs", duration)
          .put("appCpuMs", Process.getElapsedCpuTime() - phaseCpuStart)
          .put("frameCallbacks", mode == 0 ? JSONObject.NULL : frames)
          .put("callbackFramesPerSecond", mode == 0 ? JSONObject.NULL : 1000d * frames / duration)
          .put("maxCallbackGapMs", mode == 0 ? JSONObject.NULL : maxGap)
          .put("callbackGapsOver120Ms", mode == 0 ? JSONObject.NULL : longGaps)
          .put("drawFinishEnabled", !powerTest && mode != 0)
          .put("drawServiceMs", stats(drawMs))
          .put("glThreadCpuMs", stats(cpuMs))
          .put("callbackThroughSwapMs", stats(serviceMs))
          .put("batteryStart", startBattery)
          .put("batteryEnd", battery())
          .put("batterySamples", batterySamples);
      try {
        phase.put("playerMetrics", bundleJson(player.getMetrics()));
      } catch (Exception error) {
        phase.put("playerMetricsError", error.toString());
      }
      if (mode != 0 && frames < measureMs / 1000d * fps * .65)
        phase.put(
            "warning",
            "Too few frame callbacks; inspect decoder/dropped frames before comparing timing.");
      phases.put(phase);
      cursor++;
      beginPhase(token);
    } catch (Exception error) {
      phaseError(token, error);
    }
  }

  private static JSONObject bundleJson(android.os.PersistableBundle bundle) throws Exception {
    JSONObject out = new JSONObject();
    if (bundle == null) return out;
    for (String key : bundle.keySet()) {
      Object value = bundle.get(key);
      if (value instanceof Number && !Double.isFinite(((Number) value).doubleValue())) continue;
      if (value instanceof Number || value instanceof Boolean || value instanceof String)
        out.put(key, value);
    }
    return out;
  }

  private static JSONObject stats(List<Double> values) throws Exception {
    JSONObject out = new JSONObject().put("count", values.size());
    if (!values.isEmpty())
      out.put("median", BenchMath.percentile(values, .5))
          .put("p95", BenchMath.percentile(values, .95));
    return out;
  }

  private void phaseError(int token, Exception error) {
    if (!active(token)) return;
    measuring = false;
    try {
      phase.put("error", error.toString());
      phases.put(phase);
    } catch (Exception ignored) {
    }
    release();
    cursor++;
    worker.postDelayed(() -> beginPhase(token), 250);
  }

  private void release() {
    measuring = false;
    if (player != null) {
      player.setOnErrorListener(null);
      player.setOnInfoListener(null);
      player.setOnPreparedListener(null);
      try {
        player.release();
      } catch (Exception ignored) {
      }
      player = null;
    }
    if (gl != null) {
      try {
        gl.close();
      } catch (Exception ignored) {
      }
      gl = null;
    }
  }

  private void cancel(String reason) {
    if (!running) return;
    running = false;
    ++generation;
    worker.post(
        () -> {
          try {
            if (phase != null && measuring) {
              phase
                  .put("incomplete", true)
                  .put("measuredMs", SystemClock.elapsedRealtime() - measurementStart)
                  .put("batterySamples", batterySamples);
              phases.put(phase);
            }
          } catch (Exception ignored) {
          }
          release();
          finish(reason);
        });
  }

  private void finish(String reason) {
    running = false;
    ++generation;
    release();
    try {
      int failures = 0;
      for (int i = 0; i < phases.length(); i++)
        if (phases.getJSONObject(i).has("error")) failures++;
      report.put("outcome", reason).put("failedBlocks", failures).put("endBattery", battery());
      reportText = report.toString(2);
      try (FileOutputStream output =
          new FileOutputStream(new File(getFilesDir(), "latest-report.json"))) {
        output.write(reportText.getBytes(StandardCharsets.UTF_8));
      }
      String saved = saveDownloads(reportText);
      StringBuilder summary =
          new StringBuilder(reason)
              .append(" · ")
              .append(phases.length())
              .append(" / ")
              .append(profiles.length * 10)
              .append(" blocks\n");
      if (failures > 0)
        summary.append(failures).append(" failed blocks; inspect the report before comparing.\n");
      for (int profile : profiles)
        for (int kind = powerTest ? 0 : 1; kind < 5; kind++) {
          List<Double> medians = new ArrayList<>();
          for (int i = 0; i < phases.length(); i++) {
            JSONObject p = phases.getJSONObject(i);
            if (p.optInt("mode") == kind
                && p.optString("profile").equals(profile == 0 ? "cover" : "main")
                && !p.has("error")
                && !p.optBoolean("incomplete")) {
              if (powerTest) {
                JSONArray readings = p.optJSONArray("batterySamples");
                List<Double> watts = new ArrayList<>();
                if (readings != null)
                  for (int b = 0; b < readings.length(); b++) {
                    double mw =
                        readings
                            .getJSONObject(b)
                            .optDouble("estimatedDischargeMilliwatts", Double.NaN);
                    if (Double.isFinite(mw)) watts.add(mw);
                  }
                if (!watts.isEmpty()) medians.add(BenchMath.percentile(watts, .5));
              } else {
                JSONObject s = p.optJSONObject("drawServiceMs");
                if (s != null && s.optInt("count") > 0) medians.add(s.getDouble("median"));
              }
            }
          }
          if (!medians.isEmpty())
            summary
                .append(profile == 0 ? "Cover · " : "Main · ")
                .append(MODES[kind])
                .append(": ")
                .append(
                    String.format(
                        Locale.US,
                        powerTest ? "~%.0f mW whole phone\n" : "%.3f ms\n",
                        BenchMath.percentile(medians, .5)));
        }
      summary
          .append(
              powerTest
                  ? "Power readings are in the report; they need repeated A/B analysis.\n"
                  : "Times include driver/GPU service, not battery consumption.\n")
          .append(saved);
      lastSummary = summary.toString();
    } catch (Exception error) {
      lastSummary = reason + "\nCould not save report: " + error.getMessage();
    }
    main.post(
        () -> {
          getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
          quick.setEnabled(true);
          power.setEnabled(true);
          sizes.setEnabled(true);
          frameRates.setEnabled(true);
          share.setEnabled(reportText != null);
          copy.setEnabled(reportText != null);
          stop.setVisibility(View.GONE);
          for (View control : new View[] {quick, power, sizes, frameRates, share, copy, details})
            control.setVisibility(View.VISIBLE);
          FrameLayout.LayoutParams expanded = (FrameLayout.LayoutParams) controls.getLayoutParams();
          expanded.height = panelHeight;
          controls.setLayoutParams(expanded);
          status.setText(lastSummary);
        });
  }

  private String saveDownloads(String text) {
    Uri uri = null;
    try {
      ContentValues values = new ContentValues();
      values.put(
          MediaStore.Downloads.DISPLAY_NAME,
          "fractal-playback-benchmark-"
              + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date())
              + ".json");
      values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
      values.put(MediaStore.Downloads.RELATIVE_PATH, "Download/FractalBench");
      values.put(MediaStore.Downloads.IS_PENDING, 1);
      uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
      if (uri == null) throw new IllegalStateException("Downloads provider unavailable");
      try (OutputStream output = getContentResolver().openOutputStream(uri)) {
        if (output == null) throw new IllegalStateException("No output stream");
        output.write(text.getBytes(StandardCharsets.UTF_8));
      }
      ContentValues done = new ContentValues();
      done.put(MediaStore.Downloads.IS_PENDING, 0);
      getContentResolver().update(uri, done, null, null);
      return "Saved in Downloads/FractalBench. Share or copy the report back.";
    } catch (Exception error) {
      if (uri != null)
        try {
          getContentResolver().delete(uri, null, null);
        } catch (Exception ignored) {
        }
      return "Saved privately; use Share report or Copy report.";
    }
  }
}
