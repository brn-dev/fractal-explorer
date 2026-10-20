"""Reproducible, accuracy-aware CUDA matrix; writes JSON and Markdown.

uv run python scripts/benchmark.py --width 1920 --height 1080 --repeats 5
"""

import argparse
import hashlib
import json
import platform
from datetime import UTC, datetime
from pathlib import Path
from statistics import median
from time import perf_counter

import numpy as np
from mpmath.libmp.backend import BACKEND

from fractal_explorer.accelerator import Accelerator
from fractal_explorer.engine import Engine, exact_pixel, reference_orbit
from fractal_explorer.models import RenderRequest, View
from fractal_explorer.preparation import prepare, reference

MODES = {
    "baseline": {"renderer": "baseline"},
    "fp64-fma": {"arithmetic": "fp64", "fma": True},
    "fp64-strict": {"arithmetic": "fp64", "fma": False},
    "fp32": {"arithmetic": "fp32"},
    "double-single": {"arithmetic": "double-single"},
    "double-double": {"arithmetic": "double-double"},
    "fp64-scaled": {"arithmetic": "fp64", "range_mode": "scaled"},
    "fp64-floatexp": {"arithmetic": "fp64", "range_mode": "floatexp"},
    "fp64-series": {"arithmetic": "fp64", "acceleration": "series"},
    "fp64-bla": {"arithmetic": "fp64", "acceleration": "bla"},
    "fp64-series-bla": {"arithmetic": "fp64", "acceleration": "series-bla"},
    "double-single-series-bla": {"arithmetic": "double-single", "acceleration": "series-bla"},
}
CASES = {
    "overview": View(),
    "spiral": View(x="-0.743643887037151", y="0.13182590420533", span="5e-11", iterations=3500),
    "julia": View(fractal="julia", x="0", y="0", julia_x="-0.8", julia_y="0.156", iterations=1000),
    "deep80": View(x="0", y="1", span="1e-80", iterations=1000),
    "deep1000": View(x="0", y="1", span="1e-1000", iterations=4000),
    "repair": View(
        fractal="julia", x="2.000000001", y="0", span="2e-8", julia_x="-2", julia_y="0", iterations=100
    ),
    "direct-tricorn": View(fractal="tricorn", x="-2", y="0", span="1e-20", iterations=300),
    "deep10000": View(x="-2", y="0", span="1e-10000", iterations=20000),
    "critical-julia": View(
        fractal="julia", x="0", y="0", span="1e-180", julia_x="-2", julia_y="0", iterations=1000
    ),
}


def source_fingerprints():
    folder = Path(__file__).resolve().parent.parent / "fractal_explorer"
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(folder.iterdir())
        if p.suffix in (".py", ".cu", ".cuh")
    }


