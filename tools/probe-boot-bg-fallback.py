#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S1 supplementary probe: which slot of a var() fallback chain really wins?

`--dsh-boot-bg` is listed in the P0 brief as a paint-layer candidate. Its only
consumer is

    ._boot_u7vgf_3 { background: var(--dsw-alias-bg-base, var(--dsh-boot-bg, Canvas)) }

and probe-rule-fire.py measured that overriding `--dsh-boot-bg` does NOT move
that background. That null result alone does not say WHICH slot supplies the
value, and "it must be slot 1 because of how var() works" would be an
inference. This probe measures it: each slot is driven to a distinct colour in
turn and the resulting computed background is read back.

Interpreter: system Python 3.14 (has playwright). Usage: probe-boot-bg-fallback.py [light] [dark]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_baseline_lib import AUTHORITY, OUT, URL, VIEWPORT, session_cookie  # noqa: E402
from probe_consumers_defs import EXPECTED, SETTLE_MS  # noqa: E402

BOOT_CLASS = "_boot_u7vgf_3"  # from the consumer selector in out/cssom-refs.json

JS = r"""
(cls) => {
  const host = document.createElement('div');
  host.setAttribute(
    'style',
    'position:absolute;left:-32000px;top:0;width:10px;height:10px;pointer-events:none;'
  );
  const el = document.createElement('div');
  el.className = cls;
  host.appendChild(el);
  document.body.appendChild(host);

  const bg = () => getComputedStyle(el).backgroundColor;
  const out = {};
  out.initial = bg();

  document.body.style.setProperty('--dsw-alias-bg-base', 'rgb(11, 22, 33)');
  out.slot1_alias_variant = bg();
  out.slot1_is_boot_bg = out.slot1_alias_variant === out.initial;
  document.body.style.removeProperty('--dsw-alias-bg-base');

  document.body.style.setProperty('--dsh-boot-bg', 'rgb(44, 55, 66)');
  out.bothPresent_boot_bg_variant = bg();
  out.boot_bg_shadowed = out.bothPresent_boot_bg_variant === out.initial;
  document.body.style.removeProperty('--dsh-boot-bg');

  out.restored = bg() === out.initial;
  host.remove();
  return out;
}
"""

LABELS = {
    "initial": "baseline background",
    "slot1_alias_variant": "--dsw-alias-bg-base := rgb(11,22,33)",
    "slot1_is_boot_bg": "-> first slot does NOT supply it (baseline unchanged)",
    "bothPresent_boot_bg_variant": "--dsh-boot-bg := rgb(44,55,66) (alias still defined)",
    "boot_bg_shadowed": "-> --dsh-boot-bg does NOT supply it either (shadowed/overridden)",
    "restored": "baseline restored after removing both sentinels",
}


def main() -> int:
    modes = [a for a in sys.argv[1:] if a in ("light", "dark")] or ["light", "dark"]
    results: dict = {"authority": AUTHORITY, "selector": f".{BOOT_CLASS}", "modes": {}}

    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for mode in modes:
            context = browser.new_context(viewport=VIEWPORT, color_scheme=mode)
            context.add_cookies(session_cookie())
            page = context.new_page()
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_selector("#root", timeout=30_000)
            page.wait_for_timeout(SETTLE_MS)
            facts = page.evaluate(
                "() => ({htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,"
                " darkAttr: document.body.hasAttribute('data-ds-dark-theme'),"
                " bootBg: getComputedStyle(document.body).getPropertyValue('--dsh-boot-bg').trim(),"
                " aliasBgBase: getComputedStyle(document.body)"
                ".getPropertyValue('--dsw-alias-bg-base').trim()})"
            )
            ok = all(facts[k] == v for k, v in EXPECTED[mode].items())
            print(
                f"[{AUTHORITY} {mode}] htmlColorScheme={facts['htmlColorScheme']} "
                f"bootBg={facts['bootBg']} alias-bg-base={facts['aliasBgBase']} FAITHFUL={ok}"
            )
            measured = page.evaluate(JS, BOOT_CLASS)
            results["modes"][mode] = {"facts": facts, "measured": measured}
            for key, label in LABELS.items():
                print(f"    {key:<30} {str(measured[key]):<28} {label}")
            context.close()
        browser.close()

    path = OUT / "boot-bg-fallback.json"
    path.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"\nwrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
