#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S4 · Offline render verification — does the theme PAINT correctly?

What this proves, and what it deliberately does not
---------------------------------------------------
It proves the theme's own two layers, injected exactly as the shipped bundle
injects them, produce the composited colours the contrast budget was solved
against, in all four states (light/dark x wallpaper on/off).

It does NOT prove the plugin is registered. `theme.overrideTokens` here is a
stand-in that performs the DOM effect the real service performs — writing the
active mode's values as inline custom properties on `body` — and the real service
is the one thing this run cannot exercise without installing the package, which
S4 must not do. Every claim in the report is written against that boundary.

How the injection stays faithful
--------------------------------
The bundle is loaded from disk and its own `factory` is called, so `TOKENS`, `CSS`
and `WALLPAPER_DECLARATIONS` are the shipped bytes. Nothing here re-implements the
stylesheet: a "test CSS" that differs from the package would prove nothing about
the package. The only substitution is the service object handed to `apply`.

How the colours are sampled
---------------------------
From rendered pixels, not from the stylesheet. Each region is screenshotted, and
the sampled background is the MODAL colour of that crop — the pixel the text is
drawn on, rather than the glyphs. The ink comes from `getComputedStyle().color` on
the same element. Neither number is read back out of the CSS this tool wrote.

Secret handling: the session signing secret comes from DSH_SESSION_SECRET, is kept
in memory to sign one cookie, and is never printed, logged, written to a report or
persisted. The cookie value itself is not reported either.

Interpreter: system Python 3.14 (playwright + Pillow).
Usage:
    python tools/verify-render.py              # all four states + official baseline
    python tools/verify-render.py --census     # list candidate anchors, change nothing
    python tools/verify-render.py --light      # one mode
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from io import BytesIO
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_baseline_lib import AUTHORITY, URL, VIEWPORT, session_cookie  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DELIVER = Path(r"<plugins>\tmp\EVA-Inspired-Theme-render")
SHOTS = DELIVER / "shots"
SAMPLES = DELIVER / "samples"

SETTLE_MS = 9000
INK_TARGET = 4.5

# ---- S4 扩展（2026-10-06）：按 ink 令牌采样 ------------------------------------
# 原采样器每个区域只取一个 ink（该区域元素自己的 `color`），实测恰为
# `--dsw-alias-label-primary`，于是 32 对预算里只有 4 对拿到真实像素。这里把
# 「目标墨色」全部列出，按令牌反查真正渲染它的元素，测字下的那个面。
# 值必须与 out/s2-palette.json 的 contrast[*].fgHex 对齐（运行时自校验）。
INK_TOKENS = {
    "label-primary": "--dsw-alias-label-primary",
    "label-secondary": "--dsw-alias-label-secondary",
    "label-tertiary": "--dsw-alias-label-tertiary",
    "label-caption": "--dsw-alias-label-caption",
    "label-dimmed": "--dsw-alias-label-dimmed",
    "brand-primary": "--dsw-alias-brand-primary",
    "link": "--dsw-alias-link",
    "state-error-primary": "--dsw-alias-state-error-primary",
    "state-success-primary": "--dsw-alias-state-success-primary",
    "state-warn-primary": "--dsw-alias-state-warn-primary",
    "state-warn-label": "--dsw-alias-state-warn-label",
    "label-primary-foreground": "--dsw-alias-label-primary-foreground",
}

# 悬停遍要扫的目标：会话列表项（橙色 hover tint）、输入区按钮（品牌橙 / 主按钮墨色）、
# 顶部页签、以及兜底的任意按钮（含图标按钮 —— `label-primary-foreground` 只在这儿出现）。
HOVER_TARGETS = (
    "[role='treeitem']",
    "[data-composer-card] button",
    "[role='tab']",
    "button",
)

# ---------------------------------------------------------------- regions
# A region is a real element in the running app. `opener`, when present, is clicked
# first, and a region whose selector matches nothing is REPORTED as unreachable
# rather than silently dropped -- an unverified region must not read as a verified
# one. Selectors are `data-*` contracts or ARIA roles, never CSS-Modules hashes.
REGIONS = [
    # `selector` is tried first, then each of `alternates`. The first draft used one
    # selector per region and four of them came back zero-area: this profile runs the
    # `dsh-better-sidebar` plugin, so `[data-slot='sidebar']` exists but is collapsed,
    # and the visible chrome is a different attribute. A region that cannot be reached
    # is reported with its measured rect, never silently dropped.
    {"name": "sidebar", "selector": "[data-slot='sidebar']",
     "alternates": ["[data-dsh-better-sidebar]", "[data-side='sidebar']",
                    "[data-slot='sidebar.brand.mark']"],
     "what": "侧栏（导航 / 会话列表）"},
    {"name": "main-column", "selector": "[data-dsh-center-col]",
     "alternates": ["[data-slot='main']", "[data-conversation-scroll]"],
     "what": "正文列"},
    {"name": "conversation", "selector": "[data-conversation-content]",
     "what": "会话内容面"},
    {"name": "composer", "selector": "[data-composer-card]",
     "alternates": ["[data-composer-input]", "[data-composer-seat]"],
     "what": "输入区"},
    {"name": "header", "selector": "[data-conversation-header-leading]",
     "alternates": ["[data-conversation-header-corner]"],
     "what": "会话头部"},
    {"name": "code-block", "selector": "pre code", "alternates": ["pre"],
     "what": "代码块"},
    {"name": "menu-overlay", "selector": "[role='dialog'], [role='menu'], [role='listbox']",
     "what": "浮层 / 弹出层",
     "opener": "[data-testid='billing-trigger']"},
    {"name": "settings", "selector": "[data-slot='settings'], [data-settings-panel]",
     "what": "设置页",
     "expectUnreachable": "the official settings UI is disabled in this profile "
                          "(`- id: ui-settings` carries `config: {enabled: false}`), so the "
                          "page does not exist to screenshot"},
]

