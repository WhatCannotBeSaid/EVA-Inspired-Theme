"""S2 · Render what the finalists will actually look like, and price them.

Two jobs in one pass:

1.  **Composite preview.** Take the candidate, put it through *this theme's* veil
    at the alpha that was solved for it, then draw a mock of the real UI on top
    using this theme's real ink/surface colours. Numbers said the candidates pass;
    this is what "pass" looks like.

2.  **Price it.** Run the exact asset pipeline the package will use -- downscale to
    shipped width, encode webp, base64 the data URL -- so the shipped byte cost is
    measured now rather than discovered in S3.

Run (DSH runtime Python -- needs Pillow):
    python tools/s2-finalize-light.py
"""

# ── 历史工具（2026-10-05 EVA 版）：本脚本属于 Cyberpunk 版的选图闭环（合成预览 + 发货
#    测算），产物 out\s2-finalists.json 只被 s2-sheet.py 读，构建链上零消费者。EVA 的
#    两张壁纸由用户直接指定（亮 8g9wyy / 暗 yqmlmx），故本文件不再需要运行；下面的
#    LIGHT/DARK 常量与候选清单是历史记录，故意不与 tools/s2-palette.py 同步。

from __future__ import annotations

import base64
import io
import json
import urllib.request
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"<plugins>\EVA-Inspired-Theme")
OUT = ROOT / "out"
SHOTS = OUT / "finalists"
SHIPPED_WIDTH = 2200
WEBP_QUALITY = 82
PREVIEW = (1200, 675)

HDRS = {"User-Agent": "dsh-theme-sourcing/1.0 (local theme authoring; read-only)"}

# This theme's light-mode constants (mirrors tools/s2-palette.py).
LIGHT = {
    "veil": "#e3e8ee", "layer1": "#f9fafc", "layer2": "#ffffff",
    "ink": "#0b121a", "ink2": "#3e4955", "ink3": "#596571",
    "cyan": "#0A6E80", "brand_ink": "#eff8f8", "border": "#102d4821",
}
# Dark-mode constants.
DARK = {
    "veil": "#070d11", "layer1": "#10181d", "layer2": "#192329",
    "ink": "#e9f2f7", "ink2": "#a5b3bc", "ink3": "#86959e",
    "cyan": "#45E0F2", "brand_ink": "#030d12", "border": "#e2f0ff21",
}

# Finalists. `alpha` is the veil solved by tools/s2-discover-light.py; local dark
# picks carry the alpha this theme ships for dark.
LIGHT_PICKS = [
    ("l8m9xp", 0.76, "sci-fi metropolis over a cloud sea (16:9, fav 244)"),
    ("k8wv6d", 0.76, "aerial winter city on deep blue water (16:9, fav 52)"),
    ("ogydl7", 0.75, "cyan megastructure in mist -- most on-theme (3000x1688)"),
    ("z8q3jj", 0.73, "dusk skyline, violet/magenta -- closest to the signal palette"),
]
DARK_PICKS = [
    ("l8v3ey", 0.72, "silhouette on a bridge facing a wall of neon signage"),
    ("6oqzgq", 0.72, "dawn cyberpunk skyline -- warm horizon, cool base"),
]


def fetch(url: str, timeout: int = 60) -> bytes:
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


def page_bytes(entry: dict) -> bytes:
    if entry.get("local"):
        return Path(entry["local"]).read_bytes()
    return fetch(entry["direct"])


