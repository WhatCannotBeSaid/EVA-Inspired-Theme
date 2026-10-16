# EVA 主题第七轮性能报告：JS 输入的版面空白（2026-10-16）

对象：`C:\Yu\EVA-Inspired-Theme`（DSH 客户端主题，v1.0.0）
目标：**在不改变任何现有视觉样式的前提下**降低加载与解析开销。
结论：**零像素变化**，四道门禁全绿（123 项）。本轮做掉的是第六轮报告 §7.2 留下的**下一轮首选候选**——三个行为 JS 文件的行首缩进，并把同一处理推进到两件供应商件的 factory 主体（只去缩进、不删注释）。
bundle **764,027 → 738,541 字符（−25,486，−3.34%）**；同一批输入交给引擎的文本 **−25,486 字符**，其中 **22,830 是行首缩进、2,962 是 CRLF**。
前序：[perf-report-2026-10-11.md](perf-report-2026-10-11.md)（第一轮，查询放大链）、[perf-report-2-2026-10-11.md](perf-report-2-2026-10-11.md)（第二/三轮，玻璃链与 `:has()` 收窄）、[perf-report-3-2026-10-15.md](perf-report-3-2026-10-15.md)（第五轮，付费字节的剥离）、[perf-report-4-2026-10-16.md](perf-report-4-2026-10-16.md)（第六轮，挂载半的注释）。

---

## 一、结论先行

1. **本轮的改动是上一轮点名的那一项。** 第六轮报告 §7.2 写「三个行为文件的行首缩进 15,822 字符，下一轮首选，未做」。本轮不止做掉那 15,822，而是把「版面空白不是语法」这条论证推到全部五个 JS 输入：三个行为文件 **15,822**（`src/client.js` 10,129 ＋ `src/boot-screen.js` 1,531 ＋ `src/model-effort-picker.js` 4,162）＋ 两件供应商 factory 主体 **7,008**（`build/plugin-toggle.js` 4,246 ＋ `build/session-eva-status.js` 2,762）＝ **22,830 字符的缩进**，另加 **2,962 个 CR**。

2. **它同时修掉一个可复现性缺陷，这不是顺带、是必须记的。** `src/client.js` 在本机是 CRLF 检出（git 里是 LF，`core.autocrlf=true`），而第六轮的构建**不做 CR 归一**。于是**同一份提交**，只因为文件落到磁盘时换行不同，会产出**两个不同的 bundle、两个不同的 boot mark**：

   | 构建脚本 | `src/client.js` 为 CRLF | `src/client.js` 为 LF | 同一提交 |
   |---|---|---|---|
   | 第六轮（改前） | 764,027 字符 / boot `e3e7863b` | 762,866 字符 / boot `8072405e` | **不同（差 1,161 字符）** |
   | 第七轮（改后） | 738,541 字符 / boot `5ada26ef` | 738,541 字符 / boot `5ada26ef` | **相同** |

   1,161 恰好等于第六轮回剥后仍留在文本里的 CR 数（下面 §3.2 有逐项对账）。**这是实测出来的两个构建，不是推断。**

3. **等价性是四层证明，不是一句声明。** 运行时 `<style>` 文本 599,765 字符**逐字节相同**（→ CSSOM 相同 → 计算样式相同 → 不可能有像素差）；代码 token **24,207 个全等**（类型、行号、字面值）；**24,206 对相邻 token 之间的换行数 0 处不同**（→ 自动分号插入不可能改变语句边界）；**1,745 个字面量的 cooked 值 0 处不同**。只有注释文本变了，而注释无运行时效果。

4. **性能收益如实分层，不夸大。**
   - **行为区 JS 的编译**：8 次配对测量，中位 **−17.5%**（区间 −14.3% … −23.3%）；6 次合并 **309/360 = 85.8% 的配对轮次更快**，单侧符号检验 **p = 1.87e-46**；最差单次 44/60＝73.3%，p = 1.97e-4。**这条是确证的。**
   - **整包编译**：6 次 **185/360 = 51.4%**，p = 0.318——**等于抛硬币，本轮不做任何声称**。原因是 576,543 字符的壁纸常量占了整包的 **78.1%**，把 25,486 的收益稀释到噪声里。诚实的说法是「整包层面测不出」，而不是「整包也快了」。

5. **供应商件的注释仍然随包发送，这是选择不是疏漏。** 两件供应商件的 factory 主体**只过 `normaliseJs`（去缩进、归 CR），不过 `stripBlockComments`**。删第三方源码里的注释会删掉它「可被人工审阅」的部分（D29 的立意），而去缩进不删任何一段可读文本。它们的注释质量（`build/plugin-toggle.js` 7,633 ＋ `build/session-eva-status.js` 5,129 ＝ 12,762 字符）因此仍然在包里——这是本轮**主动保留**的最大一块。

6. **本轮的改动范围**：`tools/build-client.mjs`（4 个插值点 ＋ 新变换）与 `tools/selfcheck.mjs`（本轮**新增两段共 140 行**，其余是对既有行的改写，见 §4.4）。`src/`、`build/` 下的**输入文件一个字节未改**。

---

## 二、插件的文件结构与加载方式

### 2.1 构建链

`tools/build-client.mjs` 是一个单文件构建脚本，读 6 个输入、产出一个 `client.js`：

