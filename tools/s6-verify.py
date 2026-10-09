#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S6 -- post-restart, on-the-real-installation verification.

Difference from `verify-render.py` (S4): that tool INJECTED the shipped
`client.js` through a stand-in theme service. This tool injects nothing. It
loads the app exactly as the user does and asks the running runtime what is
actually mounted. Anything it reports therefore comes from the real
`dsh.bundle.patch` mount and the real `theme.overrideTokens`.

Interpreter: system Python 3.14 (playwright). Never prints the session secret
or the cookie value.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_baseline_lib import AUTHORITY, ROOT, URL, VIEWPORT, session_cookie  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

DELIVER = Path(r"<plugins>\tmp\EVA-Inspired-Theme-installed")
TOKENS = json.loads((ROOT / "src" / "tokens.json").read_text(encoding="utf-8"))["tokens"]
SETTLE_MS = 9000

# ---------------------------------------------------------------- page scripts

JS_MOUNT = r"""
() => {
  const styles = Array.from(document.querySelectorAll('style'));
  const pluginStyles = styles
    .filter((s) => s.dataset && s.dataset.plugin)
    .map((s) => ({ plugin: s.dataset.plugin, chars: s.textContent.length }));
  const cs = getComputedStyle(document.body);
  const read = (name) => cs.getPropertyValue(name).trim();
  const inline = Array.from(document.body.style).filter((p) => p.startsWith('--'));
  const htmlInline = Array.from(document.documentElement.style).filter((p) => p.startsWith('--'));
  return {
    title: document.title,
    ready: !!document.querySelector('#root'),
    styleCount: styles.length,
    pluginStyles,
    bodyInlineVars: inline,
    bodyInlineCount: inline.length,
    htmlInlineVars: htmlInline,
    htmlInlineCount: htmlInline.length,
    bodyDataAttrs: Object.keys(document.body.dataset),
    htmlDataAttrs: Object.keys(document.documentElement.dataset),
    probeTokens: {
      '--dsw-alias-bg-base': read('--dsw-alias-bg-base'),
      '--dsw-alias-label-primary': read('--dsw-alias-label-primary'),
      '--dsw-alias-brand-primary': read('--dsw-alias-brand-primary'),
      '--dsw-specific-sidebar-fill': read('--dsw-specific-sidebar-fill'),
      '--dsw-corner-shape': read('--dsw-corner-shape'),
      '--dsw-font-family': read('--dsw-font-family').slice(0, 70),
      '--cp-wall': read('--cp-wall').slice(0, 46),
      '--dsh-content-font-size': read('--dsh-content-font-size'),
    },
    bodyBackgroundColor: cs.backgroundColor,
    bodyBackgroundImage: cs.backgroundImage === 'none' ? 'none'
      : (cs.backgroundImage.includes('url(') ? 'gradient+url' : 'gradient-only'),
  };
}
"""

# Counts how many of the S3-generated tokens are in effect, and HOW they are in
# effect (inline property vs stylesheet). This is the honest answer to "how many
# overrides are actually applied", which is not the same question as "how many
# inline properties are on <body>".
JS_COVERAGE = r"""
(tokens) => {
  const cs = getComputedStyle(document.body);
  const inline = new Set(Array.from(document.body.style).filter((p) => p.startsWith('--')));
  const sheets = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
  const inEffect = [];
  const notInEffect = [];
  for (const [name, expect] of Object.entries(tokens)) {
    const got = cs.getPropertyValue(name).trim();
    const row = { name, expect, got, inline: inline.has(name),
                  inSheet: sheets.includes(name + ':') || sheets.includes(name + ' :') };
    if (got === expect) inEffect.push(row); else notInEffect.push(row);
  }
  return { inEffect, notInEffect };
}
"""

JS_MENU_SURVEY = r"""
() => {
  const found = {};
  found.hasThemeToggle = !!document.querySelector("[data-theme-toggle], [data-testid*='theme']");
  const buttons = Array.from(document.querySelectorAll('button'));
  found.buttonCount = buttons.length;
  found.settingsEntry = buttons
    .map((b) => (b.textContent || '').trim())
    .filter((t) => /设置|Settings/i.test(t)).slice(0, 6);
  found.themeWords = buttons
    .map((b) => (b.textContent || '').trim())
    .filter((t) => /主题|Theme|深色|浅色|Dark|Light|跟随/.test(t)).slice(0, 8);
  return found;
}
"""


