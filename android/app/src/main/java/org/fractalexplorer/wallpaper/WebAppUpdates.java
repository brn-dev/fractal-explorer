package org.fractalexplorer.wallpaper;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Complete, verified, session-pinned web releases. No network runs on the WebView/codec thread. */
final class WebAppUpdates {
  static final String BASE = "https://brn-dev.github.io/fractal-explorer/android-web/";
  static final int MAX_ARCHIVE = 32 * 1024 * 1024, MAX_TOTAL = 64 * 1024 * 1024;
  static final long CHECK_INTERVAL = 24 * 60 * 60 * 1000L;

  interface Assets {
    InputStream open(String name) throws IOException;
  }

  interface Transport {
    InputStream open(String name) throws IOException;
  }

  static final class Member {
    final long bytes;
    final String sha256;

    Member(JSONObject json) throws Exception {
      bytes = integer(json, "bytes", 0, MAX_ARCHIVE);
      sha256 = json.getString("sha256");
      if (bytes < 0 || bytes > MAX_ARCHIVE || !digest(sha256))
        throw new IOException("Invalid web file metadata");
    }
  }

  static final class Release {
    final String id, archive, sha256;
    final long builtAt, bytes;
    final int minVersionCode;
    final JSONObject json;
    final Map<String, Member> files = new HashMap<>();

    Release(JSONObject json) throws Exception {
      this.json = json;
      id = json.getString("id");
      archive = json.getString("archive");
      sha256 = json.getString("sha256");
      builtAt = integer(json, "builtAt", 1, 9007199254740991L);
      bytes = integer(json, "bytes", 1, MAX_ARCHIVE);
      minVersionCode = (int) integer(json, "minVersionCode", 22, Integer.MAX_VALUE);
      if (!"fractal-explorer-web-update/v1".equals(json.getString("format"))
          || !digest(id)
          || !digest(sha256)
          || !("bundle-" + id + ".zip").equals(archive)
          || builtAt <= 0
          || minVersionCode < 22
          || bytes <= 0
          || bytes > MAX_ARCHIVE) throw new IOException("Invalid web release metadata");
      JSONArray entries = json.getJSONArray("files");
      if (entries.length() < 2 || entries.length() > 255)
        throw new IOException("Invalid web file count");
      Set<String> names = new HashSet<>();
      long total = 0;
      for (int i = 0; i < entries.length(); i++) {
        JSONObject entry = entries.getJSONObject(i);
        String name = entry.getString("name");
        if (!validPath(name) || !names.add(name.toLowerCase(Locale.ROOT)))
          throw new IOException("Invalid or duplicate web path");
        Member member = new Member(entry);
        files.put(name, member);
        total += member.bytes;
      }
      if (total > MAX_TOTAL
          || !files.containsKey("index.html")
          || !files.containsKey("android-web-info.json"))
        throw new IOException("Incomplete or oversized web release");
    }
  }

  final class Session implements AutoCloseable {
    final String id;
    final long builtAt;
    final Release release;
    private boolean closed;

    Session(Release release) {
      this.release = release;
      id = release == null ? bundledId : release.id;
      builtAt = release == null ? bundledTime : release.builtAt;
    }

    InputStream open(String path) throws Exception {
      synchronized (WebAppUpdates.this) {
        if (closed) throw new IOException("Explorer session closed");
      }
      if (!validPath(path)) throw new IOException("Invalid web path");
      if (release == null) return assets.open(path);
      if (!release.files.containsKey(path)) throw new IOException("Web resource unavailable");
      return new FileInputStream(child(new File(root, id), path));
    }

    @Override
    public void close() {
      synchronized (WebAppUpdates.this) {
        closed = true;
        sessions.remove(this);
        if (sessions.isEmpty() && !checking) {
          try {
            prune();
          } catch (IOException ignored) {
            /* Retry on the next close/start. */
          }
        }
      }
    }
  }

