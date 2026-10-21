import { fractals, minimumSpan, parameterDefaults } from './fractals.mjs';
// Decimal navigation uses integers throughout, including widths below Number's range.
export function decimal(text) {
  text = String(text).trim();
  if (text.length > 12064 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
    throw new Error('Enter a finite decimal number (at most 12,064 characters).');
  const [s, exponent = '0'] = text.toLowerCase().split('e');
  const fractional = s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
  const e = Number(exponent) - fractional;
  if (!Number.isSafeInteger(e) || Math.abs(e) > 24064) throw new Error('Exponent is outside the supported range.');
  return normal({ n: BigInt(s.replace('.', '')), e });
}
function normal({ n, e }) {
  if (!n) return { n: 0n, e: 0 };
  while (n % 10n === 0n) { n /= 10n; e++; }
  return { n, e };
}
export function text(a) { return a.n === 0n ? '0' : `${a.n}${a.e ? `e${a.e}` : ''}`; }
// Format editable values without converting through Number or losing digits.
export function plainText(a) {
  if (!a.n) return '0';
  const sign = a.n < 0n ? '-' : '', digits = (a.n < 0n ? -a.n : a.n).toString();
  const point = digits.length + a.e;
  const length = sign.length + (a.e >= 0 ? point : point > 0 ? digits.length + 1 : 2 - point + digits.length);
  // Keep extreme values within the decimal input's supported character limit.
  if (length > 12064) return text(a);
  if (a.e >= 0) return sign + digits + '0'.repeat(a.e);
  if (point > 0) return sign + digits.slice(0, point) + '.' + digits.slice(point);
  return sign + '0.' + '0'.repeat(-point) + digits;
}
export function order(a) { return a.n ? (a.n < 0n ? -a.n : a.n).toString().length - 1 + a.e : -Infinity; }
function power(n) {
  if (n < 0 || n > 24064) throw new Error('Coordinate precision budget exceeded.');
  return 10n ** BigInt(n);
}
export function add(a, b) {
  if (!a.n) return b;
  if (!b.n) return a;
  const e = Math.min(a.e, b.e);
  return normal({ n: a.n * power(a.e - e) + b.n * power(b.e - e), e });
}
export function multiply(a, b) { return normal({ n: a.n * b.n, e: a.e + b.e }); }
export function divide(a, b, digits = 80) {
  if (!b.n) throw new Error('Division by zero.');
  const shift = Math.max(0, digits + order(b) - b.e - (order(a) - a.e));
  return normal({ n: a.n * power(shift) / b.n, e: a.e - b.e - shift });
}
export function compare(a, b) { const c = add(a, { n: -b.n, e: b.e }); return c.n < 0n ? -1 : c.n > 0n ? 1 : 0; }
export function validate(view) {
  if (!Object.hasOwn(fractals, view.fractal)) throw new Error('Unknown fractal.');
  const out = parameterDefaults(view);
  for (const p of fractals[view.fractal].parameters ?? []) {
    const v = out[p.key];
    if (!Number.isFinite(v) || v < p.min || v > p.max || (p.step === 1 && !Number.isInteger(v))) throw new Error(`${p.label} must be ${p.min}–${p.max}${p.step === 1 ? ' (whole numbers)' : ''}.`);
  }
  for (const key of ['x', 'y', 'julia_x', 'julia_y']) {
    const value = decimal(view[key]);
    if (compare({ n: value.n < 0n ? -value.n : value.n, e: value.e }, decimal('1e6')) > 0) throw new Error('Coordinates must stay within ±1,000,000.');
    out[key] = String(view[key]);
  }
  const min = minimumSpan(view.fractal);
  const span = decimal(view.span);
  if (compare(span, decimal(min)) < 0 || compare(span, decimal(16)) > 0) throw new Error(`This formula supports view widths from ${min} to 16 in the web edition.`);
  if (!Number.isInteger(view.iterations) || view.iterations < 50 || view.iterations > 50000) throw new Error('Use 50–50,000 iterations.');
  if (!Number.isFinite(view.bailout) || view.bailout < 4 || view.bailout > 4096) throw new Error('Bailout must be between 4 and 4096.');
  out.span = String(view.span);
  return out;
}
export function navigate({ view, dx = 0, dy = 0, factor = 1 }) {
  validate(view);
  if (![dx, dy, factor].every(Number.isFinite) || Math.abs(dx) > 10 || Math.abs(dy) > 10 || factor < .001 || factor > 1000) throw new Error('Navigation is outside the supported range.');
  const span = decimal(view.span), digits = Math.max(80, -order(span) + 50);
  let next = divide(span, decimal(factor), digits);
  const minimum = decimal(minimumSpan(view.fractal));
  if (compare(next, minimum) < 0) next = minimum;
  if (compare(next, decimal(16)) > 0) next = decimal(16);
  const shift = factor === 1 ? span : add(span, { n: -next.n, e: next.e });
  return validate({ ...view,
    x: text(add(decimal(view.x), multiply(decimal(dx), shift))),
    y: text(add(decimal(view.y), multiply(decimal(dy), shift))), span: text(next) });
}
export function pixelView(view, col, row, width, height) {
  const s = decimal(view.span), digits = Math.max(80, -order(s) + 50);
  return validate({ ...view,
    x: text(add(decimal(view.x), divide(multiply(s, decimal(2 * col + 1 - width)), decimal(2 * width), digits))),
    y: text(add(decimal(view.y), divide(multiply(s, decimal(height - 2 * row - 1)), decimal(2 * width), digits))) });
}