| 角色 | 输入 | 本轮的变换 |
|---|---|---|
| 挂载半 | `src/client.js` | `compressJs`（注释 ＋ 版面空白） |
| 启动幕布 | `src/boot-screen.js` | `compressJs` |
| 模型档位选择器 | `src/model-effort-picker.js` | `compressJs` |
| 启动幕布样式 | `src/boot-screen.css` | `minifyCss(stripBlockComments(...))`（第五轮起） |
| 选择器样式 | `src/model-effort-picker.css` | 同上 |
| 绘制层 | `src/theme.css` | 同上 |
| 供应商件 A | `build/plugin-toggle.js` | 主体只过 `normaliseJs` |
| 供应商件 B | `build/session-eva-status.js` | 主体只过 `normaliseJs` |

本轮的三个变换定义在 `tools/build-client.mjs:184-234`：

```js
/* P5e (2026-10-16, performance round 7): the JS inputs lose their layout whitespace. ... */
const normaliseJs = (text) => text
  .replace(/\r\n?/g, '\n')
  .replace(/^[ \t]+/gm, '')

const compressJs = (text) => normaliseJs(stripBlockComments(text))
```

两个入口，差别是刻意的：`normaliseJs` 只做版面空白，`compressJs` 是注释 ＋ 版面空白。主题自己的四个 JS 文件走 `compressJs`；两件供应商 factory 主体**只走 `normaliseJs`**。

### 2.2 运行时：一个样式标签，四段拼接

`src/client.js:558-568` 创建**唯一一个** `<style>` 元素，其 `textContent` 是四段拼接：

```
shortenDataUrls(WALLPAPER_DECLARATIONS, blobUrls) + '\n' + CSS + '\n' + BOOT_CSS + '\n' + PICKER_CSS
```

本轮**没有触碰这四段中的任何一段**——这正是等价性证明可以只做一层的原因（§5.4）。

### 2.3 为什么 JS 的版面空白是「付费字节」

一个 DSH 客户端插件以 `immediately: true` 装载，整个 `client.js` 作为一个模块工厂**每次加载都被编译**。编译发生在解析层：行首缩进是解析器跳过、运行时永不读取的字节，但**它仍然要走词法与语法扫描**。它也是本轮之前**唯一一块既没有契约保护、又没有论证障碍**的纯文本存量——注释在第五、六轮已经处理完，`src/client.js` 99 条注释一条不剩。

### 2.4 加载方式

桌面 profile 用软链引用本仓库：`~/.dsh/profiles/desktop/package.json` 的 `"eva-inspired-theme": "link:C:/Yu/EVA-Inspired-Theme"`，`node_modules/eva-inspired-theme` 是指向本仓库的目录链接。**重新构建后下一次加载即生效，无需重装。** 产物 `client.js` 在 `.gitignore` 内，不进版本库。

---

## 三、瓶颈清单

### 3.1 清单表

| # | 位置 | 问题 | 严重度 | 优化手段 | 预估收益 | 本轮 |
|---|---|---|---|---|---|---|
| 1 | `src/client.js` 全文 | 1,767 行 CRLF ＋ 10,129 字符行首缩进随包发送、每次加载被编译 | **高** | `normaliseJs`：CRLF→LF、丢行首 `[ \t]+` | 11,290 字符 | ✅ 已做 |
| 2 | `src/boot-screen.js` | 1,531 字符行首缩进 | 中 | 同上 | 1,531 | ✅ 已做 |
| 3 | `src/model-effort-picker.js` | 4,162 字符行首缩进 | 中 | 同上 | 4,162 | ✅ 已做 |
| 4 | `build/plugin-toggle.js` factory 主体 | 4,246 缩进 ＋ 1,366 CR 随包发送 | 中 | 主体过 `normaliseJs`（**注释保留**） | 5,612 | ✅ 已做 |
| 5 | `build/session-eva-status.js` factory 主体 | 2,762 缩进 ＋ 435 CR | 中 | 同上 | 3,197 | ✅ 已做 |
| 6 | `tools/build-client.mjs` 构建产物 | **同一提交因检出换行产出两个不同 bundle**（可复现性缺陷） | **高** | `normaliseJs` 第一步归 CR | 1,161 / 构建确定性 | ✅ 已做 |
| 7 | 两件供应商件的注释 12,762 字符 | 随包发送、被编译 | 低→**不做** | 若剥离需销毁「可人工审阅」契约（D29） | 净 ~12,762 | ⛔ 未做，见 §7.2 |
| 8 | `build/plugin-toggle.js` 全文 | 3 行构建自产 banner ＋ 供应商来源标记 | 低→**不做** | `cli.19`/`cli.23` 钉住该标记 | ~5,422 | ⛔ 未做，见 §7.2 |
| 9 | 三处同选择器拆开声明（`body`、品牌按钮、设置按钮） | 规则可合并但**零收益** | 极低 | 合并后字节数不变、选择器匹配数不变 | ≈0 | ⛔ 未做，见 §7.4 |
| 10 | 5 组相同声明体 | 可合并成一条 | 极低→**危险** | 合并会**改变层叠胜出者** | 负 | ⛔ 正确拦下，见 §7.5 |
| 11 | `src/theme.css:694` 重复的 `backdrop-filter` | 同一条规则里声明两次 | — | **故意的渐进增强**，`glass.2` 钉住 | — | ⛔ 不是问题，见 §7.6 |
| 12 | 三个样式表的注释 | 已被第五/六轮剥净 | — | — | 0 | ✅ 前轮已做 |
| 13 | 动画属性 / `will-change` / 阻塞脚本 / 资源压缩 | 无对象可优化 | — | — | 0 | ⛔ 无对象，见 §7.1、§7.3、§7.7 |

### 3.2 排序后的收益与逐项对账

