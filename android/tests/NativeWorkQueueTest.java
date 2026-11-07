package org.fractalexplorer.wallpaper;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public final class NativeWorkQueueTest {
  public static void main(String[] args) throws Exception {
    NativeWorkQueue queue = new NativeWorkQueue();
    CountDownLatch started = new CountDownLatch(1),
        release = new CountDownLatch(1),
        cleaned = new CountDownLatch(1);
    AtomicInteger mutations = new AtomicInteger(), cleanups = new AtomicInteger();
    AtomicReference<Throwable> failure = new AtomicReference<>();
    AtomicBoolean replied = new AtomicBoolean(), interruptRestored = new AtomicBoolean();
    Thread caller =
        new Thread(
            () -> {
              try {
                int result =
                    queue.call(
                        () -> {
                          started.countDown();
                          release.await();
                          return mutations.incrementAndGet();
                        });
                if (result != 1) throw new AssertionError("Wrong result");
                replied.set(true);
                interruptRestored.set(Thread.currentThread().isInterrupted());
              } catch (Throwable error) {
                failure.set(error);
              }
            });
    try {
      caller.start();
      if (!started.await(5, TimeUnit.SECONDS)) throw new AssertionError("Task did not start");
      caller.interrupt();
      Thread.sleep(40);
      if (!caller.isAlive() || replied.get() || mutations.get() != 0)
        throw new AssertionError("Caller reported before operation completed");
      release.countDown();
      caller.join(5000);
      if (caller.isAlive()
          || failure.get() != null
          || !replied.get()
          || !interruptRestored.get()
          || mutations.get() != 1)
        throw new AssertionError("Accepted operation lost definitive outcome", failure.get());
      try {
        queue.call(
            () -> {
              throw new java.io.IOException("Expected failure");
            });
        throw new AssertionError("Task failure hidden");
      } catch (java.util.concurrent.ExecutionException expected) {
        if (!(expected.getCause() instanceof java.io.IOException)) throw expected;
      }
      if (queue.call(() -> 7) != 7) throw new AssertionError("Queue unusable after failed task");
    } finally {
      release.countDown();
      caller.join(5000);
      queue.close(
          () -> {
            cleanups.incrementAndGet();
            cleaned.countDown();
          });
      queue.close(() -> cleanups.incrementAndGet());
    }
    if (!cleaned.await(5, TimeUnit.SECONDS) || cleanups.get() != 1)
      throw new AssertionError("Cleanup not exactly once");
    try {
      queue.call(() -> 1);
      throw new AssertionError("Closed queue accepted work");
    } catch (java.util.concurrent.RejectedExecutionException expected) {
    }
    System.out.println(
        "Native queue preserves definitive results, interrupts, failures, and cleanup order.");
  }
}
