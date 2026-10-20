import json
from pathlib import Path

import numpy as np
from PIL import Image

PALETTES = json.loads(Path(__file__).with_name("static").joinpath("palettes.json").read_text())


def colorize(field, palette=0, density=1.0, phase=0.0):
    colors = np.array([[int(c[i : i + 2], 16) for i in (1, 3, 5)] for c in PALETTES[palette]["colors"]])
    table_t = np.arange(4096) / 4096 * (len(colors) - 1)
    k = np.floor(table_t).astype(int)
    f = (table_t - k)[:, None]
    table = np.rint(colors[k] * (1 - f) + colors[k + 1] * f).astype(np.uint8)
    escaped = field[field >= 0]
    origin = float(np.min(escaped)) if len(escaped) else 0.0
    counts = np.maximum(field.astype(np.float64) - origin, 0)
    indices = np.floor(((np.log1p(counts) * 0.2 * density + phase) % 1) * 4096)
    rgb = table[np.minimum(indices.astype(int), 4095)]
    rgb[field < 0] = [8, 17, 18]
    return Image.fromarray(rgb)