按**字符收益 × 确切性**排序，全部数字来自 `C:\Work\scratch\eva-perf7\cause13.mjs` 一次运行：

| 区域 | Δ 合计 | 正文 | CR | 缩进 | 包装文本 |
|---|---|---|---|---|---|
| `src/client.js` | −11,290 | −11,290 | 1,161 | 10,129 | 0 |
| `src/boot-screen.js` | −1,531 | −1,531 | 0 | 1,531 | 0 |
| `src/model-effort-picker.js` | −4,162 | −4,162 | 0 | 4,162 | 0 |
| `build/plugin-toggle.js`（主体） | −5,422 | −5,612 | 1,366 | 4,246 | +190 |
| `build/session-eva-status.js`（主体） | −3,081 | −3,197 | 435 | 2,762 | +116 |
| **合计** | **−25,486** | **−25,792** | **2,962** | **22,830** | **+306** |

**对账闭合**：`−25,792 ＋ 306 = −25,486`，与实测 bundle 差完全一致。正的 306 是**本轮往两件供应商件的包装注释里加的 P5e 说明文字**——它落在包里（包装是构建脚本的字符串字面量），所以必须作为负收益计入，不能藏起来。

**缩进的独立复核**：`src/client.js` 磁盘上共 15,672 缩进字符、1,767 个 CRLF，而本轮只拿走 10,129 / 1,161。差额恰是**块注释内部**的缩进与 CR——它们已在第六轮被 `stripBlockComments` 连同注释一起删掉（该函数把注释替换成它自己的换行）。直接量出来：

```
CRLF   : 文件 1767  注释内 606  留给本轮 1161   （cause split 说 1161）✓
indent : 文件 15672 注释内 5543 留给本轮 10129  （cause split 说 10129）✓
```

**两栏都严丝合缝，没有残差**：第六轮拿走的 6,149 与第七轮拿走的 11,290 之和恰好等于文件总体积里的 17,439（缩进 ＋ CR），两轮的账互不重叠、可独立复算。三个主题文件的缩进合计复核也一致：`10,129 ＋ 1,531 ＋ 4,162 ＝ 15,822`，正是第六轮报告 §7.2 点名留给下一轮的那个数字。

**五个区域的缩进加总复核**：10,129 ＋ 1,531 ＋ 4,162 ＋ 4,246 ＋ 2,762 ＝ **22,830** ✓
**CR 加总复核**：1,161 ＋ 0 ＋ 0 ＋ 1,366 ＋ 435 ＝ **2,962** ✓

---

## 四、关键改动前后对比

### 4.1 变换函数：新增两个入口（`tools/build-client.mjs:184-234`）

```js
/* P5e (2026-10-16, performance round 7): the JS inputs lose their layout whitespace.
 * ...
 * What it does, in this order, and why that order:
 *   1. CRLF and lone CR become LF. `src/client.js` is checked out CRLF ...
 *   2. leading horizontal whitespace is dropped from every line.
 *
 * Why this cannot change what the code DOES: it removes no newline, so every line boundary
 * and every line number stays exactly where it was — which is what automatic semicolon
 * insertion reads. And it removes no character from inside any string, template or regex ...
 *
 * Two entry points, and the difference is deliberate. */
const normaliseJs = (text) => text
  .replace(/\r\n?/g, '\n')     // 归一换行：同一提交在两种检出下产同一份产物
  .replace(/^[ \t]+/gm, '')    // 只删行首水平空白；不删任何换行，行号与行边界不动

const compressJs = (text) => normaliseJs(stripBlockComments(text))
```

**为什么等价**：
- `\r\n?` → `\n`：JS 文法里 CR 与 CRLF 都是行终止符，与 LF 同义。行**数**不变（多行换行序列本就算一个终止符），行**边界**位置不变。
- `^[ \t]+` → `''`（`m` 标志）：行首水平空白在词法上不属于任何 token。**关键前提**是「没有一行的缩进起点落在字符串、模板或正则内部」——这一条由 §5.1 的逐 token 比对直接证伪不了，且由 `cli.21b` 每次运行重证。
- **不删换行**是刻意的：`\n` 是自动分号插入的输入，删它会改变语句边界。§5.3 用 24,206 对相邻 token 的换行数差异为 0 来钉死这一点。

### 4.2 模板：四个插值点（`tools/build-client.mjs:723-732`）

```diff
     var PICKER_CSS = ${JSON.stringify(minifyCss(stripBlockComments(pickerCss)))}
-${stripBlockComments(bootJs)}
-${stripBlockComments(pickerJs)}
+${compressJs(bootJs)}
+${compressJs(pickerJs)}
 ${pluginToggleJs}
 ${sessionEvaStatusJs}
-${stripBlockComments(clientJs)}
+${compressJs(clientJs)}
```

三处从「只去注释」升级为「去注释 ＋ 去版面空白」。**同一个洞、同一个位置**，变化只在作用于它的那个函数上——所以第五/六轮建立的全部等价性论证可以直接复用，只是作用域从「注释」扩到「注释 ＋ 版面空白」。

`src/client.js` 的结尾换行匹配也放宽了（`tools/build-client.mjs:324`）：

```diff
-const clientJs = read('src/client.js').replace(/\n$/, '')
+const clientJs = read('src/client.js').replace(/[\r\n]+$/, '')
```

**为什么等价**：模板自己供给行尾，这句只是避免多出一个空行。CRLF 检出下行尾是 `\r\n`，原来的 `/\n$/` 留下一个孤立的 `\r`，正是 §1.2 那个可复现性缺陷的直接来源。

