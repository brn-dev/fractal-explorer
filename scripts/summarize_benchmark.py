"""Summarize measured results and audit effective settings against the final policy."""

import argparse
import json
from pathlib import Path

from benchmark import source_fingerprints

from fractal_explorer.accelerator import Accelerator
from fractal_explorer.models import RenderRequest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", default="benchmarks/rtx5070ti.json")
    args = parser.parse_args()
    path = Path(args.path)
    data = json.loads(path.read_text(encoding="utf-8"))
    current = source_fingerprints()
    measured = data["source_sha256"]
    for name in ("kernel.cu", "optimized.cu", "arithmetic.cuh"):
        if measured[name] != current[name]:
            raise SystemExit(f"CUDA source changed after measurement: {name}; rerun the affected benchmark")
    checked = 0
    for row in data["rows"]:
        if "error" in row or row["mode"] == "baseline":
            continue
        request = RenderRequest(
            view=data["cases"][row["case"]],
            width=row["width"],
            height=row["height"],
            **{"acceleration": "none", **data["modes"][row["mode"]]},
        )
        actual = Accelerator.options(request)[:3]
        recorded = tuple(row["metadata"][key] for key in ("arithmetic", "range_mode", "acceleration"))
        if actual != recorded:
            raise SystemExit(
                f"Effective configuration changed for {row['case']} / {row['mode']}: {actual} != {recorded}"
            )
        checked += 1
    audit = {
        "cuda_sources_unchanged": True,
        "effective_configs_unchanged": checked,
        "measured_source_sha256": measured,
        "final_source_sha256": current,
        "policy_note": "Auto rescaling was moved earlier (FP64/DD: 1e-200 to 1e-140; FP32/DS: 1e-20 to 1e-15) "
        "to preserve squared offsets at Julia critical points. All timed configurations still select "
        "the identical arithmetic/range/acceleration and CUDA source. Original run fingerprints are retained.",
        "server_note": "A subsequent static-file MIME fix serves .mjs as JavaScript on Windows; it does not change rendering.",
    }
    path.with_name(path.stem + "-policy-audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    selected = {
        "spiral": ["baseline", "fp64-fma", "double-single", "double-double", "fp64-series"],
        "deep80": ["baseline", "fp64-series", "fp64-bla"],
        "deep1000": ["fp64-scaled", "fp64-series", "fp64-bla", "fp64-series-bla"],
        "deep10000": ["fp64-scaled", "fp64-series", "fp64-bla"],
        "critical-julia": ["baseline", "fp64-fma", "fp64-series"],
    }
    lines = [
        "# Measured acceleration summary",
        "",
        f"Device: {data['device']}. Warm medians of {data['repeats']} runs.",
        "",
        "| Location | Mode | Size | Cold ms | Warm ms | Main GPU ms | Oracle max error |",
        "|---|---|---|---:|---:|---:|---:|",
    ]
    for row in data["rows"]:
        if row["mode"] not in selected.get(row["case"], []) or "error" in row:
            continue
        lines.append(
            f"| {row['case']} | {row['mode']} | {row['width']}×{row['height']} | "
            f"{row['cold_ms']:.2f} | {row['warm_median_ms']:.2f} | {row['kernel_median_ms']:.3f} | "
            f"{row['oracle_max_error']:.5g} |"
        )
    failures = [r for r in data["rows"] if "error" in r]
    successful = len(data["rows"]) - len(failures)
    lines += [
        "",
        f"{len(data['rows'])} combinations: {successful} measured, {len(failures)} rejected or failed with the reason in the full report.",
        "",
        (
            "Cold timings include CPU preparation; warm timings reuse it. Some first frames are slower even when cached renders accelerate strongly. "
            "The extreme 1e-10000 case uses 32×24, not 1080p. Errors are sampled escape-count errors, not a certification of every pixel."
        ),
        "",
        (
            "FP32 fails difficult-location accuracy checks and remains experimental. Double-single also remains opt-in. "
            "Double-double is available for precision and selective repair; replacing the entire loop with it is generally slower."
        ),
        "",
        (
            "The final auto-rescaling thresholds were moved earlier to protect squared offsets at Julia critical points. "
            f"The audit confirms unchanged CUDA sources and identical effective settings for all {checked} optimized measurements."
        ),
        "",
        (
            "The original baseline underflows the squared offset in critical-julia and misclassifies every oracle probe. "
            "Use the corrected FP64 modes as the accuracy reference for that case."
        ),
        "",
        "See the full matrix and raw JSON for individual repetitions, full-field differences, repair counts, and stage timings.",
    ]
    output = path.with_name(path.stem + "-summary.md")
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(output)
    print(f"CUDA sources match; {checked} optimized configurations match final policy.")


if __name__ == "__main__":
    main()
