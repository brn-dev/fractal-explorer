"""Reference packing and bounded polynomial / bilinear approximations.

Every accelerated jump has a disk bound on the omitted nonlinear terms and an
escape-radius bound. These are conservative floating-point error estimates,
not interval arithmetic proofs. Validation also compares independent orbits.
"""

import math
from dataclasses import dataclass
from functools import lru_cache

import mpmath
import numpy as np


def split(ctx, value):
    if not value:
        return 0.0, 0.0, 0
    mantissa, exponent = ctx.frexp(value)
    if exponent < -100000000:
        return 0.0, 0.0, 0
    high = float(mantissa)
    return high, float(mantissa - ctx.mpf(high)), int(exponent)


def pack(ctx, values):
    mantissas = np.zeros((len(values), 4), np.float64)
    exponents = np.zeros((len(values), 2), np.int32)
    for k, z in enumerate(values):
        for axis, component in enumerate((z.real, z.imag)):
            hi, lo, exponent = split(ctx, component)
            mantissas[k, 2 * axis : 2 * axis + 2] = hi, lo
            exponents[k, axis] = exponent
    return mantissas, exponents


def unpack(ctx, mantissas, exponents, index):
    return ctx.mpc(
        *[
            (ctx.mpf(float(mantissas[index, 2 * a])) + ctx.mpf(float(mantissas[index, 2 * a + 1])))
            * ctx.power(2, int(exponents[index, a]))
            for a in (0, 1)
        ]
    )


def log2(ctx, value):
    return float(ctx.log(value, 2)) if value > 0 else -math.inf


@dataclass(eq=False)
class Orbit:
    mantissas: np.ndarray
    exponents: np.ndarray
    native: np.ndarray
    digits: int
    key: tuple