### 4.3 两件供应商件：只去缩进，注释一个不删（`tools/build-client.mjs:513-525`、`:564-575`）

```diff
   '    /* --- 移植自 dsh-disable-unofficial-plugins v1.3.0（MIT，同一作者）---',
   '     * 原样 vendor：下面这段是它 factory 的主体，只做了两处机械处理 ——',
   '     * 包进 IIFE 避免与主题自己的 ~90 个顶层名字撞车、并按模板字符串转义。',
-  '     * 它自己的 apply(ctx) 会用 ctx.effect 注册清理，主题只负责调用一次。 */',
+  '     * 它自己的 apply(ctx) 会用 ctx.effect 注册清理，主题只负责调用一次。',
+  '     * P5e (round 7, 2026-10-16) 追加第三处：主体本身过 normaliseJs，',
+  '     * 即去掉行首缩进与 CR。于是它不再是逐字节副本，而是逐 token 副本 ——',
+  '     * 由 selfcheck 的 vend.1 每次运行重新切片比对，不以注释作证。',
+  '     * 注释一个不删：它们是这份 vendor 可被人工审阅的部分。 */',
   '    var applyPluginToggle = (function () {',
-  vendorBody,
+  normaliseJs(vendorBody),
   '    ; return apply })()',
 ].join('\n')
```

**为什么等价**：`vendorBody` 是从 `VENDOR_OPEN`（`factory: () => {`）到 `VENDOR_TAIL`（`return { name: SELF, apply, inject: [...] };`）之间切出来的上游正文，构建脚本对边界缺失/尾部标记泄漏**会抛错而不是猜**（`tools/build-client.mjs:503-512`）。`normaliseJs` 只动版面空白，token 流不变。**注释一字未删**，所以包里仍能读到上游原文。

包装注释里写死的两句原文——「只做了**两处**机械处理」——本来就是上一轮的记述，本轮**把它改成三处并说明第三处**，这是注释的更正，不是行为改动。

### 4.4 新门禁：先改门禁，再开剥离（`tools/selfcheck.mjs:782-869`、`:906-949`）

第五轮为「去注释」开了 `cli.13` 的先例：**先把门禁改成比对新契约，再让实现去满足它**。本轮沿用同一先例，新增两个块（**95 ＋ 45 ＝ 140 行**），并把 `cli.22` 的变换名改成新的那个。`tools/selfcheck.mjs` 相对 git HEAD 的累计改动（含第五、六轮）是 **+226/−10**。

**`cli.21b`（`tools/selfcheck.mjs:792-869`）——把「解析不变」从论证变成检查。** `cli.21` 的注释说「变换不碰 token 也不碰行边界」，`cli.21b` 就是**把它跑一遍**：

```js
checks.check('cli.21b', 'the JS transform preserves every token and every line number', () => {
  const scan = (text) => { /* 自带正则字面量感知的小扫描器 */ }
  const before = scan(clientJs)
  const after = scan(stripJsComments(clientJs.replace(/[\r\n]+$/, '')))
  if (before.length !== after.length) return `token count changed: ...`
  for (let k = 0; k < before.length; k += 1) {
    const a = before[k]; const b = after[k]
    if (a.k !== b.k || a.v !== b.v || a.line !== b.line) {
      return `token ${k} changed: ...`     // ← 行号也参与比较
    }
  }
  const shrunk = stripJsComments(clientJs).length < clientJs.length
  return shrunk || 'the transform removed nothing, so this check proves nothing'
})
```

三个设计点，每个都在挡一种具体的失效：
- **行号参与比较**，因为行号是自动分号插入读的东西；「字节变少了」这个条件，一个把两行并成一行、破坏 ASI 的变换同样能满足。
- **扫描器要能识别正则字面量**，因为正则里的 `//` 不是注释。它只有 40 行、就放在门禁里，为的是「这个论断每次运行都被检查」而不是「从作业区脚本里信一次」。
- **末尾要求变换确实是个缩减**，否则这条检查什么也没证明（空变换能让 token 全等）。

**`vend.1` / `vend.2`（`tools/selfcheck.mjs:906-949`）——把失效的旧断言换成同强度的新断言。** 改前两件供应商件的 factory 主体是**逐字节**随包发送的，两个文件自己的注释也是这么写的。本轮归一面板后，那个「逐字节」的句子就**不再为真**，而**留在注释里说谎比删掉它更糟**。换成的是一条**被检查的**同强度断言：

```js
const normaliseVendor = (text) => text.replace(/\r\n?/g, '\n').replace(/^[ \t]+/gm, '')
checks.check('vend.1', 'the plugin-toggle body in the bundle is the upstream body, minus layout', () => {
  const body = sliceVendor('build/plugin-toggle.js', 'factory: () => {',
    "return { name: SELF, apply, inject: ['remote', 'locale'] };")
  if (body === null) return 'build/plugin-toggle.js: factory boundaries not found'
  if (!/function apply\(ctx\)/.test(body)) return 'the sliced body has no apply(ctx)'
  if (!client.includes(normaliseVendor(body))) return 'the bundle does not carry the normalised body'
  if (normaliseVendor(body) === body) {
    return 'the normalisation changed nothing, so this check cannot tell a re-vendor from a no-op'
  }
  return /移植自 dsh-disable-unofficial-plugins v1\.3\.0/.test(client) ||
    'the provenance marker is gone from the bundle'
})
```

它**用构建的同一把刀**（同两个边界标记）重新切片、施加同一归一，再要求包里含有它。所以「这一段是上游那一段」这条性质**仍然被强制**——只是现在它**能扛住一次版面格式化**，而且对副本或上游任一边的**手工改动**依然会失败。注释里明确写出**不再声称的东西**：逐字节同一。

