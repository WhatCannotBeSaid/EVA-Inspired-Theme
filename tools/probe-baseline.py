#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S1 reconnaissance probe: read the LIVE DSH desktop GUI as ground truth.

Read-only. Opens http://<DSH_AUTHORITY> with the instance's session cookie when
one is supplied (see probe_baseline_lib), then measures:

  A. body / html inline custom-property counts, per mode (light, dark)
  B. the full computed custom-property map on <body>, per mode
  C. which candidate tokens a body-level inline property actually reaches
  D. the official data-* selector contract present in the live DOM
  E. screenshots of both modes

Writes out\\baseline.json, out\\data-attrs.json, out\\shot-{light,dark}.png

Interpreter: system Python 3.14 (playwright). NOT the DSH runtime python.
Run:  python probe-baseline.py

The target instance comes from DSH_AUTHORITY (host:port); no local path or
port is baked in.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from probe_baseline_lib import session_cookie  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
AUTHORITY = os.environ.get("DSH_AUTHORITY", "").strip()
if not AUTHORITY:
    raise SystemExit("set DSH_AUTHORITY to the running DSH instance (host:port)")
URL = f"http://{AUTHORITY}"
VIEWPORT = {"width": 1600, "height": 1000}

# Tokens P0 §三.4 nominate as "paint layer" candidates, plus a control token
# that is known to ride the ordinary body-inline alias channel.
CANDIDATES = [
    "--dsh-boot-bg",
    "--dsw-desktop-window-tint",
    "--dsw-focus-ring-color",
    "--dsw-menu-backdrop-filter",
]
CONTROL = "--dsw-alias-bg-base"
SENTINEL = "rgb(1, 2, 3)"


JS_CAPTURE = r"""
() => {
  const body = document.body;
  const html = document.documentElement;
  const read = (el) => {
    const out = {};
    const cs = getComputedStyle(el);
    for (let i = 0; i < cs.length; i++) {
      const n = cs[i];
      if (n.startsWith('--')) out[n] = cs.getPropertyValue(n).trim();
    }
    return out;
  };
  const inlineVars = (el) => {
    const out = [];
    for (let i = 0; i < el.style.length; i++) {
      const n = el.style[i];
      if (n.startsWith('--')) out.push(n);
    }
    return out.sort();
  };
  return {
    bodyComputed: read(body),
    htmlComputed: read(html),
    bodyInline: inlineVars(body),
    htmlInline: inlineVars(html),
    darkAttr: body.hasAttribute('data-ds-dark-theme'),
    htmlColorScheme: getComputedStyle(html).colorScheme,
    bodyBackgroundColor: getComputedStyle(body).backgroundColor,
    bodyColor: getComputedStyle(body).color,
    bodyFontSize: getComputedStyle(body).fontSize,
    bodyFontFamily: getComputedStyle(body).fontFamily,
    rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
    nodes: document.querySelectorAll('*').length,
  };
}
"""

JS_REACH = r"""
(payload) => {
  const { names, sentinel } = payload;
  const body = document.body;
  const html = document.documentElement;
  const all = [html, ...document.querySelectorAll('*')];
  const result = {};
  for (const name of names) {
    const readAll = () => all.map(el => getComputedStyle(el).getPropertyValue(name).trim());
    const before = readAll();
    const beforeHtml = before[0];
    const beforeBody = getComputedStyle(body).getPropertyValue(name).trim();
    body.style.setProperty(name, sentinel);
    const after = readAll();
    // count elements (excluding body itself) that now resolve the sentinel
    let seen = 0;
    let seenOutsideBody = 0;
    for (let i = 0; i < all.length; i++) {
      if (after[i] !== sentinel) continue;
      if (all[i] === body) continue;
      seen += 1;
      if (!body.contains(all[i])) seenOutsideBody += 1;
    }
    const afterHtml = getComputedStyle(html).getPropertyValue(name).trim();
    body.style.removeProperty(name);
    const restored = getComputedStyle(body).getPropertyValue(name).trim();
    result[name] = {
      declaredAtHtml: beforeHtml,
      declaredAtBody: beforeBody,
      htmlAffectedByBodyInline: afterHtml === sentinel,
      elementsResolvingSentinel: seen,
      elementsOutsideBodyResolvingSentinel: seenOutsideBody,
      valueRestoredAfterCleanup: restored === beforeBody,
      emptyBefore: beforeBody === '' && beforeHtml === '',
    };
  }
  return result;
}
"""

