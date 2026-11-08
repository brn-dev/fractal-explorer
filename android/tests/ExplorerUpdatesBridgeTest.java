package org.fractalexplorer.wallpaper;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import org.json.JSONObject;

/**
 * Actual bridge/worker methods; constructor/Android codec setup is replaced with explicit fixtures.
 */
public final class ExplorerUpdatesBridgeTest {
  static int checks;

  static void check(boolean value, String why) {
    checks++;
    if (!value) throw new AssertionError(why);
  }

  static void set(Object object, String name, Object value) throws Exception {
    Field field = object.getClass().getDeclaredField(name);
    field.setAccessible(true);
    field.set(object, value);
  }

  static boolean ok(String result) throws Exception {
    return new JSONObject(result).getBoolean("ok");
  }

  public static void main(String[] args) throws Exception {
    Field access = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
    access.setAccessible(true);
    sun.misc.Unsafe unsafe = (sun.misc.Unsafe) access.get(null);
    ExplorerBridge bridge = (ExplorerBridge) unsafe.allocateInstance(ExplorerBridge.class);
    NativeWorkQueue worker = new NativeWorkQueue();
    List<String> actions = new ArrayList<>();
    boolean[] fail = {false};
    CountDownLatch entered = new CountDownLatch(1), finish = new CountDownLatch(1);
    ExplorerBridge.Host host =
        new ExplorerBridge.Host() {
          public void saveFile(File f, String n) {}

          public void wallpaperPicker() {}

          public void shareText(String text) throws Exception {
            if (text.contains("block")) {
              entered.countDown();
              finish.await();
            }
          }

          public JSONObject webUpdates(String action, String version) throws Exception {
            actions.add(action);
            if (action.equals("apply") && fail[0]) throw new IOException("fake apply failure");
            return new JSONObject().put("action", action);
          }
        };
    set(bridge, "worker", worker);
    set(bridge, "host", host);
    ExecutorService threads = Executors.newFixedThreadPool(2);
    try {
      for (String action : new String[] {"status", "auto", "check", "confirm"})
        check(ok(bridge.webUpdates(action, "id")), "normal update action " + action);
      int count = actions.size();
      check(
          !ok(bridge.webUpdates("bad", "")) && actions.size() == count,
          "invalid action never reaches host");
      set(bridge, "pack", new File("fixture-pack"));
      check(
          !ok(bridge.webUpdates("apply", "")) && actions.size() == count,
          "staged export prevents reload before host mutation");
      set(bridge, "pack", null);
      set(bridge, "encoder", unsafe.allocateInstance(NativeVideoEncoder.class));
      check(
          !ok(bridge.webUpdates("apply", "")) && actions.size() == count,
          "active codec prevents reload before host mutation");
      set(bridge, "encoder", null);
      check(ok(bridge.webUpdates("apply", "")), "idle apply reaches host");
      check(
          !ok(bridge.shareWallpaperLink("https://example.org/#w=j1.e30")),
          "old page operations blocked during reload");
      check(
          !ok(bridge.webUpdates("apply", "")) && actions.size() == count + 1,
          "double apply rejected");
      check(ok(bridge.webUpdates("status", "")), "update status remains available during reload");
      bridge.webReloadStarted();
      check(
          ok(bridge.shareWallpaperLink("https://example.org/#w=j1.e30")),
          "new page can use native bridge");
      fail[0] = true;
      check(!ok(bridge.webUpdates("apply", "")), "host failure returned to JS");
      check(
          ok(bridge.shareWallpaperLink("https://example.org/#w=j1.e30")),
          "host failure unfreezes bridge");
      fail[0] = false;
      Future<String> sharing =
          threads.submit(() -> bridge.shareWallpaperLink("https://example.org/block#w=j1.e30"));
      check(entered.await(2, TimeUnit.SECONDS), "existing worker operation started");
      Future<?> reload =
          threads.submit(
              () -> {
                try {
                  bridge.prepareWebReload();
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              });
      check(!reload.isDone(), "reload cannot overtake an active worker operation");
      finish.countDown();
      check(ok(sharing.get(2, TimeUnit.SECONDS)), "existing operation finishes definitively");
      reload.get(2, TimeUnit.SECONDS);
      check(
          !ok(bridge.shareWallpaperLink("https://example.org/#w=j1.e30")),
          "operations after native recovery freeze are rejected");
      bridge.webReloadStarted();
      check(
          ok(bridge.shareWallpaperLink("https://example.org/#w=j1.e30")),
          "native recovery resumes bridge");
      System.out.println(
          "PASS "
              + checks
              + " production update bridge/worker assertions; injected fields and host, no Android"
              + " UI/codec execution.");
    } finally {
      finish.countDown();
      threads.shutdownNow();
      worker.close(() -> {});
    }
  }
}
