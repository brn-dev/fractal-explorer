# Fractal Explorer Web

A separate browser-only edition. WebGPU computes and colors the fractal on the visitor's GPU. An MPFR/GMP WebAssembly worker computes reference orbits, prepares approximations, and repairs remaining suspect pixels. There is no Python service, CUDA installation, rendering API, remote computation, or runtime CDN dependency.

The desktop app in `../fractal_explorer/` keeps its existing source, dependencies, launch command, CUDA arithmetic, and precision options. This edition has its own UI files, storage keys, dependencies, lockfile, tests, and build output. Its initial visual assets were copied from the desktop UI to avoid coupling desktop behavior to web changes.

## Inspiration and attribution

**[Fractal Explorer — fractalexplorer.org](https://fractalexplorer.org/)** was a visual and interaction reference for this recreation. Credit to its creators for the fractal exploration experience that helped inspire this app.

## Run and distribute

Requires Node 22.12+ or 24+ for development. Visitors only need a supported browser.

```powershell
cd web
npm ci
npm run dev
```

Open http://127.0.0.1:8766. This development server only serves static files and modules; all computation runs inside the browser. The desktop app remains on port 8765.

```powershell
npm run build
npm run preview
```

Deploy the **contents of `dist/`** to any static HTTPS host. All paths are relative, so deployment under a subdirectory is supported. No environment variables or server functions are required. The build includes a versioned service worker and a web app manifest; offline use is available when the browser permits service workers and the full cache finishes installing. Performance lab reports whether offline caching is ready. Updated files activate on a later visit after existing tabs close. HTTPS (or localhost) is required for WebGPU and service workers. Some embedded browsers restrict service workers; those still need static hosting to reload.

### GitHub Pages

The repository includes [a Pages deployment workflow](../.github/workflows/deploy-web.yml). In repository **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source once. Pushes to `main` that change `web/` or the workflow then install the locked npm dependencies with Node 24, build the production app, run its tests, and deploy only `web/dist/`. You can also run the workflow manually from **Actions → Deploy web edition to GitHub Pages → Run workflow**. No custom secrets, Python environment, CUDA runtime, or application backend are needed.

For `brn-dev/fractal-explorer`, the Pages URL is `https://brn-dev.github.io/fractal-explorer/` and the benchmark is at `benchmark.html` beneath it. Vite's relative base, the manifest, module worker, and service worker all remain within that project path. This deployment workflow does not start, build, or change the desktop renderer. Site updates show an **Update cached app** button when an older offline copy is open.

## Explore

Drag to pan, scroll or pinch to zoom, double-click to zoom toward a point. Keyboard shortcuts match the desktop app. Controls collapse initially on narrow screens. Mobile rendering uses a smaller pixel budget and bounded GPU submissions. Native performance and sustained speed still depend on the phone, browser, driver, and thermal state; mobile layouts have been checked in an emulated viewport, not on physical phones.

The interface keeps the fractal in focus: no corner branding, location counter, or decorative settings header/footer. The location title and subtitle appear on startup, when choosing a place, or when changing fractal type, then fade away after three seconds. Panning and adjusting parameters leave them hidden. The settings panel collapses to a single 44-pixel controls icon; tap it to restore the settings.

GPU information appears alongside render timing and resolution in the bottom-left status line, including on mobile. Collapsing the place cards also hides their heading, leaving just the toggle icon.

Tap the **eye icon** in the top-right corner (or press **H**) for an unobstructed fractal view. The eye closes when the UI is hidden and stays visible so you can restore the controls on mobile. The **chevron above the location cards** toggles those cards independently; **P** does the same. Both buttons have descriptive tooltips and accessible labels. The card preference persists across reloads and is preserved when you hide and restore the full interface.

Julia and cubic Julia have real/imaginary constant sliders alongside exact decimal fields. The usual slider range is −2 to 2 in steps of 0.0001; entering a value outside that range expands the slider to include it. Synchronizing a slider never rounds the stored decimal text. Iterations also has a slider spanning 50–50,000, synchronized with its number field. Sliders update the view as you move them, temporarily using at most Native quality for a lighter preview; your selected quality returns on release or after a short pause.

Quality offers Draft (½), Native (1×), Fine (1.5×), High (2×), Ultra (3×), and Extreme (4×), multiplying each viewport dimension. Extreme requests up to 16 times Native's pixel count. The selected quality persists across reloads. High/Ultra/Extreme remove the ordinary 2560-pixel width cap: desktop WebGPU can render up to 8192 pixels per side and 33,554,432 pixels in total, further limited by the device's texture and buffer capabilities. Higher modes on touch devices use up to 6 megapixels; the CPU fallback uses up to 960,000 pixels. Ordinary modes keep their existing budgets. The quality note shows the actual resolution and when a limit is reached. Higher quality changes spatial sampling, while the iteration control determines how long each sample is explored; it does not change arithmetic precision.

Five formulas, palettes and color animation, arbitrary decimal coordinates, saved places, JSON import/export, PNG export up to 4K, and local 24-frame GIF zoom export are included. Session and bookmarks use `fractal-web-*` storage keys, separate from the desktop app. Location JSON uses the same `fractal-explorer/v1` format; unsupported desktop-only depths are rejected when imported.

## Arithmetic and acceleration

- Auto uses paired FP32 (double-single, approximately 48 significand bits). Pixel coordinates are divided in paired arithmetic before iteration; converting the normalized pixel offset to one float first would discard the extra precision.
- At startup, GPU arithmetic probes check the paired sum/product transforms. The implementation uses split products and does not assume that WGSL `fma()` is fused. If startup validation fails or WebGPU is unavailable, the app uses a lower-resolution CPU worker. This is a small device check, not a proof of every operation or pixel.
- FP32 is an explicit experimental option. It can produce substantially different escape counts on difficult Julia sets.
- Quadratic views use perturbation below width `1e-7`. Auto enables separate exponents below `1e-15`, preserving the squared offset through a Julia critical point, and enables eighth-order series skipping there. Optional aligned bilinear jumps and the combined mode are available.
- Reference precision is zoom-dependent, with 40 decimal guard digits, rounded to a 64-digit bucket. The orbit is calculated with MPFR at full working precision, then packed into paired mantissas and separate exponents. Reference and approximation caches are bounded. The current viewport span is packed independently even when the reference is reused across zoom levels.
- Approximation coefficients and bounds are prepared with binary64 mantissas and separate exponents in the worker. Series preparation accounts for the full viewport disk, omitted terms, roundoff estimates, and intermediate escape. Bilinear maps have radius, nonlinear-remainder, and rounding checks. These are finite-precision estimates, not certified interval arithmetic.
- The GPU keeps the escape field and palette; normal recoloring and animation need no full-frame readback. A small statistics buffer supplies minima and timing counters. Images are downloaded to the CPU for exports and precision repair only.
- Cancellation marks suspect pixels. Up to 16 new 128×128 reference tiles are attempted; remaining groups of up to 4,096 pixels are recomputed directly with MPFR. A larger unresolved group returns an error rather than accepting an incomplete field.

This edition accepts Mandelbrot/quadratic Julia widths down to `1e-10000` and up to 50,000 iterations. The extreme depth is expensive to verify; it is not an interactive-speed or per-pixel accuracy guarantee. Other formulas use direct paired arithmetic down to `1e-10`, compared with the desktop app's direct double-double limit of `1e-26`. There is no native FP64 or double-double WebGPU mode. Chaotic boundaries can differ from the desktop FP64 renderer even in paired mode; the benchmark records sampled errors explicitly. Interior means no escape within the iteration budget.

The CPU fallback uses MPFR references and binary64/extended-exponent pixel iteration in the worker, with series acceleration and final MPFR repairs. Use `?cpu=1` to exercise it. It does not pretend to be GPU rendering. Large CPU-only exports may be slow.

## Verify and benchmark

```powershell
npm test
npm run verify:desktop
npm run build
```

The test command builds the static bundle first. Tests compare the WebAssembly oracle with a fixture independently calculated by the existing Python mpmath renderer at two higher precisions. They also cover decimal navigation, preservation of long centers, exponent underflow, viewport-span cache correctness, useful series skipping, bilinear-map preparation, CPU fallback formulas, and offline installation/navigation/update behavior. The desktop hash snapshot verifies its original 20 source and test files byte for byte; it is intentionally fixed to the state before this web edition was added.

Open **Performance lab → Benchmark this device** (or `benchmark.html`) for browser measurements. The page runs one cold render and three or five warm repetitions per configuration, with direct MPFR oracle samples at two precisions. Results stay local until downloaded. GPU stage timings use queue-completion wall time, including dispatch overhead; they are not CUDA-event timings. Totals exclude color drawing and oracle validation. The `1e-10000` test uses 32×24; other cases use the selected resolution. See `../benchmarks/web-rtx5070ti.json` for measured desktop-browser results.

The algorithms build on the same perturbation, rescaling, series, and bilinear ideas as the desktop edition. WGSL's arithmetic semantics differ from CUDA; copying CUDA intrinsics would not preserve their guarantees. Browser support is detected at runtime.

## Dependencies and source

`gmp-wasm` 1.3.2 includes GMP/MPFR compiled to WebAssembly and is distributed under LGPL-3.0-only. Its unmodified source, build scripts, and bundled binary are available in the [exact npm source package](https://registry.npmjs.org/gmp-wasm/-/gmp-wasm-1.3.2.tgz) and [upstream repository](https://github.com/Daninet/gmp-wasm). The module stays replaceable through the npm dependency and normal rebuild. `gifenc` 1.0.3 is MIT-licensed. Notices are included in the built site at `licenses/`.

## License

This project's original code is licensed under the [MIT License](../LICENSE). Third-party dependencies retain their own licenses. Each production build copies the project license to `dist/licenses/fractal-explorer-LICENSE.txt` alongside the dependency notices and includes it in the offline cache.
