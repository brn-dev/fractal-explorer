// A runtime integer mask makes intermediate f32 bit patterns observable. Unlike
// a bitcast round trip or an all-ones constant, the compiler cannot fold it away
// and reassociate the floating-point expressions across it. The host supplies
// 0xffffffff, so every bit (including the sign of zero) is preserved.
export function arithmeticShader(source, guarded = false) {
  const guard = guarded
    ? '@group(1) @binding(0) var<uniform> arithmetic_mask:u32;\nfn round32(x:f32)->f32 {return bitcast<f32>(bitcast<u32>(x)&arithmetic_mask);}'
    : 'fn round32(x:f32)->f32 {return x;}';
  return `${guard}\n${source}`;
}

export const arithmeticCases = new Float32Array([
  1, 2 ** -30, 1, -(2 ** -31),
  .9999999403953552, 2 ** -49, .5000000596046448, -(2 ** -48),
  1.0000001192092896, 0, .9999998807907104, 0,
  -.8123456239700317, 1e-9, .7333332896232605, -2e-9,
]);
export const coordinateCases = new Float32Array([
  -959.5, 0, 1920, 0, -539.5, 0, 1920, 0,
  .5, 0, 4096, 0, 1.5, 0, 3001, 0,
]);

export function checkArithmetic(values, coordinates) {
  const checks = [];
  const check = (operation, sample, expected, high, low) => {
    const actual = high + low, error = Math.abs(actual - expected);
    checks.push({ operation, sample, expected, actual, error, passed: Number.isFinite(error) && error < 2e-13 });
  };
  for (let k = 0; k < arithmeticCases.length / 4; k++) {
    const a = arithmeticCases[4 * k] + arithmeticCases[4 * k + 1];
    const b = arithmeticCases[4 * k + 2] + arithmeticCases[4 * k + 3];
    check('sum', k + 1, a + b, values[4 * k], values[4 * k + 1]);
    check('product', k + 1, a * b, values[4 * k + 2], values[4 * k + 3]);
    check('coordinate division', k + 1, coordinateCases[4 * k] / coordinateCases[4 * k + 2], coordinates[4 * k], coordinates[4 * k + 1]);
  }
  return { passed: checks.every(check => check.passed), checks };
}

export class GPUArithmeticError extends Error {
  constructor(report) {
    const failed = report.checks.filter(check => !check.passed);
    super(`WebGPU is available, but paired precision failed (${failed.map(check => `${check.operation} #${check.sample}`).join(', ')}).`);
    this.name = 'GPUArithmeticError';
    this.report = report;
  }
}
