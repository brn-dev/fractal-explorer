package org.fractalexplorer.wallpaper;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * Offline approximate sunrise/sunset near Vienna, independent of the device's current zone.
 * Equations: https://gml.noaa.gov/grad/solcalc/solareqns.PDF (90.833 degree zenith). These seasonal
 * estimates are not observations of weather or the local horizon.
 */
final class ViennaSun {
  static final ZoneId ZONE = ZoneId.of("Europe/Vienna");
  static final double LATITUDE = 48.2082, LONGITUDE = 16.3738;
  final LocalDate date;
  final long sunrise, sunset;
  private static ViennaSun cached;

  private ViennaSun(LocalDate date) {
    this.date = date;
    long midnight = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
    sunrise = midnight + Math.round(minutes(date, true) * 60000);
    sunset = midnight + Math.round(minutes(date, false) * 60000);
  }

  static synchronized ViennaSun at(long millis) {
    LocalDate date = Instant.ofEpochMilli(millis).atZone(ZONE).toLocalDate();
    if (cached == null || !cached.date.equals(date)) cached = new ViennaSun(date);
    return cached;
  }

  boolean daytime(long millis) {
    return millis >= sunrise && millis < sunset;
  }

  long next(long millis) {
    if (millis < sunrise) return sunrise;
    if (millis < sunset) return sunset;
    return new ViennaSun(date.plusDays(1)).sunrise;
  }

  private static double minutes(LocalDate date, boolean rise) {
    double result = rise ? 360 : 1080;
    // Evaluate the fractional year at the estimated event instead of a fixed clock hour.
    for (int i = 0; i < 3; i++) {
      double g =
          2 * Math.PI / date.lengthOfYear() * (date.getDayOfYear() - 1 + (result / 60 - 12) / 24);
      double equation =
          229.18
              * (0.000075
                  + 0.001868 * Math.cos(g)
                  - 0.032077 * Math.sin(g)
                  - 0.014615 * Math.cos(2 * g)
                  - 0.040849 * Math.sin(2 * g));
      double declination =
          0.006918
              - 0.399912 * Math.cos(g)
              + 0.070257 * Math.sin(g)
              - 0.006758 * Math.cos(2 * g)
              + 0.000907 * Math.sin(2 * g)
              - 0.002697 * Math.cos(3 * g)
              + 0.00148 * Math.sin(3 * g);
      double latitude = Math.toRadians(LATITUDE);
      double angle =
          Math.toDegrees(
              Math.acos(
                  Math.cos(Math.toRadians(90.833)) / (Math.cos(latitude) * Math.cos(declination))
                      - Math.tan(latitude) * Math.tan(declination)));
      result = 720 - 4 * (LONGITUDE + (rise ? angle : -angle)) - equation;
    }
    return result;
  }
}
