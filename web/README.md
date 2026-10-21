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

The **Vignette** switch under **Light & color** removes the edge-darkening overlay immediately. Its setting persists across reloads and place changes.

Tap the **eye icon** in the top-right corner (or press **H**) for an unobstructed fractal view. The eye closes when the UI is hidden and stays visible so you can restore the controls on mobile. The **chevron above the location cards** toggles those cards independently; **P** does the same. Both buttons have descriptive tooltips and accessible labels. The card preference persists across reloads and is preserved when you hide and restore the full interface.

All Julia families and Newton basins have real/imaginary constant sliders alongside exact decimal fields. The usual slider range is −2 to 2 in steps of 0.0001; entering a value outside that range expands the slider to include it. Synchronizing a slider never rounds the stored decimal text. Formula-specific parameters also have sliders and number fields. Iterations has a slider spanning 50–50,000, synchronized with its number field. Sliders update the view as you move them, temporarily using at most Native quality for a lighter preview; your selected quality returns on release or after a short pause.

### Parameter playgrounds

Five additional families bring the total to ten:

| Family | Parameters | What to try |
| --- | --- | --- |
| Multibrot | Integer power 2–8 | Change the symmetry of the parameter plane; power 2 recovers Mandelbrot. |
| Multijulia | Power 2–8 and complex constant | Change both the rotational symmetry and connectedness. |
| Phoenix Julia | Complex constant and memory −1 to 1 | The previous orbit point contributes `p × z[n−1]`; start with `c = 0.5667`, `p = −0.5` for feathers. Memory 0 recovers quadratic Julia. |
| Burning Ship Julia | Complex constant | Real and imaginary parts are folded before squaring, producing asymmetric filaments. |
| Newton basins | Power 3–8, complex root target, relaxation 0.2–1.8 | Solve `z^d = c`. Power changes the number of roots; relaxation reshapes their basins. |

The Places strip includes Phoenix feathers, Newton islands, and a Multijulia garden. The original five formulas retain their existing iteration rules, including the original Burning Ship's fold **after** adding `c`. Burning Ship Julia folds **before** squaring.

Newton uses `z ← z − λ(z^d − c)/(d z^(d−1))`. Color combines the root reached and convergence speed; a dark pixel has not converged within the budget or encountered a singular derivative. The residual threshold is `|z^d − c|² < 1e−12`; derivatives below squared magnitude `1e−24` and excursions beyond `|z|² = 1e8` are left unclassified. It uses convergence rather than the escape-radius control. Memory and relaxation are uploaded as paired FP32 values in the default GPU mode, like the complex constants. The added families use direct iteration, with the existing `1e−10` minimum view width for nonquadratic formulas; quadratic Mandelbrot/Julia keep their deeper perturbation path.

