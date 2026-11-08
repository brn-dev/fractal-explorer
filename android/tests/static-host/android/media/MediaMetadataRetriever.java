package android.media;

/** Explicit video metadata fake. Image-only validation must not instantiate it. */
public class MediaMetadataRetriever implements AutoCloseable {
  public static final int METADATA_KEY_VIDEO_WIDTH = 1,
      METADATA_KEY_VIDEO_HEIGHT = 2,
      METADATA_KEY_DURATION = 3;
  public static int instances;

  public MediaMetadataRetriever() {
    instances++;
  }

  public void setDataSource(String path) {}

  public String extractMetadata(int key) {
    return key == 3 ? "1000" : "160";
  }

  public void close() {}
}
