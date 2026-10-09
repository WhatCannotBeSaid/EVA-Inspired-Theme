"""S2 · Clean wallpaper previews -- the art by itself, nothing drawn on top.

The first preview pass drew a mock UI card over each candidate to prove contrast.
That is the right tool for a contrast argument and the wrong tool for looking at a
wallpaper: the card covered most of the picture.

This renders two sheets per mode and draws nothing on the art:
  raw  -- the picture as it downloads
  veil -- the picture through this theme's veil, i.e. what actually ships

Source files are cached in out\\wallpaper-src\\ so the package pipeline in S3 has
them locally and nothing is downloaded twice.

Run (DSH runtime Python -- needs Pillow):
    python tools/s2-previews.py
"""

# ── 历史工具（2026-10-05 EVA 版）：本脚本属于 Cyberpunk 版的选图闭环（缓存源图 + 出预览
#    图），不产出任何被构建链消费的文件。EVA 的两张壁纸由用户直接指定（亮 8g9wyy /
#    暗 yqmlmx），故本文件不再需要运行；下面的 LIGHT_VEIL/DARK_VEIL 与候选清单是历史
#    记录，故意不与 tools/s2-palette.py 同步。

from __future__ import annotations

import json
import urllib.request
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"<plugins>\EVA-Inspired-Theme")
OUT = ROOT / "out"
SRC = OUT / "wallpaper-src"
SHOTS = OUT / "previews"
HDRS = {"User-Agent": "dsh-theme-sourcing/1.0 (local theme authoring; read-only)"}

CELL = (960, 540)
PAD = 12
LABEL = 30
COLS = 2
BG = (16, 18, 22)

LIGHT_VEIL = "#e3e8ee"
DARK_VEIL = "#070d11"

PICKS = [
    # Alpha values come from tools/s2-solve-veil.py measured on the FULL-SIZE
    # source, not on the wallhaven thumbnail. The two disagree by ~0.01 because a
    # 320px thumbnail and a 3840px original do not have identical percentiles, and
    # a contrast guarantee only holds for the number measured on what ships.
    ("dark", "l8v3ey", 0.67, "桥栏剪影面对整墙霓虹 · 4000x1691 · 推荐（veil 下限 0.67）",
     r"<Desktop>\wallhaven-l8v3ey.png"),
    ("dark", "6oqzgq", 0.64, "黎明天际线·低生活/高科技反差最强 · 2500x1250 · 备选（下限 0.64）",
     r"<Desktop>\wallhaven-6oqzgq.jpg"),
    ("light", "k8wv6d", 0.77, "冬季城市航拍 + 深蓝水面 · 3840x2160 · 推荐（下限 0.77）", None),
    ("light", "z8q3jj", 0.73, "黄昏天际线（偏薰衣草紫）· 4096x2303 · 备选（下限 0.73）", None),
    ("light", "l8m9xp", 0.76, "云海之上的科幻都会（合成后偏暖米）· 3840x2160（下限 0.76）", None),
    ("light", "ogydl7", 0.75, "青蓝巨型结构（雾多、信息量低）· 3000x1688（下限 0.75）", None),
]


def fetch(url: str, timeout: int = 90) -> bytes:
    request = urllib.request.Request(url, headers=HDRS)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


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


def source_for(wall_id: str, local: str | None, direct: dict[str, str]) -> Path:
    """Cache the full-size source locally so nothing downloads twice."""
    SRC.mkdir(parents=True, exist_ok=True)
    if local and Path(local).exists():
        ext = Path(local).suffix or ".jpg"
        target = SRC / f"{wall_id}{ext}"
        if not target.exists():
            target.write_bytes(Path(local).read_bytes())
        return target
    for ext in (".jpg", ".png", ".webp"):
        existing = SRC / f"{wall_id}{ext}"
        if existing.exists():
            return existing
    url = direct.get(wall_id)
    if not url:
        raise RuntimeError(f"no source for {wall_id}")
    raw = fetch(url)
    target = SRC / f"{wall_id}{Path(url).suffix or '.jpg'}"
    target.write_bytes(raw)
    return target


def fit(art: Image.Image) -> Image.Image:
    """Fit the picture into the cell, letterboxed rather than cropped."""
    art = art.convert("RGB")
    scale = min(CELL[0] / art.width, CELL[1] / art.height)
    size = (max(1, round(art.width * scale)), max(1, round(art.height * scale)))
    return art.resize(size, Image.LANCZOS)


def sheet(rows: list[tuple[Image.Image, str]], path: Path) -> None:
    n = len(rows)
    r = (n + COLS - 1) // COLS
    width = COLS * CELL[0] + (COLS + 1) * PAD
    height = r * (CELL[1] + LABEL) + (r + 1) * PAD
    out = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(out)
    f = font(18)
    for i, (image, cap) in enumerate(rows):
        cx = PAD + (i % COLS) * (CELL[0] + PAD)
        cy = PAD + (i // COLS) * (CELL[1] + LABEL + PAD)
        out.paste(image, (cx + (CELL[0] - image.width) // 2,
                          cy + (CELL[1] - image.height) // 2))
        draw.rectangle((cx, cy, cx + CELL[0] - 1, cy + CELL[1] - 1),
                       outline=(64, 72, 82), width=1)
        draw.text((cx + 2, cy + CELL[1] + 6), cap[:96], font=f, fill=(216, 222, 230))
    out.save(path)
    print(f"  wrote {path.name}  {width}x{height}  {n} cells")


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    report = OUT / "s2-light-candidates.json"
    direct: dict[str, str] = {}
    if report.exists():
        for row in json.loads(report.read_text(encoding="utf-8")).get("rows", []):
            direct[row["id"]] = row.get("direct", "")

    buckets: dict[str, list] = {"dark": [], "light": []}
    veil_buckets: dict[str, list] = {"dark": [], "light": []}

    for mode, wall_id, alpha, caption, local in PICKS:
        try:
            path = source_for(wall_id, local, direct)
            art = Image.open(path)
            art.load()
        except Exception as exc:  # noqa: BLE001
            print(f"  SKIP {wall_id}: {exc!r}")
            continue
        raw = fit(art)
        veil_colour = hex_rgb(DARK_VEIL if mode == "dark" else LIGHT_VEIL)
        veiled = Image.blend(raw, Image.new("RGB", raw.size, veil_colour), alpha)

        buckets[mode].append((raw, f"{wall_id}  原图  {art.width}x{art.height}  {caption}"))
        veil_buckets[mode].append(
            (veiled, f"{wall_id}  veil {alpha:.2f} 后（实际出厂效果）  {caption}"))

    for mode in ("dark", "light"):
        if buckets[mode]:
            print(f"[{mode}]")
            sheet(buckets[mode], SHOTS / f"{mode}-raw-sheet.png")
            sheet(veil_buckets[mode], SHOTS / f"{mode}-veil-sheet.png")
    print(f"\npreviews in {SHOTS}\nsources cached in {SRC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
