# S1 侦察取真值 · 报告

- 生成时间：2026-10-05（Asia/Shanghai），各条证据均带独立时间戳
- 侦察对象：`http://<DSH_AUTHORITY>`（DSH Desktop 运行中实例）
- 探针根目录：`<plugins>\Cyberpunk-Theme\`（`tools\` + `out\`）
- 本文件为 **中间产物**，不进桌面
- 迁移记录：侦察期临时根目录为 `<plugins>\tmp\skin-recon\`；2026-10-05T16:07:01 经用户指定包名 `Cyberpunk-Theme` 后整体迁入本目录，迁移前后文件集合与字节数逐一比对一致（19 个文件）。文档内所有证据的时间戳均早于迁移，**内容未因迁移改变**；工具脚本用 `Path(__file__).resolve().parent.parent` 定位根目录，与绝对路径无关。
- 证据等级：**A** = 原始命令 + 原始输出关键行 + 时间戳；**B** = 源码路径 + 行号

> 所有数字都可复跑。复跑方法见 §13。凡是本节写着「未判定」的，就是真的没测出来，不要当成默认值用。

---

## 1. 结论摘要

1. **颜色注入通道确认可用且唯一**：`ctx.theme.overrideTokens(source, {token: {light, dark}})`，双侧值必填。契约在 `packages/client/ui-theme/src/client/index.ts:56-64, 293-318`。
2. **body 层是唯一需要的注入面**：对 28 个候选令牌 × light/dark × pointer/keyboard 共 112 组测试，`bodyInlineWins` **全部为 True**，`restored` 全部为 True。见 §6。
3. **不存在「必须另开 paint 层」的令牌**：活文档内 **0 个** 令牌由「主体是 `html`/`:root`」的规则消费。P0 列出的 4 个 paint 候选逐个实测后，性质分别是「无消费者 / 不在本文档 / 被官方规则有意遮蔽 / 直接可达」，**实测不是 4 个**。见 §7。
   附：另有 **39 个令牌只「声明」在 `:root`/html**，但**声明位置不等于可达性**——它们经 body 层仍可覆盖（`--dsw-corner-shape` 就在这 39 个里，而它实测能撬动 597 个元素）。见 §6.2.1。
4. **`--dsw-corner-shape` 是最强的单一杠杆**：1 条 `*, *::before, *::after` 规则（`corner-shape.css:21-25`），实测 **856 个元素命中、597 个计算值改变**，且经 body 层可达。P0「圆角优先经 `--dsw-corner-shape`」由运行时证据支持。
5. **`--dsh-content-font-size` 确认禁改**：它是唯一写在 `body` 行内的自定义属性（`bodyInline=["--dsh-content-font-size"]`），由 boot 脚本托管，`removeProperty` 后级联不会恢复（`restored=False`）。见 §6。
6. **CLI 冲突定性完成**：本机 `dsh` 是 Desktop 载体的 CLI，**允许** `--profile desktop`；源码检出的裸 CLI **拒绝**。`list` 与 `add` 均已实测可用。见 §10.1。
7. **只有 `dependencies` 不挂载**：`profile.ts:739,743` 只遍历 `dsh.profile.bundles`。皮肤包必须在 `package.json` 声明 `dsh.bundle.patch`，否则被跳过（`profile.ts:748-750`）。见 §10.3。
8. **计数口径对账有重大缺口**：P0 给的复现命令所用的 `build/token-catalog.json` **在本机不存在**；`432` 可由 `inventory.json` 的 `external:false` 复现，但 `themedColor:134 / derivedColor:86 / nonColor:212` **无法在本机任何文件中复现**（实测同口径下 kind=color 是 216）。`489` 的真实含义是 `source==='live'` 的令牌数，不是 body 上自定义属性的个数（实测 498）。见 §3。
9. **明暗取真值由 `ui-theme.preference` 把关（方法论红线）**：`boot-theme.ts:27` 的 `preference === 'system' &&` 决定了 `prefers-color-scheme` 有没有话语权。当前 `preference: system`（`cordis.patch.yml:115`），所以「新建 context 给 `color_scheme`」**有效**；一旦改成显式亮/暗，该手法**静默失效**，只能翻 `body[data-ds-dark-theme]`。上一棒交接文件里「`color_scheme` 无效」的结论就是这么来的。见 §5.1、§11-10。
10. **已定：明暗双套都做**（用户 2026-10-05T16:12 拍板）。由此 `{light,dark}` 必填与 P0 §1.6「不许重新声明没改的令牌」之间的张力**按构造消失**；代价是亮色必须真正被设计，不再是顺带的。见 §14-7。
11. **那 14 个 `changed=0` 的令牌已全部定性（补测，见 §7.1）**：**2 个当前就活着**（`--dsw-menu-surface-fill`、`--dsw-elevation-stroke-color` —— 后者是通用扫描漏掉的真杠杆，经 `body, body *` 喂 600 个元素的标高描边）、**10 个状态门控**（错误/成功/警告态、菜单、遮罩、按钮填充，规则实测全部会 fire；仅这三个状态色就有 273/99/76 条引用在册）、**1 个值不由它供给**（`--dsh-boot-bg`）、**1 个本文档内真无消费者**（`--dsw-desktop-window-tint`）。**没有任何一个是「无消费者」。**
12. **颜色之外的第二个可用杠杆已找到**：`--dsw-elevation-stroke-color`（1 条引用撬动 600 个元素的描边）——它此前被通用扫描误判为 `changed=0`。§8 的 alias 传导 + §6.4 的圆角之外，这是 S2 可用的第三条杠杆。
13. **运行时基线复核通过（2026-10-05T16:31–16:33，§15）**：用户报告停用主题插件后实测 —— 当前运行时与 S1 快照**亮色 498/498、暗色 497/498 一致**，主题插件**零足迹**（无 palette 标记、无额外行内属性、截图目视干净）。结构原因：三个主题包只在 `dependencies`、不在 `dsh.profile.bundles` ⇒ **不挂载**。另：`<html>` 行内 `color-scheme` 的写入方已定位为**官方** `ui-layout/src/client/theme-presenter.ts:55`（不是第三方插件）。

---

## 2. 环境真值

| 项 | 实测值 | 证据 |
|---|---|---|
| DSH 安装版 | `FileVersion 0.2.0-rc.2` / `ProductVersion 0.2.0.0` | A `Get-Item "...\DeepSeek Harness.exe"`，2026-10-05T16:02:38 |
| app.asar | 121,348,951 B | A，同上 |
| Node | `v24.19.0` | A，2026-10-05T16:02:38 报错栈首行 `Node.js v24.19.0` |
| 宿主 | `http://<DSH_AUTHORITY>` | A，`live-tokens.json.authority` = `<DSH_AUTHORITY>` |
| profile 目录 | `<DSH_HOME>\profiles\desktop` | A |
| 浏览器色方案 → 应用 | `themeSource=system`：由 `prefers-color-scheme` 决定 | A `probe-mode.py` A/B/C 三态，2026-10-05T15:55 |

### 2.1 pnpm 有两个版本，都真（P0 的 11.7.0 指的是后者）

| 入口 | 版本 | 证据 |
|---|---|---|
| PATH 上的 `pnpm`（`<USERPROFILE>\AppData\Roaming\npm\pnpm.ps1`） | **12.8.1** | A |
| `dsh plugin` 实际转发到的 pnpm | **11.7.0** | A `dsh plugin --profile desktop --help` → 首行 `Version 11.7.0`，EXIT=0，2026-10-05T15:59 |

`dsh plugin <args>` 把 `<args>` **原样转发给 profile 目录内的 pnpm**（幂等证据：`add --help` 被转发成 `pnpm add --help`，输出 `Usage: pnpm add <name>`）。源码：`apps/cli/src/args.ts:188` `description('manage a profile\'s plugins by forwarding the remaining arguments to pnpm in the profile directory')`、`:192` `.argument('[args...]', 'pnpm arguments, forwarded verbatim ...')`。

### 2.2 两个 Python 环境（P0 声明成立）

| 环境 | 路径 | 版本 | Playwright | numpy | Pillow | pandas |
|---|---|---|---|---|---|---|
| 系统 Python | `<USERPROFILE>\AppData\Local\Programs\Python\Python314\python.exe` | `3.14.7 (tags/v3.14.7:823f032, Aug 5 2026) [MSC v.1944 64 bit (AMD64)]` | **OK** | **FAIL** | OK 12.2.0 | **FAIL** |
| DSH runtime Python | `<DSH_HOME>\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe` | `3.12.14 (main, Sep 1 2026) [MSC v.1944 64 bit]` | **FAIL** | OK 2.3.5 | OK 12.3.0 | OK 3.0.1 |

A：`python -c "import importlib; ..."` 逐模块导入，2026-10-05T16:00:13。

**分工（本报告所有探针均按此执行）**
- 浏览器探针（起 Chromium、读 computed）→ **Python314**：`probe-baseline.py`、`probe-mode.py`、`probe-reach.py`、`probe-cssom-facts.py`
- 只读 JSON 的分析脚本 → **DSH runtime Python**：`inspect-refs.py`、`inspect-scope.py`（两者只用标准库，用哪个都能跑，按 P0 归口到 runtime Python）

---

## 3. 令牌计数对账（本节是 P0 与实测冲突最集中的地方）

### 3.1 P0 给的复现命令在本机跑不通

