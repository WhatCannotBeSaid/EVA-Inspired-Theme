"""S3 · Build the wallpaper asset bundle (`build/wallpapers.json`).

The two chosen images, encoded exactly as the package ships them and published as
data URLs. Same shape 星轨/STARWAKE uses, for the same reason: a theme that needs a
network fetch for its own art, or a build step at install time, breaks the first
time someone installs it from a tarball.

Sizing rule (measured in S2, `tools/s2-lock-picks.py`): each image ships at its own
NATIVE width, never upscaled, and never padded with synthetic resolution.

    8g9wyy  light  2560x1440  -> shipped 2560x1440  (native, zero resample)
    yqmlmx  dark   3840x2160  -> shipped 2560x1440  (downscaled, exactly 1440p 1:1)

Both land on 2560 because that is the largest width any of them actually has and
exactly 1440p at 16:9. The dark image's native 3840 would ship resolution no 1440p
viewport can use; the light image is already 1440p and must not be resampled at all.

Run (DSH runtime Python -- needs Pillow; sources already cached, no download):
    python tools/s3-build-wallpapers.py
    python tools/s3-build-wallpapers.py --check    # verify the bundle is current
"""

from __future__ import annotations

import base64
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
SRC = OUT / "wallpaper-src"
BUILD = ROOT / "build"

WEBP_QUALITY = 82
HDRS = {"User-Agent": "dsh-theme-sourcing/1.0 (local theme authoring; read-only)"}

# Light-mode exposure (2026-10-06, after the user reported "亮色模式下看不到壁纸").
#
# `8g9wyy` is a near-WHITE title card: measured p25 0.913, p50 1.000, chroma p95 0,
# i.e. most of the image is pure white. Behind a bright veil that leaves nothing to
# see -- the composited background varied by only 0.08 luminance on the real screen,
# and no alpha can fix it, because a white field under a white veil is white at every
# alpha (the earlier alpha sweep moved the visibility metric by 1.7x at best, while
# the blur radius moved it by 2.6x).
#
# This is a levels adjustment, not a filter: it maps the encoded range linearly, so
# the dark wordmark and the slate block survive while the white field comes down to a
# mid-light grey that a 55% veil can no longer swallow. Applied in ENCODED space on
# purpose -- this is a tonal decision about what ships, not a colour-space conversion.
#
#   1.000 -> 0.832   0.913 -> 0.766   0.054 -> 0.100
#
# The slope is chosen by the CONTRAST BUDGET, not by taste: the veil-covered
# background has to stay light enough for `label-tertiary` (light `#626171`) to hold
# 4.5:1 on the AVERAGE art, which needs the composite at luminance >= 0.697, i.e. the
# art's mean at >= 0.583 linear. A steeper curve (slope 0.58, first attempt) put the
# mean at 0.371 linear and would have dropped tertiary to ~3.9 -- a regression traded
# for visibility is not a fix. 0.74 lands the field at 0.655 linear: composite 0.727,
# tertiary 4.68.
#
# RETIRED (2026-10-06, later the same day): the shipped light art is now an
# AI-generated poster (`eva-light-ai.png`) that was produced AT the exposure the veil
# needs, so no curve is applied to it. This constant is kept as the record of what the
# wallhaven title card required -- and as the fallback if that card is ever restored.
LIGHT_TONE = {"black": 0.088, "slope": 0.74}

