# Browser-only WebGPU benchmark

Measured 2026-10-20T19:04:27.162Z · adapter: nvidia blackwell · 5 warm repetitions · 1920×1080 unless stated otherwise.

The browser ran on the same Windows/RTX 5070 Ti host as the native benchmarks. Browser adapter information reports “nvidia blackwell”, rather than an exact model. Browser timings use performance.now and GPU queue completion, including dispatch overhead. They exclude coloring/display and independent oracle checks. Cold timings include uncached MPFR references and approximation preparation, with the primary pipeline compiled separately.

| View / mode | Size | Cold ms | Warm median ms | Sample max error | Class errors | Skipped / pixel |
|---|---|---:|---:|---:|---:|---:|
| overview / auto | 1920×1080 | 11.20 | 8.90 | 9.5367e-7 | 0 | 0.0 |
| overview / fp32 | 1920×1080 | 8.80 | 6.00 | 0.0000047684 | 0 | 0.0 |
| spiral / auto | 1920×1080 | 321.80 | 364.20 | 0.0000 | 0 | 0.0 |
| spiral / series | 1920×1080 | 262.00 | 218.50 | 0.0000 | 0 | 1022.0 |
| spiral / bla | 1920×1080 | 418.90 | 378.90 | 0.0000 | 0 | 0.0 |
| spiral / combined | 1920×1080 | 285.20 | 249.70 | 0.0000 | 0 | 1022.0 |
| julia / auto | 1920×1080 | 13.80 | 13.90 | 4.7684e-7 | 0 | 0.0 |
| julia / fp32 | 1920×1080 | 8.80 | 8.10 | 85.067 | 0 | 0.0 |
| deep80 / auto | 1920×1080 | 22.80 | 7.90 | 0.0000 | 0 | 213.0 |
| deep80 / series | 1920×1080 | 25.50 | 7.90 | 0.0000 | 0 | 213.0 |
| deep80 / bla | 1920×1080 | 17.70 | 14.80 | 0.0000 | 0 | 192.0 |
| deep80 / combined | 1920×1080 | 22.20 | 7.60 | 0.0000 | 0 | 213.0 |
| deep1000 / auto | 1920×1080 | 141.00 | 8.40 | 0.0000 | 0 | 2658.0 |
| deep1000 / series | 1920×1080 | 141.40 | 7.50 | 0.0000 | 0 | 2658.0 |
| deep1000 / bla | 1920×1080 | 40.20 | 22.70 | 0.0000 | 0 | 2624.0 |
| deep1000 / combined | 1920×1080 | 155.40 | 6.90 | 0.0000 | 0 | 2658.0 |
| criticalJulia / auto | 1920×1080 | 20.60 | 8.20 | 0.0000 | 0 | 598.0 |
| criticalJulia / series | 1920×1080 | 22.30 | 9.70 | 0.0000 | 0 | 598.0 |
| criticalJulia / bla | 1920×1080 | 21.70 | 20.70 | 0.0000 | 0 | 544.0 |
| criticalJulia / combined | 1920×1080 | 19.50 | 8.50 | 0.0000 | 0 | 598.0 |
| burningShip / auto | 1920×1080 | 23.50 | 20.90 | 0.27499 | 0 | 0.0 |
| burningShip / fp32 | 1920×1080 | 9.50 | 9.70 | 83.484 | 0 | 0.0 |
| tricorn / auto | 1920×1080 | 10.80 | 16.30 | 9.5367e-7 | 0 | 0.0 |
| tricorn / fp32 | 1920×1080 | 10.50 | 8.20 | 9.5367e-7 | 0 | 0.0 |
| cubic / auto | 1920×1080 | 11.40 | 7.30 | 2.3842e-7 | 0 | 0.0 |
| cubic / fp32 | 1920×1080 | 7.40 | 8.50 | 4.7684e-7 | 0 | 0.0 |
| deep10000 / series | 32×24 | 511.80 | 6.90 | 0.0000 | 0 | 16612.0 |
| deep10000 / bla | 32×24 | 179.30 | 7.60 | 0.0000 | 0 | 16576.0 |

The spiral, deep Mandelbrot and critical Julia paired-mode samples agree with independent MPFR values within the reported FP32 output precision. Samples at two different higher working precisions were checked for stability; this is not a certification of all pixels.

Paired direct iteration has approximately 48 significand bits. The Burning Ship sample differs by 0.275 escape-count units from the high-precision oracle; that limitation is retained in the report. Plain FP32 differs by up to 85 escape-count units on the Julia sample and remains opt-in. Higher GPU throughput does not establish numerical accuracy.

The 1e-10000 case uses 32×24, not 1080p. Its direct MPFR oracle checks are deliberately slow. No physical smartphone measurements have been made. The browser version does not have native FP64 or double-double shaders; comparisons with native FP64 therefore differ in arithmetic as well as API overhead.

Desktop reference points from the existing measurements: overview baseline 6.35 ms; spiral double-single 102.50 ms and FP64 series 211.60 ms; deep80 FP64 series 11.48 ms; deep1000 FP64 series 44.69 ms. Browser series is faster on some deep cached views but slower on the spiral. These are selected locations, not a universal performance percentage.

All 28 configurations completed. Raw samples, per-pixel oracle comparisons, stage timings, shader fingerprints and effective settings are in [web-rtx5070ti.json](web-rtx5070ti.json).