```
node -e "console.log(require('./build/token-catalog.json').counts)"
```
A：2026-10-05T16:02:38 执行 → `Error: Cannot find module './build/token-catalog.json'`，`code: 'MODULE_NOT_FOUND'`，`Node.js v24.19.0`。
递归搜索 `<plugins>\dsh-skin-studio` 下所有 `token-catalog.json` → **0 个命中**。
`<plugins>\dsh-skin-studio\build\` 实际只有 3 个文件：`inventory.json` (368,711 B)、`INVENTORY.md` (91,955 B)、`live-tokens.json` (78,255 B)。

→ **P0 中 `dshOwned/themedColor/derivedColor/nonColor` 四个数的原始出处文件在本机不存在。** 下面用 `inventory.json` 尽量复现。

### 3.2 `432` 可复现，`134/86/212` 不可复现

`inventory.json` 顶层键：`["format","version","generatedFrom","groups","tokens"]`，`tokens = array[493]`，`groups = array[24]`。
单个 token 的字段集合：`["name","group","kind","label","where","light","dark","resolvedLight","resolvedDark","source","declaredLight","declaredDark","origin","sheet","external","hidden","refs","files"]`
—— **没有 owner / themed / derived 字段**。

A（2026-10-05T16:03:10 / 16:03:22）：

| 口径 | 实测值 | 与 P0 的关系 |
|---|---|---|
| `tokens.length` | **493** | 与 P0 的 placed:493 数值相同 |
| `external === true` | **61** | 第三方插件令牌 |
| `external !== true` | **432** | **复现 P0 `dshOwned:432`** ✓ |
| `source === 'live'` | **489** | **复现 P0 `liveTokens:489`** ✓ |
| `source !== 'live'` | 4 | 声明了但没在运行时取到值 |
| `external !== true` 且 `kind === 'color'` | **216** | **与 P0 `themedColor:134` 不符** |
| `external !== true` 的 kind 分布 | `color:216, length:74, font-family:33, keyword:31, font:30, font-weight:30, shadow:9, gradient:4, duration:3, easing:1, angle:1` | 合计 **432** ✓ |

→ **`themedColor:134` / `derivedColor:86` / `nonColor:212` 在本机现有文件中无法复现。** 按现有唯一可用口径（`external!==true` 且 `kind`），颜色类是 **216** 而不是 134，且 `134+86+212 = 432` 这个分解式在本机数据里没有对应字段支撑。
→ **未判定**：这三个数是否来自 skin-studio 面板内部的另一套分类（themed = 可被主题覆盖、derived = 由 themed 派生、nonColor = 非颜色），以及 134 是否等价于「alias 层可覆盖颜色的子集」。**S2 选令牌时不得直接引用 134/86/212 这三个数。**

### 3.3 `493` 不是可覆盖令牌数——三处口径互不相同

| 出现处 | 该处的字面表述 | 实测含义 |
|---|---|---|
| `INVENTORY.md` 第 5 行 | 「令牌总数：**493**（DSH 官方 432，第三方插件 61）」 | `inventory.json.tokens.length` = 493 = 声明清单长度（含第三方） |
| `INVENTORY.md` 第 8 行 | 「声明覆盖自检：declared 428 / **placed 493** / missing 0」 | 同一数字被当作 placed 使用 |
| 运行时可覆盖集合 | — | 实测 body 上 498 个自定义属性名（494 个非空）≠ 493 ≠ 489 |

→ **`INVENTORY.md` 自己就在两行内把 493 同时当作「令牌总数」和「placed」，这两个说法不兼容**（placed 是放置次数，总数是集合大小）。按 P0 口径：**493 只能读作 placed，不能读作可覆盖令牌数**，本报告予以确认并点名该文档的内部冲突。

### 3.4 `489` 的真实含义

`INVENTORY.md` 第 7 行写：「body 上亮 **489** / 暗 **489** 个自定义属性」。
A（2026-10-05T16:03:10）：`live-tokens.json` 里 `source === 'live'` 的令牌 = **489**。
A（2026-10-05T16:03:48）：本机实测 `getComputedStyle(body)` 上以 `--` 开头的属性名 = **498**（亮 494 个非空 / 暗 495 个非空）；`getComputedStyle(html)` = **71**（67 非空）。
而 `live-tokens.json` 的 `modes.light.body` 对象 = **491** 个键。

→ **489 是「skin-studio 用运行时值补全的令牌数」，不是「body 上自定义属性个数」。** 三个数 489 / 491 / 498 互不相等，原因：
- 491 与 498 差 7：`--scu-*` 系列（第三方插件 `dsh-session-colorful-unread-pin-jobs`）是状态相关令牌，两次抓取时 UI 状态不同；
- 498 里有 4 个是**空值**占位：`--scu-grad-1`、`--scu-grad-2`、`--shiki-foreground`、`--shiki-background`；
- 489 与 491 差 2 的成因未逐一判定（列为未决）。

### 3.5 live-tokens.json 的暗色快照不是「真暗色」

A（2026-10-05T16:03:10）：

```
live-tokens light: bootBg="#fff"      bgBase="#fff"      cornerShape="superellipse(1.5)"
live-tokens dark : bootBg="#fff"      bgBase="#151517"   cornerShape="superellipse(1.5)"
```
同时 `modes.dark` 的 `colorScheme = "light"`、`themeSource = "light"`、`darkAttr = true`。

这就是我在 `probe-mode.py` 里定义的 **case C（手工翻属性）** 的特征：`body` 的卡片色已变暗，但 `--dsh-boot-bg` 仍是亮色 `#fff`，`color-scheme` 仍是 light。
对照 A（2026-10-05T15:55，`probe-mode.py`）的三态：

| 态 | 触发方式 | darkAttr | html color-scheme | bodyBg | bootBg |
|---|---|---|---|---|---|
| A | `new_context(color_scheme=dark)`，官方 boot 链自行切暗 | true | **dark** | `rgb(21, 21, 23)` | `#151517` |
| B | `emulate_media(color_scheme=dark)` | true | **dark** | `rgb(21, 21, 23)` | `#151517` |
| C | 手工设 `body[data-ds-dark-theme]` | true | **light** | `rgb(21, 21, 23)` | **`#fff`** |

→ **`live-tokens.json` 的 dark 快照与 case C 同特征，属于混合态；A/B 才是官方链切换出的真暗色。**
→ 推论（对 S2 有直接影响）：**凡是用 `live-tokens.json` 的 dark 列当基准的令牌，若它属于 `--dsh-boot-bg` 一类的「boot 期/窗口期」令牌，拿到的都是亮色值。** 后续取真值必须用 case A/B 方法，见 §13。

---

## 4. 颜色唯一通道：`overrideTokens` 契约

B（`packages/client/ui-theme/src/client/index.ts`）：

| 行号 | 内容 |
|---|---|
| `:56-61` | `export interface ThemeTokenModes { light: string; dark: string }`，注释 `:52-55`「both palette modes are mandatory (repeat the same value when the token is scheme-invariant) so an override never goes illegible when the user switches to the other scheme」 |
| `:64` | `export type ThemeTokenOverrides = Record<string, ThemeTokenModes>` |
| `:67-77` | `export interface ThemeDefinition { id: string; colorScheme: 'light'\|'dark'; tokens: ThemeTokens }`；`:70-73` 注释「The presenter switches `body[data-ds-dark-theme]` **from this field — never from the id**」 |
| `:98-109` | `ThemeTokenInspection { name, description, valueType, requiresLightAndDark, cssVariable? }` |
| `:111-114` | `declare module '@deepseek-ai/cordis' { interface Context { theme: ThemeRuntime } }` → 插件侧拿的是 `ctx.theme` |
| `:293-308` | `overrideTokens` 文档：层按 `seq` 序叠在活动主题之上，**后叠的按 token 胜**；同 source 再次调用**整体替换该 source 的层**并重新压到最上；返回 disposer，移除后恢复被覆盖的值 |
| `:309-318` | `overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void`；`:310` `{ seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) }`；`:314` `if (this.overrides.get(source) !== layer) return`（旧层被新层取代后，旧 disposer 变成 no-op） |

关键约束（对插件实现方式有直接后果）：
- **`source` 就是层标识**：动态包传自己的包 id。**同一 source 重复调用是「替换整层」，不是「追加」**——所以覆盖表必须在调用点一次给全，不能分多次调用累加。
- **`{light, dark}` 两档必填**，只做单套主题时另一档要显式重复官方语义值（写官方值＝把官方当前值冻进我的层，与 P0 令牌纪律冲突 → 处理方式待 S2 决策，见 §14）。
- 值在运行时校验，**裸字符串会抛教学错误**（`:303-305`）。

---

## 5. 官方明暗系统真值

- `data-ds-theme-source`：**挂在 `<html>` 上，不在 body 上**。A（2026-10-05T16:19:10，`probe-consumers.py` 同一次 evaluate 里两处一起读）：`sourceHtml=system`、`sourceBody=None`，light/dark 两态一致。B 级佐证 `boot-theme.ts:31` 写的是 `document.documentElement.dataset.dsThemeSource`。
  ⚠ **更正**：本报告初版（A 2026-10-05T16:03:48 的 data-* 普查）把它记成 `<body data-ds-theme-source="system">`。那次普查清点的是 body 上的属性，**该条属误记**；body 上官方只写 `data-ds-dark-theme`（`boot-theme.ts:32`）。登记为 §11-13。
- `data-ds-dark-theme`：只在暗色态出现于 `body`；亮色态在 856 个节点里 **0 命中**（A，baseline 亮色态抓取）。→ **P0「插件不得自行设置 `data-ds-dark-theme`」是正确且必要的**，它就是官方 presenter 的私有开关。
- `<html>` 上存在 **行内** `color-scheme`：A（2026-10-05T15:57:09）`rootInlineVars = ["color-scheme", "--dsh-sidebar-height"]`。
  **这是第三方插件写的 —— 已由源码直接证实，不是推断。** B（`packages/client/ui-theme/src/boot-theme.ts`）：官方 boot 只做三件事——`:50` 注入一个 `kind:'style'` 的 `<style>` 元素（`:16-17` 的 `:root{color-scheme:light|dark}` 写在这张表里，**是 CSS 不是行内样式**）、`:31` `document.documentElement.dataset.dsThemeSource = preference`（写的是 **data 属性**）、`:33` `document.body.style.setProperty('--dsh-content-font-size', …)`（写的是 **body** 行内）。
  → **官方代码里没有任何一处对 `<html>` 写行内 `color-scheme`**，所以那一条必属第三方插件。**报告点名：本机已存在一个在 `<html>` 行内写 `color-scheme` 的插件，这正是本皮肤包禁止做的事**；它对明暗切换的干扰程度未判定，列为未决（§14）。
  → 同时这也解释了 `probe-cssom-facts.py` 的 `bodyInlineVars = ["--dsh-content-font-size"]` 为何**只有一个**元素：`:33` 就是官方唯一的 body 行内写入点。

### 5.1 明暗由「外观偏好」把关：`color_scheme` 只在 `preference=system` 时有效（**方法论红线**）

B（`boot-theme.ts:24-34`）：

```js
const preference = "…"                                   // :26 由 Host 注入的内置偏好
const systemDark = preference === 'system'
  && typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-color-scheme: dark)').matches   // :27-29
const dark = preference === 'dark' || systemDark          // :30
document.documentElement.dataset.dsThemeSource = preference   // :31
document.body.toggleAttribute('data-ds-dark-theme', dark)     // :32
```

