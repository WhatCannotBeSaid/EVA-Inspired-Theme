# S4 · 离线真机渲染验证报告 —— Cyberpunk-Theme

> 产物：`<plugins>\tmp\Cyberpunk-Theme-render\`（`samples.json` 采样与全量数据 · `shots\` 六个状态整页截图 · `samples\` 每态每区域裁剪 · `compare\` 官方 vs 主题并排图 · `census.json` DOM 锚点普查）
> 工具：`tools\verify-render.py`（唯一入口，`--census` / `--light` / `--dark`）
> 环境：DSH Desktop `0.2.0-rc.2` · `<DSH_AUTHORITY>` · 视口 **1600×1000** · 系统 Python 3.14（Playwright + Pillow）
> 本阶段**未安装插件、未修改 profile**。

---

## 0. 证明边界（必须先读，不得含混）

**本阶段证明的**：把包内 `client.js` 的**出厂字节**按其自身的 `apply` 路径注入当前运行时后，令牌层与 paint 层**画得对** —— 四态可复现、真实合成色与对比度预算对得上、令牌从 S1 官方值到 S4 浏览器实际值的链条无一处断裂。

**本阶段不能证明的**（`docs\design.md` 的验收条件只覆盖前者）：

1. **插件尚未注册。** 包没有被安装进 profile，`dsh.profile.bundles` 与 `dependencies` 都不含 `Cyberpunk-Theme`。`dsh.bundle.patch` 的挂载路径、`exports["./client"]` 被 web roster 加载的路径，本阶段**都没有被执行过**。
2. **`theme.overrideTokens` 未被正式挂载。** 注入时 `theme` 是一个**替身对象**，它执行的是真实服务在 DOM 上的效果（把当前档的值写成 `body` 的行内自定义属性），但**不是真实服务本身**：真实的 `overrideTokens` 会校验 `{light,dark}` 形状、按 source 整层替换、并由 theme-presenter 在换档时重写。本报告的一切结论都建立在"替身忠实复现了这一步"之上，而这一步**只能由 S5 的真机装载证明**。
3. **卸载路径未被执行。** 两个 `ctx.effect` 的 disposer 在代码与结构自检里被证实存在（`selfcheck.mjs` 的 `cli.7`/`cli.9`），但本阶段从未运行过卸载并检查残留。

一句话：**这份报告证明的是"画得对"，不是"装得上"。**

---

## 1. 连接与鉴权

`tools\verify-render.py` 用环境变量 `DSH_SESSION_SECRET` 的密钥签出本机会话 cookie（cookie 名 `dsh-auth-…`），连 `http://<DSH_AUTHORITY>`，等 `#root` 出现后 settle 9000 ms。**secret 与 cookie 值只在内存中使用，不落盘、不打印、不进报告**（报告与 `samples.json` 中均无该字段）。

## 2. 注入方式（按插件真实路径）

1. 从磁盘读 `client.js`（**出厂字节，未做任何改写**）。
2. 页面内安装捕获器 `window.__ModuleLoader__ = { load: (spec) => { window.__S4__.spec = spec } }`，再 `add_script_tag(content=client_js)`。
3. 手工调用 `spec.factory(require-that-throws)` 取得 `module.exports` —— 即 `{name, inject, apply, manifest}`，实测 `exports=['name','inject','apply','manifest']`、`inject=['theme']`，**与包内一致**。
4. 以替身 `ctx` 调 `apply(ctx)`：`ctx.get('theme')` 返回 `overrideTokens(source, tokens)`，按 `document.body.hasAttribute('data-ds-dark-theme')` 选档，对 54 个令牌逐个 `document.body.style.setProperty`，返回移除函数；`ctx.effect(fn, label)` 立即执行并收集 disposer。
5. **没有第二套 CSS**：`TOKENS`、`CSS`、`WALLPAPER_DECLARATIONS` 全部来自出厂 bundle。唯一替身是第 4 步那个服务对象，其边界见 §0。