JS_DATA_ATTRS = r"""
() => {
  const out = {};
  let nodes = 0;
  for (const el of document.querySelectorAll('*')) {
    nodes += 1;
    for (const attr of el.attributes) {
      if (!attr.name.startsWith('data-')) continue;
      const key = attr.name;
      if (!(key in out)) out[key] = { count: 0, samples: [] };
      const rec = out[key];
      rec.count += 1;
      const value = attr.value;
      if (rec.samples.length < 6 && !rec.samples.includes(value)) rec.samples.push(value);
    }
  }
  return { nodes, attrs: out };
}
"""


def settle(page, ms: int) -> None:
    page.wait_for_timeout(ms)


def capture(page) -> dict:
    return page.evaluate(JS_CAPTURE)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).astimezone().isoformat()
    report: dict = {
        "authority": AUTHORITY,
        "capturedAt": stamp,
        "viewport": VIEWPORT,
        "candidates": CANDIDATES,
        "control": CONTROL,
        "sentinel": SENTINEL,
    }

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport=VIEWPORT)
        context.add_cookies(session_cookie())
        page = context.new_page()
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=30_000)
        settle(page, 9000)

        # ---------- light ----------
        page.evaluate("() => document.body.removeAttribute('data-ds-dark-theme')")
        settle(page, 1500)
        light = capture(page)
        report["light"] = light
        page.screenshot(path=str(OUT / "shot-light.png"))

        # ---------- dark ----------
        page.evaluate("() => document.body.setAttribute('data-ds-dark-theme','')")
        settle(page, 1500)
        dark = capture(page)
        report["dark"] = dark
        page.screenshot(path=str(OUT / "shot-dark.png"))

        # ---------- reachability (measured in dark, then verified in light) ----------
        reach = {}
        for mode in ("dark", "light"):
            page.evaluate(
                "() => document.body.setAttribute('data-ds-dark-theme','')"
                if mode == "dark" else
                "() => document.body.removeAttribute('data-ds-dark-theme')"
            )
            settle(page, 1200)
            reach[mode] = page.evaluate(
                JS_REACH, {"names": CANDIDATES + [CONTROL], "sentinel": SENTINEL}
            )
        report["reachability"] = reach

        # ---------- data-* contract ----------
        report["dataAttrs"] = page.evaluate(JS_DATA_ATTRS)

        browser.close()

    (OUT / "baseline.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    # console digest
    for mode in ("light", "dark"):
        snap = report[mode]
        print(f"[{mode}] bodyInlineVars={len(snap['bodyInline'])} "
              f"htmlInlineVars={len(snap['htmlInline'])} "
              f"bodyComputedVars={len(snap['bodyComputed'])} "
              f"htmlComputedVars={len(snap['htmlComputed'])} "
              f"darkAttr={snap['darkAttr']} colorScheme={snap['htmlColorScheme']} "
              f"nodes={snap['nodes']} bodyBg={snap['bodyBackgroundColor']}")
    print("--- reachability ---")
    for mode, items in report["reachability"].items():
        for name, rec in items.items():
            print(f"[{mode}] {name}: html={rec['declaredAtHtml']!r} body={rec['declaredAtBody']!r} "
                  f"reachedDescendants={rec['elementsResolvingSentinel']} "
                  f"reachedHtml={rec['htmlAffectedByBodyInline']} restored={rec['valueRestoredAfterCleanup']}")
    print(f"--- data-* attrs: {len(report['dataAttrs']['attrs'])} distinct over {report['dataAttrs']['nodes']} nodes ---")
    for key in sorted(report["dataAttrs"]["attrs"]):
        rec = report["dataAttrs"]["attrs"][key]
        print(f"  {key} x{rec['count']} samples={rec['samples']}")
    print(f"wrote {OUT / 'baseline.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
