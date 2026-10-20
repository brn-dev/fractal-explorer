from io import BytesIO

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from fractal_explorer.server import app


def test_local_api_and_validation():
    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert "fractal-canvas" in client.get("/").text
        assert client.get("/numbers.mjs").headers["content-type"].startswith("text/javascript")
        assert "min_span" in client.get("/api/capabilities").json()
        request = {"width": 32, "height": 24, "backend": "cpu"}
        response = client.post("/api/render", json=request)
        assert response.status_code == 200
        assert np.frombuffer(response.content, dtype="<f4").shape == (32 * 24,)
        assert "elapsed_ms" in response.headers["x-render-meta"]
        assert client.post("/api/render", json={"view": {"x": "Infinity"}}).status_code == 422
        assert client.post("/api/render", json={"width": 4096, "height": 4096}).status_code == 422
        result = client.post("/api/navigate", json={"view": {"span": "1e-100"}, "dx": 0.1})
        assert result.status_code == 200
        assert result.json()["x"] != "-0.5"
        assert client.post("/api/navigate", json={"view": {"x": "1000000"}, "dx": 1}).status_code == 422
        assert client.get("/", headers={"Host": "untrusted.example"}).status_code == 400


def test_gif_export_contains_real_rendered_frames():
    with TestClient(app) as client:
        response = client.post(
            "/api/animation.gif",
            json={
                "view": {"iterations": 100, "x": "-0.74", "y": "0.13", "span": "0.1"},
                "width": 32,
                "height": 24,
                "frames": 8,
                "zoom": 4,
            },
        )
        assert response.status_code == 200
        image = Image.open(BytesIO(response.content))
        assert image.size == (32, 24)
        assert image.n_frames == 8
        first = np.array(image.convert("RGB"))
        image.seek(7)
        assert not np.array_equal(first, np.array(image.convert("RGB")))
