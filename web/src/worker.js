import { prepare, exactPixels, clearCaches, mpfr } from './reference.mjs';
import { softwareRender } from './software.mjs';

// No Python, HTTP render endpoint, or remote computation exists in this worker.
self.onmessage = async ({ data: { id, method, args } }) => {
  try {
    let result;
    if (method === 'prepare') {
      const p = await prepare(...args);
      result = { key: `${p.orbit.key}|${JSON.stringify(args.slice(1))}`, digits: p.orbit.digits, span: p.orbit.span,
        reference: p.orbit.buffer, length: p.orbit.points.length,
        series: p.approximation.series, seriesN: p.approximation.seriesN, seriesOrder: p.approximation.seriesOrder,
        maps: p.approximation.maps, offsets: p.approximation.offsets, logDc: p.approximation.logDc,
        timings: p.timings, referenceHit: p.referenceHit, preparationHit: p.preparationHit };
      // Cached buffers remain in this worker. Structured cloning makes the GPU packet independent.
    } else if (method === 'exact') result = await exactPixels(...args);
    else if (method === 'cpu') result = await softwareRender(...args);
    else if (method === 'clear') { clearCaches(); result = true; }
    else if (method === 'init') { await mpfr(); result = true; }
    else throw new Error('Unknown worker operation.');
    const transfer = result?.field ? [result.field.buffer] : result?.values ? [result.values.buffer] : [];
    self.postMessage({ id, result }, transfer);
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
};