  private final File root;
  private final Assets assets;
  private final int appVersion;
  private final Transport transport;
  private final Executor executor;
  private final String bundledId;
  private final long bundledTime;
  private final Set<Session> sessions = new HashSet<>();
  private final Map<String, Release> verified = new HashMap<>();
  private JSONObject state = new JSONObject();
  private Release active, ready;
  private boolean checking;
  private int requiresApk;
  private long epoch;
  private String error = "";

  WebAppUpdates(File root, Assets assets, int appVersion, Transport transport, Executor executor)
      throws Exception {
    this.root = root.getCanonicalFile();
    this.assets = assets;
    this.appVersion = appVersion;
    this.transport = transport;
    this.executor = executor;
    if (!this.root.isDirectory() && !this.root.mkdirs())
      throw new IOException("Cannot create web update storage");
    JSONObject bundled;
    try (InputStream input = assets.open("android-web-info.json")) {
      bundled = json(input, 4096);
    }
    bundledId = bundled.getString("id");
    bundledTime = bundled.getLong("builtAt");
    if (!digest(bundledId) || bundledTime <= 0 || bundled.getInt("minVersionCode") > appVersion)
      throw new IOException("Invalid bundled explorer identity");
    try (InputStream input = new FileInputStream(new File(this.root, "state.json"))) {
      state = json(input, 16384);
    } catch (Exception ignored) {
      /* A missing/corrupt pointer always falls back to APK assets. */
    }
    if (state.optInt("apk") != appVersion || !bundledId.equals(state.optString("bundled"))) {
      commit(new JSONObject().put("apk", appVersion).put("bundled", bundledId));
    }
    try {
      active = load(state.optString("active"));
    } catch (Exception invalid) {
      rollback("Saved web update unavailable; using the previous explorer.");
    }
    if (state.optBoolean("pending"))
      rollback("The last web update did not finish starting; restored the previous explorer.");
    try {
      ready = load(state.optString("ready"));
    } catch (Exception invalid) {
      JSONObject next = copyState();
      next.remove("ready");
      commit(next);
    }
    try {
      prune();
    } catch (IOException ignored) {
      /* Retry unused-file cleanup on the next process start. */
    }
  }

  synchronized Session openSession() throws Exception {
    if (sessions.isEmpty() && state.optBoolean("pending"))
      rollback("The last web update did not finish starting; restored the previous explorer.");
    return session(active);
  }

  private Session session(Release release) {
    Session result = new Session(release);
    sessions.add(result);
    return result;
  }

  private Release available(Session session) {
    if (ready != null && !ready.id.equals(session.id)) return ready;
    return active != null && !active.id.equals(session.id) ? active : null;
  }

  synchronized JSONObject status(Session session) throws Exception {
    Release candidate = available(session);
    return new JSONObject()
        .put("version", session.id)
        .put("bundled", session.release == null)
        .put("checking", checking)
        .put("available", candidate != null)
        .put("readyVersion", candidate == null ? "" : candidate.id)
        .put("requiresApk", requiresApk)
        .put("error", error)
        .put("checked", state.optLong("checked") > 0);
  }

  synchronized void confirm(Session session, String id) throws Exception {
    if (!sessions.contains(session) || !session.id.equals(id))
      throw new IOException("Explorer version changed during startup");
    if (active != null && active.id.equals(id) && state.optBoolean("pending")) {
      JSONObject next = copyState();
      next.put("pending", false);
      commit(next);
    }
  }

  synchronized Session activate(Session previous) throws Exception {
    if (!sessions.contains(previous)) throw new IOException("Explorer session closed");
    Release selected = available(previous);
    if (selected == null) throw new IOException("No explorer update is ready");
    if (selected != active) {
      JSONObject next = copyState();
      next.put("previous", active == null ? "" : active.id);
      next.put("active", selected.id).put("pending", true);
      next.remove("ready");
      commit(next);
      active = selected;
      ready = null;
    }
    epoch++;
    Session result = session(selected);
    previous.close();
    return result;
  }

