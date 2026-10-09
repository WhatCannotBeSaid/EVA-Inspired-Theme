"""S2 · Contact sheet of the wallpaper finalists, for a single-glance review.

Reads `out\\finalists\\*.png` (rendered by tools/s2-finalize-light.py) and lays them
out in one labelled grid, so the pick can be made against a comparison rather than
against six separate files.

Run (DSH runtime Python):
    python tools/s2-sheet.py
"""

# ── 历史工具（2026-10-05 EVA 版）：本脚本把 Cyberpunk 版选图闭环产出的
#    out\finalists\*.png 拼成对照图，EVA 的两张壁纸由用户直接指定（亮 8g9wyy /
#    暗 yqmlmx），该目录不会被生成，故本文件不再需要运行。

from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"<plugins>\EVA-Inspired-Theme")
SHOTS = ROOT / "out" / "finalists"
OUT = ROOT / "out" / "s2-finalists-sheet.png"

CELL = (760, 428)
PAD = 14
LABEL = 26
COLS = 2


def font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("segoeui.ttf", "msyh.ttc", "arial.ttf"):
        path = Path(os.environ.get("SystemRoot", "")) / "Fonts" / name
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


def main() -> int:
    meta = {}
    src = ROOT / "out" / "s2-finalists.json"
    if src.exists():
        for row in json.loads(src.read_text(encoding="utf-8")).get("rows", []):
            meta[f"{row['mode']}-{row['id']}"] = row

    # Dark first: it is the mode the reference set actually describes.
    order = [p for p in sorted(SHOTS.glob("dark-*.png"))] + \
            [p for p in sorted(SHOTS.glob("light-*.png"))]
    if not order:
        print("no previews found -- run tools/s2-finalize-light.py first")
        return 1

    rows = (len(order) + COLS - 1) // COLS
    width = COLS * CELL[0] + (COLS + 1) * PAD
    height = rows * (CELL[1] + LABEL) + (rows + 1) * PAD
    sheet = Image.new("RGB", (width, height), (18, 20, 24))
    draw = ImageDraw.Draw(sheet)
    f = font(17)

    for i, path in enumerate(order):
        key = path.stem
        info = meta.get(key, {})
        image = Image.open(path).convert("RGB").resize(CELL, Image.LANCZOS)
        cx = PAD + (i % COLS) * (CELL[0] + PAD)
        cy = PAD + (i // COLS) * (CELL[1] + LABEL + PAD)
        sheet.paste(image, (cx, cy))
        draw.rectangle((cx, cy, cx + CELL[0] - 1, cy + CELL[1] - 1),
                       outline=(70, 78, 88), width=1)
        cap = (f"{key}   veil {info.get('alpha', '?')}   "
               f"{info.get('shippedSize', '')}   webp {info.get('webpBytes', 0) // 1024} KB   "
               f"{info.get('why', '')}")
        draw.text((cx + 2, cy + CELL[1] + 4), cap[:118], font=f, fill=(214, 220, 228))

    sheet.save(OUT)
    print(f"wrote {OUT}  ({len(order)} cells, {width}x{height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