# The token chain: S1 official -> S2 design -> S3 generated -> S4 browser actual.
CHAIN_FILES = {
    "s1-official": ROOT / "out" / "s2-token-baseline.json",
    "s2-design": ROOT / "out" / "s2-palette.json",
    "s3-generated": ROOT / "src" / "tokens.json",
}

# ------------------------------------------------------------------- page JS

JS_INSTALL_LOADER = r"""
() => {
  window.__S4__ = {
    spec: null, applied: [], disposers: [], errors: [],
    savedLoader: window.__ModuleLoader__ || null,
  };
  window.__ModuleLoader__ = {
    load: (spec) => { window.__S4__.spec = spec; return undefined },
  };
  return true;
}
"""

JS_APPLY = r"""
() => {
  const S = window.__S4__;
  if (!S.spec) return { ok: false, why: 'the bundle never called __ModuleLoader__.load' };
  let mod;
  try {
    mod = S.spec.factory((name) => { throw new Error('unexpected require(' + name + ')') });
  } catch (e) {
    return { ok: false, why: 'factory threw: ' + String(e) };
  }
  const modeOf = () => (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light');
  const theme = {
    overrideTokens: (source, tokens) => {
      const mode = modeOf();
      const names = [];
      for (const key of Object.keys(tokens)) {
        const value = tokens[key][mode];
        if (typeof value !== 'string') { S.errors.push(key + ' has no ' + mode + ' value'); continue }
        document.body.style.setProperty(key, value);
        names.push(key);
      }
      S.applied = names;
      S.source = source;
      return () => { for (const key of names) document.body.style.removeProperty(key) };
    },
  };
  const ctx = {
    get: (name) => (name === 'theme' ? theme : undefined),
    effect: (fn, label) => {
      try { S.disposers.push(fn()) } catch (e) { S.errors.push('effect ' + label + ': ' + String(e)) }
      return () => {};
    },
  };
  try {
    mod.apply(ctx);
  } catch (e) {
    return { ok: false, why: 'apply threw: ' + String(e) };
  }
  return {
    ok: true,
    id: S.spec.id,
    exports: Object.keys(mod),
    injects: mod.inject || null,
    applied: S.applied.length,
    errors: S.errors,
  };
}
"""

JS_WALLPAPER_OFF = r"""
() => {
  document.documentElement.style.setProperty('--cp-pick-light', 'none');
  document.documentElement.style.setProperty('--cp-pick-dark', 'none');
  return true;
}
"""

JS_STATE = r"""
() => {
  const cs = getComputedStyle(document.body);
  const body = {};
  for (const name of Array.from(cs)) if (name.startsWith('--')) body[name] = cs.getPropertyValue(name).trim();
  const html = {};
  const hcs = getComputedStyle(document.documentElement);
  for (const name of Array.from(hcs)) if (name.startsWith('--')) html[name] = hcs.getPropertyValue(name).trim();
  const bs = getComputedStyle(document.body);
  return {
    bodyVars: body,
    htmlVars: html,
    bodyInlineStyle: document.body.getAttribute('style'),
    htmlInlineStyle: document.documentElement.getAttribute('style'),
    bodyAttrs: Array.from(document.body.attributes).map(a => a.name),
    htmlAttrs: Array.from(document.documentElement.attributes).map(a => a.name),
    bodyBackgroundColor: bs.backgroundColor,
    /* 'yes'/'no' is useless here: the veil gradient is ALWAYS a background-image, so
       a boolean would read 'yes' even with the art removed. Report whether an actual
       url() layer is present -- that is the thing being switched. */
    bodyBackgroundKind: (() => {
      const img = bs.backgroundImage
      if (img === 'none') return 'none'
      return img.includes('url(') ? 'gradient+url' : 'gradient-only'
    })(),
    bodyBackgroundLayers: (bs.backgroundImage === 'none')
      ? 0 : bs.backgroundImage.split(/,(?![^(]*\))/).length,
    wallVars: {
      pick: hcs.getPropertyValue('--cp-pick-light').trim().slice(0, 40),
      pickDark: hcs.getPropertyValue('--cp-pick-dark').trim().slice(0, 40),
      wall: bs.getPropertyValue('--cp-wall').trim().slice(0, 40),
    },
    stylesInjected: document.querySelectorAll('style[data-plugin]').length,
    pluginStyleBytes: (document.querySelector('style[data-plugin]') || {}).textContent
      ? document.querySelector('style[data-plugin]').textContent.length : 0,
  };
}
"""

JS_REGION = r"""
(selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    backgroundImage: cs.backgroundImage === 'none' ? 'none' : 'yes',
    display: cs.display,
    visibility: cs.visibility,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    borderRadius: cs.borderRadius,
    cornerShape: (cs.cornerShape !== undefined ? cs.cornerShape : null),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    text: (el.textContent || '').trim().slice(0, 60),
  };
}
"""

