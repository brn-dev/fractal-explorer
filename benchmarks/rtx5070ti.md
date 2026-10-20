# CUDA arithmetic and acceleration benchmark

Generated: 2026-10-20T17:02:46.783034+00:00 · NVIDIA GeForce RTX 5070 Ti · 5 timed repetitions

Cold timings exclude primary-kernel compilation but include uncached reference/approximation preparation and uploads. Warm timings reuse prepared data. Total timings include transfer, repair and GPU counters; kernel timings use CUDA events. Browser drawing is excluded.

If a repair kernel is first encountered during a cold render, its compilation is included in the repair stage.

Oracle errors are sampled against independent per-pixel mpmath iteration at two higher precisions. Unstable oracle probes are explicitly counted. Full-field differences compare the original FP64 renderer, which is a regression baseline rather than ground truth.

| Case / mode | Size | Cold ms | Warm median ms | GPU ms | Speedup¹ | Oracle max error | Oracle class errors | Baseline pixels > .01 | Skipped / pixel |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| overview / baseline | 1920×1080 | 6.52 | 6.35 | 4.673 | 1.00× | 1.4215e-07 | 0 | 0.000% | 0.0 |
| overview / fp64-fma | 1920×1080 | 49.25 | 7.02 | 3.730 | 0.91× | 1.4215e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-strict | 1920×1080 | 9.06 | 8.05 | 4.567 | 0.79× | 1.4215e-07 | 0 | 0.000% | 0.0 |
| overview / fp32 | 1920×1080 | 6.92 | 5.91 | 2.557 | 1.07× | 3.3469e-07 | 0 | 0.663% | 0.0 |
| overview / double-single | 1920×1080 | 8.88 | 7.50 | 4.377 | 0.85× | 1.4215e-07 | 0 | 0.019% | 0.0 |
| overview / double-double | 1920×1080 | 54.91 | 54.31 | 50.928 | 0.12× | 1.4215e-07 | 0 | 0.009% | 0.0 |
| overview / fp64-scaled | 1920×1080 | 7.38 | 6.82 | 3.722 | 0.93× | 1.4215e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-floatexp | 1920×1080 | 7.49 | 6.86 | 3.717 | 0.93× | 1.4215e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-series | 1920×1080 | 7.40 | 6.82 | 3.720 | 0.93× | 1.4215e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-bla | 1920×1080 | 7.23 | 6.91 | 3.736 | 0.92× | 1.4215e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-series-bla | 1920×1080 | 7.10 | 6.86 | 3.732 | 0.93× | 1.4215e-07 | 0 | 0.008% | 0.0 |
| overview / double-single-series-bla | 1920×1080 | 8.09 | 7.58 | 4.349 | 0.84× | 1.4215e-07 | 0 | 0.019% | 0.0 |
| spiral / baseline | 1920×1080 | 447.84 | 428.64 | 426.811 | 1.00× | 9.3329e-05 | 0 | 0.000% | 0.0 |
| spiral / fp64-fma | 1920×1080 | 396.50 | 361.69 | 358.103 | 1.19× | 9.3329e-05 | 0 | 0.520% | 0.0 |
| spiral / fp64-strict | 1920×1080 | 492.87 | 458.70 | 454.607 | 0.93× | 9.3329e-05 | 0 | 0.530% | 0.0 |
| spiral / fp32 | 1920×1080 | 91.76 | 54.25 | 41.892 | 7.90× | 71.651 | 0 | 35.720% | 0.0 |
| spiral / double-single | 1920×1080 | 136.89 | 102.50 | 98.897 | 4.18× | 9.3329e-05 | 0 | 1.162% | 0.0 |
| spiral / double-double | 1920×1080 | 5783.34 | 5749.20 | 5745.114 | 0.07× | 9.3329e-05 | 0 | 0.553% | 0.0 |
| spiral / fp64-scaled | 1920×1080 | 8494.96 | 8461.51 | 8457.553 | 0.05× | 9.3329e-05 | 0 | 0.520% | 0.0 |
| spiral / fp64-floatexp | 1920×1080 | 9631.94 | 9587.29 | 9583.396 | 0.04× | 9.3329e-05 | 0 | 0.530% | 0.0 |
| spiral / fp64-series | 1920×1080 | 791.73 | 211.60 | 207.984 | 2.03× | 9.3329e-05 | 0 | 0.554% | 998.0 |
| spiral / fp64-bla | 1920×1080 | 1195.30 | 736.64 | 732.737 | 0.58× | 9.3329e-05 | 0 | 0.520% | 0.0 |
| spiral / fp64-series-bla | 1920×1080 | 1495.15 | 507.48 | 503.672 | 0.84× | 9.3329e-05 | 0 | 0.554% | 998.0 |
| spiral / double-single-series-bla | 1920×1080 | 1335.62 | 340.59 | 336.619 | 1.26× | 9.3329e-05 | 0 | 0.758% | 998.0 |
| julia / baseline | 1920×1080 | 12.68 | 12.50 | 10.858 | 1.00× | 6.6677e-06 | 0 | 0.000% | 0.0 |
| julia / fp64-fma | 1920×1080 | 12.47 | 11.84 | 8.582 | 1.06× | 6.6677e-06 | 0 | 0.220% | 0.0 |
| julia / fp64-strict | 1920×1080 | 14.59 | 14.07 | 10.844 | 0.89× | 6.6677e-06 | 0 | 0.000% | 0.0 |
| julia / fp32 | 1920×1080 | 9.06 | 8.52 | 5.328 | 1.47× | 23.062 | 0 | 7.369% | 0.0 |
| julia / double-single | 1920×1080 | 13.36 | 12.73 | 9.609 | 0.98× | 6.6677e-06 | 0 | 0.406% | 0.0 |
| julia / double-double | 1920×1080 | 139.57 | 139.64 | 135.937 | 0.09× | 6.6677e-06 | 0 | 0.241% | 0.0 |
| julia / fp64-scaled | 1920×1080 | 12.51 | 11.89 | 8.622 | 1.05× | 6.6677e-06 | 0 | 0.220% | 0.0 |
| julia / fp64-floatexp | 1920×1080 | 12.41 | 11.81 | 8.602 | 1.06× | 6.6677e-06 | 0 | 0.220% | 0.0 |
| julia / fp64-series | 1920×1080 | 12.34 | 11.82 | 8.611 | 1.06× | 6.6677e-06 | 0 | 0.220% | 0.0 |
| julia / fp64-bla | 1920×1080 | 12.24 | 11.85 | 8.592 | 1.05× | 6.6677e-06 | 0 | 0.220% | 0.0 |
| julia / fp64-series-bla | 1920×1080 | 12.44 | 11.84 | 8.595 | 1.06× | 6.6677e-06 | 0 | 0.220% | 0.0 |
| julia / double-single-series-bla | 1920×1080 | 13.59 | 12.92 | 9.607 | 0.97× | 6.6677e-06 | 0 | 0.406% | 0.0 |
| deep80 / baseline | 1920×1080 | 50.22 | 45.03 | 43.452 | 1.00× | 6.3949e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-fma | 1920×1080 | 48.17 | 39.24 | 35.940 | 1.15× | 6.3949e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-strict | 1920×1080 | 57.96 | 48.90 | 45.631 | 0.92× | 6.3949e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp32 | 1920×1080 | 684.65 | 675.50 | 667.749 | 0.07× | 1.1554e-05 | 0 | 0.029% | 0.0 |
| deep80 / double-single | 1920×1080 | 863.92 | 854.94 | 851.054 | 0.05× | 6.3949e-06 | 0 | 0.000% | 0.0 |
| deep80 / double-double | 1920×1080 | 588.82 | 580.55 | 576.415 | 0.08× | 6.3949e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-scaled | 1920×1080 | 794.40 | 785.27 | 781.041 | 0.06× | 6.3949e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-floatexp | 1920×1080 | 834.83 | 826.50 | 822.774 | 0.05× | 6.3949e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-series | 1920×1080 | 134.76 | 11.48 | 8.285 | 3.92× | 6.3949e-06 | 0 | 0.000% | 212.0 |
| deep80 / fp64-bla | 1920×1080 | 167.19 | 26.53 | 23.330 | 1.70× | 6.3949e-06 | 0 | 0.000% | 160.0 |
| deep80 / fp64-series-bla | 1920×1080 | 255.51 | 14.76 | 11.557 | 3.05× | 6.3949e-06 | 0 | 0.000% | 212.0 |
| deep80 / double-single-series-bla | 1920×1080 | 287.96 | 47.82 | 44.513 | 0.94× | 6.3949e-06 | 0 | 0.000% | 212.0 |
| deep1000 / baseline | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| deep1000 / fp64-fma | 1920×1080 | 10077.70 | 10043.98 | 10040.081 | — | 0.00011593 | 0 | 0.000% | 0.0 |
| deep1000 / fp64-strict | 1920×1080 | 10168.97 | 10134.30 | 10130.374 | — | 0.00011593 | 0 | 0.000% | 0.0 |
| deep1000 / fp32 | 1920×1080 | 8058.98 | 8023.46 | 7980.199 | — | 0.00011593 | 0 | 0.000% | 0.0 |
| deep1000 / double-single | 1920×1080 | 10645.71 | 10612.05 | 10608.023 | — | 0.00011593 | 0 | 0.000% | 0.0 |
| deep1000 / double-double | 1920×1080 | 16250.15 | 16215.44 | 16211.465 | — | 0.00011593 | 0 | 0.000% | 0.0 |
| deep1000 / fp64-scaled | 1920×1080 | 10077.89 | 10043.69 | 10039.727 | — | 0.00011593 | 0 | 0.000% | 0.0 |
| deep1000 / fp64-floatexp | 1920×1080 | 9757.05 | 9724.15 | 9720.268 | — | 0.00011593 | 0 | 0.000% | 0.0 |
| deep1000 / fp64-series | 1920×1080 | 1509.82 | 44.69 | 41.508 | — | 0.00011593 | 0 | 0.000% | 2657.0 |
| deep1000 / fp64-bla | 1920×1080 | 707.51 | 193.31 | 189.846 | — | 0.00011593 | 0 | 0.000% | 2624.0 |
| deep1000 / fp64-series-bla | 1920×1080 | 1985.01 | 48.47 | 44.727 | — | 0.00011593 | 0 | 0.000% | 2657.0 |
| deep1000 / double-single-series-bla | 1920×1080 | 2034.39 | 48.22 | 45.037 | — | 0.00011593 | 0 | 0.000% | 2657.0 |
| repair / baseline | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / fp64-fma | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / fp64-strict | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / fp32 | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / double-single | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / double-double | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / fp64-scaled | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / fp64-floatexp | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / fp64-series | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / fp64-bla | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / fp64-series-bla | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| repair / double-single-series-bla | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / baseline | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / fp64-fma | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / fp64-strict | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / fp32 | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / double-single | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / double-double | 1920×1080 | 43.06 | 41.49 | 37.867 | — | 1.7829e-06 | 0 | 0.000% | 0.0 |
| direct-tricorn / fp64-scaled | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / fp64-floatexp | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / fp64-series | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / fp64-bla | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / fp64-series-bla | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| direct-tricorn / double-single-series-bla | 1920×1080 | — | unsupported / failed | — | — | — | — | — | — |
| deep10000 / baseline | 32×24 | — | unsupported / failed | — | — | — | — | — | — |
| deep10000 / fp64-fma | 32×24 | 644.84 | 502.74 | 500.844 | — | 0.00079633 | 0 | 0.000% | 0.0 |
| deep10000 / fp64-strict | 32×24 | 624.85 | 507.30 | 505.497 | — | 0.00079633 | 0 | 0.000% | 0.0 |
| deep10000 / fp32 | 32×24 | 520.98 | 403.30 | 401.444 | — | 0.00079633 | 0 | 0.000% | 0.0 |
| deep10000 / double-single | 32×24 | 660.61 | 544.34 | 542.218 | — | 0.00079633 | 0 | 0.000% | 0.0 |
| deep10000 / double-double | 32×24 | 899.49 | 782.90 | 780.972 | — | 0.00079633 | 0 | 0.000% | 0.0 |
| deep10000 / fp64-scaled | 32×24 | 618.95 | 502.58 | 500.762 | — | 0.00079633 | 0 | 0.000% | 0.0 |
| deep10000 / fp64-floatexp | 32×24 | 590.89 | 475.99 | 474.071 | — | 0.00079633 | 0 | 0.000% | 0.0 |
| deep10000 / fp64-series | 32×24 | 5930.34 | 1.52 | 0.347 | — | 0.00079633 | 0 | 0.000% | 16612.0 |
| deep10000 / fp64-bla | 32×24 | 2269.12 | 3.15 | 1.942 | — | 0.00079633 | 0 | 0.000% | 16576.0 |
| deep10000 / fp64-series-bla | 32×24 | 8049.38 | 1.65 | 0.419 | — | 0.00079633 | 0 | 0.000% | 16612.0 |
| deep10000 / double-single-series-bla | 32×24 | 8063.50 | 1.57 | 0.428 | — | 0.00079633 | 0 | 0.000% | 16612.0 |
| critical-julia / baseline | 1920×1080 | 173.62 | 168.78 | 167.164 | 1.00× | 612.85 | 16 | 0.000% | 0.0 |
| critical-julia / fp64-fma | 1920×1080 | 1535.13 | 1527.78 | 1524.017 | 0.11× | 2.5464e-05 | 0 | 100.000% | 0.0 |
| critical-julia / fp64-strict | 1920×1080 | 1562.59 | 1554.48 | 1550.762 | 0.11× | 2.5464e-05 | 0 | 100.000% | 0.0 |
| critical-julia / fp32 | 1920×1080 | 1290.43 | 1283.68 | 1267.566 | 0.13× | 2.5464e-05 | 0 | 100.000% | 0.0 |
| critical-julia / double-single | 1920×1080 | 1535.43 | 1528.83 | 1525.016 | 0.11× | 2.5464e-05 | 0 | 100.000% | 0.0 |
| critical-julia / double-double | 1920×1080 | 3103.76 | 3097.79 | 3093.630 | 0.05× | 2.5464e-05 | 0 | 100.000% | 0.0 |
| critical-julia / fp64-scaled | 1920×1080 | 1542.16 | 1535.90 | 1532.008 | 0.11× | 2.5464e-05 | 0 | 100.000% | 0.0 |
| critical-julia / fp64-floatexp | 1920×1080 | 1529.95 | 1521.92 | 1518.108 | 0.11× | 2.5464e-05 | 0 | 100.000% | 0.0 |
| critical-julia / fp64-series | 1920×1080 | 242.91 | 29.72 | 26.057 | 5.68× | 2.5464e-05 | 0 | 100.000% | 596.0 |
| critical-julia / fp64-bla | 1920×1080 | 278.40 | 182.88 | 179.048 | 0.92× | 2.5464e-05 | 0 | 100.000% | 544.0 |
| critical-julia / fp64-series-bla | 1920×1080 | 336.79 | 29.57 | 26.083 | 5.71× | 2.5464e-05 | 0 | 100.000% | 596.0 |
| critical-julia / double-single-series-bla | 1920×1080 | 325.13 | 29.45 | 26.002 | 5.73× | 2.5464e-05 | 0 | 100.000% | 596.0 |

