export const qualityScales = [.5, 1, 1.5, 2, 3, 4];

// Each pixel occupies four bytes in a single storage binding. Stay within the
// requested device's limits rather than assuming the adapter's larger limits.
export function renderLimits(gpuLimits) {
  if (!gpuLimits) return { maxDimension: 4096, maxPixels: 16000000 };
  return {
    maxDimension: Math.min(8192, gpuLimits.maxTextureDimension2D),
    maxPixels: Math.min(33554432, Math.floor(gpuLimits.maxStorageBufferBindingSize / 4), Math.floor(gpuLimits.maxBufferSize / 4)),
  };
}

export function renderDimensions(viewportWidth, viewportHeight, quality, { gpu = false, mobile = false, limits = renderLimits() } = {}) {
  const scale = qualityScales.includes(Number(quality)) ? Number(quality) : 1;
  const high = scale > 1.5;
  // Preserve the existing budgets for Draft/Native/Fine. Higher modes opt into
  // more work, with smaller ceilings on touch devices and the CPU fallback.
  const budget = Math.min(limits.maxPixels, gpu ? (mobile ? (high ? 6000000 : 1500000) : (high ? 33554432 : 8000000)) : (high ? 960000 : 120000));
  const targetWidth = Math.max(16, viewportWidth * scale), targetHeight = Math.max(16, viewportHeight * scale);
  const factor = Math.min(1, (high ? limits.maxDimension : Math.min(2560, limits.maxDimension)) / targetWidth, limits.maxDimension / targetHeight, Math.sqrt(budget / (targetWidth * targetHeight)));
  const width = Math.max(16, Math.min(Math.floor(budget / 16), Math.floor(targetWidth * factor)));
  const height = Math.max(16, Math.min(Math.floor(budget / width), Math.floor(targetHeight * factor)));
  return { width, height, capped: width + 1 < targetWidth || height + 1 < targetHeight };
}

export function validateDimensions(width, height, limits) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > limits.maxDimension || height > limits.maxDimension || width * height > limits.maxPixels) {
    throw new Error(`Use dimensions from 16 to ${limits.maxDimension}, up to ${(limits.maxPixels / 1000000).toFixed(1)} megapixels on this device.`);
  }
}