JS_FIND_INK = r"""
(wanted) => {
  /* S4 extension: locate the elements that actually RENDER each target ink.
     `wanted` maps token -> a CSS colour value (the value that token has in the
     state being measured). Colours are compared through getComputedStyle so any
     syntax (hex / rgb / oklch) normalises the same way. Only elements with their
     OWN text node count: a wrapper inherits `color` and would match everywhere. */
  const norm = (value) => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.color = value;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  };
  const byColour = {};
  for (const [token, value] of Object.entries(wanted || {})) {
    if (!value) continue;
    const key = norm(value);
    (byColour[key] = byColour[key] || []).push(token);
  }
  const found = {};
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const tokens = byColour[cs.color];
    if (!tokens) continue;
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (parseFloat(cs.opacity) < 0.5) continue;
    const ownText = Array.from(el.childNodes)
      .some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    /* 图标按钮也是合法的墨色载体：字形是 <svg> 且用 currentColor 取色，元素自身的
       computed color 就是那支墨。加这一条是为了 hover 遍 —— `label-primary-foreground`
       （品牌填充上的墨）几乎只出现在图标按钮上。 */
    const iconEl = el.querySelector(':scope > svg, :scope > span > svg');
    const hasIcon = !!iconEl && iconEl.getBoundingClientRect().width >= 8;
    if (!ownText && !hasIcon) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    if (r.right < 0 || r.left > window.innerWidth) continue;
    const text = (el.innerText || el.textContent || '').trim();
    for (const token of tokens) {
      (found[token] = found[token] || []).push({
        token,
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').toString().slice(0, 60),
        kind: ownText ? 'text' : 'icon',
        text: text.slice(0, 48),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
      });
    }
  }
  for (const token of Object.keys(found)) {
    found[token].sort((a, b) =>
      (b.text.length - a.text.length) || (b.rect.width - a.rect.width));
    found[token] = found[token].slice(0, 3);
  }
  return found;
}
"""

JS_HOVER_BOXES = r"""
(payload) => {
  /* 可见元素的中心点（上限 limit 个），供 hover 遍使用：逐个悬停后再跑一次
     ink 探测，抓只在 hover 态出现的墨色（品牌橙 tint、图标按钮上的墨）。 */
  const { selector, limit } = payload;
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.top < 0 || r.bottom > window.innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (parseFloat(cs.opacity) < 0.5) continue;
    out.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    if (out.length >= (limit || 6)) break;
  }
  return out;
}
"""

JS_MODAL = r"""
() => {
  const dialogs = Array.from(document.querySelectorAll("[role='dialog']"))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 40 && r.height > 40 && cs.display !== 'none' && cs.visibility !== 'hidden';
    });
  if (dialogs.length === 0) return { open: false };
  /* A scrim is any large element painting a translucent colour over the app. The
     theme owns `--dsw-alias-bg-mask-*`, so finding one proves the mask is live. */
  const scrims = Array.from(document.querySelectorAll('*')).filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.8 || r.height < window.innerHeight * 0.8) return false;
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(',').map((v) => parseFloat(v));
    return parts.length === 4 && parts[3] > 0.01 && parts[3] < 0.99;
  }).map((el) => ({
    tag: el.tagName.toLowerCase(),
    bg: getComputedStyle(el).backgroundColor,
    attrs: Array.from(el.attributes).filter((a) => a.name.startsWith('data-'))
      .map((a) => a.name + '=' + a.value).slice(0, 4),
  }));
  return {
    open: true,
    dialogText: (dialogs[0].textContent || '').trim().slice(0, 40),
    scrims: scrims.slice(0, 4),
  };
}
"""

JS_DISMISS = r"""
() => {
  const dialogs = Array.from(document.querySelectorAll("[role='dialog']")).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  });
  if (dialogs.length === 0) return { dismissed: false, why: 'no dialog' };
  const dialog = dialogs[0];
  const buttons = Array.from(dialog.querySelectorAll('button'));
  const primary = buttons.find((b) => /继续|知道了|开始|Continue|Got it|OK|Close/i
    .test(b.textContent || '')) || buttons[buttons.length - 1];
  if (!primary) return { dismissed: false, why: 'no button', buttons: buttons.length };
  primary.click();
  return { dismissed: true, via: (primary.textContent || '').trim().slice(0, 20),
           buttons: buttons.length };
}
"""

JS_OPEN_SESSION = r"""
() => {
  const items = Array.from(document.querySelectorAll("[role='treeitem']"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 });
  return { candidates: items.length };
}
"""

JS_OPEN_NTH = r"""
(n) => {
  const items = Array.from(document.querySelectorAll("[role='treeitem']"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 });
  if (n >= items.length) return { opened: false, why: 'index past the end', candidates: items.length };
  items[n].click();
  return { opened: true, index: n, label: (items[n].textContent || '').trim().slice(0, 30) };
}
"""

JS_HAS_CODE = r"""
() => {
  const pre = Array.from(document.querySelectorAll('pre'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20 });
  return { pre: pre.length, first: pre.length ? pre[0].getBoundingClientRect().height : 0 };
}
"""

JS_CLOSE_POPOVER = r"""
() => { document.body.dispatchEvent(new KeyboardEvent('keydown',
  { key: 'Escape', bubbles: true })); return true }
"""


def settle_page(page, results: dict, mode: str) -> None:
    """Put the app into the same, undisturbed state for every capture.

    Three things have to happen, and each is recorded rather than assumed:

    1. The app opens on its hero screen with a first-run notice over a modal scrim,
       and that scrim is one of the tokens this theme overrides -- so measuring
       through it would report the theme's `--dsw-alias-bg-mask-1` instead of its
       surfaces. The notice is closed first.
    2. The hero screen has no transcript, so a session is opened -- otherwise there
       is no Markdown and no code block to photograph.
    3. Sessions are tried in order until one actually contains a `pre`, because the
       first entry in the list may itself be empty. Bounded at 6 attempts.
    """
    before = page.evaluate(JS_MODAL)
    dismissed = {"dismissed": False, "why": "no modal"}
    if before.get("open"):
        dismissed = page.evaluate(JS_DISMISS)
        page.wait_for_timeout(1500)
    after = page.evaluate(JS_MODAL)

    listing = page.evaluate(JS_OPEN_SESSION)
    attempts = []
    opened = {"opened": False, "why": "no visible treeitem"}
    # Newest first: the sessions most likely to hold Markdown and code are the recent
    # ones, and the list is ordered oldest-to-newest.
    count = listing.get("candidates", 0)
    order = list(range(count))[::-1][:6]
    for index in order:
        opened = page.evaluate(JS_OPEN_NTH, index)
        page.wait_for_timeout(2500)
        code = page.evaluate(JS_HAS_CODE)
        attempts.append({"index": index, "label": opened.get("label"), "pre": code.get("pre")})
        if code.get("pre", 0) > 0:
            break

    results.setdefault("pageState", {})[mode] = {
        "modalBefore": before, "dismissed": dismissed, "modalAfter": after,
        "sessionCandidates": listing.get("candidates"),
        "sessionAttempts": attempts,
        "finalSession": opened,
    }


