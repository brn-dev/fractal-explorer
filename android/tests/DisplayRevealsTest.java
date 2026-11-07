package org.fractalexplorer.wallpaper;

public final class DisplayRevealsTest {
  private static void require(boolean value) {
    if (!value) throw new AssertionError();
  }

  public static void main(String[] args) {
    DisplayReveals reveals = new DisplayReveals();
    long inner = reveals.reveal(0, PlaybackState.Mode.INNER);
    long external = reveals.reveal(7, PlaybackState.Mode.COVER);
    PlaybackState first = new PlaybackState(), second = new PlaybackState();
    first.screenEvent(inner);
    first.update(PlaybackState.Mode.INNER, true, true, true, false, 0, 0);
    second.screenEvent(external);
    second.update(PlaybackState.Mode.COVER, true, true, true, false, 0, 0);
    first.completed(first.generation);
    second.completed(second.generation);
    first.screenEvent(reveals.reveal(0, PlaybackState.Mode.INNER));
    second.screenEvent(reveals.reveal(7, PlaybackState.Mode.COVER));
    first.update(PlaybackState.Mode.INNER, true, false, true, false, 0, 1);
    second.update(PlaybackState.Mode.COVER, true, false, true, false, 0, 1);
    require(first.stage == PlaybackState.Stage.STILL && second.stage == PlaybackState.Stage.STILL);
    require(reveals.reveal(0, PlaybackState.Mode.COVER) > inner);
    long reopened = reveals.reveal(0, PlaybackState.Mode.INNER);
    first.screenEvent(reopened);
    first.update(PlaybackState.Mode.INNER, true, false, true, false, 0, 2);
    require(first.stage == PlaybackState.Stage.ARRIVAL);
    require(reveals.reveal(7, PlaybackState.Mode.COVER) == external);
    System.out.println(
        "Display reveal isolation, stable settings updates and fast fold handoffs passed.");
  }
}
