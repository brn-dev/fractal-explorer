"""FP64 CPU/CUDA kernels, with arbitrary-precision quadratic perturbation.

Coordinates are never assembled in FP64 at deep zoom. One mpmath orbit is
rounded to FP64; pixels carry independent deltas from that orbit. Suspect pixels
are recomputed exactly rather than silently displaying perturbation glitches.
"""

import math
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Lock
from time import perf_counter

import mpmath
import numpy as np
from numba import njit, prange

from .models import FRACTALS, RenderRequest, View


class RenderError(RuntimeError):
    pass


@njit(cache=True)
def smooth(n, magnitude2, power):
    return max(0.0, n + 1.0 - math.log(math.log(math.sqrt(magnitude2))) / math.log(power))


@njit(cache=True)
def pixel(px, py, kind, limit, bailout2, jx, jy, reference, perturb):
    if perturb:
        dcx, dcy = (0.0, 0.0) if kind == 1 else (px, py)
        dx, dy = (px, py) if kind == 1 else (0.0, 0.0)
        j = 0
        for n in range(limit):
            if j + 1 >= len(reference):
                return -2.0
            rx, ry = reference[j, 0], reference[j, 1]
            dx, dy = (
                2 * (rx * dx - ry * dy) + dx * dx - dy * dy + dcx,
                2 * (rx * dy + ry * dx + dx * dy) + dcy,
            )
            j += 1
            rx, ry = reference[j, 0], reference[j, 1]
            zx, zy = rx + dx, ry + dy
            mag = zx * zx + zy * zy
            if mag > bailout2:
                return smooth(n + 1, mag, 2)
            if mag < 1e-8 * (rx * rx + ry * ry):
                return -2.0
            if kind == 0 and (mag < dx * dx + dy * dy or j + 1 == len(reference)):
                dx, dy, j = zx, zy, 0
        return -1.0

    cx, cy = (jx, jy) if kind in (1, 4) else (px, py)
    zx, zy = (px, py) if kind in (1, 4) else (0.0, 0.0)
    if kind == 0:
        q = (cx - 0.25) ** 2 + cy * cy
        if q * (q + cx - 0.25) <= 0.25 * cy * cy or (cx + 1) ** 2 + cy * cy <= 0.0625:
            return -1.0
    for n in range(limit):
        if kind == 4:
            zx, zy = zx * (zx * zx - 3 * zy * zy) + cx, zy * (3 * zx * zx - zy * zy) + cy
        elif kind == 2:
            # Preserve the original FractalVisualizer's abs-after-add variation.
            zx, zy = abs(zx * zx - zy * zy + cx), abs(2 * zx * zy + cy)
        else:
            zx, zy = zx * zx - zy * zy + cx, (2 if kind != 3 else -2) * zx * zy + cy
        mag = zx * zx + zy * zy
        if mag > bailout2:
            return smooth(n + 1, mag, 3 if kind == 4 else 2)
    return -1.0


@njit(parallel=True, cache=True)
def cpu_field(width, height, x, y, span, kind, limit, bailout2, jx, jy, reference, perturb):
    result = np.empty((height, width), dtype=np.float32)
    for row in prange(height):
        for col in range(width):
            px = ((col + 0.5) / width - 0.5) * span
            py = (height / 2 - row - 0.5) / width * span
            if not perturb:
                px += x
                py += y
            result[row, col] = pixel(px, py, kind, limit, bailout2, jx, jy, reference, perturb)
    return result


def context(view: View):
    ctx = mpmath.mp.clone()
    ctx.dps = view.digits
    return ctx


@lru_cache(maxsize=8)
def reference_orbit(
    x: str, y: str, span: str, kind: str, iterations: int, bailout: float, julia_x: str, julia_y: str
):
    view = View(
        x=x,
        y=y,
        span=span,
        fractal=kind,
        iterations=iterations,
        bailout=bailout,
        julia_x=julia_x,
        julia_y=julia_y,
    )
    return build_reference(view)


def build_reference(view: View):
    ctx = context(view)
    center = ctx.mpc(view.x, view.y)
    c = ctx.mpc(view.julia_x, view.julia_y) if view.fractal == "julia" else center
    z = center if view.fractal == "julia" else ctx.mpc(0)
    orbit = [(float(z.real), float(z.imag))]
    for _ in range(view.iterations):
        z = z * z + c
        orbit.append((float(z.real), float(z.imag)))
        if abs(z) > view.bailout * 2:
            break
    return np.array(orbit, dtype=np.float64)