**门禁的牙齿经过反向验证**（`C:\Work\scratch\eva-perf7\negctl*.mjs`）。一条不能失败的门禁等于没有门禁，所以每条新门禁都被注入一个真实的破坏、确认它变红：

| 注入的破坏 | 结果 |
|---|---|
| `cli.21b` — 让它重证的变换不再保 token | `cli.21b verdict: FAIL ← DETECTION WORKS`（同时 `cli.21` 也红） |
| `cli.21` — 让构建去变换另一个函数 | `cli.21 verdict: FAIL ← DETECTED` |
| `vend.1` — 把 plugin-toggle 主体在入包路上弄坏 | `vend.1 verdict: FAIL ← DETECTED` |
| `vend.2` — 把 session-status 主体弄坏 | `vend.2 verdict: FAIL ← DETECTED` |

第一次尝试 `cli.21b` 的注入**没有生效**（`cli.21b verdict: ok <-- DID NOT FIRE`），因为注入的针在文件里命中两次、补丁没落地；改成对唯一命中点注入后才确认它会红。**这次失败也照记**，因为它说明「第一次没红」在这类验证里是常见结果，不能当成「门禁有牙」的证据。

---

## 五、行为不变说明（等价性证据）

四层证明，全部来自 `C:\Work\scratch\eva-perf7\final2.mjs` 一次运行（对比对：`perf-old.js` ＝ 第六轮构建、`perf-new.js` ＝ 第七轮构建，**同一棵树、同一份 CRLF 源**）。

### 5.1 逐 token 比对（最强的一条）

```
code tokens: old 24207  new 24207
IDENTICAL
```

扫描器逐个记录 token 的**类型、行号、字面值**并逐位比较。行号参与比较是关键：它是 ASI 读的东西。

**扫描器自身的可信度先被证明**（`C:\Work\scratch\eva-perf7\audit-prove.mjs` 一脉的做法）：构造两个只差一个 token 的输入，确认扫描器报出差异；再构造一个只差注释的输入，确认它报「无差异」。**一把不会报警的尺子量不出任何东西。**

### 5.2 运行时 `<style>` 文本：逐字节相同

```
<style> text (4 pieces + 3 newlines): old 599765  new 599765  BYTE-IDENTICAL
```

六个运行时常量逐个比对，**全部逐字节相同**：

| 常量 | 旧 | 新 | |
|---|---|---|---|
| `WALLPAPER_DECLARATIONS` | 576,543 | 576,543 | 逐字节相同 |
| `CSS` | 10,351 | 10,351 | 逐字节相同 |
| `BOOT_CSS` | 2,985 | 2,985 | 逐字节相同 |
| `PICKER_CSS` | 9,883 | 9,883 | 逐字节相同 |
| `TOKENS` | 4,131 | 4,131 | 逐字节相同 |
| `MANIFEST` | 1,823 | 1,823 | 逐字节相同 |

> **两个数不要混用，差在哪里要说得清。** `599,765` 是**运行时的真实长度**：`src/client.js:568` 把四段用 `'\n'` 拼进同一个 `<style>`，即 `576,543 ＋ 1 ＋ 10,351 ＋ 1 ＋ 2,985 ＋ 1 ＋ 9,883`。由 `C:\Work\scratch\eva-perf7\styletext.mjs` 独立量出。
>
> `599,792` 是 `final2.mjs` 的**内部口径**：它把每个字面量的首尾定界符各切掉一个（`body = s.slice(1, -1)`）、且**不加**换行再拼接，于是 `576,575−2 ＋ 10,353−2 ＋ 2,987−2 ＋ 9,885−2 ＝ 599,792`。两个口径**都不含任何内容差异**，只是边界算法不同；**旧新两侧在两种口径下都完全相同**，结论不受影响。
>
> 表内 `TOKENS` 与 `MANIFEST` 是**对象字面量**（不是字符串），长度取序列化结果。早先 `reportnums.mjs` 的读取器只找下一个引号、对对象会**静默截断**（把它读成 19 与 2）；该读取器已按字面量首字符分派（字符串查配对引号、对象做括号配对）并修正，现在报 4,131 与 1,823，与上表一致。

**推理链**：`<style>` 文本相同 → 浏览器的 CSSOM 相同 → 计算样式相同 → **不可能有任何像素差**。这是本轮「零视觉变化」的**构造性**依据，不是抽样截图得到的印象。

### 5.3 自动分号插入：相邻 token 之间的换行数

```
pairs compared: 24206
pairs whose inter-token newline count differs: 0
IDENTICAL — no statement boundary moves
```

**这条是本轮最重要的安全性证明。** `^[ \t]+` 不删换行，所以 `\n` 的数量与位置严格不变——但「严格不变」是设计意图，这条是**实测**。24,206 对相邻代码 token 之间的换行计数 0 处不同，意味着 ASI 看到的输入逐位相同。

### 5.4 字面量的 cooked 值

```
literals: old 1745  new 1745
cooked values differing (boot mark normalised): 0
raw bytes shrank but cooked value identical   : 2
multi-line '…' / "…" string literals          : 0
```

- **2 个字面量的原始字节变小、cooked 值不变**：它们内部含 CRLF，引擎在**任何代码看到它之前**就把 CRLF 与孤立 CR 归一成 LF。脚本里对这条引擎行为本身也做了检查（无标记模板字面量归一 CRLF → LF），所以这 2 处的「字节变了」不可能被任何代码观察到。
- **0 个多行字符串字面量**：没有任何字面量跨行，所以「删行首缩进」不可能删到字面量内部。
- `src/client.js` **0 个反引号、0 个 `${`**，由 `cli.21` 每次运行断言；两个包装块按模板字符串转义。

