# CUDA arithmetic and acceleration benchmark

Generated: 2026-10-20T16:42:26.903590+00:00 · NVIDIA GeForce RTX 5070 Ti · 3 timed repetitions

Cold timings exclude compilation but include uncached reference/approximation preparation and uploads. Warm timings reuse prepared data. Total timings include transfer, repair and GPU counters; kernel timings use CUDA events. Browser drawing is excluded.

Oracle errors are sampled against independent per-pixel mpmath iteration at two higher precisions. Unstable oracle probes are explicitly counted. Full-field differences compare the original FP64 renderer, which is a regression baseline rather than ground truth.

| Case / mode | Size | Cold ms | Warm median ms | GPU ms | Speedup¹ | Oracle max error | Oracle class errors | Baseline pixels > .01 | Skipped / pixel |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| deep10000 / fp64-series | 32×24 | 5943.83 | 1.62 | 0.349 | — | 0.00079633 | 0 | 0.000% | 16612.0 |
| deep10000 / fp64-bla | 32×24 | 2211.36 | 3.35 | 1.851 | — | 0.00079633 | 0 | 0.000% | 16576.0 |
| deep10000 / fp64-series-bla | 32×24 | 7967.85 | 1.59 | 0.420 | — | 0.00079633 | 0 | 0.000% | 16612.0 |

¹ Warm end-to-end speedup over the baseline at the same case and resolution. An inaccurate result is not an acceptable speedup.

## Errors and unresolved oracle probes

