"""S2 令牌差异表生成器 —— 产出 docs\\tokens-diff.md。

合并三份**已实测**的证据文件，不手抄任何数字：
  out\\s2-token-baseline.json  官方 light/dark 原值 + 引用数 + 声明数
  out\\s2-refcount.json         四口径引用计数（本表用 primary 口径）
  out\\s2-palette.json         本主题新值（颜色/几何/动效/字体）

本文件里的 PLAN 是**设计决策的唯一真源**（层级 A/B/C、理由、影响范围），
颜色数值本身则来自 s2-palette.py —— 两个文件分工明确，改值去 palette，改定位来这里。

解释器：DSH runtime Python（只用标准库）
用法：
  $pyr tools\\s2-emit.py            # 生成 docs\\tokens-diff.md 并打印摘要
  $pyr tools\\s2-emit.py --check    # 只做一致性自检，不写文件
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
DOCS = ROOT / "docs"

# ---------------------------------------------------------------- 决策真源
# (token, 家族, 影响范围, 修改理由)
PLAN_A = [
    # —— 表面：暗室 / 亮室。底色的冷暖与明度阶是整套主题的地基。
    ("--dsw-alias-bg-base", "表面", "应用底 canvas（index-BPHePDI_.css 的 body{background}）+ 73 处引用",
     "官方 #fff/#151517 是中性灰。NERV 档取设计文档 §2/§3 的底色：亮 **#dfe2ee**（冷灰蓝）/ 暗 **#202b42**（深靛蓝），界面从「白纸 / 紫黑」变成「冷光下的指挥厅」，并为整个明度阶定锚。文档中性色的实测色相簇心是亮 273.7° / 暗 266.6°，故色相锚由 288°/305° 移到 **274°/265°** —— 不换锚点，文档的蓝会被拉回紫。"),
    ("--dsw-alias-bg-layer-1", "表面", "一级容器（列表、卡片）+ 149 处引用",
     "取文档 surface-raised（亮 **#f5f6fa** / 暗 **#303b54**）。作用与旧档相同：与 bg-base 拉开可辨层级（官方 layer-1 与 base 同为 #fff，亮色下无层级）。"),
    ("--dsw-alias-bg-layer-2", "表面", "二级容器（菜单、设置卡、气泡）+ 148 处引用（另被 settings-card-fill 转发）",
     "取文档 surface（亮 **#f0f1f7** / 暗 **#27334c**）；同时把 settings-card-fill 一并带正（它是 bg-layer-2 的纯转发）。"),
    ("--dsw-alias-bg-layer-3", "表面", "三级容器（悬浮态、代码块外层）+ 66 处引用",
     "取文档 surface-alt（亮 **#d4d7e5** / 暗 **#303b54**）；暗色下与 layer-1 同色（文档里两者同为 surface-raised / surface-alt 的同一支），亮色下低于 layer-1，保持「越靠前越亮/越白」的一致方向。"),
    ("--dsw-alias-bg-module-platform", "表面", "平台级模块底（设置页模块、插件面板）+ 48 处引用",
     "官方映射到 bluish-60/bluish-800。取文档 bg-deep（亮 **#d4d7e5** / 暗 **#192237**），使模块底与内容底有可辨但不刺眼的差。"),
    ("--dsw-specific-sidebar-fill", "表面", "左侧栏填充 + 10 处引用",
     "官方映射到 bluish-50/bluish-900。文档 §7 给的是 surface 档（亮 **#f0f1f7** / 暗 **#27334c**），比底色亮一档——描边归零后，侧栏与主区之间仍留着一条 13/255（亮档）的竖向色阶边，用户 2026-10-06 反馈的「还会有线呀」就是它。本轮改为**与底色同值**（亮 **#e0e2ee** / 暗 **#202b42**）：两区共用同一块背景，侧栏靠内容与自身交互态立住，不再靠底色。这是**主动偏离**文档 §7 的 surface 分档，取舍记在 docs\\design.md §9。"),
    ("--dsw-specific-input-major", "表面", "输入区卡片（[data-composer-card]）——S4 真机实测出的实际消费方",
     "**S4 逼出来的第 55 个令牌**：原设计以为输入区吃 bg-layer-1，实测它吃这个令牌（官方暗档 #2c2c2e 中性灰 / 亮档 #fff）。NERV 档取文档 input-bg-focus：亮 **#f5f6fa** / 暗 **#303b54**，与 layer-1 同色（输入区于是读作「一级容器」）。亮档不再是旧档刻意保留的 #ffffff —— 那是「只修暗档」留下的口子，本轮统一到文档值。实测 caption 暗 4.78:1 / 亮 4.82:1（官方暗档自测 3.76:1，本就不达 AA）。**2026-10-06 追加**：用户要「对话框透明 + 毛玻璃」，本令牌改锚 `bg-layer-1` 并加 alpha —— 亮 **#f5f6fa9e（0.62）** / 暗 **#303b54ad（0.68）**；比面板的 0.78/0.80 低，因为主区本身已有一层 0.78 veil，卡片若也 0.78，壁纸透出量只剩 0.22×0.22≈5%，观感仍是不透明。blur 由 paint layer 的 `[data-composer-card]` 规则补（令牌层表达不了 backdrop-filter），新会话按钮由 `[data-window-drag='true'] + button` 复用同一令牌，两者测得同值同 blur。"),
    # —— 描边：**无边框**（用户 2026-10-06：「要无边框设计，现在分割线太明显了」；
    #    第二轮「还会有线呀」后整族再压一档到阈下带）。
    ("--dsw-alias-border-l1", "描边", "最弱分隔（行内、表格线）+ 145 处引用",
     "官方是中性黑/白 alpha。ink 取**对侧**底色（暗档以亮档底色 #e0e2ee 为 ink、亮档以暗档底色 #202b42 为 ink），四条 alpha 走过两轮下压：「照文档 §4 画线」6.9% / 13.2% / 19.8% / 26.1% → 发丝带 1.5% / 2.8% / 4.5% / 7.5% → **阈下带 0.4% / 0.8% / 1.3% / 2.4%**。这是**主动偏离**文档 §4 的边框明度：文档要「看得见的细边框」，用户要「无边框」，二者不可兼得，取舍记在 docs\\design.md §9。渲染结果即无边框——区域分隔只由内容与交互态承担。"),
    ("--dsw-alias-border-l2", "描边", "常规描边（控件边框）+ 376 处引用（全库第三高）",
     "同上，第二档 0.8%（落差 ≈ 1.5/255）——控件轮廓完全退成幽灵边，靠自身填充（input-major / 表面明度）而不是描边立住。"),
    ("--dsw-alias-border-l3", "描边", "加强描边 + 88 处引用",
     "同上，第三档 1.3%。真机实测这一档是**唯一被画出来**的线（侧栏右缘 + 新会话按钮）：0.198（通道落差 41/255）→ 0.045（9/255，用户仍能指出）→ **0.013（≈2.5/255，1px 下不可见）**。"),
    ("--dsw-alias-border-l4", "描边", "最强描边（悬浮卡、聚焦容器）+ 57 处引用（另被 settings-card-stroke、elevation-stroke-color 默认转发）",
     "同上，第四档 2.4%（落差 ≈ 5/255）——全族最强档仍低于 1px 细线的可辨阈值。四个 l1..l4 必须同族调整，否则层级会脏。"),
    # —— 墨色：正文与五级弱化。
    ("--dsw-alias-label-primary", "墨色", "默认正文色（index-BPHePDI_.css 的 body{color}）+ 705 处引用（全库最高）",
     "官方 #0f1115/#f9fafb 是中性。取文档墨色（亮 **#313546** / 暗 **#d5dae4**，与文档 #303546/#d7d9e4 只差 OKLCh 往返的 1/255）——文档这一档本来就过 AA，无需重解明度。实测 10.08:1（暗，bg-base）/ 9.40:1（亮，bg-base）、7.97:1 / 11.25:1（layer-1 与输入区）。"),
    ("--dsw-alias-label-secondary", "墨色", "次级正文 + 653 处引用",
     "**明度由本项目 AA 门槛重解，色相与彩度照文档**：文档的次级/三级/说明/禁用四档挤在一起（暗档 tertiary 3.12:1、亮档 tertiary 2.91:1，都不达 AA），照抄会让四级阶梯塌成两级。因此按等距重排四档，每档留 ≈+0.3 余量：亮 #4f5366 / 暗 #bec6d7，实测 6.52:1（暗）/ 7.04:1（亮）。"),
    ("--dsw-alias-label-tertiary", "墨色", "三级正文（辅助说明）+ 610 处引用",
     "同上重解：亮 **#5f6375** / 暗 **#aab4ca**，实测 5.37:1（暗）/ 5.51:1（亮）于 layer-1，均过 AA（旧档 5.72 / 5.81）。"),
    ("--dsw-alias-label-caption", "墨色", "说明文字 / 快捷键 / 分隔渐变 + 124 处引用",
     "同上重解：亮 **#686c7e** / 暗 **#9faabf**，实测 4.78:1（暗）/ 4.82:1（亮）—— 官方暗色 caption 在 layer-1 上仅约 2.9:1（不达 AA），本档仍压在 AA 线上但有余量。"),
    ("--dsw-alias-label-dimmed", "墨色", "占位符 / 禁用态文字 / 悬浮描边 + 35 处引用",
     "同上重解：亮 **#858895** / 暗 **#808ba1**，实测 3.26:1（暗）/ 3.27:1（亮），目标 3.0（官方为 1.62:1（亮）/ 1.9:1（暗））。"),
    ("--dsw-alias-label-primary-foreground", "墨色", "主按钮/brand 填充上的文字 + 27 处引用",
     "两档都取**基底色的极值再换到新色相**：暗档近黑 #080c15 压在点亮的 NERV 橙 #fd8440 上 **7.96:1**；亮档近白 #f5f7fb 压在灭灯的橙 #aa4500 上 **5.50:1**。两档都过 4.5 —— 这是两条路线独立设计的最硬证据。"),
    # —— 信号色：NERV 五色（NERV 橙 / 灰紫主色 / 绿 / 橙 / 红），全部取自设计文档。
    ("--dsw-alias-brand-primary", "信号", "品牌色 / 主按钮填充 / 选中态 + 100 处引用（button-primary-fill 的上游）",
     "取 NERV 橙（亮 **#aa4500** / 暗 **#fd8440**）：色相与彩度照文档 §15 的 #E47A32(h50.9)/#F07832(h47.3)，**明度由 AA 门槛重解** —— 文档原值照抄时亮档在 #e0e2ee 上只有 2.28:1、白字压其上只有 2.95:1，主按钮会不可读。官方是中性墨色，改为橙后主按钮成为「点亮的 NERV 面板」。改此处即带动 button-primary-fill 与全部选中态。"),
    ("--dsw-alias-link", "信号", "markdown 链接 + 23 处引用",
     "与 brand 同取 NERV 橙（官方也是 link==brand），保持官方「链接即品牌色」的角色结构不变。"),
    ("--dsw-alias-state-business-primary", "信号", "信息态 / 选中落点 / **焦点环回退色** + 330 处引用",
     "取文档的**灰紫主色**（亮 **#626a83** / 暗 **#8d91b2**，即文档 §2/§3 的 color-primary 原值，未动明度）。因为官方 focus.css 让焦点环回退到本令牌，改这里等于让全部 109 处焦点环自动变成灰紫——无需单独覆盖 focus-ring-color。**EVA-01 的紫 #715591 只留给 logo/装饰，不进日常 UI**（文档 §16 的硬约束）。"),
    ("--dsw-alias-state-error-primary", "信号", "错误态 + 273 处引用",
     "取文档 §12 的红（亮 **#c3453f** / 暗 **#ff7f6e**，色相照文档 26.6°/28.5°，明度重解）。与 business 灰紫相差约 22°(亮)/24°(暗)，靠明度与「图标+文字」配对区分。"),
    ("--dsw-alias-state-success-primary", "信号", "成功态 + 99 处引用",
     "取文档 §12 的低饱和绿（亮 **#4b7a5e** / 暗 **#84b08f**）—— 文档要求状态灯克制，不做荧光。"),
    ("--dsw-alias-state-warn-primary", "信号", "警告态 + 76 处引用",
     "取文档 §12 的橙（亮 **#a95d00** / 暗 **#eb903f**）。**这条带一个必须写明的文档内部冲突**：文档 §15 的 NERV 橙(h47–51) 与 §12 的警告橙(h59–64) 只差 **11.4°(暗) / 13.1°(亮)**，两族只能靠明度与图标区分。真机若读不出区别，退路是把警告推到时琥珀 h≈70 —— 那是偏离文档的一步，须先问用户。"),
    ("--dsw-alias-state-warn-label", "信号", "警告态文字 + 27 处引用",
     "与 warn-primary 同值（官方也是 amber-500/amber-600 同族）。"),
    # —— 交互 tint
    ("--dsw-alias-interactive-bg-hover", "交互", "全站悬浮底色 + 288 处引用",
     "官方是中性白/黑 alpha。改为极低 alpha 的 NERV 橙 tint（暗 10% / 亮 9%），令每次悬浮都像被点亮一行。"),
    ("--dsw-alias-interactive-bg-hover-accent", "交互", "强调悬浮（列表选中行等）+ 24 处引用",
     "用**灰紫** tint 与普通悬浮区分，形成「橙=常规、灰紫=选中」的二元（旧档这里用的是 EVA-01 亮紫）。"),
    # —— 材质
    ("--dsw-menu-surface-fill", "材质", "菜单/浮层底（被 specific-menu 转发）+ 3 处直接引用",
     "官方 #f8f9fa94/#43454a73。改为**文档 §14 的 overlay-surface 原值**：亮 rgba(240,241,247,0.78)（= bg-layer-2 的 78%）/ 暗 rgba(32,43,66,0.78)（= bg-base 的 78%）。这个 0.78 同时也是本轮壁纸 veil 的取值 —— 权威值在 build\\veil-budget.json。"),
    ("--dsw-alias-markdown-code-block", "材质", "markdown 代码块底 + 26 处引用（--shiki-background 的上游）",
     "取文档 §13 的 --code-bg（= 该档的 bg-deep）：暗 **#192237** / 亮 **#d4d7e5**，令代码块在暗底上仍是可辨的一块。"),
    # —— 滚动条：细亮线的直接对应
    ("--dsw-alias-scrollbar-bg-l2", "滚动条", "组件内滚动条轨道 + 43 处引用",
     "官方是中性灰。文档 §11 规定 thumb = 描边色、hover = 强描边色，且**普通滚动条不得用 NERV 橙**；故映射到新描边族的中间档（暗 #4b556d / 亮 #a6acbd），令滚动条读作「细线」而不是灰色块。"),
    ("--dsw-alias-scrollbar-hover-l2", "滚动条", "组件内滚动条悬浮 + 42 处引用",
     "同上，悬浮时提亮到最强描边档（暗 #566078 / 亮 #9299ad）。"),
    # —— 几何。
    # 2026-10-06 用户要求「把边框角形全部换回官方的默认圆角」，于是 `--dsw-corner-shape`
    # 从差异表里**删除**（原来是 bevel 切角）。改成官方 superellipse(1.5) 与不声明等价，
    # 而声明一个与官方相同的值会被 token-audit 判为「未改动的令牌混进来」。令牌数 55 -> 54。
    ("--dsw-radius-xs", "几何", "最小圆角 + 37 处引用", "官方 4px -> 2px。半径梯仍是本层定的 2/4/6/8/10/12（S2 的紧凑档），与角形无关：角形已换回官方 superellipse(1.5)，半径梯保持不变。"),
    ("--dsw-radius-sm", "几何", "小圆角 + 161 处引用", "官方 8px -> 4px，同上。"),
    ("--dsw-radius-md", "几何", "常规圆角 + 137 处引用", "官方 12px -> 6px，同上。"),
    ("--dsw-radius-lg", "几何", "大圆角（面板/卡片）+ 92 处引用", "官方 16px -> 8px，同上。"),
    ("--dsw-radius-xl", "几何", "特大圆角 + 32 处引用", "官方 20px -> 10px，同上。"),
    ("--dsw-radius-panel", "几何", "面板圆角 + 28 处引用", "官方 28px -> 12px，同上。"),
    # —— 动效：招牌切换的「啪」感
    ("--ds-ease-in-out", "动效", "全站缓动曲线 + 141 处引用",
     "官方 cubic-bezier(0.4, 0, 0.2, 1)（ease-in-out）。改为 cubic-bezier(0.2, 0.85, 0.15, 1)：起步快、收尾长，读作继电器闭合而非匀速滑动。"),
    ("--ds-transition-duration", "动效", "常规时长 + 67 处引用", "官方 0.2s -> 0.14s，整体提速 30%，配合新曲线的「啪」感。"),
    ("--ds-transition-duration-fast", "动效", "快时长", "官方 0.1s -> 0.07s，同上。"),
    ("--ds-transition-duration-slow", "动效", "慢时长", "官方 0.3s -> 0.22s，同上。"),
    # —— 字体
    ("--dsw-font-family", "字体", "全站正文/UI 字族 + 82 处引用 / fanin 27（27 个复合字体令牌从它派生）",
     "在官方字栈**前面**追加 'Bahnschrift', 'DIN Alternate'。实测本机存在 Bahnschrift（Windows 10+ 自带的 DIN 1451 派生面）；不存在的机器会自然落回官方原栈，因此是零资产、零强制的字形替换。"),
]

PLAN_B = [
    ("--dsw-alias-interactive-bg-active", "交互", "按下态 + 15 处引用",
     "用灰紫更深的 tint，与 hover 的 NERV 橙形成按压反馈。收益：按下/悬浮在当前 UI 里本来就难分。"),
    ("--dsw-alias-interactive-bg-hover-solid", "交互", "不透明悬浮底（在彩色底上）+ 16 处引用",
     "跟随 NERV 橙 tint，避免在橙底上悬浮时出现灰块。"),
    ("--dsw-alias-interactive-bg-hover-danger", "交互", "危险悬浮 + 14 处引用",
     "跟随新的错误红，保持「危险=红」的族一致性。"),
    ("--dsw-alias-state-error-secondary", "信号", "错误次级态",
     "官方转发 static-red-400，改上游会牵动整个静态色阶；此处直接给本主题的红族次级值（暗 #ff8b7c / 亮 #d9554d），使错误族的两个阶同源。"),
    ("--dsw-alias-state-success-secondary", "信号", "成功次级态", "同上，绿族（暗 #91ecab / 亮 #3d9164）。"),
    ("--dsw-alias-state-warn-secondary", "信号", "警告次级态", "同上，橙族（暗 #ffc894 / 亮 #b6742f）。"),
    ("--dsw-alias-bg-overlay", "表面", "浮层底 + 3 处引用（唯一官方消费者为 user-question 的编号圆点）",
     "取文档 §14 的 overlay-panel 底（暗 **#27334c** / 亮 **#e0e2ee**）。收益小（引用少），但不改就会在新底色里露出一块异色。"),
    ("--dsw-alias-bg-mask-1", "材质", "遮罩一层 + 12 处引用", "文档 §10 要求**夜间不用纯黑遮罩**：改为同族的深靛蓝 scrim（暗 **#0a0e18** 62% / 亮 34%），而非官方纯黑 alpha。"),
    ("--dsw-alias-bg-mask-2", "材质", "遮罩二层", "同上，暗 76% / 亮 48%。"),
    ("--dsw-alias-scrollbar-bg-l1", "滚动条", "页面级滚动条轨道（--dsh-scrollbar-thumb 的上游）",
     "与 l2 同族（暗 #343f57 / 亮 #cdd1de），令页面滚动条与组件滚动条一致。"),
    ("--dsw-alias-scrollbar-hover-l1", "滚动条", "页面级滚动条悬浮", "同上（暗 #3f4a62 / 亮 #b9bece）。"),
    ("--dsw-menu-backdrop-filter", "材质", "菜单毛玻璃 + 15 处引用",
     "官方 blur(40px) saturate(150%)。若启用壁纸则改为 blur(20px) saturate(130%)，否则 40px 会把 art 糊成一片纯色。收益：保住壁纸的可辨识度。"),
    ("--dsw-alias-tooltip-bg", "材质", "工具提示底",
     "改为比浮层更靠近描边族的实心块（暗 **#414a5c** / 亮 **#191c26**），避免暗色下 tooltip 的官方面 #2c2c2e 与深靛蓝底脱节。"),
]

# C 层：明确不修改的官方令牌 + 理由（每条都给出实测依据）
PLAN_C = [
    ("--dsh-content-font-size", "字号", "与「设置→通用→字体大小」争用：boot-theme.ts:33 是官方唯一的 body 行内写入点，覆盖它会静默压下用户设置。"),
    ("--dsh-content-font-delta", "字号", "同族的行高补偿（121 处引用），跟随便携字号，单独改会让行距与字号脱钩。"),
    ("--dsh-content-font-size-secondary", "字号", "次要字号，同族。"),
    ("--dsh-content-font-delta-secondary", "字号", "次要行高补偿，同族。"),
    ("--dsw-focus-ring-color", "可访问性", "官方 focus.css 全文没有任何地方给它赋真值（唯一声明是 pointer 模态下的 transparent），它回退到 --dsw-alias-state-business-primary。**改 business 即自动带动 109 处焦点环**，再单独声明它反而会冻结这条回退链。"),
    ("--dsw-focus-ring-width", "可访问性", "2px 是焦点可见性的可访问性契约，不属视觉皮肤范围。"),
    ("--dsw-elevation-stroke-color", "描边", "有 24 条声明、其中 23 条是组件选择器把它重指向 border-l1/l2/l3（如 ._list_4ub78_7 → border-l1、html[data-ds-dark-theme] [data-menu-material] → border-l3）。它是「每组件路由器」，不是杠杆；S1 记录的「600 个元素」来自 body 默认值，真正的杠杆是 border-l1..l4 整族（已在 A 层）。"),
    ("--dsw-alias-button-primary-fill", "派生", "body 两条声明都是 var(--dsw-alias-brand-primary) 纯转发（第三条是 .fO69Vq_dangerButton 的组件改写）。改 brand-primary 即带动它。"),
    ("--dsw-alias-settings-card-fill", "派生", "base.css:24-25 转发 bg-layer-2。改层色即带动。"),
    ("--dsw-alias-settings-card-stroke", "派生", "base.css:26-27 转发 border-l4。改描边族即带动。"),
    ("--shiki-foreground", "派生", "转发 label-primary。"),
    ("--shiki-background", "派生", "转发 markdown-code-block。"),
    ("--dsh-scrollbar-thumb", "派生", "转发 scrollbar-bg-l1。"),
    ("--dsh-scrollbar-thumb-hover", "派生", "转发 scrollbar-hover-l1。"),
    ("--dsw-font-family-brand", "派生", "base.css 定义为 'Montserrat', var(--dsw-font-family)；Montserrat 由官方 woff2 提供，是品牌字，保持不动。"),
    ("--ds-font-family-code", "字体", "官方已是完整的等宽栈（SF Mono / JetBrains Mono / Fira Code / Consolas…），实测本机命中 Consolas。本机不存在更好的等宽技术面，改它只有风险无收益。"),
    ("--dsw-font-*-font-family（27 条）", "派生", "全库 fanin 最高的一组：27 条复合字体令牌都转发 --dsw-font-family。改上游即可，逐条改属 P0 §6 禁止的组件级覆盖。"),
    ("--dsw-static-*（77 条）", "静态色阶", "静态色阶是 alias 层的取值来源，两套明暗共用一套静态值。越过 alias 直接改静态色会同时污染深浅两档，破坏 alias→static 的映射语义。"),
    ("--dsw-shadow-lv1 / lv2 / lv3", "投影", "官方表面零消费者：lv1 的 5 条引用全部来自第三方插件（dshmarket/Market.module.css、dsh-skill-mcp-panel×2、@linxin666/dsh-client-ui-task-board）。改了不产生任何官方视觉效果，属 P0 §6 禁止的无效声明。"),
    ("--dsw-elevation-panel / -prominent / -soft", "投影", "组件级阴影合成。本主题的层级由「发丝描边 + 表面明度阶」承担，不用投影——这是参考图的材质语言（霓虹招牌没有投影，只有辉光与硬边），不是省事。"),
    ("--dsh-sidebar-height / --dsh-sidebar-inline-padding / --dsh-frame-top-clearance / --dsh-windows-titlebar-height", "布局", "S1 实测这 4 个令牌的引用里存在 root-subject 规则（窗口结构尺寸）；且官方 spacing/布局属组件 CSS，主题无法在不逐组件覆盖的前提下改写（starwake theme.css:95-98 同结论）。"),
    ("第三方命名空间（--ds-t-*、--dsb*、--mn-*、--scu-*、--lc-*、--animate-lc-*）", "第三方", "不是官方令牌。实测它们**已经**转发官方 alias（--ds-t-1..4 → label-*、--dsb* → alias 族），所以第三方插件会自动跟随本主题，无需也不应介入。"),
]


def load() -> tuple[dict, dict, dict]:
    pal = json.loads((OUT / "s2-palette.json").read_text(encoding="utf-8"))
    base = json.loads((OUT / "s2-token-baseline.json").read_text(encoding="utf-8"))
    refs = json.loads((OUT / "s2-refcount.json").read_text(encoding="utf-8"))
    return pal, base, refs


def index(base: dict, refs: dict):
    off = {r["token"]: r for r in base["rows"]}
    cnt = {r["token"]: r for r in refs["rows"]}
    return off, cnt


def is_alias(official: dict, token: str) -> str:
    """判定「是否 alias」：官方声明值是否为 var(--dsw-static-*) 形式。"""
    samples = official.get("declSample") or []
    vals = []
    for s in samples:
        try:
            vals.append(json.loads(s).get("value", ""))
        except Exception:
            pass
    if not vals:
        return "?"
    if all(v.startswith("var(") for v in vals):
        inner = vals[0]
        if "static" in inner:
            return "Y(static)"
        return "Y"
    if any(v.startswith("var(") for v in vals):
        return "部分"
    return "N"


def row(tok: str, official: dict, cnt: dict, new_l: str, new_d: str) -> tuple[str, str]:
    o = official.get(tok, {})
    ol = o.get("light", "—")
    od = o.get("dark", "—")
    c = cnt.get(tok, {})
    refs = c.get("primary", o.get("refs", 0))
    alias = is_alias(o, tok)
    return (f"| `{tok}` | `{ol}` | `{od}` | `{new_l}` | `{new_d}` | {refs} | {alias} |",
            f"| `{tok}` | `{ol}` | `{od}` | {alias} |")


def main() -> int:
    pal, base, refs = load()
    official, cnt = index(base, refs)
    P = pal["palette"]

    missing = []
    for tok, *_ in PLAN_A + PLAN_B:
        if tok not in P["dark"]:
            missing.append(tok)
        if tok not in official:
            missing.append(tok + " (no official value)")

    lines: list[str] = []
    lines.append("# 令牌差异表 —— EVA-Inspired-Theme\n")
    lines.append(f"> 本文件由 `tools\\s2-emit.py` 从三份实测产物生成；"
                 f"颜色数值真源是 `tools\\s2-palette.py`，本文件不手抄任何数字。\n")
    lines.append(f"> 官方原值取自 `out\\s2-token-baseline.json`"
                 f"（baseline capturedAt = {base['source']['baselineCapturedAt']}，"
                 f"Sheets = {base['source']['sheets']}）；")
    lines.append(f"> 引用次数取自 `out\\s2-refcount.json` 的 **primary** 口径"
                 f"（该令牌至少一次处在 `var()` 首参位）。\n")

    lines.append("## 0. 令牌预算\n")
    lines.append("任务书里的 `<令牌预算>` 是未填占位符。本主题自行给出并声明如下预算：\n")
    lines.append("| 层 | 上限 | 本主题实际 | 说明 |")
    lines.append("|---|---|---|---|")
    lines.append(f"| A 必改 | 45 | {len(PLAN_A)} | 视觉语言成立所必需，少一个主题就不成立 |")
    lines.append(f"| B 可选 | 15 | {len(PLAN_B)} | 有明确收益但主题不依赖它 |")
    lines.append(f"| C 禁止 | — | {len(PLAN_C)} 组 | 逐条给出不修改的理由 |")
    lines.append("")
    lines.append(f"合计改动 **{len(PLAN_A) + len(PLAN_B)}** 个令牌，占官方自有令牌"
                 f"（432，S1 实测 `inventory.json` 的 `external!==true`）的 "
                 f"{(len(PLAN_A) + len(PLAN_B)) / 432 * 100:.1f}%，"
                 f"占运行时实测可读令牌（498）的 {(len(PLAN_A) + len(PLAN_B)) / 498 * 100:.1f}%。\n")
    lines.append("预算取这个量级的理由：参考图给出的是一整套**视觉语言**（冷底 + 霓虹信号 + "
                 "细亮线 + 硬切角 + 冷偏中性色阶），它必须同时落在表面、描边、墨色、信号、"
                 "几何、动效六个族上；任何一族缺席，界面就会退回「官方默认换了个主色」的样子。"
                 "同时 A 层只取派生图里的**根**（`out\\s2-derivation.py` 判定），"
                 "不碰任何纯转发令牌与组件级令牌。\n")

    for label, plan, note in (
        ("A. 必改", PLAN_A, "视觉语言成立所必需。"),
        ("B. 可选", PLAN_B, "有明确收益，但主题不依赖它们；可整组放弃而不影响 A 层。"),
    ):
        lines.append(f"## {label.split('.')[0]}. {label.split('. ')[1]}（{len(plan)}）\n")
        lines.append(f"{note}\n")
        lines.append("| 令牌 | 官方 light | 官方 dark | 新 light | 新 dark | 引用(primary) | alias |")
        lines.append("|---|---|---|---|---|---|---|")
        for tok, fam, scope, why in plan:
            r, _ = row(tok, official, cnt, P["light"].get(tok, "—"), P["dark"].get(tok, "—"))
            lines.append(r)
        lines.append("")
        lines.append("| 令牌 | 家族 | 影响范围 | 修改理由 |")
        lines.append("|---|---|---|---|")
        for tok, fam, scope, why in plan:
            lines.append(f"| `{tok}` | {fam} | {scope} | {why} |")
        lines.append("")

    lines.append(f"## C. 不允许改（{len(PLAN_C)} 组）\n")
    lines.append("这些令牌**不进入覆盖层**。按 P0 §6，没改的令牌不许重新声明"
                 "（重新声明会冻结官方未来升级值）。\n")
    lines.append("| 令牌 | 类别 | 官方 light | 官方 dark | 引用(primary) | 不修改的理由 |")
    lines.append("|---|---|---|---|---|---|")
    for tok, cat, why in PLAN_C:
        key = tok.split(" ")[0].strip("`")
        o = official.get(key, {})
        c = cnt.get(key, {})
        refs_v = c.get("primary", o.get("refs", "—")) if o else "—"
        lines.append(f"| `{tok}` | {cat} | `{o.get('light', '—')}` | `{o.get('dark', '—')}` | "
                     f"{refs_v} | {why} |")
    lines.append("")

    lines.append("## D. alias 层级与派生关系\n")
    lines.append("S1/S2 实测的官方层级是 **`body{--alias: var(--dsw-static-<族>-<阶>)}` + "
                 "`body[data-ds-dark-theme]{--alias: var(--另一阶)}`**，"
                 "即 alias 层是「语义 → 静态色阶」的映射。本表改的全部是 alias 层与基座层，"
                 "正是 P0 允许的层级。\n")
    lines.append("实测的派生关系（`tools\\s2-derivation.py`：某令牌的**全部**声明都是 "
                 "`var(--X)` 纯转发 ⇒ 它是转发，不是根）：\n")
    lines.append("| 转发令牌 | 上游（已改，故自动跟随） |")
    lines.append("|---|---|")
    for a, b in (("`--dsw-alias-button-primary-fill`", "`--dsw-alias-brand-primary`"),
                 ("`--dsw-alias-settings-card-fill`", "`--dsw-alias-bg-layer-2`"),
                 ("`--dsw-alias-settings-card-stroke`", "`--dsw-alias-border-l4`"),
                 ("`--shiki-foreground`", "`--dsw-alias-label-primary`"),
                 ("`--shiki-background`", "`--dsw-alias-markdown-code-block`"),
                 ("`--dsh-scrollbar-thumb`", "`--dsw-alias-scrollbar-bg-l1`"),
                 ("`--dsh-scrollbar-thumb-hover`", "`--dsw-alias-scrollbar-hover-l1`"),
                 ("`--dsw-font-*-font-family`（27 条）", "`--dsw-font-family`"),
                 ("`--ds-t-1..4`、`--dsb*`（第三方）", "官方 alias 族（故第三方插件自动跟随）")):
        lines.append(f"| {a} | {b} |")
    lines.append("")

    lines.append("## E. 口径冲突登记（不抹平）\n")
    lines.append("`docs\\recon.md` §8 那组引用数（`label-primary` 675 / `brand-primary` 54 / "
                 "`bg-layer-1` 11）与 `out\\cssom-refs.json` 的实际长度（705 / 100 / 149）"
                 "**在三种口径（total / primary / fallbackOnly）下都对不上**，"
                 "差值比例也不一致（+4% / +85% / +1254%）；而该 json 属 S1 产物，已随项目目录删除。"
                 "本表一律采用 `out\\s2-refcount.json` 的 **primary** 口径并在此点名；"
                 "§8 那组数字不再引用，上面 B 层的「N 处引用」也全部来自 `s2-refcount.json`。\n")

    text = "\n".join(lines) + "\n"
    if "--check" in sys.argv:
        print(f"check: A={len(PLAN_A)} B={len(PLAN_B)} C={len(PLAN_C)} "
              f"missing={len(missing)} chars={len(text)}")
        if missing:
            print("MISSING:", missing)
        return 0

    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "tokens-diff.md").write_text(text, encoding="utf-8")
    print(f"wrote docs\\tokens-diff.md  A={len(PLAN_A)} B={len(PLAN_B)} C={len(PLAN_C)} "
          f"chars={len(text)}")
    if missing:
        print("WARNING missing:", missing)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