def exact_pixel(view: View, col: int, row: int, width: int, height: int, extra_digits: int = 0) -> float:
    """Slow independent oracle and repair path; all orbit arithmetic uses mpmath."""
    ctx = context(view)
    ctx.dps += extra_digits
    span = ctx.mpf(view.span)
    p = ctx.mpc(
        ctx.mpf(view.x) + (ctx.mpf(col) + ctx.mpf("0.5") - ctx.mpf(width) / 2) * span / width,
        ctx.mpf(view.y) + (ctx.mpf(height) / 2 - row - ctx.mpf("0.5")) * span / width,
    )
    c = ctx.mpc(view.julia_x, view.julia_y) if view.fractal in ("julia", "cubic") else p
    z = p if view.fractal in ("julia", "cubic") else ctx.mpc(0)
    for n in range(view.iterations):
        if view.fractal == "burning-ship":
            w = z * z + c
            z = ctx.mpc(abs(w.real), abs(w.imag))
        elif view.fractal == "tricorn":
            z = z.conjugate() ** 2 + c
        else:
            z = z ** (3 if view.fractal == "cubic" else 2) + c
        mag = z.real * z.real + z.imag * z.imag
        if mag > view.bailout**2:
            return float(smooth(n + 1, float(mag), 3 if view.fractal == "cubic" else 2))
    return -1.0


