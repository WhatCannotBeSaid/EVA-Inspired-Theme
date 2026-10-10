"""S3 · Emit `src/tokens.json` -- the token layer's single source of truth.

`client.js` is generated from `src/tokens.json`, so that file is what the build
reads and what a reviewer audits. It is itself emitted here rather than retyped,
so its values cannot drift from the palette that was measured in S2.

Three inputs, no interpretation:

    out/s2-palette.json     the measured palette, both modes per token
    tools/s2-emit.py        the A/B plan (which tokens, and why) -- imported, not copied
    build/veil-budget.json  the solved alpha for the two translucent surfaces

The last one is why this exists at all. Two of the 55 tokens are not shipped as
the palette's opaque hex: `--dsw-alias-bg-base` and
`--dsw-specific-sidebar-fill` become the VEIL the wallpaper composites against, so
their alpha is the number solved into `build/veil-budget.json` (EVA: 0.63 dark /
0.74 light), not a hand-entered one. Everything else ships byte-for-byte as
measured.

Run (DSH runtime Python):
    python tools/s3-emit-tokens.py
    python tools/s3-emit-tokens.py --check     # is src/tokens.json still current?
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
BUILD = ROOT / "build"
SRC = ROOT / "src"

PLUGIN_ID = "EVA-Inspired-Theme"

# ---------------------------------------------------------------------------
# SURFACE ALPHA (2026-10-07, D46): the user asked for ONE see-through value on every
# surface that shows the wallpaper -- 「调整为透出80%壁纸，所有地方！」.
#
# The two VEIL surfaces take theirs from build/veil-budget.json (`budget["surfaces"]`).
# The two below are NOT modelled by that solver -- they sit above the veil rather than
# directly on the art -- so their alpha is pinned here instead of being hand-edited into
# `out/s2-palette.json`: that file is measurement evidence and stays untouched.
# 0.30 means 70% of whatever is behind the surface comes through (2026-10-07, round 10:
# 「壁纸的透出度调整为70%」 -- keep this in step with SHIPPED_ALPHA in s3-veil-budget.py).
# NOT moved on 2026-10-10: the light veil went 0.70 -> 0.84 for readability, but these
# two are local content faces (composer card / menus) that sit ABOVE the veil, not the
# veil itself; they were not what the user reported as unclear, and the two SOLVED
# surfaces still come from the budget, so nothing here needs to follow the light change.
#
# Consequence, recorded rather than hidden: these two now carry a CHOSEN alpha too, so
# the "everything else ships byte-for-byte as measured" sentence in this file's
# docstring has these two as exceptions. They are listed in meta.surfaceAlphaOverride.
# ---------------------------------------------------------------------------
SURFACE_ALPHA = {
    "--dsw-specific-input-major": {"light": 0.30, "dark": 0.30},
    "--dsw-menu-surface-fill": {"light": 0.30, "dark": 0.30},
}


def load_module(path: Path, name: str):
    """Import a hyphenated sibling by path -- tools/ is not a package."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def with_alpha(hex_value: str, alpha: float) -> str:
    """Return the colour with an explicit alpha byte (0..255 -> 2 hex digits).

    Half-up, NOT Python's built-in `round()`: `round()` is banker's rounding, so
    alpha 0.30 (76.5) would ship `4c` here while `tools/selfcheck.mjs`'s
    `Math.round()` expects `4d` -- tok.8 then fails on a value both sides agree
    about. The two must round the same way; JS rounding is half-up.
    """
    base = hex_value.lstrip("#")[:6]
    if len(base) != 6:
        raise ValueError(f"not a 6-digit colour: {hex_value!r}")
    return f"#{base}{int(alpha * 255 + 0.5):02x}"


