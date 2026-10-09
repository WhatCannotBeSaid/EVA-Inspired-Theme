#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S1 follow-up: capture the CURRENT runtime's theme-plugin footprint.

Raised because the user reported disabling all theme-related plugins, while the
profile's cordis.patch.yml still shows `theme-endfield` with `enabled: "1"`
(only `theme-starwake` carries `disabled: true`, cordis.patch.yml:700-701).
The file is not the runtime: this probe measures what the RUNNING app injects.

It records, per colour mode:
  - the full inline style text of <html> and <body>  (who writes what)
  - every stylesheet's identity (href, or the tag/attrs of the owning node)
  - a marker scan for the known theme plugins' fingerprints
  - the complete list of custom properties on <html> and <body>

Nothing is mutated. Output: out\\runtime-state.json  (never overwrites the S1
evidence files, so the two readings can be diffed).

Interpreter: system Python 3.14 (has playwright). Usage: probe-runtime-state.py [light] [dark]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_baseline_lib import AUTHORITY, OUT, URL, VIEWPORT, session_cookie  # noqa: E402

SETTLE_MS = 9000

# fingerprints of the theme plugins known to be installed on this machine.
# 'theme-endfield' ships a "valley" palette and an --lc-* contour family;
# 'theme-starwake' and 'dsh-theme-studio' are tracked by id where visible.
MARKERS = ["valley", "endfield", "starwake", "lc-", "--ds-", "scu-grad", "studio"]

JS_STATE = r"""
(markers) => {
  const sheets = [];
  for (const s of Array.from(document.styleSheets)) {
    let rules = -1, err = '';
    try { rules = s.cssRules.length } catch (e) { err = String(e).slice(0, 40) }
    const owner = s.ownerNode;
    sheets.push({
      href: s.href || null,
      ownerTag: owner ? owner.tagName : null,
      ownerId: owner && owner.id ? owner.id : null,
      ownerAttrs: owner ? Array.from(owner.attributes).map(a => a.name + '=' + String(a.value).slice(0, 40)) : [],
      rules: rules,
      err: err,
    });
  }
  const scan = (text) => markers.filter(m => text.includes(m));
  const sheetText = (s) => { try { return s.cssRules ? Array.from(s.cssRules).map(r => r.cssText).join('\n') : '' } catch (e) { return '' } };
  const hits = {};
  for (const m of markers) hits[m] = [];
  for (const s of Array.from(document.styleSheets)) {
    const t = sheetText(s);
    if (!t) continue;
    const found = scan(t);
    if (found.length) hits.__any = (hits.__any || []).concat([{ href: s.href || '(injected)', found: found }]);
  }
  const varsOf = (el) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const name of Array.from(cs)) if (name.startsWith('--')) out[name] = cs.getPropertyValue(name).trim();
    return out;
  };
  return {
    htmlInlineStyle: document.documentElement.getAttribute('style'),
    bodyInlineStyle: document.body.getAttribute('style'),
    htmlInlinePropCount: document.documentElement.style.length,
    bodyInlinePropCount: document.body.style.length,
    htmlAttrs: Array.from(document.documentElement.attributes).map(a => a.name + '=' + a.value),
    bodyAttrs: Array.from(document.body.attributes).map(a => a.name + '=' + a.value),
    sheets: sheets,
    sheetCount: sheets.length,
    markerHits: hits,
    htmlVarCount: Object.keys(varsOf(document.documentElement)).length,
    bodyVarCount: Object.keys(varsOf(document.body)).length,
    htmlVars: varsOf(document.documentElement),
    bodyVars: varsOf(document.body),
    adopted: (document.adoptedStyleSheets || []).length,
  };
}
"""


def main() -> int:
    modes = [a for a in sys.argv[1:] if a in ("light", "dark")] or ["light", "dark"]
    results: dict = {"authority": AUTHORITY, "markers": MARKERS, "modes": {}}

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
            state = page.evaluate(JS_STATE, MARKERS)
            results["modes"][mode] = state

            print(f"[{AUTHORITY} {mode}] sheets={state['sheetCount']} adopted={state['adopted']}")
            print(f"  html inline ({state['htmlInlinePropCount']}): {state['htmlInlineStyle']}")
            print(f"  body inline ({state['bodyInlinePropCount']}): {state['bodyInlineStyle']}")
            print(f"  html attrs: {state['htmlAttrs']}")
            print(f"  body attrs: {state['bodyAttrs']}")
            print(f"  html vars={state['htmlVarCount']}  body vars={state['bodyVarCount']}")
            any_hits = state["markerHits"].get("__any") or []
            print(f"  sheets containing plugin markers: {len(any_hits)}")
            for h in any_hits[:20]:
                print(f"    {h['href'][:60]:<60} {h['found']}")
            context.close()
        browser.close()

    path = OUT / "runtime-state.json"
    path.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"\nwrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
