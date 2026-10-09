#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S1 supplementary probe: does the consumer RULE actually fire?

probe-consumers.py proved that the state-gated tokens have real rules in live
sheets but no matching element in the current UI state. That still leaves one
inference unproven: "the rule would apply if such an element existed".

This probe removes the inference. It synthesises ONE element per consumer rule
— carrying exactly the classes and attributes that rule's selector asks for —
and checks whether the rule then resolves on it:

  * `synthesized`  whether an element matching the selector could be built
  * `matchesSel`   el.matches(selector) on that element (the rule is applicable)
  * `before`/`after` the consumed property, read with and without a sentinel
                   written to the token on <body> inline
  * `changed`      whether overriding the token moved that property

This is a SYNTHETIC element test. It answers "is this rule wired and
reachable", NOT "does the app render such an element" — that second question is
answered by probe-consumers.py's match counts. The two probes are meant to be
read together, and this one never claims a UI state was reproduced.

The synthetic nodes are appended to a single off-screen container that is
removed again; nothing about the page or the profile is persisted.

Interpreter: system Python 3.14 (has playwright). Usage: probe-rule-fire.py [light] [dark]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_baseline_lib import AUTHORITY, OUT, URL, VIEWPORT, session_cookie  # noqa: E402
from probe_consumers_defs import EXPECTED, SETTLE_MS, SENTINELS, TARGETS  # noqa: E402

JS_FACTS = r"""
() => ({
  sourceHtml: document.documentElement.getAttribute('data-ds-theme-source'),
  darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
  htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
  bootBg: getComputedStyle(document.body).getPropertyValue('--dsh-boot-bg').trim(),
})
"""

JS_RULE_FIRE = r"""
(payload) => {
  const { targets, sentinels } = payload;

  // ---- split a selector into the pieces an element must carry -------------
  const parse = (sel) => {
    let s = sel.split(',')[0].trim();
    for (const junk of [':hover', ':focus-visible', ':focus', ':active', ':disabled', ':read-write']) {
      s = s.split(junk).join('');
    }
    const classes = (s.match(/\.[A-Za-z0-9_\-]+/g) || []).map((c) => c.slice(1));
    const attrs = [];
    const re = /\[([A-Za-z0-9_\-:]+)(?:([~^$*|]?=)"?([^\]"]*)"?)?\]/g;
    let m;
    while ((m = re.exec(s)) !== null) attrs.push([m[1], m[3] === undefined ? null : m[3]]);
    const tag = (s.match(/^[a-zA-Z][a-zA-Z0-9]*/) || ['div'])[0];
    // a bare class belongs to the rule's own element; a descendant combinator
    // means the rule styles a different element than the first one, so bail out
    const descendant = /[\s>+~]/.test(s.replace(/\[[^\]]*\]/g, ''));
    return { classes, attrs, tag, descendant };
  };

  const host = document.createElement('div');
  host.id = '__dsh_rulefire';
  // rendered (so getComputedStyle resolves) but off-screen and inert
  host.setAttribute(
    'style',
    'position:absolute;left:-32000px;top:0;width:10px;height:10px;pointer-events:none;'
  );
  document.body.appendChild(host);

  // A rule whose subject is body/html/:root must be measured on the REAL root
  // element. Creating a second <body> looks like it works — el.matches('body')
  // is true — but Chromium never renders a nested body, so its computed values
  // go stale and the sentinel appears not to apply. That produced false
  // negatives for `body, body *` rules until this branch was added.
  const ROOT_ISH = /^(:root\b|html\b|body\b)/;

  const build = (sel) => {
    const first = sel.split(',')[0].trim();
    if (ROOT_ISH.test(first)) {
      const el = /^body\b/.test(first) ? document.body : document.documentElement;
      return { el, synthetic: false };
    }
    const spec = parse(sel);
    const el = document.createElement(spec.descendant ? 'div' : spec.tag);
    if (spec.classes.length) el.className = spec.classes.join(' ');
    for (const [name, val] of spec.attrs) el.setAttribute(name, val === null ? '' : val);
    host.appendChild(el);
    return { el, synthetic: true };
  };

  const read = (el, prop) => {
    try { return getComputedStyle(el).getPropertyValue(prop).trim(); }
    catch (e) { return 'ERR:' + String(e).slice(0, 60); }
  };

  const out = {};
  for (const t of targets) {
    const rows = [];
    for (const ref of t.refs) {
      const row = { selector: ref.selector, prop: ref.prop, sheet: ref.sheet };
      let built = null;
      try { built = build(ref.selector); } catch (e) { row.buildError = String(e).slice(0, 80); }
      if (built) {
        const el = built.el;
        row.synthetic = built.synthetic;
        try {
          row.usedSelectorMatches = ref.selector
            .split(',')
            .map((x) => x.trim())
            .some((p) => { try { return el.matches(p); } catch (e) { return false } });
        } catch (e) { row.matchesError = String(e).slice(0, 80); }
        row.before = read(el, ref.prop);
        document.body.style.setProperty(t.name, sentinels[t.name]);
        row.after = read(el, ref.prop);
        document.body.style.removeProperty(t.name);
        row.changed = row.before !== row.after;
      }
      rows.push(row);
    }
    out[t.name] = rows;
  }
  host.remove();
  return out;
}
"""


def main() -> int:
    modes = [a for a in sys.argv[1:] if a in ("light", "dark")] or ["light", "dark"]
    refs = json.loads((OUT / "cssom-refs.json").read_text(encoding="utf-8"))["refs"]
    payload = {
        "targets": [{"name": t, "refs": refs.get(t, [])} for t in TARGETS],
        "sentinels": SENTINELS,
    }

    results: dict = {"authority": AUTHORITY, "modes": {}}

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
            ok = all(facts[k] == v for k, v in EXPECTED[mode].items())
            print(
                f"[{AUTHORITY} {mode}] sourceHtml={facts['sourceHtml']} "
                f"htmlColorScheme={facts['htmlColorScheme']} bootBg={facts['bootBg']} "
                f"FAITHFUL={ok}"
            )
            if not ok:
                print(f"  !! palette does not match the requested mode {mode}; readings NOT trustworthy")
            measured = page.evaluate(JS_RULE_FIRE, payload)
            results["modes"][mode] = {"facts": facts, "rows": measured}
            print(f"  {len(measured)} tokens")
            for token in TARGETS:
                rows = measured[token]
                applic = [r for r in rows if r.get("usedSelectorMatches")]
                fired = [r for r in rows if r.get("changed")]
                real = [r for r in rows if r.get("synthetic") is False]
                print(
                    f"    {token:<34} refs={len(rows):<4} "
                    f"ruleApplicable={len(applic):<4} ruleFired={len(fired):<4} "
                    f"realRootRows={len(real)}"
                )
            context.close()
        browser.close()

    path = OUT / "rule-fire.json"
    path.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"\nwrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