  synchronized Session restoreBundled(Session previous) throws Exception {
    if (!sessions.contains(previous)) throw new IOException("Explorer session closed");
    JSONObject next = copyState();
    next.put("blocked", active != null ? active.id : ready != null ? ready.id : "");
    next.remove("active");
    next.remove("previous");
    next.remove("ready");
    next.put("pending", false);
    commit(next);
    active = ready = null;
    epoch++;
    error = "Using the bundled offline explorer.";
    requiresApk = 0;
    Session result = session(null);
    previous.close();
    return result;
  }

  private void rollback(String message) throws Exception {
    String blocked = state.optString("active");
    Release previous = null;
    try {
      previous = load(state.optString("previous"));
    } catch (Exception ignored) {
    }
    JSONObject next = copyState();
    next.put("active", previous == null ? "" : previous.id);
    next.remove("previous");
    next.remove("ready");
    next.put("pending", false).put("blocked", blocked);
    commit(next);
    active = previous;
    ready = null;
    error = message;
    epoch++;
  }

  synchronized void check(boolean force) throws Exception {
    long now = System.currentTimeMillis();
    if (checking
        || (!force
            && now - state.optLong("checked") >= 0
            && now - state.optLong("checked") < CHECK_INTERVAL)) return;
    JSONObject next = copyState();
    next.put("checked", now);
    commit(next);
    checking = true;
    error = "";
    requiresApk = 0;
    final long token = epoch;
    try {
      executor.execute(() -> downloadCheck(token));
    } catch (RuntimeException failure) {
      checking = false;
      throw failure;
    }
  }

  private void downloadCheck(long token) {
    try {
      Release incoming;
      try (InputStream input = transport.open("latest.json")) {
        incoming = new Release(json(input, 128 * 1024));
      }
      synchronized (this) {
        if (epoch != token) return;
        if (incoming.minVersionCode > appVersion) {
          requiresApk = incoming.minVersionCode;
          return;
        }
        String current = active == null ? bundledId : active.id;
        long time = active == null ? bundledTime : active.builtAt;
        if (incoming.id.equals(current) || incoming.builtAt <= time) return;
        if (incoming.id.equals(state.optString("blocked"))) {
          error = "Using the previous explorer until a newer web update is published.";
          return;
        }
      }
      Release installed;
      try {
        installed = load(incoming.id);
      } catch (Exception missing) {
        installed = install(incoming);
      }
      synchronized (this) {
        if (epoch != token) return;
        JSONObject next = copyState();
        next.put("ready", installed.id);
        commit(next);
        ready = installed;
      }
    } catch (Exception failure) {
      synchronized (this) {
        if (epoch == token) error = "Update check unavailable. " + failure.getMessage();
      }
    } finally {
      synchronized (this) {
        checking = false;
        if (sessions.isEmpty()) {
          try {
            prune();
          } catch (IOException ignored) {
            /* Retry on the next start. */
          }
        }
      }
    }
  }