Formula references: [Fractint's Phoenix implementation](https://user.xmission.com/~legalize/fractals/fractint-xref/6864.html) and [Paul Bourke's Newton–Raphson fractals](https://www.paulbourke.net/fractals/newtonraphson/). These are mathematical references; the browser implementations here are written for this renderer.

Quality offers Draft (½), Native (1×), Fine (1.5×), High (2×), Ultra (3×), and Extreme (4×), multiplying each viewport dimension. Extreme requests up to 16 times Native's pixel count. The selected quality persists across reloads. High/Ultra/Extreme remove the ordinary 2560-pixel width cap: desktop WebGPU can render up to 8192 pixels per side and 33,554,432 pixels in total, further limited by the device's texture and buffer capabilities. Higher modes on touch devices use up to 6 megapixels; the CPU fallback uses up to 960,000 pixels. Ordinary modes keep their existing budgets. The quality note shows the actual resolution and when a limit is reached. Higher quality changes spatial sampling, while the iteration control determines how long each sample is explored; it does not change arithmetic precision.

Ten formulas, palettes and color animation, arbitrary decimal coordinates, saved places, JSON import/export, PNG export up to 4K, and local GIF/MP4 exports are included. **Wandering speed** in Light & color controls palette cycles per second (0.05–2, default 0.12) and persists across reloads. Animation advances with elapsed time, so its speed is independent of the display refresh rate.

### Live parameter automation

Each fractal parameter slider, including iterations, has a small loop icon. Enable it to reveal a target, independent cycle speed, and **Cycle shape**. The number field and slider thumb remain at the starting value; a separate diamond above the track and the **Now** readout follow playback. Decimal constants interpolate with decimal arithmetic, preserving long endpoints. Integer powers and iteration budgets advance in whole steps. Targets, speeds, and cycle shapes persist in sessions, bookmarks, and location JSON. Changing fractal type clears the current automation; choosing a saved place restores that place's configuration.

Cycle shapes are **Sine** (gentle easing), **Smoothstep** (cubic easing), **Smootherstep** (quintic easing that lingers near the turns), **Ease & pause** (quintic easing with a pause for 15% of the cycle at each endpoint), **Ease to middle** (quintic easing to a momentary stop at the midpoint), **Slow middle · continuous** (slows down through the midpoint while keeping a nonzero speed), **Pause at middle** (a midpoint hold for 20% of each journey, with quintic easing into and out of the hold), and **Linear** (constant speed with immediate reversals). Slow middle · continuous blends 25% Sine and 75% Ease to middle; its midpoint speed is π/8 of the constant-speed path, and its endpoint turns remain smooth. Newly enabled automation defaults to Smootherstep. Previously saved loops without a shape retain their original Sine motion; the renamed Ease to middle preserves saved `slow-middle` settings. All shapes stay between the exact start and target and return continuously to the start. Live playback, preview, and GIF/MP4 export share the same path; changing shape rebuilds the live cache.

Cycle speeds range from 0.05 to 2 cycles/second in increments of 0.05. Their greatest common divisor determines a shared loop no longer than 20 seconds, with each parameter making an integer number of cycles. The joint duration is snapped to a 30 fps frame grid, so some requested rates are approximated slightly; the actual shared duration is displayed.

On a change to automation, coordinates, iterations, quality, or arithmetic, the previous cache is discarded and frame zero is rendered first. Its completion starts the playback clock. The first pass then computes ahead of the playhead: frames whose deadlines elapsed during a slow render are left missing. Once that pass reaches the end of the loop, missing frames are filled near the playhead until every slot is ready. During warm-up, playback holds the nearest earlier cached frame. Exact duplicate views, including the return journey, share the same field and need no second render.

The RAM cache stores Float32 scalar fields and their metadata, rather than palette-specific pictures. Recoloring and the vignette do not invalidate it. Complete loops target 30 fps with no further fractal iteration: a cached field is uploaded and recolored on the GPU, or painted by the CPU fallback. Device speed can still limit presentation. The pause button freezes playback and backfilling; panning or changing a paused view still refreshes frame zero. Hidden tabs and open dialogs suspend it too. Late results from a superseded configuration are discarded; preparation resumes at frame zero for the new configuration.

**Animation cache RAM** under Rendering sets the field budget from 64 MiB to 16 GiB. Desktop defaults to 2 GiB; touch devices default to 256 MiB. The choice persists on this browser across reloads and stays independent of saved locations. Memory is allocated as frames render, rather than reserving the entire limit immediately; browser and device memory limits still apply. Changing the limit releases the previous loop and rebuilds it at the new resolution.

The animation's resolution is fitted to that budget for the entire loop, including room for two working fields. The panel reports the resolution, maximum field RAM use, and selected limit. This can lower the live resolution for long loops or high quality settings. Increasing the budget allows higher resolution up to the selected quality and renderer limits. Turning off all automation releases the cached loop; exports independently render their selected resolution.

The bottom status bar shows current **RAM cache** usage between the resolution and GPU name. It counts the retained animation buffers as frames are cached, counting shared buffers only once; it resets when the loop is discarded. This is frame-cache memory, excluding other app allocations, GPU memory, and browser overhead.

### Share links

**Share link** in the controls opens a compact link for the current location, formula parameters, iterations, colors, vignette, color wandering, and parameter automation (targets, speeds, cycle shapes, and paused state). Use **Copy link**, or **Share…** when the browser offers a native share sheet. Opening the link overrides the recipient's current view and starts the loop from its beginning; reduced-motion preferences are respected. Quality, RAM budget, and arithmetic preferences stay local to the recipient's device. Cache frames, images, and video are never embedded in the link.

Settings are compressed with the browser's [Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API) and encoded in a versioned URL fragment. Uncompressed links are generated when compression is unavailable. No upload, shortener, account, or backend is involved. Decoding validates settings and bounds compressed expansion before applying the view. Very deep coordinates can still produce longer links.

Hosted builds share their current site and project path. Localhost previews generate links to `https://brn-dev.github.io/fractal-explorer/`; deploy the new build before sending those links to friends. Forks can override the destination at build time with `VITE_SHARE_BASE_URL=https://your-domain/project/`. An older offline installation may need **Update cached app** before it understands a new link. A shared URL restores its snapshot again when reloaded.

### Animation downloads

**Animation · GIF / MP4** opens a preview for the main-view parameter loop or a full palette cycle. **Zoom animation · 8× journey** opens the same flow for a single zoom journey. Parameter targets/speeds are configured in the main view; the dialog reads a snapshot of them. Colors can wander at the same time or remain fixed. Parameter loops complete an integer number of palette cycles to keep their seam continuous. Color-only exports reuse one computed field. Zoom duration is adjustable from 0.5 to 20 seconds.

Choose GIF or MP4, a longest edge from 480 to 3840 pixels, Draft/Balanced/High quality, and 10/15/24/30 fps (MP4 also offers 60 fps). MP4 uses the browser's H.264 encoder through WebCodecs and Mediabunny, with an explicit bitrate scaled to size, frame rate, and quality. Availability is checked for the selected settings; GIF remains available if the browser cannot encode H.264. GIF quality selects 64/128/256 palette colors; optional ordered dithering smooths gradients. GIF delays are distributed in hundredths of a second so 30 fps does not drift to 25 fps. Large GIF settings are bounded by an encoding-memory budget; choose MP4 or reduce size/frame rate if that limit is reached.

The preview uses at most a 480-pixel edge. Export renders every frame sequentially at the chosen output size, then encodes it with explicit timestamps. Slow rendering extends export time without dropping frames or changing the movie's duration. **Cancel export** or closing the dialog stops the job. **Include vignette** defaults off each time downloads are opened and applies to PNG, GIF, and MP4 independently of the on-screen vignette. Location JSON contains the starting coordinates, rendering settings, and automation configuration, rather than a composited image.

Session and bookmarks use `fractal-web-*` storage keys, separate from the desktop app. Location JSON uses the same `fractal-explorer/v1` format; unsupported desktop-only depths are rejected when imported.

## Arithmetic and acceleration

- Auto uses paired FP32 (double-single, approximately 48 significand bits). Pixel coordinates are divided in paired arithmetic before iteration; converting the normalized pixel offset to one float first would discard the extra precision.
- At startup, GPU arithmetic probes check the paired sum/product transforms. The implementation uses split products and does not assume that WGSL `fma()` is fused. If startup validation fails or WebGPU is unavailable, the app uses a lower-resolution CPU worker. This is a small device check, not a proof of every operation or pixel.
- FP32 is an explicit experimental option. It can produce substantially different escape counts on difficult Julia sets.
- Quadratic views use perturbation below width `1e-7`. Auto enables separate exponents below `1e-15`, preserving the squared offset through a Julia critical point, and enables eighth-order series skipping there. Optional aligned bilinear jumps and the combined mode are available.
- Reference precision is zoom-dependent, with 40 decimal guard digits, rounded to a 64-digit bucket. The orbit is calculated with MPFR at full working precision, then packed into paired mantissas and separate exponents. Reference and approximation caches are bounded. The current viewport span is packed independently even when the reference is reused across zoom levels.
- Approximation coefficients and bounds are prepared with binary64 mantissas and separate exponents in the worker. Series preparation accounts for the full viewport disk, omitted terms, roundoff estimates, and intermediate escape. Bilinear maps have radius, nonlinear-remainder, and rounding checks. These are finite-precision estimates, not certified interval arithmetic.
- The GPU keeps the escape field and palette; normal recoloring needs no full-frame readback. A small statistics buffer supplies minima and timing counters. Exports and precision repair read fields back to the CPU. Live parameter automation also reads each newly computed field once into its RAM cache, then uploads cached fields for playback.
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

The additional families have independent mpmath fixtures generated at 80 and 120 decimal digits by `tests/generate-families-oracle.py`, plus parameter-validation, formula-reduction, Newton root/singularity, location round-trip, and GIF-path tests. With the development server running, open `tests/gpu.html` and choose **Run GPU checks** to compare direct GPU/CPU fields and inspect the five new families. This development test page is excluded from the production bundle. It reports differences rather than assuming chaotic boundary pixels agree at different precisions.

Automation tests use a simulated clock and delayed renders to verify deadline skipping, later backfilling, pause/resume, stale-frame rejection, deduplication, complete cached playback without new rendering, RAM bounds, multiple independent speeds, exact decimal interpolation, integer parameters, and export timestamps/quality plans.

Open **Performance lab → Benchmark this device** (or `benchmark.html`) for browser measurements. The page runs one cold render and three or five warm repetitions per configuration, with direct MPFR oracle samples at two precisions. Results stay local until downloaded. GPU stage timings use queue-completion wall time, including dispatch overhead; they are not CUDA-event timings. Totals exclude color drawing and oracle validation. The `1e-10000` test uses 32×24; other cases use the selected resolution. See `../benchmarks/web-rtx5070ti.json` for measured desktop-browser results.

The algorithms build on the same perturbation, rescaling, series, and bilinear ideas as the desktop edition. WGSL's arithmetic semantics differ from CUDA; copying CUDA intrinsics would not preserve their guarantees. Browser support is detected at runtime.

## Dependencies and source

`gmp-wasm` 1.3.2 includes GMP/MPFR compiled to WebAssembly and is distributed under LGPL-3.0-only. Its unmodified source, build scripts, and bundled binary are available in the [exact npm source package](https://registry.npmjs.org/gmp-wasm/-/gmp-wasm-1.3.2.tgz) and [upstream repository](https://github.com/Daninet/gmp-wasm). The module stays replaceable through the npm dependency and normal rebuild. `gifenc` 1.0.3 is MIT-licensed. `mediabunny` 1.62.0 is MPL-2.0-licensed; its unmodified [source package](https://registry.npmjs.org/mediabunny/-/mediabunny-1.62.0.tgz) is linked in the notices. MP4 code is loaded only by the export flow. Notices and complete dependency licenses are included in the built site at `licenses/`.

## License

This project's original code is licensed under the [MIT License](../LICENSE). Third-party dependencies retain their own licenses. Each production build copies the project license to `dist/licenses/fractal-explorer-LICENSE.txt` alongside the dependency notices and includes it in the offline cache.
