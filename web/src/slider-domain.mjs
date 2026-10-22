// Both automation endpoints and the playhead use this same numeric axis.
// Exact decimal fields are never converted back from these approximate thumbs.
export function sliderDomain(parameter, start, target = start, precision = false) {
  const a = Number(start), b = Number(target);
  const extent = Math.min(1e6, Math.max(2, Math.ceil(Math.abs(a)), Math.ceil(Math.abs(b))));
  const lower = parameter.decimal ? -extent : parameter.min;
  const upper = parameter.decimal ? extent : parameter.max;
  const baseStep = parameter.decimal ? .0001 : parameter.step;
  const step = parameter.step === 1 ? 1 : baseStep / (precision ? 10 : 1);
  if (!precision) return { min: lower, max: upper, step };

  const width = Math.min(upper - lower, Math.max((upper - lower) / 10, Math.abs(b - a) * 1.25, step * 2));
  let min = Math.max(lower, Math.min(upper - width, (a + b - width) / 2));
  let max = min + width;
  if (parameter.step === 1) {
    min = Math.floor(min); max = Math.ceil(max);
  }
  return { min: Number(min.toPrecision(14)), max: Number(max.toPrecision(14)), step };
}