def probes(view, width, height, count):
    rng = np.random.default_rng(1407)
    points = {(0, 0), (height - 1, width - 1), (height // 2 - 1, width // 2 - 1), (height // 2, width // 2)}
    while len(points) < count:
        points.add((int(rng.integers(height)), int(rng.integers(width))))
    result, unstable = [], []
    for row, col in sorted(points):
        # At a Julia critical point, the first relevant variation can be the
        # square of the viewport width. Two merely similar low-precision oracles
        # can otherwise agree on the same lost real component.
        extra = max(60, view.digits + 60) if view.fractal == "julia" else 60
        a = exact_pixel(view, col, row, width, height, extra_digits=extra)
        b = exact_pixel(view, col, row, width, height, extra_digits=extra + 60)
        if abs(a - b) > 0.002:
            unstable.append([row, col, a, b])
        else:
            result.append((row, col, b))
    return result, unstable


def report(data, path):
    lines = [
        "# CUDA arithmetic and acceleration benchmark",
        "",
        f"Generated: {data['utc']} · {data['device']} · {data['repeats']} timed repetitions",
        "",
        (
            "Cold timings exclude primary-kernel compilation but include uncached reference/approximation preparation and uploads. "
            "Warm timings reuse prepared data. Total timings include transfer, repair and GPU counters; "
            "kernel timings use CUDA events. Browser drawing is excluded."
        ),
        "",
        "If a repair kernel is first encountered during a cold render, its compilation is included in the repair stage.",
        "",
        (
            "Oracle errors are sampled against independent per-pixel mpmath iteration at two higher precisions. "
            "Unstable oracle probes are explicitly counted. Full-field differences compare the original FP64 renderer, "
            "which is a regression baseline rather than ground truth."
        ),
        "",
        "| Case / mode | Size | Cold ms | Warm median ms | GPU ms | Speedup¹ | Oracle max error | Oracle class errors | Baseline pixels > .01 | Skipped / pixel |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    baselines = {
        r["case"]: r["warm_median_ms"] for r in data["rows"] if r["mode"] == "baseline" and "error" not in r
    }
    for r in data["rows"]:
        name = f"{r['case']} / {r['mode']}"
        if "error" in r:
            lines.append(
                f"| {name} | {r['width']}×{r['height']} | — | unsupported / failed | — | — | — | — | — | — |"
            )
            continue
        speedup = f"{baselines[r['case']] / r['warm_median_ms']:.2f}×" if r["case"] in baselines else "—"
        lines.append(
            f"| {name} | {r['width']}×{r['height']} | {r['cold_ms']:.2f} | {r['warm_median_ms']:.2f} | "
            f"{r['kernel_median_ms']:.3f} | {speedup} | {r['oracle_max_error']:.5g} | "
            f"{r['oracle_class_errors']} | {r.get('baseline_difference_fraction', 0):.3%} | "
            f"{r['metadata'].get('mean_skipped_steps', 0):.1f} |"
        )
    lines += [
        "",
        (
            "¹ Warm end-to-end speedup over the baseline at the same case and resolution. "
            "An inaccurate result is not an acceptable speedup."
        ),
        "",
        "## Errors and unresolved oracle probes",
        "",
    ]
    for r in data["rows"]:
        if "error" in r:
            lines.append(f"- {r['case']} / {r['mode']}: {r['error']}")
    for case, unstable in data["unstable_oracle_probes"].items():
        if unstable:
            lines.append(f"- {case}: {len(unstable)} oracle probes changed with increased working precision.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--cases", default=",".join(CASES))
    parser.add_argument("--modes", default=",".join(MODES))
    parser.add_argument("--probes", type=int, default=16)
    parser.add_argument("--output", default="benchmarks/latest.json")
    parser.add_argument(
        "--resume", action="store_true", help="Continue a saved matrix without rerunning completed rows"
    )
    args = parser.parse_args()
    if args.repeats < 1 or not 4 <= args.probes <= 128:
        parser.error("Use at least one repetition and 4–128 oracle probes")
    engine = Engine()
    if engine.accelerator is None:
        raise SystemExit(f"CUDA is required for this benchmark: {engine.cuda.error}")
    cp = engine.cuda.cp
    data = {
        "utc": datetime.now(UTC).isoformat(),
        "device": engine.cuda.name,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cupy": cp.__version__,
        "cuda_runtime": cp.cuda.runtime.runtimeGetVersion(),
        "cuda_driver": cp.cuda.runtime.driverGetVersion(),
        "source_sha256": source_fingerprints(),
        "cases": {name: value.model_dump() for name, value in CASES.items()},
        "modes": MODES,
        "mpmath_backend": BACKEND,
        "repeats": args.repeats,
        "rows": [],
        "unstable_oracle_probes": {},
    }
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    if args.resume and path.exists():
        saved = json.loads(path.read_text(encoding="utf-8"))
        if saved["device"] != data["device"] or saved["repeats"] != args.repeats:
            parser.error("Resume requires the same GPU and repetition count")
        for name in ("kernel.cu", "optimized.cu", "arithmetic.cuh"):
            if saved["source_sha256"][name] != data["source_sha256"][name]:
                parser.error(f"CUDA source changed: {name}; start a fresh matrix")
        for row in saved["rows"]:
            if row["case"] != "deep10000" and (row["width"], row["height"]) != (args.width, args.height):
                parser.error("Resume requires the original resolution")
            if "error" not in row and row["mode"] != "baseline":
                old_request = RenderRequest(
                    view=saved["cases"][row["case"]],
                    width=row["width"],
                    height=row["height"],
                    **{"acceleration": "none", **saved["modes"][row["mode"]]},
                )
                recorded = tuple(row["metadata"][k] for k in ("arithmetic", "range_mode", "acceleration"))
                if Accelerator.options(old_request)[:3] != recorded:
                    parser.error(f"Policy changed effective settings for {row['case']} / {row['mode']}")
        saved["cases"].update(data["cases"])
        saved.setdefault("resume_sessions", []).append(
            {"utc": data["utc"], "source_sha256": data["source_sha256"]}
        )
        data = saved
        print(
            f"Resuming {len(data['rows'])} completed rows; CUDA sources and effective configurations match.",
            flush=True,
        )
    completed = {(row["case"], row["mode"]) for row in data["rows"]}
    engine.render(RenderRequest(width=32, height=24, renderer="baseline"))
    for case_name in args.cases.split(","):
        pending = [mode for mode in args.modes.split(",") if (case_name, mode) not in completed]
        if not pending:
            continue
        view = CASES[case_name]
        width, height = (32, 24) if case_name == "deep10000" else (args.width, args.height)
        print(f"Oracle: {case_name} ({width}×{height})", flush=True)
        truth, unstable = probes(view, width, height, 4 if case_name == "deep10000" else args.probes)
        data["unstable_oracle_probes"][case_name] = unstable
        baseline = None
        baseline_error = None
        if float(view.span) >= 1e-280 and (
            view.fractal in ("mandelbrot", "julia") or float(view.span) >= 1e-12
        ):
            try:
                baseline = engine.render(
                    RenderRequest(view=view, width=width, height=height, renderer="baseline")
                ).field
            except Exception as exc:  # noqa: BLE001 - a baseline budget failure must not abort the matrix
                baseline_error = f"{type(exc).__name__}: {exc}"
                data.setdefault("baseline_errors", {})[case_name] = baseline_error
                print(f"  Baseline comparison unavailable: {baseline_error}", flush=True)
        for mode_name in pending:
            options = MODES[mode_name]
            request = RenderRequest(
                view=view, width=width, height=height, backend="cuda", **{"acceleration": "none", **options}
            )
            row = {"case": case_name, "mode": mode_name, "width": width, "height": height}
            row["oracle_precision"] = (
                "two working precisions >= 2*view.digits+60"
                if view.fractal == "julia"
                else "view.digits+60 and view.digits+120"
            )
            try:
                if mode_name == "baseline" and baseline_error:
                    raise RuntimeError(baseline_error)
                compile_started = perf_counter()
                if mode_name != "baseline":
                    selected = Accelerator.options(request)
                    engine.accelerator.module(selected[0], selected[1], request.fma)
                row["compile_or_load_ms"] = (perf_counter() - compile_started) * 1000
                reference.cache_clear()
                prepare.cache_clear()
                engine.accelerator.packets.clear()
                reference_orbit.cache_clear()
                start = perf_counter()
                cold = engine.render(request)
                row["cold_ms"] = (perf_counter() - start) * 1000
                totals, kernels, stage_samples = [], [], []
                for _ in range(args.repeats):
                    start = perf_counter()
                    result = engine.render(request)
                    totals.append((perf_counter() - start) * 1000)
                    kernels.append(result.metadata.get("timings", {}).get("kernel_ms", 0))
                    stage_samples.append(result.metadata.get("timings", {}))
                row.update(
                    {
                        "warm_median_ms": median(totals),
                        "warm_min_ms": min(totals),
                        "warm_samples_ms": totals,
                        "kernel_median_ms": median(kernels),
                        "cold_timings": cold.metadata.get("timings", {}),
                        "metadata": result.metadata,
                        "stage_medians": {
                            k: median(s.get(k, 0) for s in stage_samples) for k in stage_samples[-1]
                        },
                    }
                )
                errors = [abs(float(result.field[r, c]) - value) for r, c, value in truth]
                row["oracle_max_error"] = max(errors, default=0)
                row["oracle_class_errors"] = sum(
                    bool(result.field[r, c] < 0) != (value < 0) for r, c, value in truth
                )
                row["oracle_probes"] = len(truth)
                if baseline is not None:
                    difference = np.abs(result.field - baseline)
                    row["baseline_difference_fraction"] = float(np.mean(difference > 0.01))
                    row["baseline_class_difference_fraction"] = float(
                        np.mean((result.field < 0) != (baseline < 0))
                    )
                    row["baseline_max_difference"] = float(difference.max())
                print(
                    f"  {mode_name}: cold {row['cold_ms']:.1f} ms; warm {median(totals):.2f} ms; "
                    f"oracle max {row['oracle_max_error']:.5g}",
                    flush=True,
                )
            except Exception as exc:  # noqa: BLE001 - failures are benchmark results, not silent omissions
                row["error"] = f"{type(exc).__name__}: {exc}"
                print(f"  {mode_name}: {row['error']}", flush=True)
            data["rows"].append(row)
            path.write_text(json.dumps(data, indent=2, default=lambda x: x.item()), encoding="utf-8")
            report(data, path.with_suffix(".md"))
    print(f"Saved {path} and {path.with_suffix('.md')}", flush=True)


if __name__ == "__main__":
    main()