**两档的分野就在 `:27` 的 `preference === 'system' &&`：**

| `ui-theme.preference` | `prefers-color-scheme` 有没有话语权 | 正确的取暗色手段 |
|---|---|---|
| `system`（**当前值**） | **有** —— `systemDark` 会读它 | 新建 context 时给 `color_scheme`（本报告全部探针用的方法，case A） |
| `light` / `dark`（显式） | **没有** —— `systemDark` 恒为 false，`matchMedia` 根本不被查询 | 只能翻 `body[data-ds-dark-theme]`（属性法） |

→ **本报告所有 light/dark 结论都以「实测当时 `preference = system`」为前提。** A（2026-10-05T16:19:10）：`<html data-ds-theme-source="system">`（同一探针读 body 得 `None`，见 §5 的更正）；A（`cordis.patch.yml:112-115`）`- id: ui-theme` / `preference: system`。两处独立证据一致。
→ **若用户把「设置 → 外观」改成显式亮色或暗色，本文档的 `color_scheme` 式探针会静默失效**（不会报错，会安静地给出错误的一档）。改偏好后必须重跑 `probe-mode.py` 复核。

**冲突点名（不抹平）**：上一棒交接文件 `<USERPROFILE>\<knowledge-base>\tasks\DSH-外观主题.md:118` 写「页面加载后再用 `page.emulate_media(color_scheme=…)` 翻不动主题，新建 context 时给 `color_scheme` 也无效；只有翻 `body[data-ds-dark-theme]` 属性有效」。
- 该结论**在 `preference` 为显式值时成立**，与 §5.1 表格右列一致；
- 但它**不成立于 `preference = system` 时**——S1 实测（`probe-mode.py` case A，2026-10-05T15:55）证明新建 context 给 `color_scheme=dark` **能**驱动官方链到 `html color-scheme=dark`、`--dsh-boot-bg=#151517`。
- 该交接文件 `:60` 记录当时「第 115 行现在是 `preference: light`」；**S1 实测该行现在是 `system`**（`cordis.patch.yml:115`），即该文档此条已过时。
- **结论：两个说法都是真的，前提不同。** 按 P0 §7 不抹平：**不是谁错，是条件变了**，且这个条件变化恰好是「`color_scheme` 式探针能否使用」的总开关。

- `data-input-modality`：**初始加载时不存在**（A：baseline 亮色态 59 个 data-* 属性中无此项；`probe-reach.py` 的 pointer 轮 `modality = None`），按 Tab 后才出现且值为 `keyboard`（A：`state(keyboard).modality = 'keyboard'`）。
  → 依赖此属性的官方规则（如 `focus.css:18`）在纯鼠标会话里根本不生效。**判定任何「聚焦环」相关令牌时必须先确认当前 modality。**

---

## 6. 令牌可达性：body 层能不能到（回答 P0 问题 7b 的正面部分）

### 6.1 引用图的构建方式与一次关键修正

`probe-mode.py` 遍历 `document.styleSheets`，解析 **`rule.style.cssText`** 再按 `;` 切分声明。
- 第一版用 `rule.style[i]` 索引枚举 → `referencedTokens = 272`；补上「自定义属性值里的 `var()` 也算引用」→ `370`；**改用 `cssText` → `527`**。
- **修正原因（重要教训）**：Chromium 的 `style[i]` 索引枚举**不暴露**某些属性，`@supports` 块内的 `corner-shape` 就被漏掉，导致 `--dsw-corner-shape` 的 refs 被算成 0。
- A（2026-10-05T15:58，EXIT=0）：**`sheets = 233`，`referencedTokens = 527`，`declaredTokens = 1061`**。
- A（2026-10-05T15:57:09，`probe-cssom-facts.py`）：**`unreadable = 0`** → CSSOM 走查无跨域盲区，引用图可信。

### 6.2 决定性结论：0 个令牌被 html/:root 主体规则消费

`inspect-scope.py` 对每条含 `var()` 的引用规则，取**最后一个复合选择器**（主体），判定其是否落在 `html`/`:root` 上（若落在，body 内联永远到不了）。
A（2026-10-05T15:58:54，EXIT=0）：

```
referenced tokens: 527
tokens with at least one ELEMENT-level consumer (reachable from body): 449
tokens consumed by an <html>/:root-subject rule (NOT reachable from body): 0
STRICTLY html-only tokens: 0
```

→ **本活文档内不存在「只能从 html 层到达」的令牌。** 只要某令牌在本文档里有消费者，body 层就能到达它。

#### 6.2.1 必须区分「声明位置」与「可达性」——39 个令牌只声明在 `:root`/html，但它们可达

A（`inspect-refs.py`，2026-10-05T16:07:32 于迁移后复跑，`sheets=233 referencedTokens=527 declaredTokens=1061`）：
**`declared ONLY under :root/html scope: 39`**，清单：

```
--animate-lc-agent-flow  --animate-lc-agent-glow  --animate-lc-bar-in  --animate-lc-donut-in
--animate-lc-stacked-in  --color-blue-500  --color-green-500  --color-indigo-500
--color-neutral-500  --color-orange-500  --color-pink-500  --color-purple-500
--color-slate-400  --color-teal-500  --color-violet-500  --ds-amber  --ds-blue  --ds-cyan
--ds-ease-in-out  --ds-font-family-code  --ds-green  --ds-red  --ds-transition-duration
--ds-transition-duration-fast  --ds-transition-duration-slow  --ds-violet
--dsw-corner-shape  --dsw-focus-ring-width  --dsw-font-family  --dsw-font-family-brand
--dsw-radius-lg  --dsw-radius-md  --dsw-radius-panel  --dsw-radius-sm  --dsw-radius-xl
--dsw-radius-xs  --scu-grad-1  --shiki-background  --shiki-foreground
```

**这 39 个里没有一个落在 §6.2 的「html 主体消费」集合**，两者是不同判据：
- **声明**在 `:root`（主体 `html`）→ body 内联**仍然压得过它**，因为 body 是 html 的后代，后代选择器解析 `var()` 时先看自己的继承链（body 行内 → 后代继承），官方那份 `:root` 声明只对 html 自身生效；
- **消费**规则的**主体**是 `html`（如 `html { background: var(--x) }`）→ body 内联永远到不了，这一类的数量是 **0**。

**最强证据**：`--dsw-corner-shape` 同时出现在这 39 个里（只声明在 `:root`，`corner-shape.css:17-19`），而 §6.4 实测它经 body 层改一个值就能让 **597 个元素**的计算值变化。
→ **结论：`declared only at :root/html` 不能作为「不可达」的判据；只有「消费规则主体是 html」才是。** 上表里的官方令牌（`--dsw-radius-*`、`--dsw-font-family*`、`--dsw-focus-ring-width`、`--dsw-corner-shape`）**均可经 body 层覆盖**。
→ 上表中的第三方令牌（`--animate-lc-*`、`--color-*`、`--ds-*`、`--scu-*`）不属于本皮肤包的作用范围，仅登记。

### 6.3 消费者生效实测（body 内联哨兵法）

`probe-reach.py`：对每个候选令牌在 `body.style` 上设哨兵值，比对 **856 个元素 × 约 32 个真实长手属性** 的 computed 变化，再移除。

A（2026-10-05T16:00:52，EXIT=0，后台任务 `pwsh-135`）：
- **`bodyInlineWins = True` 在 light/dark × pointer/keyboard 共 112 组中全部成立** → body 行内自定义属性压过官方所有 `body{}` / `body[data-ds-dark-theme]{}` 声明（含 `--dsw-alias-*`、`--dsw-menu-surface-fill`、`--dsw-menu-backdrop-filter`）。
- **`restored = True` 全部成立，唯一例外是 `--dsh-content-font-size`**（pointer 轮为 False，keyboard 轮为 True）。原因：它由 boot 写在 `body` 行内（`bodyInline=["--dsh-content-font-size"]`），动它就等于和「设置 → 通用 → 字体大小」争用；`removeProperty` 后级联不恢复，是因为级联里没有它的声明。
  → **P0「绝不修改 `--dsh-content-font-size`」得到运行时证据支持。**
- 有效杠杆（`changedElements`，两态一致）：

| 令牌 | 命中元素(规则) | 实际改变元素 | 备注 |
|---|---|---|---|
| `--dsw-corner-shape` | **856** | **597** | 见 §6.4 |
| `--dsw-alias-label-primary` | 34 | **327** | 受影响元素数 > 命中数 ⇒ 存在继承/派生链 |
| `--dsw-alias-label-secondary` | 13 | 60 | 同上 |
| `--dsh-content-font-size` | 1 | 27 | **禁改** |
| `--dsw-alias-state-business-primary` | 4 | 9 | |
| `--dsw-alias-bg-base` | 5 | 5 | |
| `--dsw-alias-bg-layer-1` | 5 | 5 | |
| `--dsw-specific-sidebar-fill` | 3 | 3 | |
| `--dsw-alias-border-l2` | 1 | 3 | |
| `--dsw-alias-border-l1` / `-l4` | 1 / 2 | 2 / 2 | |
| `--dsw-alias-bg-layer-2` | **0** | 1 | 无直接消费者，但有 1 个元素受影响（派生） |
| `--dsw-alias-brand-primary` | 2 | 1 | 见 §8 的 alias 传导 |

- **`changedElements = 0` 的 14 个候选**（两态一致）：`--dsh-boot-bg`、`--dsw-desktop-window-tint`、`--dsw-focus-ring-color`、`--dsw-menu-backdrop-filter`、`--dsw-menu-surface-fill`、`--dsw-specific-menu`、`--dsw-alias-bg-overlay`、`--dsw-alias-button-primary-fill`、`--dsw-alias-state-error/success/warn-primary`、`--dsw-elevation-stroke-color`、`--dsw-shadow-lv1`、`--dsw-mask-blur`。
  **`0` 不等于不可达**：命中数（`matched`）说明规则是否匹配到当前 DOM。菜单没开、没有错误态、没有次要按钮时，即使消费者规则真实存在也不会变。判读必须两者一起看，逐个定性见 §7。
  → **这 14 个已于 2026-10-05T16:19–16:22 逐个定性完毕，见 §7.1**（结论：无一个是「无消费者」）。

### 6.4 `--dsw-corner-shape`：最强单一杠杆