  private Release install(Release release) throws Exception {
    String nonce = UUID.randomUUID().toString();
    File archive = new File(root, "download-" + nonce + ".zip");
    File staging = new File(root, "pending-" + nonce);
    try {
      MessageDigest hash = MessageDigest.getInstance("SHA-256");
      long received = 0;
      try (InputStream input = transport.open(release.archive);
          FileOutputStream output = new FileOutputStream(archive)) {
        byte[] buffer = new byte[32768];
        int count;
        while ((count = input.read(buffer)) != -1) {
          received += count;
          if (received > release.bytes) throw new IOException("Web download exceeds expected size");
          output.write(buffer, 0, count);
          hash.update(buffer, 0, count);
        }
        output.getFD().sync();
      }
      if (received != release.bytes || !hex(hash.digest()).equals(release.sha256))
        throw new IOException("Web download checksum mismatch");
      if (!staging.mkdir()) throw new IOException("Cannot stage web update");
      try (ZipFile complete = new ZipFile(archive)) {
        if (complete.size() != release.files.size())
          throw new IOException("Web archive directory is incomplete");
      }
      Set<String> seen = new HashSet<>();
      long total = 0;
      try (ZipInputStream zip = new ZipInputStream(new FileInputStream(archive))) {
        ZipEntry entry;
        while ((entry = zip.getNextEntry()) != null) {
          String name = entry.getName();
          Member expected = release.files.get(name);
          if (entry.isDirectory() || !validPath(name) || expected == null || !seen.add(name))
            throw new IOException("Unexpected web archive entry");
          File file = child(staging, name);
          if (!file.getParentFile().isDirectory() && !file.getParentFile().mkdirs())
            throw new IOException("Cannot stage web directory");
          hash = MessageDigest.getInstance("SHA-256");
          long bytes = 0;
          try (FileOutputStream output = new FileOutputStream(file)) {
            byte[] buffer = new byte[32768];
            int count;
            while ((count = zip.read(buffer)) != -1) {
              bytes += count;
              total += count;
              if (bytes > expected.bytes || total > MAX_TOTAL)
                throw new IOException("Web archive exceeds expected size");
              output.write(buffer, 0, count);
              hash.update(buffer, 0, count);
            }
            output.getFD().sync();
          }
          if (bytes != expected.bytes || !hex(hash.digest()).equals(expected.sha256))
            throw new IOException("Web file checksum mismatch");
        }
      }
      if (seen.size() != release.files.size()) throw new IOException("Web archive is incomplete");
      verifyIdentity(staging, release);
      try (FileOutputStream output = new FileOutputStream(new File(staging, ".release.json"))) {
        output.write(release.json.toString().getBytes(StandardCharsets.UTF_8));
        output.getFD().sync();
      }
      File destination = new File(root, release.id);
      synchronized (this) {
        if (destination.exists())
          throw new IOException("A web release with this identity already exists");
        if (!staging.renameTo(destination)) throw new IOException("Cannot finish web update");
        verified.put(release.id, release);
      }
      return release;
    } finally {
      archive.delete();
      delete(staging);
    }
  }

  private synchronized Release load(String id) throws Exception {
    if (id.isEmpty()) return null;
    if (!digest(id)) throw new IOException("Invalid saved web identity");
    if (verified.containsKey(id)) return verified.get(id);
    File folder = new File(root, id);
    Release release;
    try (InputStream input = new FileInputStream(new File(folder, ".release.json"))) {
      release = new Release(json(input, 128 * 1024));
    }
    if (!id.equals(release.id) || release.minVersionCode > appVersion)
      throw new IOException("Saved web update is incompatible");
    for (Map.Entry<String, Member> entry : release.files.entrySet()) {
      File file = child(folder, entry.getKey());
      Member member = entry.getValue();
      if (!file.isFile() || file.length() != member.bytes)
        throw new IOException("Saved web update is incomplete");
      MessageDigest hash = MessageDigest.getInstance("SHA-256");
      try (InputStream input = new FileInputStream(file)) {
        byte[] buffer = new byte[32768];
        int n;
        while ((n = input.read(buffer)) != -1) hash.update(buffer, 0, n);
      }
      if (!hex(hash.digest()).equals(member.sha256))
        throw new IOException("Saved web update checksum mismatch");
    }
    verifyIdentity(folder, release);
    verified.put(id, release);
    return release;
  }

  private static void verifyIdentity(File folder, Release release) throws Exception {
    JSONObject info;
    try (InputStream input = new FileInputStream(child(folder, "android-web-info.json"))) {
      info = json(input, 4096);
    }
    if (!release.id.equals(info.getString("id"))
        || release.builtAt != info.getLong("builtAt")
        || release.minVersionCode != info.getInt("minVersionCode"))
      throw new IOException("Web identity does not match release");
  }

  private JSONObject copyState() throws Exception {
    return new JSONObject(state.toString());
  }