def build() -> dict:
    plan = load_module(ROOT / "tools" / "s2-emit.py", "s2_emit_plan")
    palette = json.loads((OUT / "s2-palette.json").read_text(encoding="utf-8"))["palette"]
    budget = json.loads((BUILD / "veil-budget.json").read_text(encoding="utf-8"))

    translucent = set(budget["surfaces"])
    alphas = {mode: data["chosenAlpha"] for mode, data in budget["modes"].items()}

    order = [tok for tok, *_ in plan.PLAN_A] + [tok for tok, *_ in plan.PLAN_B]
    layer_of = {tok: "A" for tok, *_ in plan.PLAN_A}
    layer_of.update({tok: "B" for tok, *_ in plan.PLAN_B})
    reason_of = {tok: why for tok, _fam, _scope, why in plan.PLAN_A + plan.PLAN_B}

    tokens: dict[str, dict[str, str]] = {}
    veiled: list[str] = []
    pinned: list[str] = []
    for token in order:
        modes = {}
        for mode in ("dark", "light"):
            value = palette[mode].get(token)
            if value is None:
                raise KeyError(f"{token} missing from out/s2-palette.json ({mode})")
            if token in translucent:
                value = with_alpha(value, alphas[mode])
            elif token in SURFACE_ALPHA:
                value = with_alpha(value, SURFACE_ALPHA[token][mode])
            modes[mode] = value
        tokens[token] = modes
        if token in translucent:
            veiled.append(token)
        elif token in SURFACE_ALPHA:
            pinned.append(token)

    return {
        "meta": {
            "pluginId": PLUGIN_ID,
            "schema": 1,
            "tokenCount": len(tokens),
            "byLayer": {"A": len(plan.PLAN_A), "B": len(plan.PLAN_B)},
            "source": "out/s2-palette.json + tools/s2-emit.py PLAN_A/PLAN_B",
            "veilAlpha": {"dark": alphas["dark"], "light": alphas["light"]},
            "translucentSurfaces": veiled,
            "surfaceAlphaOverride": {token: SURFACE_ALPHA[token] for token in pinned},
            "note": (
                "Generated by tools/s3-emit-tokens.py. This file IS the token layer's "
                "source of truth for the build; client.js is generated from it. The two "
                "translucent tokens carry the solved veil alpha, not an opaque value."
            ),
        },
        "tokens": tokens,
    }


def main() -> int:
    payload = build()
    text = json.dumps(payload, ensure_ascii=False, indent=1) + "\n"

    if "--check" in sys.argv:
        path = SRC / "tokens.json"
        if not path.exists():
            print("src/tokens.json missing -- run without --check first")
            return 1
        if path.read_text(encoding="utf-8") != text:
            current = json.loads(path.read_text(encoding="utf-8"))
            fresh = payload
            print("src/tokens.json is STALE:")
            old_tokens, new_tokens = current["tokens"], fresh["tokens"]
            for token in sorted(set(old_tokens) | set(new_tokens)):
                a, b = old_tokens.get(token), new_tokens.get(token)
                if a != b:
                    print(f"  {token}: {a} -> {b}")
            if current.get("meta") != fresh.get("meta"):
                print(f"  meta differs")
            return 1
        print(f"src/tokens.json check: OK ({payload['meta']['tokenCount']} tokens)")
        return 0

    SRC.mkdir(parents=True, exist_ok=True)
    (SRC / "tokens.json").write_text(text, encoding="utf-8")
    meta = payload["meta"]
    print(f"wrote src/tokens.json  tokens={meta['tokenCount']}  "
          f"A={meta['byLayer']['A']} B={meta['byLayer']['B']}  "
          f"veil dark={meta['veilAlpha']['dark']} light={meta['veilAlpha']['light']}")
    for token in meta["translucentSurfaces"]:
        print(f"  veiled  {token:<34} dark={payload['tokens'][token]['dark']}  "
              f"light={payload['tokens'][token]['light']}")
    for token, alpha in meta["surfaceAlphaOverride"].items():
        print(f"  pinned  {token:<34} dark={payload['tokens'][token]['dark']}  "
              f"light={payload['tokens'][token]['light']}  "
              f"(alpha {alpha['dark']}/{alpha['light']}, not solved by the veil budget)")
    print(f"  every token has both modes: "
          f"{all(set(v) == {'light', 'dark'} and all(v.values()) for v in payload['tokens'].values())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
