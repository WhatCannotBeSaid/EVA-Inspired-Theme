#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""S4 对账器 —— 新增于 2026-10-06（S4 阶段工具，非 S1/S2/S3 原件）。

用途
----
把「预算」（S2：`docs/contrast-budget.md` + `out/s2-palette.json`）与实际浏览器渲染
（S4：`<plugins>\\tmp\\EVA-Inspired-Theme-render\\samples.json` 的真实像素）逐项对账：

  1. 区域级：真实像素表面色 / 真实墨色 / 真实对比度，与预算值、与预算的 veil 模型互校；
  2. 表面归属：每个区域的表面由哪个令牌供给（对 55 条覆盖 + 官方值做最近邻匹配），
     并给出「是否在 55 条覆盖集内」——这是「偏离官方之处可解释」的判据；
  3. veiled 区域的 veil 模型反解：用 S3 解出的 alpha 与候选 fill 反解 art 颜色，
     与 `build/veil-budget.json` 里壁纸实测亮度分位带（p05/median/p95/mean）核对；
  4. 预算 32 对矩阵：逐行判定「已实测 / 仅 veiled 实测 / 未采样」，给出偏差（不四舍五入掩盖）；
  5. 四级令牌链审计（S1 官方 → S2 设计 → S3 生成 → S4 浏览器实际），逐令牌查断链；
  6. 偏离原假设之处（不可达区域、壁纸开关恒等性、样例占比过低等）如实列出。

输出：`DELIVER/reconcile.json`（机器可读）+ `DELIVER/reconcile.md`（人读表格）。
本脚本只读，不写项目内的任何文件。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
BUILD = ROOT / "build"
DOCS = ROOT / "docs"
DELIVER = Path(r"<plugins>\tmp\EVA-Inspired-Theme-render")

# 判定阈值：超过即计入 over_tolerance，必须报告
TOL_CONTRAST = 0.25   # 对比度比值（ratio 单位）
TOL_CHANNEL = 2       # 单通道 ±2/255

# 预算 32 对矩阵的基准文档（只作存在性与行数核对，数值直接取 out/s2-palette.json）
BUDGET_DOC = DOCS / "contrast-budget.md"


# ---------------------------------------------------------------- 颜色工具
def hex2rgb(h: str):
    h = h.strip().lstrip("#")
    if len(h) >= 8:
        h = h[:6]
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hex2rgba(h: str):
    h = h.strip().lstrip("#")
    if len(h) == 8:
        return hex2rgb(h) + (int(h[6:8], 16) / 255.0,)
    return hex2rgb(h) + (1.0,)


def rgb2hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(c)))) for c in rgb[:3])


def parse_css_colour(s: str):
    """'rgb(r, g, b)' / 'rgba(r, g, b, a)' → (r,g,b,a)；透明 → None。"""
    if not s:
        return None
    s = s.strip()
    nums = re.findall(r"[0-9]*\.?[0-9]+", s)
    if len(nums) < 3:
        return None
    r, g, b = (float(nums[i]) for i in range(3))
    a = float(nums[3]) if len(nums) > 3 else 1.0
    if a == 0:
        return None
    return (r, g, b, a)