class Console:
    """Collect console errors and uncaught exceptions, with their raw text."""

    def __init__(self) -> None:
        self.errors: list[dict] = []
        self.warnings: list[dict] = []
        self.all: list[dict] = []

    def attach(self, page) -> None:
        def on_console(message) -> None:
            entry = {"type": message.type, "text": message.text[:400]}
            self.all.append(entry)
            if message.type == "error":
                self.errors.append(entry)
            elif message.type == "warning":
                self.warnings.append(entry)

        def on_pageerror(error) -> None:
            entry = {"type": "pageerror", "text": str(error)[:400]}
            self.all.append(entry)
            self.errors.append(entry)

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)


def open_page(browser, mode: str | None, viewport: dict | None = None,
              reduced_motion: str | None = None):
    kwargs: dict = {"viewport": viewport or VIEWPORT}
    if mode:
        kwargs["color_scheme"] = mode
    if reduced_motion:
        kwargs["reduced_motion"] = reduced_motion
    context = browser.new_context(**kwargs)
    context.add_cookies(session_cookie())
    page = context.new_page()
    console = Console()
    console.attach(page)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=30_000)
    page.wait_for_timeout(SETTLE_MS)
    return context, page, console


def recon(browser, modes: list[str]) -> dict:
    out: dict = {"mount": {}, "coverage": {}, "console": {}, "menu": {}}
    for mode in modes:
        context, page, console = open_page(browser, mode)
        out["mount"][mode] = page.evaluate(JS_MOUNT)
        out["coverage"][mode] = page.evaluate(JS_COVERAGE, TOKENS)
        out["menu"][mode] = page.evaluate(JS_MENU_SURVEY)
        out["console"][mode] = {
            "errorCount": len(console.errors), "errors": console.errors,
            "warningCount": len(console.warnings), "warnings": console.warnings[:6],
            "totalMessages": len(console.all),
        }
        context.close()
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["recon"], nargs="?", default="recon")
    parser.add_argument("--modes", default="light,dark")
    args = parser.parse_args()
    modes = [m.strip() for m in args.modes.split(",") if m.strip()]

    DELIVER.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "authority": AUTHORITY, "url": URL, "viewport": VIEWPORT,
        "s3TokenCount": len(TOKENS),
    }
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        report.update(recon(browser, modes))
        browser.close()

    (DELIVER / "recon.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # ------------------------------------------------------------- console out
    for mode in modes:
        mount = report["mount"][mode]
        cov = report["coverage"][mode]
        con = report["console"][mode]
        print(f"\n===== [{mode}] =====")
        print(f"  styles={mount['styleCount']}  pluginStyles={mount['pluginStyles']}")
        print(f"  body inline vars = {mount['bodyInlineCount']}   html inline vars = {mount['htmlInlineCount']}")
        print(f"  body data-* = {mount['bodyDataAttrs']}")
        print(f"  html data-* = {mount['htmlDataAttrs']}")
        print(f"  body bg = {mount['bodyBackgroundColor']}  image={mount['bodyBackgroundImage']}")
        for name, value in mount["probeTokens"].items():
            print(f"    {name:<32} = {value!r}")
        print(f"  S3 tokens in effect: {len(cov['inEffect'])} / {len(TOKENS)}"
              f"   NOT in effect: {len(cov['notInEffect'])}")
        inline_hits = sum(1 for r in cov["inEffect"] if r["inline"])
        sheet_hits = sum(1 for r in cov["inEffect"] if r["inSheet"] and not r["inline"])
        print(f"    of those: inline-on-body={inline_hits}  in-sheet-only={sheet_hits}")
        for row in cov["notInEffect"][:10]:
            print(f"    MISS {row['name']}  expect={row['expect']!r} got={row['got']!r}")
        print(f"  console errors = {con['errorCount']}")
        for e in con["errors"][:8]:
            print(f"    | {e['type']}: {e['text']}")
        print(f"  console warnings = {con['warningCount']}  (total messages {con['totalMessages']})")
        print(f"  menu survey: {report['menu'][mode]}")
    print(f"\nwrote {DELIVER / 'recon.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