# ------------------------------------------------------------------ helpers

def parse_rgb(text: str) -> tuple[int, int, int]:
    text = text.strip()
    if text.startswith("rgb"):
        inner = text[text.index("(") + 1:text.rindex(")")]
        parts = [p.strip() for p in inner.split(",")]
        return tuple(int(round(float(p))) for p in parts[:3])  # type: ignore[return-value]
    if text.startswith("#"):
        h = text.lstrip("#")[:6]
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    raise ValueError(f"not a colour: {text!r}")


def linearise(value: float) -> float:
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rel_lum(rgb) -> float:
    r, g, b = (linearise(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = (la, lb) if la >= lb else (lb, la)
    return (hi + 0.05) / (lo + 0.05)


def modal_colour(png: bytes) -> tuple[tuple[int, int, int], float]:
    """The pixel the text is drawn on: the most frequent colour of the crop.

    A rendered region is mostly background with glyphs on it, so the mode is the
    surface. Quantised to 4-bit steps first, because a gradient or a wallpaper
    never repeats an exact triple and an unquantised mode would return noise.
    """
    image = Image.open(BytesIO(png)).convert("RGB")
    if image.width < 3 or image.height < 3:
        return image.getpixel((0, 0)), 1.0
    pixels = list(image.getdata())
    quantised = Counter((r >> 4 << 4, g >> 4 << 4, b >> 4 << 4) for r, g, b in pixels)
    bucket, hits = quantised.most_common(1)[0]
    # Average the exact pixels inside the winning bucket: the bucket is 16 wide.
    members = [(r, g, b) for r, g, b in pixels
               if (r >> 4 << 4, g >> 4 << 4, b >> 4 << 4) == bucket]
    avg = tuple(round(sum(c[i] for c in members) / len(members)) for i in range(3))
    return avg, hits / len(pixels)


def font(size: int):
    for name in ("msyh.ttc", "segoeui.ttf", "arial.ttf"):
        path = Path(os.environ.get("SystemRoot", "")) / "Fonts" / name
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


def side_by_side(left: Path, right: Path, target: Path, labels: tuple[str, str]) -> None:
    a, b = Image.open(left).convert("RGB"), Image.open(right).convert("RGB")
    h = min(a.height, b.height)
    a = a.resize((round(a.width * h / a.height), h), Image.LANCZOS)
    b = b.resize((round(b.width * h / b.height), h), Image.LANCZOS)
    gap, band = 12, 30
    out = Image.new("RGB", (a.width + b.width + gap * 3, h + band + gap * 2), (18, 20, 24))
    out.paste(a, (gap, gap + band))
    out.paste(b, (gap * 2 + a.width, gap + band))
    draw = ImageDraw.Draw(out)
    f = font(18)
    draw.text((gap + 2, gap + 4), labels[0], font=f, fill=(220, 226, 234))
    draw.text((gap * 2 + a.width + 2, gap + 4), labels[1], font=f, fill=(220, 226, 234))
    target.parent.mkdir(parents=True, exist_ok=True)
    out.save(target)


# --------------------------------------------------------------------- run

def close_popover(page, opened_by) -> None:
    """Close a region's popover, ALWAYS.

    The first version closed it only on the unreachable path, so the billing
    popover opened for `menu-overlay` stayed up through the following state's
    capture and dimmed every surface in it -- which is how the no-wallpaper state
    came back with impossibly dark values (a white composer sampling as #a5a7ab).
    An opener is a loan; it gets returned on every path out.
    """
    if not opened_by or not str(opened_by).endswith("]"):
        return
    page.evaluate(JS_CLOSE_POPOVER)
    page.wait_for_timeout(500)
    still = page.evaluate("(sel) => document.querySelectorAll(sel).length", opened_by)
    return still


def ink_pixel_share(png: bytes, ink, tol: float = 90.0) -> float:
    """裁剪里「贴着墨色」的像素占比 —— 用来证明文字确实落在这一刀里。

    占比过低说明这一刀没切到字，样本不可用；它不参与对比度计算，只做自检。
    """
    img = Image.open(BytesIO(png)).convert("RGB")
    data = img.tobytes()
    total = len(data) // 3
    if total == 0:
        return 0.0
    near = 0
    for i in range(0, total * 3, 3):
        dr = data[i] - ink[0]
        dg = data[i + 1] - ink[1]
        db = data[i + 2] - ink[2]
        if dr * dr + dg * dg + db * db <= tol * tol:
            near += 1
    return near / total


def sample_inks(page, tag: str, state: dict, results: dict) -> None:
    """第二个采样面：按 ink 令牌定位承载文字的元素，测「字下的那个面」。

    S4 扩展（2026-10-06）。每个命中裁该元素的字行（外扩 3px），取 4bit 量化众数色
    当表面 —— 字行里背景像素占多数，所以众数就是墨下之面；`inkPixelShare` 与
    `surfaceShare` 一并记录，低值样本在报告里按低可靠度登记，不丢弃。
    """
    palette = json.loads((ROOT / "out" / "s2-palette.json").read_text(encoding="utf-8"))
    targets = palette.get("targets", {})
    body_vars = state.get("bodyVars", {})
    wanted = {tok: body_vars[tok] for tok in INK_TOKENS.values() if body_vars.get(tok)}
    if not wanted:
        results["inkSamples"][tag] = {}
        return
    bucket: dict = {}
    seen: set = set()
    serial: dict = {}

    def collect(found, hovered_by=None):
        """裁每个命中并记一行；去重键含墨色 / 元素 / 文字 / kind / hovered_by。"""
        for token, hits in sorted((found or {}).items()):
            name = next((n for n, t in INK_TOKENS.items() if t == token), token)
            target = float(targets.get(name, INK_TARGET))
            for hit in hits[:3]:
                key = (token, hit["tag"], hit["cls"], (hit.get("text") or "")[:16],
                       hit.get("kind"), hovered_by)
                if key in seen:
                    continue
                seen.add(key)
                rect = hit["rect"]
                pad = 3
                x = max(0, rect["x"] - pad)
                y = max(0, rect["y"] - pad)
                width = min(rect["width"] + pad * 2, VIEWPORT["width"] - x, 480)
                height = min(rect["height"] + pad * 2, VIEWPORT["height"] - y, 120)
                if width < 4 or height < 4:
                    continue
                png = page.screenshot(clip={"x": x, "y": y, "width": width, "height": height})
                index = serial.get(name, 0)
                serial[name] = index + 1
                shot = SAMPLES / f"{tag}-ink-{name}-{index}.png"
                shot.parent.mkdir(parents=True, exist_ok=True)
                shot.write_bytes(png)
                surface, share = modal_colour(png)
                ink = parse_rgb(hit["color"])
                ratio = contrast(ink, surface)
                bucket.setdefault(name, []).append({
                    "inkToken": token,
                    "inkName": name,
                    "target": target,
                    "element": {"tag": hit["tag"], "class": hit["cls"]},
                    "kind": hit.get("kind", "text"),
                    "hoveredBy": hovered_by,
                    "text": hit["text"],
                    "inkFromComputedStyle": hit["color"],
                    "inkHex": "#%02x%02x%02x" % ink,
                    "surfaceRGB": list(surface),
                    "surfaceHex": "#%02x%02x%02x" % surface,
                    "surfaceShare": round(share, 4),
                    "surfaceFromCss": hit["backgroundColor"],
                    "inkPixelShare": round(ink_pixel_share(png, ink), 4),
                    "contrast": round(ratio, 2),
                    "pass": ratio >= target,
                    "fontSize": hit["fontSize"],
                    "fontWeight": hit["fontWeight"],
                    "crop": {"x": x, "y": y, "width": width, "height": height},
                })

    base = page.evaluate(JS_FIND_INK, wanted)
    collect(base)

    # 悬停遍（只对主题态）：有些墨色只在 hover 态出现（品牌橙 tint、图标按钮上的墨），
    # 而悬停是自然交互、不是伪造状态。只追基础遍没采到的墨色，命中即从 missing 移除
    # —— 样本量因此有界，不会因为遍历按钮而爆掉。
    if tag.startswith("theme-"):
        missing = [t for t in INK_TOKENS.values() if t not in (base or {})]
        if missing:
            for selector in HOVER_TARGETS:
                if not missing:
                    break
                try:
                    boxes = page.evaluate(JS_HOVER_BOXES, {"selector": selector, "limit": 6})
                except Exception:  # noqa: BLE001
                    boxes = []
                for box_index, box in enumerate(boxes or []):
                    if not missing:
                        break
                    try:
                        page.mouse.move(box["x"], box["y"])
                        page.wait_for_timeout(220)
                        hits = page.evaluate(JS_FIND_INK, wanted)
                    except Exception:  # noqa: BLE001
                        continue
                    hits = {t: v for t, v in (hits or {}).items() if t in missing}
                    if hits:
                        collect(hits, hovered_by=f"{selector}#{box_index}")
                        for t in list(hits):
                            if t in missing:
                                missing.remove(t)
            try:
                page.mouse.move(2, 2)
                page.wait_for_timeout(120)
            except Exception:  # noqa: BLE001
                pass

    results["inkSamples"][tag] = bucket


def capture(page, mode: str, wallpaper: bool, tag: str, client_js: str,
            regions: list[dict], results: dict) -> None:
    """Screenshot, sample and record one render state."""
    state = page.evaluate(JS_STATE)
    results["states"][tag] = {
        "mode": mode,
        "wallpaper": wallpaper,
        "bodyBackgroundColor": state["bodyBackgroundColor"],
        "bodyBackgroundKind": state["bodyBackgroundKind"],
        "bodyBackgroundLayers": state["bodyBackgroundLayers"],
        "wallVars": state["wallVars"],
        "stylesInjected": state["stylesInjected"],
        "pluginStyleChars": state["pluginStyleBytes"],
        "bodyVarCount": len(state["bodyVars"]),
        "htmlVarCount": len(state["htmlVars"]),
        "bodyVars": state["bodyVars"],
    }

    full = SHOTS / f"{tag}.png"
    full.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(full))

    results["samples"][tag] = {}
    for region in regions:
        # A region that only exists behind an interaction says so and is opened here.
        # Nothing is edited: these are display popovers, and Escape closes them again.
        opened_by = None
        if region.get("opener"):
            try:
                page.click(region["opener"], timeout=4000)
                page.wait_for_timeout(900)
                opened_by = region["opener"]
            except Exception as exc:  # noqa: BLE001
                opened_by = f"opener failed: {type(exc).__name__}"
        observed = None
        if opened_by and not str(opened_by).startswith("opener failed"):
            observed = page.evaluate(
                "(sel) => document.querySelectorAll(sel).length", region["selector"])
        attempts = [region["selector"]] + list(region.get("alternates", []))
        info = None
        used = None
        tried = []
        for selector in attempts:
            candidate = page.evaluate(JS_REGION, selector)
            if candidate is None:
                tried.append(f"{selector}: no match")
                continue
            rect = candidate["rect"]
            tried.append(f"{selector}: {rect['width']:.0f}x{rect['height']:.0f} "
                         f"display={candidate['display']}")
            if rect["width"] >= 8 and rect["height"] >= 8:
                info, used = candidate, selector
                break
        if info is None:
            entry = {"reachable": False, "selector": region["selector"],
                     "what": region.get("what"), "tried": tried}
            if opened_by:
                entry["opener"] = opened_by
            if region.get("expectUnreachable"):
                entry["expectedUnreachable"] = region["expectUnreachable"]
            results["samples"][tag][region["name"]] = entry
            if observed is not None:
                results["samples"][tag][region["name"]]["observed"] = observed
            close_popover(page, opened_by)
            continue
        selector = used
        rect = info["rect"]
        # Sample a slice inside the region, away from its edges and its first line
        # of text, so the crop is mostly surface.
        pad = 6
        width = max(8, min(rect["width"] - pad * 2, 420))
        height = max(8, min(rect["height"] - pad * 2, 90))
        x = min(max(rect["x"] + pad, 0), VIEWPORT["width"] - 8)
        y = min(max(rect["y"] + pad + 26, 0), VIEWPORT["height"] - 8)
        width = min(width, VIEWPORT["width"] - x)
        height = min(height, VIEWPORT["height"] - y)
        if width < 4 or height < 4:
            results["samples"][tag][region["name"]] = {
                "reachable": False, "selector": selector, "why": "crop out of viewport",
                "tried": tried}
            continue
        png = page.screenshot(clip={"x": x, "y": y, "width": width, "height": height})
        (SAMPLES / f"{tag}-{region['name']}.png").parent.mkdir(parents=True, exist_ok=True)
        (SAMPLES / f"{tag}-{region['name']}.png").write_bytes(png)
        surface, share = modal_colour(png)
        ink = parse_rgb(info["color"])
        ratio = contrast(ink, surface)
        results["samples"][tag][region["name"]] = {
            "reachable": True,
            "selector": selector,
            "what": region["what"],
            "surfaceRGB": list(surface),
            "surfaceHex": "#%02x%02x%02x" % surface,
            "surfaceShare": round(share, 4),
            "inkRGB": list(ink),
            "inkHex": "#%02x%02x%02x" % ink,
            "inkFromComputedStyle": info["color"],
            "contrast": round(ratio, 2),
            "target": INK_TARGET,
            "pass": ratio >= INK_TARGET,
            "surfaceFromCss": info["backgroundColor"],
            "text": info["text"],
            "fontFamily": info["fontFamily"][:60],
            "borderRadius": info["borderRadius"],
            "cornerShape": info["cornerShape"],
            "crop": {"x": x, "y": y, "width": width, "height": height},
        }
        close_popover(page, opened_by)

    # Second sampling pass (S4 extension): every target ink, on the surface it
    # actually sits on. Runs last so the popovers a region opened are already closed.
    sample_inks(page, tag, state, results)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--census", action="store_true")
    parser.add_argument("--light", action="store_true")
    parser.add_argument("--dark", action="store_true")
    args = parser.parse_args()

    DELIVER.mkdir(parents=True, exist_ok=True)
    SHOTS.mkdir(parents=True, exist_ok=True)
    SAMPLES.mkdir(parents=True, exist_ok=True)

    client_js = (ROOT / "client.js").read_text(encoding="utf-8")
    tokens_src = json.loads((ROOT / "src" / "tokens.json").read_text(encoding="utf-8"))
    budget = json.loads((ROOT / "build" / "veil-budget.json").read_text(encoding="utf-8"))
    TOKENS = tokens_src["tokens"]

    modes = [m for m, flag in (("light", args.light), ("dark", args.dark)) if flag] \
        or ["light", "dark"]

    results: dict = {
        "authority": AUTHORITY,
        "viewport": VIEWPORT,
        "inkTarget": INK_TARGET,
        "states": {},
        "samples": {},
        "inkSamples": {},
        "injection": {},
        "baselineDiff": {},
        "chain": {},
    }

    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for mode in modes:
            # ---- A. official baseline (no injection) -------------------------
            ctx = browser.new_context(viewport=VIEWPORT, color_scheme=mode)
            ctx.add_cookies(session_cookie())
            page = ctx.new_page()
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_selector("#root", timeout=30_000)
            page.wait_for_timeout(SETTLE_MS)

            if args.census:
                census = page.evaluate(
                    r"""() => {
                      const counts = {};
                      for (const el of document.querySelectorAll('*')) {
                        for (const a of el.attributes) {
                          if (!a.name.startsWith('data-')) continue;
                          const key = a.name;
                          counts[key] = (counts[key] || 0) + 1;
                        }
                      }
                      const roles = {};
                      for (const el of document.querySelectorAll('[role]')) {
                        const r = el.getAttribute('role');
                        roles[r] = (roles[r] || 0) + 1;
                      }
                      return { dataAttrs: counts, roles };
                    }""")
                results.setdefault("census", {})[mode] = census
                ctx.close()
                continue

            official_vars = page.evaluate(JS_STATE)["bodyVars"]
            settle_page(page, results, f"official-{mode}")
            capture(page, mode, False, f"official-{mode}", client_js, REGIONS, results)
            ctx.close()

            # ---- B. theme with wallpaper -------------------------------------
            ctx = browser.new_context(viewport=VIEWPORT, color_scheme=mode)
            ctx.add_cookies(session_cookie())
            page = ctx.new_page()
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_selector("#root", timeout=30_000)
            page.wait_for_timeout(SETTLE_MS)

            # The app opens on its hero/empty screen, which has no Markdown and no code
            # block, behind a first-run notice whose scrim is itself a themed token.
            # Closing it and opening the first session is read-only navigation and is
            # what makes the required regions exist in a measurable state.
            settle_page(page, results, mode)

            page.evaluate(JS_INSTALL_LOADER)
            page.add_script_tag(content=client_js)
            applied = page.evaluate(JS_APPLY)
            page.wait_for_timeout(1200)
            results["injection"][mode] = applied

            after_vars = page.evaluate(JS_STATE)["bodyVars"]
            changed = sorted(k for k in set(official_vars) & set(after_vars)
                             if official_vars[k] != after_vars[k])
            added = sorted(set(after_vars) - set(official_vars))
            removed = sorted(set(official_vars) - set(after_vars))
            results["baselineDiff"][mode] = {
                "officialVarCount": len(official_vars),
                "themedVarCount": len(after_vars),
                "changed": changed,
                "changedCount": len(changed),
                "added": added,
                "removed": removed,
            }

            # Token chain, step four: what the BROWSER says, per token.
            chain = {}
            for token in TOKENS:
                chain[token] = {
                    "s3": TOKENS[token][mode],
                    "s4": after_vars.get(token),
                    "s4matchesS3": after_vars.get(token) == TOKENS[token][mode],
                }
            results["chain"][mode] = chain

            capture(page, mode, True, f"theme-wall-{mode}", client_js, REGIONS, results)

            # ---- C. theme without wallpaper ----------------------------------
            page.evaluate(JS_WALLPAPER_OFF)
            page.wait_for_timeout(600)
            capture(page, mode, False, f"theme-nowall-{mode}", client_js, REGIONS, results)

            # ---- side-by-side pairs ------------------------------------------
            for region in REGIONS:
                name = region["name"]
                a = SAMPLES / f"official-{mode}-{name}.png"
                b = SAMPLES / f"theme-wall-{mode}-{name}.png"
                if a.exists() and b.exists():
                    side_by_side(a, b, DELIVER / "compare" / f"{mode}-{name}.png",
                                 (f"OFFICIAL  {mode}", f"EVANGELION {mode}"))
            side_by_side(SHOTS / f"official-{mode}.png", SHOTS / f"theme-wall-{mode}.png",
                         DELIVER / "compare" / f"{mode}-fullpage.png",
                         (f"OFFICIAL  {mode}", f"EVANGELION {mode}"))

            ctx.close()

        # Did dismissing the notice change anything durable? A fresh context must still
        # show it -- otherwise this verification would have quietly altered the app.
        ctx = browser.new_context(viewport=VIEWPORT, color_scheme="light")
        ctx.add_cookies(session_cookie())
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=30_000)
        page.wait_for_timeout(SETTLE_MS)
        results["noticeStillShownInFreshContext"] = page.evaluate(JS_MODAL)
        ctx.close()
        browser.close()

    if args.census:
        (DELIVER / "census.json").write_text(
            json.dumps(results.get("census", {}), ensure_ascii=False, indent=1), encoding="utf-8")
        for mode, data in results.get("census", {}).items():
            out = []
            for name, count in sorted(data["dataAttrs"].items(), key=lambda kv: -kv[1]):
                out.append(f"{name}={count}")
            print(f"[{mode}] data-* attributes ({len(out)}):")
            print("  " + "  ".join(out))
            print(f"[{mode}] roles: {data['roles']}")
        print(f"\nwrote {DELIVER / 'census.json'}")
        return 0

    # -------------------------------------------------- chain: S1 -> S2 -> S3
    official = {r["token"]: r for r in
                json.loads(CHAIN_FILES["s1-official"].read_text(encoding="utf-8"))["rows"]}
    design = json.loads(CHAIN_FILES["s2-design"].read_text(encoding="utf-8"))["palette"]
    chain_report = {"s2EqualsS1": [], "s3ExtendsS2": [], "s3IsS2": 0, "s3ToS4": []}
    for token in TOKENS:
        s1 = official.get(token)
        for mode in ("light", "dark"):
            s2v = design[mode].get(token)
            s3v = TOKENS[token][mode]
            s4v = results["chain"].get(mode, {}).get(token, {}).get("s4")
            if s1 is not None and s2v is not None and s2v == s1[mode]:
                chain_report["s2EqualsS1"].append({"token": token, "mode": mode, "value": s2v})
            if s2v is not None and s3v == s2v:
                chain_report["s3IsS2"] += 1
            elif s2v is not None and s3v.lower().startswith(s2v.lower()) and len(s3v) == len(s2v) + 2:
                # The two veil surfaces: S2 measured an opaque fill, S3 emits the same
                # colour with the solved alpha byte appended. That is the only permitted
                # S2->S3 difference, and it is recorded rather than tolerated silently.
                chain_report["s3ExtendsS2"].append({
                    "token": token, "mode": mode, "s2": s2v, "s3": s3v,
                    "alphaByte": s3v[-2:],
                    "alphaValue": round(int(s3v[-2:], 16) / 255, 4),
                })
            elif s2v is not None:
                chain_report["s3ToS4"].append({"token": token, "mode": mode,
                                              "s2": s2v, "s3": s3v, "kind": "unexplained s2->s3"})
            if s4v is not None and s4v != s3v:
                chain_report["s3ToS4"].append({"token": token, "mode": mode,
                                              "s3": s3v, "s4": s4v, "kind": "s3 != browser"})
    results["chainReport"] = chain_report

    # ------------------------------------- classify every changed body property
    # 55 of the changes are the theme's own. The rest are THIRD-PARTY plugin variables
    # that derive from official aliases this theme overrides (`--ds-t-*` -> label-*,
    # `--dsb*` -> bg-layer-*, and so on). Calling those "unexplained drift" would be
    # wrong; calling them "expected" without evidence would be worse. So each one is
    # traced to the theme token its official declaration reads.
    declared = {}
    if (ROOT / "out" / "cssom-refs.json").exists():
        declared = json.loads((ROOT / "out" / "cssom-refs.json").read_text(encoding="utf-8"))["declared"]
    upstream = {}
    varref = __import__("re").compile(r"var\(\s*(--[A-Za-z0-9_-]+)")
    for name, entries in declared.items():
        for entry in entries:
            for ref in varref.findall(entry.get("value") or ""):
                upstream.setdefault(name, set()).add(ref)
    def trace(name, depth=0):
        if depth > 4:
            return None
        for parent in upstream.get(name, ()):  # direct or transitive
            if parent in TOKENS:
                return parent
            found = trace(parent, depth + 1)
            if found is not None:
                return found
        return None

    classification = {"direct": [], "derived": [], "paintLayer": [], "unexplained": []}
    # `--cp-wall-<id>` names are generated by tools/build-client.mjs:65 from
    # build/wallpapers.json, so this set is the ONE place a wallpaper swap has to be
    # mirrored by hand. EVA ships light 8g9wyy / dark yqmlmx.
    paint_names = {"--cp-wall", "--cp-pick-light", "--cp-pick-dark",
                   "--cp-wall-8g9wyy", "--cp-wall-yqmlmx"}
    for mode in modes:
        diff = results["baselineDiff"].get(mode, {})
        for name in diff.get("changed", []):
            if name in TOKENS:
                classification["direct"].append(name)
            elif name in paint_names:
                classification["paintLayer"].append(name)
            else:
                source = trace(name)
                if source is not None:
                    classification["derived"].append({"var": name, "from": source})
                else:
                    classification["unexplained"].append(name)
        for name in diff.get("added", []):
            (classification["paintLayer"] if name in paint_names
             else classification["unexplained"]).append(name)
    results["classification"] = classification
    results["veil"] = {"alpha": tokens_src["meta"]["veilAlpha"],
                       "surfaces": tokens_src["meta"]["translucentSurfaces"],
                       "budgetChosen": {m: budget["modes"][m]["chosenAlpha"]
                                        for m in budget["modes"]}}

    (DELIVER / "samples.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")

    # ------------------------------------------------------------- console
    print(f"S4 render verification @ {AUTHORITY}  viewport {VIEWPORT['width']}x{VIEWPORT['height']}")
    for mode in modes:
        pstate = results.get("pageState", {}).get(mode, {})
        ps = results.get("pageState", {}).get(f"official-{mode}", {})
        for label, entry in (("official", ps), (mode, pstate)):
            if not entry:
                continue
            before = entry.get("modalBefore", {})
            print(f"\n[{label}] modal before: open={before.get('open')} "
                  f"text={before.get('dialogText')!r} scrims={before.get('scrims')}")
            print(f"  dismissed={entry.get('dismissed')}  "
                  f"modal after: open={entry.get('modalAfter', {}).get('open')}  "
                  f"session={entry.get('sessionOpen')}")
        inj = results["injection"].get(mode, {})
        diff = results["baselineDiff"].get(mode, {})
        print(f"\n[{mode}] injection: ok={inj.get('ok')} id={inj.get('id')} "
              f"tokensApplied={inj.get('applied')} exports={inj.get('exports')} "
              f"inject={inj.get('injects')} errors={inj.get('errors')}")
        print(f"  body vars  official={diff.get('officialVarCount')} "
              f"themed={diff.get('themedVarCount')} changed={diff.get('changedCount')} "
              f"added={len(diff.get('added', []))} removed={len(diff.get('removed', []))}")
        for tag in (f"official-{mode}", f"theme-wall-{mode}", f"theme-nowall-{mode}"):
            st = results["states"].get(tag, {})
            print(f"  {tag:<22} body-bg={st.get('bodyBackgroundColor')} "
                  f"image={st.get('bodyBackgroundKind')} layers={st.get('bodyBackgroundLayers')} "
                  f"styles={st.get('stylesInjected')} "
                  f"wall={st.get('wallVars', {}).get('wall')}")
        print(f"  {'region':<16}{'surface':<10}{'ink':<10}{'ratio':>7}{'share':>8}  what")
        for name, sample in results["samples"].get(f"theme-wall-{mode}", {}).items():
            if not sample.get("reachable"):
                detail = sample.get("expectedUnreachable") or " | ".join(sample.get("tried", [])[:2])
                print(f"  {name:<16}{'--':<10}{'--':<10}{'--':>7}{'--':>8}  UNREACHABLE: {detail}")
                continue
            print(f"  {name:<16}{sample['surfaceHex']:<10}{sample['inkHex']:<10}"
                  f"{sample['contrast']:>7.2f}{sample['surfaceShare']:>8.2f}  {sample['what']}")
    cr = results["chainReport"]
    cls = results["classification"]
    print(f"\nchain: s2==s1 (should be 0: nothing untouched is declared) {len(cr['s2EqualsS1'])}"
          f"  |  s3==s2 {cr['s3IsS2']}"
          f"  |  s3==s2+alphaByte {len(cr['s3ExtendsS2'])}"
          f"  |  MISMATCH {len(cr['s3ToS4'])}")
    for row in cr["s3ExtendsS2"]:
        print(f"    veil  {row['token']} [{row['mode']}] {row['s2']} -> {row['s3']} "
              f"(alpha {row['alphaValue']})")
    if cr["s3ToS4"]:
        print("  MISMATCHES (stop and report):")
        for row in cr["s3ToS4"][:12]:
            print(f"    {row['kind']}  {row['token']} [{row['mode']}] {row}")
    print(f"\nchanged body properties: direct={len(set(cls['direct']))} "
          f"derived={len(set(d['var'] for d in cls['derived']))} "
          f"paintLayer={len(set(cls['paintLayer']))} "
          f"unexplained={len(set(cls['unexplained']))}")
    if cls["unexplained"]:
        print(f"  UNEXPLAINED: {sorted(set(cls['unexplained']))[:20]}")
    print(f"\nwrote {DELIVER / 'samples.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