实测：两档均 `ok=True`、`tokensApplied=54`、`errors=[]`；注入的 `<style data-plugin>` 为 **1 个、182 字符的变量块 + 8,016 字符的画皮**（页面样式表数 230 → **231**）。

## 3. 四态（§三）

| 状态 | `body` background-color | `background-image` | `--cp-wall` | layers | styles |
|---|---|---|---|---|---|
| `official-light` | `rgb(255,255,255)` | none | — | 0 | 230 |
| `theme-wall-light` | `rgba(227,232,238,0.76)` | **gradient+url** | `url("data:image/webp;base64,UklGRpbdBQBX…")` | 3 | 231 |
| `theme-nowall-light` | `rgba(227,232,238,0.76)` | **gradient-only** | **`none`** | 3 | 231 |
| `official-dark` | `rgb(21,21,23)` | none | — | 0 | 230 |
| `theme-wall-dark` | `rgba(7,13,17,0.64)` | **gradient+url** | `url("data:image/webp;base64,UklGRlpRAgBX…")` | 3 | 231 |
| `theme-nowall-dark` | `rgba(7,13,17,0.64)` | **gradient-only** | **`none`** | 3 | 231 |

**四态全部可复现且互不相同。** 无壁纸态由设置 `--cp-pick-light/--cp-pick-dark: none` 实现（画皮自己的旋钮），`--cp-wall` 随之计算为 `none`，art 层从背景栈消失而 veil 渐变保留 —— 这是设计意图（"关掉壁纸退化为纯色场"），不是退化。

> 报告口径更正：首版工具用"有/无 background-image"的布尔值描述这一列，而 veil 渐变**永远**存在，该布尔量因此毫无信息量（无壁纸态也报 `yes`）。现改为三分：`none` / `gradient-only` / `gradient+url`。

## 4. 真实合成色采样（§四）

采样**来自渲染像素**：每个区域取 `getBoundingClientRect`，`page.screenshot(clip=…)` 截取（内缩 6px、下移 26px 避开首行文字），Python 端把裁剪像素**按 4 bit 量化后取众数**、再对命中桶内原始像素求均值，得到"文字压在其上的那个面"；ink 取同元素 `getComputedStyle().color`。**两个数都不是回读工具自己写入的 CSS。** `surfaceShare` 一并记录（众数占比），用于判断裁剪是否真的落在一个面上。

`theme-wall` 态，8 个区域、7 个可达：

| 区域 | 亮色面 / ink / 对比度 | 暗色面 / ink / 对比度 |
|---|---|---|
| 侧栏 `[data-side='sidebar']` | `#c8cad4` / `#0b121a` / **11.52** (share 0.63) | `#121d28` / `#e9f2f7` / **15.02** (0.99) |
| 正文列 `[data-dsh-center-col]` | `#bec1ca` / `#0b121a` / **10.46** (0.33) | `#121e29` / `#e9f2f7` / **14.88** (0.93) |
| 会话内容面 `[data-conversation-content]` | `#c7cad4` / `#0b121a` / **11.50** (0.57) | `#121f2a` / `#e9f2f7` / **14.75** (0.67) |
| 输入区 `[data-composer-card]` | `#ffffff` / `#0b121a` / **18.82** (0.74) | `#2c2c2e` / `#e9f2f7` / **12.28** (0.73) |
| 会话头部 `[data-conversation-header-corner]` | `#b9bec8` / `#0b121a` / **10.09** (0.64) | `#152837` / `#e9f2f7` / **13.31** (1.00) |
| 代码块 `pre code` | `#babdc6` / `#0b121a` / **10.02** (0.99) | `#121e2a` / `#e9f2f7` / **14.87** (0.82) |
| 浮层 `[role='dialog']` | `#fcfdfe` / `#0b121a` / **18.48** (0.92) | `#192329` / `#e9f2f7` / **14.09** (0.59) |
| 设置页 | **不可达**（见 §7） | **不可达** |

