"""Render arrival clips and seamless idle loops with the existing local engine.

uv run python scripts/render_wallpaper.py
uv run python scripts/render_wallpaper.py --settings my-scenes.json --output artifacts/my-wallpaper
"""
import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
from decimal import Decimal, localcontext
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fractal_explorer.engine import Engine
from fractal_explorer.models import RenderRequest, View


def smootherstep(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def sample_view(scene, stage, amount):
    """The arrival endpoint and idle endpoints share exactly the same view."""
    if stage not in ("arrival", "idle") or not math.isfinite(amount) or not 0 <= amount <= 1:
        raise ValueError("Choose arrival or idle and a position from 0 to 1")
    base = View.model_validate(scene["view"])
    if (stage == "arrival" and amount == 1) or (stage == "idle" and amount in (0, 1)):
        return base
    start = View.model_validate({**base.model_dump(), **scene.get("arrival_from", {})}) if stage == "arrival" else base
    if stage == "arrival" and amount == 0:
        return start
    changes = {}
    with localcontext() as ctx:
        supplied = scene.get("arrival_from" if stage == "arrival" else "idle_delta", {})
        values = [Decimal(str(value)) for key, value in supplied.items()]
        # Preserve both deep endpoints and significant digits in a delta that
        # cancels the base (for example 3.6 + (-3.6 + 1e-1000)).
        ctx.prec = max(80, base.digits + 10, start.digits + 10,
                       *(len(value.as_tuple().digits) + 32 for value in values))
        if stage == "arrival":
            weight = Decimal(str(smootherstep(amount)))
            for key, start in scene.get("arrival_from", {}).items():
                end = Decimal(str(getattr(base, key)))
                changes[key] = str(Decimal(str(start)) * (1 - weight) + end * weight)
        elif stage == "idle":
            # Round the folded phase so outbound and return frames share fields.
            distance = min(amount % 1, 1 - amount % 1)
            weight = Decimal(str(round((1 - math.cos(2 * math.pi * distance)) / 2, 14)))
            for key, delta in scene.get("idle_delta", {}).items():
                changes[key] = str(Decimal(str(getattr(base, key))) + Decimal(str(delta)) * weight)
        else:
            raise ValueError("Choose arrival or idle")
    for key in ("iterations", "bailout"):
        if key in changes:
            changes[key] = round(Decimal(changes[key])) if key == "iterations" else float(changes[key])
    for key, value in changes.items():
        if isinstance(value, str) and len(value) > 12064:
            with localcontext() as ctx:
                ctx.prec = 12032
                changes[key] = str(+Decimal(value))
    return View.model_validate({**base.model_dump(), **changes})


def colorize(field, colors, phase):
    stops = np.array([[int(color[i:i + 2], 16) for i in (1, 3, 5)] for color in colors], dtype=float)
    positions = np.arange(4096) / 4096
    table = np.column_stack([np.interp(positions, np.linspace(0, 1, len(stops)), stops[:, i]) for i in range(3)])
    # A fixed origin keeps colors steady as parameters change.
    index = ((np.log1p(np.maximum(field, 0)) * 0.15 + phase) % 1 * 4096).astype(np.int32)
    rgb = table[np.clip(index, 0, 4095)].astype(np.uint8)
    rgb[field < 0] = (6, 17, 27)
    return np.ascontiguousarray(rgb)


def render_scene(engine, scene, config, name, output, ffmpeg, backend):
    width, height = scene["width"], scene["height"]
    if width % 2 or height % 2 or min(width, height) < 16 or max(width, height) > 4096:
        raise ValueError("Scene dimensions must be even, from 16 to 4096 pixels")
    dimensions = (height, width) if scene.get("rotate", False) else (width, height)
    timings = {}
    for stage in ("arrival", "idle"):
        fps, duration = config[f"{stage}_fps"], config[f"{stage}_seconds"]
        if not 1 <= fps <= 60 or not 0.5 <= duration <= 60:
            raise ValueError("Choose 1–60 fps and 0.5–60 second clips")
        count = round(fps * duration)
        if count < 2:
            raise ValueError("Each clip must contain at least two frames; increase its duration or fps")
        timings[stage] = fps, count
    # Shared, bounded raw-field cache saves the symmetric return trip in the idle loop.
    fields = {}
    result = []
    for stage in ("arrival", "idle"):
        fps, count = timings[stage]
        filename = output / f"{name}-{stage}.mp4"
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                   "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0", "-an", "-c:v", "libx264",
                   "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-profile:v", "high",
                   "-g", str(fps * 2), "-movflags", "+faststart", str(filename)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE)
        first = last = None
        try:
            for index in range(count):
                amount = index / (count - 1) if stage == "arrival" else index / count
                view = sample_view(scene, stage, amount)
                key = view.model_dump_json()
                field = fields.get(key)
                if field is None:
                    field = engine.render(RenderRequest(view=view, width=dimensions[0], height=dimensions[1], backend=backend)).field
                    if scene.get("rotate", False):
                        field = np.rot90(field)
                    if sum(item.nbytes for item in fields.values()) + field.nbytes <= 384 * 1024**2:
                        fields[key] = field
                phase = 0.04 * math.sin(2 * math.pi * amount) if stage == "idle" else 0
                rgb = colorize(field, config["palette"], phase)
                if index == 0:
                    first = rgb.copy()
                last = rgb
                process.stdin.write(rgb.tobytes())
                if index % 15 == 0 or index == count - 1:
                    print(f"{name} {stage}: {index + 1}/{count}", flush=True)
            process.stdin.close()
            if process.wait() != 0:
                raise RuntimeError("FFmpeg did not complete the video")
        except BaseException:
            process.kill()
            process.wait()
            raise
        if stage == "arrival":
            arrival_last = last.copy()
        else:
            seam = float(np.abs(arrival_last.astype(float) - first.astype(float)).mean())
            if seam > 1e-8:
                raise RuntimeError(f"Arrival does not meet idle frame zero: {seam}")
            Image.fromarray(first).save(output / f"{name}-poster.png")
            print(f"{name}: arrival endpoint equals idle frame zero", flush=True)
        result.append({"file": filename.name, "width": width, "height": height, "fps": fps, "frames": count,
                       "seconds": count / fps, "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings", type=Path, default=ROOT / "android/demo-scenes.json")
    parser.add_argument("--output", type=Path, default=ROOT / "android/app/src/main/assets")
    parser.add_argument("--backend", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error("Install FFmpeg or pass --ffmpeg with its path")
    config = json.loads(args.settings.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    engine = Engine()
    print(f"Rendering on {engine.cuda.name if engine.cuda.cp is not None and args.backend != 'cpu' else 'CPU'}", flush=True)
    clips = []
    for name in ("cover", "inner"):
        clips.extend(render_scene(engine, config[name], config, name, args.output, args.ffmpeg, args.backend))
    (args.output / "demo.json").write_text(json.dumps({"format": "fractal-wallpaper/v1", "clips": clips}, indent=2), encoding="utf-8")
    print(f"Wallpaper assets ready: {args.output}")


if __name__ == "__main__":
    main()
