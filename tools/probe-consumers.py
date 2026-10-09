#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S1 supplementary probe: is a token DEAD, or merely STATE-GATED?

The generic sentinel probe (probe-reach.py) samples ~32 longhand properties on
every element it can see. A token whose consumer rule is gated behind
`[data-state="error"]`, an unopened menu or a modal backdrop reads as
`changed=0` there even though it is perfectly alive. That reading cannot tell
"no consumer exists" from "the consumer exists but this UI state has not
rendered it".

This probe answers the question directly and without constructing UI states:

  1. For every consumer rule of a token (taken from the already-built
     out/cssom-refs.json reference map) count how many elements its selector
     matches in the LIVE document. 0 matches + a real rule = state-gated.
  2. `matchesLoose` drops the attribute selectors, so it shows whether the
     underlying class is present at all.
  3. Targeted sentinel: set the token on <body> inline, then read back the
     EXACT property that consumer rule uses, on the EXACT element it matched —
     far more sensitive than sampling generic properties.
  4. Custom-property chaining: when a consumer only feeds another custom
     property, follow the chain so a token is not called dead when its real
     consumers live one hop downstream.

Everything is measured, nothing is inferred. A synthetic attribute flip is NOT
performed here: this probe deliberately makes no claim about states it did not
render.

Interpreter: system Python 3.14 (has playwright). Usage: probe-consumers.py [light] [dark]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_baseline_lib import AUTHORITY, OUT, URL, VIEWPORT, session_cookie  # noqa: E402
from probe_consumers_defs import EXPECTED, SETTLE_MS, SENTINELS, TARGETS  # noqa: E402

CHAIN_DEPTH = 3

JS_MEASURE = r"""
(payload) => {
  const { targets, sentinels } = payload;
  const read = (sel, prop) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    try { return getComputedStyle(el).getPropertyValue(prop).trim(); }
    catch (e) { return 'ERR:' + String(e).slice(0, 60); }
  };
  const count = (sel) => { try { return document.querySelectorAll(sel).length } catch (e) { return -1 } };
  const loose = (sel) => sel.replace(/\[[^\]]*\]/g, '');
  const out = {};
  for (const t of targets) {
    const rows = [];
    for (const ref of t.refs) {
      const matches = count(ref.selector);
      const row = {
        sheet: ref.sheet, selector: ref.selector, prop: ref.prop, value: ref.value,
        matches: matches, matchesLoose: count(loose(ref.selector)),
      };
      if (matches > 0) row.before = read(ref.selector, ref.prop);
      rows.push(row);
    }
    document.body.style.setProperty(t.name, sentinels[t.name]);
    for (const r of rows) {
      if (r.matches > 0) {
        r.after = read(r.selector, r.prop);
        r.changed = r.after !== (r.before ?? null);
      }
    }
    document.body.style.removeProperty(t.name);
    for (const r of rows) {
      if (r.matches > 0) r.restored = read(r.selector, r.prop) === (r.before ?? null);
    }
    out[t.name] = rows;
  }
  return out;
}
"""

# context facts that must be recorded so a later reader knows WHICH document
# (and which theme preference) the numbers belong to.
# NOTE: boot-theme.ts:31 writes data-ds-theme-source on <html> (documentElement),
# NOT on <body>; body only gets data-ds-dark-theme (:32). Reading the source
# attribute off body silently returns null. The faithfulness guard therefore
# does not depend on the attribute at all: it asserts what was RENDERED
# (html color-scheme + the dark attribute + the boot background) matches the
# mode we asked the browser context for.
JS_FACTS = r"""
() => ({
  sourceHtml: document.documentElement.getAttribute('data-ds-theme-source'),
  sourceBody: document.body.getAttribute('data-ds-theme-source'),
  darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
  htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
  bootBg: getComputedStyle(document.body).getPropertyValue('--dsh-boot-bg').trim(),
  inlineOnBody: document.body.style.length,
})
"""


