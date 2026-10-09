#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S1 probe 2 — how to reach dark faithfully, and the live CSSOM var-reference map.

Three candidate dark mechanisms are exercised against the running app:
  A. context color_scheme='dark' at creation (the OS-scheme route)
  B. page.emulate_media(color_scheme='dark') after load
  C. manual `body[data-ds-dark-theme]` toggle

Then, in the state that is judged faithful, the live document's own stylesheets
are walked through the CSSOM to answer, per token: which rules reference it,
with which selector, and whether the reference is only a var() fallback.

Run with system Python 3.14 (playwright).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from probe_baseline_lib import ROOT, URL, VIEWPORT, session_cookie  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

OUT = ROOT / "out"

JS_STATE = r"""
() => {
  const body = document.body;
  const html = document.documentElement;
  const cs = getComputedStyle(body);
  return {
    darkAttr: body.hasAttribute('data-ds-dark-theme'),
    themeSource: html.getAttribute('data-ds-theme-source'),
    htmlColorScheme: getComputedStyle(html).colorScheme,
    bodyColorScheme: cs.colorScheme,
    bodyBg: cs.backgroundColor,
    bgBase: cs.getPropertyValue('--dsw-alias-bg-base').trim(),
    bootBg: cs.getPropertyValue('--dsh-boot-bg').trim(),
    labelPrimary: cs.getPropertyValue('--dsw-alias-label-primary').trim(),
    mediaDark: matchMedia('(prefers-color-scheme: dark)').matches,
    vars: (() => { let n = 0; for (let i = 0; i < cs.length; i++) if (cs[i].startsWith('--')) n++; return n; })(),
  };
}
"""

# Walk every stylesheet in the live document and collect, for each custom
# property, the rules that reference it through var().
JS_REFS = r"""
() => {
  const refs = {};          // token -> [{sheet, selector, prop, value, fallbackOnly}]
  const declared = {};      // token -> [{sheet, selector, value}]
  const sheets = [];
  const VAR = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;
  const visit = (rules, sheetName) => {
    for (const rule of rules) {
      const isStyleRule = typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule;
      if (isStyleRule) {
        // Parse style.cssText instead of enumerating style[i]: Chromium does not
        // expose every property through index enumeration (e.g. `corner-shape`
        // in ui-theme's @supports block is missing from the index walk).
        const cssText = rule.style.cssText || '';
        for (const decl of cssText.split(';')) {
          const idx = decl.indexOf(':');
          if (idx < 0) continue;
          const prop = decl.slice(0, idx).trim();
          const value = decl.slice(idx + 1).trim();
          if (!prop || !value) continue;
          const isCustom = prop.startsWith('--');
          if (isCustom) {
            (declared[prop] ||= []).push({ sheet: sheetName, selector: rule.selectorText, value });
          }
          if (!value.includes('var(')) continue;
          VAR.lastIndex = 0;
          let m;
          while ((m = VAR.exec(value)) !== null) {
            (refs[m[1]] ||= []).push({
              sheet: sheetName,
              selector: rule.selectorText,
              prop,
              value: value.slice(0, 200),
              inCustomProp: isCustom,
            });
          }
        }
        if (rule.cssRules !== undefined && rule.cssRules.length > 0) visit(rule.cssRules, sheetName);
        continue;
      }
      if (rule.cssRules !== undefined) visit(rule.cssRules, sheetName);
    }
  };
  for (const sheet of document.styleSheets) {
    const node = sheet.ownerNode;
    const pluginCss = node && node.getAttribute ? node.getAttribute('data-plugin-css') : null;
    const name = sheet.href
      ? sheet.href.split('/').pop()
      : (pluginCss !== null ? `plugin-css:${String(pluginCss).slice(0, 40)}` : '(inline style element)');
    sheets.push({ name, rules: (() => { try { return sheet.cssRules.length; } catch (e) { return -1; } })() });
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    visit(rules, name);
  }
  return { refs, declared, sheets };
}
"""


def collect(page) -> dict:
    return page.evaluate(JS_STATE)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict = {"capturedAt": datetime.now(timezone.utc).astimezone().isoformat()}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # ---- A: context colour scheme dark from creation ----
        ctx_a = browser.new_context(viewport=VIEWPORT, color_scheme="dark")
        ctx_a.add_cookies(session_cookie())
        page_a = ctx_a.new_page()
        page_a.goto(URL, wait_until="domcontentloaded")
        page_a.wait_for_selector("#root", timeout=30_000)
        page_a.wait_for_timeout(9000)
        report["A_context_dark"] = collect(page_a)
        page_a.screenshot(path=str(OUT / "shot-A-context-dark.png"))

        # ---- B: emulate_media after load (same page as C) ----
        ctx_c = browser.new_context(viewport=VIEWPORT, color_scheme="light")
        ctx_c.add_cookies(session_cookie())
        page_c = ctx_c.new_page()
        page_c.goto(URL, wait_until="domcontentloaded")
        page_c.wait_for_selector("#root", timeout=30_000)
        page_c.wait_for_timeout(9000)
        baseline_light = collect(page_c)
        report["baseline_context_light"] = baseline_light

        page_c.emulate_media(color_scheme="dark")
        page_c.wait_for_timeout(2000)
        report["B_emulate_media_dark"] = collect(page_c)
        page_c.screenshot(path=str(OUT / "shot-B-emulate-dark.png"))

        page_c.emulate_media(color_scheme="light")
        page_c.wait_for_timeout(1500)

        # ---- C: manual attribute toggle ----
        page_c.evaluate("() => document.body.setAttribute('data-ds-dark-theme','')")
        page_c.wait_for_timeout(1500)
        report["C_manual_attribute_dark"] = collect(page_c)
        page_c.screenshot(path=str(OUT / "shot-C-attr-dark.png"))

        # CSSOM reference map, taken in the manual-attribute dark state
        refs = page_c.evaluate(JS_REFS)
        (OUT / "cssom-refs.json").write_text(json.dumps(refs, ensure_ascii=False, indent=1), encoding="utf-8")
        report["cssom"] = {
            "sheets": refs["sheets"],
            "tokensReferenced": len(refs["refs"]),
            "tokensDeclared": len(refs["declared"]),
        }

        browser.close()

    (OUT / "mode-probe.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    for key in ("baseline_context_light", "A_context_dark", "B_emulate_media_dark", "C_manual_attribute_dark"):
        s = report[key]
        print(f"[{key}] darkAttr={s['darkAttr']} themeSource={s['themeSource']} "
              f"htmlCS={s['htmlColorScheme']} bodyCS={s['bodyColorScheme']} mediaDark={s['mediaDark']} "
              f"bg={s['bodyBg']} bgBase={s['bgBase']} bootBg={s['bootBg']} label={s['labelPrimary']} vars={s['vars']}")
    print(f"--- cssom: {len(report['cssom']['sheets'])} sheets, "
          f"{report['cssom']['tokensReferenced']} tokens referenced via var(), "
          f"{report['cssom']['tokensDeclared']} tokens declared ---")
    for entry in report["cssom"]["sheets"][:8]:
        print(f"  sheet {entry['name']} rules={entry['rules']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