B（`packages/client/ui-theme/src/styles/corner-shape.css`）：
- `:16` `@supports (corner-shape: superellipse(1.5)) {`
- `:17-19` `:root { --dsw-corner-shape: superellipse(1.5); }`
- `:21-25` `*, *::before, *::after { corner-shape: var(--dsw-corner-shape); }`
- `:7` 注释「**corner-shape does not inherit**, so the universal selector applies the token to elements and their ::before/::after」

运行时佐证：A（2026-10-05T15:57:09）`CSS.supports('corner-shape','superellipse(1.5)') = true`；`getComputedStyle(body).cornerShape = "superellipse(1.5)"`（初值 `round`）。
A（reach）：该令牌 `matchedEls = 856`（规则主体 `*, ::before, ::after`），改 body 值后 **597 个元素** 的 computed 变化。

→ 机制说清：**属性本身不继承，但「令牌」作为自定义属性会继承**；`*` 规则让每个元素各自解析继承来的 body 值。所以「在 body 上改一个值 → 全应用圆角变化」这条路成立。
→ 另注：`:11-14` 注释说明全圆形状（`border-radius: 50%/100%/胶囊`）会在各组件表里成对写 `corner-shape: round` 主动退出。**所以圆角杠杆不是 100% 覆盖，全圆元素不受影响是官方刻意设计，不是缺陷。**

---

## 7. paint 层候选逐个复核（回答 P0 问题 7b 的结论部分）

P0 给的 4 个候选 + 我补测的 2 个，逐个定性：

| # | 令牌 | CSSOM 引用 | 命中元素 | P0 的预期 | **实测定性** |
|---|---|---|---|---|---|
| 1 | `--dsh-boot-bg` | **refs=1**，唯一消费者是 `index-BPHePDI_.css` 的 `._boot_u7vgf_3 { background: var(--dsw-alias-bg-base, var(--dsh-boot-bg, Canvas)) }` —— 它是**第二 fallback** | 0 | 需 paint 层 | **无视觉作用，已实测坐实**：`probe-boot-bg-fallback.py`（A 2026-10-05T16:23:49，两态一致）把三个槽依次驱动到不同颜色 —— `--dsw-alias-bg-base := rgb(11,22,33)` → 背景**跟着变**（`slot1_is_boot_bg=False` ⇒ 值确实来自第一槽）；`--dsh-boot-bg := rgb(44,55,66)` → 背景**纹丝不动**（`boot_bg_shadowed=True`）。**值由第一槽供给，改它永远不生效。不要改。** |
| 2 | `--dsw-desktop-window-tint` | **rawHits = 0**（233 张表内不存在） | 0 | 需 paint 层 | **不在本文档**。`reachability` 里 `declaredAtHtml=""`、`declaredAtBody=""`。属于 Electron 欢迎/更新窗口的文档，**桌面主窗口里改它无效**。 |
| 3 | `--dsw-focus-ring-color` | **refs=109**（`outline`/`outline-color`/`box-shadow`/`border-color`/`background`） | **1**（`:focus-visible`） | 需 paint 层 | **可达，规则已被实测确认会 fire**：`probe-rule-fire.py` 造出该选择器要的元素后，`ruleApplicable=1 / ruleFired=1`（两态一致）。`focus.css:18-21` 在 `html[data-input-modality='pointer'] body :focus-visible:not(:read-write)` 上把该令牌**重写成 `transparent`**——指针模态下官方有意让聚焦元素不画环，这才是 `changedElements=0` 的原因（`probe-consumers.py` 把它判为 `LIVE-SHADOWED`：消费者元素在，但那个属性没动）。 |
| 4 | `--dsw-menu-backdrop-filter` | **refs=15**，消费属性 `backdrop-filter` | 0（菜单未打开） | 需 paint 层 | **可达，规则已实测确认会 fire**：`ruleApplicable=11 / ruleFired=11`（两态一致）。声明在 `gradient-shadow-text.css:1` `body {` 块内 `:20` `--dsw-menu-backdrop-filter: blur(40px) saturate(150%);`。`changedElements=0` 只是**菜单当前没打开**，不是不可达。 |
| 5 | `--dsw-menu-surface-fill` | **refs=3**：`._material_ri079_21 { background: var(--dsw-menu-surface-fill) }` + 两条 `--dsw-specific-menu = var(--dsw-menu-surface-fill)` | 0（菜单未打开） | （我补测） | **可达**。声明 `design-platform.css:271` `rgba(248, 249, 250, 0.58)`（亮）/ `:389` `rgba(67, 69, 74, 0.45)`（暗）。 |
| 6 | `--dsw-focus-ring-width` | `focus.css:3` `:root { --dsw-focus-ring-width: 2px }`；`:12` 消费 | 1 | （我补测） | **可达**。注意它声明在 `:root`，body 内联仍可覆盖（`:root` 的主体是 `html`，但它是**声明**位置不是**消费**位置——消费在 `:focus-visible` 上，属元素级）。 |

**结论：实测不需要为这 4 个令牌另开 paint 层。** 其中 1 个（`--dsh-boot-bg`）**值根本不由它供给**、1 个（`--dsw-desktop-window-tint`）不在本文档、2 个（`--dsw-focus-ring-color`、`--dsw-menu-backdrop-filter`）body 层直接可达，只是需要正确的 UI 状态（键盘模态 / 打开菜单）才能观测到效果。
→ **与 P0 的差异已记录**：P0 说「4 个都需要单独通过 paint 层 CSS 处理」，实测结论是 **0 个需要**。

**这个 0 是把全部 527 个令牌一起数出来的，不是只看这 4 个**（A 2026-10-05T16:21，判据：一条选择器的**主体 = 最后一个复合选择器**，先剥掉 `[...]` 与 `(...)` 再按组合符切分）：
```
referencedTokens=527   totalRefs=8527   refsWithRootSUBJECT=3
tokens with >=1 root-subject ref: 2   --dsh-windows-titlebar-height(2/9)  --dsh-frame-top-clearance(1/6)
tokens whose EVERY ref is root-subject => truly unreachable from body: 0
```
即：8527 条引用里只有 **3 条**的主体落在 `html`/`:root` 上，涉及 2 个令牌，**都是非颜色布局量**；**没有任何令牌是「只能从 html 层到达」的**。
⚠ 该判据极易写错：以「**第一个**复合选择器」判断会把 `html[data-input-modality='pointer'] body :focus-visible…` 误判成 root 主体（同一脚本误算得 17 条 / 2 个 only-root 令牌，其中 `--lc-i`、`--dsw-static-blue-400` 是假阳性）。CSS 的主体是**最右**那个复合选择器。见 §12-13。

**补充事实（paint 层相关的其余候选）**：
- `--dsh-boot-*` 家族（`--dsh-boot-label-primary: #0f1115`、`--dsh-boot-label-secondary: #61666b`、`--dsh-boot-label-tertiary: #81858c`、`--dsh-boot-border: rgb(0 0 0 / 10%)`、`--dsh-boot-brand` …）声明在 `._boot_u7vgf_3`（boot 屏自己的作用域）。**启动屏是独立作用域，改 body 层到不了它**，这是一处真实的「body 层之外」，但 P0 未把它列入候选，S1 只记录不改。
- **真正的「paint 层之外」是 hydrate 之前的那一帧**，而它不是令牌问题：官方 boot `<style>` 直接写死 `body{background-color:#fff}` / `#151517`（B `boot-theme.ts:15-21`），`--dsh-boot-bg` 在那里只是被**声明**、不是被消费。任何经 `overrideTokens` 注入的值都到不了那一帧。**S2 若要做启动帧肤色，只能靠一个更早/更靠后的 CSS 层，不能靠改 `--dsh-boot-bg`。**
- ~~`--dsw-mask-blur`、`--dsw-shadow-lv1` 是否有真实消费者未判定~~ → **已判定，见 §7.1**：`--dsw-mask-blur` 规则 8/8 全部 fire（只是当前没打开模态框）；`--dsw-shadow-lv1` 的 5 条引用**全部来自第三方插件**，官方表面不消费它。

### 7.1 补测：那 14 个 `changed=0` 的令牌，究竟是「无消费者」还是「状态没触发」（2026-10-05T16:19–16:22）

`probe-reach.py` 的通用扫描只看约 32 个真实长手属性、且要求消费者元素**此刻存在**，所以状态相关令牌一律读成 `changed=0`。本节用两个新探针把这一跳补上（两者共用 `tools\probe_consumers_defs.py` 里的令牌/哨兵/faithful 判据）：

- **`probe-consumers.py`**（A 16:19:10，light+dark，EXIT=0）：把 `out\cssom-refs.json` 里该令牌的每条消费者选择器拿到**活文档里数命中元素**（`matches`），并对命中的元素做**定点哨兵**（只读该规则真正消费的那个属性）。→ 回答「消费者元素在不在」。
- **`probe-rule-fire.py`**（A 16:22:20，light+dark，EXIT=0）：为每条消费者规则**合成一个它要的元素**（带齐它要求的 class 与属性），再读该属性、写哨兵、重读。→ 回答「规则本身是不是活的、会不会 fire」。**这是合成元素测试：它证明的是「规则接好了」，不是「应用此刻渲染了它」。** 两个探针必须合起来读。

