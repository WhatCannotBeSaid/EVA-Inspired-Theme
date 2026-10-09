#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S6 · verify the theme in its MOUNTED state (read-only).

Why this tool exists
--------------------
Once the plugin is installed, `tools/verify-render.py`'s four-state comparison is
no longer available: its "official" leg would render the theme too, because the
theme is loaded at boot by the host. What replaces it is a measurement of the ONE
state that now exists -- the mounted theme -- plus the registration evidence that
S4 explicitly could not produce.

It injects nothing, changes nothing, and reuses verify-render.py's samplers
(`JS_STATE`, `JS_REGION`, `REGIONS`, `modal_colour`, `sample_inks`) so the two
tools cannot drift apart.

Run (system Python 3.14 -- playwright + Pillow):
    python tools/verify-mounted.py light
    python tools/verify-mounted.py dark
"""

from __future__ import annotations

import importlib.util
import json
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_baseline_lib import open_page, VIEWPORT  # noqa: E402

from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUTDIR = Path(r"<plugins>\tmp\EVA-Inspired-Theme-render")
PLUGIN_ID = "EVA-Inspired-Theme"

spec = importlib.util.spec_from_file_location("verify_render", ROOT / "tools" / "verify-render.py")
vr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vr)

TOKENS = json.loads((ROOT / "src" / "tokens.json").read_text(encoding="utf-8"))["tokens"]
VEIL_TOKENS = ("--dsw-alias-bg-base", "--dsw-specific-sidebar-fill")

JS_STYLES = r"""
() => Array.from(document.querySelectorAll('style[data-plugin]')).map((s) => ({
  plugin: s.getAttribute('data-plugin'), chars: (s.textContent || '').length,
}))
"""

# The art and the veil are two fixed pseudo-elements now, so the interesting
# computed values live on `body::before` / `body::after` -- not on body itself.
JS_PSEUDO = r"""
() => {
  const read = (which) => {
    const cs = getComputedStyle(document.body, which)
    return {
      content: cs.content, position: cs.position, inset: cs.inset, zIndex: cs.zIndex,
      filter: cs.filter, pointerEvents: cs.pointerEvents,
      backgroundImage: cs.backgroundImage === 'none' ? 'none' : 'yes',
      backgroundSize: cs.backgroundSize, backgroundAttachment: cs.backgroundAttachment,
    }
  }
  const bs = getComputedStyle(document.body)
  return {
    before: read('::before'),
    after: read('::after'),
    bodyBackgroundImage: bs.backgroundImage,
    bodyBackgroundColor: bs.backgroundColor,
    blur: bs.getPropertyValue('--cp-blur').trim(),
    blurLight: bs.getPropertyValue('--cp-blur-light').trim(),
    blurDark: bs.getPropertyValue('--cp-blur-dark').trim(),
  }
}
"""


def alpha_of(value: str):
    """('e7e7ee8c') -> 0.549, for the two tokens that ship an alpha byte."""
    text = (value or "").lstrip("#")
    if len(text) != 8:
        return None
    return round(int(text[6:8], 16) / 255.0, 4)


def clamped(rect):
    x = max(0, int(rect["x"]))
    y = max(0, int(rect["y"]))
    width = min(int(rect["width"]), VIEWPORT["width"] - x)
    height = min(int(rect["height"]), VIEWPORT["height"] - y)
    return {"x": x, "y": y, "width": max(1, width), "height": max(1, height)}


def veil_reading(page, mode: str, fill_hex: str, alpha: float) -> dict:
    """How much art actually shows: per-tile modal colours over a quiet area."""
    box = {"x": 430, "y": 640, "width": 520, "height": 220}
    png = page.screenshot(clip=box)
    (OUTDIR / f"mounted-{mode}-veil.png").write_bytes(png)
    image = Image.open(BytesIO(png)).convert("RGB")
    tiles = []
    for ty in range(0, image.height - 19, 20):
        for tx in range(0, image.width - 19, 20):
            tile = image.crop((tx, ty, tx + 20, ty + 20))
            surface, share = vr.modal_colour(_png_of(tile))
            if share >= 0.5:
                tiles.append(surface)
    lums = [vr.rel_lum(t) for t in tiles]
    if not lums:
        return {"tiles": 0}
    fill = vr.parse_rgb(fill_hex)
    arts = []
    for t in tiles:
        arts.append([max(0.0, min(255.0, (t[i] - fill[i] * alpha) / (1 - alpha))) for i in range(3)])
    art_lums = [vr.rel_lum(a) for a in arts]
    return {
        "box": box,
        "tiles": len(tiles),
        "compositeSpreadLum": round(max(lums) - min(lums), 4),
        "compositeMeanLum": round(sum(lums) / len(lums), 4),
        "artLumMin": round(min(art_lums), 4),
        "artLumMax": round(max(art_lums), 4),
        "artLumMean": round(sum(art_lums) / len(art_lums), 4),
        "artSpreadLum": round(max(art_lums) - min(art_lums), 4),
    }


def _png_of(image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "light"
    OUTDIR.mkdir(parents=True, exist_ok=True)
    page = open_page(mode=mode, settle_ms=9000)
    report: dict = {"mode": mode, "pluginId": PLUGIN_ID}
    try:
        styles = page.evaluate(JS_STYLES)
        mine = [s for s in styles if s["plugin"] == PLUGIN_ID]
        report["registration"] = {
            "present": bool(mine),
            "styles": mine,
            "totalPluginStyles": len(styles),
        }
        state = page.evaluate(vr.JS_STATE)
        pseudo = page.evaluate(JS_PSEUDO)
        report["pseudo"] = pseudo
        report["bodyBackground"] = {
            "color": state["bodyBackgroundColor"],
            "kind": state["bodyBackgroundKind"],
            "layers": state["bodyBackgroundLayers"],
            "wall": state["wallVars"]["wall"],
        }
        body_vars = state["bodyVars"]
        mismatch = []
        for token, pair in TOKENS.items():
            actual = body_vars.get(token)
            if actual != pair.get(mode):
                mismatch.append({"token": token, "src": pair.get(mode), "actual": actual})
        report["tokens"] = {
            "declared": len(TOKENS), "checked": len(TOKENS), "mismatch": mismatch,
            "veilAlpha": {t: alpha_of(body_vars.get(t)) for t in VEIL_TOKENS},
        }

        regions = []
        for region in vr.REGIONS:
            selector = None
            collapsed = []
            for candidate in [region["selector"]] + list(region.get("alternates", [])):
                box = page.evaluate(
                    "(s) => { const el = document.querySelector(s); if (!el) return null;"
                    " const r = el.getBoundingClientRect();"
                    " return { w: r.width, h: r.height } }", candidate)
                if box is None:
                    continue
                if box["w"] >= 8 and box["h"] >= 8:
                    selector = candidate
                    break
                # A selector that matches a COLLAPSED element is the exact trap
                # REGIONS documents (dsh-better-sidebar collapses the primary one):
                # measuring it would report that element's own paint as if it were
                # the visible region. Keep looking, and say so if nothing is left.
                collapsed.append("%s=%dx%d" % (candidate, round(box["w"]), round(box["h"])))
            if selector is None:
                regions.append({
                    "name": region["name"], "what": region["what"], "reached": False,
                    "why": ("every candidate matched a collapsed element: " + ", ".join(collapsed))
                           if collapsed else "no selector matched",
                })
                continue
            info = page.evaluate(vr.JS_REGION, selector)
            box = clamped(info["rect"])
            png = page.screenshot(clip=box)
            (OUTDIR / f"mounted-{mode}-region-{region['name']}.png").write_bytes(png)
            surface, share = vr.modal_colour(png)
            ink = vr.parse_rgb(info["color"])
            regions.append({
                "name": region["name"], "what": region["what"], "reached": True,
                "selector": selector, "rect": box,
                "surfaceHex": "#%02x%02x%02x" % surface, "surfaceShare": round(share, 4),
                "inkHex": "#%02x%02x%02x" % ink, "declaredCss": info["backgroundColor"],
                "contrast": round(vr.contrast(ink, surface), 2),
                "cornerShape": info["cornerShape"], "radius": info["borderRadius"],
            })
        report["regions"] = regions

        fill_hex = "#" + TOKENS["--dsw-alias-bg-base"][mode].lstrip("#")[:6]
        alpha = alpha_of(body_vars.get("--dsw-alias-bg-base"))
        if alpha is not None:
            report["veil"] = veil_reading(page, mode, fill_hex, alpha)
        report["veil"]["tokenValue"] = body_vars.get("--dsw-alias-bg-base")
        report["veil"]["fillHex"] = fill_hex
        report["veil"]["alphaFromToken"] = alpha

        ink_results: dict = {"inkSamples": {}}
        vr.sample_inks(page, f"mounted-{mode}", state, ink_results)
        samples = ink_results["inkSamples"].get(f"mounted-{mode}", {})
        ink_rows = []
        for name, rows in sorted(samples.items()):
            reliable = [r for r in rows
                        if (r.get("surfaceShare") or 1) >= 0.4 and (r.get("inkPixelShare") or 1) >= 0.02]
            text = [r for r in reliable if r.get("kind") != "icon"]
            icon = [r for r in reliable if r.get("kind") == "icon"]
            ink_rows.append({
                "ink": name, "target": rows[0]["target"], "found": len(rows),
                "reliable": len(reliable), "text": len(text), "icon": len(icon),
                "worstText": min((r["contrast"] for r in text), default=None),
                "worstIcon": min((r["contrast"] for r in icon), default=None),
                "surfaces": sorted({r["surfaceHex"] for r in reliable}),
                "pass": bool(reliable)
                        and all(r["contrast"] >= rows[0]["target"] for r in text)
                        and all(r["contrast"] >= 3.0 for r in icon),
            })
        report["inks"] = ink_rows
        report["inkMisses"] = [t for t in vr.INK_TOKENS if t not in samples]

        (OUTDIR / f"mounted-{mode}.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

        print(f"=== mounted verify · {mode} ===")
        print(f"  style[data-plugin=\"{PLUGIN_ID}\"] : "
              f"{'YES' if mine else 'NO'}  {json.dumps(mine, ensure_ascii=False)}"
              f"  (of {len(styles)} plugin stylesheets)")
        print(f"  body background : {report['bodyBackground']['color']}  "
              f"kind={report['bodyBackground']['kind']} layers={report['bodyBackground']['layers']}")
        print(f"  ::before (art)  : filter={pseudo['before']['filter']}  inset={pseudo['before']['inset']}  "
              f"z={pseudo['before']['zIndex']}  image={pseudo['before']['backgroundImage']}  "
              f"pos={pseudo['before']['position']}")
        print(f"  ::after (veil)  : image={pseudo['after']['backgroundImage']}  "
              f"inset={pseudo['after']['inset']}  z={pseudo['after']['zIndex']}")
        print(f"  --cp-blur       : {pseudo['blur']}  "
              f"(light {pseudo['blurLight']} / dark {pseudo['blurDark']})")
        print(f"  veil token      : {body_vars.get('--dsw-alias-bg-base')} "
              f"-> alpha {alpha}  (fill {fill_hex})")
        v = report["veil"]
        if v.get("tiles"):
            print(f"  art through veil: tiles={v['tiles']} composite spread {v['compositeSpreadLum']} "
                  f"| implied art L {v['artLumMin']}..{v['artLumMax']} (mean {v['artLumMean']}, "
                  f"spread {v['artSpreadLum']})")
        print(f"  tokens          : {len(TOKENS) - len(mismatch)}/{len(TOKENS)} match src/tokens.json"
              + ("" if not mismatch else f"  MISMATCH {json.dumps(mismatch, ensure_ascii=False)}"))
        print("  region          surface   ink        ratio  share  corner")
        for r in regions:
            if not r["reached"]:
                print(f"  {r['name']:<15} --        --            --     --  UNREACHABLE ({r['why']})")
            else:
                print(f"  {r['name']:<15} {r['surfaceHex']}   {r['inkHex']}  "
                      f"{r['contrast']:>6.2f}  {r['surfaceShare']:<5}  {r['cornerShape']}")
        print("  ink             target  found rel  worstText worstIcon pass  surfaces")
        for r in ink_rows:
            print(f"  {r['ink']:<15} {r['target']:<6}  {r['found']:<4} {r['reliable']:<3}  "
                  f"{str(r['worstText']):<9} {str(r['worstIcon']):<9} "
                  f"{'ok' if r['pass'] else 'FAIL':<5} {','.join(r['surfaces'])}")
        if report["inkMisses"]:
            print(f"  not rendered by any element: {', '.join(report['inkMisses'])}")
        print(f"  wrote {OUTDIR / f'mounted-{mode}.json'}")
        return 0
    finally:
        try:
            page._dsh_pw.stop()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    raise SystemExit(main())
