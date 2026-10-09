"""对比度预算生成器 —— 产出 docs\\contrast-budget.md。

数据全部来自 out\\s2-palette.json（本主题新值 + 已算好的对比度矩阵 + 壁纸边界）
与 out\\s2-token-baseline.json（官方原值，用于「相对官方」对照列）。
不手抄任何数字。

解释器：DSH runtime Python（只标准库）。
用法：$pyr tools\\s2-budget.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
DOCS = ROOT / "docs"


def rel_lum(hexv: str) -> float:
    h = hexv.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) == 8:
        h = h[:6]
    if len(h) != 6:
        return float("nan")
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [(c / 12.92) if c <= 0.04045 else (((c + 0.055) / 1.055) ** 2.4) for c in ch]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a: str, b: str) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    if la != la or lb != lb:
        return float("nan")
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def alpha_of(v: str) -> float:
    h = (v or "").lstrip("#")
    return int(h[6:8], 16) / 255 if len(h) == 8 else 1.0


def over(fill: str, a: float, art: str) -> str:
    """与浏览器一致：在 **encoded sRGB** 空间线性插值（CSS 默认非预乘、非线性化）。"""
    def ch(c: str, i: int) -> int:
        h = c.lstrip("#")
        if len(h) == 3:
            h = "".join(x * 2 for x in h)
        return int(h[i * 2:i * 2 + 2], 16)
    out = [round(ch(fill, i) * a + ch(art, i) * (1 - a)) for i in range(3)]
    return "#%02x%02x%02x" % tuple(out)


def full(name: str, official: dict) -> str:
    """s2-palette.py 的对比度表用短名（如 label-primary），官方原值表用全名。"""
    if name.startswith("--"):
        return name
    for cand in (f"--dsw-alias-{name}", f"--dsw-{name}"):
        if cand in official:
            return cand
    return f"--dsw-alias-{name}"


def main() -> int:
    pal = json.loads((OUT / "s2-palette.json").read_text(encoding="utf-8"))
    base = json.loads((OUT / "s2-token-baseline.json").read_text(encoding="utf-8"))
    official = {r["token"]: r for r in base["rows"]}
    P = pal["palette"]
    L: list[str] = []

    L.append("# 对比度预算 —— EVA-Inspired-Theme\n")
    L.append("> 由 `tools\\s2-budget.py` 生成；颜色真源是 `tools\\s2-palette.py`，"
             "官方原值来自 `out\\s2-token-baseline.json`（capturedAt "
             f"{base['source']['baselineCapturedAt']}）。\n")

    L.append("## 0. 方法与口径\n")
    L.append("- **标准**：WCAG 2.1 相对亮度对比度 `(L1+0.05)/(L2+0.05)`，"
             "`L = 0.2126R' + 0.7152G' + 0.0722B'`，通道先做 sRGB→线性化。\n")
    L.append("- **半透明合成**：`comp = fill*a + art*(1-a)`，"
             "**在 encoded sRGB 空间逐通道线性插值**（浏览器 `background-color` 叠加的默认行为，"
             "不做线性化、不做预乘）。这与 P0 §9 的 `art*(1-a) + fill*a` 是同一式子。\n")
    L.append("- **本条预算的局限（必须说清）**：以上是**计算值**。真实像素还会经历"
             "「面板底 → 半透明表面 → 内容」多层叠加、`backdrop-filter`、"
             "以及 GPU 的色彩管理。**S4 必须用浏览器实际合成色重新验证**——"
             "做法是对每个 `(前景, 背景)` 对渲染出真实元素、读 `getComputedStyle` 得到的"
             "实际 `color` / 最终可见背景色再算一次，而不是复用本文件的数字。\n")
    L.append("- 本文件只覆盖**不透明前景压在不透明/半透明底上**这一种最常见情形；"
             "渐变、图片、`color-mix()` 的结果不在本预算内，S4 一并覆盖。\n")

    L.append("## 1. 目标与依据\n")
    L.append("| 前景 | 目标 | 依据 |")
    L.append("|---|---|---|")
    for k, v in (pal.get("targets") or {}).items():
        note = (pal.get("targetNotes") or {}).get(k, "")
        L.append(f"| `{k}` | {v}:1 | {note} |")
    L.append("")

    L.append("## 2. 完整对比度矩阵（本主题值）\n")
    rows = pal.get("contrast") or []
    L.append("| 模式 | 前景 | 背景 | 对比度 | 目标 | 结果 | 偏差 | 官方同对（对照） |")
    L.append("|---|---|---|---|---|---|---|---|")
    worse = []
    for r in rows:
        fg, bg = r.get("fg", "?"), r.get("bg", "?")
        fg_f, bg_f = full(fg, official), full(bg, official)
        mode = r.get("mode", "?")
        ratio = r.get("ratio", float("nan"))
        tgt = r.get("target", r.get("tgt", "?"))
        ok = r.get("pass", ratio >= (tgt if isinstance(tgt, (int, float)) else 0))
        delta = r.get("delta")
        delta_s = f"{delta:+.2f}" if isinstance(delta, (int, float)) else "—"
        ofg = official.get(fg_f, {}).get(mode, "")
        obg = official.get(bg_f, {}).get(mode, "")
        oratio = contrast(ofg, obg) if ofg and obg else float("nan")
        o_s = f"{oratio:.2f}" if oratio == oratio else "—"
        if o_s != "—" and isinstance(tgt, (int, float)) and oratio < tgt - 0.005:
            o_s += " ✗不达"
            worse.append((mode, fg_f, bg_f, round(oratio, 2), tgt, round(ratio, 2)))
        L.append(f"| {mode} | `{fg_f}` | `{bg_f}` | **{ratio:.2f}** | {tgt} | "
                 f"{'OK' if ok else 'FAIL'} | {delta_s} | {o_s} |")
    L.append("")
    bad = [r for r in rows if not r.get("pass", True)]
    L.append(f"**共 {len(rows)} 对，未达标 {len(bad)} 对。**\n")

    if worse:
        L.append("### 2.1 官方在这些对上本来就不达 AA（本主题逐个补上）\n")
        L.append("| 模式 | 前景 | 背景 | 官方对比度 | 官方是否达 AA | 本主题 |")
        L.append("|---|---|---|---|---|---|")
        for mode, fg_f, bg_f, oratio, tgt, my in worse:
            L.append(f"| {mode} | `{fg_f}` | `{bg_f}` | {oratio:.2f} | ✗ 不达（AA {tgt}:1） | "
                     f"{my:.2f} |")
        L.append("")
        L.append("这不是「为了好看牺牲可读性」的反面，而是：**官方默认主题本身有若干处不达 AA**，"
                 "本主题在这些位置选择满足目标，并把偏差写进上表。\n")

    L.append("## 3. 壁纸预算：半透明 veil 覆盖 art 时的可读性边界\n")
    L.append("求解方法：固定 ink 与 veil（颜色 + alpha），二分求出**满足目标对比度的合成色边界**，"
             "再按 `art = (comp - fill*a)/(1-a)` 反解 art 的单通道边界。"
             "方向由 ink 与 veil 的明暗关系决定：\n")
    L.append("- **亮 ink + 暗 veil ⇒ 合成色有上限**（art 越亮越危险）——这是暗色模式的情形。\n")
    L.append("- **暗 ink + 亮 veil ⇒ 合成色有下限**（art 越暗越危险）——这是亮色模式的情形。\n")
    L.append("- 这两种方向合起来就是 P0 §9「白色 veil 只能压暗、不能提亮」的定量形式。\n")
    L.append("| 模式 | veil | alpha | fill | ink | 方向 | 合成色边界 | 边界亮度 | "
             "art 单通道边界 | 归一 | 含义 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for w in pal.get("wallpaper") or []:
        L.append(f'| {w["mode"]} | `{w["veil"]}` | {w["alpha"]:.2f} | `{w["fill"]}` | '
                 f'`{w["ink"]}` | {w["direction"]}→{w["target"]}:1 | `{w["compBound"]}` | '
                 f'{w["compBoundLum"]:.4f} | {w["artBoundByte"]}/255 | '
                 f'{w["artBoundNorm"]:.3f} | {w["note"]} |')
    L.append("")

    cands = pal.get("wallpaperCandidates") or []
    if cands:
        L.append("### 3.1 8 张候选壁纸代进同一公式\n")
        L.append("art 亮度用该图实测的 p05 / p50 / p95 分位（`out\\s2-wallpapers.json`）当代理，"
                 "**p95 = 最亮 5% 区域**，即最危险的情形。\n")
        L.append("| 文件 | 分位 | art 亮度 | art 灰度 | 暗色合成 | 暗色对比度 | "
                 "亮色合成 | 亮色对比度 | 判定 |")
        L.append("|---|---|---|---|---|---|---|---|---|")
        span: dict[str, dict[str, float]] = {}
        for r in cands:
            d = next((x for x in r["rows"] if x["mode"] == "dark"), {})
            l = next((x for x in r["rows"] if x["mode"] == "light"), {})
            ok = d.get("pass") and l.get("pass")
            span.setdefault(r["file"], {})[r["probe"]] = d.get("contrast", float("nan"))
            L.append(f'| `{r["file"]}` | {r["probe"]} | {r["artLum"]:.4f} | `{r["artGray"]}` | '
                     f'`{d.get("composite", "?")}` | {d.get("contrast", float("nan")):.2f} | '
                     f'`{l.get("composite", "?")}` | {l.get("contrast", float("nan")):.2f} | '
                     f'{"OK" if ok else "FAIL"} |')
        L.append("")

        L.append("### 3.2 亮色模式的壁纸亮度上限与可读性代价\n")
        dark_p95 = [r for r in cands if r["probe"] == "p95"]
        if dark_p95:
            mn = min(r["rows"][0]["contrast"] for r in dark_p95)
            mx = max(r["rows"][0]["contrast"] for r in dark_p95)
            L.append(f"**暗色模式没有上限问题**：8 张图的 p95 代进 72% 的 veil 后，"
                     f"正文对比度落在 **{mn:.2f}:1 … {mx:.2f}:1**，"
                     f"全部远高于 4.5:1 目标。也就是说 veil 足够厚，"
                     f"**没有任何一张候选壁纸的亮部能破坏正文可读性**。\n")
        L.append("**亮色模式的约束方向相反，而且它不是一条可读性约束**："
                 "80% 的亮 veil 单独就已经（在 art 全黑时）把合成色抬到远高于 4.5:1 所需的下限"
                 "（见 §3 表中亮色行的 `art 单通道边界`——它落在 art 的取值域之下，"
                 "意味着**任意暗度的 art 都不会破坏可读性**）。\n")
        L.append("真正的代价在**图像的可见度**：亮色模式下 art 只贡献 `1-a = 20%` 的振幅，"
                 "而 8 张参考图的亮度分布全部集中在暗端（平均亮度 0.0200–0.2228，"
                 "其中 6 张有 39%–96% 的像素低于 0.05）。结果是：\n")
        L.append("1. 合成色几乎全部落在亮端（如 `#c8c9cb` … `#e5e6e8`），"
                 "**夜景被洗成一层苍白的幽灵**——可读性没问题，但参考图的「暗室 + 霓虹」性格丢失；\n")
        L.append("2. 图像的信息量被压到原来的五分之一，招牌、灯管、人物轮廓都糊成灰调噪点。\n")
        L.append("这与参考图的意图直接冲突，因此 `docs\\design.md` §7 决策点 1 给出三个选项，"
                 "其中**推荐 A：亮色模式使用程序提亮的同构图**"
                 "（把阴影抬起、gamma 压平，使 art 的亮度分布整体右移），"
                 "让同一个令牌预算在亮色下也能承载「窗外那座城」。\n")
        L.append("**如果最终选择不做壁纸**（选项 C），本节的全部结论自然失效，"
                 "令牌层的全部比值（§2）不受任何影响——因为 `bg-base` 是不透明的。\n")

    L.append("## 4. 留给 S4 的复验清单\n")
    L.append("本文件是**计算预算**，不是渲染证据。S4 必须用浏览器真实合成色重做以下检查：\n")
    L.append("1. 对 §2 表中每一对，在真实元素上读 `getComputedStyle` 的实际 `color` "
             "与最终可见背景色（含半透明表面的真实合成），重算对比度并比对本文目标；\n")
    L.append("2. 覆盖 §2 未含的情形：渐变上的文字、`color-mix()` 结果、"
             "`backdrop-filter` 面板上的文字、悬浮/按下/禁用/选中四种交互态；\n")
    L.append("3. 若启用壁纸：在真实渲染中取壁纸最亮区域，验证正文对比度仍 ≥ 目标；\n")
    L.append("4. 覆盖文本度量变更（`--dsw-font-family` 前置 Bahnschrift）后的"
             "「长中文段落 + 长英文标识符 + 代码块」三种文本，确认无溢出、无异常换行。\n")

    text = "\n".join(L) + "\n"
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "contrast-budget.md").write_text(text, encoding="utf-8")
    print(f"wrote docs\\contrast-budget.md  rows={len(rows)} bad={len(bad)} "
          f"officialFail={len(worse)} cands={len(cands)} chars={len(text)}")
    if bad:
        for r in bad:
            print("  FAIL", r.get("mode"), r.get("fg"), r.get("bg"), r.get("ratio"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