def orbit_key(view):
    # A precision bucket reuses an orbit across nearby zoom levels at one center.
    digits = ((view.digits + 63) // 64) * 64
    return (view.x, view.y, view.fractal, view.julia_x, view.julia_y, view.iterations, view.bailout, digits)


@lru_cache(maxsize=8)
def reference(key):
    x, y, kind, jx, jy, iterations, bailout, digits = key
    ctx = mpmath.mp.clone()
    ctx.dps = digits
    z = ctx.mpc(x, y) if kind == "julia" else ctx.mpc(0)
    c = ctx.mpc(jx, jy) if kind == "julia" else ctx.mpc(x, y)
    # Pack as we go; retaining a whole 10,000-digit orbit wastes substantial memory.
    mantissas = np.empty((iterations + 1, 4), np.float64)
    exponents = np.empty((iterations + 1, 2), np.int32)
    for k in range(iterations + 1):
        for axis, component in enumerate((z.real, z.imag)):
            hi, lo, exponent = split(ctx, component)
            mantissas[k, 2 * axis : 2 * axis + 2] = hi, lo
            exponents[k, axis] = exponent
        if abs(z) > bailout * 2 or k == iterations:
            break
        z = z * z + c
    mantissas, exponents = mantissas[: k + 1].copy(), exponents[: k + 1].copy()
    native = np.empty_like(mantissas)
    for axis in (0, 1):
        for component in (0, 1):
            native[:, 2 * axis + component] = np.ldexp(mantissas[:, 2 * axis + component], exponents[:, axis])
    return Orbit(mantissas, exponents, native, digits, key)


def constants(view):
    ctx = mpmath.mp.clone()
    ctx.dps = view.digits
    coordinates = []
    for text in (view.x, view.y, view.julia_x, view.julia_y):
        number = ctx.mpf(text)
        hi = float(number)
        coordinates.extend((hi, float(number - ctx.mpf(hi))))
    return np.array(coordinates, np.float64), split(ctx, ctx.mpf(view.span))


@dataclass(eq=False)
class Approximation:
    series_m: np.ndarray
    series_e: np.ndarray
    series_n: int
    series_order: int
    map_m: np.ndarray
    map_e: np.ndarray
    map_logs: np.ndarray
    offsets: np.ndarray
    log_dc_bound: float


def empty_approximation():
    return Approximation(
        np.zeros((1, 4)),
        np.zeros((1, 2), np.int32),
        0,
        0,
        np.zeros((1, 8)),
        np.zeros((1, 4), np.int32),
        np.full((1, 5), -math.inf),
        np.zeros(1, np.int32),
        -math.inf,
    )


@lru_cache(maxsize=8)
def prepare(key, span, width, height, acceleration, tolerance):
    orbit = reference(key)
    ctx = mpmath.mp.clone()
    ctx.dps = 64  # coefficient precision, independent of exponent magnitude
    s = ctx.mpf(span)
    # The disk encloses every pixel center; the +1 term covers rounding margins.
    radius_u = ctx.sqrt(ctx.mpf("0.5") ** 2 + (ctx.mpf(height) / width / 2) ** 2)
    dc = s * radius_u if key[2] == "mandelbrot" else ctx.mpf(0)
    result = empty_approximation()
    result.log_dc_bound = log2(ctx, dc)
    if "series" in acceleration:
        _series(ctx, orbit, s, radius_u, width, tolerance, result)
    if "bla" in acceleration:
        _bla(ctx, orbit, dc, key[6], result)
    return result


def _series(ctx, orbit, span, radius, width, tolerance, result):
    order = 8
    coefficients = [ctx.mpc(0) for _ in range(order + 1)]
    julia = orbit.key[2] == "julia"
    if julia:
        coefficients[1] = span
    error = ctx.mpf(0)
    best = None
    # A full disk bound protects all pixels, not just a collection of probes.
    for n in range(min(len(orbit.mantissas) - 1, orbit.key[5] - 1)):
        z = unpack(ctx, orbit.mantissas, orbit.exponents, n)
        bound = sum(abs(coefficients[k]) * radius**k for k in range(1, order + 1))
        next_coefficients = [ctx.mpc(0)] * (order + 1)
        discarded = ctx.mpf(0)
        for k in range(1, 2 * order + 1):
            convolution = sum(
                (
                    coefficients[j] * coefficients[k - j]
                    for j in range(max(1, k - order), min(order, k - 1) + 1)
                ),
                ctx.mpc(0),
            )
            if k <= order:
                next_coefficients[k] = 2 * z * coefficients[k] + convolution
            else:
                # Sum absolute product magnitudes; cancellations cannot hide the tail.
                discarded += (
                    sum(
                        abs(coefficients[j]) * abs(coefficients[k - j])
                        for j in range(max(1, k - order), min(order, k - 1) + 1)
                    )
                    * radius**k
                )
        if not julia:
            next_coefficients[1] += span
        error = (2 * abs(z) + 2 * bound + error) * error + discarded
        coefficients = next_coefficients
        new_bound = sum(abs(coefficients[k]) * radius**k for k in range(1, order + 1))
        next_z = unpack(ctx, orbit.mantissas, orbit.exponents, n + 1)
        if abs(next_z) + new_bound + error >= orbit.key[6]:
            break
        # A conservative relative disk error, smaller than one raster pixel.
        if error > ctx.mpf(tolerance) * max(new_bound, span) / width:
            break
        if n + 1 >= 8:
            best = (n + 1, coefficients.copy())
    if best:
        result.series_n = best[0]
        result.series_order = order
        result.series_m, result.series_e = pack(ctx, best[1])


def _bla(ctx, orbit, dc, bailout, result):
    # Aligned dyadic intervals use fewer than 2*N nodes instead of N*log2(N).
    # Each node stores A, B, a valid input radius R and a nonlinear remainder K:
    # |F(d,c) - A*d - B*c| <= K*(|d|+dc_bound)^2 for |d| <= R.
    levels, offsets = [], []
    leaves = []
    is_julia = orbit.key[2] == "julia"
    for j in range(len(orbit.mantissas) - 1):
        a = 2 * unpack(ctx, orbit.mantissas, orbit.exponents, j)
        b = ctx.mpc(0 if is_julia else 1)
        gap = ctx.mpf(bailout) - abs(unpack(ctx, orbit.mantissas, orbit.exponents, j + 1)) - dc
        radius = max(ctx.mpf(0), min(ctx.mpf("0.25"), gap / (abs(a) + ctx.mpf("0.25"))))
        leaves.append((a, b, radius, ctx.mpf(1)))
    levels.append(leaves)
    while len(levels[-1]) >= 2:
        previous, level = levels[-1], []
        for i in range(0, len(previous) - 1, 2):
            a1, b1, r1, k1 = previous[i]
            a2, b2, r2, k2 = previous[i + 1]
            a, b = a2 * a1, a2 * b1 + b2
            constant = k1 * dc * dc + abs(b1) * dc - r2
            linear = abs(a1) + 2 * k1 * dc
            if constant >= 0 or r1 <= 0 or r2 <= 0:
                radius = ctx.mpf(0)
            else:
                root = -2 * constant / (linear + ctx.sqrt(linear * linear - 4 * k1 * constant))
                radius = min(r1, root) * ctx.mpf("0.99")
            majorant = max(abs(a1), abs(b1) + 1) + k1 * (radius + dc)
            remainder = abs(a2) * k1 + k2 * majorant * majorant
            level.append((a, b, radius, remainder))
        levels.append(level)
    maps, logs, offset = [], [], 0
    for level in levels:
        offsets.append(offset)
        for a, b, radius, remainder in level:
            maps.extend((a, b))
            logs.append([log2(ctx, radius), log2(ctx, remainder), log2(ctx, abs(a)), log2(ctx, abs(b)), 0])
        offset += len(level)
    if maps:
        mantissas, exponents = pack(ctx, maps)
        result.map_m = mantissas.reshape(-1, 8)
        result.map_e = exponents.reshape(-1, 4)
        result.map_logs = np.array(logs, np.float64)
        result.offsets = np.array(offsets, np.int32)
