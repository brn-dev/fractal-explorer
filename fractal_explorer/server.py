import json
import mimetypes
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from threading import BoundedSemaphore

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .color import colorize
from .engine import Engine, RenderError
from .models import AnimationRequest, NavigateRequest, RenderRequest, navigate

engine: Engine | None = None
# Drop excess work rather than growing an unbounded render queue during navigation.
slots = BoundedSemaphore(2)


@asynccontextmanager
async def lifespan(app):
    global engine
    engine = Engine()
    yield


app = FastAPI(title="Fractal Explorer", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])
# Windows may register .mjs as text/plain; browsers require a JavaScript MIME type.
mimetypes.add_type("text/javascript", ".mjs")


@app.get("/api/capabilities")
def capabilities():
    return engine.capabilities()


@app.post("/api/navigate")
def navigate_view(request: NavigateRequest):
    try:
        return navigate(request)
    except ValueError as exc:
        raise HTTPException(422, "Navigation would leave the supported coordinate range") from exc


def render_request(request):
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "Renderer is busy; please try again shortly")
    try:
        return engine.render(request)
    except RenderError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        slots.release()


@app.post("/api/render")
def render(request: RenderRequest):
    result = render_request(request)
    return Response(
        result.field.astype("<f4").tobytes(),
        media_type="application/octet-stream",
        headers={"X-Render-Meta": json.dumps(result.metadata), "Cache-Control": "no-store"},
    )


@app.post("/api/field.png")
def field_png(request: RenderRequest):
    """Diagnostic grayscale export, useful for renderer integrations."""
    import numpy as np
    from PIL import Image

    result = render_request(request)
    value = np.where(
        result.field < 0, 0, 255 * (np.log1p(np.maximum(result.field, 0)) / np.log1p(request.view.iterations))
    )
    buffer = BytesIO()
    Image.fromarray(value.astype(np.uint8)).save(buffer, format="PNG")
    return Response(buffer.getvalue(), media_type="image/png")


@app.post("/api/animation.gif")
def animation(request: AnimationRequest):
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "Renderer is busy; please try again shortly")
    try:
        images = []
        factor = request.zoom ** (1 / (request.frames - 1))
        view = request.view
        for _ in range(request.frames):
            result = engine.render(
                RenderRequest(
                    view=view,
                    width=request.width,
                    height=request.height,
                    **request.render_options.model_dump(),
                )
            )
            images.append(colorize(result.field, request.palette, request.density, request.phase))
            view = navigate(NavigateRequest(view=view, factor=factor))
        output = BytesIO()
        images[0].save(
            output, format="GIF", save_all=True, append_images=images[1:], duration=83, loop=0, optimize=False
        )
        return Response(
            output.getvalue(),
            media_type="image/gif",
            headers={"Content-Disposition": 'attachment; filename="fractal-zoom.gif"'},
        )
    except RenderError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        slots.release()


app.mount("/", StaticFiles(directory=Path(__file__).with_name("static"), html=True), name="ui")