### 5.5 注释：允许不同，且这正是本轮花掉的东西

```
comments: old 129  new 129
identical after layout canonicalisation (CR removed, indentation folded): 127
genuinely edited comment text: 2
```

129 条注释一条不少（**没有删任何注释**——本轮只删缩进），其中 127 条在折叠版面后完全相同，2 条是**本轮有意改写**的供应商件包装说明（§4.3）。**注释没有运行时效果。**

### 5.6 模块求值到达同一点

两个 bundle 都作为模块求值：都**抛出同一个错误、同一批栈帧**（`ReferenceError: window is not defined`，停在 `window.__ModuleLoader__.load({`）。构造上这是预期的——这段胶水是给宿主渲染器跑的，Node 里没有 `window`——**关键是两侧的失败点与调用栈完全一致**，说明求值走到了同一位置。`node --check` 两侧都通过。

### 5.7 本轮未触碰的输入

`src/theme.css`、`src/boot-screen.css`、`src/model-effort-picker.css`、壁纸清单、`tokens.json` **本轮一个字节未改**。第五/六轮已经证明过它们的处理是等价的，本轮没有重新论证的必要——只需要确认本轮的改动**没有回退它们**（§6.2 的 `cli.13`、`cli.13b` 就是这一条）。

---

## 六、验证方式

### 6.1 建议的 DevTools 面板

| 面板 | 看什么 | 期望 |
|---|---|---|
| **Coverage**（Ctrl+Shift+P → Show Coverage） | `client.js` 的未使用字节比 | 本轮后未使用字节下降；**注意本轮的收益在「编译」不在「传输」** |
| **Performance → 录制加载 → Compile Script** | 编译时长 | 行为区 JS 应可见下降（§一.4 的配对测量）；整包被壁纸摊薄，可能看不出 |
| **Sources → 打开 client.js** | 找一段带缩进的 JS | 行首缩进已消失，**行号与语句边界不变** |
| **Elements → 检查 `<style>`** | 样式表内容 | 与改前**完全一致**；这一条是本轮的核心断言 |
| **Elements → Computed** | 任取 5～10 个元素的最终属性值 | 改前后逐项相同 |
| **Rendering → Paint flashing / Layer borders** | 重绘与合成层 | 改前后无差异 |
| **Lighthouse** | Performance 分 | 记录为参考；本轮的收益量级**不足以让分数显著移动**，不要拿它当判据 |

### 6.2 回归检查项（自动，已全绿）

```bash
node tools/build-client.mjs          # 产出新字符数与 boot mark
node tools/build-client.mjs --check  # 产物与 src/ 同步
node tools/selfcheck.mjs              # 123 项门禁
node tools/token-audit.mjs            # 55 个 token 覆盖
npm run verify                        # 上述全量
```

当前实测输出（**逐字**）：

```
wrote client.js  738541 chars (752476 bytes)  55 tokens  2 wallpapers from out/wallpapers.local.json
  css 93282 chars (11865 after the comment strip, 10351 after comment+whitespace)
  wallpaper block 576543 chars  boot mark eva-boot/5ada26ef

client.js check: OK (in sync with src/, 738541 chars, 55 tokens, 2 wallpapers from out/wallpapers.local.json)

123 assertions, 0 failed, 123 passed
all green

AUDIT OK — 55 overrides, exactly the planned 55 (A 41 + B 14); no component-level override; no unchanged token.
```

**必须盯住的门禁**（本轮直接相关）：`cli.21`（挂载半被变换后仍被携带）、`cli.21b`（变换保 token 与行号）、`cli.22`（模板里的变换名是 `compressJs(clientJs)`）、`vend.1` / `vend.2`（两件供应商主体重新切片后仍在包里）、`cli.13` / `cli.13b`（三个样式表无注释无松散空白）、`boot.1`/`boot.2`/`boot.4`/`boot.7`（启动幕布的形态未受版面归一影响）。

### 6.3 建议的人工对比截图

| # | 场景 | 对比点 |
|---|---|---|
| 1 | 冷启动瞬间（清 `localStorage` 的 `eva-boot-seen`） | 启动幕布的霓虹面板与进度条——`src/boot-screen.js` 过了 `compressJs` |
| 2 | 侧栏 ＋ 工作区行 | 微信图标、搜索/筛选/新建图标、品牌字标 |
| 3 | 设置面板 ＋ 模型档位选择器 | 档位选择器的过渡与选中态——它过了 `compressJs` |
| 4 | 玻璃材质（抽屉、引导页） | `-webkit-backdrop-filter` 与 `url(#eva-lg-guide)` 形式 |
| 5 | 浅色与深色各一张 | 两套壁纸与两套 token |

**截图只作为补充**：§5.2 的 `<style>` 逐字节相同已经构造性地排除了像素差，截图是给人看的确认，不是判据。

### 6.4 复现脚本（作业区，只读）

