"""Selectable CUDA arithmetic, extended range, acceleration and stage timings."""

import math
from collections import OrderedDict
from decimal import Decimal
from pathlib import Path
from time import perf_counter

import numpy as np

from .models import FRACTALS
from .preparation import constants, empty_approximation, orbit_key, prepare, reference

ARITHMETIC = {"fp32": 0, "double-single": 1, "fp64": 2, "double-double": 3}
RANGES = {"standard": 0, "scaled": 1, "floatexp": 2}


def storage(array, arithmetic):
    """Convert coefficient pairs once, rather than spending FP64 operations in every FP32 step."""
    if arithmetic not in ("fp32", "double-single"):
        return array
    result = np.empty(array.shape, np.float32)
    result[:, 0::2] = array[:, 0::2]
    result[:, 1::2] = (array[:, 0::2] - result[:, 0::2].astype(np.float64)) + array[:, 1::2]
    return result


class Accelerator:
    def __init__(self, cp):
        self.cp = cp
        self.modules = {}
        self.packets = OrderedDict()
        self.output = None
        self.counts = None
        self.empty_mask = cp.zeros(1, cp.float32)

    def module(self, arithmetic, range_mode, fma):
        key = arithmetic, range_mode, fma
        if key not in self.modules:
            folder = Path(__file__).parent
            code = f"#define ARITH {ARITHMETIC[arithmetic]}\n#define RANGE {RANGES[range_mode]}\n"
            code += (
                folder.joinpath("arithmetic.cuh").read_text() + folder.joinpath("optimized.cu").read_text()
            )
            module = self.cp.RawModule(
                code=code, options=("--std=c++17", f"--fmad={'true' if fma else 'false'}")
            )
            module.compile()
            self.modules[key] = module
        return self.modules[key]

    @staticmethod
    def options(request):
        v = request.view
        quadratic = v.fractal in ("mandelbrot", "julia")
        arithmetic = request.arithmetic
        if arithmetic == "auto":
            arithmetic = "double-double" if not quadratic and Decimal(v.span) < Decimal("1e-10") else "fp64"
        perturb = quadratic and (
            request.perturbation == "on"
            or (request.perturbation == "auto" and Decimal(v.span) < Decimal("1e-7"))
        )
        if not perturb:
            precision_limit = {
                "fp32": "1e-3",
                "double-single": "1e-10",
                "fp64": "1e-12",
                "double-double": "1e-26",
            }[arithmetic]
            if Decimal(v.span) < Decimal(precision_limit):
                raise ValueError(
                    f"Direct {arithmetic} cannot resolve this view; enable quadratic perturbation"
                )
        range_mode = request.range_mode
        if range_mode == "auto":
            # Leave room for a critical Julia step to square the pixel offset:
            # a representable delta can have an unrepresentable delta-squared.
            threshold = "1e-15" if arithmetic in ("fp32", "double-single") else "1e-140"
            range_mode = "scaled" if perturb and Decimal(v.span) < Decimal(threshold) else "standard"
        if not perturb:
            range_mode = "standard"
        if range_mode == "standard" and perturb:
            minimum = "1e-30" if arithmetic in ("fp32", "double-single") else "1e-280"
            if Decimal(v.span) < Decimal(minimum):
                raise ValueError(
                    f"Standard {arithmetic} exponent range is insufficient; choose scaled or floatexp"
                )
        acceleration = request.acceleration
        if acceleration == "auto":
            # BLA amortizes extended-exponent work on very deep views. Ordinary
            # views avoid preparation latency; series remains an explicit option.
            acceleration = "bla" if perturb and Decimal(v.span) < Decimal("1e-280") else "none"
        if not perturb:
            acceleration = "none"
        return arithmetic, range_mode, acceleration, perturb

    def evaluate(self, request, options=None, repair_mask=None):
        cp = self.cp
        v = request.view
        arithmetic, range_mode, acceleration, perturb = options or self.options(request)
        timing = {}
        start = perf_counter()
        cache_before = reference.cache_info().hits
        orbit = reference(orbit_key(v)) if perturb else None
        timing["reference_ms"] = (perf_counter() - start) * 1000
        reference_hit = bool(orbit and reference.cache_info().hits > cache_before)
        start = perf_counter()
        approximation = (
            prepare(
                orbit.key,
                v.span,
                request.width,
                request.height,
                acceleration,
                request.approximation_tolerance,
            )
            if perturb and acceleration != "none"
            else empty_approximation()
        )
        timing["preparation_ms"] = (perf_counter() - start) * 1000
        start = perf_counter()
        kernel = self.module(arithmetic, range_mode, request.fma).get_function("render_optimized")
        timing["compile_ms"] = (perf_counter() - start) * 1000
        start = perf_counter()
        packet_key = (
            arithmetic in ("fp32", "double-single"),
            orbit.key if orbit else None,
            (v.span, request.width, request.height, acceleration, request.approximation_tolerance)
            if acceleration != "none"
            else None,
        )
        packet_hit = packet_key in self.packets
        if packet_hit:
            packet = self.packets.pop(packet_key)
        else:
            native = orbit.native if orbit else np.zeros((1, 4))
            mantissas = orbit.mantissas if orbit else np.zeros((1, 4))
            exponents = orbit.exponents if orbit else np.zeros((1, 2), np.int32)
            packet = tuple(
                cp.asarray(a)
                for a in (
                    storage(native, arithmetic),
                    storage(mantissas, arithmetic),
                    exponents,
                    storage(approximation.series_m, arithmetic),
                    approximation.series_e,
                    storage(approximation.map_m, arithmetic),
                    approximation.map_e,
                    approximation.map_logs,
                    approximation.offsets,
                )
            )
        self.packets[packet_key] = packet
        while len(self.packets) > 8:
            self.packets.popitem(last=False)
        centers, (span_hi, span_lo, span_e) = constants(v)
        gpu_centers = cp.asarray(centers)
        gpu_mask = cp.asarray(repair_mask) if repair_mask is not None else self.empty_mask
        size = request.width * request.height
        if self.output is None or self.output.size < size:
            self.output = cp.empty(size, cp.float32)
            self.counts = cp.empty(2 * size, cp.int32)
        cp.cuda.get_current_stream().synchronize()
        timing["upload_ms"] = (perf_counter() - start) * 1000
        before, after = cp.cuda.Event(), cp.cuda.Event()
        before.record()
        kernel(
            ((size + 255) // 256,),
            (256,),
            (
                self.output,
                self.counts,
                gpu_mask,
                np.int32(repair_mask is not None),
                np.int32(request.width),
                np.int32(request.height),
                np.int32(FRACTALS[v.fractal]),
                np.int32(v.iterations),
                np.float64(v.bailout),
                gpu_centers,
                np.float64(span_hi),
                np.float64(span_lo),
                np.int32(span_e),
                np.int32(perturb),
                packet[0],
                packet[1],
                packet[2],
                np.int32(len(orbit.native) if orbit else 1),
                packet[3],
                packet[4],
                np.int32(approximation.series_order),
                np.int32(approximation.series_n),
                packet[5],
                packet[6],
                packet[7],
                packet[8],
                np.int32(len(approximation.offsets)),
                np.float64(approximation.log_dc_bound),
                np.float64(math.log2(request.approximation_tolerance)),
            ),
        )
        after.record()
        after.synchronize()
        timing["kernel_ms"] = cp.cuda.get_elapsed_time(before, after)
        start = perf_counter()
        field = cp.asnumpy(self.output[:size]).reshape(request.height, request.width)
        steps = int(cp.sum(self.counts[:size], dtype=cp.int64).get())
        skipped = int(cp.sum(self.counts[size : 2 * size], dtype=cp.int64).get())
        timing["download_ms"] = (perf_counter() - start) * 1000
        return field, {
            "arithmetic": arithmetic,
            "range_mode": range_mode,
            "acceleration": acceleration,
            "digits": orbit.digits
            if orbit
            else {"fp32": 7, "double-single": 14, "fp64": 16, "double-double": 32}[arithmetic],
            "mode": "perturbation" if perturb else "direct " + arithmetic,
            "reference_cache_hit": reference_hit,
            "device_cache_hit": packet_hit,
            "series_prefix": approximation.series_n,
            "mean_native_steps": steps / size,
            "mean_skipped_steps": skipped / size,
            "timings": timing,
        }

    def render(self, request):
        from .engine import RenderError, RenderResult

        started = perf_counter()
        options = self.options(request)
        field, metadata = self.evaluate(request, options)
        bad = int(np.count_nonzero(field == -2))
        repair_start = perf_counter()
        budget = {"references": 0, "exact": 0, "promoted_pixels": 0}
        if bad:
            self.repair(request, field, budget, 0)
        metadata["timings"]["repair_ms"] = (perf_counter() - repair_start) * 1000
        if not np.all(np.isfinite(field)) or np.any(field == -2):
            raise RenderError("Numerical arithmetic produced an invalid field")
        metadata.update(
            {
                "backend": "cuda",
                "device": self.cp.cuda.Device(0).id,
                "width": request.width,
                "height": request.height,
                "repaired": bad,
                "extra_references": budget["references"],
                "exact_repairs": budget["exact"],
                "promoted_pixels": budget["promoted_pixels"],
                "elapsed_ms": round((perf_counter() - started) * 1000, 3),
                "warning": None,
                "fma": request.fma,
                "renderer": "optimized",
                "experimental": options[0] in ("fp32", "double-single"),
            }
        )
        name = self.cp.cuda.runtime.getDeviceProperties(0)["name"]
        metadata["device"] = name.decode() if isinstance(name, bytes) else name
        return RenderResult(field, metadata)

    def repair(self, request, field, budget, depth):
        from .engine import RenderError, context, exact_pixel

        mask = field == -2
        count = int(np.count_nonzero(mask))
        if not count:
            return
        arithmetic = self.options(request)[0]
        if request.adaptive and arithmetic != "double-double":
            promoted = "fp64" if arithmetic in ("fp32", "double-single") else "double-double"
            promoted_request = request.model_copy(update={"arithmetic": promoted, "acceleration": "none"})
            retry, _ = self.evaluate(promoted_request, repair_mask=field)
            budget["promoted_pixels"] += count
            field[mask] = retry[mask]
            return self.repair(promoted_request, field, budget, depth)
        if count <= 32 or depth >= 6 or min(field.shape) < 4:
            budget["exact"] += count
            if budget["exact"] > 4096:
                raise RenderError("Precision repair budget exceeded; lower quality or move slightly")
            for row, col in np.argwhere(mask):
                field[row, col] = exact_pixel(request.view, int(col), int(row), request.width, request.height)
            return
        ctx = context(request.view)
        span = ctx.mpf(request.view.span)
        for top, bottom in ((0, request.height // 2), (request.height // 2, request.height)):
            for left, right in ((0, request.width // 2), (request.width // 2, request.width)):
                area = field[top:bottom, left:right]
                bad = area == -2
                if not np.any(bad):
                    continue
                budget["references"] += 1
                if budget["references"] > 128:
                    raise RenderError("Reference repair budget exceeded; lower quality or move slightly")
                w, h = right - left, bottom - top
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
                        "span": ctx.nstr(span * w / request.width, ctx.dps),
                    }
                )
                tile = request.model_copy(
                    update={"view": tile_view, "width": w, "height": h, "acceleration": "none"}
                )
                repaired, _ = self.evaluate(tile)
                repaired[~bad] = area[~bad]
                self.repair(tile, repaired, budget, depth + 1)
                area[bad] = repaired[bad]