# TRIED AND REVERTED (2026-10-07): the user swapped the light default to a
# user-supplied wallhaven original (`k898gq`, a dark navy solar-system chart) and then
# asked for the previous art back -- 「现在将亮色的壁纸改为之前的那张」. The light
# default is therefore the AI poster `eva-light-ai.png` again. The k898gq file stays
# in `out/wallpaper-src/` (that swap is recorded in docs/design.md D48/D51), so
# re-adopting it is another one-line change to PICKS.
#
# RETIRED (2026-10-07, evening, D57): the AI poster `eva-light-ai.png` is no longer
# the light default. The user supplied `wallhaven-6l2rgq.jpg` (a deep-blue cumulus
# sky) and named the change: 「将EVA主题中的亮色壁纸换成这个」. The poster entry is
# kept in the record below rather than in PICKS -- it is the art every light-mode
# measurement in docs/design.md from D51 to D56 was taken on.
#
#   RETIRED light entry: id "8g9wyy", name "Title Card / 标题卡", file
#   `eva-light-ai.png`, width 2560, credit "AI-generated (user-directed) derivative of
#   wallhaven 8g9wyy", note "AI-generated light poster the user directed: EVA wordmark
#   over a grey field with a deep slate block (#424153, OKLCh h 287.4) ... the NERV
#   recolor moved the light ladder's anchor from h 288 to h 274 ..." -- see D51 in
#   docs/design.md for the full text.
#
# RETIRED (2026-10-07, later the same evening, D58): `6l2rgq` held the light slot for one
# decision only. The user named a second swap -- 「再换，换成这张」 -- and gave a wallhaven
# URL, <https://w.wallhaven.cc/full/og/wallhaven-ogg3zp.jpg>. Its entry is kept here in the
# record rather than in PICKS, because D57 is the decision that D57's own light-mode
# measurements were taken on:
#
#   RETIRED light entry: id "6l2rgq", name "Cumulus / 蓝空积云", file
#   `wallhaven-6l2rgq.jpg`, width 2560, credit "wallhaven 6l2rgq (user-supplied original,
#   resized only)", note "The user's own photograph, supplied 2026-10-07 as the light art: a
#   deep cobalt sky with sunlit cumulus towers against shadowed storm cloud, and one thin
#   contrail crossing the blue. Ships at 2560x1440 (`resampled=down` from a 4821x2712
#   source; never upscaled) with NO tone curve -- a photograph is not re-levelled to fit a
#   budget. CONSEQUENCE, measured and recorded rather than papered over: a DARK photograph
#   in the LIGHT slot -- encoded mean luminance 82.9 against the retired poster's 208.4. The
#   light slot's ink is dark and it is solved at the art's p05, so the worst-case surface no
#   longer held the shipped contrast contract at the shipped 0.35 veil. The alpha was NOT
#   touched to compensate -- same policy as D48." -- see D57 in docs/design.md.
#
# RETIRED (2026-10-07, same evening, D59): `ogg3zp` held the light slot for one decision
# only. The user named a third swap -- 「换成这张」 with an attached image, then restated it
# for the light slot -- and the file behind it is a greyscale EVA-01 illustration he had saved
# to his Desktop minutes earlier: `<Desktop>\【哲风壁纸】eva-初号机-动漫.jpg`,
# 3066x2160, 1,425,376 B (that absolute path stays HERE, in a comment the bundler never reads;
# `cli.18` forbids it from reaching client.js). Staged as `eva01-city.jpg`, id `eva01city`.
# The retired entry below is kept in the record rather than in PICKS, because D58 is the
# decision D58's own light-mode measurements were taken on:
#
#   RETIRED light entry: id "ogg3zp", name "Paddy Field / 稻田积云", file
#   `wallhaven-ogg3zp.jpg`, width 2560, credit "wallhaven ogg3zp (user-supplied URL, resized
#   only)", note "Supplied by the user 2026-10-07 by URL as the light art: a bright summer
#   illustration -- a huge sunlit cumulus tower over cobalt sky, green rice paddies in the
#   foreground, telephone poles and their wires on the right, a drainage stream in the lower
#   middle, farmhouses and wooded hills on the horizon, and a small Totoro-like figure in the
#   field; artist credit \"STEPHEN NJOTO\" with a red seal at the lower left. Ships at
#   2560x1593 (`resampled=down` from a 5047x3140 source; never upscaled) as WEBP, with NO tone
#   curve. Far brighter than the photograph it replaced (encoded mean luminance 156.2 against
#   6l2rgq's 82.9), so the light slot's contrast headroom improved at the same unchanged 0.35
#   veil -- but its detail cost 314 KB of inlined data URL against the photograph's 61 KB."
#   -- see D58 in docs/design.md.
#
# RETIRED (2026-10-07, D60): the original dark default was the generated `eva-dark-ai.png`
# (id `yqmlmx`, name "Blue Frame / 蓝底橙框", width 2560, credit
# "AI-generated (user-directed) derivative of wallhaven yqmlmx"). The user replaced only
# the dark slot with his attached red-black Evangelion: 3.33 art; the original remains in
# `out/wallpaper-src/` and can be restored by moving both PICKS tables back together.
#
# Every retired source stays in `out/wallpaper-src/`, so reverting to any of them is one line
# in PICKS plus the matching line in tools/s3-veil-budget.py.
PICKS = [
    {
        "id": "eva01city", "mode": "light", "role": "default",
        "name": "Unit-01 in the Ruins / 废墟中的初号机",
        "file": "eva01-city.jpg", "width": 2560,
        "credit": "user-supplied original (哲风壁纸), resized only",
        # The user handed the image itself over in the chat, so there is no page to link.
        # This field must stay free of machine-specific markers (`cli.18` forbids the home
        # path, and even the account name, from reaching the bundle) -- the exact Desktop
        # file the user attached is therefore recorded in the RETIRED/D59 comment above
        # instead of here, and is reproduced in docs/design.md's D59 row.
        "page": "no public page -- the user attached the file itself "
                "(哲风壁纸 / eva-初号机-动漫.jpg, 2026-10-07)",
        "note": "The user's own file, supplied 2026-10-07 as the LIGHT art (「将EVA主题亮色模式下"
                "的壁纸换成这张」 with the image attached). A near-monochrome manga-style "
                "illustration: EVA Unit-01 crouched in a ruined city, its armour rendered in "
                "cold grey screentone with a single scarlet-grey helmet crest, cables rising "
                "off its shoulders, blanked-out tower blocks and drifting debris on both "
                "sides, a dark cloud bank at its feet, and the 「EVA 1」 shoulder pylon legible "
                "over the right shoulder. Maximum channel spread over an 80x80 downsample is "
                "13/255, i.e. greyscale with a faint warm cast, so the light slot's ink (dark) "
                "and this art's own value range sit at the SAME end. Ships at 2560x1804 "
                "(`resampled=down` from a 3066x2160 source; never upscaled) as WEBP, with NO "
                "tone curve -- an illustration is never re-levelled to fit a budget. Encoded "
                "mean luminance 82.7, back to the dark end of the range this slot has seen "
                "(the retired AI poster measured 208.4, the 6l2rgq photograph 82.9, the ogg3zp "
                "illustration 156.2), so the light-mode contrast situation regresses to roughly "
                "the D57 level. The alpha is NOT touched to compensate -- same policy as D48, "
                "D57 and D58.",
    },
    {
        "id": "og33jl", "mode": "dark", "role": "default",
        "name": "Evangelion: 3.33 / 红黑初号机",
        "file": "wallhaven-og33jl.png", "width": 2560,
        "credit": "wallhaven og33jl (user-supplied original, resized only)",
        "note": "The user's own dark-mode art, supplied 2026-10-07 with the instruction "
                "「将这张照片设置为暗色模式的壁纸」. A nearly black Evangelion: 3.33 "
                "composition with a red Unit-01 figure, white glowing eyes, sparse yellow "
                "sparks, and the film title above the head. Ships at the source width "
                "2560x1440 with NO tone curve and is never upscaled. The dark slot keeps "
                "probe=p95 because its light ink fails first on the brightest art pixels. "
                "The alpha is NOT changed to compensate: this decision changes the named "
                "wallpaper only.",
    },
]


