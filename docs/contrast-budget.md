# 对比度预算 —— EVA-Inspired-Theme

> 由 `tools\s2-budget.py` 生成；颜色真源是 `tools\s2-palette.py`，官方原值来自 `out\s2-token-baseline.json`（capturedAt 2026-10-06T02:48:26.190724+08:00）。

## 0. 方法与口径

- **标准**：WCAG 2.1 相对亮度对比度 `(L1+0.05)/(L2+0.05)`，`L = 0.2126R' + 0.7152G' + 0.0722B'`，通道先做 sRGB→线性化。

- **半透明合成**：`comp = fill*a + art*(1-a)`，**在 encoded sRGB 空间逐通道线性插值**（浏览器 `background-color` 叠加的默认行为，不做线性化、不做预乘）。这与 P0 §9 的 `art*(1-a) + fill*a` 是同一式子。

- **本条预算的局限（必须说清）**：以上是**计算值**。真实像素还会经历「面板底 → 半透明表面 → 内容」多层叠加、`backdrop-filter`、以及 GPU 的色彩管理。**S4 必须用浏览器实际合成色重新验证**——做法是对每个 `(前景, 背景)` 对渲染出真实元素、读 `getComputedStyle` 得到的实际 `color` / 最终可见背景色再算一次，而不是复用本文件的数字。

- 本文件只覆盖**不透明前景压在不透明/半透明底上**这一种最常见情形；渐变、图片、`color-mix()` 的结果不在本预算内，S4 一并覆盖。

## 1. 目标与依据

| 前景 | 目标 | 依据 |
|---|---|---|
| `label-primary` | 4.5:1 | 正文 ink，AA |
| `label-secondary` | 4.5:1 | 次级正文，AA |
| `label-tertiary` | 4.5:1 | 三级正文，AA |
| `label-caption` | 4.5:1 | 说明文字，AA |
| `label-dimmed` | 3.0:1 | 弱化/占位，AA-large |
| `brand-primary` | 4.5:1 | 强调色正文（链接/品牌） |
| `link` | 4.5:1 | 链接正文 |
| `state-error-primary` | 4.5:1 | 状态正文 |
| `state-success-primary` | 4.5:1 | 状态正文 |
| `state-warn-primary` | 3.0:1 | 状态色（多与图标并用） |
| `state-warn-label` | 4.5:1 | 状态文字 |
| `label-primary-foreground` | 4.5:1 | 主按钮上的文字 |

## 2. 完整对比度矩阵（本主题值）

