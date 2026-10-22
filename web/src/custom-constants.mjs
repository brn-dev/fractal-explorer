export const MAX_CUSTOM_CONSTANTS = 16;
export const customConstantNames = Array.from({ length: MAX_CUSTOM_CONSTANTS }, (_, i) => `x${i + 1}`);
const parameters = customConstantNames.map(key => ({ key, label: key, decimal: true, min: -1e6, max: 1e6, step: .0001 }));
export function customConstantParameters(view) {
  return parameters.slice(0, Math.max(0, Math.min(MAX_CUSTOM_CONSTANTS, view.custom_constant_count ?? 0)));
}
