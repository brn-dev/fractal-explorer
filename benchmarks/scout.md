# CUDA arithmetic and acceleration benchmark

Generated: 2026-10-20T16:39:43.439900+00:00 · NVIDIA GeForce RTX 5070 Ti · 2 timed repetitions

Cold timings exclude compilation but include uncached reference/approximation preparation and uploads. Warm timings reuse prepared data. Total timings include transfer, repair and GPU counters; kernel timings use CUDA events. Browser drawing is excluded.

Oracle errors are sampled against independent per-pixel mpmath iteration at two higher precisions. Unstable oracle probes are explicitly counted. Full-field differences compare the original FP64 renderer, which is a regression baseline rather than ground truth.

| Case / mode | Size | Cold ms | Warm median ms | GPU ms | Speedup¹ | Oracle max error | Oracle class errors | Baseline pixels > .01 | Skipped / pixel |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| overview / baseline | 640×360 | 1.37 | 1.36 | 1.124 | 1.00× | 2.261e-07 | 0 | 0.000% | 0.0 |
| overview / fp64-fma | 640×360 | 36.35 | 2.14 | 0.884 | 0.63× | 2.261e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-strict | 640×360 | 2.93 | 2.33 | 1.033 | 0.58× | 2.261e-07 | 0 | 0.000% | 0.0 |
| overview / fp32 | 640×360 | 2.37 | 1.82 | 0.547 | 0.75× | 2.5074e-07 | 0 | 0.698% | 0.0 |
| overview / double-single | 640×360 | 2.89 | 2.28 | 0.963 | 0.60× | 2.261e-07 | 0 | 0.029% | 0.0 |
| overview / double-double | 640×360 | 15.21 | 14.34 | 12.785 | 0.09× | 2.261e-07 | 0 | 0.010% | 0.0 |
| overview / fp64-scaled | 640×360 | 2.19 | 1.92 | 0.841 | 0.71× | 2.261e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-floatexp | 640×360 | 2.17 | 1.93 | 0.814 | 0.71× | 2.261e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-series | 640×360 | 2.25 | 1.86 | 0.786 | 0.73× | 2.261e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-bla | 640×360 | 2.21 | 1.92 | 0.856 | 0.71× | 2.261e-07 | 0 | 0.008% | 0.0 |
| overview / fp64-series-bla | 640×360 | 2.11 | 1.93 | 0.830 | 0.71× | 2.261e-07 | 0 | 0.008% | 0.0 |
| overview / double-single-series-bla | 640×360 | 2.23 | 2.00 | 0.937 | 0.68× | 2.261e-07 | 0 | 0.029% | 0.0 |
| spiral / baseline | 640×360 | 74.74 | 54.95 | 54.690 | 1.00× | 5.7971e-05 | 0 | 0.000% | 0.0 |
| spiral / fp64-fma | 640×360 | 87.29 | 51.97 | 50.481 | 1.06× | 5.7971e-05 | 0 | 0.520% | 0.0 |
| spiral / fp64-strict | 640×360 | 98.45 | 64.06 | 62.784 | 0.86× | 5.7971e-05 | 0 | 0.529% | 0.0 |
| spiral / fp32 | 640×360 | 133.68 | 99.67 | 46.673 | 0.55× | 0.092942 | 0 | 35.772% | 0.0 |
| spiral / double-single | 640×360 | 133.47 | 97.03 | 95.565 | 0.57× | 5.7971e-05 | 0 | 1.137% | 0.0 |
| spiral / double-double | 640×360 | 800.21 | 771.08 | 769.341 | 0.07× | 5.7971e-05 | 0 | 0.551% | 0.0 |
| spiral / fp64-scaled | 640×360 | 1121.66 | 1082.91 | 1081.137 | 0.05× | 5.7971e-05 | 0 | 0.520% | 0.0 |
| spiral / fp64-floatexp | 640×360 | 1235.78 | 1207.12 | 1205.300 | 0.05× | 5.7971e-05 | 0 | 0.529% | 0.0 |
| spiral / fp64-series | 640×360 | 613.69 | 31.57 | 30.330 | 1.74× | 5.7971e-05 | 0 | 0.546% | 998.0 |
| spiral / fp64-bla | 640×360 | 1188.41 | 740.64 | 738.898 | 0.07× | 5.7971e-05 | 0 | 0.520% | 0.0 |
| spiral / fp64-series-bla | 640×360 | 1485.21 | 495.42 | 493.726 | 0.11× | 5.7971e-05 | 0 | 0.546% | 998.0 |
| spiral / double-single-series-bla | 640×360 | 1509.37 | 519.48 | 517.791 | 0.11× | 5.7971e-05 | 0 | 0.757% | 998.0 |
| deep80 / baseline | 640×360 | 10.21 | 5.08 | 4.909 | 1.00× | 7.5335e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-fma | 640×360 | 14.46 | 5.72 | 4.623 | 0.89× | 7.5335e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-strict | 640×360 | 15.34 | 6.82 | 5.710 | 0.74× | 7.5335e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp32 | 640×360 | 87.01 | 78.14 | 76.913 | 0.06× | 3.96e-05 | 0 | 0.035% | 0.0 |
| deep80 / double-single | 640×360 | 110.19 | 101.40 | 100.085 | 0.05× | 7.5335e-06 | 0 | 0.000% | 0.0 |
| deep80 / double-double | 640×360 | 79.35 | 70.67 | 69.459 | 0.07× | 7.5335e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-scaled | 640×360 | 98.55 | 89.96 | 88.712 | 0.06× | 7.5335e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-floatexp | 640×360 | 102.90 | 94.37 | 93.110 | 0.05× | 7.5335e-06 | 0 | 0.000% | 0.0 |
| deep80 / fp64-series | 640×360 | 125.08 | 2.01 | 0.948 | 2.52× | 7.5335e-06 | 0 | 0.000% | 213.0 |
| deep80 / fp64-bla | 640×360 | 135.64 | 12.08 | 10.925 | 0.42× | 7.5335e-06 | 0 | 0.000% | 187.7 |
| deep80 / fp64-series-bla | 640×360 | 240.33 | 3.74 | 2.494 | 1.36× | 7.5335e-06 | 0 | 0.000% | 213.0 |
| deep80 / double-single-series-bla | 640×360 | 260.42 | 7.61 | 6.392 | 0.67× | 7.5335e-06 | 0 | 0.000% | 213.0 |
| deep1000 / baseline | 640×360 | — | unsupported / failed | — | — | — | — | — | — |
| deep1000 / fp64-fma | 640×360 | 1165.51 | 1131.26 | 1129.170 | — | 9.1479e-05 | 0 | 0.000% | 0.0 |
| deep1000 / fp64-strict | 640×360 | 1175.95 | 1141.26 | 1139.338 | — | 9.1479e-05 | 0 | 0.000% | 0.0 |
| deep1000 / fp32 | 640×360 | 950.65 | 915.71 | 913.948 | — | 9.1479e-05 | 0 | 0.000% | 0.0 |
| deep1000 / double-single | 640×360 | 1270.85 | 1237.31 | 1235.474 | — | 9.1479e-05 | 0 | 0.000% | 0.0 |
| deep1000 / double-double | 640×360 | 1892.25 | 1857.56 | 1855.625 | — | 9.1479e-05 | 0 | 0.000% | 0.0 |
| deep1000 / fp64-scaled | 640×360 | 1165.54 | 1131.13 | 1129.220 | — | 9.1479e-05 | 0 | 0.000% | 0.0 |
| deep1000 / fp64-floatexp | 640×360 | 1129.79 | 1096.05 | 1094.201 | — | 9.1479e-05 | 0 | 0.000% | 0.0 |
| deep1000 / fp64-series | 640×360 | 1464.97 | 7.07 | 5.688 | — | 9.1479e-05 | 0 | 0.000% | 2657.0 |
| deep1000 / fp64-bla | 640×360 | 536.97 | 26.83 | 25.387 | — | 9.1479e-05 | 0 | 0.000% | 2632.3 |
| deep1000 / fp64-series-bla | 640×360 | 1960.11 | 8.58 | 7.283 | — | 9.1479e-05 | 0 | 0.000% | 2657.0 |
| deep1000 / double-single-series-bla | 640×360 | 1952.22 | 9.25 | 7.707 | — | 9.1479e-05 | 0 | 0.000% | 2657.0 |

¹ Warm end-to-end speedup over the baseline at the same case and resolution. An inaccurate result is not an acceptable speedup.

## Errors and unresolved oracle probes

- deep1000 / baseline: RenderError: This view requires the optimized CUDA renderer; CPU/baseline exponent range exceeded