def linearise(value: float) -> float:
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def mean_luminance(image: Image.Image) -> float:
    """Encoded-space mean, 0..255 -- the number a person reads off a file."""
    small = image.convert("RGB")
    small.thumbnail((320, 320))
    pixels = (list(small.get_flattened_data()) if hasattr(small, "get_flattened_data")
              else list(small.getdata()))
    return round(sum((r + g + b) / 3.0 for r, g, b in pixels) / len(pixels), 1)


def wallhaven_page(wall_id: str) -> tuple[str, str]:
    """The image's own wallhaven page and direct URL, best effort.

    Recorded for attribution rather than loaded, so a failed lookup must not fail
    the build: the image itself is already on disk.
    """
    page = f"https://wallhaven.cc/w/{wall_id}"
    for ext in ("jpg", "png"):
        direct = f"https://w.wallhaven.cc/full/{wall_id[:2]}/wallhaven-{wall_id}.{ext}"
        if (SRC / f"{wall_id}.{ext}").exists():
            return page, direct
    try:
        request = urllib.request.Request(f"https://wallhaven.cc/api/v1/w/{wall_id}", headers=HDRS)
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read())
        data = payload.get("data", {})
        return data.get("url", page), data.get("path", page)
    except Exception:  # noqa: BLE001 - attribution is not worth a failed build
        return page, page


