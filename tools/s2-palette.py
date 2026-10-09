"""S2 调色板（**S2 的唯一颜色真源**）。

这一个文件同时承担四件事，避免文档里的数字与脚本里的数字漂移：
  1. 定义 EVA（新世纪福音战士）调色板（OKLCh 锚点生成中性梯 + 显式信号色）
  2. 对每个颜色算出可测量的冷暖偏向（OKLCh 色相角 / 彩度 / CIELAB b*）
  3. 算出所有 ink/fill 组合的 WCAG 对比度，并对目标给出偏差
  4. 算壁纸预算：给定 veil 的 alpha，反解「art 亮度上限」与可读性代价

EVA 两条路线（各自独立成立，不吃透传）：
  深色 = **NERV 中央教条**：紫黑基底（色相锚点取初号机紫 `#663399`，实测 303.4°）；
         信号色「点亮」：**NERV 橙**=品牌/链接，**初号机紫**=信息/焦点环，
         **初号机绿**=成功，**危险黄**=警告，**Unit-02 红**=错误。
  亮色 = **标题卡**（照壁纸 8g9wyy 那张近灰阶图）：近白中性基底（色相锚点取该图板岩块
         `#424153`，实测 287.4°）；信号色「灭灯」＝同一批色相的压暗版本，逐色过 AA。
  两档主按钮的墨色方向相反（深色＝亮橙底＋近黑墨，亮色＝暗橙底＋近白墨），
  这是两条路线独立性的最硬证据，并由下面的 TARGETS 逐项验收。

**没有外部依赖**（OKLab/OKLCh/CIELAB 全部手写），因此 DSH runtime Python 与
系统 Python 都能跑，也能在 build 阶段复用。

解释器：DSH runtime Python（只用标准库；不需要 numpy）
用法：
  $pyr tools\\s2-palette.py              # 摘要 + 全部检查
  $pyr tools\\s2-palette.py --ladder     # 打印生成的色阶 hex
  $pyr tools\\s2-palette.py --json       # 只写 out\\s2-palette.json
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


# ---------------------------------------------------------------- 颜色数学

def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c: float) -> float:
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if len(h) == 8:
        h = h[:6]
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_to_hex(rgb) -> str:
    return "#" + "".join(f"{max(0, min(255, round(v))):02x}" for v in rgb)


def rgb_to_oklab(rgb) -> tuple[float, float, float]:
    r, g, b = (_srgb_to_linear(v / 255) for v in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def oklab_to_rgb(lab) -> tuple[int, int, int]:
    L, a, b = lab
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return tuple(round(255 * _linear_to_srgb(max(0.0, min(1.0, v)))) for v in (r, g, bb))  # type: ignore[return-value]


def lch_to_hex(L: float, C: float, h_deg: float) -> str:
    """OKLCh -> sRGB hex（用于程序化生成中性梯）。"""
    a = C * math.cos(math.radians(h_deg))
    b = C * math.sin(math.radians(h_deg))
    return rgb_to_hex(oklab_to_rgb((L, a, b)))


def oklch(hexstr: str) -> tuple[float, float, float]:
    L, a, b = rgb_to_oklab(hex_to_rgb(hexstr))
    C = math.hypot(a, b)
    h = math.degrees(math.atan2(b, a)) % 360
    return L, C, h


def lab_d65(hexstr: str) -> tuple[float, float, float]:
    """CIELAB（D65 白点）。b* < 0 = 偏冷（蓝），b* > 0 = 偏暖（黄）。"""
    r, g, b = (_srgb_to_linear(v / 255) for v in hex_to_rgb(hexstr))
    X = 0.4123907993 * r + 0.3575843394 * g + 0.1804807884 * b
    Y = 0.2126390059 * r + 0.7151686788 * g + 0.0721923154 * b
    Z = 0.0193308187 * r + 0.1191947798 * g + 0.9505321522 * b
    Xn, Yn, Zn = 0.9504559, 1.0, 1.0890578
    f = lambda t: t ** (1 / 3) if t > 216 / 24389 else (841 / 108) * t + 4 / 29  # noqa: E731
    fx, fy, fz = f(X / Xn), f(Y / Yn), f(Z / Zn)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def rel_lum(hexstr: str) -> float:
    r, g, b = (_srgb_to_linear(v / 255) for v in hex_to_rgb(hexstr))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def over(fill: str, alpha: float, art: str) -> str:
    """CSS 合成：art*(1-a) + fill*a，按 sRGB 编码值逐通道（浏览器默认行为）。"""
    fa, aa = hex_to_rgb(fill), hex_to_rgb(art)
    return rgb_to_hex(tuple(f * alpha + a * (1 - alpha) for f, a in zip(fa, aa)))


def parse_alpha(hexstr: str) -> float:
    h = hexstr.lstrip("#")
    return int(h[6:8], 16) / 255 if len(h) == 8 else 1.0


# ---------------------------------------------------------------- 调色板定义
# **2026-10-06 第三轮：参考图只用来定「其他配色」，底色不动。**
#   亮档参考 = Newtype 封面（图 1），取色 `#3F629C` `#0EB49C` `#AAC7EF` `#FEA1BE`
#               `#DF9055` `#C62D41`
#   暗档参考 = 初号机机体海报（图 2），取色 `#745694` `#3FA03F` `#FF9E21` `#881D25`
#               `#191C21`
# 用户当天的更正：「**你搞错了！！！没让你改背景色，背景保持不变，只调整其他配色！！！**」
# —— 所以**两档的底色、表面梯、墨色梯、描边 ink、遮罩、画布层 hex 全部维持第二轮
# （初号机紫黑 h300 / 薰衣草白 h288）原样**，参考图只进入 `SIGNAL` 与由它派生的 `TINT`。
# 上面曾有一版把锚点也换成参考图的 260.7/256.5、并把表面梯按参考图重排，那是**误读**，
# 已整体撤回；本文件里凡是「参考图」字样都只指信号色，不再指底色。
#
# L/C 的来源分两类：
#   * **表面梯**：沿用第二轮的 (L, C)，**本轮不动**；
#   * **墨色梯 / 信号色**：信号色的色相与彩度照抄参考图，**L 按 TARGETS 反解**。
#     参考图是印刷品/插画，直接拿来当正文色大面积不过：`#745694` 在紫黑底上 2.99:1、
#     `#881D25` 只有 1.92:1、亮档 `#0EB49C` 2.43:1、`#DF9055` 2.37:1。
#     能原值直接用的有：暗档 `#FF9E21`、亮档 `#3F629C`、亮档 `#C62D41`。

NEUTRAL_HUE_COOL = 300.0   # 暗档基底：初号机紫黑（第二轮值，本轮不动）
NEUTRAL_HUE_PALE = 288.0   # 亮档基底：薰衣草白（第二轮值，本轮不动）

LADDER_SPEC = {
    #  token 后缀            深色(L,   C)        亮色(L,   C)      文档 hex 深/亮
    #  **本块第三轮整体不动**——用户要求「背景保持不变」。
    #  第二轮：暗档 L 整体下压到初号机近黑（L .205），C 收一档（紫黑比深靛蓝更「脏」）；
    #  锚点 h300（暗）/ h288（亮），即初号机紫黑 / 薰衣草白。
    #  撤回记录：第三轮曾把这里换成参考图 2 底色的 (L,C)=(.2255,.0107)（bg-base 直接等于
    #  `#191c21`），并让亮档整梯带上封面浅蓝的彩度（bg-base `#d1e5ff`）——那是**把背景
    #  也当成参考图对象**的误读，已整体还原到下面这组值。
    "bg-base":            ((0.205, 0.035),  (0.915, 0.016)),  # 暗 #1a1325 / 亮 #e2e1ed
    "bg-layer-1":         ((0.268, 0.038),  (0.974, 0.005)),  # 暗 #292236 / 亮 #f6f6fa
    "bg-layer-2":         ((0.240, 0.040),  (0.959, 0.008)),  # 暗 #221b2f / 亮 #f1f1f7
    "bg-layer-3":         ((0.268, 0.038),  (0.881, 0.019)),  # 暗 #292236 / 亮 #d7d6e4
    "bg-module-platform": ((0.178, 0.032),  (0.881, 0.019)),  # 暗 #130e1d / 亮 #d7d6e4
    # 侧栏填充 = 底色（与 `bg-base` 同值）。文档 §7 给的是 surface 档
    # `#27334C` / `#F0F1F7`，比底色亮一档，于是侧栏与主区之间有一条
    # 13/255（亮档）的竖向色阶边——描边归零后，用户 2026-10-06 反馈
    # 「还会有线呀」看到的正是这条边，不是描边。用户要的是「无边框设计」，
    # 故直接对齐底色，两区共用同一块背景（偏差记在 docs\design.md §9）。
    "specific-sidebar-fill": ((0.205, 0.035), (0.915, 0.016)),  # = bg-base
    # 输入区卡片（`--dsw-specific-input-major`）。文档 §6 给的是 input-bg-focus
    # 暗档 `#303B54` / 亮档 `#F5F6FA`，与 layer-1 同值。
    "specific-input-major": ((0.268, 0.038), (0.974, 0.005)),  # #292236 / #f6f6fa
    # 墨色梯：L 重排是第二轮之前就定下的（文档 L .887/.737/.585/.585/.485 会让
    # tertiary 3.37、caption 3.37、dimmed 2.18 三档一起失败，目标 4.5/4.5/3.0，
    # 且 secondary 与 tertiary 只差 0.004——阶梯会在中段塌成一档）；重排后每档都有
    # +0.2~+0.5 余量，同时保住文档的明暗次序。
    #  **第三轮不动**：墨色属于「背景侧」，跟着锚点 h300/h288 走。
    #  **2026-10-07 亮档重解（用户点名：「修改亮色模式下文字的颜色以满足对比度要求」）**：
    #  上面这套 L 是按**不透明**的 bg-layer-1 `#f6f6fa` 解的，而主题现在让壁纸透出
    #  （veil alpha 0.35 + 面纱 0.30），文字真正坐的面是「壁纸+面纱」合成面——真机取像素：
    #  输入框控制行 ~170、卡片/面板 ~245、**侧栏壁纸中灰区 ~115**。按合成面复测，原值
    #  只有 primary 在 170 上到 5.23，secondary 3.27 / tertiary 2.56 / caption 2.24 /
    #  dimmed 1.52 全部不达 AA。故**只动亮档**，把整梯压到能在 170 面上达标的位置
    #  （实测 170/245：primary 6.85/14.60、secondary 5.93/12.63、tertiary 5.16/10.99、
    #  caption 4.71/10.04、dimmed 3.52/7.50）；暗档一个值都不动。
    #  物理上限（如实记录，不假装达标）：背景 115 时**纯黑**也只能 4.5:1，而壁纸亮处到 245
    #  ——115~245 的跨度让任何单一深色墨都必然在某一端失守；侧栏壁纸深灰区的残余失守
    #  是面纱透明度的代价，唯一另一根杠杆是给侧栏加 scrim（与用户「壁纸透出」要求冲突）。
    "label-primary":      ((0.887, 0.015), (0.255, 0.031)),  # #dbd8e2 / #222031
    "label-secondary":    ((0.825, 0.025), (0.300, 0.031)),  # #c8c2d4 / #2d2b3d
    "label-tertiary":     ((0.770, 0.033), (0.335, 0.028)),  # #b7b0c7 / #363545
    "label-caption":      ((0.736, 0.033), (0.360, 0.028)),  # #aca5bc / #3c3b4b
    "label-dimmed":       ((0.635, 0.036), (0.430, 0.020)),  # #8e869e / #4f4e5a
}

# 显式信号色（＝用户说的「其他配色」）。`hue~` = [深, 亮]，是本脚本实测的 OKLCh 色相角，不是目测。
# **第四轮：仍然只有这一族吃参考图，底色族一律不动。**
# 用户原话：「亮色用图1，暗色用图2」＋「不改变背景的颜色（底色），只是调整其他颜色」。
#   暗档（参考图 2 = 初号机机体海报，**与第三轮同一张**）= 橙 `#FF9E21`、紫 `#745694`、
#        绿 `#3FA03F`、暗红 `#881D25`、近黑 `#191C21`
#   亮档（参考图 1 = 二号机色卡，本轮换图）= 近黑 `#1A1D22`、暗红 `#B42D29`、
#        橙 `#FFA628`、绿 `#51D253`、灰 `#99989E`
# 两张图各有五格，扣掉「近黑＝底色」（用户明令不动）后剩四格，按同一套角色对齐：
# 橙=品牌橙、绿=成功、紫|灰=业务强调、暗红=错误。暗档因此**一个字都不用改**；
# 本轮只重解亮档。四格实测（对 bg-base `#e2e1ed`——`CONTRAST_PAIRS` 里品牌色正是在
# 这一档验收，它比 bg-layer-1 更难）：
#   橙 `#ffa628` 1.51:1 → `#9a4900` 4.88:1
#   绿 `#51d253` 1.52:1 → `#007000` 4.89:1
#   暗红 `#b42d29` 4.85:1 → **原值照用**（本轮唯一能照抄的一格）
#   灰 `#99989e` 2.21:1 → `#49484d` 7.00:1（业务强调不在 TARGETS 里，按可见性解，色相照抄）
# 其余一律走 D4 的老办法「**色相与彩度照抄、明度重解**」，且四格统一解到 4.85:1，
# 好让亮档信号族的明度站在一起，也给真机合成面留余量（实测亮档合成面比 bg-base 再暗 ~2%）。
# 键名 `business-accent` 保持不变：暗档紫、亮档灰，本来就不该叫 purple。
# 警告色两张图都没有黄，故仍是派生琥珀，但按**同一个 4.85:1 目标**重解，
# 并保住与品牌橙的色相间距：暗 `#ebb353`(h78.0) 差 12.8°、亮 `#8b5300`(h66.3) 差 **14.5°**。
SIGNAL = {
    "nerv-orange":     {"dark": "#ff9e21", "light": "#9a4900", "hue~": [65.2, 51.9]},
    "business-accent": {"dark": "#9576b7", "light": "#49484d", "hue~": [305.5, 295.2]},
    "status-green":    {"dark": "#49a948", "light": "#007000", "hue~": [143.3, 142.5]},
    "status-warn":     {"dark": "#ebb353", "light": "#8b5300", "hue~": [78.0, 66.3]},
    "status-error":    {"dark": "#e47271", "light": "#b42d29", "hue~": [22.0, 27.1]},
}
# 四态互斥（暗档 业务 305.5 / 成功 143.3 / 警告 78.0 / 错误 22.0；
#           亮档 业务 295.2 / 成功 142.5 / 警告 66.3 / 错误 27.1）：
# 相邻最小间距 **56.0°（暗）/ 39.2°（亮）**，两档都落在警告与错误之间 —— 仍比第二轮
# 29.7°/33.4° 宽，但亮档比第三轮的 50.5° 窄了 11°，原因是二号机色卡的绿/红/橙本身
# 挨得更近（`#51D253` h143.5 与 `#3FA03F` h143.3 同族，暗红却从 h19.5 挪到 h27.1）。
# 品牌橙与警告琥珀差 **12.8°（暗）/ 14.5°（亮）**；暗档两色还靠明度分层
# （品牌 L .781 vs 警告 L .800），亮档两色 L 几乎相同（.4995 / .4968），
# 只靠色相分开 —— 这一对仍是全集最窄的，两张参考图各只给了一个暖色。

# 描边族（文档 §4 边框族：亮 `#CDD1DE`→`#9299AD`、暗 `#343F57`→`#566078` 四档）。
# 结构保持「一个 ink + 四个 alpha」：ink 取**对侧**的基底色——亮档用暗档底色
# `#1a1325`、暗档用亮档底色 `#e2e1ed`（细边框＝用对手戏的底色描自己的面）。
# **第三轮不动**：ink 属于底色族。
#
# 2026-10-06 用户要求「无边框设计，现在分割线太明显了」→ 整族 alpha 压成**发丝带**。
# 原来四档（0.069/0.132/0.198/0.261）是「合成色等于文档四档边框」逐通道反解出来的，
# 那是**按文档画线**；用户要的是**不画线**，所以这里主动偏离文档 §4 的边框明度，
# 只保留它的「四档有序」结构（l1 最弱 → l4 最强）。
# 实测依据：真机上当前唯一被画出来的线是 `--dsw-alias-border-l3`（侧栏右缘 + 新会话按钮，
# `rgba(32,43,66,0.196)`）；在亮档面上它造成的通道落差约 41/255。第一轮压到 0.045（约 9/255）
# 后用户仍反馈「还会有线呀」（2026-10-06）——逐像素量他那一帧，主因其实是**底色落差**
# （侧栏 `#f0f1f7` 比主区 `#dfe2ee` 亮，13/255 的竖边），已由 sidebar-fill 对齐底色消掉；
# 剩下的 1px l3 发丝（9/255）仍可被眼睛找到，故再压一档到**阈下带**
# 0.4% / 0.8% / 1.3% / 2.4%（l3 落差 ≈ 2.5/255，亮暗同量级，1px 下不可见）。
# 至此渲染结果即「无边框」：区域分隔只由内容与交互态承担，底色与描边都不再分界。
BORDER_INK = {"dark": "226,225,237", "light": "26,19,37"}
BORDER_ALPHA = (0.004, 0.008, 0.013, 0.024)   # l1 l2 l3 l4（阈下带；旧 0.015/0.028/0.045/0.075）

# 交互 tint ＝ 信号色的 alpha 版本（键名必须存在于 SIGNAL）。
# 两档的悬浮/强调色都跟着**本档的信号色**走：暗档橙 + 紫，亮档沿用第二轮映射
# （悬浮＝品牌橙、强调＝business-accent），因为这两档的背景没有被参考图改动。
# 破坏性悬浮两档都用错误红；alpha 沿用第一轮（观感已在真机验收过）。
TINT = {
    "interactive-bg-hover":         {"dark": ("nerv-orange", 0.10), "light": ("nerv-orange", 0.09)},
    "interactive-bg-hover-accent":  {"dark": ("business-accent", 0.18), "light": ("business-accent", 0.14)},
    "interactive-bg-active":        {"dark": ("business-accent", 0.26), "light": ("business-accent", 0.20)},
    "interactive-bg-hover-solid":   {"dark": ("nerv-orange", 0.14), "light": ("nerv-orange", 0.12)},
    "interactive-bg-hover-danger":  {"dark": ("status-error", 0.16), "light": ("status-error", 0.12)},
}

# 面板材质（半透明，直接吃壁纸）。文档 §14：亮 `--overlay-surface: rgba(240,241,247,.78)`、
# 暗 `rgba(32,43,66,.78)`——第一轮正对应新梯的 `bg-layer-2`(亮) 与 `bg-base`(暗)；
# 第二轮底色换紫之后，两者仍然是 **同一位置的表面**，只是色相跟着锚点走。
# alpha 由 §12.2 的用户决定固定为 .78（旧值 .80/.72 是壁纸预算的解，不是文档值）。
#
# 2026-10-06 追加（用户：「先给对话框添加毛玻璃和透明效果」）：`specific-input-major`
# 就是对话框卡片自己的填充（真机反查：`DIV.RlGAzG_card[data-composer-card]`，
# 亮 `#f5f6fa` / 暗 `#303b54`，即 `bg-layer-1` 的值）。这里把它锚到 `bg-layer-1`
# 并给 alpha，卡片从此半透明；毛玻璃的 blur 由 paint layer 的
# `[data-composer-card]` 规则补（令牌层表达不了 backdrop-filter）。
#
# alpha 取 **0.62 / 0.68**，而不是面板的 0.78/0.80：面板叠在主区之上，而主区本身
# 已经是一层 0.78 的 veil，若卡片也 0.78，壁纸透出量只剩 0.22×0.22≈5%，观感等于
# 不透明 —— 用户要的「透明」就落空了。0.62 让透出量升到 ~14%，同时 `label-*`
# 在卡片上的对比度仍有富余（亮档 caption 4.63→4.5 以上，真机复测见 render-report §16）。
SURFACE = {
    "menu-surface-fill": {"dark": ("bg-base", 0.78), "light": ("bg-layer-2", 0.78)},
    "specific-input-major": {"dark": ("bg-layer-1", 0.68), "light": ("bg-layer-1", 0.62)},
}

# 其余需要取值的表面/状态令牌（显式 hex；alpha 用 MASK 表）。
# 前 7 条（画布层 + 滚动条 + overlay + tooltip）：**属于底色族，第三轮不动**——
# 值按锚点 h300/h288 现算（`lch_to_hex(L, C, NEUTRAL_HUE_*)`，不是目测）：
# 画布层与滚动条四条保持「相对锚定面的 L 阶梯」（暗 .30/.34/.38/.42、亮 .84/.78/.72/.66），
# `markdown-code-block` 取本档 bg-deep、`bg-overlay` 取上层底色，与第一轮同构；
# 滚动条按文档 §11「thumb = var(--color-border)、hover = var(--color-border-strong)」
# 对到新的四档描边族（§11 同时规定普通滚动条不得用 NERV 橙）。
# 后 3 条是**次级状态色 = 信号族**，第四轮跟着参考图 1（二号机色卡）走：
# 亮档三条一律取本档主信号的「色相照抄、明度 +0.055」——这就是第二轮实测出的
# 主/次级间距（三对差 +0.057 / +0.046 / +0.062，取中）。暗档三条不动。
EXTRA_ALIAS = {
    "markdown-code-block":   {"dark": "#130e1d", "light": "#d7d6e4"},   # §13 --code-bg = 本档 bg-deep
    "scrollbar-bg-l1":       {"dark": "#31293f", "light": "#c9c8da"},   # 描边族第 1 档
    "scrollbar-hover-l1":    {"dark": "#3b334a", "light": "#b6b5c7"},   # 描边族第 2 档
    "scrollbar-bg-l2":       {"dark": "#453e55", "light": "#a3a2b4"},   # 描边族第 3 档
    "scrollbar-hover-l2":    {"dark": "#504860", "light": "#9190a1"},   # 描边族第 4 档
    "bg-overlay":            {"dark": "#221b2f", "light": "#e2e1ed"},   # §14 --overlay-panel 底
    "tooltip-bg":            {"dark": "#453e55", "light": "#1e1d2d"},
    "state-error-secondary": {"dark": "#ff9a92", "light": "#c74039"},   # 亮档=错误红 +0.055L
    "state-success-secondary": {"dark": "#7cff78", "light": "#20811c"},  # 亮档=成功绿 +0.055L
    "state-warn-secondary":  {"dark": "#ffc894", "light": "#a1601d"},   # 亮档=警告琥珀 +0.055L
}
# 遮罩：深色模式更重（暗室），亮色模式更轻。文档 §10 给的是
# `--dialog-overlay: rgba(10,14,24,.55)`（`#0a0e18`，偏蓝）。第二轮底色换紫之后
# 蓝黑 scrim 会在紫黑底上泛蓝，故 fill 换成更中性的 **`#0b0613`**；
# 文档「夜间模式不要使用纯黑遮罩」这条仍然遵守。第三轮不动。
MASK = {
    "bg-mask-1": {"dark": ("#0b0613", 0.62), "light": ("#0b0613", 0.34)},
    "bg-mask-2": {"dark": ("#0b0613", 0.76), "light": ("#0b0613", 0.48)},
}

# 只做「基底色 → ink」的单向引用，供对比度矩阵使用
CONTRAST_PAIRS = [
    ("label-primary", "bg-base"), ("label-primary", "bg-layer-1"),
    ("label-primary", "bg-layer-2"), ("label-primary", "bg-layer-3"),
    ("label-secondary", "bg-layer-1"), ("label-tertiary", "bg-layer-1"),
    ("label-caption", "bg-layer-1"), ("label-dimmed", "bg-layer-1"),
    ("brand-primary", "bg-base"), ("brand-primary", "bg-layer-1"),
    ("link", "bg-layer-1"), ("state-error-primary", "bg-layer-1"),
    ("state-success-primary", "bg-layer-1"), ("state-warn-primary", "bg-layer-1"),
    ("state-warn-label", "bg-layer-1"), ("label-primary-foreground", "brand-primary"),
    # 输入区卡片（S4 实测发现它吃 `--dsw-specific-input-major`，且四种墨色都落在上面）
    ("label-primary", "specific-input-major"), ("label-secondary", "specific-input-major"),
    ("label-tertiary", "specific-input-major"), ("label-caption", "specific-input-major"),
]

TARGETS = {  # token -> (最低要求, 说明)
    "label-primary": (4.5, "正文 ink，AA"),
    "label-secondary": (4.5, "次级正文，AA"),
    "label-tertiary": (4.5, "三级正文，AA"),
    "label-caption": (4.5, "说明文字，AA"),
    "label-dimmed": (3.0, "弱化/占位，AA-large"),
    "brand-primary": (4.5, "强调色正文（链接/品牌）"),
    "link": (4.5, "链接正文"),
    "state-error-primary": (4.5, "状态正文"),
    "state-success-primary": (4.5, "状态正文"),
    "state-warn-primary": (3.0, "状态色（多与图标并用）"),
    "state-warn-label": (4.5, "状态文字"),
    "label-primary-foreground": (4.5, "主按钮上的文字"),
}


def build_palette() -> dict:
    pal: dict[str, dict[str, str]] = {"dark": {}, "light": {}}
    for suffix, (dark_spec, light_spec) in LADDER_SPEC.items():
        # 官方命名不一致：`--dsw-specific-*` 不带 alias 前缀（A 级实测
        # s2-token-baseline.json），其余色阶令牌都带。
        prefix = "--dsw-" if suffix.startswith("specific-") else "--dsw-alias-"
        pal["dark"][f"{prefix}{suffix}"] = lch_to_hex(*dark_spec, NEUTRAL_HUE_COOL)
        pal["light"][f"{prefix}{suffix}"] = lch_to_hex(*light_spec, NEUTRAL_HUE_PALE)

    for mode in ("dark", "light"):
        pal[mode]["--dsw-alias-brand-primary"] = SIGNAL["nerv-orange"][mode]
        pal[mode]["--dsw-alias-link"] = SIGNAL["nerv-orange"][mode]
        pal[mode]["--dsw-alias-state-business-primary"] = SIGNAL["business-accent"][mode]
        pal[mode]["--dsw-alias-state-error-primary"] = SIGNAL["status-error"][mode]
        pal[mode]["--dsw-alias-state-success-primary"] = SIGNAL["status-green"][mode]
        pal[mode]["--dsw-alias-state-warn-primary"] = SIGNAL["status-warn"][mode]
        pal[mode]["--dsw-alias-state-warn-label"] = SIGNAL["status-warn"][mode]
        # 主按钮上的墨色：两档都取「基底色的极值」再换到新色相——暗档近黑（`#080c15`）、
        # 亮档近白（`#f5f7fb`）。实测 暗档在 #fd8440 上 7.96:1、亮档在 #aa4500 上 5.50:1，
        # 都由 TARGETS 的 4.5 验收。
        pal[mode]["--dsw-alias-label-primary-foreground"] = (
            lch_to_hex(0.155, 0.020, NEUTRAL_HUE_COOL) if mode == "dark"
            else lch_to_hex(0.975, 0.006, NEUTRAL_HUE_PALE))

    for i, tok in enumerate(("border-l1", "border-l2", "border-l3", "border-l4")):
        for mode in ("dark", "light"):
            r, g, b = BORDER_INK[mode].split(",")
            a = BORDER_ALPHA[i]
            pal[mode][f"--dsw-alias-{tok}"] = "#%02x%02x%02x%02x" % (
                int(r), int(g), int(b), round(a * 255))

    for tok, spec in TINT.items():
        for mode in ("dark", "light"):
            sig, a = spec[mode]
            r, g, b = hex_to_rgb(SIGNAL[sig][mode])
            pal[mode][f"--dsw-alias-{tok}"] = "#%02x%02x%02x%02x" % (r, g, b, round(a * 255))

    for tok, spec in SURFACE.items():
        for mode in ("dark", "light"):
            base, a = spec[mode]
            r, g, b = hex_to_rgb(pal[mode][f"--dsw-alias-{base}"])
            pal[mode][f"--dsw-{tok}"] = "#%02x%02x%02x%02x" % (r, g, b, round(a * 255))

    for tok, spec in EXTRA_ALIAS.items():
        for mode in ("dark", "light"):
            pal[mode][f"--dsw-alias-{tok}"] = spec[mode]

    for tok, spec in MASK.items():
        for mode in ("dark", "light"):
            fill, a = spec[mode]
            r, g, b = hex_to_rgb(fill)
            pal[mode][f"--dsw-alias-{tok}"] = "#%02x%02x%02x%02x" % (r, g, b, round(a * 255))

    # 非颜色令牌（几何 / 动效 / 字体）——不参与对比度，但同属差异表
    #
    # 角形：2026-10-06 用户要求「把边框角形全部换回官方的默认圆角」。这里**不再声明**
    # `--dsw-corner-shape`：主题层原本把它改成 bevel（切角），改成官方值 superellipse(1.5)
    # 也等价于「不声明」——官方主题自己的值会生效。留着一条与官方相同的声明会被
    # tools/token-audit.mjs 判为「未改动的令牌混进了差异表」（P0），所以正确的做法是删掉它，
    # 而不是写一个官方值。代价是令牌数 55 -> 54，三套计数门槛同步改。
    NONCOLOR = {
        "--dsw-radius-xs": {"dark": "2px", "light": "2px"},
        "--dsw-radius-sm": {"dark": "4px", "light": "4px"},
        "--dsw-radius-md": {"dark": "6px", "light": "6px"},
        "--dsw-radius-lg": {"dark": "8px", "light": "8px"},
        "--dsw-radius-xl": {"dark": "10px", "light": "10px"},
        "--dsw-radius-panel": {"dark": "12px", "light": "12px"},
        "--ds-ease-in-out": {"dark": "cubic-bezier(0.2, 0.85, 0.15, 1)",
                             "light": "cubic-bezier(0.2, 0.85, 0.15, 1)"},
        "--ds-transition-duration": {"dark": "0.14s", "light": "0.14s"},
        "--ds-transition-duration-fast": {"dark": "0.07s", "light": "0.07s"},
        "--ds-transition-duration-slow": {"dark": "0.22s", "light": "0.22s"},
        "--dsw-menu-backdrop-filter": {
            "dark": "blur(20px) saturate(130%)", "light": "blur(20px) saturate(130%)"},
        # 字体：2026-10-08 用户点名把 Roam 图的字体接进 DSH（「先试试，R3：D1，R6：D3」）。
        # R3 = Roam.css 的 `--body-font`，R6 = `--code-font`；两档同值（暗档在 2026-10-08 00:41 被
        # 用户冻结，本轮经用户批准开一次冻结：字体两档同改 + 暗档摘要重算一次）。
        # D1（--dsw-font-family）是**一条接缝同时管正文与 UI 镀铬**：官方把它声明在 :root，
        # body 自己也在用它，82 处引用 / 27 个选择器，因此它必然是继承链的底。第 26 轮整栈换成
        # R3 之后，第 33 轮曾按用户点名把它**拆开**（D1 只留 UI 面 = R7，正文面交给 8 条
        # `--dsw-font-markdown-*` shorthand）。第 34 轮用户点名**撤销拆分**：正文与 UI 重新同归
        # D1，D1 回到 R3，那 8 条 shorthand 已从本表移除 —— 正文与 UI 同栈，UI 镀铬一并变衬线
        # 是用户明知并接受的代价（D74）。
        # D3（--ds-font-family-code）原不在本表内，第 26 轮新增；R6 原栈一枚 CJK 面都没有，
        # 故在具名字面之后补回官方那两枚 CJK 兜底，再收 generic monospace。
        "--dsw-font-family": {
            "dark": "'Tiempos Text', 'Palatino Linotype', 'HYXuanSong', '汉仪玄宋', "
                    "'方正屏显雅宋_GBK', 'Songti SC', 'STSong', '华文宋体', 'Noto Serif SC', serif",
            "light": "'Tiempos Text', 'Palatino Linotype', 'HYXuanSong', '汉仪玄宋', "
                     "'方正屏显雅宋_GBK', 'Songti SC', 'STSong', '华文宋体', 'Noto Serif SC', serif",
        },
        "--ds-font-family-code": {
            "dark": "'Operator Mono', 'LXGW WenKai Mono', 'CaskaydiaCove Nerd Font', "
                    "'PingFang SC', 'Microsoft YaHei', monospace",
            "light": "'Operator Mono', 'LXGW WenKai Mono', 'CaskaydiaCove Nerd Font', "
                     "'PingFang SC', 'Microsoft YaHei', monospace",
        },
    }
    for tok, spec in NONCOLOR.items():
        for mode in ("dark", "light"):
            pal[mode][tok] = spec[mode]
    return pal


def oklab_of(value: str):
    return rgb_to_oklab(hex_to_rgb(value))


def main() -> int:
    pal = build_palette()

    def solid(mode: str, tok: str) -> str:
        v = pal[mode][tok]
        return v[:7] if parse_alpha(v) >= 1 else over("#000000", 0, v)

    # ① 中性色冷暖偏向
    cast_rows = []
    for mode in ("dark", "light"):
        for tok, v in pal[mode].items():
            if not v.startswith("#") or len(v) != 7:
                continue
            L, C, h = oklch(v)
            _, _, bb = lab_d65(v)
            cast_rows.append({"mode": mode, "token": tok, "hex": v, "L": round(L, 4),
                              "C": round(C, 4), "hue": round(h, 1), "lab_b": round(bb, 2),
                              "verdict": "冷" if bb < 0 else ("暖" if bb > 0 else "纯灰")})

    # ② 对比度
    def resolve(mode: str, name: str):
        """名字 → 实际令牌名：多数带 alias 前缀，`specific-*` 不带（官方命名不一致）。"""
        for cand in (f"--dsw-alias-{name}", f"--dsw-{name}"):
            if cand in pal[mode]:
                return cand
        return None

    crows = []
    for mode in ("dark", "light"):
        for fg, bg in CONTRAST_PAIRS:
            ftok, btok = resolve(mode, fg), resolve(mode, bg)
            f = pal[mode].get(ftok) if ftok else None
            b = pal[mode].get(btok) if btok else None
            if not f or not b:
                continue
            f = f[:7] if parse_alpha(f) >= 1 else over(solid(mode, btok), 1, f)
            ratio = contrast(f, b)
            tgt = TARGETS.get(fg, (4.5, ""))[0]
            crows.append({"mode": mode, "fg": fg, "bg": bg, "fgHex": f, "bgHex": b,
                          "ratio": round(ratio, 2), "target": tgt,
                          "targetNote": TARGETS.get(fg, (4.5, ""))[1],
                          "pass": ratio >= tgt, "delta": round(ratio - tgt, 2)})

    # ③ 壁纸预算：半透明 veil 盖在 art 上时，art 的亮度必须先满足 ink 的可读性。
    #    方向由「ink 比 veil 亮还是暗」决定，两支的约束方向相反：
    #      亮 ink + 暗 veil -> 合成色有【上限】（art 越亮越危险）
    #      暗 ink + 亮 veil -> 合成色有【下限】（art 越暗越危险）
    #    这就是 P0 §9「白色 veil 只能压暗不能提亮」的定量形式。
    def solve_bound(ink: str, fill: str, alpha: float, target: float) -> dict:
        ink_lum = rel_lum(ink)
        light_ink = ink_lum > 0.5
        lo, hi = 0.0, 1.0
        for _ in range(50):
            mid = (lo + hi) / 2
            gray = rgb_to_hex((mid * 255,) * 3)
            ok = contrast(ink, gray) >= target
            if light_ink:          # 合成色越亮越难读 -> 求上限
                if ok:
                    lo = mid
                else:
                    hi = mid
            else:                  # 合成色越暗越难读 -> 求下限
                if ok:
                    hi = mid
                else:
                    lo = mid
        bound = lo if light_ink else hi
        comp = rgb_to_hex((bound * 255,) * 3)
        fill_v = hex_to_rgb(fill)[0]
        art = (bound * 255 - fill_v * alpha) / (1 - alpha)
        byte = max(0, min(255, round(art)))
        if byte >= 255:
            note = "无约束：veil 已厚到 art 无论多亮都不破目标（约束退化为不可达）"
        elif byte <= 0:
            note = "无约束：veil 已厚到 art 无论多暗都不破目标（约束退化为不可达）"
        elif light_ink:
            note = "art 单通道超过此上限即跌破目标（veil 压不住亮壁纸）"
        else:
            note = "art 单通道低于此下限即跌破目标（veil 提不亮暗壁纸）"
        return {
            "mode": "", "veilToken": "", "veil": "", "alpha": round(alpha, 4), "fill": fill,
            "ink": ink, "target": target, "direction": "ceiling" if light_ink else "floor",
            "compBound": comp, "compBoundLum": round(rel_lum(comp), 4),
            "artBoundChannel": round(art),
            "artBoundByte": byte,
            "artBoundNorm": round(max(0.0, min(1.0, art / 255)), 4),
            "note": note,
        }

    wall = []
    for mode in ("dark", "light"):
        veil = pal[mode]["--dsw-menu-surface-fill"]
        a = parse_alpha(veil)
        fill, ink = veil[:7], pal[mode]["--dsw-alias-label-primary"]
        for target in (4.5, 3.0):
            r = solve_bound(ink, fill, a, target)
            r.update(mode=mode, veilToken="--dsw-menu-surface-fill", veil=veil)
            wall.append(r)

    # ③b 把 8 张候选壁纸的真实亮度代进同一公式（用 p95 当"最亮区域"代理）
    wallpapers = []
    wp_path = OUT / "s2-wallpapers.json"
    if wp_path.exists():
        wdata = json.loads(wp_path.read_text(encoding="utf-8"))
        items = wdata.get("images", [])
        for item in (items or []):
            name = item.get("file") or "?"
            lumP = item.get("lumP") or {}
            probes = [("p95", lumP.get("p95")), ("p50", lumP.get("p50")),
                      ("mean", item.get("lumMean"))]
            for probe, v in probes:
                if v is None:
                    continue
                gray = rgb_to_hex((v * 255,) * 3)
                rows = []
                for mode in ("dark", "light"):
                    veil = pal[mode]["--dsw-menu-surface-fill"]
                    a = parse_alpha(veil)
                    comp = over(veil[:7], a, gray)
                    rows.append({"mode": mode,
                                 "composite": comp,
                                 "contrast": round(contrast(pal[mode]["--dsw-alias-label-primary"], comp), 2),
                                 "target": 4.5,
                                 "pass": contrast(pal[mode]["--dsw-alias-label-primary"], comp) >= 4.5})
                wallpapers.append({"file": name, "probe": probe, "artLum": round(v, 4),
                                   "artGray": gray, "rows": rows})

    out = {"palette": pal, "cast": cast_rows, "contrast": crows, "wallpaper": wall,
           "wallpaperCandidates": wallpapers, "signal": SIGNAL,
           "targets": {k: v[0] for k, v in TARGETS.items()},
           "targetNotes": {k: v[1] for k, v in TARGETS.items()},
           "borderInk": BORDER_INK, "borderAlpha": BORDER_ALPHA}
    (OUT / "s2-palette.json").write_text(json.dumps(out, ensure_ascii=False, indent=1),
                                         encoding="utf-8")

    if "--json" in sys.argv:
        print("wrote out\\s2-palette.json")
        return 0

    print("=== 中性色 / 信号色的可测量冷暖偏向（OKLCh + CIELAB）===")
    print(f"{'mode':<6}{'token':<40}{'hex':<10}{'L':>7}{'C':>7}{'hue':>7}{'b*':>7}  verdict")
    for r in cast_rows:
        print(f'{r["mode"]:<6}{r["token"][:39]:<40}{r["hex"]:<10}{r["L"]:>7.3f}{r["C"]:>7.3f}'
              f'{r["hue"]:>7.1f}{r["lab_b"]:>7.2f}  {r["verdict"]}')

    print("\n=== 对比度矩阵（WCAG 2.1）===")
    print(f"{'mode':<6}{'fg':<30}{'bg':<20}{'ratio':>7}{'tgt':>6}  pass  delta")
    for r in crows:
        flag = "OK  " if r["pass"] else "FAIL"
        print(f'{r["mode"]:<6}{r["fg"]:<30}{r["bg"]:<20}{r["ratio"]:>7.2f}{r["target"]:>6.1f}  '
              f'{flag}  {r["delta"]:+.2f}')

    print("\n=== 壁纸预算（半透明 fill 覆盖 art 时的可读性边界）===")
    for w in wall:
        print(f'{w["mode"]:<6} veil={w["veil"]} (a={w["alpha"]:.2f}) fill={w["fill"]} '
              f'ink={w["ink"]}  方向={w["direction"]}')
        print(f'       目标 {w["target"]}:1 -> 合成色边界 {w["compBound"]} '
              f'(lum {w["compBoundLum"]:.4f}), art 单通道边界 {w["artBoundByte"]}/255 '
              f'({w["artBoundNorm"]:.3f})  {w["note"]}')

    if wallpapers:
        print("\n=== 8 张候选壁纸代进同一公式（p95 / p50 / mean 当亮度代理）===")
        print(f'{"file":<22}{"probe":<6}{"artLum":>8}{"artGray":>9}   {"dark comp(ratio)":<22}{"light comp(ratio)":<22}')
        for r in wallpapers:
            d = next(x for x in r["rows"] if x["mode"] == "dark")
            l = next(x for x in r["rows"] if x["mode"] == "light")
            print(f'{r["file"][:21]:<22}{r["probe"]:<6}{r["artLum"]:>8.4f}{r["artGray"]:>9}   '
                  f'{d["composite"] + " (" + format(d["contrast"], ".2f") + ")":<22}'
                  f'{l["composite"] + " (" + format(l["contrast"], ".2f") + ")":<22}'
                  f'{"OK" if d["pass"] and l["pass"] else "FAIL"}')

    bad = [r for r in crows if not r["pass"]]
    print(f"\nunresolved={len(bad)}  contrastPairs={len(crows)} -> out\\s2-palette.json")
    if "--ladder" in sys.argv:
        print("\n=== 生成的中性梯 hex ===")
        for mode in ("dark", "light"):
            for s in LADDER_SPEC:
                # 与 build_palette() 同一前缀规则：`specific-*` 一族不带 alias 前缀
                # （原实现只判 specific-sidebar-fill，加进 specific-input-major 后
                #  --ladder 会 KeyError；本次一并修）
                tok = f"--dsw-{s}" if s.startswith("specific-") else f"--dsw-alias-{s}"
                print(f'  {mode:<6}{tok:<44}{pal[mode][tok]}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
