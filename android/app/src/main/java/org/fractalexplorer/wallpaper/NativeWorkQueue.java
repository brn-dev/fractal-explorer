package org.fractalexplorer.wallpaper;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;

/** One native/EGL thread, with definitive results for every accepted operation. */
final class NativeWorkQueue {
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private boolean closed;

  <T> T call(Callable<T> action) throws Exception {
    Future<T> result;
    synchronized (this) {
      if (closed) throw new RejectedExecutionException("The explorer is closed");
      result = executor.submit(action);
    }
    boolean interrupted = false;
    try {
      for (; ; ) {
        try {
          return result.get();
        } catch (InterruptedException error) {
          interrupted = true;
        }
      }
    } finally {
      // An interrupted caller must not report failure while its queued publication
      // can still succeed. Restore its interrupt status after the actual outcome.
      if (interrupted) Thread.currentThread().interrupt();
    }
  }

  synchronized void close(Runnable cleanup) {
    if (closed) return;
    closed = true;
    executor.execute(cleanup);
    executor.shutdown();
  }
}