class CudaBackend:
    def __init__(self):
        self.cp = None
        self.kernel = None
        self.name = None
        self.error = None
        try:
            # Keep the compiler cache inside the project, not a global user folder.
            os.environ.setdefault(
                "CUPY_CACHE_DIR", str(Path(__file__).resolve().parent.parent / ".cupy-cache")
            )
            import cupy as cp

            if cp.cuda.runtime.getDeviceCount() < 1:
                raise RuntimeError("No NVIDIA CUDA device found")
            self.cp = cp
            props = cp.cuda.runtime.getDeviceProperties(0)
            name = props["name"]
            self.name = name.decode() if isinstance(name, bytes) else name
            code = Path(__file__).with_name("kernel.cu").read_text()
            self.kernel = cp.RawKernel(code, "render", options=("--fmad=false",))
            self.kernel.compile()
        except Exception as exc:  # noqa: BLE001 - optional CUDA initialization must allow a CPU fallback
            self.cp = None
            self.error = f"{type(exc).__name__}: {exc}"

    def render(self, request: RenderRequest, reference, perturb):
        started = perf_counter()
        cp = self.cp
        v = request.view
        output = cp.empty(request.width * request.height, dtype=cp.float32)
        orbit = cp.asarray(reference)
        cp.cuda.get_current_stream().synchronize()
        uploaded = perf_counter()
        before, after = cp.cuda.Event(), cp.cuda.Event()
        before.record()
        self.kernel(
            ((output.size + 255) // 256,),
            (256,),
            (
                output,
                np.int32(request.width),
                np.int32(request.height),
                np.float64(float(v.x)),
                np.float64(float(v.y)),
                np.float64(float(v.span)),
                np.int32(FRACTALS[v.fractal]),
                np.int32(v.iterations),
                np.float64(v.bailout**2),
                np.float64(float(v.julia_x)),
                np.float64(float(v.julia_y)),
                orbit,
                np.int32(len(reference)),
                np.int32(perturb),
            ),
        )
        after.record()
        after.synchronize()
        download_started = perf_counter()
        result = cp.asnumpy(output).reshape(request.height, request.width)
        self.last_timings = {
            "upload_ms": (uploaded - started) * 1000,
            "kernel_ms": cp.cuda.get_elapsed_time(before, after),
            "download_ms": (perf_counter() - download_started) * 1000,
        }
        return result


@dataclass
class RenderResult:
    field: np.ndarray
    metadata: dict


class Engine:
    def __init__(self):
        self.cuda = CudaBackend()
        self.lock = Lock()
        from .accelerator import Accelerator

        self.accelerator = Accelerator(self.cuda.cp) if self.cuda.cp is not None else None

    def capabilities(self):
        return {
            "cuda": self.cuda.cp is not None,
            "device": self.cuda.name,
            "cuda_error": self.cuda.error,
            "max_digits": 10048,
            "min_span": "1e-10000",
            "deep_zoom": ["mandelbrot", "julia"],
            "arithmetic": ["auto", "fp32", "double-single", "fp64", "double-double"],
            "range_modes": ["auto", "standard", "scaled", "floatexp"],
            "accelerations": ["auto", "none", "series", "bla", "series-bla"],
        }

    def render(self, request: RenderRequest) -> RenderResult:
        if self.accelerator is not None and request.backend != "cpu" and request.renderer != "baseline":
            with self.lock:
                try:
                    return self.accelerator.render(request)
                except ValueError as exc:
                    raise RenderError(str(exc)) from exc
                except RenderError:
                    raise
                except Exception as exc:
                    raise RenderError(f"Optimized CUDA renderer failed: {exc}") from exc
        if float(request.view.span) < 1e-280 or (
            request.view.fractal not in ("mandelbrot", "julia") and float(request.view.span) < 1e-12
        ):
            raise RenderError(
                "This view requires the optimized CUDA renderer; CPU/baseline exponent range exceeded"
            )
        # One GPU stream / CPU render at a time, with bounded request concurrency in server.py.
        with self.lock:
            started = perf_counter()
            v = request.view
            perturb = v.fractal in ("mandelbrot", "julia") and float(v.span) < 1e-7
            reference = (
                reference_orbit(v.x, v.y, v.span, v.fractal, v.iterations, v.bailout, v.julia_x, v.julia_y)
                if perturb
                else np.zeros((1, 2))
            )
            reference_ms = (perf_counter() - started) * 1000
            backend = "cuda" if request.backend != "cpu" and self.cuda.cp is not None else "cpu"
            if request.backend == "cuda" and backend != "cuda":
                raise RenderError(f"CUDA unavailable: {self.cuda.error}")
            warning = None
            try:
                if backend == "cuda":
                    field = self.cuda.render(request, reference, perturb)
                else:
                    field = self._cpu(request, reference, perturb)
            except Exception as exc:
                if request.backend == "cuda" or backend == "cpu":
                    raise RenderError(str(exc)) from exc
                warning = f"CUDA failed; rendered on CPU: {exc}"
                backend = "cpu"
                field = self._cpu(request, reference, perturb)
            bad_count = int(np.count_nonzero(field == -2))
            repair_started = perf_counter()
            primary_timings = dict(self.cuda.last_timings) if backend == "cuda" else {}
            repair_budget = [0, 0]  # additional references, exact pixels
            if bad_count:
                self._repair(request, field, backend, 0, repair_budget)
            return RenderResult(
                field,
                {
                    "backend": backend,
                    "device": self.cuda.name if backend == "cuda" else "CPU · Numba",
                    "mode": "perturbation" if perturb else "direct FP64",
                    "digits": v.digits if perturb else 16,
                    "repaired": bad_count,
                    "extra_references": repair_budget[0],
                    "exact_repairs": repair_budget[1],
                    "elapsed_ms": round((perf_counter() - started) * 1000, 1),
                    "width": request.width,
                    "height": request.height,
                    "warning": warning,
                    "renderer": "baseline",
                    "arithmetic": "fp64",
                    "range_mode": "standard",
                    "acceleration": "none",
                    "fma": False,
                    "timings": {
                        "reference_ms": reference_ms,
                        **primary_timings,
                        "repair_ms": (perf_counter() - repair_started) * 1000,
                    },
                },
            )

    def _repair(self, request, field, backend, depth, budget):
        bad = np.argwhere(field == -2)
        if not len(bad):
            return
        if len(bad) <= 32 or depth >= 6 or min(field.shape) < 4:
            budget[1] += len(bad)
            if budget[1] > 4096:
                raise RenderError(
                    "This view exceeded the precision repair budget. "
                    "Move slightly or lower the render quality and try again."
                )
            for row, col in bad:
                field[row, col] = exact_pixel(request.view, int(col), int(row), request.width, request.height)
            return
        # Re-reference only unstable regions, recursively. Exact decimal tile
        # centers preserve the original pixel grid even at a width of 1e-280.
        ctx = context(request.view)
        span = ctx.mpf(request.view.span)
        for top, bottom in ((0, request.height // 2), (request.height // 2, request.height)):
            for left, right in ((0, request.width // 2), (request.width // 2, request.width)):
                area = field[top:bottom, left:right]
                mask = area == -2
                if not np.any(mask):
                    continue
                budget[0] += 1
                if budget[0] > 128:
                    raise RenderError(
                        "This view needs too many reference orbits. "
                        "Move slightly or lower the render quality and try again."
                    )
                width, height = right - left, bottom - top
                tile_view = request.view.model_copy(
                    update={
                        "x": ctx.nstr(
                            ctx.mpf(request.view.x)
                            + (ctx.mpf(left + right) / 2 - ctx.mpf(request.width) / 2) * span / request.width,
                            ctx.dps,
                        ),
                        "y": ctx.nstr(
                            ctx.mpf(request.view.y)
                            + (ctx.mpf(request.height) / 2 - ctx.mpf(top + bottom) / 2)
                            * span
                            / request.width,
                            ctx.dps,
                        ),
                        "span": ctx.nstr(span * width / request.width, ctx.dps),
                    }
                )
                tile = request.model_copy(update={"view": tile_view, "width": width, "height": height})
                reference = build_reference(tile_view)
                repaired = (
                    self.cuda.render(tile, reference, True)
                    if backend == "cuda"
                    else self._cpu(tile, reference, True)
                )
                # Ignore pixels already known to be good in the parent orbit.
                repaired[~mask] = area[~mask]
                self._repair(tile, repaired, backend, depth + 1, budget)
                area[mask] = repaired[mask]

    @staticmethod
    def _cpu(request, reference, perturb):
        v = request.view
        return cpu_field(
            request.width,
            request.height,
            float(v.x),
            float(v.y),
            float(v.span),
            FRACTALS[v.fractal],
            v.iterations,
            v.bailout**2,
            float(v.julia_x),
            float(v.julia_y),
            reference,
            perturb,
        )