| 令牌 | refs | 消费者元素命中 | 规则 applicable / fired | **实测定性** |
|---|---|---|---|---|
| `--dsw-alias-state-error-primary` | **273** | 0 | **231 / 230** | **状态门控，消费者铁证如山**。273 条引用全带状态门（`[data-state="error"]`、`[data-tone="danger"]`、`[aria-invalid="true"]`），当前界面没有错误态。**不是无消费者。** |
| `--dsw-alias-state-success-primary` | 99 | 0 | **92 / 89** | 状态门控（`[data-state="done"]`、`[data-tone="success"]`） |
| `--dsw-alias-state-warn-primary` | 76 | 0 | **70 / 70** | 状态门控（`[data-state="warning"]`、`[data-tone="warning"]`） |
| `--dsw-alias-button-primary-fill` | 27 | 0 | **15 / 14** | 状态门控（次要/主按钮当前未渲染）；另有**官方**消费者 `._primary_1rv3m_36{background:…}`、`._acknowledgement_cjd8z_38 input{accent-color:…}` |
| `--dsw-specific-menu` | 21 | 0 | **14 / 14** | 状态门控（菜单未打开） |
| `--dsw-menu-backdrop-filter` | 15 | 0 | **11 / 11** | 状态门控（菜单未打开） |
| `--dsw-mask-blur` | 8 | 0 | **8 / 8** | 状态门控（模态框未打开）。**原「是否有消费者未判定」结案：规则全部会 fire。** |
| `--dsw-alias-bg-overlay` | 3 | 0 | **3 / 3** | 状态门控（唯一官方消费者 = 问询卡片编号徽标 `.mAtvLq_number`） |
| `--dsw-menu-surface-fill` | 3 | **1**（真 body） | **3 / 3** | **当前就活着**（直接生效） |
| `--dsw-focus-ring-color` | 109 | 1 | **1 / 1** | 规则会 fire；`probe-consumers.py` 判为 `LIVE-SHADOWED`（见 §7 第 3 行） |
| `--dsw-elevation-stroke-color` | **1** | **1** | **1 / 1** | **当前就活着，推翻了通用扫描的 `changed=0`**。它经 `gradient-shadow-text.css` 的 `body, body *{--dsw-elevation-stroke: 0 0 0 .5px var(--…) }` 喂 `--dsw-elevation-panel/prominent/soft`，**匹配 600 个元素**；哨兵一改，`--dsw-elevation-stroke` 的计算值实测从 `0 0 0 .5px #00000029` 变成 `0 0 0 .5px rgb(1, 2, 3)`。**这是 14 个里有真实视觉杠杆的一个。** |
| `--dsw-shadow-lv1` | 5 | 0（当前态） | **2 / 1** | **官方零消费者**：5 条引用**全部来自第三方插件**（`dshmarket`、`dsh-skill-mcp-panel`×2、`@linxin666/dsh-client-ui-task-board`）。改它只影响这几个插件的 UI，官方表面不受影响。 |
| `--dsw-desktop-window-tint` | **0** | 0 | 0 / 0 | **不在本文档**（233 张表内 0 命中），属 Electron 欢迎/更新窗口 |
| `--dsh-boot-bg` | 1 | 0 | 1 / **0** | **值不由它供给**（见 §7 第 1 行），改它不生效 |

**本节结论（回答用户 2026-10-05T16:16 的提问）**：这 14 个里
- **「当前就活着」2 个**：`--dsw-menu-surface-fill`、`--dsw-elevation-stroke-color`（后者是通用扫描漏掉的真杠杆）；
- **「状态门控」10 个**：错误/成功/警告态、菜单类、遮罩类、按钮填充 —— 规则全部实测会 fire，只是当前 UI 状态没渲染对应元素；
- **「不是无消费者，而是值不由它供给」1 个**：`--dsh-boot-bg`；
- **「本文档内真无消费者」1 个**：`--dsw-desktop-window-tint`；
- 另有 `--dsw-focus-ring-color` 属「可达但被官方规则有意遮蔽」。
→ **没有任何一个令牌是「没有消费者」的。** `changed=0` 一律是状态或遮蔽造成的。

---

## 8. 引用图与爆炸半径（S2 选令牌的直接依据）

A（2026-10-05T15:58，cssText 版）：

| 令牌 | refs | 声明处 | 说明 |
|---|---|---|---|
| `--dsw-alias-label-primary` | **675** | `body` 亮 `var(--dsw-static-neutral-bluish-1000)` / 暗 `var(--dsw-static-neutral-bluish-50)` | **爆炸半径最大**。消费属性含 `--ds-t-1`、`--fold-ink`、`--mn-text`、`--shiki-foreground`、`color`、`fill`、`background-image`。注意它同时被第三方插件（`--mn-*` = mnemon、`--fold-ink`）再派生 |
| `--dsw-focus-ring-color` | 109 | `focus.css:19` | 见 §7 |
| `--dsw-alias-brand-primary` | **54** | `body` 亮 `var(--dsw-static-neutral-bluish-1000)` / 暗 `var(--dsw-static-neutral-bluish-50)` | 消费属性含 `--dsw-alias-button-primary-fill`、`accent-color`、`border-bottom-color`、`box-shadow`、`color`、`fill`、`outline-color`、`stroke` → **P0「改 alias 带动下游」实测成立** |
| `--dsw-menu-backdrop-filter` | 15 | `gradient-shadow-text.css:20` | |
| `--dsw-alias-bg-layer-1` | 11 | 亮 `bluish-00` / 暗 `bluish-875` | 被第三方再派生：`--dsb`、`--mn-input`、`--mn-layer-1`、`--trajectory-turn-accent` |
| `--dsw-alias-button-primary-fill` | 5 | `body`/dark = `var(--dsw-alias-brand-primary)`；`.fO69Vq_dangerButton` = `var(--dsw-alias-state-error-primary)` | 改它不如改 `--dsw-alias-brand-primary`（P0 的 alias 优先原则） |
| `--dsw-menu-surface-fill` | 3 | `design-platform.css:271, 389` | |
| `--dsw-corner-shape` | **1** | `corner-shape.css:18` | 1 条引用撬动 856 个元素 → **杠杆比最高** |
| `--dsh-boot-bg` | 1 | `body`（boot 注入 `#fff`/`#151517`） | 被遮蔽的第二 fallback |
| `--dsh-content-font-size` | — | **`boot-theme.ts:33` 写在 body 行内** | **禁改** |

`--dsw-alias-*` 的声明位置普遍是 `body` / `body[data-ds-dark-theme]`，值是 `var(--dsw-static-*)` 静态色阶 → **改 alias 就是改「语义层到静态色阶的映射」，这正是 P0 允许的层级。**

---

## 9. 官方 data-* 契约实测清单

A（2026-10-05T15:50:55 / 16:03:48）：856 个元素上共 **59 种** `data-*` 属性。全部清单（`属性=出现次数`）：

```
data-ds-theme-source=1   data-rc-order=3        data-rc-priority=1     data-css-hash=3
data-token-hash=1        data-plugin=227        data-plugin-css=222    data-dsh-dup-css=1
data-slot=52             data-rightbar-collapsed=1  data-window-drag=3 data-dsh-panel-entry=1
data-dsh-plugin=1        data-dsh-part=1        data-row-key=10        data-state=1
data-testid=6            data-dsh-center-col=1  data-phase=2           data-conversation-header-leading=1
data-conversation-header-corner=1  data-sidebar-right-expand=1  data-conversation-content=1
data-conversation-region=2  data-content-phase=1  data-conversation-session=1
data-conversation-scroll=1  data-composer-seat=1  data-chain-overlay-fallback=1
data-composer-card=1     data-input-scroll=1     data-composer-input=1  data-placeholder=1
data-lexical-editor=1    data-composer-placeholder=1  data-rightbar-col=1  data-sidebar-right-session=2
data-sidebar-right-panel=1  data-dockkit-surface=1  data-dockkit-drop-zones=1  data-dockkit-empty=1
data-dockkit-pane=1      data-dockkit-pane-active=1  data-dockkit-strip=1  data-dockkit-strip-tabs=1
data-dockkit-add-tab=1   data-dockkit-strip-fill=1  data-dockkit-split-button=1
data-dockkit-strip-chrome=1  data-sidebar-right-mode=1  data-sidebar-right-toggle=1
data-shell-overlay=1     data-side=1            data-dsh-better-sidebar=1  data-dsh-panel-host=1
data-dsh-panel=1         data-dsh-bottom-panel=1  data-dsh-pane=1      data-file-type-mark=1
```

**可直接作稳定契约使用的官方属性（S2 可用）**
- `data-slot`（52 处，值形如 `root`、`sidebar`、`sidebar.brand.mark`、`sidebar.panellist`、`sidebar.workspaces`…）—— **官方组件级稳定命名空间**
- `data-dsh-center-col`（1）、`data-conversation-content`（1）、`data-conversation-region`（2）、`data-conversation-scroll`、`data-conversation-session`、`data-composer-*` 系列、`data-sidebar-right-*` 系列
- `data-ds-theme-source`（值 `system`）—— 只读，不要写
- `data-input-modality` —— **运行时出现/消失**，用它做选择器必须接受「属性不存在」的分支

**不要用的（第三方或框架内部）**：`data-dockkit-*`（14 个，第三方 dock 组件）、`data-dsh-better-sidebar`、`data-dsh-panel*`、`data-dsh-bottom-panel`、`data-dsh-pane`、`data-plugin` / `data-plugin-css` / `data-css-hash` / `data-token-hash` / `data-rc-*`（Ant Design 内部）、`data-row-key`、`data-testid`。

**P0 点名的三个契约实测状态**：`data-slot` ✓ 存在；`data-dsh-center-col` ✓ 存在（1 处）；`data-conversation-content` ✓ 存在（1 处）。三者均可用。

---

## 10. 三个待证问题的实测结论

### 10.1 (a) `dsh plugin --profile desktop` 是否可用 —— **可用**

A（多次，2026-10-05T15:59–16:00）：

| 命令 | EXIT | 关键输出 |
|---|---|---|
| `dsh plugin --profile desktop list` | **0** | 35 行，末行 `27 packages` |
| `dsh plugin --profile desktop --help` | **0** | 转发给 pnpm，首行 `Version 11.7.0` |
| `dsh plugin --profile desktop add --help` | **0** | 转发给 pnpm，输出 `Usage: pnpm add <name>` … `Installs a package and any packages that it depends on.` |
| `dsh plugin --help`（不带 `--profile`） | 1 | `error: required option '--profile <name>' not specified` |

→ **`list` 与 `add`（变更类子命令）在 `--profile desktop` 下都可用**，且 `add` 这条路径没有安装任何东西（只转发了 `--help`）。

**冲突定性**（P0 点名的技能文档冲突，实测后的解释）：
- B `apps/cli/src/args.ts:83-87`：`rejectElectronProfile()` — `if (profile.toLowerCase() === 'desktop') program.error('error: profile "desktop" is managed exclusively by the Electron application')`
- B `args.ts:183`：**boot 路径无条件**调用 `rejectElectronProfile` → 源码检出的裸 `dsh --profile desktop` 必被拒
- B `args.ts:143`：`@param manageDesktopProfile - permit Desktop's installed carrier to manage its reserved profile's plugins.`
- B `args.ts:146`：`parseDshArgs(argv, version, manageDesktopProfile = false)`
- B `args.ts:195`：`if (!manageDesktopProfile) rejectElectronProfile(plugin, options.profile)` → **plugin 子命令有逃生门，boot 路径没有**
- B `apps/cli/src/bin.ts:18, 28-29`：`manageDesktopProfile` 由调用方透传
- A：本机 `dsh` 的实际入口是 `<USERPROFILE>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`，内容为
  `set "ELECTRON_RUN_AS_NODE=1"` + `"%~dp0..\..\..\..\DeepSeek Harness.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*`
  → 本机这条 `dsh` 就是 **Desktop 载体的 CLI**，天然 `manageDesktopProfile=true`。