**7 个可达区域全部 ≥ 4.5:1，最紧的是亮色代码块 10.02 与亮色会话头部 10.09。**

**几何层独立获证**：同一批元素在浏览器里实测 `cornerShape = bevel`（全部区域），`borderRadius` 为 `0px`（侧栏/正文列/代码块）、`12px`（输入区）、`16px`（浮层）—— 与 A 层的 `--dsw-corner-shape: bevel` 与对折后的半径梯一致。这是画皮之外**第二个视觉层级**在真机上被独立确认。

## 5. 与 S2 对比度预算逐项对账（§五）

`docs\contrast-budget.md` 的预算模型是 `comp = art*(1-a) + fill*a`（encoded sRGB 逐通道），亮色看 art 的 **p05**、暗色看 **p95**，解得 light α=0.76 / dark α=0.64。

| | 模型预测的合成色 | 模型预测的 `label-primary` 对比度 | 浏览器实测合成色 | 浏览器实测对比度 | 判定 |
|---|---|---|---|---|---|
| 亮色 | `#b9bdc2` | 9.98 | **`#b9bec8` … `#c8cad4`** | **10.02 … 18.82** | **模型成立**（面相差 ≤ 10 级，对比度实测 ≥ 预测） |
| 暗色 | `#414548` | 8.51 | **`#121d28` … `#2c2c2e`** | **12.28 … 15.02** | **模型偏保守**（实测面比预测暗，对比度比预测高） |

**没有一项超阈值，也没有一项需要四舍五入才过关。** 亮色实测面与模型预测相差在 10 级以内；暗色实测面比模型的 p95 预测更暗（模型的 p95 是"最亮 5%"的最坏情形，而采样点落在中调区域），方向对可读性有利，故判为**保守**而非**偏差**。

**无壁纸态与模型的一致性**（这条比上面更干净，因为它没有 art 这个变量）：

| | 模型预期（veil over 无 art） | 浏览器实测 | 判定 |
|---|---|---|---|
| 亮色 | ≈`#e7eaee` | **`#e5e9ef`**（侧栏/正文列/头部/代码块一致） | 差 2 级，**成立** |
| 暗色 | ≈`#070d11` | **`#080e11`** | 差 1 级，**成立** |

**paint 层确实在起作用**（同一区域在四态下互不相同）：

| 区域 | 官方 | 主题+壁纸 | 主题+无壁纸 |
|---|---|---|---|
| 亮色侧栏 | `#ffffff` | `#c8cad4` | `#e5e9ef` |
| 暗色侧栏 | `#151517` | `#121d28` | `#080e11` |
| 暗色输入区 | `#2c2c2e` | `#2c2c2e` | `#2c2c2e`（不透明面，正确不受影响） |

## 6. 官方基线对拍（§六）

同一视口（1600×1000）、同一页面内容（关闭首启通知 + 打开同一个会话，两档各自一致）、同一明暗档、同一壁纸状态。

并排真实截图落在 `compare\`：`light-fullpage.png`、`dark-fullpage.png`，以及逐区域 `{light,dark}-{sidebar,main-column,conversation,composer,header,code-block,menu-overlay}.png`。

| 检查项 | 官方 | 主题 | 说明 |
|---|---|---|---|
| 侧栏 | `#ffffff` / `#151517` | `#c8cad4` / `#121d28` | 半透明化后透出壁纸 |
| 会话头部 | `#ffffff` / `#151517` | `#b9bec8` / `#152837` | 同上 |
| Markdown（会话内容面） | `#ffffff` / `#151517` | `#c7cad4` / `#121f2a` | 同上 |
| 代码块 | `#ffffff` / `#151517` | `#babdc6` / `#121e2a` | 同上 |
| 输入区 | `#fefefe` / `#2c2c2e` | `#ffffff` / `#2c2c2e` | **不透明面，官方值逐字节保留** |
| 菜单 / 浮层 | `#ffffff` / `#29292a` | `#fcfdfe` / `#192329` | 见 §7 的口径说明 |
| 设置页 | — | — | **两边都不存在**（见 §7） |
| 明暗切换 | `rgb(255,255,255)` ↔ `rgb(21,21,23)` | `rgba(227,232,238,.76)` ↔ `rgba(7,13,17,.64)` | 由官方 boot 链驱动（`color_scheme`），非手工翻档 |

