"""S2 · Lock the two chosen wallpapers, price them, and render the final pair sheet.

The picks are settled:
    light  l8m9xp   veil 0.76
    dark   6oqzgq   veil 0.64

Both veil numbers come from tools/s2-solve-veil.py measured on the FULL-SIZE source.
This tool answers the one question the picks left open -- shipped width vs package
size -- with real numbers instead of a guess, and it flags the case where a source
is too small to ship at a requested width without upscaling (6oqzgq is 2500px wide,
so 2560 would be synthetic resolution).

Run (DSH runtime Python -- needs Pillow; sources already cached, no download):
    python tools/s2-lock-picks.py
"""

# ── 历史工具（2026-10-05 EVA 版）：本脚本属于 Cyberpunk 版的选图闭环（锁图 + 定价 +
#    出并排图），产物 out\s2-picks.json 无人读取。EVA 的两张壁纸由用户直接指定
#    （亮 8g9wyy / 暗 yqmlmx），故本文件不再需要运行；下面的 picks 与 veil 数字是历史
#    记录，故意不与 tools/s2-palette.py 同步。

from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"<plugins>\EVA-Inspired-Theme")
OUT = ROOT / "out"
SRC = OUT / "wallpaper-src"
SHOTS = OUT / "previews"

WIDTHS = (1920, 2200, 2500, 2560, 2880)
WEBP_QUALITY = 82
CELL = (1080, 608)
PAD = 12
LABEL = 30
BG = (16, 18, 22)

PICKS = [
    # (mode, id, veil, fill colour of the veil, caption)
    ("dark", "6oqzgq", 0.64, "#070d11", "暗色 · 黎明天际线 · 2500x1250"),
    ("light", "l8m9xp", 0.76, "#e3e8ee", "亮色 · 云海之上的科幻都会 · 3840x2160"),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("msyh.ttc", "segoeui.ttf", "arial.ttf"):
        path = Path(os.environ.get("SystemRoot", "")) / "Fonts" / name
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


def hex_rgb(text: str) -> tuple[int, int, int]:
    text = text.lstrip("#")[:6]
    return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))


def find(wall_id: str) -> Path:
    for ext in (".jpg", ".png", ".webp"):
        path = SRC / f"{wall_id}{ext}"
        if path.exists():
            return path
    raise FileNotFoundError(f"{wall_id} not cached in {SRC}")


def main() -> int:
    rows = []
    for mode, wall_id, alpha, veil, caption in PICKS:
        path = find(wall_id)
        art = Image.open(path)
        art.load()
        native_w = art.width
        entry = {
            "id": wall_id, "mode": mode, "alpha": alpha,
            "source": str(path), "nativeWidth": native_w,
            "sourceSize": f"{art.width}x{art.height}",
            "sourceBytes": path.stat().st_size,
            "aspect": round(art.width / art.height, 4),
            "variants": {},
        }
        for width in WIDTHS:
            upscaled = width > native_w
            ship = art.convert("RGB").resize(
                (width, round(art.height * width / art.width)), Image.LANCZOS)
            buf = io.BytesIO()
            ship.save(buf, "WEBP", quality=WEBP_QUALITY, method=5)
            webp = buf.getvalue()
            entry["variants"][str(width)] = {
                "shippedSize": f"{ship.width}x{ship.height}",
                "upscaled": upscaled,
                "webpBytes": len(webp),
                "dataUrlBytes": len(webp) * 4 // 3 + 22,
            }
        rows.append(entry)

        for width in WIDTHS:
            v = entry["variants"][str(width)]
            print(f"  {mode:<6}{wall_id:<9} {width:>5}px -> {v['shippedSize']:<11}"
                  f" webp {v['webpBytes'] / 1024:7.0f} KB  dataURL "
                  f"{v['dataUrlBytes'] / 1024:7.0f} KB"
                  f"{'   ** SOURCE TOO SMALL: would upscale' if v['upscaled'] else ''}")
        print(f"  {'':<6}{wall_id:<9} native {entry['sourceSize']}  "
              f"aspect {entry['aspect']:.3f}  src {entry['sourceBytes'] / 1024 / 1024:.1f} MB")

    # The pair sheet: exactly the two chosen, at their solved veils, nothing drawn on top.
    cells = []
    for mode, wall_id, alpha, veil, caption in PICKS:
        art = Image.open(find(wall_id)).convert("RGB")
        scale = min(CELL[0] / art.width, CELL[1] / art.height)
        small = art.resize((round(art.width * scale), round(art.height * scale)), Image.LANCZOS)
        veiled = Image.blend(small, Image.new("RGB", small.size, hex_rgb(veil)), alpha)
        cells.append((veiled, f"{wall_id}  veil {alpha:.2f}  {caption}"))

    width = len(cells) * CELL[0] + (len(cells) + 1) * PAD
    height = CELL[1] + LABEL + 2 * PAD
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    f = font(19)
    for i, (image, caption) in enumerate(cells):
        cx = PAD + i * (CELL[0] + PAD)
        cy = PAD
        sheet.paste(image, (cx + (CELL[0] - image.width) // 2,
                            cy + (CELL[1] - image.height) // 2))
        draw.rectangle((cx, cy, cx + CELL[0] - 1, cy + CELL[1] - 1),
                       outline=(64, 72, 82), width=1)
        draw.text((cx + 2, cy + CELL[1] + 6), caption[:110], font=f, fill=(216, 222, 230))
    sheet.save(SHOTS / "picks-veil-sheet.png")
    print(f"\n  wrote picks-veil-sheet.png  {width}x{height}")

    for w in WIDTHS:
        tot = sum(r["variants"][str(w)]["dataUrlBytes"] for r in rows)
        up = [r["id"] for r in rows if r["variants"][str(w)]["upscaled"]]
        print(f"  pair total @ {w}px: {tot / 1024:.0f} KB "
              f"({tot / 1024 / 1024:.2f} MB){'  upscales: ' + ', '.join(up) if up else ''}")

    (OUT / "s2-picks.json").write_text(
        json.dumps({"webpQuality": WEBP_QUALITY, "widths": list(WIDTHS), "rows": rows},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  wrote {(OUT / 's2-picks.json').name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
