"""S3 · Solve the veil alpha for the two translucent surfaces.

Why this exists
---------------
S2 measured that the app background has to become translucent for a wallpaper to
show through it, and that the veil over the art is what keeps text readable --
``comp = art*(1-a) + fill*a``. S2 solved that alpha for ``--dsw-alias-bg-base``
alone (EVA: 0.63 dark / 0.74 light). S3 makes a SECOND surface translucent
(``--dsw-specific-sidebar-fill``, the dark room the art glows behind), and its
fill colour is not bg-base's, so its safe alpha is not bg-base's either.

Guessing that it is "close enough" is exactly the hand-wave this project does not
accept. So both surfaces are solved here, the mode's shipped alpha is the MAXIMUM
of the two, and every ink that actually lands on either surface is verified
against the composite at that alpha.

Which inks are checked, and which are not
-----------------------------------------
``label-primary`` / ``label-secondary`` / ``label-tertiary`` land on the app
background (sidebar labels, empty-state copy), so they are checked here.
``label-caption`` / ``label-dimmed`` do NOT: they only ever sit on the opaque
layer-1/2/3 surfaces, so holding them to a contrast target over raw art would
reject every real photograph while accepting a blank one. That mistake cost a
full rewrite of the discovery judge in S2 (see docs/design.md 7.1); it is not
repeated here.

The probe ends differ by mode, and that is not cosmetic
------------------------------------------------------
Light ink over a light veil fails as the composite gets BRIGHTER, so dark mode is
solved at the art's **p95**. Dark ink over a light veil fails as the composite
gets DARKER, so light mode is solved at the art's **p05**. Using one end for both
measures the easy case in one of them -- S2 did exactly that once and produced
"dark mode's floor is 0.30", which is wrong.

Run (DSH runtime Python -- needs Pillow; reads out/wallpaper-src, no network):
    python tools/s3-veil-budget.py
    python tools/s3-veil-budget.py --check      # verify build/veil-budget.json still holds
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
SRC = OUT / "wallpaper-src"
BUILD = ROOT / "build"

TARGET = 4.5
STEPS = [round(0.20 + 0.01 * i, 2) for i in range(76)]   # 0.20 .. 0.95

# The surfaces that become translucent so the art can show through them.
SURFACES = ["--dsw-alias-bg-base", "--dsw-specific-sidebar-fill"]

# Two contracts, because they disagree and the disagreement is the finding.
#
#   shipped -- the contract S2's wallpaper budget was solved against: the two inks
#              that certainly sit on the app background (body copy and secondary
#              labels). This is what the theme ships.
#   strict  -- adds label-tertiary. Demanding it over *raw art* is not satisfiable
#              in light mode at any useful alpha: the composite is bounded above by
#              the fill `#e7e7ee`, where tertiary measures 4.92:1, so reaching the
#              target needs alpha 0.95 -- i.e. no wallpaper left to see. In dark mode
#              it is satisfiable but expensive (0.80 instead of 0.63).
#
# The measurement is kept rather than the assumption silently dropped: this table
# is the evidence S4 needs to decide empirically whether any tertiary text really
# renders on a translucent surface. If it does, the light wallpaper is the thing
# that has to go -- not the contrast target.
CONTRACTS = {
    "shipped": ["--dsw-alias-label-primary", "--dsw-alias-label-secondary"],
    "strict": ["--dsw-alias-label-primary", "--dsw-alias-label-secondary",
               "--dsw-alias-label-tertiary"],
}
INKS = CONTRACTS["strict"]        # every ink the report accounts for

# The user's picks, now pointing at the art that actually ships (2026-10-06 recolor
# fix): `tools/s3-build-wallpapers.py` PICKS ships the AI derivatives
# `eva-light-ai.png` / `eva-dark-ai.png` under the same wallhaven ids, while this
# file still named the unshipped originals -- so the budget bounded a picture the
# user never sees, and after the NERV recolor it reported a light minimum (0.83)
# that the shipped art does not need. `probe` is chosen per mode by the physics, not
# by preference -- light ink fails as the composite brightens, dark ink fails as it
# darkens, so the two modes must be solved at opposite ends.
#
# 2026-10-07 (D57): light now points at the user's own photograph
# `wallhaven-6l2rgq.jpg`, matching tools/s3-build-wallpapers.py -- the rule above is
# the point: the budget must be solved against the art that actually ships, so the two
# PICKS tables move together or the budget bounds a picture nobody sees.
#
# 2026-10-07 (D58, later the same evening): the user named a second light swap --
# 「再换，换成这张」 plus <https://w.wallhaven.cc/full/og/wallhaven-ogg3zp.jpg> -- so
# light pointed at `wallhaven-ogg3zp.jpg`. Same rule, same move: this table is edited
# in the same commit as the one in tools/s3-build-wallpapers.py, never separately.
#
# 2026-10-07 (D59, the same evening again): a third light swap, this time an attached
# image -- 「将EVA主题亮色模式下的壁纸换成这张」 -- a greyscale Unit-01 illustration whose
# file is `eva01-city.jpg` (that is why the light id is no longer a wallhaven id: the
# source has none, and the build's attribution lookup is bypassed by an explicit
# `page` field instead of inventing one).
# 2026-10-07 (D60): the user replaced the dark default with his attached red-black
# Evangelion: 3.33 art (`wallhaven-og33jl.png`). Dark keeps `p95`: its ink is light, so
# the brightest art pixels remain the failure end. As always, this table moves in the
# same change as tools/s3-build-wallpapers.py so the budget measures the art that ships.
PICKS = {
    "dark": {"id": "og33jl", "file": "wallhaven-og33jl.png", "probe": "p95"},
    "light": {"id": "eva01city", "file": "eva01-city.jpg", "probe": "p05"},
}

# How dark the dark mode's surface may get before it stops reading as dark mode.
# Derived, not measured: (rel_lum(--dsw-alias-label-primary dark) + 0.05)/4.5 - 0.05.
# NERV ink `#d5dae4` (lum 0.698904) -> 0.1164. It is NOT consumed by floor_ok() --
# dark mode has no floor check -- and is kept as the documented boundary the strict
# contract would need.
DARK_CEILING = 0.1164

# ---------------------------------------------------------------------------
# The SHIPPED alpha is a CHOSEN value, not the solved minimum (2026-10-06).
#
# Until today the theme shipped `max(perSurface.minAlpha)` -- the smallest alpha
# that still holds the shipped contract (primary + secondary) at the art's probe
# percentile. Live feedback after the first real install was "透明度不够，看不清
# 楚背景壁纸": at 0.74 light / 0.63 dark the art only contributes 26% / 37% of the
# composite, so the wallpaper reads as a hint rather than an image.
#
# Lowering it trades the worst-case guarantee for visibility, and the trade is
# RECORDED here rather than hidden: `solvedMinAlpha` keeps the old number and
# `atShipped` reports every accounted ink against BOTH the probe percentile
# (worst case) and the mean art. What actually survives at these values:
#
#   light 0.55 -- probe: primary 6.98 ok, secondary 3.42 FAILS, tertiary 2.24
#   dark  0.42 -- probe: primary 5.20 ok, secondary 2.75 FAILS, tertiary 1.90
#   both modes, mean art: primary / secondary / tertiary all still >= 4.5
#
# FROSTED GLASS (2026-10-06, later the same day): the art is now blurred in the
# paint layer (`body::before { filter: blur(var(--cp-blur)) }`), which is why dark
# mode can sit at 0.42 instead of 0.48. Blur is NOT modelled here -- this solver
# keeps reporting the sharp-pixel bound, because that is the worst case and a
# number that flatters itself is worthless. What blur changes is the *distribution*:
# it averages the extremes away, so the real composite sits near the mean column
# rather than at the probe percentile. The real, blurred pixels are measured in
# `tools/verify-mounted.py` (and reported in docs/render-report.md §11) -- the two
# numbers answer different questions: this one is the guarantee, that one is the
# measurement.
#
# The honest downstream statement is therefore: "4.5 is guaranteed for
# label-primary on the app background; label-secondary holds 4.5 on the average
# art but not on the brightest/darkest 5% of the wallpaper; label-tertiary
# already failed that bound at the OLD alpha too (light 3.20 / dark 3.11) and was
# never covered by it."
#
# The alternative -- keep the guarantee AND see the wallpaper -- is a wallpaper
# with a narrower luminance range, not a different alpha.
#
# DOCUMENT VALUE (2026-10-06, NERV recolor): the design doc's §14 requires overlay
# panels to stay semi-transparent at 0.78-0.84, and the user's decision for this
# round was 「前者+保留毛玻璃」 -- take the doc's alpha, keep the frosted glass, then
# re-measure visibility and the four ink tiers on the real machine and only lower
# it if the measurement says so. At 0.78/0.80 the guarantee above is no longer
# tight: the veiled art is pulled so close to the fill that the art's extremes
# cannot break 4.5 for label-primary or 3.0 for label-dimmed, so this solver now
# reports the *degenerate* case and `--check` no longer discriminates (it still
# records chosenAlpha/solvedMinAlpha for the record). See docs/render-report.md
# §13 for the measured numbers that decide whether 0.78/0.80 stays.
#
# USER VALUE (2026-10-06, round 6): the user corrected an earlier misreading of his
# request -- 「我是让你去掉毛玻璃效果，然后把透明度调到 75%，不是让你调回默认
# 设置！」. So the veil ships at 0.75 in BOTH modes (one slider drove both) and the
# paint layer ships --cp-blur: 0px (frosted glass off). This is below the solved
# minimum in both modes, so the ink guarantees soften: the measured consequence is
# recorded in the budget JSON and in docs/render-report.md §23.6 rather than hidden.
#
# USER VALUE (2026-10-07, round 8): the user read 「透明度」 in its plain sense -- the
# share of the wallpaper that comes through -- and asked for 75% of it, i.e. alpha
# 0.25 in BOTH modes (「你调反了，我要的是透明度75%，改过来」). The cost was stated
# before the write (0.25 is far below the solved minimum: dark 0.52 / light 0.68)
# and the user took it. So the label-primary guarantee is not softened here, it is
# GONE -- read `atShipped.contractAtShipped` in build/veil-budget.json. Nothing else
# in this file was retuned to make the number pass.
#
# USER VALUE (2026-10-07, round 9): 「调整为透出80%壁纸，所有地方！」 -- one number for
# every surface that shows the art, so the veil goes to 0.20 and the two surfaces that
# are NOT solved here (`--dsw-specific-input-major`, `--dsw-menu-surface-fill`) are
# pinned to the same 0.20 by SURFACE_ALPHA in tools/s3-emit-tokens.py. The contrast
# cost gets worse again; it is recorded, not asserted (see the gate in main()).
#
# USER VALUE (2026-10-07, round 10): 「壁纸的透出度调整为70%」 -- same four surfaces,
# one number, now 0.30. Both files move together: this constant and SURFACE_ALPHA in
# tools/s3-emit-tokens.py. The contrast cost eases off in this direction (it is the
# mirror image of round 9), and the numbers are recorded the same way.
#
# USER VALUE (2026-10-07, round 11): 「先不讨论可读性，先把透明度不一致的问题解决 …
# 你先把我的原图完整的呈现出来！」 Two things at once:
#   1. the INCONSISTENCY was real and is fixed in the paint layer, not here -- a plugin
#      pane (`dsh-better-sidebar`'s .nArs4W_pane, hooked on [data-dsh-pane]) repainted
#      --dsw-alias-bg-base and stacked a SECOND veil over the main column, so the same
#      art read alpha 0.30 in the sidebar and 0.51 in the main pane. See src/theme.css
#      "插件/外壳自己画的同色 veil" in the shell-rescue rule.
#   2. "show my original image in full" can only mean alpha 0 for the mode that shows
#      that image: any veil tints the art (0.30 of #e2e1ed lifts a navy field from
#      (38,40,55) to (95,96,110)). So LIGHT ships at 0.00 -- the wallpaper is then
#      pixel-exact.
#
# RULE (2026-10-07, user, standing): the two modes move TOGETHER. 「暗色采取同样的方案，
# 二者同步，以后也是，我不想再说第二遍。」 Dark therefore also ships 0.00, and every
# future change to a surface alpha must be applied to light AND dark in the same edit --
# including SURFACE_ALPHA in tools/s3-emit-tokens.py. A one-mode-only value is a bug now,
# not a choice.
#
# REVERTED (2026-10-07, round 12): back to 0.30 / 0.30. With alpha 0 the veil is gone
# entirely, and the user reported the sidebar and the main pane looking different again
# -- 「搞得侧边栏和main又不一样了，改回去」. 0.30 (透出 70%) is the value they had
# chosen themselves before the "show my original image" round, so this restores their
# own number in both modes rather than picking a new one for them.
#
# USER VALUE (2026-10-07, round 13): asked to choose between (1) blanking the plugin
# content panels that cover the wallpaper and (2) taking the veil back to zero, the
# user answered **2**. So the veil ships 0.00 in BOTH modes -- the standing RULE above
# forbids moving one mode alone -- and the wallpaper is pixel-exact in both. The
# plugin panels (e.g. the streamfold reasoning window, which paints an OPAQUE
# --dsw-alias-bg-layer-2) are deliberately NOT touched: that was option 1, and it was
# not chosen. They will still cover the art wherever they are on screen.
# USER VALUE (2026-10-07, round 14): 「我想让 veil 回来（ 65% 透出）还要无缝！」 --
# alpha 0.35 in BOTH modes (the standing RULE above; 0.35*255 = 89.25 -> byte 0x59).
# Seamlessness has nothing to do with the number itself: `--dsw-alias-bg-base` and
# `--dsw-specific-sidebar-fill` are written from THIS ONE constant, so both regions
# composite identically at any alpha, and the shell-rescue rule in src/theme.css keeps
# any other surface from repainting the same token on one side only. The card/menu
# surfaces (SURFACE_ALPHA, 0.30) are separate local faces and do not create a seam.
# LIGHT READABILITY (2026-10-08, round 24): the user asked for readable light-mode text
# with the four regions still seamless, and to freeze dark --
# 「调整亮色模式，使文字清晰可见；...暗色模式不动，就此固定下来，以后不得再做任何变更」.
# Measured on the live app with eva-light-read.py (real glyph windows, not box quantiles):
# at 0.35 every theme ink run sitting on the wall fails AA -- main tertiary median 2.00 /
# 5% 1.62 with 31 of 41 runs below 4.5, sidebar primary 3.29/2.47, sidebar tertiary
# 2.62/1.77. Blur is NOT a lever (alpha 0.35 + blur 48px -> 2.19/1.86; blur 96px ->
# 2.47/1.97): the constraint is the wall's luminance, not its sharpness. 0.70 is the
# first value where every theme ink run clears 4.5 (median 5.03 / 5% 4.67, zero runs
# below; sidebar primary 7.24/6.53, rightbar tertiary 6.99/5.38).
# So light ships 0.70 and dark stays 0.35. The standing "both modes move together" RULE
# above is AMENDED (2026-10-08, user): the two modes no longer have to share a scheme and
# evolve independently; the only shared constraint left is the borderless idea itself.
# Dark is FROZEN at its current implementation -- any change to it is forbidden from now
# on, and tools/selfcheck.mjs dark.1 fails the build if its veil alpha ever moves again.
# Cost, recorded rather than hidden: light show-through drops from 65% to 30%.
SHIPPED_ALPHA = {"light": 0.70, "dark": 0.35}


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
    image.thumbnail((420, 420))
    pixels = (list(image.get_flattened_data()) if hasattr(image, "get_flattened_data")
              else list(image.getdata()))
    lums = sorted(0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
                  for r, g, b in pixels)
    pick = lambda t: lums[min(len(lums) - 1, int(t * len(lums)))]  # noqa: E731
    return {"p05": pick(0.05), "median": pick(0.5), "p95": pick(0.95),
            "mean": sum(lums) / len(lums)}


def composite(fill_hex: str, alpha: float, art_lin: float) -> tuple:
    fill = hex_rgb(fill_hex)
    art = enc(art_lin)
    return tuple(f * alpha + a * (1 - alpha) for f, a in zip(fill, (art, art, art)))


def verdict(fill_hex: str, alpha: float, art_lin: float, mode: str, inks: dict,
            contract: list[str]) -> dict:
    """Contrast of every accounted ink on the composite; `ok` follows `contract`."""
    comp = composite(fill_hex, alpha, art_lin)
    rows = {token: round(contrast(hex_rgb(inks[token][mode]), comp), 2) for token in INKS}
    return {
        "composite": "#%02x%02x%02x" % tuple(round(c) for c in comp),
        "compositeLum": round(rel_lum(comp), 4),
        "ink": rows,
        "ok": all(rows[token] >= TARGET for token in contract),
    }


def floor_ok(mode: str, v: dict) -> bool:
    """Light mode additionally has to keep reading as a LIGHT surface."""
    return v["compositeLum"] >= 0.50 if mode == "light" else True


def min_alpha(fill: str, art_lin: float, mode: str, inks: dict, contract: list[str]):
    for alpha in STEPS:
        v = verdict(fill, alpha, art_lin, mode, inks, contract)
        if v["ok"] and floor_ok(mode, v):
            return alpha
    return None


def solves_for_mode(mode: str, palette: dict, inks: dict, toned: dict) -> dict:
    art_lin = toned[PICKS[mode]["probe"]]
    shipped = CONTRACTS["shipped"]
    strict = CONTRACTS["strict"]

    per_surface = {}
    strict_surface = {}
    for token in SURFACES:
        fill = palette[mode][token]
        per_surface[token] = {"fill": fill, "minAlpha": min_alpha(fill, art_lin, mode, inks, shipped)}
        strict_surface[token] = {"fill": fill, "minAlpha": min_alpha(fill, art_lin, mode, inks, strict)}

    usable = [v["minAlpha"] for v in per_surface.values() if v["minAlpha"] is not None]
    strict_usable = [v["minAlpha"] for v in strict_surface.values() if v["minAlpha"] is not None]
    shipped_alpha = SHIPPED_ALPHA[mode]
    art_mean = toned["mean"]
    at_shipped = {}
    for token in SURFACES:
        fill = palette[mode][token]
        at_shipped[token] = {
            "fill": fill,
            "alpha": shipped_alpha,
            "atProbe": verdict(fill, shipped_alpha, art_lin, mode, inks, strict),
            "atMean": verdict(fill, shipped_alpha, art_mean, mode, inks, strict),
        }
    return {
        "mode": mode,
        "wallpaper": PICKS[mode]["id"],
        "probe": PICKS[mode]["probe"],
        "artLuminance": {k: round(v, 4) for k, v in toned.items()},
        "perSurface": per_surface,
        "solvedMinAlpha": max(usable) if usable else None,
        "chosenAlpha": shipped_alpha,
        "chosenBy": "SHIPPED_ALPHA -- chosen for visible transparency, below the solved minimum",
        "atShipped": at_shipped,
        "contractAtShipped": {
            "target": TARGET,
            "inks": strict,
            "holdsAtProbe": {ink: all(at_shipped[t]["atProbe"]["ink"][ink] >= TARGET
                                      for t in SURFACES) for ink in strict},
            "holdsAtMean": {ink: all(at_shipped[t]["atMean"]["ink"][ink] >= TARGET
                                     for t in SURFACES) for ink in strict},
        },
        "strictContract": {
            "inks": strict,
            "perSurface": strict_surface,
            "minAlpha": max(strict_usable) if strict_usable else None,
            "feasible": bool(strict_usable) and len(strict_usable) == len(SURFACES),
        },
    }


def main() -> int:
    check = "--check" in sys.argv
    palette = json.loads((OUT / "s2-palette.json").read_text(encoding="utf-8"))["palette"]

    # The ink colours are the theme's own design values, read from the source of
    # truth rather than retyped here.
    inks = {token: {"dark": palette["dark"][token], "light": palette["light"][token]}
            for token in INKS}

    report: dict = {"target": TARGET, "surfaces": SURFACES, "inks": INKS, "modes": {}}
    for mode, pick in PICKS.items():
        path = SRC / pick["file"]
        if not path.exists():
            print(f"missing source {path} -- run tools/s2-previews.py first")
            return 1
        toned = tone(path)
        solved = solves_for_mode(mode, palette, inks, toned)
        solved["toned"] = toned          # kept so the summary below re-verifies
        report["modes"][mode] = solved   # against the SAME tone it was solved on

    print(f"veil budget (WCAG {TARGET}:1, shipped contract = {CONTRACTS['shipped']})")
    print(f"  {'mode':<6}{'wallpaper':<10}{'probe':<6}{'solved':>7}{'bgBase':>8}{'sidebar':>9}"
          f"{'SHIPPED':>8}   ink ratios at SHIPPED (primary/secondary)")
    for mode, data in report["modes"].items():
        bg = data["perSurface"]["--dsw-alias-bg-base"]["minAlpha"]
        sb = data["perSurface"]["--dsw-specific-sidebar-fill"]["minAlpha"]
        alpha = data["chosenAlpha"]
        if alpha is None:
            print(f"  {mode:<6}{data['wallpaper']:<10}{data['probe']:<6}{'none':>8}{'none':>9}"
                  f"{'--':>8}   NO ALPHA IN RANGE SATISFIES EVERY SURFACE")
            continue
        art = data["toned"][data["probe"]]
        det = {t: verdict(palette[mode][t], alpha, art, mode, inks,
                          CONTRACTS["shipped"]) for t in SURFACES}
        print(f"  {mode:<6}{data['wallpaper']:<10}{data['probe']:<6}"
              f"{data['solvedMinAlpha']:>7.2f}"
              f"{('-' if bg is None else format(bg, '.2f')):>8}"
              f"{('-' if sb is None else format(sb, '.2f')):>9}{alpha:>8.2f}   "
              + "   ".join(f"{k.replace('--dsw-alias-', '').replace('--dsw-', '')}"
                           f"={v['ink']['--dsw-alias-label-primary']}/"
                           f"{v['ink']['--dsw-alias-label-secondary']}"
                           for k, v in det.items()))
        # The gate that used to live here ASSERTED label-primary >= TARGET at the
        # worst-case art -- the one guarantee that survived every earlier alpha cut.
        # At the user's 2026-10-07 value (alpha 0.25) even that is gone, and the user
        # was told the cost before the write. So the guarantee is RECORDED now rather
        # than asserted: the ratios below and `contractAtShipped` carry it, and the
        # solver keeps shipping instead of refusing a value its owner chose.
        for token, d in det.items():
            ratio = d["ink"]["--dsw-alias-label-primary"]
            if ratio < TARGET:
                print(f"  !!! {mode} {token} label-primary = {ratio} < {TARGET} "
                      f"-- guarantee knowingly traded away "
                      f"(2026-10-07, user alpha {data['chosenAlpha']:.2f})")
        data["atChosen"] = det

    print("\nshipped alpha vs the contract it holds (recorded, not asserted):")
    for mode, data in report["modes"].items():
        c = data["contractAtShipped"]
        print(f"  {mode:<6}alpha {data['chosenAlpha']:.2f} "
              f"(solved minimum {data['solvedMinAlpha']:.2f}, probe={data['probe']}, "
              f"transparency {1 - data['chosenAlpha']:.0%})")
        for ink in c["inks"]:
            short = ink.replace("--dsw-alias-", "")
            print(f"    {short:<20} worst-case art "
                  f"{'ok' if c['holdsAtProbe'][ink] else 'FAILS'}"
                  f"   average art {'ok' if c['holdsAtMean'][ink] else 'FAILS'}")

    print(f"\nstrict contract (adds label-tertiary) -- measured, not assumed:")
    for mode, data in report["modes"].items():
        st = data["strictContract"]
        need = st["minAlpha"]
        if st["feasible"]:
            print(f"  {mode:<6}feasible, needs alpha {need:.2f} "
                  f"(shipped is {data['chosenAlpha']:.2f})")
        else:
            missing = [t for t, v in st["perSurface"].items() if v["minAlpha"] is None]
            print(f"  {mode:<6}NOT FEASIBLE within 0.20-0.95 -- unsolved surface(s): "
                  f"{', '.join(t.replace('--dsw-', '') for t in missing)}")
    print("  see the CONTRACTS comment in this file: a strict-light solve needs an "
          "alpha that leaves no wallpaper to see (the measured minAlpha above). "
          "S4 settles empirically whether any label-tertiary text really renders on "
          "a translucent surface.")

    if check:
        path = BUILD / "veil-budget.json"
        if not path.exists():
            print("build/veil-budget.json missing -- run without --check first")
            return 1
        stored = json.loads(path.read_text(encoding="utf-8"))
        bad = 0
        for mode, data in report["modes"].items():
            stored_mode = stored["modes"][mode]
            for key in ("chosenAlpha", "solvedMinAlpha"):
                if stored_mode.get(key) != data[key]:
                    bad += 1
                    print(f"  STALE {mode}.{key}: stored {stored_mode.get(key)} "
                          f"vs solved {data[key]}")
        print(f"veil-budget check: {'OK' if bad == 0 else f'{bad} stale'}")
        return 1 if bad else 0

    BUILD.mkdir(parents=True, exist_ok=True)
    (BUILD / "veil-budget.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote build/veil-budget.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