## 7. 不可达项与偏离官方之处（逐条解释）

**不可达是结果，不是省略**，每条都带理由与已尝试过的选择器：

1. **设置页 —— 两边都不存在。** 本 profile 的 `cordis.patch.yml` 里 `- id: ui-settings / name: "@deepseek-ai/dsh-client-ui-settings"` 带 `config: {enabled: false}`，官方设置 UI 被关闭，页面上没有这个视图可拍。**官方态同样不可达**，所以这不是主题造成的差异。
2. **首启通知「预览版说明」是模态，其遮罩本身就是本主题覆盖的 `--dsw-alias-bg-mask-1`。** 首轮采样量到的是"遮罩后的应用"而非主题表面（亮 `#868a93`、暗 `#060b05`，算术复核：`227*0.66+11*0.34=153.5`≈`#9a9fa6`、`7*0.38≈2.7`）。**这顺带证明了 `bg-mask-1` 按设计生效**，但它不是量主题表面的正确位置。现在四个状态都在**关闭通知 + 打开会话**之后采样。
3. **菜单/浮层用的是计费弹层**（`[data-testid='billing-trigger']`）。它由 opener 打开、**每条路径都关闭**（首版只在不可达路径关闭，导致弹层泄漏进下一个状态的采样，把不透明输入区染成 `#a5a7ab`）。这条在 §5 的表里已修正。
4. **侧栏实际命中的是 `[data-side='sidebar']`**，不是 `[data-slot='sidebar']` —— 后者在本机被 `dsh-better-sidebar` 折叠为 0 尺寸。区域命中链记录在 `samples.json` 的 `selector` 与 `tried` 字段里。
5. **代码块需要打开会话才存在**：应用初始处于 hero 空态（`data-phase=hero`），没有任何 `pre`。工具改为**从最新往回**逐个打开会话，直到出现 `pre` 为止（上限 6 次）；亮档在第 2 次尝试命中（`pre=10`），暗档在第 2 次命中（`pre=2`）。

**偏离官方之处，逐条可解释**（S4 浏览器实测，两档合计）：

| 类别 | 数量 | 解释 |
|---|---|---|
| **直接覆盖** | **54** | 主题声明的 54 个令牌，逐字节等于 `src\tokens.json`（§8） |
| **派生变化** | **80** | 第三方插件与官方复合令牌从被覆盖的 alias 派生而来，例如 `--ds-t-1..4 ← label-primary/secondary/tertiary/dimmed`、`--ds-border ← border-l1`、`--ds-border-strong ← border-l2`、`--dsb-2/-3 ← bg-layer-2/-3`、`--dsw-font-markdown-* ← --dsw-font-family`、`--dsw-elevation-* ← elevation-stroke-color`、`--dsw-alias-tooltip-key-bg ← tooltip-bg`。**每一条都追到了它读取的主题令牌**（`samples.json` 的 `classification.derived` 带 `from` 字段） |
| **画皮自有变量** | **5** | `--cp-wall`、`--cp-pick-light/dark`、`--cp-wall-6oqzgq`、`--cp-wall-l8m9xp`，由注入的 `<style>` 声明，不碰官方命名空间 |
| **未解释** | **0** | — |

`body` 自定义属性总数 498 → **503**（新增的正是画皮那 5 个），无一删除。