- A：asar（121,348,951 B）内文本搜索 `managed exclusively by the Electron application` = **1 处**、`manageDesktopProfile` = **6 处** → 安装版**带着同样的守卫代码**，只是入口把参数置了 true。

→ **技能文档「`dsh plugin --profile desktop` 必定失败」之所以错，是没区分这两条入口。P0 的提醒正确：不要预设 CLI 必定失败，必须实测。**

### 10.2 (b) 哪些令牌无法通过 body 层到达 —— **0 个**

见 §6.2 / §7。**paint 层需要 0 个令牌，不是 3 个也不是 4 个。**

### 10.3 (c) `dsh.profile.bundles` 与「只有 dependencies 不挂载」

A（`<DSH_HOME>\profiles\desktop\package.json`，2,540 B，mtime 2026-10-05 15:14:02）：
- `dependencies`：31 条（含 `dsh-theme-starwake`、`dsh-skin-studio`、`dsh-theme-studio` 等 `link:` 项）
- `dsh.profile.bundles`（第 36-66 行）：**29 条**
- **目标皮肤包不在 bundles 里**（本次任务尚未创建任何包，此项按现状记录：现阶段**没有**需要清理的残留）

**「只有 dependencies 不会挂载」—— 源码证实成立**：
- B `packages/boot/app-boot/src/profile.ts:739` `const bundles = manifest.dsh?.profile?.bundles ?? []`
- B `:743` `for (const packageName of bundles) {` → **只遍历 `dsh.profile.bundles`**，`dependencies` 不参与挂载
- B `:745-746` `resolveBundleDir(...)` + 读该包自己的 manifest
- B `:748-750` `if (bundle === undefined) throw new Error(... declares no dsh.bundle in its package.json)` → **皮肤包必须在 `package.json` 里声明 `dsh.bundle`**，否则整包被跳过并记进 `skippedBundles`
- B `:754` `bundlePatchPaths(packageDir, bundle)` → 从 `dsh.bundle.patch` 取补丁路径
- B `packages/util/package-manifest/src/types.ts:69-72` `interface DshBundleManifest { patch: string | string[] }`（一个或有序多个，相对声明包根）
- B `types.ts:75-78` `interface DshProfileManifest { bundles?: string[] }`（有序，用已安装包名）
- B `types.ts:81-88` `interface DshClientManifest { platform: string; inject?: string[]; immediately?: boolean; ... }` → 浏览器半边由它声明
- B `profile.ts:742` `const exemptions = bundles.length === 0 ? {} : readProfileVersionExemptions(dir)` → **版本豁免只在 bundles 非空时读取**（与 S5 装载相关，见 §14）

→ **S5 的装载形态确定为两步：`pnpm add`（或 `link:`）把包放进 dependencies，再把包名追加进 `dsh.profile.bundles`。** 只做第一步不会挂载。

---

## 11. 冲突与差异登记表（不抹平）

| # | 冲突点 | 一方说法 | 实测/另一方 | 处理 |
|---|---|---|---|---|
| 1 | `token-catalog.json` | P0 给的命令用 `./build/token-catalog.json` | 该文件**在本机不存在**（递归搜索 0 命中） | 改用 `inventory.json` 复现，见 §3.2 |
| 2 | `493` 的含义 | P0：placed/放置次数，不是可覆盖令牌数 | `INVENTORY.md` 第 5 行把它写成「令牌总数」，第 8 行又写成 placed | **采纳 P0 口径**（placed），并点名 INVENTORY.md 内部自相矛盾 |
| 3 | `themedColor:134 / derivedColor:86 / nonColor:212` | P0 给出 | 本机任何文件都**无法复现**；同口径 `kind==='color'` 是 **216** | 报告差异，**S2 不得引用这三个数** |
| 4 | `489` | `INVENTORY.md`：「body 上亮 489 / 暗 489 个自定义属性」 | `source==='live'` 的令牌数 = 489；body 上实际自定义属性名 = **498**；`live-tokens.json` 的 body 键 = **491** | 三个数各自成立但指不同东西，逐个注明 |
| 5 | paint 层 4 候选 | P0：「这四项需要单独通过 paint 层 CSS 处理」，但允许以实测为准 | 实测 **0 个需要**（1 个无作用、1 个不在本文档、2 个 body 直达） | **以实测为准**，并保留 P0 原话作为对照 |
| 6 | `dsh plugin --profile desktop` | 技能文档：必定失败 | 本机 EXIT=0（`list`/`add`）；源码裸 CLI 确会拒绝 | 两条入口不同，**双说法都真** |
| 7 | pnpm 版本 | P0：11.7.0 | PATH 上是 12.8.1；`dsh plugin` 用的是 11.7.0 | 都真，**分属两个入口** |
| 8 | 暗色真值 | `live-tokens.json` 的 dark 列 | 其特征 = case C 混合态（`bootBg` 仍是 `#fff`），非官方链暗色 | **dark 列不能无条件当基准** |
| 9 | 安装版 vs 源码检出 | P0 提醒二者可能不同 | 安装版 `0.2.0-rc.2`；源码检出 `0.2.1-alpha.1`（`INVENTORY.md` 第 10 行自述） | 一律以运行时实测为准 |
| 10 | **怎么取暗色真值** | 上一棒交接 `DSH-外观主题.md:118`：「新建 context 给 `color_scheme` **无效**，只有翻 `body[data-ds-dark-theme]` 有效」 | S1 实测：`color_scheme` 驱动官方链**有效**（case A：`html color-scheme=dark`、`--dsh-boot-bg=#151517`）；翻属性得到的反而是混合态（case C：`html color-scheme=light`、`boot-bg=#fff`） | **两者都对，前提不同**：由 `ui-theme.preference` 把关（`boot-theme.ts:27`）。写该交接文件时 `preference: light`，现已改回 `system`。见 §5.1 |
| 11 | `ui-theme.preference` 现值 | 上一棒交接 `:60`：「第 115 行现在是 `preference: light`」 | A：`cordis.patch.yml:115` = `preference: system`；A：`data-ds-theme-source="system"`（16:03:48） | 该条**已过时**；以实测为准，并列为「方法论红线」见 §5.1 |
| 12 | `<html>` 行内 `color-scheme` 的作者 | S1 初版按「官方注入的是 `<style>` 不是行内」**推断**为第三方 | B：`boot-theme.ts:31,33` 证实官方只写 `dataset` 与 **body** 行内字体号，官方无任何 `<html>` 行内写入 | 推断升级为**源码证实**；第三方归属不变，但「是哪个插件」仍未定位（§14-3） |
| 13 | `data-ds-theme-source` 挂在哪个元素 | S1 初版：`<body data-ds-theme-source="system">`，count=1（16:03:48 的 body 属性普查） | A 16:19:10 同一次 evaluate 两处并读：`sourceHtml=system` / `sourceBody=None`；B：`boot-theme.ts:31` 写 `documentElement.dataset` | **初版误记**（把 `<html>` 的属性记到 body 名下），已改 §5。body 上官方只写 `data-ds-dark-theme`（`:32`） |
| 14 | 「哪些令牌被 html/:root 主体消费」的判据 | 我的同一脚本按「**第一个**复合选择器」算出 `refsWithRootSUBJECT=17`、2 个 only-root 令牌（`--lc-i`、`--dsw-static-blue-400`） | 改成 CSS 定义的「**最后一个**复合选择器」后：`3` 条、2 个令牌、**only-root = 0** | 前一组是**假阳性**（`html[…] body :focus-visible` 这类写法）。§6.2 原本用的就是正确判据，两处不冲突 |

---

## 12. 别重做的坑

1. **`Select-Object -First N` 会掐死上游原生命令**。A：`dsh plugin --profile desktop list 2>&1 | Select-Object -First 3` → `EXIT=1`，而全量消费时 `EXIT=0`。**这是我自己的测量伪影，不是 CLI 失败。** 处理原生命令输出时要么全量消费，要么先落文件再截。
2. **`dsh plugin --profile desktop exec <anything>` 会在 profile 目录里触发 pnpm 锁文件校验/安装流程。** A（2026-10-05T16:00:13）：输出 `Verifying lockfile against supply-chain policies (348 entries)...` + `Progress: resolved 84, reused 2, downloaded 0, added 0`。S1 明确禁止改动 profile，这是操作失误。
   **事后核对无损伤**：`package.json` 2540 B / 15:14:02、`pnpm-lock.yaml` 117,166 B / 15:14:01、`cordis.patch.yml` 23,285 B / 15:44:38、`node_modules\.modules.yaml` 15:14:02 —— 均早于该次操作；`list` 复测 EXIT=0 / 27 packages；近 4 分钟唯一新增是 `.plugin-manager\logs\operation-*` 目录（每次调用都会产生）。
   → **S5 之前不要碰 `exec`。**
3. **不要手工翻 `data-ds-dark-theme` 取暗色真值**。A：手工翻出的态 `html color-scheme` 仍是 `light`、`--dsh-boot-bg` 仍是 `#fff`（case C）。正确做法是让浏览器 context 的 `color_scheme` 驱动官方 boot 链（case A），见 §13。
4. **不要用 `rule.style[i]` 索引枚举建引用图**。A：会让 `@supports` 块内的属性（如 `corner-shape`）凭空消失，refs 从 527 掉到 272/370。必须解析 `rule.style.cssText`。
5. **`open_page` 不要每次 `sync_playwright().start()`**。A：第二个 mode 会报 `Error: It looks like you are using Playwright Sync API inside the asyncio loop. Please use the Async API instead.` → 应单 driver、每 mode 一个 `browser.new_context`。
6. **不要用 CSS Modules 哈希类名做选择器**（`BynINW_frame`、`Dc7zOa_root`、`nArs4W_paneCard`、`RlGAzG_input` 等在实测输出里大量出现，随时会随构建变化）。用 §9 的官方 `data-*`。
7. **`--dsh-boot-*` 家族属于 boot 屏自己的作用域**（声明在 `._boot_u7vgf_3`），body 层到不了；不要把它当成「paint 层候选」之外的一般令牌处理。
8. **`color_scheme` 式探针只在 `ui-theme.preference === 'system'` 时有效**（§5.1，B `boot-theme.ts:27`）。
   **不要靠读属性来守门**：`data-ds-theme-source` 写在 `<html>` 上（`boot-theme.ts:31`），从 `<body>` 读会得到 `None` 并**误报**「偏好不是 system」（2026-10-05T16:17 的 `probe-consumers.py` 首跑就这么误报过一次）。
   正确做法是**直接断言渲染结果**：`html` 的 `color-scheme`、body 是否有 `data-ds-dark-theme`、`--dsh-boot-bg` 三值同时符合所请求那一档（判据真源 = `tools\probe_consumers_defs.py` 的 `EXPECTED`）。这比读偏好属性更硬，因为它测的是「取到的色到底属于哪一档」。**这是本文档所有明暗结论的前提条件。**