¹ Warm end-to-end speedup over the baseline at the same case and resolution. An inaccurate result is not an acceptable speedup.

## Errors and unresolved oracle probes

- deep1000 / baseline: RenderError: This view requires the optimized CUDA renderer; CPU/baseline exponent range exceeded
- repair / baseline: RuntimeError: RenderError: This view exceeded the precision repair budget. Move slightly or lower the render quality and try again.
- repair / fp64-fma: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / fp64-strict: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / fp32: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / double-single: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / double-double: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / fp64-scaled: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / fp64-floatexp: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / fp64-series: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / fp64-bla: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / fp64-series-bla: RenderError: Precision repair budget exceeded; lower quality or move slightly
- repair / double-single-series-bla: RenderError: Precision repair budget exceeded; lower quality or move slightly
- direct-tricorn / baseline: RenderError: This view requires the optimized CUDA renderer; CPU/baseline exponent range exceeded
- direct-tricorn / fp64-fma: ValueError: Direct fp64 cannot resolve this view; enable quadratic perturbation
- direct-tricorn / fp64-strict: ValueError: Direct fp64 cannot resolve this view; enable quadratic perturbation
- direct-tricorn / fp32: ValueError: Direct fp32 cannot resolve this view; enable quadratic perturbation
- direct-tricorn / double-single: ValueError: Direct double-single cannot resolve this view; enable quadratic perturbation
- direct-tricorn / fp64-scaled: ValueError: Direct fp64 cannot resolve this view; enable quadratic perturbation
- direct-tricorn / fp64-floatexp: ValueError: Direct fp64 cannot resolve this view; enable quadratic perturbation
- direct-tricorn / fp64-series: ValueError: Direct fp64 cannot resolve this view; enable quadratic perturbation
- direct-tricorn / fp64-bla: ValueError: Direct fp64 cannot resolve this view; enable quadratic perturbation
- direct-tricorn / fp64-series-bla: ValueError: Direct fp64 cannot resolve this view; enable quadratic perturbation
- direct-tricorn / double-single-series-bla: ValueError: Direct double-single cannot resolve this view; enable quadratic perturbation
- deep10000 / baseline: RenderError: This view requires the optimized CUDA renderer; CPU/baseline exponent range exceeded
