package org.fractalexplorer.wallpaper;

import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.concurrent.CancellationException;
import org.json.JSONObject;

/**
 * One foreground conversion at a time. Originals, active selections and shuffle pools are
 * untouched.
 */
final class WallpaperBakeJobs {
  private static Job active;

  static synchronized Job start(
      Context context, String id, String screen, WallpaperColorGrade grade, JSONObject options)
      throws Exception {
    return start(context, id, screen, grade, options, null);
  }

  static synchronized Job start(
      Context context,
      String id,
      String screen,
      WallpaperColorGrade grade,
      JSONObject options,
      Runnable finished)
      throws Exception {
    if (active != null && !active.terminal())
      throw new IOException("A corrected copy is already being saved");
    String name = options.getString("name").trim(),
        quality = options.optString("quality", "dynamic-high");
    double bitrate = options.optDouble("bitrateMbps", 20);
    if (name.isEmpty() || name.length() > 80)
      throw new IOException("Choose a copy name of 1–80 characters");
    if (!java.util.Arrays.asList("dynamic-high", "dynamic-balanced", "maximum", "custom")
        .contains(quality)) throw new IOException("Unknown video quality");
    if (!Double.isFinite(bitrate) || bitrate < .5 || bitrate > 600)
      throw new IOException("Choose a bitrate from 0.5 to 600 Mbps");
    if (!PackPolicy.validId(id) || !("cover".equals(screen) || "inner".equals(screen)))
      throw new IOException("Invalid wallpaper selection");
    Job job =
        new Job(
            context.getApplicationContext(), id, screen, grade, name, quality, bitrate, finished);
    active = job;
    try {
      Thread thread = new Thread(job::run, "Wallpaper color conversion");
      thread.setDaemon(true);
      thread.start();
    } catch (RuntimeException | OutOfMemoryError e) {
      active = null;
      throw e;
    }
    return job;
  }

  static final class Job {
    final String token = WallpaperFiles.newId();
    private final Context context;
    private final String sourceId, screen, name, quality;
    private final WallpaperColorGrade grade;
    private final double bitrate;
    private final Runnable finished;
    private volatile String state = "running",
        message = "Preparing a media copy…",
        result = "",
        error = "";
    private volatile double progress;
    private volatile boolean cancelled;

    Job(
        Context context,
        String sourceId,
        String screen,
        WallpaperColorGrade grade,
        String name,
        String quality,
        double bitrate,
        Runnable finished) {
      this.context = context;
      this.sourceId = sourceId;
      this.screen = screen;
      this.grade = grade;
      this.name = name;
      this.quality = quality;
      this.bitrate = bitrate;
      this.finished = finished;
    }

    boolean terminal() {
      return "completed".equals(state) || "cancelled".equals(state) || "failed".equals(state);
    }

    synchronized void cancel() {
      if ("running".equals(state)) {
        cancelled = true;
        message = "Cancelling…";
      }
    }

    void check() {
      if (cancelled) throw new CancellationException("Corrected copy cancelled");
    }

    JSONObject status() throws Exception {
      return new JSONObject()
          .put("job", token)
          .put("state", state)
          .put("message", message)
          .put("progress", progress)
          .put("id", result)
          .put("error", error)
          .put("canCancel", "running".equals(state) && !cancelled);
    }

    private void run() {
      WallpaperFiles files = new WallpaperFiles(context);
      File input = null, output = null;
      String outcome = "failed";
      try {
        WallpaperGallery gallery = new WallpaperGallery(context);
        input = files.staging();
        JSONObject manifest = gallery.copyForCorrection(sourceId, screen, input);
        check();
        output = files.staging();
        String kind = manifest.optString("kind", "animated");
        int videos = PackPolicy.isStatic(kind) ? 0 : PackPolicy.hasEntry(kind) ? 2 : 1;
        int completed = 0;
        for (int i = 0; i < PackPolicy.VIDEOS.length; i++) {
          String file = PackPolicy.VIDEOS[i];
          if (!PackPolicy.files(screen, kind).contains(file)) continue;
          check();
          message =
              file.endsWith("arrival.mp4")
                  ? "Correcting the entry transition…"
                  : "Correcting the steady loop…";
          File from = PackPolicy.child(input, file), to = PackPolicy.child(output, file);
          if (!grade.active) Files.copy(from.toPath(), to.toPath());
          else {
            final int before = completed, total = videos + 1;
            JSONObject clip =
                WallpaperTranscoder.convert(
                    from,
                    to,
                    manifest.getJSONObject("clips").getJSONObject(PackPolicy.KEYS[i]),
                    grade,
                    quality,
                    bitrate,
                    new WallpaperTranscoder.Progress() {
                      public void check() {
                        Job.this.check();
                      }

                      public void update(double fraction) {
                        progress = (before + fraction) / total;
                      }
                    });
            manifest.getJSONObject("clips").put(PackPolicy.KEYS[i], clip);
          }
          completed++;
          progress = completed / (double) (videos + 1);
        }
        check();
        message = "Correcting the still image…";
        ColorGradeBitmap.bake(
            PackPolicy.child(input, screen + "-poster.png"),
            PackPolicy.child(output, screen + "-poster.png"),
            grade,
            this::check);
        manifest
            .put("name", name)
            .put("renderCorrection", grade.json)
            .put("renderedFrom", sourceId);
        synchronized (this) {
          check();
          state = "committing";
          message = "Checking and saving the completed copy…";
        }
        result = files.retain(output, manifest);
        progress = 1;
        message = "Corrected copy saved. Select it in the gallery when ready.";
        outcome = "completed";
      } catch (CancellationException e) {
        message = "Cancelled. The original wallpaper is unchanged.";
        outcome = "cancelled";
      } catch (Exception | OutOfMemoryError e) {
        error = e.getMessage() == null ? e.toString() : e.getMessage();
        message = "Could not save corrected copy";
      } finally {
        for (File folder : new File[] {input, output})
          if (folder != null && folder.exists())
            try {
              files.deleteFolder(folder);
            } catch (IOException ignored) {
            }
        try {
          if (finished != null) finished.run();
        } catch (RuntimeException ignored) {
        }
        state = outcome;
      }
    }
  }
}
