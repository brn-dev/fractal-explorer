package android.content.res;

import java.io.*;

public class AssetManager {
  final File dir;

  public AssetManager(File d) {
    dir = d;
  }

  public InputStream open(String name) throws IOException {
    return new FileInputStream(new File(dir, name));
  }
}
