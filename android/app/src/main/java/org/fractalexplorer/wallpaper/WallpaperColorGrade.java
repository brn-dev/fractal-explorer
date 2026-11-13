package org.fractalexplorer.wallpaper;

import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

/** Post-decode tone/RGB correction. This affects every rendered pixel, including the interior. */
final class WallpaperColorGrade {
  static final int LUT_SIZE = 1024;
  static final String[] CHANNELS = {"tone", "red", "green", "blue"};
  static final WallpaperColorGrade IDENTITY;

  static {
    try {
      IDENTITY = new WallpaperColorGrade(new JSONObject());
    } catch (Exception impossible) {
      throw new ExceptionInInitializerError(impossible);
    }
  }

  private final Curve[] curves = new Curve[4];
  final JSONObject json;
  final String key;
  final boolean active, tone, rgb;
  private volatile byte[] table;

  WallpaperColorGrade(JSONObject input) throws Exception {
    if (input == null || input.toString().length() > 65536)
      throw new IOException("Invalid color correction");
    for (java.util.Iterator<String> keys = input.keys(); keys.hasNext(); ) {
      String name = keys.next();
      if (!java.util.Arrays.asList(CHANNELS).contains(name))
        throw new IOException("Unknown correction channel");
    }
    json = new JSONObject();
    for (int i = 0; i < CHANNELS.length; i++) {
      String name = CHANNELS[i];
      if (input.has(name)) {
        curves[i] = new Curve(input.getJSONObject(name));
        json.put(name, curves[i].json);
      }
    }
    tone = curves[0] != null && !curves[0].identity;
    boolean color = false;
    for (int i = 1; i < 4; i++) color |= curves[i] != null && !curves[i].identity;
    rgb = color;
    active = tone || rgb;
    key = json.toString();
  }

  static WallpaperColorGrade parse(String text) throws Exception {
    if (text == null || text.length() > 65536) throw new IOException("Invalid color correction");
    return new WallpaperColorGrade(new JSONObject(text));
  }

  byte[] lut() {
    if (table == null) {
      byte[] data = new byte[LUT_SIZE * 4];
      for (int i = 0; i < LUT_SIZE; i++) {
        double x = i / (double) (LUT_SIZE - 1);
        for (int c = 0; c < 4; c++) {
          int channel = c == 3 ? 0 : c + 1;
          data[i * 4 + c] =
              (byte) Math.round(255 * (curves[channel] == null ? x : curves[channel].at(x)));
        }
      }
      table = data;
    }
    return table;
  }

  private double sample(double x, int channel) {
    double p = clamp(x) * (LUT_SIZE - 1);
    int i = Math.min(LUT_SIZE - 2, (int) p);
    byte[] lut = lut();
    return ((lut[i * 4 + channel] & 255) * (1 - (p - i))
            + (lut[(i + 1) * 4 + channel] & 255) * (p - i))
        / 255;
  }

  int color(int argb) {
    if (!active) return argb;
    double r = ((argb >> 16) & 255) / 255d, g = ((argb >> 8) & 255) / 255d, b = (argb & 255) / 255d;
    if (tone) {
      double light = .2126 * r + .7152 * g + .0722 * b, next = sample(light, 3);
      if (light > .00001) {
        r = clamp(r * next / light);
        g = clamp(g * next / light);
        b = clamp(b * next / light);
      } else r = g = b = next;
    }
    if (rgb) {
      r = sample(r, 0);
      g = sample(g, 1);
      b = sample(b, 2);
    }
    return (argb & 0xff000000)
        | ((int) Math.round(r * 255) << 16)
        | ((int) Math.round(g * 255) << 8)
        | (int) Math.round(b * 255);
  }

  static double clamp(double x) {
    return Math.max(0, Math.min(1, x));
  }

  /** Same monotone Hermite and segment-bend definitions as web/src/curve.mjs. */
  private static final class Curve {
    final double[] x, y, bends, h, m;
    final boolean segments, identity;
    final JSONObject json;

    Curve(JSONObject source) throws Exception {
      JSONArray points = source.getJSONArray("points");
      int n = points.length();
      if (n < 2 || n > 65) throw new IOException("Choose 2–65 curve points");
      x = new double[n];
      y = new double[n];
      bends = new double[n - 1];
      h = new double[n - 1];
      m = new double[n];
      JSONArray normalized = new JSONArray();
      boolean diagonal = true;
      for (int i = 0; i < n; i++) {
        JSONArray point = points.getJSONArray(i);
        if (point.length() != 2) throw new IOException("Invalid curve point");
        x[i] = number(point.get(0), 0, 1);
        y[i] = number(point.get(1), 0, 1);
        if (i > 0 && x[i] - x[i - 1] < .001 - 1e-10)
          throw new IOException("Curve points must be ordered and 0.1% apart");
        normalized.put(new JSONArray().put(x[i]).put(y[i]));
        diagonal &= x[i] == y[i];
      }
      if (x[0] != 0 || x[n - 1] != 1) throw new IOException("Curve inputs must span 0–100%");
      String method = source.has("interpolation") ? source.getString("interpolation") : "smooth";
      if (!"smooth".equals(method) && !"segments".equals(method))
        throw new IOException("Invalid curve interpolation");
      segments = "segments".equals(method);
      JSONArray b = source.has("bends") ? source.getJSONArray("bends") : null,
          normalizedBends = new JSONArray();
      if (b != null && b.length() != n - 1) throw new IOException("Invalid curve bends");
      double[] d = new double[n - 1];
      for (int i = 0; i < n - 1; i++) {
        bends[i] = b == null ? 0 : number(b.get(i), -1, 1);
        normalizedBends.put(bends[i]);
        diagonal &= !segments || bends[i] == 0;
        h[i] = x[i + 1] - x[i];
        d[i] = (y[i + 1] - y[i]) / h[i];
      }
      m[0] = d[0];
      m[n - 1] = d[n - 2];
      for (int i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) m[i] = 0;
        else {
          double a = 2 * h[i] + h[i - 1], z = h[i] + 2 * h[i - 1];
          m[i] = (a + z) / (a / d[i - 1] + z / d[i]);
        }
      }
      identity = diagonal;
      json =
          new JSONObject()
              .put("points", normalized)
              .put("interpolation", method)
              .put("bends", normalizedBends);
    }

    double at(double value) {
      if (value <= 0) return y[0];
      if (value >= 1) return y[y.length - 1];
      int low = 0, high = x.length - 1;
      while (high - low > 1) {
        int mid = (low + high) >> 1;
        if (x[mid] > value) high = mid;
        else low = mid;
      }
      double t = (value - x[low]) / h[low];
      if (segments) {
        double bend = bends[low],
            u = bend >= 0 ? Math.pow(t, 1 + 4 * bend) : 1 - Math.pow(1 - t, 1 - 4 * bend);
        return clamp(y[low] + (y[low + 1] - y[low]) * u);
      }
      double t2 = t * t, t3 = t2 * t;
      return clamp(
          (2 * t3 - 3 * t2 + 1) * y[low]
              + (t3 - 2 * t2 + t) * h[low] * m[low]
              + (-2 * t3 + 3 * t2) * y[low + 1]
              + (t3 - t2) * h[low] * m[low + 1]);
    }

    static double number(Object value, double min, double max) throws IOException {
      if (!(value instanceof Number)) throw new IOException("Curve values must be numbers");
      double result = ((Number) value).doubleValue();
      if (!Double.isFinite(result) || result < min || result > max)
        throw new IOException("Curve value is out of range");
      return result;
    }
  }
}
