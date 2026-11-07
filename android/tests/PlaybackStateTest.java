import static org.fractalexplorer.wallpaper.PlaybackState.Mode.*;
import static org.fractalexplorer.wallpaper.PlaybackState.Stage.*;

import org.fractalexplorer.wallpaper.PlaybackState;

public final class PlaybackStateTest {
  static void require(boolean value) {
    if (!value) throw new AssertionError();
  }

  public static void main(String[] args) {
    require(PlaybackState.modeFor(1080, 2520) == COVER);
    require(PlaybackState.modeFor(2520, 1080) == COVER);
    require(PlaybackState.modeFor(2256, 2504) == INNER);
    require(PlaybackState.modeFor(2504, 2256) == INNER);
    PlaybackState p = new PlaybackState();
    require(p.update(COVER, true, true, true, false, 0, 0) && p.stage == ARRIVAL);
    require(p.arrivalReveal);
    int stale = p.generation;
    require(!p.update(COVER, true, true, true, false, 0, 100)); // resize must not restart
    require(!p.arrivalReveal);
    require(p.completed(stale) && p.stage == IDLE);
    require(!p.completed(stale));
    p.update(COVER, false, true, true, false, 0, 200);
    p.update(COVER, true, true, true, false, 0, 700);
    require(p.stage == IDLE); // unlock's brief visibility bounce
    require(!p.arrivalReveal);
    p.update(COVER, false, true, true, false, 0, 800);
    p.update(COVER, true, true, true, false, 0, 4000);
    require(p.stage == ARRIVAL); // returning home after a while
    require(p.arrivalReveal);
    p.update(INNER, true, true, true, false, 0, 4100);
    require(p.stage == ARRIVAL && p.clip().equals("inner-arrival.mp4"));
    stale = p.generation;
    p.update(COVER, true, true, true, false, 0, 4200);
    require(!p.completed(stale) && p.stage == ARRIVAL); // late result after folding
    p.update(COVER, true, true, true, true, 0, 4300);
    require(p.stage == STILL); // no animation in Battery Saver
    require(!p.arrivalReveal);
    p.update(COVER, true, true, true, false, 0, 4400);
    require(p.stage == IDLE);
    require(!p.arrivalReveal);
    p.update(INNER, true, false, true, false, 0, 4500);
    require(p.stage == ARRIVAL);
    require(p.completed(p.generation) && p.stage == STILL); // arrival only
    p.update(INNER, true, true, false, false, 0, 4600);
    require(p.stage == IDLE);
    p.update(INNER, true, true, false, false, 1, 4700);
    require(p.stage == IDLE);
    require(p.failed(p.generation) && p.stage == STILL);
    p.update(INNER, false, true, false, false, 1, 4800);
    require(p.stage == HIDDEN && !p.completed(p.generation));
    p.update(COVER, false, true, true, false, 1, 4850);
    p.update(COVER, true, true, true, false, 1, 4900);
    require(
        p.stage == ARRIVAL); // a mode switch while hidden must survive the short reveal cooldown
    p.update(COVER, true, false, true, false, 1, 4950);
    require(p.stage == ARRIVAL);
    p.completed(p.generation);
    require(p.stage == STILL); // idle disabled during arrival
    PlaybackState cover = new PlaybackState();
    cover.screenEvent(1);
    cover.update(COVER, true, true, true, false, 0, 0);
    cover.completed(cover.generation);
    cover.update(COVER, false, true, true, false, 0, 10);
    cover.screenEvent(3); // another engine showed the inner screen, then closing returned here
    cover.update(COVER, true, true, true, false, 0, 20);
    require(
        cover.stage
            == ARRIVAL); // even a very fast close, without changing this engine's own display mode
    require(cover.arrivalReveal);
    cover.update(COVER, true, true, true, false, 1, 21);
    require(
        cover.stage == ARRIVAL && !cover.arrivalReveal); // manual artwork changes do not shuffle
    cover.update(COVER, false, true, true, false, 1, 30);
    cover.update(COVER, true, true, true, false, 2, 31);
    require(cover.stage == ARRIVAL && !cover.arrivalReveal); // revision during a short handoff
    cover.update(COVER, false, true, true, false, 2, 40);
    cover.update(COVER, true, true, false, false, 2, 3000);
    require(cover.stage == IDLE && !cover.arrivalReveal); // arrivals disabled
    System.out.println(
        "Playback lifecycle, fold modes, stale callbacks, idle toggle, and power saving passed.");
  }
}