def build_one(pick: dict) -> dict:
    path = SRC / pick["file"]
    if not path.exists():
        raise FileNotFoundError(f"{path} -- run tools/s2-previews.py to cache the sources first")
    art = Image.open(path)
    art.load()
    native = art.width
    width = min(pick["width"], native)
    ship = art.convert("RGB").resize((width, round(art.height * width / art.width)), Image.LANCZOS)

    tone = pick.get("tone")
    if tone is not None:
        ship = ship.point(
            lambda v: max(0.0, min(255.0, tone["black"] * 255.0 + tone["slope"] * v)))

    buffer = io.BytesIO()
    ship.save(buffer, "WEBP", quality=WEBP_QUALITY, method=5)
    webp = buffer.getvalue()
    data_url = "data:image/webp;base64," + base64.b64encode(webp).decode("ascii")

    # A pick that is not a wallhaven image states its own attribution instead of
    # being run through the wallhaven lookup -- deriving `https://wallhaven.cc/w/<id>`
    # from a non-wallhaven id would print a working-looking URL for somebody else's
    # page, and the API probe would burn a timeout to fail. Added 2026-10-07 (D59)
    # for the first light source that has no wallhaven id at all.
    if "page" in pick:
        page = pick["page"]
        direct = pick.get("direct", page)
    else:
        page, direct = wallhaven_page(pick["id"])
    return {
        "id": pick["id"],
        "name": pick["name"],
        "mode": pick["mode"],
        "role": pick["role"],
        "page": page,
        "direct": direct,
        "credit": pick["credit"],
        "note": pick["note"],
        "sourceResolution": f"{art.width}x{art.height}",
        "shippedResolution": f"{ship.width}x{ship.height}",
        "resampled": "down" if width < native else "none",
        "sourceBytes": path.stat().st_size,
        "webpBytes": len(webp),
        "dataUrlBytes": len(data_url),
        "meanLuminance": mean_luminance(ship),
        "toneCurve": pick.get("tone"),
        "dataUrl": data_url,
    }


def main() -> int:
    rows = [build_one(pick) for pick in PICKS]
    payload = json.dumps(rows, ensure_ascii=False, indent=1)

    if "--check" in sys.argv:
        path = BUILD / "wallpapers.json"
        if not path.exists():
            print("build/wallpapers.json missing -- run without --check first")
            return 1
        stored = json.loads(path.read_text(encoding="utf-8"))
        fresh = {r["id"]: r for r in rows}
        old = {r["id"]: r for r in stored}
        problems = []
        if set(fresh) != set(old):
            problems.append(f"id set differs: {sorted(set(fresh) ^ set(old))}")
        for key in set(fresh) & set(old):
            for field in ("shippedResolution", "webpBytes", "dataUrlBytes", "meanLuminance", "toneCurve"):
                if fresh[key][field] != old[key][field]:
                    problems.append(f"{key}.{field}: {old[key][field]} -> {fresh[key][field]}")
        if problems:
            print("wallpapers.json is STALE:")
            for line in problems:
                print(f"  {line}")
            return 1
        print(f"wallpapers.json check: OK ({len(old)} images)")
        return 0

    BUILD.mkdir(parents=True, exist_ok=True)
    (BUILD / "wallpapers.json").write_text(payload, encoding="utf-8")
    for row in rows:
        print(f"  {row['mode']:<6}{row['id']:<9}{row['sourceResolution']:>11} -> "
              f"{row['shippedResolution']:<11}{row['resampled']:<6}"
              f"webp {row['webpBytes'] / 1024:7.0f} KB  "
              f"dataURL {row['dataUrlBytes'] / 1024:7.0f} KB  "
              f"meanLum {row['meanLuminance']}")
    total = sum(r["dataUrlBytes"] for r in rows)
    print(f"\nwrote build/wallpapers.json  ({total / 1024:.0f} KB of data URLs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
