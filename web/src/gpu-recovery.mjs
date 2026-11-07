// Native pipeline compilation is serialized across live, preview and export engines.
// Several mobile drivers have fragile compilation paths; never retry invalid shaders.
let pipelineQueue = Promise.resolve();
export class GPUBackendError extends Error {
  constructor(cause) { super(cause?.message || String(cause)); this.name = 'GPUBackendError'; this.cause = cause; }
}
export function gpuBackendFailure(error) {
  if (error?.name === 'AbortError') return false;
  if (error instanceof GPUBackendError) return true;
  // Older Dawn versions can misclassify Vulkan failures. An explicit driver
  // status is still a backend fault, even if its wrapper says validation.
  if (/VK_ERROR_(UNKNOWN|DEVICE_LOST|INITIALIZATION_FAILED|OUT_OF_(HOST|DEVICE)_MEMORY)/.test(error?.message ?? '')) return true;
  if (error?.reason === 'validation' || error?.name === 'GPUValidationError') return false;
  return error?.reason === 'internal' || ['GPUInternalError', 'GPUOutOfMemoryError'].includes(error?.name);
}
export function computePipeline(device, descriptor, cancelled = () => false) {
  return createPipeline(device, descriptor, 'createComputePipelineAsync', cancelled);
}
export function renderPipeline(device, descriptor, cancelled = () => false) {
  return createPipeline(device, descriptor, 'createRenderPipelineAsync', cancelled);
}
function createPipeline(device, descriptor, method, cancelled) {
  const result = pipelineQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (cancelled()) throw new DOMException('GPU work cancelled.', 'AbortError');
      try {
        const pipeline = await device[method](descriptor);
        if (cancelled()) throw new DOMException('GPU work cancelled.', 'AbortError');
        return pipeline;
      } catch (error) {
        if (cancelled()) throw new DOMException('GPU work cancelled.', 'AbortError');
        if (!gpuBackendFailure(error)) throw error;
        if (attempt === 2) throw new GPUBackendError(error);
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
  });
  pipelineQueue = result.catch(() => {});
  return result;
}
export function specializeFractal(source, kind, perturb) {
  if (!Number.isInteger(kind) || kind < 0 || kind > 10) throw new Error('Invalid GPU fractal kind.');
  return source.replace(/\bp\.kind\b/g, `${kind}u`).replace(/\bp\.perturb\b/g, perturb ? '1u' : '0u');
}