```bash
node C:/Work/scratch/eva-perf7/repro7.mjs       # CRLF/LF 可复现性（两个构建）＋ 缩进/CR 普查对账
node C:/Work/scratch/eva-perf7/cause13.mjs      # 逐区域 Δ 与 CR/缩进/包装文本的因果拆分
node C:/Work/scratch/eva-perf7/final2.mjs       # 四层等价性证明（token / ASI / 字面量 / <style>）
node C:/Work/scratch/eva-perf7/reportnums.mjs   # 本报告引用的每一个数字
node C:/Work/scratch/eva-perf7/surface7.mjs     # 本轮的改动面积
node C:/Work/scratch/eva-perf7/negctl21b.mjs    # cli.21b 的牙齿（注入 → 变红）
node C:/Work/scratch/eva-perf7/negctl3.mjs      # cli.21 / vend.1 / vend.2 的牙齿
node C:/Work/scratch/eva-perf7/binom.mjs        # 配对编译的符号检验
```

---

## 七、未改动项及原因

### 7.1 动画属性：仍然无对象可优化

三个样式表里 **0 个 `@keyframes`**、**0 个触发布局的动画属性**。`src/theme.css` 有 2 处 `transition`（`:861` 的 `background-color 140ms linear` 与 `:867` 的 `transition: none` 减弱动效开关），两者都是合成安全属性；`src/model-effort-picker.css` 有 7 处，全在 `background-color` / `color` / `border-color` / `transform` / `background-image` 上；`will-change` 只有 2 处（`src/boot-screen.css:36` 与 `:137`），都服务于真实的全视口启动动画。**「用 transform/opacity 承载动画」这条**——没有对象可改。

### 7.2 两件供应商件的注释（12,762 字符）：剥离会销毁契约

`build/plugin-toggle.js` 的注释 7,633 字符、`build/session-eva-status.js` 5,129 字符，**仍然随包发送**。原因不是懒：

- 这两个块是**原样 vendor**（D29 的立意：代码是测过的，手抄会引入静默漂移）。
- 它们的注释是**这份 vendor 可被人工审阅的部分**——删掉之后，包里的第三方代码就只剩不可读的机器文本，而审阅正是 `cli.19` / `cli.23` 存在的理由。
- 因此本轮只对**主体**施加 `normaliseJs`：**去缩进不删任何一段可读文本**，删注释会。

**这是一笔主动放弃的收益**，且它的代价明写在这里：净 ~12,762 字符。若将来要拿，需要先决定「随包发送的第三方源码是否必须保持可读」——那是一个**契约问题，不是性能问题**。

### 7.3 构建自产 banner 与供应商来源标记（~5,422 字符）：不能删

`GENERATED FILE` 横幅与两条供应商来源标记由构建脚本写进产物，`cli.19` / `cli.23` 用 `/移植自 dsh-disable-unofficial-plugins v1\.3\.0/`、`/移植自 dsh-session-eva-status v0\.1\.0/` **正面钉住**它们。删掉标记就会同时打掉「这段代码来自哪里」与「门禁能在验什么」。**门禁断言的是契约，不是装饰**。

### 7.4 三处同选择器拆开声明：安全但收益约 0

`body`（`:81` 与 `:165`）、`[data-window-drag='true'] button:has([data-slot='sidebar.brand.name'])`（`:998` 与 `:1152`）、`[data-slot='settings.launcher'] > button`（`:1540` 与 `:1579`）各被拆成两条规则。合并**在层叠上是安全的**（移动的属性期间没有同名的中间规则——已逐属性验证），但**收益约等于 0**：合并后字符数几乎不变、选择器匹配次数不变、匹配集不变。**做它只会给一个没有收益的改动增加回归面。** 不做。

### 7.5 相同声明体的合并：5 组被正确拦下，可合并者收益约 0

`{display: none !important}` ×9、`{content:''; position:absolute; inset:0; …}` ×2、`{display: none}` ×5 等组。合并它们的检查条件是：**两条规则之间，没有一条规则以不低于锚点的特异性声明同一个属性**（否则合并会改变层叠胜出者）。这三组**都不满足**——中间存在更强的 `!important` 声明。合并它们会**改变渲染结果**，所以**正确拦下、不做**。

剩下的可合并组（`{background-color: transparent !important}` ×4、`{position: relative; background-color: transparent !important}` ×2）**做了也不省字节**，收益 ≈ 0。不做。

> 工具局限照记：`precise.mjs` / `consolidate.mjs` 的特异性是对**整个逗号列表字符串**算的，遇到长列表会**高估**锚点特异性。所以对长列表的合并判定在执行前**必须**改成「对逗号成员取最大值」逐条重算。本轮没有依赖这条判定做任何改动，因此该局限不影响结论。

### 7.6 `src/theme.css:694` 的重复属性：故意的

`[data-sidebar-right-guide-entry]::before` 在**同一条规则**里声明了两次 `-webkit-backdrop-filter` / `backdrop-filter`：先是只有模糊的兜底形式，再是带 `url(#eva-lg-guide)` 的完整形式。**这是渐进增强**（不支持 SVG filter 引用的引擎取前者），由 `glass.2` 门禁钉住。**唯一一条「一规则内重复属性」是刻意的**，不做。

### 7.7 脚本拆分 / 延后：产物形态不支持，且会改加载时序

- 插件以 `immediately: true` 装载，**产物是一个模块工厂**——没有可以拆出去、延后加载的第二块。
- 启动幕布的脚本**不能延后**：它的作用就是在首帧之前铺上遮罩，延后会露出白闪——**那是视觉变化**，本任务禁止。
- 没有 HTTP 层可做缓存头（见 §7.8）。

### 7.8 静态资源压缩：无 HTTP 层，字体与壁纸已是终态

