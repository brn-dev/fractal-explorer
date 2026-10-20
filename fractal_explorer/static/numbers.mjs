// Work only with a short mantissa and an integer exponent. Never turn the
// complete deep-zoom width into a Number; widths below 1e-324 become zero.
export function zoomLabel(span) {
  const parts = span.toLowerCase().replace(/^\+/, "").split("e");
  const text = parts[0];
  const point = text.includes(".") ? text.indexOf(".") : text.length;
  const digits = text.replace(".", "");
  const first = digits.search(/[1-9]/);
  if (first < 0) return "—";
  const significant = digits.slice(first, first + 16);
  const mantissa = Number(significant[0] + "." + significant.slice(1));
  let exponent = -(Number(parts[1] || 0) + point - first - 1);
  let coefficient = 3.6 / mantissa;
  if (coefficient < 1) {
    coefficient *= 10;
    exponent--;
  }
  if (coefficient >= 10) {
    coefficient /= 10;
    exponent++;
  }
  if (exponent < 6 && exponent > -6) {
    return `${(coefficient * 10 ** exponent).toLocaleString("en", { maximumFractionDigits: 2 })}×`;
  }
  return `${coefficient.toFixed(2)}e${exponent >= 0 ? "+" : ""}${exponent}×`;
}