| 模式 | 前景 | 背景 | 对比度 | 目标 | 结果 | 偏差 | 官方同对（对照） |
|---|---|---|---|---|---|---|---|
| dark | `--dsw-alias-label-primary` | `--dsw-alias-bg-base` | **12.83** | 4.5 | OK | +8.33 | 17.45 |
| dark | `--dsw-alias-label-primary` | `--dsw-alias-bg-layer-1` | **10.85** | 4.5 | OK | +6.35 | 15.03 |
| dark | `--dsw-alias-label-primary` | `--dsw-alias-bg-layer-2` | **11.80** | 4.5 | OK | +7.30 | 13.34 |
| dark | `--dsw-alias-label-primary` | `--dsw-alias-bg-layer-3` | **10.85** | 4.5 | OK | +6.35 | 11.57 |
| dark | `--dsw-alias-label-secondary` | `--dsw-alias-bg-layer-1` | **8.81** | 4.5 | OK | +4.31 | 10.42 |
| dark | `--dsw-alias-label-tertiary` | `--dsw-alias-bg-layer-1` | **7.30** | 4.5 | OK | +2.80 | 7.36 |
| dark | `--dsw-alias-label-caption` | `--dsw-alias-bg-layer-1` | **6.44** | 4.5 | OK | +1.94 | 4.24 ✗不达 |
| dark | `--dsw-alias-label-dimmed` | `--dsw-alias-bg-layer-1` | **4.40** | 3.0 | OK | +1.40 | 1.64 ✗不达 |
| dark | `--dsw-alias-brand-primary` | `--dsw-alias-bg-base` | **8.73** | 4.5 | OK | +4.23 | 17.45 |
| dark | `--dsw-alias-brand-primary` | `--dsw-alias-bg-layer-1` | **7.39** | 4.5 | OK | +2.89 | 15.03 |
| dark | `--dsw-alias-link` | `--dsw-alias-bg-layer-1` | **7.39** | 4.5 | OK | +2.89 | 6.75 |
| dark | `--dsw-alias-state-error-primary` | `--dsw-alias-bg-layer-1` | **5.05** | 4.5 | OK | +0.55 | 4.77 |
| dark | `--dsw-alias-state-success-primary` | `--dsw-alias-bg-layer-1` | **5.12** | 4.5 | OK | +0.62 | 6.89 |
| dark | `--dsw-alias-state-warn-primary` | `--dsw-alias-bg-layer-1` | **8.07** | 3.0 | OK | +5.07 | 7.31 |
| dark | `--dsw-alias-state-warn-label` | `--dsw-alias-bg-layer-1` | **8.07** | 4.5 | OK | +3.57 | 5.62 |
| dark | `--dsw-alias-label-primary-foreground` | `--dsw-alias-brand-primary` | **9.50** | 4.5 | OK | +5.00 | 18.08 |
| dark | `--dsw-alias-label-primary` | `--dsw-specific-input-major` | **10.85** | 4.5 | OK | +6.35 | 13.34 |
| dark | `--dsw-alias-label-secondary` | `--dsw-specific-input-major` | **8.81** | 4.5 | OK | +4.31 | 9.25 |
| dark | `--dsw-alias-label-tertiary` | `--dsw-specific-input-major` | **7.30** | 4.5 | OK | +2.80 | 6.53 |
| dark | `--dsw-alias-label-caption` | `--dsw-specific-input-major` | **6.44** | 4.5 | OK | +1.94 | 3.76 ✗不达 |
| light | `--dsw-alias-label-primary` | `--dsw-alias-bg-base` | **9.39** | 4.5 | OK | +4.89 | 18.90 |
| light | `--dsw-alias-label-primary` | `--dsw-alias-bg-layer-1` | **11.27** | 4.5 | OK | +6.77 | 18.90 |
| light | `--dsw-alias-label-primary` | `--dsw-alias-bg-layer-2` | **10.80** | 4.5 | OK | +6.30 | 18.90 |
| light | `--dsw-alias-label-primary` | `--dsw-alias-bg-layer-3` | **8.46** | 4.5 | OK | +3.96 | 18.90 |
| light | `--dsw-alias-label-secondary` | `--dsw-alias-bg-layer-1` | **7.05** | 4.5 | OK | +2.55 | 5.80 |
| light | `--dsw-alias-label-tertiary` | `--dsw-alias-bg-layer-1` | **5.52** | 4.5 | OK | +1.02 | 3.71 ✗不达 |
| light | `--dsw-alias-label-caption` | `--dsw-alias-bg-layer-1` | **4.83** | 4.5 | OK | +0.33 | 2.13 ✗不达 |
| light | `--dsw-alias-label-dimmed` | `--dsw-alias-bg-layer-1` | **3.28** | 3.0 | OK | +0.28 | 1.26 ✗不达 |
| light | `--dsw-alias-brand-primary` | `--dsw-alias-bg-base` | **4.88** | 4.5 | OK | +0.38 | 18.90 |
| light | `--dsw-alias-brand-primary` | `--dsw-alias-bg-layer-1` | **5.86** | 4.5 | OK | +1.36 | 18.90 |
| light | `--dsw-alias-link` | `--dsw-alias-bg-layer-1` | **5.86** | 4.5 | OK | +1.36 | 4.23 ✗不达 |
| light | `--dsw-alias-state-error-primary` | `--dsw-alias-bg-layer-1` | **5.82** | 4.5 | OK | +1.32 | 4.50 |
| light | `--dsw-alias-state-success-primary` | `--dsw-alias-bg-layer-1` | **5.87** | 4.5 | OK | +1.37 | 2.28 ✗不达 |
| light | `--dsw-alias-state-warn-primary` | `--dsw-alias-bg-layer-1` | **5.84** | 3.0 | OK | +2.84 | 2.15 ✗不达 |
| light | `--dsw-alias-state-warn-label` | `--dsw-alias-bg-layer-1` | **5.84** | 4.5 | OK | +1.34 | 2.79 ✗不达 |
| light | `--dsw-alias-label-primary-foreground` | `--dsw-alias-brand-primary` | **5.86** | 4.5 | OK | +1.36 | 18.90 |
| light | `--dsw-alias-label-primary` | `--dsw-specific-input-major` | **11.27** | 4.5 | OK | +6.77 | 18.90 |
| light | `--dsw-alias-label-secondary` | `--dsw-specific-input-major` | **7.05** | 4.5 | OK | +2.55 | 5.80 |
| light | `--dsw-alias-label-tertiary` | `--dsw-specific-input-major` | **5.52** | 4.5 | OK | +1.02 | 3.71 ✗不达 |
| light | `--dsw-alias-label-caption` | `--dsw-specific-input-major` | **4.83** | 4.5 | OK | +0.33 | 2.13 ✗不达 |

**共 40 对，未达标 0 对。**

### 2.1 官方在这些对上本来就不达 AA（本主题逐个补上）

