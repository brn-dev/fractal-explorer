// Order is also the GPU formula ID. Keep the original five IDs stable.
import { customConstantParameters } from './custom-constants.mjs';
const power = { key: 'power', label: 'Power', min: 2, max: 8, step: 1 };
export const fractals = {
  mandelbrot: { name: 'Mandelbrot', title: 'The Mandelbrot set', description: 'An entire universe, hiding at the edge.', formula: 'z<sub>n+1</sub> = z<sub>n</sub>² + c', deep: true, defaults: { x: '-0.5' } },
  julia: { name: 'Julia', title: 'A Julia universe', description: 'One constant. Infinitely many possibilities.', formula: 'z<sub>n+1</sub> = z<sub>n</sub>² + c', constant: true, deep: true },
  'burning-ship': { name: 'Burning Ship · original', title: 'The Burning Ship', description: 'Find a little order in the beautiful chaos.', formula: 'z<sub>n+1</sub> = |Re(z²+c)| + i|Im(z²+c)|', defaults: { x: '-0.75', y: '0.375' } },
  tricorn: { name: 'Tricorn', title: 'The Tricorn', description: 'A familiar universe, reflected in itself.', formula: 'z<sub>n+1</sub> = z̄<sub>n</sub>² + c' },
  cubic: { name: 'Cubic Julia', title: 'A cubic universe', description: 'Symmetry takes an unexpected turn.', formula: 'z<sub>n+1</sub> = z<sub>n</sub>³ + c', constant: true, defaults: { julia_x: '-0.54', julia_y: '0.196' } },
  multibrot: { name: 'Multibrot', title: 'Powers of infinity', description: 'Change the power. Discover a new symmetry.', formula: 'z<sub>n+1</sub> = z<sub>n</sub><sup>d</sup> + c', parameters: [power], defaults: { power: 5, span: '4.5' } },
  multijulia: { name: 'Multijulia', title: 'A many-sided universe', description: 'Play with the power and the constant together.', formula: 'z<sub>n+1</sub> = z<sub>n</sub><sup>d</sup> + c', constant: true, parameters: [power], defaults: { power: 4, julia_x: '-0.55', julia_y: '0.45', span: '4.5' } },
  phoenix: { name: 'Phoenix Julia', title: 'The Phoenix', description: 'Every orbit remembers where it came from.', formula: 'z<sub>n+1</sub> = z<sub>n</sub>² + c + p z<sub>n−1</sub>', constant: true, parameters: [{ key: 'memory', label: 'Memory · p', min: -2, max: 2, step: 0.001 }], defaults: { memory: -0.5, julia_x: '0.5667', julia_y: '0', span: '5.4' } },
  'ship-julia': { name: 'Burning Ship Julia', title: 'Folded Julia gardens', description: 'Fold each orbit before it takes its next step.', formula: 'z<sub>n+1</sub> = (|Re z<sub>n</sub>| + i|Im z<sub>n</sub>|)² + c', constant: true, defaults: { julia_x: '-1.76', julia_y: '-0.03' } },
  newton: { name: 'Newton basins', title: 'Islands of attraction', description: 'Which root will each point find?', formula: 'z<sub>n+1</sub> = z<sub>n</sub> − λ (z<sub>n</sub><sup>d</sup> − c) / (d z<sub>n</sub><sup>d−1</sup>)', constant: true, parameters: [{ ...power, min: 3 }, { key: 'relaxation', label: 'Relaxation · λ', min: 0.2, max: 1.8, step: 0.01 }], defaults: { power: 3, relaxation: 1, julia_x: '1', julia_y: '0', span: '5' } },
  custom: { name: 'Custom', title: 'Your own universe', description: 'Write the rule. Follow it into infinity.', defaults: { x: '-0.5', custom_formula: 'z^2 + c', custom_mode: 'mandelbrot' } },
};
export const kinds = Object.keys(fractals);
export function defaultView(base, fractal) {
  return { ...base, x: '0', y: '0', fractal, ...fractals[fractal]?.defaults };
}
export function parameterDefaults(view) {
  const out = { ...view };
  if (view.fractal === 'custom') {
    out.custom_formula ??= fractals.custom.defaults.custom_formula;
    out.custom_mode ??= fractals.custom.defaults.custom_mode;
    for (const p of customConstantParameters(view)) out[p.key] ??= '1';
  }
  for (const p of fractals[view.fractal]?.parameters ?? []) out[p.key] ??= fractals[view.fractal].defaults[p.key];
  return out;
}
export function hasConstant(view) { return view.fractal === 'custom' ? ['julia', 'advanced'].includes(view.custom_mode) : !!fractals[view.fractal]?.constant; }
export function fractalParameters(view) { return view.fractal === 'custom' ? customConstantParameters(view) : fractals[view.fractal]?.parameters ?? []; }
export function minimumSpan(fractal) { return fractals[fractal]?.deep ? '1e-10000' : '1e-10'; }
