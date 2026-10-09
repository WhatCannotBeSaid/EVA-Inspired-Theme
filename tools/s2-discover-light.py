"""S2 · Find a *bright* wallpaper for the light mode.

Why this exists
---------------
The theme ships a dark-first palette. P0 §9: a veil composites as
``art*(1-a) + fill*a``; with a white fill that can only darken the art, never
brighten it. Dark-mode art is fine (the veil is dark, and dark art stays dark).
The light mode has the opposite problem: its veil is nearly white, so art that is
already dark composites to a flat pale mush -- the picture stops reading as a
picture.

So the light mode needs its own art: bright enough that a moderate veil finishes
the job. This is arithmetic, not taste, so it is measured, not eyeballed.

What it does (read-only against the library)
--------------------------------------------
1. Asks the wallhaven API for candidates across brightness-oriented queries.
2. Downloads each *thumbnail* only, and measures its luminance distribution.
3. Composites every candidate through **this theme's actual light veil**
   (``bg-base`` at a given alpha), then measures the contrast of this theme's
   actual inks against the resulting composite.
4. Saves the finalists' thumbnails as PNG so they can be looked at.

The bar is not "pretty", it is "survives the veil without lying about contrast".

Run (DSH runtime Python -- needs Pillow):
    python tools/s2-discover-light.py
    python tools/s2-discover-light.py --alpha-scan
"""

# ── 历史工具（2026-10-05 EVA 版）：本脚本属于 Cyberpunk 版的「找亮色壁纸」闭环，产物
#    out\s2-light-candidates.json 在构建链上没有任何消费者。EVA 的两张壁纸由用户直接
#    指定（亮 8g9wyy / 暗 yqmlmx），故本文件不再需要运行；下面写死的 Cyberpunk 期数值
#    （FILL/INK_*）与 wallhaven 搜索词是历史记录，故意不与 tools/s2-palette.py 同步。

from __future__ import annotations

import argparse
import colorsys
import io
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(r"<plugins>\EVA-Inspired-Theme")
OUT = ROOT / "out"
SHOTS = OUT / "light-candidates"

API = "https://wallhaven.cc/api/v1/search"
HDRS = {"User-Agent": "dsh-theme-sourcing/1.0 (local theme authoring; read-only)"}

# This theme's light-mode numbers, read from the palette source of truth.
# Duplicated here on purpose: this tool must be runnable without importing the
# generator, and the values are asserted against out/s2-palette.json at the end.
FILL = "#e3e8ee"          # light bg-base -- the surface the veil rides on
INK_PRIMARY = "#0b121a"   # light label-primary  (17.9:1 on bg-base)
INK_SECONDARY = "#3e4955"
INK_CAPTION = "#67737f"
DEFAULT_ALPHA = 0.72

# Brightness-oriented queries. The dark-first reference set is a neon night city;
# the light analogue is the same city at dawn, in fog, under snow, or overexposed.
#
# These are deliberately BROAD (one or two words). Bisected against the live API:
# a narrow phrase like "cyberpunk city dawn" returns total=8 unfiltered and total=0
# once atleast+ratios are applied, whereas "cyberpunk" returns 2543 under the same
# filters. The brightness judgement below is what selects, not the search phrase.
QUERIES = [
    "cyberpunk",
    "cyberpunk city",
    "neon city",
    "solarpunk",
    "solarpunk city",
    "futuristic city",
    "science fiction city",
    "neon",
    "city future",
    "utopia city",
    "fog city",
    "sunrise city",
    "snow city",
    "cyberpunk daylight",
    # Round 2: brightness-oriented queries returned bright castles, fantasy cliffs
    # and Mount Fuji -- bright landscapes, not neon cities. These aim at
    # *architecture* and *daylight sci-fi*, which is where a bright urban subject
    # actually lives.
    "megastructure",
    "arcology",
    "brutalist",
    "futuristic architecture",
    "city blue sky",
    "tokyo street",
    "hong kong street",
    "space station interior",
    "white architecture",
    "concept art city",
]

# Broad queries are worth paging through; wallhaven returns 24 per page for guests.
PAGES = (1, 2)