def _lin(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def rel_lum(rgb) -> float:
    r, g, b = (_lin(x) for x in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def delta_rgb(a, b):
    return tuple(int(round(a[i] - b[i])) for i in range(3))


def max_abs(delta) -> int:
    return max(abs(x) for x in delta)


def dist(a, b) -> float:
    return sum((a[i] - b[i]) ** 2 for i in range(3)) ** 0.5


# ---------------------------------------------------------------- 表面归属
def attribute_surface(mode, palette, override_index, official_value_tokens, pixel_rgb,
                      declared_css, pixel_hex=None):
    """一个真实像素「由哪个令牌供给」——区域采样与 ink 采样共用同一口径。

    返回 (nearestToken, attribution)：
      nearestToken  覆盖集 + 官方值里的最近邻（含 ΔRGB / 距离 / 是否逐字节相等）；
      attribution   严格归属：
                    1) 元素自己声明了不透明底色 → 归该声明值对应的令牌；
                    2) 元素透明 → 像素恰好等于某个非 veil 覆盖令牌则归它（如代码块），
                       否则归「透过透明区看到的应用底」= --dsw-alias-bg-base。
    """
    nearest = None
    for hexval, toks in override_index.get(mode, {}).items():
        d = dist(pixel_rgb, hex2rgb(hexval))
        if nearest is None or d < nearest[0]:
            nearest = (d, hexval, toks, "override")
    for hexval, toks in official_value_tokens.items():
        d = dist(pixel_rgb, hex2rgb(hexval))
        if nearest is None or d < nearest[0]:
            nearest = (d, hexval, toks, "official")
    nt = None
    if nearest:
        d, hexval, toks, kind = nearest
        nt = {"token": toks[0], "tokens": toks, "value": hexval, "kind": kind,
              "deltaRGB": delta_rgb(pixel_rgb, hex2rgb(hexval)), "dist": round(d, 2),
              "exact": d < 0.5}
    css = parse_css_colour(declared_css or "")
    mode_palette = palette.get(mode, {}) or {}
    if css is not None:
        dhex = rgb2hex(css).lower()
        tok = (override_index.get(mode, {}).get(dhex) or [None])[0] or \
              (official_value_tokens.get(dhex) or [None])[0]
        att = {"token": tok, "value": dhex, "basis": "declared-surface",
               "kind": "override" if dhex in override_index.get(mode, {})
                       else ("official" if dhex in official_value_tokens else "unknown")}
    else:
        phex = (pixel_hex or rgb2hex(pixel_rgb)).lower()
        exact_toks = [t for t in override_index.get(mode, {}).get(phex, [])
                      if t not in ("--dsw-alias-bg-base", "--dsw-specific-sidebar-fill")]
        if exact_toks:
            att = {"token": exact_toks[0], "tokens": exact_toks, "value": phex,
                   "basis": "pixel-exact-token", "kind": "override"}
        elif nt and nt.get("exact"):
            # 像素逐字节等于某个【官方】值（例如未被主题化的输入区面 `#2c2c2e`）：
            # 归给那个官方令牌，并标明它是官方值 —— 这正是「偏离官方之处」要点名的地方。
            att = {"token": nt["token"], "tokens": nt.get("tokens"), "value": nt["value"],
                   "basis": "pixel-exact-official-token", "kind": nt.get("kind")}
        else:
            att = {"token": "--dsw-alias-bg-base", "value": mode_palette.get("--dsw-alias-bg-base"),
                   "basis": "app-background-through-transparent", "kind": "override"}
    return nt, att


# ---------------------------------------------------------------- veil 模型
# 与 docs/contrast-budget.md §0 同口径：encoded sRGB 空间线性插值
#     comp = fill * alpha + art * (1 - alpha)
def composite(fill, art, alpha):
    return tuple(fill[i] * alpha + art[i] * (1 - alpha) for i in range(3))


def back_solve_art(fill, comp, alpha):
    return tuple((comp[i] - fill[i] * alpha) / (1.0 - alpha) for i in range(3))


# ---------------------------------------------------------------- 主流程
def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def build_official(s2tb: dict):
    """out/s2-token-baseline.json → {token: {'light':…, 'dark':…}}（S1 官方真值）。"""
    out = {}
    for row in s2tb.get("rows", []):
        tok = row.get("token")
        if not tok:
            continue
        out[tok] = {"light": (row.get("light") or "").strip(),
                    "dark": (row.get("dark") or "").strip()}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="S4 预算 vs 真实渲染 对账器")
    ap.add_argument("--deliver", default=str(DELIVER))
    ap.add_argument("--json", default=None, help="reconcile.json 输出路径")
    ap.add_argument("--md", default=None, help="reconcile.md 输出路径")
    args = ap.parse_args()

    deliver = Path(args.deliver)
    samples_path = deliver / "samples.json"
    for p in (samples_path, OUT / "s2-palette.json", OUT / "s2-token-baseline.json",
              BUILD / "veil-budget.json", BUILD / "wallpapers.json"):
        if not p.exists():
            print(f"ERROR 缺少输入文件: {p}")
            return 2

    pal = load(OUT / "s2-palette.json")
    s2tb = load(OUT / "s2-token-baseline.json")
    veil_budget = load(BUILD / "veil-budget.json")
    wallpapers = load(BUILD / "wallpapers.json")
    samples = load(samples_path)

    palette = pal.get("palette", {})
    contrast_rows = pal.get("contrast", [])
    official = build_official(s2tb)

    overrides = set()
    for mode in palette:
        overrides |= set(palette[mode].keys())

    # 官方值索引（"#rrggbb" → [token…]），用于「未覆盖但出现在屏幕上」的归属
    # 注意：baseline 里有些值是 var(--…) 之类的转发文本，必须用严格 hex 判定
    hex6 = re.compile(r"^#[0-9a-fA-F]{6}$")
    official_value_tokens = {}
    for tok, modes in official.items():
        for mode, val in modes.items():
            if val and hex6.match(val):
                official_value_tokens.setdefault(val.lower(), []).append(tok)

    # 覆盖集值索引（mode → "#rrggbb" → [token…]）
    override_index = {}
    for mode, table in palette.items():
        idx = {}
        for tok, val in table.items():
            if val and hex6.match(val):
                idx.setdefault(val.lower(), []).append(tok)
        override_index[mode] = idx

    report = {
        "generatedFrom": {
            "samples": str(samples_path),
            "palette": str(OUT / "s2-palette.json"),
            "official": str(OUT / "s2-token-baseline.json"),
            "veilBudget": str(BUILD / "veil-budget.json"),
        },
        "tolerances": {"contrast": TOL_CONTRAST, "channel": TOL_CHANNEL},
        "allOverrides": sorted(overrides),
        "modes": {},
        "budgetPairs": [],
        "chain": {},
        "deviations": [],
        "overTolerance": [],
    }

    mode_info = {
        "light": {"wallpaper": "8g9wyy", "alpha": 0.74, "probe": "p05"},
        "dark": {"wallpaper": "yqmlmx", "alpha": 0.63, "probe": "p95"},
    }
    # 以 build/veil-budget.json 为准（它是 S3 求解结果），palette/samples 只作交叉核对
    vb_modes = veil_budget.get("modes", {})
    for mode, info in mode_info.items():
        if mode in vb_modes:
            info["alpha"] = float(vb_modes[mode].get("chosenAlpha", info["alpha"]))
            info["artLuminance"] = vb_modes[mode].get("artLuminance", {})
            info["perSurface"] = vb_modes[mode].get("perSurface", {})
            info["atChosen"] = vb_modes[mode].get("atChosen", {})
            info["wallpaper"] = vb_modes[mode].get("wallpaper", info["wallpaper"])
            info["probe"] = vb_modes[mode].get("probe", info["probe"])

    # 壁纸实测亮度（build/wallpapers.json 用 meanLuminance；veil-budget 用分位）
    wp_by_id = {}
    for w in wallpapers if isinstance(wallpapers, list) else wallpapers.get("wallpapers", []):
        wp_by_id[w.get("id")] = w

    # ------------------------------------------------------------ 1/2/3 区域级
    for mode in ("light", "dark"):
        info = mode_info[mode]
        alpha = info["alpha"]
        art_band = info.get("artLuminance", {})
        per_surface = info.get("perSurface", {})
        at_chosen = info.get("atChosen", {})
        wp = wp_by_id.get(info["wallpaper"], {})
        mode_rep = {
            "chosenAlpha": alpha,
            "wallpaper": info["wallpaper"],
            "wallpaperMeanLuminance": wp.get("meanLuminance"),
            "artLuminanceBand": art_band,
            "states": {},
        }
        for state in ("theme-wall", "theme-nowall", "official"):
            tag = f"{state}-{mode}"
            if tag not in samples.get("samples", {}):
                continue
            state_rep = {}
            for region, s in samples["samples"][tag].items():
                if not s.get("reachable"):
                    state_rep[region] = {"reachable": False, "why": s.get("what")}
                    continue
                pix = tuple(s["surfaceRGB"])
                ink = tuple(s["inkRGB"])
                real_ratio = contrast(pix, ink)
                ratio_field = float(s.get("contrast") or 0.0)
                item = {
                    "reachable": True,
                    "selector": s.get("selector"),
                    "surfaceHex": s.get("surfaceHex"),
                    "inkHex": s.get("inkHex"),
                    "surfaceShare": s.get("surfaceShare"),
                    "surfaceFromCss": s.get("surfaceFromCss"),
                    "contrastPixels": round(real_ratio, 3),
                    "contrastReported": ratio_field,
                    "contrastSelfCheckDelta": round(real_ratio - ratio_field, 4),
                    "pass": real_ratio >= 4.5,
                    "target": 4.5,
                }
                # --- 表面归属：先看 CSS 是否透明（→ 看到的是区域背后的底）
                css = parse_css_colour(s.get("surfaceFromCss") or "")
                if css is None:
                    item["surfaceDeclared"] = "transparent"
                else:
                    item["surfaceDeclared"] = rgb2hex(css)
                nt, att = attribute_surface(mode, palette, override_index, official_value_tokens,
                                            pix, s.get("surfaceFromCss"), s.get("surfaceHex"))
                if nt:
                    item["nearestToken"] = nt
                item["attribution"] = att
                # veiled 反解：候选 fill × chosenAlpha，取「反解 art 落在壁纸亮度带内」者
                veil_try = []
                for tok in ("--dsw-alias-bg-base", "--dsw-specific-sidebar-fill"):
                    fill_hex = (palette.get(mode, {}) or {}).get(tok)
                    if not fill_hex:
                        continue
                    fill = hex2rgb(fill_hex)
                    art = back_solve_art(fill, pix, alpha)
                    in_range = all(-1.0 <= c <= 256.0 for c in art)
                    art_l = rel_lum([max(0, min(255, c)) for c in art])
                    lo = art_band.get("p05")
                    hi = art_band.get("p95")
                    inside = bool(lo is not None and hi is not None and lo - 0.02 <= art_l <= hi + 0.02)
                    veil_try.append({
                        "fillToken": tok,
                        "fillHex": fill_hex,
                        "alpha": alpha,
                        "impliedArt": rgb2hex([max(0, min(255, c)) for c in art]),
                        "impliedArtRGB": [round(c, 2) for c in art],
                        "impliedArtChannelsInRange": in_range,
                        "impliedArtLuminance": round(art_l, 4),
                        "insideMeasuredBand": inside,
                        "plausible": bool(in_range and inside),
                        "deltaPixelToFillRGB": delta_rgb(pix, fill),
                        "modelCompositeAtProbe": rgb2hex(composite(fill, probe_art(art_band, info["probe"]), alpha))
                        if probe_art(art_band, info["probe"]) else None,
                        "meaningfulForArt": state == "theme-wall",
                    })
                veil_try.sort(key=lambda r: (not r["insideMeasuredBand"], not r["impliedArtChannelsInRange"]))
                item["veilBackSolve"] = veil_try
                item["veilFillAmbiguous"] = sum(1 for v in veil_try if v.get("plausible")) >= 2
                # 与 veil-budget 的 atChosen 对拍（该表面在探测分位下的最坏合成）
                if veil_try:
                    tok = veil_try[0]["fillToken"]
                    ac = (at_chosen or {}).get(tok, {})
                    if ac:
                        ink_ratio = (ac.get("ink") or {}).get("--dsw-alias-label-primary")
                        item["budgetAtChosen"] = {
                            "surface": tok,
                            "compositeHex": ac.get("composite"),
                            "compositeLum": ac.get("compositeLum"),
                            "labelPrimaryRatioAtProbe": ink_ratio,
                        }
                state_rep[region] = item
            mode_rep["states"][state] = state_rep
        report["modes"][mode] = mode_rep

    # 壁纸开关恒等性（同区域、同模式、两种状态的像素差）
    ident = {}
    for mode in ("light", "dark"):
        a = samples.get("samples", {}).get(f"theme-wall-{mode}", {})
        b = samples.get("samples", {}).get(f"theme-nowall-{mode}", {})
        rows = {}
        for region in a:
            if region in b and a[region].get("reachable") and b[region].get("reachable"):
                d = delta_rgb(tuple(a[region]["surfaceRGB"]), tuple(b[region]["surfaceRGB"]))
                rows[region] = {"deltaRGB": d, "identical": max_abs(d) == 0}
        ident[mode] = rows
    report["wallpaperToggleIdentity"] = ident

    # ------------------------------------------------------------ 4 预算 32 对
    for row in contrast_rows:
        mode, fg, bg = row.get("mode"), row.get("fg"), row.get("bg")
        fg_hex, bg_hex = (row.get("fgHex") or "").lower(), (row.get("bgHex") or "").lower()
        entry = {
            "mode": mode, "fg": fg, "bg": bg, "fgHex": fg_hex, "bgHex": bg_hex,
            "budgetRatio": row.get("ratio"), "target": row.get("target"),
            "budgetPass": row.get("pass"), "budgetDelta": row.get("delta"),
            "realized": "not_sampled", "real": None, "attempts": [],
        }
        budget_ratio = float(row.get("ratio") or 0)
        budget_target = float(row.get("target") or 4.5)
        best = None
        # 两种壁纸状态都要看：关壁纸时是「梯度+veil」（最接近预算的平铺模型），
        # 开壁纸时是「壁纸+veil」（预算模型的反向极限）。
        # 观察来源有两类：区域采样（每区一个 ink）与 ink 采样（S4 扩展，按令牌反查承载元素）。
        observations = []
        for state in ("theme-nowall", "theme-wall"):
            for region, s in (samples.get("samples", {}).get(f"{state}-{mode}", {}) or {}).items():
                if not s.get("reachable"):
                    continue
                if (s.get("inkHex") or "").lower() != fg_hex:
                    continue
                observations.append({
                    "source": "region", "state": state, "region": region,
                    "surfaceRGB": s["surfaceRGB"], "inkRGB": s["inkRGB"],
                    "surfaceFromCss": s.get("surfaceFromCss"), "surfaceHex": s.get("surfaceHex"),
                    "contrast": float(s.get("contrast") or 0),
                    "surfaceShare": s.get("surfaceShare"), "inkPixelShare": None,
                })
            for obs in (samples.get("inkSamples", {}).get(f"{state}-{mode}", {}) or {}).get(fg) or []:
                observations.append({
                    "source": "ink", "state": state, "region": f"ink:{obs.get('element', {}).get('tag', '?')}",
                    "surfaceRGB": obs["surfaceRGB"],
                    "inkRGB": obs.get("inkRGB") or hex2rgb(obs.get("inkHex") or fg_hex),
                    "surfaceFromCss": obs.get("surfaceFromCss"), "surfaceHex": obs.get("surfaceHex"),
                    "contrast": float(obs.get("contrast") or 0),
                    "surfaceShare": obs.get("surfaceShare"), "inkPixelShare": obs.get("inkPixelShare"),
                })
        for ob in observations:
            state, region = ob["state"], ob["region"]
            pix = tuple(ob["surfaceRGB"])
            real_ratio = contrast(pix, tuple(ob["inkRGB"]))
            nt, att = attribute_surface(mode, palette, override_index, official_value_tokens,
                                        pix, ob.get("surfaceFromCss"), ob.get("surfaceHex"))
            att_tok = att.get("token")
            att_val = (palette.get(mode, {}).get(att_tok) or "").lower()
            declared = parse_css_colour(ob.get("surfaceFromCss") or "")
            declared_hex = rgb2hex(declared) if declared else None
            declared_is_bg = (declared_hex or "").lower() == bg_hex
            # 只把「表面可严格归因到这个预算表面」的观察算作一次尝试；
            # 否则（例如拿输入区像素去比侧栏预算面）是无意义比较，会淹没有效偏离。
            if not (att_val == bg_hex or declared_is_bg):
                continue
            fill_tokens = [att_tok] if att_val == bg_hex else []
            sd = delta_rgb(pix, hex2rgb(bg_hex)) if bg_hex else (0, 0, 0)
            exact = max_abs(sd) == 0
            fill_is_bg = bool(fill_tokens) or declared_is_bg
            within = max_abs(sd) <= TOL_CHANNEL
            attempt = {
                "source": ob["source"], "state": state, "region": region,
                "surfaceHex": ob.get("surfaceHex"), "surfaceFromCss": ob.get("surfaceFromCss"),
                "surfaceDeltaRGB": sd,
                "surfaceShare": ob.get("surfaceShare"), "inkPixelShare": ob.get("inkPixelShare"),
                "realRatio": round(real_ratio, 3),
                "ratioDelta": round(real_ratio - budget_ratio, 3),
                "fillToken": (fill_tokens[0] if fill_tokens else None),
                "pass": real_ratio >= budget_target,
            }
            entry["attempts"].append(attempt)
            if not (exact or (fill_is_bg and within)):
                continue
            score = max_abs(sd)
            if best is None or score < max_abs(best["surfaceDeltaRGB"]):
                best = attempt
                best["realized"] = "exact" if exact else "veiled"
        if best:
            entry.update(best)
        else:
            entry.pop("attempts", None)
            entry["attempts"] = entry.get("attempts") or []
        report["budgetPairs"].append(entry)

    # ------------------------------------------------------------ 4b ink 级审计
    # 矩阵问「设计指定的那一对有没有被采到」；这里问「这个墨色在任何它实际出现的
    # 面上够不够」。S4 扩展后的 ink 采样按令牌反查承载文字的元素，因此 12 个目标
    # 墨色都能拿到真实像素——即便它落在一个不在预算矩阵里的面上。
    ink_audit: dict = {}
    targets = pal.get("targets", {})
    for mode in ("light", "dark"):
        names = sorted(set(targets) | set((samples.get("inkSamples", {}) or {})
                                           .get(f"theme-wall-{mode}", {}) or {}))
        rows_out = {}
        for name in names:
            obs_theme = []
            for state in ("theme-wall", "theme-nowall"):
                for ob in (samples.get("inkSamples", {}).get(f"{state}-{mode}", {}) or {}).get(name) or []:
                    pix = tuple(ob["surfaceRGB"])
                    nt, att = attribute_surface(mode, palette, override_index, official_value_tokens,
                                                pix, ob.get("surfaceFromCss"), ob.get("surfaceHex"))
                    ink = ob.get("inkRGB") or hex2rgb(ob.get("inkHex") or "#000000")
                    obs_theme.append({
                        "state": state,
                        "element": ob.get("element"), "text": ob.get("text"),
                        "kind": ob.get("kind", "text"),
                        "hoveredBy": ob.get("hoveredBy"),
                        "inkHex": ob.get("inkHex"), "surfaceHex": ob.get("surfaceHex"),
                        "surfaceShare": ob.get("surfaceShare"),
                        "inkPixelShare": ob.get("inkPixelShare"),
                        "contrast": round(contrast(pix, tuple(ink)), 3),
                        "attributedToken": att.get("token"),
                        "attributionBasis": att.get("basis"),
                        "nearestToken": (nt or {}).get("token"),
                        "nearestKind": (nt or {}).get("kind"),
                        "crop": ob.get("crop"),
                    })
            # 官方基线同口径（老采样器没有 ink 采样，故官方态只做存在性说明）
            target = float(targets.get(name, 4.5))
            reliable = [o for o in obs_theme
                        if (o["surfaceShare"] or 1) >= 0.4 and (o["inkPixelShare"] or 1) >= 0.02]
            unreliable = [o for o in obs_theme if o not in reliable]
            # 图标载体不是文字：WCAG 对非文字图形（1.4.11）的门槛是 3:1，不是 4.5:1。
            # 用文字门槛去判图标会造出假失败 —— 这里按 kind 分开判，并各自记录最差值。
            text_rel = [o for o in reliable if o["kind"] != "icon"]
            icon_rel = [o for o in reliable if o["kind"] == "icon"]
            rows_out[name] = {
                "target": target,
                "nonTextBar": 3.0,
                "found": bool(obs_theme),
                "observations": obs_theme,
                "reliableCount": len(reliable),
                "textCount": len(text_rel),
                "iconCount": len(icon_rel),
                "worstReliable": min((o["contrast"] for o in reliable), default=None),
                "worstReliableText": min((o["contrast"] for o in text_rel), default=None),
                "worstReliableIcon": min((o["contrast"] for o in icon_rel), default=None),
                "worstOverall": min((o["contrast"] for o in obs_theme), default=None),
                "pass": bool(reliable)
                        and all(o["contrast"] >= target for o in text_rel)
                        and all(o["contrast"] >= 3.0 for o in icon_rel),
                "unreliableBelowTarget": [o for o in unreliable
                                          if o["kind"] != "icon" and o["contrast"] < target],
                "iconBelowNonTextBar": [o for o in icon_rel if o["contrast"] < 3.0],
                "surfaces": sorted({o["surfaceHex"] for o in obs_theme if o["surfaceHex"]}),
                "budgetBgs": sorted({e["bg"] for e in report["budgetPairs"]
                                     if e["mode"] == mode and e["fg"] == name}),
            }
        ink_audit[mode] = rows_out
    report["inkAudit"] = ink_audit

    # ------------------------------------------------------------ 5 四级令牌链
    tokens_json = load(ROOT / "src" / "tokens.json")
    s3_tokens = tokens_json.get("tokens", {})
    chain_s4 = samples.get("chain", {})
    veil_tokens = {"--dsw-alias-bg-base", "--dsw-specific-sidebar-fill"}
    chain_rows = []
    chain_break = []
    for tok in sorted(s3_tokens):
        row = {"token": tok,
               "s1": {m: official.get(tok, {}).get(m) for m in ("light", "dark")},
               "s2": {m: (palette.get(m, {}) or {}).get(tok) for m in ("light", "dark")},
               "s3": {m: (s3_tokens.get(tok) or {}).get(m) for m in ("light", "dark")},
               "s4": {m: (chain_s4.get(m, {}).get(tok) or {}).get("s4") for m in ("light", "dark")}}
        for m in ("light", "dark"):
            s2, s3, s4, s1 = row["s2"][m], row["s3"][m], row["s4"][m], row["s1"][m]
            if s3 is None or s4 is None or s2 is None:
                chain_break.append({"token": tok, "mode": m, "why": "缺环", "s1": s1, "s2": s2, "s3": s3, "s4": s4})
                continue
            if s1 and s1.lower() == s2.lower():
                chain_break.append({"token": tok, "mode": m, "why": "S2 未真正改值（== S1）", "s1": s1, "s2": s2, "s3": s3, "s4": s4})
            if tok in veil_tokens:
                # veil 令牌的合法差异：S3 = S2 + alpha 字节（8 位 hex）
                if len(s3) != 9 or s3[:7].lower() != s2.lower() or not re.match(r"^#[0-9a-fA-F]{6}[0-9a-fA-F]{2}$", s3):
                    chain_break.append({"token": tok, "mode": m, "why": "veil 令牌 S3 不是 S2+alpha 字节", "s1": s1, "s2": s2, "s3": s3, "s4": s4})
            else:
                if s3.lower() != s2.lower():
                    chain_break.append({"token": tok, "mode": m, "why": "S3 != S2", "s1": s1, "s2": s2, "s3": s3, "s4": s4})
            if s4.lower() != s3.lower():
                chain_break.append({"token": tok, "mode": m, "why": "S4 != S3（浏览器实际值不等于生成值）", "s1": s1, "s2": s2, "s3": s3, "s4": s4})
        chain_rows.append(row)
    report["chain"] = {
        "tokenCount": len(chain_rows),
        "breakCount": len(chain_break),
        "breaks": chain_break,
        "rows": chain_rows,
        "s3IsS2": samples.get("chainReport", {}).get("s3IsS2"),
        "s3ExtendsS2": samples.get("chainReport", {}).get("s3ExtendsS2"),
        "s2EqualsS1": samples.get("chainReport", {}).get("s2EqualsS1"),
        "s3ToS4": samples.get("chainReport", {}).get("s3ToS4"),
    }

    # ------------------------------------------------------------ 6 偏离与超阈值
    dev = report["deviations"]
    for mode in ("light", "dark"):
        for state in ("theme-wall", "theme-nowall"):
            for region, item in (report["modes"][mode]["states"][state] or {}).items():
                if not item.get("reachable"):
                    dev.append({"kind": "unreachable", "mode": mode, "state": state,
                                "region": region, "why": item.get("why")})
                    continue
                if item["surfaceDeclared"] == "transparent":
                    dev.append({"kind": "region-transparent", "mode": mode, "state": state, "region": region,
                                "note": "该区域元素自身不上底色（surfaceFromCss 透明）→ 所测像素是它背后的底（veil+壁纸），不是该区域自己的填色"})
                if (item.get("surfaceShare") or 1) < 0.6:
                    dev.append({"kind": "low-share", "mode": mode, "state": state, "region": region,
                                "share": item.get("surfaceShare"),
                                "note": "裁剪块内众数色占比偏低，表面读数可靠性下降"})
                nt = item.get("nearestToken") or {}
                if nt.get("exact") and nt.get("kind") == "official":
                    dev.append({"kind": "official-surface", "mode": mode, "state": state, "region": region,
                                "token": nt.get("token"), "value": nt.get("value"),
                                "note": "该区域实测像素等于【官方值】（不在 55 条覆盖集内）→ 这一处在像素层面仍是官方配色，需在报告里点名"})
                if nt and not nt.get("exact"):
                    dev.append({"kind": "pixel-not-exact-token", "mode": mode, "state": state, "region": region,
                                "nearest": nt,
                                "note": "真实像素不等于任何单个令牌值（veil 合成/壁纸透出所致，需按模型解释）"})
                if state == "theme-wall" and item.get("veilFillAmbiguous"):
                    dev.append({"kind": "veil-fill-ambiguous", "mode": mode, "state": state, "region": region,
                                "candidates": [v["fillToken"] for v in item.get("veilBackSolve", []) if v.get("plausible")],
                                "note": "两个候选 fill 都能反解出合理的 art 颜色 → 无法仅凭像素判定该面由哪个令牌供给"})
    if not samples.get("noticeStillShownInFreshContext", {}).get("open", False):
        dev.append({"kind": "assumption-broken", "scope": "first-run notice",
                    "note": "脚本头注假设首启提示弹窗会盖住 hero 屏且其遮罩是被主题覆盖的令牌；本次四个 pageState 皆 open=False（no modal）→ 该假设在当前 profile 状态下不成立"})
    for mode in ("light", "dark"):
        ac = samples.get("injection", {}).get(mode, {})
        if not ac.get("ok"):
            dev.append({"kind": "injection", "mode": mode, "note": str(ac)})
    # 超阈值
    for mode in ("light", "dark"):
        for state in ("theme-wall", "theme-nowall", "official"):
            for region, item in (report["modes"][mode]["states"][state] or {}).items():
                if not item.get("reachable"):
                    continue
                if abs(item.get("contrastSelfCheckDelta", 0)) > 0.02:
                    report["overTolerance"].append({
                        "what": "contrast-self-check", "mode": mode, "state": state, "region": region,
                        "delta": item["contrastSelfCheckDelta"],
                        "note": "本脚本按像素重算的对比度与 samples.json 记录值不一致（>0.02）"})
    for entry in report["budgetPairs"]:
        # 逐「尝试」报偏离：同一对在两种壁纸状态下各测一次，任一状态越界都要报（默认态是开壁纸）
        for a in entry.get("attempts") or []:
            if abs(a.get("ratioDelta", 0.0)) > TOL_CONTRAST:
                report["overTolerance"].append({
                    "what": "budget-pair-ratio", "mode": entry["mode"], "fg": entry["fg"], "bg": entry["bg"],
                    "state": a["state"], "region": a["region"],
                    "budgetRatio": entry["budgetRatio"], "realRatio": a["realRatio"],
                    "ratioDelta": a["ratioDelta"], "surfaceHex": a["surfaceHex"],
                    "note": "同一对的另一状态见 attempts；此处按状态逐条报，不取最优值掩盖"})
            if a.get("surfaceDeltaRGB") and max_abs(a["surfaceDeltaRGB"]) > TOL_CHANNEL:
                report["overTolerance"].append({
                    "what": "budget-pair-surface", "mode": entry["mode"], "fg": entry["fg"], "bg": entry["bg"],
                    "state": a["state"], "region": a["region"],
                    "realSurfaceHex": a["surfaceHex"], "budgetHex": entry["bgHex"],
                    "surfaceDeltaRGB": a["surfaceDeltaRGB"]})
    # ink 级审计的偏离（S4 扩展后新增的一层口径）
    for mode, rows_out in report.get("inkAudit", {}).items():
        for name, row in sorted(rows_out.items()):
            if not row["found"]:
                dev.append({"kind": "ink-not-found", "mode": mode, "ink": name,
                            "note": "本次 UI 状态下没有任何元素渲染这个墨色 → 该墨色的预算对拿不到真实像素"})
                continue
            if row["unreliableBelowTarget"]:
                dev.append({"kind": "ink-low-reliability-below-target", "mode": mode, "ink": name,
                            "samples": row["unreliableBelowTarget"],
                            "note": "低可靠度样本（surfaceShare<0.4 或 inkPixelShare<0.02）低于目标，"
                                    "可能是采样噪声，已列出等复采"})
            if row.get("iconBelowNonTextBar"):
                report["overTolerance"].append({
                    "what": "ink-icon-below-nontext-bar", "mode": mode, "ink": name,
                    "bar": 3.0, "samples": row["iconBelowNonTextBar"],
                    "note": "图标载体（非文字图形）低于 WCAG 1.4.11 的 3:1"})
            if not row["pass"]:
                report["overTolerance"].append({
                    "what": "ink-below-target", "mode": mode, "ink": name,
                    "worstReliableText": row.get("worstReliableText"),
                    "worstReliableIcon": row.get("worstReliableIcon"),
                    "target": row["target"], "surfaces": row["surfaces"]})
    if report["chain"]["breakCount"]:
        report["overTolerance"].append({"what": "token-chain", "breaks": len(report["chain"]["breaks"])})

    # 去重：同一处观测（同模式/同对/同状态/同像素）在多个区域重复出现时只留一条，并记下重复出现的区域
    seen, deduped = set(), []
    for o in report["overTolerance"]:
        key = json.dumps({k: v for k, v in o.items() if k not in ("region", "alsoSeenIn", "note")},
                         ensure_ascii=False, sort_keys=True)
        if key in seen:
            for d in deduped:
                if d.get("_key") == key:
                    d.setdefault("alsoSeenIn", [])
                    if o.get("region") and o["region"] not in d["alsoSeenIn"]:
                        d["alsoSeenIn"].append(o["region"])
            continue
        seen.add(key)
        o["_key"] = key
        deduped.append(o)
    for d in deduped:
        d.pop("_key", None)
    report["overTolerance"] = deduped

    # ------------------------------------------------------------ 输出
    jp = Path(args.json) if args.json else deliver / "reconcile.json"
    mp = Path(args.md) if args.md else deliver / "reconcile.md"
    jp.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    md = []
    md.append("# S4 对账：真实渲染 vs 预算\n")
    md.append(f"- 输入：`{samples_path}`、`out/s2-palette.json`、`out/s2-token-baseline.json`、"
              f"`build/veil-budget.json`、`build/wallpapers.json`")
    md.append(f"- 预算基准文档：`docs/contrast-budget.md`（{BUDGET_DOC.stat().st_size if BUDGET_DOC.exists() else '缺失'} B）")
    md.append(f"- 阈值：对比度偏差 > {TOL_CONTRAST}；单通道偏差 > {TOL_CHANNEL}/255 → 计入「超阈值」")
    md.append(f"- 覆盖集令牌数：{len(overrides)}\n")
    for mode in ("light", "dark"):
        mr = report["modes"][mode]
        md.append(f"## {mode}（chosenAlpha={mr['chosenAlpha']}，壁纸 {mr['wallpaper']}，"
                  f"实测 meanLum={mr['wallpaperMeanLuminance']}）\n")
        md.append("| 区域 | 状态 | 真实像素 | surfaceFromCss | 墨色 | 真实比值 | 记录值 | 最近令牌 | ΔRGB | veil 反解 art | 反解 art L | 在亮度带内 |")
        md.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for state in ("theme-wall", "theme-nowall", "official"):
            for region, item in (mr["states"].get(state) or {}).items():
                if not item.get("reachable"):
                    md.append(f"| {region} | {state} | — | — | — | — | — | 不可达 | — | — | — | — |")
                    continue
                nt = item.get("nearestToken") or {}
                vb = (item.get("veilBackSolve") or [{}])[0]
                md.append("| {} | {} | {} | {} | {} | {} | {} | {} {} | {} | {} (α={}) | {} | {} |".format(
                    region, state, item["surfaceHex"], item.get("surfaceFromCss"), item["inkHex"],
                    item["contrastPixels"], item["contrastReported"],
                    nt.get("token", "—"), f"[{nt.get('kind')}]", nt.get("deltaRGB"),
                    vb.get("impliedArt", "—"), vb.get("alpha", "—"),
                    vb.get("impliedArtLuminance", "—"),
                    "是" if vb.get("insideMeasuredBand") else "否"))
        md.append("")
    md.append("## 预算 32 对：实测覆盖\n")
    md.append("| 模式 | 对 | 预算比值 | 目标 | 实测 | 真实比值 | 比值差 | 表面 ΔRGB |")
    md.append("|---|---|---|---|---|---|---|---|")
    for e in report["budgetPairs"]:
        if e["realized"] == "not_sampled":
            att = (e.get("attempts") or [])
            att = sorted(att, key=lambda a: max_abs(a["surfaceDeltaRGB"]))[:1]
            hint = ""
            if att:
                a = att[0]
                hint = f"（最接近：{a['region']}@{a['state']} {a['surfaceHex']} Δ={a['surfaceDeltaRGB']}）"
            md.append(f"| {e['mode']} | {e['fg']} ↔ {e['bg']} | {e['budgetRatio']} | {e['target']} | **未采样**{hint} | — | — | — |")
        else:
            md.append(f"| {e['mode']} | {e['fg']} ↔ {e['bg']} | {e['budgetRatio']} | {e['target']} | {e['realized']}@{e['region']}({e.get('state')}) | {e['realRatio']} | {e['ratioDelta']:+} | {e.get('surfaceDeltaRGB')} |")
    realized = [e for e in report["budgetPairs"] if e["realized"] != "not_sampled"]
    fg_sampled = sorted({e["fg"] for e in realized})
    fg_missing = sorted({e["fg"] for e in report["budgetPairs"] if e["realized"] == "not_sampled"})
    md.append(f"\n- 32 对中已实测 **{len(realized)}** 对，未采样 **{32 - len(realized)}** 对（未采样=该墨色/表面组合没有出现在本次采样的 7 个区域里，属覆盖缺口，不等于通过）")
    md.append(f"- 已实测到的墨色令牌：{fg_sampled}；未采样到的墨色令牌：{fg_missing}")
    md.append("- 系统性原因：`verify-render.py` 每个区域只取**一个**墨色（该区域元素的 `getComputedStyle().color`），七个区域都落在 `label-primary` 上，"
              "因此 secondary/tertiary/caption/dimmed/brand/link/state-* 这些对无法用本次像素覆盖 —— 要覆盖它们必须扩展采样器（另行点名再做）。")
    md.append("")
    md.append("### 逐状态尝试明细（同一对在两种壁纸状态下各测一次；不取最优值掩盖）\n")
    md.append("| 模式 | 对 | 状态 | 来源 | 区域 | 真实像素 | 预算表面 | 表面 ΔRGB | 真实比值 | 预算比值 | 比值差 |")
    md.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for e in report["budgetPairs"]:
        for a in e.get("attempts") or []:
            md.append("| {} | {} ↔ {} | {} | {} | {} | {} | {} | {} | {} | {} | {:+} |".format(
                e["mode"], e["fg"], e["bg"], a["state"], a.get("source", "region"), a["region"],
                a["surfaceHex"], e["bgHex"], a["surfaceDeltaRGB"], a["realRatio"],
                e["budgetRatio"], a["ratioDelta"]))
    md.append("")
    md.append("## ink 级审计：12 个目标墨色在真实屏幕上的实测（S4 扩展）\n")
    md.append("每个墨色列出它实际出现的面、实测对比度、对目标是否达标。"
              "`reliable` 只统计 `surfaceShare≥0.4` 且 `inkPixelShare≥0.02` 的样本（后者证明字确实在裁剪里）。"
              "**文字载体按墨色目标判（多为 4.5:1），图标载体按 WCAG 1.4.11 的 3:1 判** —— 用文字门槛判图标会造出假失败。\n")
    md.append("| 模式 | 墨色 | 目标 | 找到 | 可靠(文字/图标) | 最差文字 | 最差图标 | 最差(全部) | 出现的面 | 达标 |")
    md.append("|---|---|---|---|---|---|---|---|---|---|")
    for mode, rows_out in report.get("inkAudit", {}).items():
        for name, row in rows_out.items():
            md.append("| {} | {} | {} | {} | {} ({}/{}) | {} | {} | {} | {} | {} |".format(
                mode, name, row["target"], "是" if row["found"] else "**否**",
                row["reliableCount"], row.get("textCount", 0), row.get("iconCount", 0),
                row.get("worstReliableText"), row.get("worstReliableIcon"),
                row["worstOverall"], ", ".join(row["surfaces"]) or "—",
                "✓" if row["pass"] else "**✗**"))
    md.append("")
    md.append("### ink 级观察明细\n")
    md.append("| 模式 | 墨色 | 状态 | 元素 | kind | 悬停来源 | 文字 | 墨色 | 面 | surfaceShare | inkPixelShare | 实测比值 | 归属令牌 | 归属依据 |")
    md.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for mode, rows_out in report.get("inkAudit", {}).items():
        for name, row in rows_out.items():
            for o in row["observations"]:
                md.append("| {} | {} | {} | {} {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |".format(
                    mode, name, o["state"],
                    (o.get("element") or {}).get("tag", "?"), (o.get("element") or {}).get("class", "")[:18],
                    o.get("kind", "text"), o.get("hoveredBy") or "—",
                    (o.get("text") or "").replace("|", "/")[:16], o["inkHex"], o["surfaceHex"],
                    o.get("surfaceShare"), o.get("inkPixelShare"), o["contrast"],
                    o.get("attributedToken"), o.get("attributionBasis")))
    md.append("")
    md.append("## 令牌链审计（S1→S2→S3→S4）\n")
    c = report["chain"]
    md.append(f"- 受审令牌 {c['tokenCount']} 条；**断链 {c['breakCount']} 条**")
    md.append(f"- verify-render 记录：s3IsS2={c['s3IsS2']}，s3ExtendsS2={len(c['s3ExtendsS2'])}，s2EqualsS1={len(c['s2EqualsS1'])}，s3ToS4={len(c['s3ToS4'])}")
    for b in c["breaks"]:
        md.append(f"  - 断链：{b}")
    md.append("")
    md.append("## 偏离原假设 / 覆盖缺口\n")
    for d in report["deviations"]:
        md.append(f"- [{d.get('kind')}] " + json.dumps({k: v for k, v in d.items() if k != 'kind'}, ensure_ascii=False))
    md.append("")
    md.append("## 超阈值项\n")
    if report["overTolerance"]:
        for o in report["overTolerance"]:
            md.append(f"- " + json.dumps(o, ensure_ascii=False))
    else:
        md.append("- 无（对比度自检、预算对实测比值、链条均为 0 项越界）")
    md.append("")
    mp.write_text("\n".join(md), encoding="utf-8")
    print(f"wrote {jp} ({jp.stat().st_size} B)")
    print(f"wrote {mp} ({mp.stat().st_size} B)")
    print(f"chain breaks={report['chain']['breakCount']}  over-tolerance={len(report['overTolerance'])}")
    print(f"budget pairs realized={len(realized)}/32  deviations={len(report['deviations'])}")
    return 0


def probe_art(art_band, probe):
    """给定分位名，返回一个等亮度灰（与 S3 求解同口径：用该分位的亮度当灰）。"""
    if not art_band or not probe:
        return None
    lum = art_band.get(probe)
    if lum is None:
        return None
    # 反解等亮度灰：在 encoded sRGB 空间找一个灰值使 rel_lum == lum（二分）
    lo, hi = 0.0, 255.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if rel_lum((mid, mid, mid)) < lum:
            lo = mid
        else:
            hi = mid
    g = (lo + hi) / 2
    return (g, g, g)


if __name__ == "__main__":
    raise SystemExit(main())