  private void commit(JSONObject next) throws Exception {
    File temporary = new File(root, "state-pending-" + UUID.randomUUID() + ".json");
    try {
      try (FileOutputStream output = new FileOutputStream(temporary)) {
        output.write(next.toString().getBytes(StandardCharsets.UTF_8));
        output.getFD().sync();
      }
      try {
        Files.move(
            temporary.toPath(),
            new File(root, "state.json").toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
      } catch (AtomicMoveNotSupportedException unsupported) {
        Files.move(
            temporary.toPath(),
            new File(root, "state.json").toPath(),
            StandardCopyOption.REPLACE_EXISTING);
      }
      state = next;
    } finally {
      temporary.delete();
    }
  }

  private void prune() throws IOException {
    File[] children = root.listFiles();
    if (children == null) return;
    Set<String> keep = new HashSet<>();
    for (String key : new String[] {"active", "previous", "ready"}) keep.add(state.optString(key));
    for (File file : children) {
      String name = file.getName();
      if ((digest(name) && !keep.contains(name))
          || name.matches("(pending-|download-|state-pending-)[a-f0-9-]{36}(\\.zip|\\.json)?")) {
        delete(file);
        verified.remove(name);
      }
    }
  }

  private void delete(File file) throws IOException {
    if (!file.toPath().toAbsolutePath().normalize().startsWith(root.toPath()) || file.equals(root))
      throw new IOException("Unsafe web cleanup path");
    if (!Files.isSymbolicLink(file.toPath()) && file.isDirectory()) {
      File[] children = file.listFiles();
      if (children == null) throw new IOException("Cannot list web staging directory");
      for (File child : children) delete(child);
    }
    Files.deleteIfExists(file.toPath());
  }

  static boolean digest(String value) {
    return value != null && value.matches("[a-f0-9]{64}");
  }

  private static long integer(JSONObject json, String key, long min, long max) throws Exception {
    Object value = json.get(key);
    if (!(value instanceof Number)) throw new IOException("Invalid web release number");
    double number = ((Number) value).doubleValue();
    if (!Double.isFinite(number) || number < min || number > max || number != Math.rint(number))
      throw new IOException("Invalid web release number");
    return ((Number) value).longValue();
  }

  static boolean validPath(String path) {
    if (path == null || path.length() > 200 || !path.matches("[A-Za-z0-9][A-Za-z0-9._/-]*"))
      return false;
    for (String part : path.split("/", -1))
      if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
    return true;
  }

  static File child(File root, String path) throws IOException {
    if (!validPath(path)) throw new IOException("Invalid web path");
    File file = new File(root, path).getCanonicalFile();
    if (!file.toPath().startsWith(root.getCanonicalFile().toPath())
        || file.equals(root.getCanonicalFile()))
      throw new IOException("Web path escapes its bundle");
    return file;
  }

  private static JSONObject json(InputStream input, int limit) throws Exception {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int count;
    while ((count = input.read(buffer)) != -1) {
      if (bytes.size() + count > limit) throw new IOException("Web metadata exceeds limit");
      bytes.write(buffer, 0, count);
    }
    return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
  }

  private static String hex(byte[] bytes) {
    StringBuilder out = new StringBuilder();
    for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 255));
    return out.toString();
  }

  static InputStream fetch(String name) throws IOException {
    if (!name.equals("latest.json") && !name.matches("bundle-[a-f0-9]{64}\\.zip"))
      throw new IOException("Invalid web download name");
    HttpURLConnection connection = (HttpURLConnection) new URL(BASE + name).openConnection();
    connection.setInstanceFollowRedirects(false);
    connection.setConnectTimeout(10000);
    connection.setReadTimeout(15000);
    connection.setUseCaches(false);
    connection.setRequestProperty(
        "Accept", name.endsWith(".json") ? "application/json" : "application/zip");
    connection.setRequestProperty("Cache-Control", "no-cache");
    try {
      int status = connection.getResponseCode();
      if (status != 200)
        throw new IOException(
            status == 404
                ? "No web update is published yet."
                : "Web update server returned " + status);
      return new FilterInputStream(connection.getInputStream()) {
        @Override
        public void close() throws IOException {
          try {
            super.close();
          } finally {
            connection.disconnect();
          }
        }
      };
    } catch (IOException failure) {
      connection.disconnect();
      throw failure;
    }
  }
}