RESOLUTION_FLOOR = "2560x1440"
RATIOS = "16x9,16x10,21x9"


# ---------------------------------------------------------------- colour maths
def linearise(value: float) -> float:
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rel_lum(rgb: tuple[float, float, float]) -> float:
    r, g, b = (linearise(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = (la, lb) if la >= lb else (lb, la)
    return (hi + 0.05) / (lo + 0.05)


def hex_rgb(text: str) -> tuple[float, float, float]:
    text = text.lstrip("#")
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))


def over(fill: tuple[float, float, float], alpha: float,
         art: tuple[float, float, float]) -> tuple[float, float, float]:
    """The browser's default composite: channel-wise, in encoded sRGB."""
    return tuple(f * alpha + a * (1.0 - alpha) for f, a in zip(fill, art))


# --------------------------------------------------------------------- fetching
def fetch(url: str, params: dict | None = None, timeout: int = 30) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers=HDRS)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def tone_of(image: Image.Image) -> dict[str, float]:
    """Luminance distribution in *linear* space, plus the encoded-space mean.

    Encoded mean is what a human reads off the file ("is the picture light or
    dark"); linear percentiles are what the veil arithmetic needs.
    """
    image = image.convert("RGB")
    image.thumbnail((360, 360))
    pixels = (list(image.get_flattened_data()) if hasattr(image, "get_flattened_data")
              else list(image.getdata()))
    lums = sorted(
        0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
        for r, g, b in pixels
    )
    pick = lambda t: lums[min(len(lums) - 1, int(t * len(lums)))]  # noqa: E731
    encoded = sorted((r + g + b) / 3.0 for r, g, b in pixels)
    return {
        "linMean": round(sum(lums) / len(lums), 4),
        "linMedian": round(pick(0.5), 4),
        "linP05": round(pick(0.05), 4),
        "linP95": round(pick(0.95), 4),
        "encMean": round(sum(encoded) / len(encoded), 1),
    }


def colour_of(image: Image.Image) -> dict[str, float]:
    """Palette character, because this theme is deliberately cool-biased.

    Brightness alone kept returning warm sandstone fantasy and snowy castles --
    technically usable, tonally wrong. `--dsw-*` neutrals in both modes carry a
    measured negative CIELAB b*, so the art behind them has to lean the same way
    or the composite reads muddy.
    """
    image = image.convert("RGB")
    image.thumbnail((200, 200))
    pixels = (list(image.get_flattened_data()) if hasattr(image, "get_flattened_data")
              else list(image.getdata()))
    n = len(pixels)
    sat_sum = 0.0
    cool = warm = chromatic = 0
    for r, g, b in pixels:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        sat_sum += s
        if s > 0.18:
            chromatic += 1
            deg = h * 360.0
            if 165.0 <= deg <= 275.0:      # cyan -> blue: this theme's home
                cool += 1
            elif deg <= 70.0 or deg >= 315.0:   # amber -> red: the warm signals
                warm += 1
    return {
        "satMean": round(sat_sum / n, 4),
        "chromaticShare": round(chromatic / n, 4),
        "coolShare": round(cool / n, 4),
        "warmShare": round(warm / n, 4),
        "coolness": round((cool - warm) / max(1, chromatic), 4),
    }


def enc(lin: float) -> float:
    """Linear luminance -> encoded sRGB byte (0..255)."""
    c = 12.92 * lin if lin <= 0.0031308 else 1.055 * lin ** (1 / 2.4) - 0.055
    return max(0.0, min(255.0, c * 255.0))


def judge(tone: dict[str, float], alpha: float, fill_hex: str) -> dict:
    """Composite the art through this theme's veil and check this theme's inks."""
    fill = hex_rgb(fill_hex)

    rows = {}
    for tag, lin in (("p05", tone["linP05"]), ("median", tone["linMedian"]),
                     ("p95", tone["linP95"]), ("mean", tone["linMean"])):
        art = enc(lin)
        comp = over(fill, alpha, (art, art, art))
        rows[tag] = {
            "artByte": round(art, 1),
            "compHex": "#%02x%02x%02x" % tuple(round(c) for c in comp),
            "compLin": round(rel_lum(comp), 4),
            "primary": round(contrast(hex_rgb(INK_PRIMARY), comp), 2),
            "secondary": round(contrast(hex_rgb(INK_SECONDARY), comp), 2),
            "caption": round(contrast(hex_rgb(INK_CAPTION), comp), 2),
        }
    return rows