def render(art: Image.Image, alpha: float, pal: dict, label: str) -> Image.Image:
    """Composite the art through the veil, then draw a mock of the real UI."""
    art = art.convert("RGB").resize(PREVIEW, Image.LANCZOS)
    fill = Image.new("RGB", PREVIEW, hex_rgb(pal["veil"]))
    comp = Image.blend(art, fill, alpha)

    draw = ImageDraw.Draw(comp, "RGBA")
    w, h = PREVIEW

    # A card on layer-1, because that is where the dimmer labels actually live.
    card = (60, 120, w - 60, h - 100)
    draw.rounded_rectangle(card, 6, fill=hex_rgb(pal["layer1"]) + (255,),
                           outline=hex_rgb(pal["border"]) + (255,), width=1)

    f_title, f_body, f_cap = font(30), font(21), font(17)
    draw.text((88, 150), "新会话 · New session", font=f_title, fill=hex_rgb(pal["ink"]))
    draw.text((88, 196), "检查一下 DSH 主题层是否真的只动令牌。", font=f_body,
              fill=hex_rgb(pal["ink2"]))
    draw.text((88, 228), "官方基线没有被覆盖，原始值可从 out/baseline.json 复算。",
              font=f_cap, fill=hex_rgb(pal["ink3"]))

    # A primary button: dark mode is a lit cyan tube with near-black ink, light mode
    # is an unlit cyan tube with near-white ink. This is the polarity proof.
    btn = (88, 268, 288, 314)
    draw.rounded_rectangle(btn, 4, fill=hex_rgb(pal["cyan"]) + (255,))
    draw.text((108, 280), "确认并继续", font=f_body, fill=hex_rgb(pal["brand_ink"]))

    # Bare ink straight on the veiled art, at the composite's darkest band.
    draw.text((60, 40), f"{label}   veil {alpha:.2f}", font=f_cap, fill=hex_rgb(pal["ink"]))
    return comp


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    report = ROOT / "out" / "s2-light-candidates.json"

    # Pull the solved alphas / direct URLs back out of the discovery run.
    direct: dict[str, str] = {}
    if report.exists():
        for row in json.loads(report.read_text(encoding="utf-8")).get("rows", []):
            direct[row["id"]] = row.get("direct", "")

    rows = []
    for spec, picks, mode in (("light", LIGHT_PICKS, "light"), ("dark", DARK_PICKS, "dark")):
        pal = LIGHT if mode == "light" else DARK
        for wall_id, alpha, why in picks:
            entry = {"id": wall_id, "direct": direct.get(wall_id, "")}
            if not entry["direct"]:
                local = Path(str(Path.home() / "Desktop"))
                hits = list(local.glob(f"wallhaven-{wall_id}.*"))
                if not hits:
                    print(f"  SKIP {wall_id}: no source")
                    continue
                entry["local"] = str(hits[0])
            try:
                raw = page_bytes(entry)
                art = Image.open(io.BytesIO(raw))
                art.load()
                src = art.size
                ship = art.convert("RGB").resize(
                    (SHIPPED_WIDTH, round(art.height * SHIPPED_WIDTH / art.width)),
                    Image.LANCZOS)
                buf = io.BytesIO()
                ship.save(buf, "WEBP", quality=WEBP_QUALITY, method=5)
                webp = buf.getvalue()
                data_url = "data:image/webp;base64," + base64.b64encode(webp).decode()
            except Exception as exc:  # noqa: BLE001
                print(f"  FAIL {wall_id}: {exc!r}")
                continue

            preview = render(art, alpha, pal, wall_id)
            preview.save(SHOTS / f"{mode}-{wall_id}.png")

            rows.append({
                "id": wall_id, "mode": mode, "why": why, "alpha": alpha,
                "source": entry.get("local") or entry["direct"],
                "sourceSize": f"{src[0]}x{src[1]}",
                "sourceBytes": len(raw),
                "shippedSize": f"{ship.width}x{ship.height}",
                "webpBytes": len(webp),
                "dataUrlBytes": len(data_url),
                "aspect": round(src[0] / src[1], 3),
                "preview": str(SHOTS / f"{mode}-{wall_id}.png"),
            })
            print(f"  {mode:<6}{wall_id:<9} {src[0]}x{src[1]:<6} -> "
                  f"{ship.width}x{ship.height}  src {len(raw) / 1024:8.0f} KB  "
                  f"webp {len(webp) / 1024:7.0f} KB  dataURL {len(data_url) / 1024:7.0f} KB  "
                  f"aspect {src[0] / src[1]:.3f}")

    (OUT / "s2-finalists.json").write_text(
        json.dumps({"shippedWidth": SHIPPED_WIDTH, "webpQuality": WEBP_QUALITY, "rows": rows},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    tot = sum(r["dataUrlBytes"] for r in rows)
    print(f"\n{len(rows)} finalists; all data URLs together {tot / 1024:.0f} KB "
          f"({tot / 1024 / 1024:.2f} MB) if every one shipped")
    print(f"previews in {SHOTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