9. **绝不调用 `theme.setTheme()`**。B + 交接文件 `DSH-外观主题.md:110`：它会把外观偏好**持久化写进 profile 的 `cordis.patch.yml`**，直接违反 P0「S1 不改主题配置」以及本任务「不污染 profile」的底线。皮肤包只需要 `overrideTokens`（纯运行时层，有 disposer），不需要 `setTheme`。
10. **「上一棒」的结论要连同它的前提一起读**。本段第 8 条的教训来自 `DSH-外观主题.md:118`：那条「`color_scheme` 无效」当时是对的，因为当时 `preference: light`。**抄结论不抄前提，就会抄到一条已经失效的规则。**
11. **本机已装的 `dsh-theme-studio` 不污染本报告基线**——它把覆盖存在 localStorage 并写 body 行内，而我的探针一律用**全新 context**（无 localStorage 继承）。A：baseline 中 body 行内自定义属性**只有 `--dsh-content-font-size` 一个**，若 studio 有生效覆盖则必然多出若干条。**但用户在真实窗口里的覆盖情况，探针看不到，需另问。**
12. **不要用「假 `<body>`」去测以 body/html 为主体的规则**。A（16:20:31 首跑 vs 16:22:20 修正）：`probe-rule-fire.py` 第一版对选择器 `body, body *` 调 `document.createElement('body')` —— `el.matches('body')` 返回 **true**，看起来完全正常，但 Chromium **不渲染嵌套的 body**，其 computed 值不重算，于是哨兵「不生效」，`--dsw-elevation-stroke-color` 被误判成 `ruleFired=0`；而同一时刻读**真 body** 的 `probe-consumers.py` 得到 `changed=True`。**修法：主体是 `body`/`html`/`:root` 的规则一律读真实根元素，不合成。** 教训：合成一个「看起来匹配」的元素，和「这个元素真的参与渲染」是两回事。
13. **判断「规则主体」要看最右的复合选择器**（§11-14）。先把 `[...]` 与 `(...)` 剥掉，再按 `[\s>+~]` 切分，取**最后一个** token 判断是否 `html`/`:root`。用最左的会把 `html[data-input-modality='pointer'] body :focus-visible` 误判成 html 主体（同一脚本因此从 17 条虚高）。
14. **`probe-rule-fire.py` 的结论是「规则接好了」，不是「应用渲染了它」**。它是合成元素测试。任何「某令牌当前可见生效」的断言必须拿 `probe-consumers.py` 的**真实命中数**做，二者不可互相顶替。

---

## 13. 探针清单与复跑方法

所有探针在 `<plugins>\Cyberpunk-Theme\tools\`，输出在 `<plugins>\Cyberpunk-Theme\out\`。

| 文件 | 用途 | 解释器 | 产物 |
|---|---|---|---|
| `probe_baseline_lib.py` | 共享库：会话 cookie（密钥来自 `DSH_SESSION_SECRET`，缺省则不注入）、`open_page(mode)`（用 `color_scheme` 驱动官方 boot 链） | 被 import | — |
| `probe-baseline.py` | 基线：856 节点、body/html 自定义属性、行内变量、59 个 data-* 属性、4 个候选的初步可达性 | Python314 | `out\baseline.json` (+ `shot-light/dark.png`) |
| `probe-mode.py` | A/B/C 三态明暗对照；CSSOM 引用图（cssText 解析）；sheet 归属 | Python314 | `out\mode-probe.json`、`out\cssom-refs.json`、`shot-A/B/C.png` |
| `probe-reach.py` | body 内联哨兵法：112 组（令牌 × 明暗 × 模态）消费者生效测试 | Python314 | `out\reach.json` |
| `probe-cssom-facts.py` | 定点事实：`CSS.supports`、`@supports` 块原文、`<html>` 行内变量、sheet 可读性 | Python314 | `out\cssom-facts.json` |
| `inspect-scope.py` | 判定每条引用规则的主体是否落在 `html`/`:root`（→ 回答「哪些令牌 body 层到不了」） | DSH runtime Python | `out\scope.json` |
| `inspect-refs.py` | 逐令牌打印 引用明细 / 声明位置 / 「只声明在 `:root`/html 作用域」清单 | DSH runtime Python | 读 `out\cssom-refs.json` |
| `probe_consumers_defs.py` | **补测三脚本共享的令牌/哨兵/faithful 判据真源**（要改令牌清单只改这里，避免两个探针漂移） | 被 import | — |
| `probe-consumers.py` | 消费者元素在不在：逐条消费者选择器在活文档里数命中数（`matches`/`matchesLoose`）+ 定点哨兵 + 自定义属性链追溯（深度 3） | Python314 | `out\consumers.json` |
| `probe-rule-fire.py` | 规则活不活：为每条消费者规则合成它要的元素，测 `ruleApplicable`/`ruleFired` | Python314 | `out\rule-fire.json` |
| `probe-boot-bg-fallback.py` | `--dsh-boot-bg` 的值究竟由哪个 `var()` 槽供给（P0 paint 候选的关键判据） | Python314 | `out\boot-bg-fallback.json` |
| `probe-runtime-state.py` | **任意时刻回答「现在这个运行时是不是官方默认」**：html/body 完整行内样式、全部样式表身份、主题插件指纹扫描、html+body 全部自定义属性的名与值（可 diff） | Python314 | `out\runtime-state.json` |

**复跑顺序**（`$py314` = 系统 Python，`$pyr` = DSH runtime Python）：
```
$py314 tools\probe-baseline.py
$py314 tools\probe-mode.py            # 生成 out\cssom-refs.json，后续两个脚本依赖它
$py314 tools\probe-cssom-facts.py
$py314 tools\probe-reach.py light dark   # 约 6 分钟
$pyr   tools\inspect-scope.py
$pyr   tools\inspect-refs.py
$py314 tools\probe-consumers.py light dark      # 依赖 out\cssom-refs.json
$py314 tools\probe-rule-fire.py light dark      # 依赖 out\cssom-refs.json
$py314 tools\probe-boot-bg-fallback.py light dark
$py314 tools\probe-runtime-state.py light dark       # 随时回答「现在是不是官方默认」
```
**取暗色真值的唯一正确姿势**（写进 `probe_baseline_lib.open_page`）：
`browser.new_context(viewport={1600,1000}, color_scheme=mode)` → `context.add_cookies(session_cookie())` → `goto` → `wait_for_selector("#root")` → settle，**全程不碰 `data-ds-dark-theme`**。

---

## 14. 未决事项（S1 没有测出结论的，不许在 S2 当默认值用）

1. **`themedColor:134 / derivedColor:86 / nonColor:212` 的出处与定义**——本机无法复现，需要用户指出原始报告/面板，或改由 S2 重新定义「可覆盖颜色集合」的判据。
2. **`489` 与 `491` 差 2 的具体令牌**——`--scu-*` 已确认是第三方状态相关，剩余 2 个未逐一判定。
3. ~~**`<html>` 行内 `color-scheme` 是哪个插件写的**~~ → **已决（2026-10-05T16:31，A+B，§15）**：**是官方写的** —— `packages/client/ui-layout/src/client/theme-presenter.ts:55` 的 `document.documentElement.style.colorScheme = scheme`（`ui-layout/tests/theme-presenter.client.spec.ts:50,59,63,105` 覆盖 light/dark/清除三态）。S1 判断「不是官方 **boot** 注入」没错，但**不该推到「第三方插件」**：官方 ui-layout 的 presenter 也写它。实测随档变化（light→`color-scheme: light`、dark→`color-scheme: dark`），不干扰明暗对照取证。
4. ~~**`--dsw-alias-bg-overlay`、`--dsw-alias-button-primary-fill`、`--dsw-alias-state-error/success/warn-primary`、`--dsw-elevation-stroke-color`、`--dsw-shadow-lv1`、`--dsw-mask-blur` 在本次 UI 状态下 `changed=0`**——「无消费者」还是「当前状态没触发」未逐个判定。~~ → **已决（2026-10-05T16:19–16:22，§7.1）**：14 个逐个判定完毕 —— **2 个当前就活着**（`--dsw-menu-surface-fill`、`--dsw-elevation-stroke-color`）、**10 个状态门控**（规则实测全部会 fire）、**1 个值不由它供给**（`--dsh-boot-bg`）、**1 个本文档内真无消费者**（`--dsw-desktop-window-tint`）。**没有任何一个是「无消费者」。**
5. **`--dsw-alias-bg-layer-2` 命中 0 但有 1 个元素受影响**——派生链未追。
6. **`profile.ts:742` 的版本豁免（`readProfileVersionExemptions`）在 S5 装载时是否会被触发**——只在 `bundles` 非空时读取，本次未测。
7. ~~**只做单套主题时，另一档「显式重复官方语义值」是否违反 P0 令牌纪律**~~ → **已决（2026-10-05T16:12，用户拍板）：明暗双套都做。**
   官方接口 `ThemeTokenModes { light: string; dark: string }`（`ui-theme/src/client/index.ts:56-61`）两档必填，与 P0 §1.6「没改的令牌不许重新声明」在单套主题下必然顶牛。用户选择**双套**，于是**每个被覆盖的令牌都由我给出两个真正设计过的值**，不存在「抄官方当前值」的格子，**该张力按构造消失**。连带约束（S2 起生效）：
   - **不再有透传档**——light 与 dark 都必须是有意设计的结果，不接受「亮了但没设计」；
   - 未覆盖的令牌在两档下都继续走官方值（这条不受影响，仍是 P0 §1.8 的要求）；
   - 验收标准相应提高：两档都要过视觉验收，亮色不是「顺带的」。
8. ~~**`<html>` 行内 `color-scheme` 的写入方**~~ → **与第 3 条同案，已决（2026-10-05T16:31，§15）**：官方 `ui-layout/src/client/theme-presenter.ts:55`，**不是常驻第三方插件**，不干扰 S4/S6 的明暗对照取证。
9. ~~**用户在真实窗口里是否已有 `dsh-theme-studio` 的配色覆盖**（§12-11）~~ → **已决（2026-10-05T16:31–16:33，A，§15）：没有**。用户报告「已把所有主题相关插件停用」；实测三条独立证据一致 —— `out\runtime-state.json` 与 S1 的 `out\baseline.json` 逐条比对**亮色 498/498 一致、暗色 497/498 一致**（唯一差异 `--dsh-boot-bg` 是 S1 那份混合态快照的已知伪影）；55 张含标记的样式表里**无 `valley`/`endfield`/`starwake`/`studio`/`scu-grad`/`lc-` 任何标记**；`shot-light.png` 目视无覆盖层。结构原因见 §15.2：三个主题包只在 `dependencies`、**不在 `dsh.profile.bundles`** ⇒ 根本不挂载。

---

## 15. 运行时状态复核（2026-10-05T16:31–16:33）——主题插件会不会污染 S1 基线

**起因**：用户在 2026-10-05T16:2x 报告「已经把跟主题相关的插件都停用了」。若停用发生在 S1 探针（15:50–16:27）**之后**，则 S1 测到的「官方默认」可能混着主题插件的输出，S1 的令牌与杠杆数字全部要重测。本节实测判定。

### 15.1 结论：**S1 基线未被污染；当前运行时就是官方默认**

三条独立证据全部指向同一结论：

| 证据 | 方法 | 等级 | 读数 |
|---|---|---|---|
| **令牌面逐条比对** | 新探针 `probe-runtime-state.py`（A 16:31:28）vs S1 的 `out\baseline.json`（15:50:55） | A | **亮色 498/498 完全一致；暗色 497/498 一致**。唯一差异 `--dsh-boot-bg`（S1 `#fff` → 今 `#151517`）——而这一条正是 §7.1 证实的「明暗分档唯一判别符」，即 **S1 那份暗色快照自身是混合态伪影**，不是插件污染 |
| **插件指纹扫描** | 逐张扫 55 张含标记的样式表，找 `valley`/`endfield`/`starwake`/`studio`/`scu-grad`/`lc-` | A | **0 命中**（只匹配到与主题无关的通用 `--ds-` 前缀） |
| **目视** | `out\shot-light.png`（15:50:50，1600×1000） | A | 官方默认亮色界面：白底、侧栏、hero 区。**无 palette、无水印、无 canvas 轮廓动画** |

