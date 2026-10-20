import mpmath
import numpy as np
import pytest

from fractal_explorer.engine import Engine, exact_pixel
from fractal_explorer.models import RenderRequest, View


@pytest.fixture(scope="module")
def engine():
    engine = Engine()
    if engine.accelerator is None:
        pytest.skip(engine.cuda.error)
    return engine


@pytest.mark.parametrize(
    "arithmetic,bits", [("fp32", 24), ("double-single", 45), ("fp64", 53), ("double-double", 100)]
)
@pytest.mark.parametrize("fma", [False, True])
def test_gpu_error_free_arithmetic(engine, arithmetic, bits, fma):
    cp = engine.cuda.cp
    ctx = mpmath.mp.clone()
    ctx.dps = 100
    rng = np.random.default_rng(17)
    values = rng.uniform(-2, 2, (100, 4))
    values[:, 1::2] *= 2.0 ** (-24 if arithmetic == "double-single" else -53)
    # Cancellation and low-component information must survive in paired modes.
    values[0] = [1, 2.0**-60, -1, 2.0**-61]
    output = cp.empty_like(cp.asarray(values))
    kernel = engine.accelerator.module(arithmetic, "standard", fma).get_function("arithmetic_probe")
    kernel((1,), (128,), (cp.asarray(values), output, np.int32(len(values))))
    actual = cp.asnumpy(output)
    for row, result in zip(values, actual, strict=True):
        if arithmetic == "double-single":
            # Input limbs are rounded to the selected representation first.
            a, b = (
                ctx.mpf(float(row[0])) + ctx.mpf(float(row[1])),
                ctx.mpf(float(row[2])) + ctx.mpf(float(row[3])),
            )
        elif arithmetic == "double-double":
            a, b = (
                ctx.mpf(float(row[0])) + ctx.mpf(float(row[1])),
                ctx.mpf(float(row[2])) + ctx.mpf(float(row[3])),
            )
        else:
            a = (
                ctx.mpf(float(np.float32(row[0] + row[1])))
                if arithmetic == "fp32"
                else ctx.mpf(float(row[0] + row[1]))
            )
            b = (
                ctx.mpf(float(np.float32(row[2] + row[3])))
                if arithmetic == "fp32"
                else ctx.mpf(float(row[2] + row[3]))
            )
        for offset, expected in ((0, a + b), (2, a * b)):
            observed = ctx.mpf(float(result[offset])) + ctx.mpf(float(result[offset + 1]))
            assert abs(observed - expected) <= ctx.power(2, -bits) * max(1, abs(expected))


@pytest.mark.parametrize("arithmetic", ["fp32", "double-single", "fp64", "double-double"])
@pytest.mark.parametrize("range_mode", ["standard", "scaled", "floatexp"])
def test_arithmetic_and_range_modes_against_oracle(engine, arithmetic, range_mode):
    span = "1e-20" if range_mode == "standard" else "1e-80"
    view = View(x="-2", y="0", span=span, iterations=800)
    result = engine.render(
        RenderRequest(
            view=view, width=16, height=16, arithmetic=arithmetic, range_mode=range_mode, acceleration="none"
        )
    )
    tolerance = 0.03 if arithmetic == "fp32" else 0.003
    for row, col in ((0, 0), (3, 12), (7, 7), (8, 8), (15, 15)):
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 16, 16), abs=tolerance)
    assert result.metadata["arithmetic"] == arithmetic
    assert np.ptp(result.field) > 0.1


@pytest.mark.parametrize("acceleration", ["series", "bla", "series-bla"])
@pytest.mark.parametrize("fractal", ["mandelbrot", "julia"])
def test_acceleration_skips_real_work(engine, acceleration, fractal):
    view = View(
        fractal=fractal,
        x="-2" if fractal == "mandelbrot" else "2",
        y="0",
        julia_x="-2",
        julia_y="0",
        span="1e-80",
        iterations=800,
    )
    result = engine.render(
        RenderRequest(view=view, width=32, height=24, acceleration=acceleration, range_mode="scaled")
    )
    assert result.metadata["mean_skipped_steps"] > 5
    for row, col in ((0, 0), (11, 15), (23, 31)):
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 32, 24), abs=0.003)


@pytest.mark.parametrize("range_mode", ["scaled", "floatexp"])
def test_zoom_beyond_ieee_exponent_range(engine, range_mode):
    view = View(x="-2", y="0", span="1e-1000", iterations=3000)
    result = engine.render(
        RenderRequest(view=view, width=16, height=16, range_mode=range_mode, acceleration="series-bla")
    )
    assert float(view.span) == 0
    assert np.ptp(result.field) > 0.1
    assert result.metadata["digits"] >= 1030
    for row, col in ((0, 0), (7, 7), (15, 15)):
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 16, 16), abs=0.003)


def test_reference_and_device_caches(engine):
    request = RenderRequest(view=View(x="0", y="1", span="1e-80", iterations=400), width=32, height=24)
    engine.render(request)
    repeated = engine.render(request)
    assert repeated.metadata["reference_cache_hit"]
    assert repeated.metadata["device_cache_hit"]
    assert all(value >= 0 for value in repeated.metadata["timings"].values())


