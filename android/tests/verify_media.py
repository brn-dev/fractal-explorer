"""Inspect the actual encoded assets and the generated APK, without a phone."""
import hashlib
import json
import shutil
import subprocess
import zipfile
from fractions import Fraction
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "android/app/src/main/assets"
FFPROBE = shutil.which("ffprobe")
FFMPEG = shutil.which("ffmpeg")


def metadata(path):
    result = subprocess.run([FFPROBE, "-v", "error", "-show_streams", "-of", "json", str(path)],
                            check=True, capture_output=True)
    return json.loads(result.stdout)["streams"]


def frame(path, index, width, height):
    result = subprocess.run([FFMPEG, "-v", "error", "-i", str(path), "-vf", f"select=eq(n\\,{index})",
                             "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                            check=True, capture_output=True)
    return np.frombuffer(result.stdout, dtype=np.uint8).reshape(height, width, 3)


def main():
    if not FFMPEG or not FFPROBE:
        raise RuntimeError("FFmpeg and FFprobe are required")
    manifest = json.loads((ASSETS / "demo.json").read_text())
    clips = {clip["file"]: clip for clip in manifest["clips"]}
    for filename, expected in clips.items():
        path = ASSETS / filename
        streams = metadata(path)
        assert len(streams) == 1, "Wallpaper must have no audio track"
        stream = streams[0]
        assert stream["codec_name"] == "h264" and stream["pix_fmt"] == "yuv420p"
        assert (stream["width"], stream["height"]) == (expected["width"], expected["height"])
        assert Fraction(stream["avg_frame_rate"]) == expected["fps"]
        assert int(stream["nb_frames"]) == expected["frames"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected["sha256"]
        print(f"Verified {filename}: {stream['width']}×{stream['height']}, {expected['fps']} fps, silent H.264")
    for name in ("cover", "inner"):
        arrival, idle = clips[f"{name}-arrival.mp4"], clips[f"{name}-idle.mp4"]
        last = frame(ASSETS / arrival["file"], arrival["frames"] - 1, arrival["width"], arrival["height"])
        first = frame(ASSETS / idle["file"], 0, idle["width"], idle["height"])
        difference = float(np.abs(last.astype(float) - first.astype(float)).mean())
        assert difference < 4, f"Encoded arrival/idle handoff changed visibly: mean pixel difference {difference}"
        print(f"{name} encoded handoff: mean RGB difference {difference:.3f}/255")
    apk = ROOT / "artifacts/android-wallpaper/fractal-wallpaper.apk"
    with zipfile.ZipFile(apk) as archive:
        assert all(b"\\" not in info.orig_filename.encode() for info in archive.infolist()), "APK paths must use forward slashes"
        assert b"wallpaper-dialog" in archive.read("assets/explorer/index.html")
        workers = [info for info in archive.infolist() if info.filename.startswith("assets/explorer/assets/worker-")]
        assert workers and all(info.file_size > 0 for info in workers)
        for filename in clips:
            info = archive.getinfo(f"assets/{filename}")
            assert info.compress_type == zipfile.ZIP_STORED, "Video assets must support file descriptors"
            assert hashlib.sha256(archive.read(info)).hexdigest() == clips[filename]["sha256"]
        assert archive.getinfo("classes.dex").file_size > 0
    print(f"APK contents verified: {apk.stat().st_size / 1024**2:.1f} MiB")


if __name__ == "__main__":
    main()
