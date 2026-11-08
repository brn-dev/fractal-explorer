package org.fractalexplorer.wallpaper;

/** Platform-independent lifecycle policy. Every clip change invalidates old callbacks. */
public final class PlaybackState {
  public enum Stage {
    HIDDEN,
    STILL,
    ARRIVAL,
    IDLE
  }

  public enum Mode {
    COVER,
    INNER
  }

  public Stage stage = Stage.HIDDEN;
  public Mode mode = null;
  public int generation = 0;
  public boolean arrivalReveal;
  public boolean selectionReveal;
  private boolean idle = true, arrival = true, saving = false;
  private long revision = -1, hiddenAt = Long.MIN_VALUE;
  private boolean pendingArrival = true;
  private long screenEvent = Long.MIN_VALUE;

  public void screenEvent(long event) {
    if (screenEvent != event) {
      pendingArrival = true;
      screenEvent = event;
    }
  }

  public static Mode modeFor(int width, int height) {
    if (width <= 0 || height <= 0)
      throw new IllegalArgumentException("Display dimensions must be positive");
    return Math.max(width, height) / (double) Math.min(width, height) > 1.7
        ? Mode.COVER
        : Mode.INNER;
  }

  public boolean update(
      Mode nextMode,
      boolean active,
      boolean nextIdle,
      boolean nextArrival,
      boolean powerSave,
      long nextRevision,
      long now) {
    boolean changedMode = mode != nextMode, changedContent = revision != nextRevision;
    boolean preferences = idle != nextIdle || arrival != nextArrival || saving != powerSave;
    boolean wasHidden = stage == Stage.HIDDEN;
    boolean newArrival = pendingArrival;
    boolean reveal =
        changedMode
            || newArrival
            || (wasHidden && (hiddenAt == Long.MIN_VALUE || now - hiddenAt >= 2000));
    arrivalReveal = false;
    selectionReveal = active && reveal;
    if (changedMode || changedContent) pendingArrival = true;
    idle = nextIdle;
    arrival = nextArrival;
    saving = powerSave;
    mode = nextMode;
    revision = nextRevision;
    Stage next = stage;
    if (!active) {
      if (!wasHidden) hiddenAt = now;
      next = Stage.HIDDEN;
    } else if (powerSave) {
      next = Stage.STILL;
      pendingArrival = false;
    } else if (changedMode || changedContent || wasHidden || preferences || pendingArrival) {
      boolean freshReveal =
          pendingArrival || (wasHidden && (hiddenAt == Long.MIN_VALUE || now - hiddenAt >= 2000));
      next = arrival && freshReveal ? Stage.ARRIVAL : idle ? Stage.IDLE : Stage.STILL;
      if (stage == Stage.ARRIVAL && arrival && !changedMode && !changedContent && !wasHidden)
        next = Stage.ARRIVAL;
      pendingArrival = false;
    }
    if (next == stage && !changedMode && !changedContent && !(active && newArrival)) return false;
    stage = next;
    arrivalReveal = next == Stage.ARRIVAL && reveal;
    generation++;
    return true;
  }

  public boolean completed(int token) {
    if (generation != token || stage != Stage.ARRIVAL) return false;
    stage = idle ? Stage.IDLE : Stage.STILL;
    generation++;
    return true;
  }

  public boolean failed(int token) {
    if (token != generation || stage == Stage.HIDDEN) return false;
    stage = Stage.STILL;
    generation++;
    return true;
  }

  public String prefix() {
    return mode == Mode.COVER ? "cover" : "inner";
  }

  public String clip() {
    return prefix() + (stage == Stage.ARRIVAL ? "-arrival.mp4" : "-idle.mp4");
  }
}
