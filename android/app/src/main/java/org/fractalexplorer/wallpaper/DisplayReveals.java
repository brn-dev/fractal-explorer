package org.fractalexplorer.wallpaper;

import java.util.HashMap;
import java.util.Map;

/** Coordinate engines on the same logical display, without treating other displays as folds. */
final class DisplayReveals {
  private static final class DisplayState {
    PlaybackState.Mode mode;
    long event;
  }

  private final Map<Integer, DisplayState> displays = new HashMap<>();

  synchronized long reveal(int displayId, PlaybackState.Mode mode) {
    DisplayState state = displays.get(displayId);
    if (state == null) {
      state = new DisplayState();
      displays.put(displayId, state);
    }
    if (state.mode != mode) {
      state.mode = mode;
      state.event++;
    }
    return state.event;
  }
}