行内写入面两态完全一致：`<html>` 行内 **2** 条 = `color-scheme` + `--dsh-sidebar-height`；`<body>` 行内 **1** 条 = `--dsh-content-font-size`（官方字体大小）。`html` 自定义属性 **71**、`body` **498**、样式表 **233** 张、`adoptedStyleSheets` **0** —— 与 S1 记录的数字逐项相同。

### 15.2 结构原因：那三个主题包根本不会挂载

`<DSH_HOME>\profiles\desktop\`（A 16:33:10）：

- `node_modules\` 里**确实存在**三个主题包，且都是 `link:` 到本地目录：`dsh-skin-studio`（08:15:30）、`dsh-theme-starwake`（12:20:33）、`dsh-theme-studio`（00:26:18）。`dependencies` 共 28 项，其中：
  `dsh-skin-studio = link:<plugins>\dsh-skin-studio`、`dsh-theme-starwake = link:<plugins>\dsh-theme-starwake`、`dsh-theme-studio = link:<plugins>\theme-work/studio`。
- 但 `dsh.profile.bundles` 共 **29** 条，**没有任何一条名称含 theme / skin / endfield / starwake**。
- 而 `cordis.yml`（223 B）自己写明组合顺序：「each bundle in package.json's `dsh.profile.bundles`, then `cordis.patch.yml`, then any `--patch` overlays」。

→ **只进 `dependencies`、不进 `bundles` ⇒ 不参与挂载。** S1 §4(c) 已由源码（`profile.ts:739,743,748-750`）证实这条；**现在它有了活的旁证**：三个已安装的主题包在运行时留下的是**零足迹**（15.1 三条证据）。这也顺带说明用户「停用」这些插件为何测不出任何变化 —— 它们本来就没挂载。

- 另：`cordis.patch.yml:172-193` 有一条 `theme-endfield` 条目（`palette: valley`、`glass: standard`、`radius: round`、`enabled: "1"`、`contour: "1"`），但 **`node_modules\dsh-theme-endfield` 不存在**（`Test-Path = False`），`dependencies` 里也没有 → **该条目指向一个未安装的包，从未生效**。S2/S4 **不要**把它当成「已启用的主题」来推理，也不要因为它的 `radius: round` 而假设圆角已被改过。
- `cordis.patch.yml:700-701` 的 `theme-starwake: disabled: true` 属实，但同上：它不在 bundles，禁用与否都不影响渲染。

### 15.3 一处必须点名的未解释差异（不抹平）

`cordis.patch.yml` 的 mtime 是 **2026-10-05 16:20:28**（23,282 B），**落在我 S1 补测窗口内**（16:19:10–16:23:49）；S1 早期记录为 23,285 B / 15:44:38 → **该文件在测量期间被重写过，净减 3 字节**。我全程只**读**它，未调用任何写 profile 的接口（尤其没有 `theme.setTheme()`，见 §12-9），**无法归因**。

可界定的是：**这次改写没有改变任何观测量** —— 15.1 的 498/498 逐条比对横跨了它（15:57 与 16:31 两侧）。如需确证，请用户说明 16:20 前后的操作。

### 15.4 本节新增探针

`tools\probe-runtime-state.py`（系统 Python 3.14，产物 `out\runtime-state.json`）：只读捕获 `<html>`/`<body>` 的完整行内样式、全部样式表身份与规则数、主题插件指纹扫描、以及 html/body 上全部自定义属性的**名与值** —— 专门用来在任意时刻回答「现在这个运行时到底是不是官方默认」，可复跑、可 diff。

---

## 16. 复验：profile 被大幅改动之后，基线依然成立（2026-10-05 19:16–19:18）

**触发**：S2 收尾复验时发现 profile 在 17:58–19:12 被外部大幅改写 —— `cordis.patch.yml` 23,282 B → **1,811 B**（−92%）、`package.json` 2,540 B → 2,721 B、`pnpm-lock.yaml` 117,166 B → 116,428 B，且 `dsh.profile.bundles` 一度从 **29 涨到 33**（新增的正是 `dsh-skin-studio` / `dsh-theme-starwake` / `dsh-theme-studio`）。用户随后说明**已把主题插件全部卸载**，授权重验。

**复验动作**（全部只读，旧产物先另存为 `*.S1-<HHmm>.json` 再重取）：
1. `tools\probe-runtime-state.py light dark` → `out\runtime-state.json`
2. `tools\probe-baseline.py` → `out\baseline.json`

**结果：基线逐条一致，结论不变。**

| 对比项 | S1 (15:50 / 16:31) | 复验 (19:16 / 19:18) | 差异 |
|---|---|---|---|
| `light.bodyComputed` | 498 | 498 | **0 增 / 0 删 / 0 变** |
| `dark.bodyComputed` | 498 | 498 | **0 增 / 0 删 / 0 变** |
| `light/dark.htmlComputed` | 71 | 71 | **0 / 0 / 0** |
| `bodyInline` / `htmlInline` / `dataAttrs` | — | — | **完全一致** |
| `bodyVars`（runtime-state 口径） | 498 | 498 | **0 增 / 0 删 / 0 变** |
| `htmlVars` | 71 | 71 | 无变化 |
| 样式表原始条数 | 233 | 236 | +3（见下） |

**主题插件指纹：两次读数都是 0。** 扫描 `valley` / `endfield` / `starwake` / `studio` 四个指纹，**S1 与复验在两种模式下都命中 0 张表**。命中的只有 `--ds-`（52 张，**官方前缀**，`base.css` 就定义了 `--ds-font-family-code` 等）、`lc-`（16 张，第三方）、`scu-grad`（1 张，`dsh-session-colorful-unread-pin-jobs`）——这三个在两次读数里**数量完全相同**，且都不是主题插件。

**样式表 +3 的解释（可界定，非令牌层面）**：按「href + ownerId + ownerAttrs」去重后两次都是 **169 个唯一身份**，唯一一处差异是某个 ant-design 的 CSS-in-JS 表换了 `data-css-hash`（`18nyf7y`）。即 +3 是同一批注入样式的重复条目，**没有任何令牌值随之改变**（见上表 498/498）。

**顺带确证的一条方法论前提**：`html` 上的 `data-ds-theme-source=**system**`（`boot-theme.ts:31` 写入），且 `color_scheme=light/dark` 两种抓取都拿到了正确的 `color-scheme` 与 `data-ds-dark-theme` 组合 —— 即**明暗抓取方法在复验时刻依然有效**（该方法的前提是 `ui-theme.preference === 'system'`，见 §12-1；新的 patch 层里已经没有 `ui-theme` 条目，实际值取自运行时而非文件）。

**结论**：`out\baseline.json`、`out\s2-token-baseline.json`、`out\s2-refcount.json`、`out\cssom-refs.json` 与 `docs\` 全部四份文档**继续有效，无需重新推导**。profile 的那一轮改动（含把三个主题包短时挂载又卸载）**在渲染后的运行时里没有留下任何痕迹**。

**同期发现的残留（未处理，等指示）**：profile 的 `node_modules\` 下仍有三个 **junction**，指向 `<plugins>\dsh-theme-starwake`、`<plugins>\theme-work\studio`、`<plugins>\dsh-skin-studio`。它们已不在 `dependencies`（25 条）也不在 `dsh.profile.bundles`（30 条）里，**不会被加载**；删除只需 `cmd /c rmdir "<junction>"`（**绝不递归**，否则会删到目标源目录）。本次未动。