- 插件从**磁盘**（软链目录）加载，不经 HTTP，**没有可配置的缓存头与压缩**。构建期压缩是唯一手段，而第五/六轮已经做掉了文本层。
- 字体已是 `woff2`（42,800 字节），壁纸是 VP8 有损 WebP（331,398 字节）——**有损源无法无损再压**（实测：无损重编码会膨胀到 2,224,528 字节）。
- 唯一还有无损空间的是那张 PNG 品牌标（`build/brand-mark-dark.png`，57,715 字节，sha `701cb593f34f3b4f…`）：`optimize=True` 可无损省 3,106 字节。**但它要改 `build/` 下的资产文件，且改的是 PNG 字节而不是构建流程**——本轮只改构建脚本，**不做**。它是一个干净、已量好的后续候选（另需在 `tools/make-brand-mark-dark.py:66` 的 `final.save(OUT)` 上加参数，否则下次生成又会被冲掉）。

### 7.9 与第六轮报告的数字对账

第六轮报告的绝对数字是 **762,226 字符**，本轮的对账基线是 **764,027**。两者相差 1,801，本节把它**逐步量出来**，而不是含糊带过。

对账必须**固定一个构建器**才有意义。下表全部使用同一个「第六轮构建器」（`C:\Work\scratch\eva-perf7\r7base\tools\build-client.r6final.mjs`，即把第七轮的六处变换改动逐一还原、并从 `git show HEAD:tools/build-client.mjs` 取回两段供应商包装数组之后得到的脚本）：

| 项 | 字符 | 依据 |
|---|---|---|
| 第六轮报告发布值 | 762,226 | 报告 4 §一 |
| **实测**：`defer()` 修复**之前**的 `src/client.js`，LF 检出 | **762,150** | 本轮实测（`C:\Work\scratch\eva-perf7\defergap.mjs`） |
| 与报告 4 的残差 | **−76**（0.01%） | 见下方说明 |
| ＋ 2026-10-16 微信按钮 `defer()` 修复 | +716 | 同一脚本、同一构建器，只替换 `src/client.js`；源码 +1,231（LF），其中被剥离的注释与之差为 716 |
| ＝ 今日源在 **LF 检出**下的第六轮基线 | **762,866** | 本轮实测（`repro7.mjs`） |
| ＋ CRLF 检出的 CR | +1,161 | 第六轮不归 CR |
| ＝ 今日源在 **CRLF 检出**下的第六轮基线 | **764,027** | 本轮实测，即本报告使用的基线 |

**那 −76 字符的残差**：报告 4 是当时那次构建的现场记录，它没有保存 bundle，因此只能在今天用**重建的**第六轮构建器去逼近它。残差 76 字符 / 762,226 = **0.01%**，来源无法再往下追（重建脚本与当时脚本之间可能还有未记录的小改动，例如包装数组之外的一行模板文本）。算式：1,801 = 716 ＋ 1,161 − 76，即两项已量出的成因合计 1,877，扣掉这份残差才是 1,801。

本报告**不把残差算进任何收益**：本轮的差分**从头到尾只用同一对构建器**（重建的第六轮 vs 第七轮）在**同一棵树**上测出，所以残差不影响 −25,486 这个数字——它只影响「和上一份报告对不对得上」这一句话。

所以本轮 **−25,486** 是 CRLF 检出下的差值；同一改动在 LF 检出下是 **−24,325**（762,866 → 738,541）。**第七轮之后两种检出给出同一个 738,541**，这个差值本身消失了。第六轮报告**不修改**（仓库惯例：历史文本只增不改，见 D90 与 `docs/render-report.md` §54），订正记在本节。

---

## 八、复现命令

```bash
# 构建（输出新的字符数）
node tools/build-client.mjs

# 产物与 src/ 是否同步
node tools/build-client.mjs --check

# 全量门禁（123 项）
npm run verify

# token 覆盖审计（55 项）
node tools/token-audit.mjs
```

等价性证明与测量（脚本在作业区，只读）：

```bash
node C:/Work/scratch/eva-perf7/repro7.mjs       # 可复现性：第六轮 2 个不同 bundle → 第七轮 1 个
node C:/Work/scratch/eva-perf7/cause13.mjs      # 25,486 的因果拆分：22,830 缩进 ＋ 2,962 CR − 306 包装
node C:/Work/scratch/eva-perf7/final2.mjs       # token 24,207 全等 / ASI 0 差异 / 字面量 0 差异 / <style> 逐字节相同
node C:/Work/scratch/eva-perf7/reportnums.mjs   # 本报告引用的每一个数字
node C:/Work/scratch/eva-perf7/surface7.mjs     # 本轮改动面积
node C:/Work/scratch/eva-perf7/negctl21b.mjs    # cli.21b 的牙齿
node C:/Work/scratch/eva-perf7/negctl3.mjs      # cli.21 / vend.1 / vend.2 的牙齿
node C:/Work/scratch/eva-perf7/binom.mjs        # 配对编译的符号检验（行为区 p=1.87e-46；整包 p=0.318）
```

**改动范围**：本轮改 **2 个文件**——`tools/build-client.mjs`（4 个插值点 ＋ 新变换 `normaliseJs`/`compressJs` ＋ 两处包装注释更正）与 `tools/selfcheck.mjs`（本轮新增 **`cli.21b`（95 行）、`vend.1`/`vend.2`（45 行）**，另改 `cli.22` 的变换名一行）。`src/` 与 `build/` 下的输入**一个字节未改**。

> 工作区里另有 ` M .gitignore`、` M src/client.js` 处于修改状态，**两者都不属于本轮**：前者是凭据忽略规则的补齐，后者是 2026-10-16 的微信按钮 `defer()` 行为修复（§7.9 已量出它对本轮基线的影响）。
