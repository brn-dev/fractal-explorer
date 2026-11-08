package org.fractalexplorer.wallpaper;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executor;
import java.util.zip.*;
import org.json.*;

/**
 * Actual production store/downloader/ZIP/state code, using a local transport and manual executor.
 */
public final class WebAppUpdatesTest {
  static int checks;
  static File workspace;

  static void check(boolean ok, String why) {
    checks++;
    if (!ok) throw new AssertionError(why);
  }

  interface Task {
    void run() throws Exception;
  }

  static void fails(Task task, String why) throws Exception {
    boolean failed = false;
    try {
      task.run();
    } catch (Exception expected) {
      failed = true;
    }
    check(failed, why);
  }

  static String id(int n) {
    return String.format("%064x", n);
  }

  static byte[] bytes(String s) {
    return s.getBytes(StandardCharsets.UTF_8);
  }

  static String hash(byte[] b) throws Exception {
    StringBuilder out = new StringBuilder();
    for (byte v : MessageDigest.getInstance("SHA-256").digest(b))
      out.append(String.format("%02x", v & 255));
    return out.toString();
  }

  static String text(InputStream input) throws Exception {
    try (InputStream in = input) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  static final class Queue implements Executor {
    final List<Runnable> tasks = new ArrayList<>();

    public void execute(Runnable task) {
      tasks.add(task);
    }

    void run() {
      check(tasks.size() == 1, "one background job");
      tasks.remove(0).run();
    }
  }

  static final class Bundle {
    final JSONObject manifest;
    byte[] archive;
    final LinkedHashMap<String, byte[]> files = new LinkedHashMap<>();

    Bundle(int n, long time, int min) throws Exception {
      files.put("index.html", bytes("release-" + n));
      files.put("assets/code.js", bytes("code-" + n));
      files.put(
          "android-web-info.json",
          bytes(
              new JSONObject()
                  .put("id", id(n))
                  .put("builtAt", time)
                  .put("minVersionCode", min)
                  .toString()));
      manifest =
          new JSONObject()
              .put("format", "fractal-explorer-web-update/v1")
              .put("id", id(n))
              .put("builtAt", time)
              .put("minVersionCode", min)
              .put("archive", "bundle-" + id(n) + ".zip");
      JSONArray entries = new JSONArray();
      for (Map.Entry<String, byte[]> e : files.entrySet())
        entries.put(
            new JSONObject()
                .put("name", e.getKey())
                .put("bytes", e.getValue().length)
                .put("sha256", hash(e.getValue())));
      manifest.put("files", entries);
      pack(files);
    }

    void pack(Map<String, byte[]> contents) throws Exception {
      ByteArrayOutputStream buffer = new ByteArrayOutputStream();
      try (ZipOutputStream zip = new ZipOutputStream(buffer)) {
        for (Map.Entry<String, byte[]> e : contents.entrySet()) {
          zip.putNextEntry(new ZipEntry(e.getKey()));
          zip.write(e.getValue());
          zip.closeEntry();
        }
      }
      setArchive(buffer.toByteArray());
    }

    void setArchive(byte[] data) throws Exception {
      archive = data;
      manifest.put("bytes", archive.length).put("sha256", hash(archive));
    }
  }

  static final class Transport implements WebAppUpdates.Transport {
    Bundle bundle;
    int requests, archives;
    boolean offline, interrupt;
    Runnable onArchive;

    public InputStream open(String name) throws IOException {
      requests++;
      if (offline) throw new IOException("offline");
      if (name.equals("latest.json"))
        return new ByteArrayInputStream(bytes(bundle.manifest.toString()));
      archives++;
      if (onArchive != null) onArchive.run();
      if (interrupt)
        return new FilterInputStream(new ByteArrayInputStream(bundle.archive)) {
          boolean read;

          @Override
          public int read(byte[] b, int o, int l) throws IOException {
            if (read) throw new IOException("interrupted");
            read = true;
            return super.read(b, o, Math.min(l, 10));
          }
        };
      return new ByteArrayInputStream(bundle.archive);
    }
  }

  static final class Fixture {
    final File root;
    final Queue queue = new Queue();
    final Transport network = new Transport();
    final WebAppUpdates.Assets assets;
    WebAppUpdates store;
    WebAppUpdates.Session session;

    Fixture(String name) throws Exception {
      root = new File(workspace, name + "-" + UUID.randomUUID());
      check(root.mkdirs(), "create isolated store");
      assets =
          path -> {
            if (path.equals("android-web-info.json"))
              return new ByteArrayInputStream(
                  bytes("{\"id\":\"" + id(1) + "\",\"builtAt\":1000,\"minVersionCode\":22}"));
            if (path.equals("index.html")) return new ByteArrayInputStream(bytes("bundled"));
            if (path.equals("assets/code.js"))
              return new ByteArrayInputStream(bytes("bundled-code"));
            throw new FileNotFoundException(path);
          };
      restart(22);
    }

    void restart(int apk) throws Exception {
      store = new WebAppUpdates(root, assets, apk, network, queue);
      session = store.openSession();
    }

    JSONObject status() throws Exception {
      return store.status(session);
    }

    void download(Bundle b) throws Exception {
      network.bundle = b;
      store.check(true);
      check(status().getBoolean("checking"), "check scheduled asynchronously");
      check(
          text(session.open("index.html")).startsWith("bundled") || session.release != null,
          "running session stays readable while checking");
      queue.run();
      check(!status().getBoolean("checking"), "check finishes");
    }

    void install(Bundle b) throws Exception {
      download(b);
      check(status().getBoolean("available"), "valid update is available");
      session = store.activate(session);
      store.confirm(session, b.manifest.getString("id"));
    }
  }

  static void lifecycle() throws Exception {
    Fixture f = new Fixture("lifecycle");
    Bundle first = new Bundle(2, 2000, 22);
    WebAppUpdates.Session other = f.store.openSession();
    f.download(first);
    check(text(f.session.open("index.html")).equals("bundled"), "download does not activate");
    f.session = f.store.activate(f.session);
    check(
        text(f.session.open("index.html")).equals("release-2"),
        "activation selects complete new release");
    check(
        text(f.session.open("assets/code.js")).equals("code-2"),
        "matching JS comes from same release");
    check(
        text(other.open("index.html")).equals("bundled")
            && text(other.open("assets/code.js")).equals("bundled-code"),
        "other WebView remains pinned");
    fails(() -> f.session.open("../state.json"), "no traversal");
    fails(() -> f.session.open(".release.json"), "private metadata not served");
    fails(() -> f.session.open("missing.js"), "no mixing with bundled assets for missing files");
    fails(() -> f.store.confirm(f.session, id(99)), "wrong-version boot acknowledgement rejected");
    f.store.confirm(f.session, id(2));
    other.close();
    f.session.close();
    f.restart(22);
    check(
        text(f.session.open("index.html")).equals("release-2"),
        "confirmed update survives restart offline");
    int requests = f.network.requests;
    f.store.check(false);
    check(
        f.network.requests == requests && f.queue.tasks.isEmpty(),
        "automatic checks are throttled across restarts");
    f.install(new Bundle(3, 3000, 22));
    f.session.close();
    Files.write(new File(f.root, id(3) + "/assets/code.js").toPath(), bytes("corrupt"));
    f.restart(22);
    check(
        text(f.session.open("index.html")).equals("release-2"),
        "corrupt active release falls back to previous valid release");
    f.download(new Bundle(3, 3000, 22));
    check(!f.status().getBoolean("available"), "failed version is not reoffered");
    f.session.close();
    f.restart(23);
    check(
        text(f.session.open("index.html")).equals("bundled"),
        "APK update chooses its own bundled web assets");
    check(!new File(f.root, id(2)).exists(), "unused release removed on process startup");
    f.session.close();
  }

  static void rollback() throws Exception {
    for (boolean processRestart : new boolean[] {false, true}) {
      Fixture f = new Fixture("unconfirmed");
      f.download(new Bundle(2, 2000, 22));
      f.session = f.store.activate(f.session);
      f.session.close();
      if (processRestart) f.restart(22);
      else f.session = f.store.openSession();
      check(
          text(f.session.open("index.html")).equals("bundled"),
          "unacknowledged boot rolls back on reopen/restart");
      check(f.status().getString("error").contains("did not finish"), "rollback is visible");
      f.session.close();
    }
    Fixture f = new Fixture("restore");
    f.install(new Bundle(2, 2000, 22));
    f.session = f.store.restoreBundled(f.session);
    check(text(f.session.open("index.html")).equals("bundled"), "manual native recovery works");
    f.download(new Bundle(2, 2000, 22));
    check(!f.status().getBoolean("available"), "manual restoration skips same web release");
    f.install(new Bundle(3, 3000, 22));
    check(
        text(f.session.open("index.html")).equals("release-3"),
        "newer release can update after recovery");
    f.session.close();
  }

  static void compatibilityAndFailures() throws Exception {
    Fixture f = new Fixture("compat");
    f.download(new Bundle(2, 2000, 23));
    check(
        f.status().getInt("requiresApk") == 23
            && !f.status().getBoolean("available")
            && f.network.archives == 0,
        "native compatibility gate rejects before download");
    f.download(new Bundle(2, 999, 22));
    check(f.network.archives == 0, "older website cannot downgrade bundled explorer");
    f.network.offline = true;
    f.network.bundle = new Bundle(2, 2000, 22);
    f.store.check(true);
    f.queue.run();
    check(
        text(f.session.open("index.html")).equals("bundled")
            && f.status().getString("error").contains("offline"),
        "network failure retains offline explorer");
    f.session.close();
    for (String mode :
        new String[] {
          "checksum",
          "interrupted",
          "member-hash",
          "missing",
          "extra",
          "traversal",
          "central-directory",
          "identity"
        }) {
      f = new Fixture(mode);
      Bundle b = new Bundle(2, 2000, 22);
      if (mode.equals("checksum")) b.archive[12] ^= 1;
      if (mode.equals("interrupted")) f.network.interrupt = true;
      if (mode.equals("member-hash")) {
        b.files.put("assets/code.js", bytes("wrong-content"));
        b.pack(b.files);
      }
      if (mode.equals("missing")) {
        b.files.remove("assets/code.js");
        b.pack(b.files);
      }
      if (mode.equals("extra")) {
        b.files.put("unexpected.js", bytes("extra"));
        b.pack(b.files);
      }
      if (mode.equals("traversal")) {
        b.files.put("../outside.txt", bytes("escape"));
        b.pack(b.files);
      }
      if (mode.equals("central-directory"))
        b.setArchive(Arrays.copyOf(b.archive, b.archive.length - 22));
      if (mode.equals("identity")) {
        b.files.put(
            "android-web-info.json",
            bytes("{\"id\":\"" + id(9) + "\",\"builtAt\":2000,\"minVersionCode\":22}"));
        b.pack(b.files);
        JSONArray entries = b.manifest.getJSONArray("files");
        for (int i = 0; i < entries.length(); i++)
          if (entries.getJSONObject(i).getString("name").equals("android-web-info.json")) {
            entries
                .getJSONObject(i)
                .put("bytes", b.files.get("android-web-info.json").length)
                .put("sha256", hash(b.files.get("android-web-info.json")));
          }
      }
      f.download(b);
      check(
          !f.status().getBoolean("available") && !f.status().getString("error").isEmpty(),
          "invalid update rejected: " + mode);
      check(
          text(f.session.open("index.html")).equals("bundled"),
          "failed update leaves active content intact: " + mode);
      check(
          Arrays.stream(f.root.list())
              .noneMatch(n -> n.startsWith("pending-") || n.startsWith("download-")),
          "failed staging files cleaned: " + mode);
      check(!new File(f.root, "outside.txt").exists(), "no traversal file created");
      f.session.close();
    }
    for (String path :
        new String[] {
          "../bad.js",
          "/bad.js",
          "C:/bad.js",
          "assets\\bad.js",
          "assets//bad.js",
          "assets/./bad.js",
          "assets/%2e.js"
        }) {
      Bundle b = new Bundle(2, 2000, 22);
      b.manifest.getJSONArray("files").getJSONObject(0).put("name", path);
      fails(() -> new WebAppUpdates.Release(b.manifest), "bad manifest path " + path);
    }
    Bundle duplicates = new Bundle(2, 2000, 22);
    duplicates
        .manifest
        .getJSONArray("files")
        .put(
            new JSONObject(duplicates.manifest.getJSONArray("files").getJSONObject(0).toString())
                .put("name", "INDEX.HTML"));
    fails(() -> new WebAppUpdates.Release(duplicates.manifest), "case-colliding files rejected");
    for (String key : new String[] {"minVersionCode", "bytes", "builtAt"})
      for (Object value : new Object[] {-1, 22.5, "22", Double.MAX_VALUE}) {
        Bundle malformed = new Bundle(2, 2000, 22);
        malformed.manifest.put(key, value);
        fails(
            () -> new WebAppUpdates.Release(malformed.manifest), "invalid number rejected: " + key);
      }
  }

  static void persistenceAndRaces() throws Exception {
    Fixture f = new Fixture("ready-persistence");
    Bundle first = new Bundle(2, 2000, 22);
    f.download(first);
    f.session.close();
    f.restart(22);
    check(
        f.status().getBoolean("available"),
        "ready release survives process restart without changing active");
    File state = new File(f.root, "state.json"), backup = new File(f.root, "state-backup");
    Files.move(state.toPath(), backup.toPath());
    check(state.mkdir(), "inject failed state replacement");
    final Fixture failed = f;
    fails(
        () -> failed.store.activate(failed.session),
        "failed atomic pointer change rejects activation");
    check(
        text(f.session.open("index.html")).equals("bundled") && f.status().getBoolean("available"),
        "failed activation leaves old session and ready candidate intact");
    Files.delete(state.toPath());
    Files.move(backup.toPath(), state.toPath());
    f.session = f.store.activate(f.session);
    f.store.confirm(f.session, id(2));
    f.session.close();
    Fixture race = new Fixture("check-recovery-race");
    race.network.onArchive =
        () -> {
          try {
            race.session = race.store.restoreBundled(race.session);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        };
    race.download(new Bundle(2, 2000, 22));
    check(
        !race.status().getBoolean("available")
            && text(race.session.open("index.html")).equals("bundled"),
        "check finishing after recovery cannot publish stale ready selection");
    race.session.close();
    File abandoned = new File(race.root, "pending-" + UUID.randomUUID());
    check(abandoned.mkdir(), "create interrupted staging directory");
    Files.write(new File(abandoned, "partial.js").toPath(), bytes("partial"));
    race.restart(22);
    check(!abandoned.exists(), "interrupted staging cleaned on next process start");
    race.session.close();
    Fixture closed = new Fixture("background-download");
    closed.network.onArchive = () -> closed.session.close();
    closed.network.bundle = new Bundle(2, 2000, 22);
    closed.store.check(true);
    closed.queue.run();
    closed.session = closed.store.openSession();
    check(
        closed.status().getBoolean("available"),
        "closing the last WebView does not cancel or delete an in-flight download");
    closed.session.close();
    Fixture gc = new Fixture("closed-session-pruning");
    gc.install(new Bundle(2, 2000, 22));
    gc.install(new Bundle(3, 3000, 22));
    gc.install(new Bundle(4, 4000, 22));
    gc.session.close();
    check(
        !new File(gc.root, id(2)).exists()
            && new File(gc.root, id(3)).isDirectory()
            && new File(gc.root, id(4)).isDirectory(),
        "last close prunes old releases but keeps active and previous");
    gc.session = gc.store.openSession();
    gc.session = gc.store.restoreBundled(gc.session);
    gc.session.close();
    gc.session = gc.store.openSession();
    int downloads = gc.network.archives;
    gc.install(new Bundle(2, 2000, 22));
    check(
        gc.network.archives == downloads + 1
            && text(gc.session.open("index.html")).equals("release-2"),
        "pruned releases are re-downloaded instead of using stale verified metadata");
    gc.session.close();
  }

  static void actualBundle(File dist) throws Exception {
    JSONObject manifest =
        new JSONObject(Files.readString(new File(dist, "android-web/latest.json").toPath()));
    new WebAppUpdates.Release(manifest);
    JSONArray published = manifest.getJSONArray("files");
    for (int i = 0; i < published.length(); i++) {
      JSONObject file = published.getJSONObject(i);
      check(
          hash(Files.readAllBytes(new File(dist, file.getString("name")).toPath()))
              .equals(file.getString("sha256")),
          "published static file and native payload stay identical: " + file.getString("name"));
    }
    Fixture f = new Fixture("actual-node-package");
    if (manifest.getInt("minVersionCode") > 22) {
      f.session.close();
      f.restart(manifest.getInt("minVersionCode"));
    }
    Bundle actual = new Bundle(2, 2000, 22);
    for (String key : new ArrayList<>(actual.manifest.keySet())) actual.manifest.remove(key);
    for (String key : manifest.keySet()) actual.manifest.put(key, manifest.get(key));
    actual.archive =
        Files.readAllBytes(new File(dist, "android-web/" + manifest.getString("archive")).toPath());
    f.download(actual);
    check(
        f.status().getBoolean("available"),
        "real Node-generated production archive accepted by Java installer");
    f.session = f.store.activate(f.session);
    f.store.confirm(f.session, manifest.getString("id"));
    check(
        text(f.session.open("index.html")).contains("Fractal Explorer"),
        "actual production HTML served");
    f.session.close();
  }

  public static void main(String[] args) throws Exception {
    workspace = new File(args[0]).getCanonicalFile();
    check(workspace.isDirectory(), "test workspace exists");
    lifecycle();
    rollback();
    compatibilityAndFailures();
    persistenceAndRaces();
    actualBundle(new File(args[1]));
    System.out.println(
        "PASS "
            + checks
            + " native web updater assertions over production download, ZIP, session and persistent"
            + " state code; local transport, no device/network test.");
  }
}