def test_direct_double_double_preserves_nonquadratic_coordinates(engine):
    view = View(fractal="tricorn", x="-2", y="0", span="1e-20", iterations=300)
    result = engine.render(RenderRequest(view=view, width=16, height=16, arithmetic="double-double"))
    for row, col in ((0, 0), (7, 7), (15, 15)):
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 16, 16), abs=0.01)


def test_cpu_does_not_silently_underflow():
    from fractal_explorer.engine import RenderError

    engine = Engine()
    with pytest.raises(RenderError, match="requires the optimized CUDA"):
        engine.render(RenderRequest(view=View(span="1e-1000"), width=16, height=16, backend="cpu"))


@pytest.mark.parametrize("range_mode", ["scaled", "floatexp"])
@pytest.mark.parametrize("arithmetic", ["fp32", "double-single", "fp64", "double-double"])
def test_contracting_orbit_does_not_wrap_integer_exponent(engine, range_mode, arithmetic):
    view = View(fractal="julia", x="1e-1000", y="0", julia_x="0", julia_y="0", span="1e-1000", iterations=100)
    result = engine.render(
        RenderRequest(
            view=view, width=16, height=16, range_mode=range_mode, arithmetic=arithmetic, acceleration="none"
        )
    )
    assert np.all(result.field == -1)


def test_masked_precision_promotion_only_iterates_flagged_pixels(engine):
    request = RenderRequest(
        view=View(x="0", y="1", span="1e-80", iterations=400), width=32, height=24, acceleration="none"
    )
    initial, _ = engine.accelerator.evaluate(request)
    marked = initial.copy()
    marked[11, 15] = -2
    repaired, metadata = engine.accelerator.evaluate(
        request.model_copy(update={"arithmetic": "double-double"}), repair_mask=marked
    )
    np.testing.assert_array_equal(repaired[marked != -2], initial[marked != -2])
    assert repaired[11, 15] == pytest.approx(exact_pixel(request.view, 15, 11, 32, 24), abs=0.003)
    assert metadata["mean_native_steps"] < 1


@pytest.mark.parametrize("range_mode", ["standard", "scaled", "floatexp"])
def test_cancellation_guard_uses_squared_magnitude_consistently(engine, range_mode):
    view = View(
        fractal="julia", x="1e-10", y="0", span="2.122875e-10", julia_x="-1", julia_y="0", iterations=50
    )
    field, _ = engine.accelerator.evaluate(
        RenderRequest(
            view=view, width=17, height=17, arithmetic="fp64", range_mode=range_mode, acceleration="none"
        )
    )
    assert field[8, 0] == -2


def test_bla_disabled_node_cannot_jump_over_center_pixel_escape(engine):
    ctx = mpmath.mp.clone()
    ctx.dps = 100
    # The reference crosses bailout precisely at iteration 64, a dyadic boundary.
    center = ctx.nstr(2 * ctx.cosh(ctx.acosh(40) / ctx.power(2, 64)), 100)
    view = View(fractal="julia", x=center, y="0", span="1e-50", julia_x="-2", julia_y="0", iterations=64)
    result = engine.render(RenderRequest(view=view, width=17, height=17, acceleration="bla"))
    assert result.field[8, 8] >= 0
    assert result.field[8, 8] == pytest.approx(exact_pixel(view, 8, 8, 17, 17, extra_digits=80), abs=0.003)


@pytest.mark.parametrize("arithmetic", ["fp32", "double-single", "fp64", "double-double"])
@pytest.mark.parametrize("fractal", ["mandelbrot", "julia", "burning-ship", "tricorn", "cubic"])
def test_direct_custom_arithmetic_formulas(engine, arithmetic, fractal):
    view = View(fractal=fractal, iterations=100)
    result = engine.render(
        RenderRequest(
            view=view, width=16, height=16, arithmetic=arithmetic, acceleration="none", perturbation="off"
        )
    )
    for row, col in ((0, 0), (0, 15), (15, 0), (15, 15), (3, 8)):
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 16, 16), abs=0.03)


def test_auto_range_preserves_squared_offset_at_julia_critical_point(engine):
    # z0=0,c=-2 maps through the critical point: the first meaningful difference
    # is delta^2=O(1e-360), despite the viewport width being representable in FP64.
    view = View(fractal="julia", x="0", y="0", span="1e-180", julia_x="-2", julia_y="0", iterations=1000)
    result = engine.render(RenderRequest(view=view, width=16, height=16, acceleration="none"))
    assert result.metadata["range_mode"] == "scaled"
    assert np.all(result.field >= 0)
    assert np.ptp(result.field) > 0.1
    for row, col in ((0, 0), (7, 7), (15, 15)):
        expected = exact_pixel(view, col, row, 16, 16, extra_digits=view.digits + 80)
        assert result.field[row, col] == pytest.approx(expected, abs=0.003)
