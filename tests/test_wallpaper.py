import json
from pathlib import Path

import numpy as np
import pytest

from scripts.render_wallpaper import colorize, render_scene, sample_view

CONFIG = json.loads(Path(__file__).resolve().parents[1].joinpath("android/demo-scenes.json").read_text())


@pytest.mark.parametrize("name", ["cover", "inner"])
def test_arrival_settles_at_idle_and_idle_returns_to_start(name):
    scene = CONFIG[name]
    arrival = sample_view(scene, "arrival", 1)
    start = sample_view(scene, "idle", 0)
    end = sample_view(scene, "idle", 1)
    assert arrival == start == end
    assert sample_view(scene, "arrival", 0) != start
    assert sample_view(scene, "idle", 0.5) != start
    for amount in (0.125, 0.25, 0.375):
        assert sample_view(scene, "idle", amount) == sample_view(scene, "idle", 1 - amount)


def test_color_seam_and_interior():
    field = np.array([[-1, 0, 10, 1000]], dtype=np.float32)
    start = colorize(field, CONFIG["palette"], 0)
    end = colorize(field, CONFIG["palette"], 1)
    assert np.array_equal(start, end)
    assert np.array_equal(start[0, 0], [6, 17, 27])
    assert start.flags.c_contiguous


def test_scene_changes_keep_deep_coordinates():
    scene = {"view": {"x": "-0.743643887037151000000000000000000000000001", "span": "1e-40"},
             "arrival_from": {"span": "2e-40"}, "idle_delta": {"span": "1e-42"}}
    view = sample_view(scene, "idle", 0.5)
    assert view.x == scene["view"]["x"]
    from decimal import Decimal

    assert Decimal(view.span) == Decimal("1.01e-40")


def test_deep_arrival_start_is_exact_and_interpolation_keeps_its_precision():
    from decimal import Decimal, localcontext

    center = "0." + "1234567890" * 100
    scene = {"view": {"x": "0", "span": "3.6"},
             "arrival_from": {"x": center, "span": "1e-1000"}}
    start = sample_view(scene, "arrival", 0)
    assert start.x == center
    assert start.span == "1e-1000"
    with localcontext() as ctx:
        ctx.prec = 1100
        assert Decimal(sample_view(scene, "arrival", .5).x) == Decimal(center) / 2


def test_idle_delta_cancellation_preserves_a_deep_target():
    from decimal import Decimal, localcontext

    with localcontext() as ctx:
        ctx.prec = 1100
        delta = str(Decimal("1e-1000") - Decimal("3.6"))
    scene = {"view": {"span": "3.6"}, "idle_delta": {"span": delta}}
    assert Decimal(sample_view(scene, "idle", .5).span) == Decimal("1e-1000")


@pytest.mark.parametrize("stage,amount", [("other", 0), ("arrival", -1), ("idle", float("nan"))])
def test_invalid_timeline_positions(stage, amount):
    with pytest.raises(ValueError):
        sample_view(CONFIG["cover"], stage, amount)


@pytest.mark.parametrize("stage,fps", [("arrival", 1), ("arrival", 2), ("idle", 1), ("idle", 2)])
def test_short_clips_are_rejected_before_ffmpeg_starts(stage, fps, monkeypatch):
    config = {**CONFIG, f"{stage}_fps": fps, f"{stage}_seconds": 0.5}
    monkeypatch.setattr("scripts.render_wallpaper.subprocess.Popen", lambda *a, **kw: pytest.fail("FFmpeg started for invalid timing"))
    with pytest.raises(ValueError, match="at least two frames"):
        render_scene(None, config["cover"], config, "cover", Path("unused"), "ffmpeg", "cpu")