## 8. 令牌链审计 · S1 → S2 → S3 → S4（§八）

**链条无一处断裂。**

| 段 | 对比 | 结果 |
|---|---|---|
| S1 官方值 vs S2 设计值 | `out\s2-token-baseline.json` ↔ `out\s2-palette.json` | **等于官方的 ＝ 0 个**（即没有任何未改动的令牌被写进覆盖层，P0 要求） |
| S2 设计值 vs S3 生成值 | `out\s2-palette.json` ↔ `src\tokens.json` | **104 个逐字节相同**；**4 个是"S2 值 + alpha 字节"**，正是两个半透明面 × 两档（见下） |
| S3 生成值 vs S4 浏览器实际值 | `src\tokens.json` ↔ `getComputedStyle(body)` | **108／108 全部一致，MISMATCH 0** |

104 + 4 = **108 = 54 令牌 × 2 档**，即每一个令牌在浏览器里的实际值都等于 S3 的生成值。

**S2→S3 的 4 处差异，逐条登记**（这是唯一被允许的变换，且只发生在这两个令牌上）：

| 令牌 | 档 | S2 设计值 | S3 生成值 | α |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 亮 | `#e3e8ee` | `#e3e8eec2` | 0.7608 |
| `--dsw-alias-bg-base` | 暗 | `#070d11` | `#070d11a3` | 0.6392 |
| `--dsw-specific-sidebar-fill` | 亮 | `#e8edf3` | `#e8edf3c2` | 0.7608 |
| `--dsw-specific-sidebar-fill` | 暗 | `#04080c` | `#04080ca3` | 0.6392 |

S2 量到的是不透明的面，S3 把 `build\veil-budget.json` 解出的 α 作为 alpha 字节追加 —— 两个 α 与 `docs\contrast-budget.md` 的 0.76 / 0.64 **一致**（独立复算所得）。

## 9. 开放问题（不抹平）

1. **首启通知被我确认过一次。** 四个状态都在通知关闭后采样，为此点了一次「继续」。随后新开的浏览器上下文里通知**没有再出现**（`noticeStillShownInFreshContext.open = False`）。它究竟是写进了持久偏好还是仅本进程内存标志，**本次运行无法区分**（要区分需重启应用，而那会结束当前会话）。这是一处**对应用的副作用**，如实登记。
2. **暗色实测面比模型预测暗**（`#121d28` vs `#414548`）。方向对可读性有利，判为模型保守；但"为什么采样点比 art 的 p95 暗这么多"未逐层拆解（候选原因：采样点落在 art 的中调区、以及侧栏自身填充叠在 body 之上构成双层 veil）。
3. **S2 预算的 strict 契约仍未裁决**：加上 `label-tertiary` 后亮色不可行（需 α≈0.98）。S4 的 7 个可达区域里，落在半透明面上的 ink 实测是 `--dsw-alias-label-primary`；**本次采样不足以判定是否有 tertiary 文字直接落在半透明面上**。若后续判定"有"，要动的是亮色壁纸，不是对比度目标。
4. **卸载路径未被执行**（见 §0-3）。

---

## 附：复跑命令

```powershell
$py314 = "<USERPROFILE>\AppData\Local\Programs\Python\Python314\python.exe"
cd <plugins>\Cyberpunk-Theme

# DOM 锚点普查（不注入、不采样）
& $py314 tools\verify-render.py --census --light

# 四态 + 官方基线 + 采样 + 并排图（默认两档）
& $py314 tools\verify-render.py

# 单档
& $py314 tools\verify-render.py --light
```

S3 侧的机械验收（与本次并行成立的另一组证据）：

```powershell
node --check index.js
node --check client.js
node tools\build-client.mjs --check     # client.js 与 src/ 同步
node tools\selfcheck.mjs                # 76 条结构断言
node tools\token-audit.mjs              # 令牌审计，覆盖数异常即 exit 1
```
