package org.fractalexplorer.wallpaper;

import java.time.*;

public final class ViennaSunTest {
  static int checks;

  static void check(boolean good) {
    checks++;
    if (!good) throw new AssertionError();
  }

  static long local(String date, String time) {
    return LocalDateTime.parse(date + "T" + time).atZone(ViennaSun.ZONE).toInstant().toEpochMilli();
  }

  public static void main(String[] args) {
    for (int year : new int[] {2024, 2026, 2027, 2028}) {
      for (int day = 1; day <= Year.of(year).length(); day++) {
        LocalDate date = LocalDate.ofYearDay(year, day);
        long noon = date.atTime(12, 0).atZone(ViennaSun.ZONE).toInstant().toEpochMilli();
        ViennaSun sun = ViennaSun.at(noon);
        check(sun.date.equals(date));
        check(sun.sunrise < sun.sunset);
        check(sun.daytime(noon));
        check(!sun.daytime(sun.sunrise - 1));
        check(sun.daytime(sun.sunrise));
        check(sun.daytime(sun.sunset - 1));
        check(!sun.daytime(sun.sunset));
        check(sun.next(sun.sunrise - 1) == sun.sunrise);
        check(sun.next(sun.sunrise) == sun.sunset);
        check(sun.next(sun.sunset) > sun.sunset);
        check(
            !ViennaSun.at(local(date.toString(), "00:01"))
                .daytime(local(date.toString(), "00:01")));
      }
    }
    // NOAA main.js (Meeus calculator), independently evaluated for the Vienna coordinates.
    // The production fractional-year approximation deliberately allows a few minutes' error.
    for (String[] row :
        new String[][] {{"2026-06-21", "04:53", "20:58"}, {"2026-12-21", "07:42", "16:02"}}) {
      ViennaSun sun = ViennaSun.at(local(row[0], "12:00"));
      check(Math.abs(sun.sunrise - local(row[0], row[1])) < 5 * 60000);
      check(Math.abs(sun.sunset - local(row[0], row[2])) < 5 * 60000);
    }
    for (String date : new String[] {"2026-03-29", "2026-10-25", "2024-02-29"}) {
      ViennaSun sun = ViennaSun.at(local(date, "23:59"));
      check(
          Instant.ofEpochMilli(sun.next(local(date, "23:59")))
              .atZone(ViennaSun.ZONE)
              .toLocalDate()
              .equals(LocalDate.parse(date).plusDays(1)));
    }
    System.out.println("PASS " + checks + " Vienna solar/date/DST/boundary assertions.");
  }
}
