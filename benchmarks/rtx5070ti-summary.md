# Measured acceleration summary

Device: NVIDIA GeForce RTX 5070 Ti. Warm medians of 5 runs.

| Location | Mode | Size | Cold ms | Warm ms | Main GPU ms | Oracle max error |
|---|---|---|---:|---:|---:|---:|
| spiral | baseline | 1920×1080 | 447.84 | 428.64 | 426.811 | 9.3329e-05 |
| spiral | fp64-fma | 1920×1080 | 396.50 | 361.69 | 358.103 | 9.3329e-05 |
| spiral | double-single | 1920×1080 | 136.89 | 102.50 | 98.897 | 9.3329e-05 |
| spiral | double-double | 1920×1080 | 5783.34 | 5749.20 | 5745.114 | 9.3329e-05 |
| spiral | fp64-series | 1920×1080 | 791.73 | 211.60 | 207.984 | 9.3329e-05 |
| deep80 | baseline | 1920×1080 | 50.22 | 45.03 | 43.452 | 6.3949e-06 |
| deep80 | fp64-series | 1920×1080 | 134.76 | 11.48 | 8.285 | 6.3949e-06 |
| deep80 | fp64-bla | 1920×1080 | 167.19 | 26.53 | 23.330 | 6.3949e-06 |
| deep1000 | fp64-scaled | 1920×1080 | 10077.89 | 10043.69 | 10039.727 | 0.00011593 |
| deep1000 | fp64-series | 1920×1080 | 1509.82 | 44.69 | 41.508 | 0.00011593 |
| deep1000 | fp64-bla | 1920×1080 | 707.51 | 193.31 | 189.846 | 0.00011593 |
| deep1000 | fp64-series-bla | 1920×1080 | 1985.01 | 48.47 | 44.727 | 0.00011593 |
| deep10000 | fp64-scaled | 32×24 | 618.95 | 502.58 | 500.762 | 0.00079633 |
| deep10000 | fp64-series | 32×24 | 5930.34 | 1.52 | 0.347 | 0.00079633 |
| deep10000 | fp64-bla | 32×24 | 2269.12 | 3.15 | 1.942 | 0.00079633 |
| critical-julia | baseline | 1920×1080 | 173.62 | 168.78 | 167.164 | 612.85 |
| critical-julia | fp64-fma | 1920×1080 | 1535.13 | 1527.78 | 1524.017 | 2.5464e-05 |
| critical-julia | fp64-series | 1920×1080 | 242.91 | 29.72 | 26.057 | 2.5464e-05 |

108 combinations: 83 measured, 25 rejected or failed with the reason in the full report.

Cold timings include CPU preparation; warm timings reuse it. Some first frames are slower even when cached renders accelerate strongly. The extreme 1e-10000 case uses 32×24, not 1080p. Errors are sampled escape-count errors, not a certification of every pixel.

FP32 fails difficult-location accuracy checks and remains experimental. Double-single also remains opt-in. Double-double is available for precision and selective repair; replacing the entire loop with it is generally slower.

The final auto-rescaling thresholds were moved earlier to protect squared offsets at Julia critical points. The audit confirms unchanged CUDA sources and identical effective settings for all 78 optimized measurements.

The original baseline underflows the squared offset in critical-julia and misclassifies every oracle probe. Use the corrected FP64 modes as the accuracy reference for that case.

See the full matrix and raw JSON for individual repetitions, full-field differences, repair counts, and stage timings.
