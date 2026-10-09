#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S3 · Does the paint layer's shell rescue still address anything?

`src/theme.css` empties eight wrappers so the wallpaper is not covered by panels
that repaint `--dsw-alias-bg-base`. Those selectors are `data-*` contracts rather
than CSS-Modules class names precisely so they survive a rebuild — but "should
survive" is not "does match", and dead CSS is invisible: the theme would look
merely wrong, with nothing in the console.

So this counts what each selector actually reaches in the RUNNING app, and reports
each one's own `background-color` — which is the property the paint layer
overrides. It does not install anything and does not evaluate the theme; it answers
one question: are these the right elements?

Read-only. Output: out\\s3-shell-selectors.json
Interpreter: system Python 3.14 (has playwright). Usage: s3-probe-shell.py [light] [dark]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_baseline_lib import AUTHORITY, OUT, URL, VIEWPORT, session_cookie  # noqa: E402

SETTLE_MS = 9000

# Must stay in step with the Shell section of src/theme.css.
SELECTORS = [
    "[data-slot='main']",
    "[data-dsh-bottom-panel]",
    "[data-rightbar-col]",
    "[data-rightbar-col] > *",
    "[data-dsh-panel-entry]",
    "[data-conversation-content]",
    "#root *:has(> [data-conversation-content])",
    "#root *:has(> [data-dsh-center-col])",
]

# This list exists so the probe can still fail on a selector that goes dead WITHOUT
# being known about -- which is the failure mode worth catching, since dead CSS is
# invisible at runtime (the UI merely looks wrong and the console says nothing).
#
# It is empty, and that is a result rather than a placeholder. The first draft
# carried `[data-shell-bottom]` over from the reference theme unchecked; the S4
# census (out/s4-census.json) showed no build here writes that attribute, and the
# real contract is `[data-dsh-bottom-panel]`. It was replaced, not excused.
KNOWN_CONDITIONAL: set[str] = set()

JS = r"""
(selectors) => {
  const describe = (el) => {
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      attrs: Array.from(el.attributes)
        .filter(a => a.name.startsWith('data-') && a.value.length < 40)
        .slice(0, 6)
        .map(a => a.name + '=' + a.value),
      background: cs.backgroundColor,
      backgroundImage: cs.backgroundImage === 'none' ? 'none' : 'yes',
      position: cs.position,
      zIndex: cs.zIndex,
    };
  };
  const out = [];
  for (const selector of selectors) {
    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll(selector)); } catch (e) {
      out.push({ selector, error: String(e).slice(0, 80), count: 0, samples: [] });
      continue;
    }
    /* How many of them actually paint something -- those are the ones the rule can
       affect. A match that paints nothing is a no-op, not a failure. */
    let painting = 0;
    for (const el of nodes) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') painting += 1;
    }
    out.push({
      selector,
      count: nodes.length,
      painting,
      samples: nodes.slice(0, 3).map(describe),
    });
  }
  const body = getComputedStyle(document.body);
  return {
    results: out,
    bodyBackgroundColor: body.backgroundColor,
    bodyBackgroundImage: body.backgroundImage === 'none' ? 'none' : 'yes',
    htmlAttrs: Array.from(document.documentElement.attributes).map(a => a.name + '=' + a.value),
    bodyAttrs: Array.from(document.body.attributes).map(a => a.name + '=' + a.value),
  };
}
"""


def main() -> int:
    modes = [a for a in sys.argv[1:] if a in ("light", "dark")] or ["light", "dark"]
    payload: dict = {"authority": AUTHORITY, "selectors": SELECTORS, "modes": {}}

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
            state = page.evaluate(JS, SELECTORS)
            payload["modes"][mode] = state

            print(f"[{AUTHORITY} {mode}]  body background-color="
                  f"{state['bodyBackgroundColor']}  image={state['bodyBackgroundImage']}")
            print(f"  {'selector':<46}{'matched':>8}{'painting':>9}   sample attrs")
            for row in state["results"]:
                if row.get("error"):
                    print(f"  {row['selector']:<46}{'ERROR':>8}  {row['error']}")
                    continue
                sample = row["samples"][0] if row["samples"] else {}
                print(f"  {row['selector']:<46}{row['count']:>8}{row['painting']:>9}   "
                      f"{sample.get('tag', '')} {' '.join(sample.get('attrs', []))[:56]}")
            context.close()
        browser.close()

    path = OUT / "s3-shell-selectors.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    dead = sorted({row["selector"] for mode in payload["modes"].values()
                   for row in mode["results"] if not row.get("error") and row["count"] == 0})
    unexpected = [s for s in dead if s not in KNOWN_CONDITIONAL]
    print()
    if dead:
        for selector in dead:
            note = "declared conditional" if selector in KNOWN_CONDITIONAL else "UNEXPECTED"
            print(f"  no match: {selector}   ({note})")
    else:
        print("every selector in the Shell section matches at least one element")
    print(f"wrote {path}")
    if unexpected:
        print(f"\nFAIL: {len(unexpected)} selector(s) match nothing and are not declared "
              f"conditional -- remove them from src/theme.css or fix them")
        return 1
    print("shell selectors: OK "
          f"({len(dead)} declared conditional, {len(unexpected)} unexplained)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
