# Fractal Explorer

A local, GPU-accelerated successor to [brn-dev/FractalVisualizer](https://github.com/brn-dev/FractalVisualizer). Python computes the fractal on your machine; a browser provides the interface. There is no rendering service or hosted account.

A completely separate [browser-only edition](web/README.md) now lives in `web/`. It uses WebGPU and a WebAssembly worker, builds to static files, and has its own dependencies and tests. The desktop renderer and its launch workflow below are unchanged. [Browser benchmark results](benchmarks/web-rtx5070ti.md) record its performance and precision tradeoffs.

The web edition can be hosted on GitHub Pages using the included [deployment workflow](.github/workflows/deploy-web.yml). See [Pages setup](web/README.md#github-pages); only the static web bundle is published.

## Inspiration and attribution

**[Fractal Explorer — fractalexplorer.org](https://fractalexplorer.org/)** was a visual and interaction reference for this recreation. Credit to its creators for the fractal exploration experience that helped inspire this app.

## Run

Install [uv](https://docs.astral.sh/uv/), then run from this directory:

```powershell
uv sync --extra cuda
uv run fractal-explorer
```

The app opens at **http://127.0.0.1:8765**. It needs Python 3.12 or 3.13; uv can install Python automatically. The CUDA extra installs CuPy and NVIDIA's CUDA 13 runtime wheels, so a separate CUDA Toolkit is unnecessary. A compatible NVIDIA driver is required. The first install downloads approximately 1.2 GB of runtime libraries.

For a CPU-only installation, use `uv sync` followed by `uv run fractal-explorer`. Numba compiles a parallel CPU renderer automatically. CUDA initialization or execution failures fall back to CPU, and the interface displays the actual backend. The first CPU render includes JIT compilation time.

Options: `uv run fractal-explorer --port 9000 --no-browser`. The server binds only to loopback. Keep the terminal running while using the app. There is no JavaScript build step. Fonts load from Google Fonts when available; the interface also works offline with system fonts.

## Explore

- Drag to pan; scroll to zoom around the pointer; double click to zoom into a point.
- WASD / arrow keys pan. E / Space / + zoom in; Q / − zoom out. Hold Shift for smaller steps. R resets; H hides the interface.
- Choose Mandelbrot, Julia, the original app's Burning Ship variation, Tricorn, or cubic Julia. Julia constants are editable.
- Palettes, density, phase, and color animation update the existing escape field without recomputing the fractal. The palette follows the local escape-count range so detail stays visible at deep zoom.
- Saved locations appear in the destination strip and persist in this browser. Pan the destination strip horizontally to see all locations. The current session is restored after refresh.
- Open **Coordinates** to enter an exact center and view width. Values are decimal strings; scientific notation works.
- **The deep edge** starts at a view width of `1e-80` around `c = i`. **Beyond doubles** starts at `1e-1000`, beyond the exponent range of IEEE double precision.
- Export a PNG at the current resolution or up to 3840 pixels on the long side. GIF export renders a 24-frame, 8× zoom on the local engine, up to 720 pixels on the long side. JSON export/import preserves the complete view and palette.
- Open **Rendering → Performance lab** to choose arithmetic, exponent range, iteration acceleration, and FMA contraction. Settings persist in the session and location JSON. PNG and GIF exports use the selected settings.

## Precision and acceleration

The renderer switches between direct iteration at ordinary magnifications and perturbation below a viewport width of `1e-7` for Mandelbrot and quadratic Julia. The original FP64 renderer remains available through `renderer="baseline"` in the API and benchmark.

One reference orbit is calculated with **mpmath at zoom-dependent precision**, with 30 decimal guard digits. The optimized path rounds working precision up to a 64-decimal-digit bucket so nearby zoom levels can reuse a reference. Installed `gmpy2` gives mpmath its faster GMP backend. The orbit is calculated at full working precision before its samples are rounded and packed for the GPU. Each pixel stores a small offset separately from that orbit. For Mandelbrot, the recurrence is:

```text
Z[n+1] = Z[n]² + C                    high-precision reference
δz[n+1] = 2 Z[n] δz[n] + δz[n]² + δc  independent FP64 pixel delta
```

Quadratic Julia uses the same recurrence with `δc = 0` and a pixel-dependent initial `δz`. Coordinates and navigation stay in decimal arithmetic on the server, retaining supplied long centers even before zooming deeply. JavaScript never assembles deep pixel coordinates; its zoom label also handles widths below `Number` underflow. A fused CUDA kernel performs the escape loop per thread. CuPy handles compilation, memory, and CUDA dispatch. The original Numba FP64 renderer remains the CPU fallback.

| Option | Implementation and tradeoff |
| --- | --- |
| FP32 | Native float arithmetic. Experimental: fastest arithmetic can lose detail on difficult orbits. |
| Double-single | Two FP32 components, about 48 significand bits. Error-free sum/product building blocks use explicit round-to-nearest and FMA residual recovery. Experimental; benchmark accuracy as well as speed. |
| FP64 | Native double arithmetic; the conservative default. |
| Double-double | Two FP64 components, about 106 significand bits. Better precision at a substantial arithmetic cost; also used for flagged-pixel repair. |
| Standard range | Native exponent range, with no software exponent work in the ordinary loop. Invalid depth/type combinations are rejected. |
| Rescaled | Shares a temporary scale for each perturbation step. Falls back to full extended-range operations near tiny references, cancellation, or incompatible component scales. |
| Float-exp | Each real/imaginary component carries a normalized mantissa and separate integer exponent throughout iteration. More general, usually slower. |
| Series | An eighth-order polynomial skips a common prefix. A disk containing every pixel bounds the omitted polynomial tail and checks for intermediate escape. Preparation is cached. |
| BLA | Aligned dyadic bilinear maps skip blocks of at least 32 steps. Each map has an input radius, a nonlinear remainder majorant, roundoff allowance, and an intermediate escape bound. Disabled nodes cannot be used by zero deltas. Jump endpoints are checked. |
| FMA | Controls compiler contraction of ordinary multiply/add expressions. Paired arithmetic always uses explicit FMA where required to recover product residuals. |

Perturbation cancellation and exhausted reference orbits mark suspect pixels. Mandelbrot can rebase during iteration. With adaptive repair, only flagged pixels are rerun on the GPU in FP64 and then double-double; unaffected pixels are masked out of the iteration loop. Remaining suspect regions receive new high-precision references recursively. Small residual groups are recomputed per pixel with mpmath. Repair budgets are 128 extra references, six subdivisions, and 4,096 direct pixel repairs; exceeding a budget returns an explicit error.

Auto uses FP64 for quadratic iteration, standard exponent range while it is suitable, and rescaling below `1e-140` for FP64/DD or `1e-15` for FP32/DS. These thresholds leave room for a critical Julia step to square an offset: the offset can fit in a native float while its square underflows. BLA is enabled automatically below a width of `1e-280` to avoid iterating every extended-range step. Other formulas switch to direct double-double below `1e-10`. Lower-precision modes remain explicit experimental choices. Series and BLA can be much faster when cached, but their CPU preparation can make the first frame slower; Auto avoids that cost on ordinary views.

Reference orbits, approximation data, device uploads, and output buffers are reused with bounded caches. Reference, preparation, compilation, upload, CUDA-event kernel, download, and repair timings are exposed in render metadata. GPU step counters report actual native and skipped iterations per pixel.

The methods build on [mathr's perturbation/rescaling explanation](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html), [Fraktaler's BLA theory](https://fraktaler.mathr.co.uk/fraktaler-3-1.2.html#bivariate-linear-approximation), and the [QD arithmetic paper](https://www.davidhbailey.com/dhbpapers/qd.pdf). The approximation bounds are our implementation; they use finite-precision arithmetic, not certified interval arithmetic. CUDA sources are `arithmetic.cuh`, `optimized.cu`, and the original `kernel.cu`.

### Current limits

- Optimized CUDA Mandelbrot and quadratic Julia: minimum view width `1e-10000`, up to 10,048 decimal reference working digits. This input limit is deliberate; it is not an unlimited zoom or accuracy guarantee. Deep, expensive references are still sequential CPU computations.
- Burning Ship, Tricorn, and cubic Julia: direct double-double supports widths down to `1e-26`. Burning Ship preserves the original app's `abs` **after** squaring and adding `c`; cubic is the original constant-parameter Julia formula.
- CPU and original CUDA baseline: quadratic width limit `1e-280`, other formula limit `1e-12`. Deeper requests require the optimized CUDA path and are rejected rather than silently underflowing on CPU.
- Extended exponents use signed integers. Extremely contracting values below `2^-100000000` are zeroed before integer wraparound. Under the supported iteration/bailout budget they cannot grow back to the supported image scale.
- Maximum 50,000 iterations, 4096 pixels per side, and 16 megapixels per still image. GIF export is capped at 10,000 iterations and 600,000 pixels per frame.
- High precision prevents coordinate collapse; it does not establish set membership. Interior color means the pixel did not escape within the current iteration budget. Increase iterations when detail appears solid.
- Finite-precision iteration and heuristic glitch detection do not certify every pixel. FP32 in particular differs substantially from higher-precision results on some locations. A working-digit count describes the reference, not the precision of each GPU operation.
- Complex boundaries can require expensive repair; animation is an offline export. The main time shown in the interface includes reference creation, device transfers, and repairs, and excludes HTTP transfer, palette application, and browser drawing.

## Benchmarks

The [measurement summary](benchmarks/rtx5070ti-summary.md), [full matrix](benchmarks/rtx5070ti.md), and [raw JSON](benchmarks/rtx5070ti.json) cover the original renderer, FMA on/off, all four arithmetic types, rescaling, full float-exp, series, BLA, and their combination across multiple locations. The extreme `1e-10000` case deliberately uses 32×24; other cases use the requested resolution. It is a representative option matrix, not every Cartesian combination. The repair-heavy Julia stress case exceeds the current repair budget at 1080p; those failures are retained in the matrix.

Each configuration records one cold render and five timed warm repetitions by default. Primary-kernel compilation is measured separately; a newly encountered repair kernel can add compilation to the cold repair stage. Reference/approximation caches are cleared before each cold render. CUDA events measure the main kernel. End-to-end times include transfers, step-counter reduction, and repairs, while excluding browser rendering.

Accuracy checks sample independent per-pixel mpmath iteration at two higher precisions. Julia critical-point checks use at least twice the viewport working precision so the oracle itself preserves squared offsets. Unstable oracle probes are counted explicitly. Full-field differences from the original FP64 renderer are reported separately: that renderer is a regression baseline, not ground truth. Source fingerprints, GPU/CUDA versions, settings, and individual timing samples are saved in JSON. A final policy audit checks that the measured CUDA sources and effective configurations match the final settings. Faster inaccurate configurations are not recommended by Auto.

## Develop and verify

```powershell
uv sync --extra cuda --extra dev
uv run pytest -q
uv run ruff check .
node --test tests/test_ui_numbers.mjs
uv run python scripts/benchmark.py
uv run python scripts/summarize_benchmark.py benchmarks/rtx5070ti.json
```

Tests compare independent high-precision orbits, paired-arithmetic residuals under both FMA settings, all arithmetic/range modes, series/BLA skipping, underflow beyond the IEEE exponent range, sparse precision promotion, adaptive references, exponent contraction, cancellation thresholds, and disabled BLA nodes at an exact escape iteration. They also check decimal navigation, API validation, zoom-label underflow, and a decoded multi-frame GIF. CUDA tests skip explicitly when unavailable; a passing CPU-only run does not certify GPU execution.

For a shorter run, select cases and modes, for example:

```powershell
uv run python scripts/benchmark.py --cases spiral,deep80 --modes baseline,double-single,fp64-series --repeats 5
```

Use `--resume` with the same output path, GPU, resolution, and repetition count to finish an interrupted matrix. Completed measurements are retained only when CUDA sources and effective configurations match.

The original C#/WPF app remains a separate project. This implementation recreates its fractal formulas, exploration controls, color customization, still export, and animated zoom export in a new local architecture.

## License

This project's original code is licensed under the [MIT License](LICENSE).
Third-party dependencies retain their own licenses; see the [web bundle's license notices](web/public/licenses/README.txt), including `gmp-wasm` (LGPL-3.0-only) and `gifenc` (MIT).