def chain_of(token: str, refs: dict, depth: int = CHAIN_DEPTH) -> list[dict]:
    """Follow custom-property hops (target -> --a -> --b -> real property)."""
    hops: list[dict] = []
    frontier = [(token, 0)]
    seen = {token}
    while frontier:
        name, level = frontier.pop(0)
        if level >= depth:
            continue
        for entry in refs.get(name, []):
            prop = entry.get("prop", "")
            hops.append(
                {
                    "from": name,
                    "level": level + 1,
                    "selector": entry.get("selector", ""),
                    "prop": prop,
                    "sheet": entry.get("sheet", ""),
                    "inCustomProp": bool(entry.get("inCustomProp")),
                }
            )
            if prop.startswith("--") and prop not in seen:
                seen.add(prop)
                frontier.append((prop, level + 1))
    return hops


def classify(rows: list[dict], hops: list[dict]) -> str:
    if not rows and not hops:
        return "DEAD(no rule references it anywhere in this document)"
    live = [r for r in rows if r["matches"] > 0]
    if live and any(r.get("changed") for r in live):
        return "LIVE(direct: consumer element present AND that property moved)"
    if live:
        return "LIVE-SHADOWED(consumer element present but the property did not move)"
    if rows:
        loose = any(r["matchesLoose"] > 0 for r in rows)
        return (
            "STATE-GATED(base class present, gated attribute absent)"
            if loose
            else "STATE-GATED(no matching element in this UI state)"
        )
    return "INDIRECT(only feeds other custom properties)"


def main() -> int:
    modes = [a for a in sys.argv[1:] if a in ("light", "dark")] or ["light", "dark"]
    refs = json.loads((OUT / "cssom-refs.json").read_text(encoding="utf-8"))["refs"]

    payload_targets = [
        {"name": t, "refs": [dict(r, name=t) for r in refs.get(t, [])]} for t in TARGETS
    ]
    chains = {t: chain_of(t, refs) for t in TARGETS}
    payload = {"targets": payload_targets, "sentinels": SENTINELS}

    results: dict = {"authority": AUTHORITY, "modes": {}, "chains": chains}

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
            facts = page.evaluate(JS_FACTS)
            want = EXPECTED[mode]
            ok = all(facts[k] == v for k, v in want.items())
            print(
                f"[{AUTHORITY} {mode}] sourceHtml={facts['sourceHtml']} "
                f"sourceBody={facts['sourceBody']} darkAttr={facts['darkAttr']} "
                f"htmlColorScheme={facts['htmlColorScheme']} bootBg={facts['bootBg']} "
                f"inlineOnBody={facts['inlineOnBody']}  FAITHFUL={ok}"
            )
            if not ok:
                print(
                    f"  !! rendered palette does not match the requested mode {mode} "
                    f"(expected {want}). The official boot chain did not follow "
                    f"prefers-color-scheme, so prefers-color-scheme is not what decides "
                    f"the palette here (boot-theme.ts:27). Readings are NOT trustworthy."
                )
                results.setdefault("unfaithful", []).append(mode)
            measured = page.evaluate(JS_MEASURE, payload)
            verdicts = {}
            for token, rows in measured.items():
                verdicts[token] = classify(rows, chains.get(token, []))
            results["modes"][mode] = {"facts": facts, "rows": measured, "verdicts": verdicts}
            print(f"  {len(measured)} tokens measured")
            for token in TARGETS:
                v = verdicts[token]
                rows = measured[token]
                n_live = sum(1 for r in rows if r["matches"] > 0)
                n_loose = sum(1 for r in rows if r["matchesLoose"] > 0)
                print(
                    f"    {v:<58} {token}"
                    f"   (refs={len(rows)} live={n_live} looseMatch={n_loose})"
                )
            context.close()
        browser.close()

    path = OUT / "consumers.json"
    path.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"\nwrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