# The two constraints a candidate must satisfy, and why these are the right ones:
#
#  * Only `primary` and `secondary` ink ever sits directly on the wallpaper. The
#    dimmer labels (`caption`, `dimmed`) live on the opaque layer-1/2/3 surfaces,
#    so demanding 4.5:1 for them *over the raw art* is the wrong bar -- it rejects
#    every real photograph (0 of 298 cleared it) while accepting a blank white
#    image, which is exactly backwards.
#  * `FLOOR_LUM` keeps the surface reading as a *light* surface. Too thin a veil
#    lets a dark corner through and the "light mode" goes blotchy.
#
# Both constraints tighten as alpha grows, so the binding one is whichever is
# stricter, and the useful number per candidate is the SMALLEST alpha that works:
# a thinner veil leaves more of the picture visible. That is the ranking axis.
INK_TARGET = 4.5
FLOOR_LUM = 0.50
ALPHA_MIN, ALPHA_MAX, ALPHA_STEP = 0.30, 0.95, 0.01
MIN_ART_SPREAD = 25.0     # encoded bytes between p05 and p95; below this it is a flat field


def solve_alpha(tone: dict[str, float], fill_hex: str) -> tuple[float | None, dict]:
    """Smallest veil alpha at which both constraints hold."""
    alpha = ALPHA_MIN
    while alpha <= ALPHA_MAX + 1e-9:
        j = judge(tone, alpha, fill_hex)
        if (j["p05"]["primary"] >= INK_TARGET
                and j["p05"]["secondary"] >= INK_TARGET
                and j["p05"]["compLin"] >= FLOOR_LUM):
            return round(alpha, 2), j
        alpha += ALPHA_STEP
    return None, judge(tone, ALPHA_MAX, fill_hex)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-query", type=int, default=24)
    parser.add_argument("--alpha", type=float, default=DEFAULT_ALPHA)
    parser.add_argument("--alpha-scan", action="store_true")
    parser.add_argument("--top", type=int, default=12, help="how many previews to save")
    args = parser.parse_args()

    SHOTS.mkdir(parents=True, exist_ok=True)

    seen: dict[str, dict] = {}
    log = []
    for query in QUERIES:
        for page in PAGES:
            params = {
                "q": query, "categories": "100", "purity": "100",
                "atleast": RESOLUTION_FLOOR, "ratios": RATIOS,
                "sorting": "favorites", "order": "desc", "page": page,
            }
            try:
                payload = json.loads(fetch(API, params))
                entries = payload.get("data", [])
                log.append({"q": query, "page": page, "n": len(entries),
                            "total": payload.get("meta", {}).get("total")})
                for entry in entries:
                    seen.setdefault(entry["id"], entry)
            except Exception as exc:  # noqa: BLE001 - a failed query is just a gap
                log.append({"q": query, "page": page, "error": repr(exc)})
            time.sleep(0.6)

    print(f"{len(seen)} unique candidates from {len(QUERIES)}x{len(PAGES)} queries")

    rows = []
    previews: dict[str, bytes] = {}
    for wall_id, entry in seen.items():
        try:
            raw = fetch(entry["thumbs"]["small"])
            image = Image.open(io.BytesIO(raw))
            tone = tone_of(image)
            colour = colour_of(image)
            previews[wall_id] = fetch(entry["thumbs"]["large"])
        except Exception as exc:  # noqa: BLE001
            log.append({"id": wall_id, "thumb_error": repr(exc)})
            continue
        rows.append({
            "id": wall_id,
            "resolution": entry["resolution"],
            "favorites": entry.get("favorites"),
            "colors": entry.get("colors"),
            "page": entry["url"],
            "direct": entry["path"],
            "tone": tone,
            "colour": colour,
            "artSpread": round(enc(tone["linP95"]) - enc(tone["linP05"]), 1),
            "alpha": None,
            "veil": None,
        })
        time.sleep(0.15)

    for row in rows:
        if row["artSpread"] < MIN_ART_SPREAD:
            row["reject"] = f"flat field (art spread {row['artSpread']} < {MIN_ART_SPREAD})"
            continue
        alpha, veil = solve_alpha(row["tone"], FILL)
        if alpha is None:
            row["reject"] = "no veil thickness satisfies the constraints"
            row["veil"] = veil
            continue
        row["alpha"] = alpha
        row["veil"] = veil
        # How much encoded range the picture keeps after the veil: this is the
        # "does it still read as a picture" number.
        row["shippedSpread"] = round(row["artSpread"] * (1 - alpha), 1)

    ok = [r for r in rows if r.get("alpha")]
    ok.sort(key=lambda r: (r["alpha"], -r.get("shippedSpread", 0)))
    cool = [r for r in ok if r["colour"]["coolness"] >= 0.0]

    print(f"\n{len(ok)} of {len(rows)} candidates survive the veil constraints; "
          f"{len(cool)} of those lean cool\n")
    print(f"  {'id':<9}{'veil':>6}{'shown':>7}{'cool':>7}{'warm':>7}{'coolness':>9}  "
          f"{'comp med':<9}{'comp p05':<9}{'p05 ink p/s':<13}{'res':<11}{'fav':>5}")
    for row in cool[:args.top]:
        v, c = row["veil"], row["colour"]
        print(f"  {row['id']:<9}{row['alpha']:>6.2f}{row['shippedSpread']:>7.1f}"
              f"{c['coolShare']:>7.3f}{c['warmShare']:>7.3f}{c['coolness']:>9.3f}  "
              f"{v['median']['compHex']:<9}{v['p05']['compHex']:<9}"
              f"{v['p05']['primary']:>6.2f}/{v['p05']['secondary']:<6.2f}  "
              f"{row['resolution']:<11}{str(row['favorites']):>5}")

    warm = [r for r in ok if r["colour"]["coolness"] < 0.0]
    if warm:
        print(f"\n  -- {len(warm)} warm-leaning survivors, best 5 (kept as a fallback) --")
        for row in warm[:5]:
            c = row["colour"]
            print(f"  {row['id']:<9}{row['alpha']:>6.2f}{row['shippedSpread']:>7.1f}"
                  f"{c['coolShare']:>7.3f}{c['warmShare']:>7.3f}{c['coolness']:>9.3f}  "
                  f"{row['veil']['median']['compHex']:<9}{row['veil']['p05']['compHex']:<9}"
                  f"{row['veil']['p05']['primary']:>6.2f}/{row['veil']['p05']['secondary']:<6.2f}  "
                  f"{row['resolution']:<11}{str(row['favorites']):>5}")

    if args.alpha_scan:
        print("\nsolved veil per cool candidate (smaller = more picture survives):")
        for row in cool[:12]:
            print(f"  {row['id']:<9} alpha {row['alpha']:.2f}  "
                  f"comp med {row['veil']['median']['compHex']}  "
                  f"p05 ink {row['veil']['p05']['primary']:.2f}/"
                  f"{row['veil']['p05']['secondary']:.2f}  cool {row['colour']['coolness']:+.3f}  "
                  f"{row['page']}")

    # Save previews only for the finalists, so the folder stays readable.
    for old in SHOTS.glob("*.png"):
        old.unlink()
    for row in cool[:args.top]:
        blob = previews.get(row["id"])
        if blob:
            Image.open(io.BytesIO(blob)).save(SHOTS / f"{row['id']}.png")

    (OUT / "s2-light-candidates.json").write_text(
        json.dumps({"fill": FILL, "inkTarget": INK_TARGET, "floorLum": FLOOR_LUM,
                    "minArtSpread": MIN_ART_SPREAD, "log": log, "rows": rows},
                   ensure_ascii=False, indent=1),
        encoding="utf-8")
    print(f"\n{min(len(ok), args.top)} previews in {SHOTS}")
    print(f"full report in {OUT / 's2-light-candidates.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
