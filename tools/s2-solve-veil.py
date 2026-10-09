"""S2 · Solve the *minimum* veil for a wallpaper, in either mode.

`tools/s2-discover-light.py` solves this for candidates while searching. This one
answers the follow-up question for a wallpaper already chosen: "how thin can the
veil be before contrast breaks?" -- because a thinner veil leaves more of the
picture visible, and a hand-picked number like 0.72 is a conservative default, not
a floor.

The two constraints are the same as the discovery tool's:
  1. the inks that actually sit on the wallpaper (`label-primary`,
     `label-secondary`) must keep >= 4.5:1 over the art's darkest 5%;
  2. the composite's darkest 5% must stay on the correct side of the floor
     (light mode) or ceiling (dark mode), or the surface stops reading as the
     mode it claims to be.

Run (DSH runtime Python -- needs Pillow; no network):
    python tools/s2-solve-veil.py                     # all cached sources
    python tools/s2-solve-veil.py 8g9wyy yqmlmx
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(r"<plugins>\EVA-Inspired-Theme")
SRC = ROOT / "out" / "wallpaper-src"

# Mirrors of the colour source of truth (tools/s2-palette.py) -- EVA values, read off
# `out/s2-palette.json`: light bg-base/label-primary/label-secondary and the dark
# equivalents. If the palette changes, these three pairs must be updated with it.
# (2026-10-06 recolor: moved to the NERV palette -- light bg-base #dfe2ee /
#  #313546 / #4f5366, dark #202b42 / #d5dae4 / #bec6d7.)
LIGHT = {"fill": "#dfe2ee", "ink": "#313546", "ink2": "#4f5366",
         "probe": "p05", "floor": 0.50}
# Dark mode's worst case is the OPPOSITE end: the ink is light, so the composite
# gets *harder* to read as it gets brighter -- the art's p95, not its p05. Probing
# the dark end in dark mode measures the easy case and would report a veil far
# thinner than the picture can actually take.
DARK = {"fill": "#202b42", "ink": "#d5dae4", "ink2": "#bec6d7", "probe": "p95"}

TARGET = 4.5
STEPS = [round(0.30 + 0.01 * i, 2) for i in range(66)]   # 0.30 .. 0.95


def linearise(value: float) -> float:
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rel_lum(rgb) -> float:
    r, g, b = (linearise(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = (la, lb) if la >= lb else (lb, la)
    return (hi + 0.05) / (lo + 0.05)


def hex_rgb(text: str):
    text = text.lstrip("#")
    return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))


def enc(lin: float) -> float:
    c = 12.92 * lin if lin <= 0.0031308 else 1.055 * lin ** (1 / 2.4) - 0.055
    return max(0.0, min(255.0, c * 255.0))


def tone(path: Path) -> dict[str, float]:
    image = Image.open(path).convert("RGB")
    image.thumbnail((360, 360))
    pixels = (list(image.get_flattened_data()) if hasattr(image, "get_flattened_data")
              else list(image.getdata()))
    lums = sorted(0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
                  for r, g, b in pixels)
    pick = lambda t: lums[min(len(lums) - 1, int(t * len(lums)))]  # noqa: E731
    return {"p05": pick(0.05), "median": pick(0.5), "p95": pick(0.95),
            "mean": sum(lums) / len(lums)}


def evaluate(tone_v: dict[str, float], mode: str, alpha: float) -> dict:
    pal = LIGHT if mode == "light" else DARK
    fill = hex_rgb(pal["fill"])
    art = enc(tone_v[pal["probe"]])
    comp = tuple(f * alpha + a * (1 - alpha) for f, a in zip(fill, (art, art, art)))
    return {
        "comp": "#%02x%02x%02x" % tuple(round(c) for c in comp),
        "compLin": rel_lum(comp),
        "primary": contrast(hex_rgb(pal["ink"]), comp),
        "secondary": contrast(hex_rgb(pal["ink2"]), comp),
    }


def solve(tone_v: dict[str, float], mode: str) -> tuple[float | None, float]:
    pal = LIGHT if mode == "light" else DARK
    best = None
    for alpha in STEPS:
        j = evaluate(tone_v, mode, alpha)
        floor_ok = j["compLin"] >= pal["floor"] if mode == "light" else True
        if j["primary"] >= TARGET and j["secondary"] >= TARGET and floor_ok:
            best = alpha
            break
    return best, (best or STEPS[-1])


def main() -> int:
    wanted = [a for a in sys.argv[1:] if not a.startswith("--")] or None
    files = sorted(p for p in SRC.glob("*.*") if p.suffix.lower() in (".jpg", ".png", ".webp"))
    if not files:
        print(f"no cached sources in {SRC} -- run tools/s2-previews.py first")
        return 1

    # READ THIS BEFORE TRUSTING A ROW: this scan covers EVERY cached source, but only
    # two of them ship (tools/s3-build-wallpapers.py PICKS) --
    #   light -> eva-light-ai.png, minimum veil 0.67
    #   dark  -> eva-dark-ai.png,  minimum veil 0.61
    # The other rows are the unshipped wallhaven originals, and they need a much
    # thicker veil (0.82-0.88). They are not a verdict on SHIPPED_ALPHA (0.78/0.80).
    print(f"{'id':<10}{'mode':<7}{'probe':<7}{'min veil':>9}{'comp there':>12}"
          f"{'ink p/s':>14}{'ink@0.72':>13}   comp@0.72")
    for path in files:
        if wanted and path.stem not in wanted:
            continue
        t = tone(path)
        for mode in ("dark", "light"):
            probe = (LIGHT if mode == "light" else DARK)["probe"]
            best, _ = solve(t, mode)
            if best is None:
                print(f"{path.stem:<10}{mode:<7}{probe:<7}{'none':>9}  "
                      f"-- no veil in 0.30..0.95 satisfies both constraints")
                continue
            at = evaluate(t, mode, best)
            hi = evaluate(t, mode, 0.72)
            print(f"{path.stem:<10}{mode:<7}{probe:<7}{best:>9.2f}{at['comp']:>12}"
                  f"{at['primary']:>7.2f}/{at['secondary']:<6.2f}"
                  f"{hi['primary']:>8.2f}/{hi['secondary']:<6.2f}   {hi['comp']}")
        print(f"{'':<10}art p05 {t['p05']:.4f}  median {t['median']:.4f}  "
              f"p95 {t['p95']:.4f}  mean {t['mean']:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
