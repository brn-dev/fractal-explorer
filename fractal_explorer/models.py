from decimal import Decimal, InvalidOperation, localcontext
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

FRACTALS = {"mandelbrot": 0, "julia": 1, "burning-ship": 2, "tricorn": 3, "cubic": 4}
MIN_SPAN = "1e-10000"
MIN_DIRECT_SPAN = "1e-26"


def decimal_string(value: str) -> str:
    if len(value) > 12064:
        raise ValueError("Coordinate is too long")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Enter a decimal number") from exc
    if not number.is_finite() or number.copy_abs() > Decimal("1e6"):
        raise ValueError("Coordinate must be finite and within ±1,000,000")
    return value


class View(BaseModel):
    x: str = "-0.5"
    y: str = "0"
    span: str = "3.6"
    fractal: Literal["mandelbrot", "julia", "burning-ship", "tricorn", "cubic"] = "mandelbrot"
    iterations: int = Field(default=800, ge=50, le=50_000)
    bailout: float = Field(default=64, ge=4, le=4096, allow_inf_nan=False)
    julia_x: str = "-0.7269"
    julia_y: str = "0.1889"

    @field_validator("x", "y", "julia_x", "julia_y")
    @classmethod
    def coordinates(cls, value: str) -> str:
        return decimal_string(value)

    @field_validator("span")
    @classmethod
    def valid_span(cls, value: str) -> str:
        decimal_string(value)
        if not Decimal(MIN_SPAN) <= Decimal(value) <= 16:
            raise ValueError(f"View width must be between {MIN_SPAN} and 16")
        return value

    @model_validator(mode="after")
    def precision_limit(self):
        if self.fractal not in ("mandelbrot", "julia") and Decimal(self.span) < Decimal(MIN_DIRECT_SPAN):
            raise ValueError(f"This formula supports direct double-double zoom down to {MIN_DIRECT_SPAN}")
        return self

    @property
    def digits(self) -> int:
        return max(40, -Decimal(self.span).adjusted() + 30)


class RenderingOptions(BaseModel):
    renderer: Literal["auto", "baseline", "optimized"] = "auto"
    arithmetic: Literal["auto", "fp32", "double-single", "fp64", "double-double"] = "auto"
    range_mode: Literal["auto", "standard", "scaled", "floatexp"] = "auto"
    acceleration: Literal["auto", "none", "series", "bla", "series-bla"] = "auto"
    perturbation: Literal["auto", "on", "off"] = "auto"
    fma: bool = True
    adaptive: bool = True
    approximation_tolerance: float = Field(default=1e-10, ge=1e-25, le=1e-3, allow_inf_nan=False)


class RenderRequest(RenderingOptions):
    view: View = Field(default_factory=View)
    width: int = Field(default=1200, ge=16, le=4096)
    height: int = Field(default=800, ge=16, le=4096)
    backend: Literal["auto", "cuda", "cpu"] = "auto"

    @model_validator(mode="after")
    def pixel_budget(self):
        if self.width * self.height > 16_000_000:
            raise ValueError("Maximum image size is 16 megapixels")
        return self


class NavigateRequest(BaseModel):
    view: View
    # Fractions of horizontal viewport width. Positive y points upward.
    dx: float = Field(default=0, ge=-10, le=10, allow_inf_nan=False)
    dy: float = Field(default=0, ge=-10, le=10, allow_inf_nan=False)
    factor: float = Field(default=1, ge=0.001, le=1000, allow_inf_nan=False)


class AnimationRequest(BaseModel):
    view: View
    width: int = Field(default=720, ge=16, le=960)
    height: int = Field(default=480, ge=16, le=960)
    frames: int = Field(default=24, ge=8, le=48)
    zoom: float = Field(default=8, ge=1.1, le=100, allow_inf_nan=False)
    palette: int = Field(default=0, ge=0, le=5)
    density: float = Field(default=1, ge=0.2, le=4, allow_inf_nan=False)
    phase: float = Field(default=0, ge=0, le=1, allow_inf_nan=False)
    render_options: RenderingOptions = Field(default_factory=RenderingOptions)

    @model_validator(mode="after")
    def animation_budget(self):
        if self.width * self.height > 600_000 or self.view.iterations > 10_000:
            raise ValueError("GIF export supports up to 600,000 pixels and 10,000 iterations")
        return self


def navigate(request: NavigateRequest) -> View:
    view = request.view
    with localcontext() as ctx:
        ctx.prec = view.digits + 20
        span = Decimal(view.span)
        new_span = span / Decimal(str(request.factor))
        minimum = Decimal(MIN_SPAN) if view.fractal in ("mandelbrot", "julia") else Decimal(MIN_DIRECT_SPAN)
        new_span = max(minimum, min(Decimal(16), new_span))
        # Zoom around the cursor: its complex coordinate stays fixed.
        shift = span - new_span if request.factor != 1 else span
        step_x, step_y = Decimal(str(request.dx)) * shift, Decimal(str(request.dy)) * shift
    x, y = Decimal(view.x), Decimal(view.y)
    significant = [value for value in (x, y, step_x, step_y) if value]
    high = max([0] + [value.adjusted() for value in significant])
    low = min([0] + [value.as_tuple().exponent for value in significant])
    with localcontext() as ctx:
        # Retain a supplied long center even when first viewed at a shallow zoom.
        # Step calculation keeps its own bounded precision, preventing unbounded
        # growth in the coordinate strings after repeated mouse gestures.
        ctx.prec = max(view.digits + 20, min(12032, high - low + 1))
        return View(
            **{
                **view.model_dump(),
                "x": str(x + step_x),
                "y": str(y + step_y),
                "span": str(new_span),
            }
        )
