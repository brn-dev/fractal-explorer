const check = signal => { if (signal?.aborted) throw new DOMException('Wallpaper export cancelled.', 'AbortError'); };

// Keep the current field resident. GPU coloring avoids a JavaScript pass over
// every supersample; raw caches still accelerate returning parameter cycles.
export class WallpaperFrameRenderer {
  constructor(renderer, fields, paint, signal) {
    Object.assign(this, { renderer, fields, paintCPU: paint, signal });
    this.current = null; this.gpuKey = null; this.gpuDevice = null; this.spillCost = null;
  }
  get gpu() { return this.renderer.gpu && typeof this.renderer.paint === 'function'; }
  async field(view, settings, width, height, cache) {
    check(this.signal);
    const key = JSON.stringify([view, settings, width, height]);
    const validGPU = !this.renderer.lost && this.gpuDevice === this.renderer.device;
    let current = this.current;
    if (!current || current.key !== key || (this.gpu && !validGPU) || current.gpu !== !!this.gpu) {
      const cached = cache && !this.renderer.lost ? await this.fields.get(key) : null; check(this.signal);
      if (cached) current = { key, ...cached, stored: true, gpu: !!this.gpu };
      else {
        const metadata = (await this.renderer.render(view, width, height, settings)).metadata; check(this.signal);
        const gpu = !!this.gpu;
        current = { key, metadata, values: gpu ? null : await this.renderer.readField(), stored: false, gpu };
        check(this.signal);
        this.gpuKey = gpu ? key : null; this.gpuDevice = this.renderer.device;
      }
      this.current = current;
    }
    if (cache && !current.stored) {
      const bytes = width * height * 4;
      const spill = this.gpu && Number.isFinite(this.fields.memoryBudget) && Number.isFinite(this.fields.memoryBytes)
        && this.fields.memoryBytes + bytes > this.fields.memoryBudget;
      // Probe the actual storage cost once. For inexpensive GPU fields,
      // recomputing a return frame is faster than writing and reading it.
      // Expensive deep fields keep using the lossless temporary cache.
      if (spill && (this.fields.writable === false || (this.spillCost !== null && current.metadata.elapsed_ms < 2 * this.spillCost))) return current;
      const started = performance.now();
      if (!current.values) { current.values = await this.renderer.readField(); check(this.signal); }
      await this.fields.put(key, { values: current.values, metadata: current.metadata }); check(this.signal);
      if (spill) this.spillCost = performance.now() - started;
      current.stored = true;
    }
    return current;
  }
  async paint(target, frame, colors) {
    check(this.signal);
    if (!this.gpu) { this.paintCPU(target, frame.values, frame.metadata, colors); return; }
    if (this.gpuKey !== frame.key || this.gpuDevice !== this.renderer.device) {
      if (!frame.values) throw new Error('The GPU field is no longer available. Create the wallpaper again.');
      this.renderer.presentCached(frame.values, frame.metadata);
      this.gpuKey = frame.key; this.gpuDevice = this.renderer.device;
    }
    this.renderer.paint(colors.palette ?? 0, colors.density, colors.phase, colors.definition, colors.interiorColor, colors.colorCurves);
    await this.renderer.device.queue.onSubmittedWorkDone(); check(this.signal);
    if (this.renderer.lost) throw new Error('The GPU disconnected while coloring the wallpaper. Retry GPU and create it again.');
    if (target.width !== frame.metadata.width) target.width = frame.metadata.width;
    if (target.height !== frame.metadata.height) target.height = frame.metadata.height;
    target.getContext('2d').drawImage(this.renderer.canvas, 0, 0);
  }
}
