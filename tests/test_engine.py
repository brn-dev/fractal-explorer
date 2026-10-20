import numpy as np
import pytest

from fractal_explorer.engine import Engine, exact_pixel
from fractal_explorer.models import NavigateRequest, RenderRequest, View, navigate


@pytest.fixture(scope="module")
def engine():
    return Engine()


@pytest.mark.parametrize("kind", ["mandelbrot", "julia", "burning-ship", "tricorn", "cubic"])
def test_formulas_match_independent_mpmath_oracle(engine, kind):
    view = View(fractal=kind, iterations=100)
    request = RenderRequest(view=view, width=16, height=16, backend="cpu")
    field = engine.render(request).field
    for row, col in [(0, 0), (3, 8), (5, 4), (8, 8), (13, 7), (15, 15)]:
        assert field[row, col] == pytest.approx(exact_pixel(view, col, row, 16, 16), abs=2e-4)


@pytest.mark.parametrize("exponent", [20, 80, 200, 280])
def test_deep_zoom_beyond_float64_coordinates(engine, exponent):
    view = View(x="-2", y="0", span=f"1e-{exponent}", iterations=1200)
    # Every assembled FP64 x coordinate would be identical here.
    assert float(view.x) + float(view.span) == float(view.x)
    result = engine.render(RenderRequest(view=view, width=16, height=16, backend="cpu"))
    assert result.metadata["mode"] == "perturbation"
    assert result.metadata["digits"] >= exponent + 30
    assert np.ptp(result.field) > 0.1
    for row, col in [(0, 0), (0, 15), (7, 7), (8, 8), (15, 15)]:
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 16, 16), abs=2e-3)


def test_julia_deep_perturbation(engine):
    view = View(fractal="julia", x="2", y="0", span="1e-80", julia_x="-2", julia_y="0", iterations=500)
    result = engine.render(RenderRequest(view=view, width=16, height=16, backend="cpu"))
    assert np.ptp(result.field) > 0.1
    for row, col in [(0, 0), (8, 8), (15, 15)]:
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 16, 16), abs=2e-3)


@pytest.mark.parametrize("backend", ["cpu", "cuda"])
def test_deep_complex_boundary_and_adaptive_references(engine, backend):
    if backend == "cuda" and engine.cuda.cp is None:
        pytest.skip(engine.cuda.error)
    view = View(x="0", y="1", span="1e-80", iterations=1000)
    result = engine.render(RenderRequest(view=view, width=16, height=16, backend=backend))
    for row, col in [(0, 0), (7, 7), (15, 15)]:
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 16, 16), abs=2e-3)
    # An escaping Julia reference cannot represent every neighboring pixel.
    # Re-reference its unstable regions instead of painting them as interior.
    view = View(
        fractal="julia", x="2.000000001", y="0", span="2e-8", julia_x="-2", julia_y="0", iterations=100
    )
    result = engine.render(RenderRequest(view=view, width=128, height=96, backend=backend))
    assert result.metadata["extra_references"] > 0
    assert np.all(result.field != -2)
    for row, col in [(0, 0), (47, 63), (48, 64), (95, 127)]:
        assert result.field[row, col] == pytest.approx(exact_pixel(view, col, row, 128, 96), abs=2e-3)


def test_navigation_preserves_tiny_decimal_movements():
    view = View(x="-0.7436438870371510000000000000000000000001", span="1e-80")
    moved = navigate(NavigateRequest(view=view, dx=0.1))
    assert moved.x != view.x
    back = navigate(NavigateRequest(view=moved, dx=-0.1))
    from decimal import Decimal

    assert Decimal(back.x) == Decimal(view.x)
    assert Decimal(moved.span) == Decimal(view.span)


def test_navigation_preserves_supplied_center_before_zooming_deep():
    from decimal import Decimal

    view = View(x="-0.7" + "0" * 1000 + "1", span="3.6")
    moved = navigate(NavigateRequest(view=view, dx=0.1))
    back = navigate(NavigateRequest(view=moved, dx=-0.1))
    assert Decimal(back.x) == Decimal(view.x)


def test_cursor_anchor_and_limits():
    moved = navigate(NavigateRequest(view=View(), dx=0.25, dy=0.1, factor=2))
    assert moved.x == "-0.050"
    assert moved.y == "0.18"
    assert moved.span == "1.8"
    assert navigate(NavigateRequest(view=View(span="1e-10000"), factor=1000)).span == "1E-10000"
    with pytest.raises(ValueError):
        View(fractal="tricorn", span="1e-27")
    with pytest.raises(ValueError):
        View(x="NaN")
    with pytest.raises(ValueError):
        View(span="1e-10001")


@pytest.mark.parametrize(
    "kind,span,x",
    [
        ("mandelbrot", "3.6", "-0.5"),
        ("julia", "3.6", "0"),
        ("burning-ship", "3.6", "-0.5"),
        ("tricorn", "3.6", "-0.5"),
        ("cubic", "3.6", "0"),
        ("mandelbrot", "1e-80", "-2"),
        ("mandelbrot", "1e-280", "-2"),
        ("tricorn", "1e-10", "-0.7"),
    ],
)
def test_cuda_matches_cpu(engine, kind, span, x):
    if engine.cuda.cp is None:
        pytest.skip(engine.cuda.error)
    view = View(fractal=kind, span=span, x=x, iterations=1200)
    cpu = engine.render(RenderRequest(view=view, width=32, height=24, backend="cpu"))
    gpu = engine.render(RenderRequest(view=view, width=32, height=24, backend="cuda", renderer="baseline"))
    assert gpu.metadata["backend"] == "cuda"
    np.testing.assert_allclose(gpu.field, cpu.field, atol=1e-3, rtol=1e-5)