| 模式 | 前景 | 背景 | 官方对比度 | 官方是否达 AA | 本主题 |
|---|---|---|---|---|---|
| dark | `--dsw-alias-label-caption` | `--dsw-alias-bg-layer-1` | 4.24 | ✗ 不达（AA 4.5:1） | 6.44 |
| dark | `--dsw-alias-label-dimmed` | `--dsw-alias-bg-layer-1` | 1.64 | ✗ 不达（AA 3.0:1） | 4.40 |
| dark | `--dsw-alias-label-caption` | `--dsw-specific-input-major` | 3.76 | ✗ 不达（AA 4.5:1） | 6.44 |
| light | `--dsw-alias-label-tertiary` | `--dsw-alias-bg-layer-1` | 3.71 | ✗ 不达（AA 4.5:1） | 5.52 |
| light | `--dsw-alias-label-caption` | `--dsw-alias-bg-layer-1` | 2.13 | ✗ 不达（AA 4.5:1） | 4.83 |
| light | `--dsw-alias-label-dimmed` | `--dsw-alias-bg-layer-1` | 1.26 | ✗ 不达（AA 3.0:1） | 3.28 |
| light | `--dsw-alias-link` | `--dsw-alias-bg-layer-1` | 4.23 | ✗ 不达（AA 4.5:1） | 5.86 |
| light | `--dsw-alias-state-success-primary` | `--dsw-alias-bg-layer-1` | 2.28 | ✗ 不达（AA 4.5:1） | 5.87 |
| light | `--dsw-alias-state-warn-primary` | `--dsw-alias-bg-layer-1` | 2.15 | ✗ 不达（AA 3.0:1） | 5.84 |
| light | `--dsw-alias-state-warn-label` | `--dsw-alias-bg-layer-1` | 2.79 | ✗ 不达（AA 4.5:1） | 5.84 |
| light | `--dsw-alias-label-tertiary` | `--dsw-specific-input-major` | 3.71 | ✗ 不达（AA 4.5:1） | 5.52 |
| light | `--dsw-alias-label-caption` | `--dsw-specific-input-major` | 2.13 | ✗ 不达（AA 4.5:1） | 4.83 |

这不是「为了好看牺牲可读性」的反面，而是：**官方默认主题本身有若干处不达 AA**，本主题在这些位置选择满足目标，并把偏差写进上表。

## 3. 壁纸预算：半透明 veil 覆盖 art 时的可读性边界

求解方法：固定 ink 与 veil（颜色 + alpha），二分求出**满足目标对比度的合成色边界**，再按 `art = (comp - fill*a)/(1-a)` 反解 art 的单通道边界。方向由 ink 与 veil 的明暗关系决定：

- **亮 ink + 暗 veil ⇒ 合成色有上限**（art 越亮越危险）——这是暗色模式的情形。

- **暗 ink + 亮 veil ⇒ 合成色有下限**（art 越暗越危险）——这是亮色模式的情形。

- 这两种方向合起来就是 P0 §9「白色 veil 只能压暗、不能提亮」的定量形式。

| 模式 | veil | alpha | fill | ink | 方向 | 合成色边界 | 边界亮度 | art 单通道边界 | 归一 | 含义 |
|---|---|---|---|---|---|---|---|---|---|---|
| dark | `#1a1325c7` | 0.78 | `#1a1325` | `#dbd8e2` | ceiling→4.5:1 | `#5f5f5f` | 0.1144 | 255/255 | 1.000 | 无约束：veil 已厚到 art 无论多亮都不破目标（约束退化为不可达） |
| dark | `#1a1325c7` | 0.78 | `#1a1325` | `#dbd8e2` | ceiling→3.0:1 | `#7b7b7b` | 0.1981 | 255/255 | 1.000 | 无约束：veil 已厚到 art 无论多亮都不破目标（约束退化为不可达） |
| light | `#f1f1f7c7` | 0.78 | `#f1f1f7` | `#353445` | floor→4.5:1 | `#9e9e9e` | 0.3419 | 0/255 | 0.000 | 无约束：veil 已厚到 art 无论多暗都不破目标（约束退化为不可达） |
| light | `#f1f1f7c7` | 0.78 | `#f1f1f7` | `#353445` | floor→3.0:1 | `#7f7f7f` | 0.2122 | 0/255 | 0.000 | 无约束：veil 已厚到 art 无论多暗都不破目标（约束退化为不可达） |

## 4. 留给 S4 的复验清单

本文件是**计算预算**，不是渲染证据。S4 必须用浏览器真实合成色重做以下检查：

1. 对 §2 表中每一对，在真实元素上读 `getComputedStyle` 的实际 `color` 与最终可见背景色（含半透明表面的真实合成），重算对比度并比对本文目标；

2. 覆盖 §2 未含的情形：渐变上的文字、`color-mix()` 结果、`backdrop-filter` 面板上的文字、悬浮/按下/禁用/选中四种交互态；

3. 若启用壁纸：在真实渲染中取壁纸最亮区域，验证正文对比度仍 ≥ 目标；

4. 覆盖文本度量变更（`--dsw-font-family` 前置 Bahnschrift）后的「长中文段落 + 长英文标识符 + 代码块」三种文本，确认无溢出、无异常换行。

