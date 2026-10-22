export const MAX_PALETTE_COLORS = 12;

export function validateCustomPalette(data) {
  if (!data || typeof data.name !== 'string' || data.name.trim().length > 40)
    throw new Error('Give your palette a name of up to 40 characters.');
  if (!Array.isArray(data.colors) || data.colors.length < 2 || data.colors.length > MAX_PALETTE_COLORS ||
      data.colors.some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)))
    throw new Error(`Choose 2–${MAX_PALETTE_COLORS} colors using six-digit hex values, such as #a855f7.`);
  if (data.loop !== undefined && typeof data.loop !== 'boolean') throw new Error('Invalid palette loop setting.');
  return { name: data.name.trim() || 'My palette', colors: data.colors.map(color => color.toLowerCase()), loop: data.loop ?? true };
}

export function customPaletteDefinition(data) {
  const palette = validateCustomPalette(data);
  return { name: palette.name, colors: palette.loop && palette.colors.at(-1) !== palette.colors[0]
    ? [...palette.colors, palette.colors[0]] : [...palette.colors] };
}

// Built-in indices stay compatible with older locations. Custom definitions
// travel with the location, independently of the number of built-in palettes.
export function paletteSelection(data, paletteCount) {
  if (data.palette === 'custom') return { palette: 'custom', customPalette: validateCustomPalette(data.customPalette) };
  const palette = data.palette ?? 0;
  if (!Number.isInteger(palette) || palette < 0 || palette >= paletteCount) throw new Error('Invalid palette.');
  return { palette };
}
