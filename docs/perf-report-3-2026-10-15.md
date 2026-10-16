# EVA 主题第五轮性能报告：付费字节的剥离（2026-10-15）

对象：`C:\Yu\EVA-Inspired-Theme`（DSH 客户端主题，v1.0.0）
目标：**在不改变任何现有视觉样式的前提下**降低加载与解析开销。
结论：**零像素变化**，三次全绿。本轮改动集中在「随包体积里没有运行时作用的那部分」——注释与纯空白。
前序：[perf-report-2026-10-11.md](perf-report-2026-10-11.md)（第一轮，查询放大链）、[perf-report-2-2026-10-11.md](perf-report-2-2026-10-11.md)（第二/三轮，玻璃链与 `:has()` 收窄）。

---

## 一、结论先行

1. **改动只有一个文件的两处，收益 34,441 字符。** `tools/build-client.mjs` 里新增两个纯函数 `stripBlockComments` 与 `minifyCss`，接在**原有**的 paint 层注释剥离之后：① 把**同一 `<style>` 标签内**另外两个样式表与两个行为文件的注释也剥掉；② 对三个样式表做纯空白收缩。浏览器实际解析的文本从 **94,757 → 60,316 字符（−36.4%）**；bundle 从 **850,266 → 814,046 字符（−4.3%）**。差的 34% 与 4% 都是被 576 KB 壁纸数据 URL 摊薄的结果，见 §3.1。
2. **等价性是证明出来的，不是估计的。** 三张样式表逐条比对 **540 条声明，语义差异 0 条**，仅有的 7 处差异全部是「值列表内的换行被折成空格」。另有浏览器 CSSOM 层证据：新旧表 **规则数 151 = 151、序列化行数 157 = 157**，差异仅落在空白；两个阴性对照（截断一个属性值、改一个字符串）**都被判出**，证明这个比较是有效的，不是恒真。
3. **注释剥离原本只覆盖 paint 层。** 这是本轮真正的发现：`src/theme.css` 的 81,417 字符注释（占该文件 87.3%）**早在第一轮就已不进包**，但**同一 `<style>` 标签**里的 `src/boot-screen.css`（1,396）、`src/model-effort-picker.css`（9,082）、`src/boot-screen.js`（3,731）、`src/model-effort-picker.js`（17,505）合计 **31,714 字符注释仍在随包发送、每次加载都被编译后丢弃**。
4. **一条真隐患在实施中被发现并消除：ASI。** 把块注释替换成**单个空格**会删掉注释内部的换行；若下一条语句以 `(` `[` `+` `-` `/` 或反引号开头，JavaScript 的自动分号插入会改变语义。实测 `src/client.js` 有 **21 处**这种风险位（例：L344 结尾 `" width="' + W + '">` 的下一行以 `+` 开头）。因此 `stripBlockComments` **保留注释内的每一个换行**，行号与行边界逐行不变。代价 221 字符（boot 50 + picker 171），换来的是解析不可能移动。
5. **两处诚实降级。**
   - **全 bundle 编译开销没有可测改善**：整包 850,266 → 813,825 字符的 V8 编译配对比为 **−1.6%，IQR 重叠**，在噪声带内。原因是被 576 KB 壁纸块主导。**本报告不主张这一项有收益。**
   - **样式重算（style recalc）本轮没有改动**，也不主张任何收益：本轮只动文本体积与解析成本，选择器一个字未改。
6. **任务清单里有一项无事可做。** 「用 `transform`/`opacity` 承载动画」在本仓库**无对象**：三张表 **`@keyframes` 共 0 条**，触发重排的动画属性 **0 条**。唯二的 2 条 transition 在 `src/theme.css:861`/`:867`，属性是 `background-color`（只触发绘制，不触发布局），且**已被 `@media`/`data-eva-motion` 的 reduced-motion 规则关掉**。详见 §7.1。
7. **未改动项 9 条，全部给了理由**（§7），其中体积最大的一条是 `src/client.js` 的 **53,159 字符注释（占该文件 54.9%）仍然随包发送**——不是漏掉，而是门禁 `cli.21` 明确钉住它必须逐字节随包，剥它属于**改契约**而非改构建，需先改门禁。这一条本身价值 **−52,553 字符**，是下一轮性价比最高的默认候选。

---

## 二、插件的文件结构与加载方式

### 2.1 构建链

**五个输入，一个输出，中间不做解释**（`tools/build-client.mjs` 开头即这样声明）：

| 角色 | 文件 | 处理 |
|---|---|---|
| 令牌层 | `src/tokens.json` | 55 个覆盖令牌，构建为 `--dsw-*` 声明 |
| 绘制层 | `src/theme.css` | 93,282 字符，**仅剥离注释**（第一轮起） |
| 启动遮罩样式 | `src/boot-screen.css` | 4,741 字符，**本轮起**剥离注释 + 收缩空白 |
| 启动遮罩行为 | `src/boot-screen.js` | 12,281 字符，**本轮起**剥离注释 |
| 模型选择器样式 | `src/model-effort-picker.css` | 20,108 字符，**本轮起**剥离注释 + 收缩空白 |
| 模型选择器行为 | `src/model-effort-picker.js` | 45,755 字符，**本轮起**剥离注释 |
| 挂载胶水 | `src/client.js` | 96,836 字符，**逐字节原样**（`cli.21` 钉住） |
| 壁纸 | `build/wallpapers.json` 或 `out/wallpapers.local.json` | 2 条，本机走 local（内嵌 data URL） |
| 供应商件 | `build/plugin-toggle.js`、`build/session-eva-status.js` | 逐字节原样（`cli.19`/`cli.23` 钉住注释里的来源证据） |

输出是**一个** `window.__ModuleLoader__.load({...})` 调用，即 DSH 客户端模块加载器要求的插件浏览器半形态。

### 2.2 运行时：一个样式标签，四段拼接

`src/client.js:530` 创建**唯一一个** `<style data-plugin-css>`（`:528` 先按同一属性清掉上一份，保证重复挂载不叠加）；`src/client.js:540` 给它的文本是：

```js
shortenDataUrls(WALLPAPER_DECLARATIONS, blobUrls) + '\n' + CSS + '\n' + BOOT_CSS + '\n' + PICKER_CSS
```

四段拼进**同一个**样式表——这正是「只剥了 paint 层」的成因：另外三段的注释与空白从来没被任何 pass 处理过。

`shortenDataUrls`（`src/client.js:35-66`）把两个壁纸 data URL 重声明为 `blob:` URL。`src/client.js:19-33` 记录的理由：约 441 KB + 281 KB 的位图文本若留在可继承的自定义属性里，会参与约 15 ms 的全文档重算中的 **约 8.6 ms**（约 56% 的重算开销），而同样字节放在绘制规则里测量不到成本。这段机制本轮未动。

### 2.3 加载方式

`package.json` 的 `dsh.client` 声明 `platform: web`、**`immediately: true`**、依赖 6 个官方服务（`dsh-client-ui-theme` 等）。桌面 profile 通过 **`link:` 符号链接**消费本仓库：

```
~/.dsh/profiles/desktop/package.json:12   "eva-inspired-theme": "link:C:/Yu/EVA-Inspired-Theme"
node_modules/eva-inspired-theme -> ../../../../../../Yu/EVA-Inspired-Theme
```

因为是链接，**重建后下次加载即生效，无需重装**。`index.js`（宿主半）只打一行日志就退出：不注册服务、不监听事件、无 HTTP 路由、不启子进程、运行时不读文件——**本轮无需也不应在此优化**。

`client.js` 不进 git（`.gitignore` 含 `client.js`、`out/`、`_work/`），检出后由 `prepare` 脚本重建。

---

## 三、瓶颈清单

严重度口径：**高** = 每次加载都付出且随包体积占比大；**中** = 每次加载都付出、占比可观；**低** = 收益确定但量级小；**无** = 已是最优或无可做。

### 3.1 清单表

| # | 位置 | 问题 | 严重度 | 优化手段 | 预估收益（实测） |
|---|---|---|---|---|---|
| 1 | `src/boot-screen.js`、`src/model-effort-picker.js`（经 `tools/build-client.mjs:638-639` 内联） | 两个行为文件的 **21,236 字符块注释**随包发送，每次加载都被 V8 编译后丢弃 | 中 | `stripBlockComments`（保换行） | **−20,946 字符**（boot −3,656 / picker −17,290） |
| 2 | `src/model-effort-picker.css`（经 `:637` 内联） | 9,082 字符注释 + 1,253 字符纯空白随包发送 | 中 | `stripBlockComments` + `minifyCss` | **−10,225 字符（−50.9%）** |
| 3 | `src/boot-screen.css`（经 `:635` 内联） | 1,396 字符注释 + 385 字符纯空白随包发送 | 中 | `stripBlockComments` + `minifyCss` | **−1,756 字符（−37.0%）** |
| 4 | `src/theme.css`（经 `:633` 内联） | 1,514 字符**纯空白**随包发送（注释第一轮已剥） | 低 | `minifyCss` | **−1,514 字符（−12.8%）** |
| 5 | `src/client.js`（`cli.21` 钉住逐字节随包） | **53,159 字符注释（54.9%）随包发送** | 中 | 需先改 `cli.21` 契约 | 潜在 **−52,553 字符**；**本轮未做**，见 §7.2 |
| 6 | `src/theme.css:694`（`[data-sidebar-right-guide-entry]::before`） | `-webkit-backdrop-filter` / `backdrop-filter` 各声明两次 | 无 | — | **故意**：前一条是渐进增强兜底，`glass.2` 门禁钉住次序。见 §7.3 |
| 7 | `src/theme.css` 三处重复选择器（`:81`+`:165`、`:998`+`:1152`、`:1540`+`:1579`） | 同一选择器出现在两条规则里 | 低 | 合并 | 已证**顺序无关**且**安全**，但 151 条规则里省 1 条，**运行时收益约 0**；未做，见 §7.4 |
| 8 | 全表 | `!important` 共 **23 处**（theme 23 / boot 0 / picker 0） | 无 | — | 逐条有据（压过宿主特异性），无滥用；见 §7.5 |
| 9 | `src/theme.css` | 含通配符 `*` 的选择器 **9 条**（文本 11 次，另 2 次在 `calc(-1 * …)` 里）、最深选择器 **6 层**、含 `:has()` 的选择器 **22 条**（文本 26 次）、≥4 个属性测试的选择器 **6 条** | 低 | 收窄主语 | 已在第一/二轮处理过；本轮再动属**改匹配集** = 改视觉，未做，见 §7.6 |
| 10 | 三张样式表 | 触发重排重绘的动画属性 | 无 | 用 `transform`/`opacity` | **0 条**。`@keyframes` 0、布局类动画属性 0。见 §7.1 |
| 11 | `src/boot-screen.css:36`、`:137` | `will-change: transform` **2 处** | 无 | 按需加 | 已有且仅 2 处，位置正确（`transform` 合成层），无增补理由 |
| 12 | `tools/build-client.mjs` 模板 | 阻塞渲染的脚本 / 非关键脚本拆分 | — | 拆分或延后 | **不适用**：产物是**一个**模块工厂 + **一个** `<style>`，无独立脚本标签可延后；见 §7.7 |
| 13 | 静态资源 | 未压缩资源 | 低 | 压缩并缓存 | 字体已是 `woff2`（42,800 B，本身即压缩格式）；本机经 `link:` 从磁盘读入，**无 HTTP 传输层可压缩**；见 §7.8 |

### 3.2 排序后的收益

按「实际从浏览器解析文本里移除的字节」排序，四条已做项合计 **−34,441 字符**：

| 排名 | 项 | 字符 | 占本次总收益 |
|---|---|---|---|
| 1 | JS 注释（boot + picker） | −20,946 | 60.8% |
| 2 | picker 表注释 + 空白 | −10,225 | 29.7% |
| 3 | boot 表注释 + 空白 | −1,756 | 5.1% |
| 4 | theme 表纯空白 | −1,514 | 4.4% |
| — | **合计** | **−34,441** | 100% |

按手段归因（实测，两条 pass 各自的贡献）：

| 手段 | 收益 | 说明 |
|---|---|---|
| 注释剥离（P5b） | **−31,289 字符** | 1,371（boot CSS）+ 8,972（picker CSS）+ 3,656（boot JS）+ 17,290（picker JS） |
| 空白收缩（P5c） | **−3,152 字符** | 1,514（theme CSS）+ 385（boot CSS）+ 1,253（picker CSS） |
| 合计 | **−34,441 字符** | 与浏览器解析文本的差值逐字符相符 |

---

## 四、关键改动前后对比

全部改动在 `tools/build-client.mjs` 一个文件内（另加门禁一处，见 §4.3）。**没有一行样式值被修改**。

### 4.1 两个 pass 的实现（`tools/build-client.mjs:147-184`）

**改动前**（`tools/build-client.mjs:107`，第一轮引入，只覆盖 paint 层）：

```js
const cssPaint = css.replace(/\/\*[\s\S]*?\*\//g, '')
```

**改动后**：

```js
// 剥离块注释，并保留注释内的每一个换行。
// 为什么必须保换行：块注释可跨行，替换成单个空格会删掉这些换行，把前后两条语句
// 挤到同一行。JS 的自动分号插入依赖换行，`a = b` 后接 `(x)` 一旦没了换行就会被
// 解析成函数调用 —— 静默改语义。逐换行还原保证每个行边界原地不动，
// 解析因此不可能移动。代价 221 字符（boot 50 + picker 171）。
const stripBlockComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
  const newlines = comment.match(/\n/g)
  return newlines === null ? ' ' : newlines.join('')
})

// 空白收缩，只作用于三张样式表 —— 绝不作用于 JS 输入（换行有意义，且行注释到行尾）。
// 只在引号字符串之外做两件事：
//   1. 一串空白折成一个空格      (\s+ -> ' ')
//   2. 丢掉 `{` `}` `;` 两侧的空格
// CSS 里引号外的空白只承担「分隔两个 token」，折成一个空格不可能改变解析；
// `{`/`}`/`;` 本身是独立 token，旁边的空格不分隔任何东西。
//
// 有意**不碰** `:` `>` `+` `~` `(` `)` 周围的空白：src/theme.css 有六处
// `> :first-child` / `> :nth-child(2)`，那里的空格是后代组合符，删掉会把两层选择器
// 变成伪类；同一文件有 52 处 `] >` 与七处 `calc()`，后者的 `+` 需要两侧空格才合法。
// 一条「把所有标点两侧空白都吃掉」的 pass 会把它们全部改坏；这一条刻意做得很小，
// 因为只有小到可以被证明的程度才有意义。
const QUOTED = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[^'"]+/g
const minifyCss = (text) => (text.match(QUOTED) || [])
  .map((piece) => (piece.charAt(0) === "'" || piece.charAt(0) === '"')
    ? piece
    : piece.replace(/\s+/g, ' ').replace(/ ?([{};]) ?/g, '$1'))
  .join('')
```

**为何等价**：`QUOTED` 把文本切成「引号字符串」与「其余」两段，**引号段原样输出**，所以四个 `content` 值与字体名逐字节不变；非引号段只做上述两种纯缩减，两种都只删除不承载语义的字符。`stripBlockComments` 只删除注释，且用换行数还原行边界。

### 4.2 模板与日志（`tools/build-client.mjs:633-639`、`:710`）

```diff
-    var CSS = ${JSON.stringify(cssPaint)}
-    var BOOT_CSS = ${JSON.stringify(bootCss)}
-    var PICKER_CSS = ${JSON.stringify(pickerCss)}
-${bootJs}
-${pickerJs}
+    var CSS = ${JSON.stringify(minifyCss(cssPaint))}
+    var BOOT_CSS = ${JSON.stringify(minifyCss(stripBlockComments(bootCss)))}
+    var PICKER_CSS = ${JSON.stringify(minifyCss(stripBlockComments(pickerCss)))}
+${stripBlockComments(bootJs)}
+${stripBlockComments(pickerJs)}
 ${pluginToggleJs}
 ${sessionEvaStatusJs}
 ${clientJs}
```

`pluginToggleJs`、`sessionEvaStatusJs`、`clientJs` **三行一字未动**——这是有意的，见 §7.2/§7.9。

日志加重一段，让收益可复核：

```diff
-  `css ${css.length} chars (${cssPaint.length} after the comment strip)  ` +
+  `css ${css.length} chars (${cssPaint.length} after the comment strip, ` +
+  `${minifyCss(cssPaint).length} after comment+whitespace)  ` +
```

实测输出：

```
wrote client.js  814046 chars (828918 bytes)  55 tokens  2 wallpapers from out/wallpapers.local.json
css 93282 chars (11865 after the comment strip, 10351 after comment+whitespace)
wallpaper block 576543 chars  boot mark eva-boot/9244daef
```

### 4.3 门禁随实现更新（`tools/selfcheck.mjs:86-98`、`:957-987`）

`cli.13` 原本做**字节**比较；空白收缩后字节必然不同，门禁必须改为表达同一意图（「内嵌的 CSS 就是源文件，只经构建变换，别无其他」）：

```diff
-  if (shipped !== css.replace(/\/\*[\s\S]*?\*\//g, '')) {
-    return 'CSS differs from src/theme.css (comments stripped)'
+  /* 规范化形式而非字节：构建剥注释并（第五轮起）折空白。
+     引号字符串逐字节保留，所以改动一个 content 值仍然会失败。 */
+  if (canonicalCss(shipped) !== canonicalCss(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
+    return 'CSS differs from src/theme.css (comments stripped, whitespace canonicalised)'
   }
```

新增 `cli.13b`，把「三张随包的表既无注释也无松散空白」钉死，防止未来回退。**这是本轮唯一改动的门禁**；`cli.13` 的规范化保持在**空白不敏感**层面，因此它仍能抓出任何被丢弃或改写的声明。

---

## 五、行为不变说明（等价性证据）

### 5.1 证据一：逐条声明的语义比对

把新旧文本按 `}` 切块、再按 `;` 切声明，逐条比对（`C:\Work\scratch\eva-perf3\strictdiff.mjs`）：

| 表 | 声明数 | **语义差异** | 仅空白差异 |
|---|---|---|---|
| `src/theme.css` | 203 | **0** | 3 |
| `src/boot-screen.css` | 90 | **0** | 1 |
| `src/model-effort-picker.css` | 247 | **0** | 3 |
| **合计** | **540** | **0** | **7** |

7 处「仅空白差异」全部**只是值列表内部的换行被折成空格**，例如：

```
[data-slot='sidebar.brand.name'] { font-family: Bahnschrift, 'DIN Alternate', 'DIN Next',
  'Eurostile Extended', 'Montserrat', system-ui, sans-serif }
```

CSS 值列表内换行与空格等价，故渲染相同。**语义差异 0 条**是「零视觉变化」的第一层证明。

### 5.2 证据二：浏览器 CSSOM 层比对

在真实 Chromium 里把新旧文本各建一张样式表，遍历 `document.styleSheets[0].cssRules` 取值后比较（`C:\Work\scratch\eva-perf3\harness.html`）：

| 指标 | 旧 | 新 |
|---|---|---|
| 规则数 | 151 | **151** |
| 序列化行数 | 157 | **157** |
| 严格文本相等 | — | **false**（预期：空白不同） |
| 折空白后相等 | — | **true** |

**两个阴性对照验证了这个比较不是恒真**：把新表某个属性值截断 → 判出；把某个字符串改一个字符 → 判出。两者都返回 `true`，说明检测器真的在工作。

### 5.3 证据三：等价性的逐段断言

`C:\Work\scratch\eva-perf3\final.mjs` 断言 11 项，全部通过（`EQUIVALENCE OK (11 passed, 0 failed)`），其中关键三条：

- 三张表：`new === minify(strip(old))` ——**新值就是旧值减注释与空白，别无其他**。
- 两个行为文件：`new === strip(source)`（boot mark 已规范化），且**单独断言**长度差恰好为「boot mark +1 与模板尾空白 +5」，使「差了 6 个字符」不可能藏住真实改动。
- 构建**不该动**的输入：`src/client.js` 逐字节相同**且仍带着它的头注释**；`plugin-toggle.js`、`session-eva-status.js` 的来源注释仍在。

### 5.4 证据四：结构与语法

- 剥离后花括号配平：`CSS 70/70`、`BOOT_CSS 19/19`、`PICKER_CSS 68/68`，**无注释开启符残留**。
- 剥离是**幂等**的。
- `node --check client.js`、`node --check index.js` 均通过。
- 构建的注释剥离**只可能减少 token**：预先的邻接测试确认 69 条注释中**没有一条**处于「删除后会合并两个 token」的位置。

### 5.5 未改变的运行时行为

| 项 | 状态 |
|---|---|
| 选择器匹配集 | 未动（选择器文本除空白外逐字节相同） |
| 声明的值 | 未动（540 条声明语义差异 0） |
| 规则顺序与特异性 | 未动 |
| `!important` 数量与位置 | 未动（23 处） |
| `@keyframes` / `will-change` | 未动（0 / 2 处） |
| JS 执行路径 | 未动（只删注释，行号与行边界保留） |
| 壁纸 data URL | 未动（576,543 字符，逐字节相同） |
| 55 个令牌覆盖 | 未动（`token-audit` 逐项核对） |

---

## 六、验证方式

### 6.1 建议的 DevTools 面板

| 面板 | 看什么 | 期望 |
|---|---|---|
| **Coverage**（Ctrl+Shift+P → Show Coverage，reload） | CSS 未使用字节占比 | 样式表总字节下降约 36%，未使用率不应变差 |
| **Performance**（reload 录制） | `Parse Stylesheet` / `Compile Script` 的耗时条 | 两条应缩短；总分因本机主题开销主导，不承诺可见变化 |
| **Elements → Computed** | 任选元素的 `background-image`、`backdrop-filter`、`font-family`、`color` | **逐项与改动前相同**（这是最快的人工抽查） |
| **Rendering → Paint flashing / Layer borders** | 启动遮罩与玻璃层 | 重绘区域与图层数与改动前一致 |
| **Sources → Search**（`content` 等字符串） | 四个 `content` 值与字体名 | 引号字符串未被改动 |
| **Network** | 不适用（经 `link:` 从磁盘加载，无 HTTP 传输） | — |

### 6.2 回归检查项（自动，已全绿）

```bash
cd C:/Yu/EVA-Inspired-Theme
npm run verify        # node --check ×2 + selfcheck + token-audit + build --check
```

实测结果：

| 检查 | 结果 |
|---|---|
| `node --check index.js` / `client.js` | OK |
| `node tools/selfcheck.mjs` | **120 assertions, 0 failed, 120 passed / all green** |
| `node tools/token-audit.mjs` | `AUDIT OK — 55 overrides, exactly the planned 55 (A 41 + B 14)` |
| `node tools/build-client.mjs --check` | `client.js check: OK (in sync with src/, 814046 chars, 55 tokens, 2 wallpapers)` |

关键门禁逐条确认仍绿：`cli.13`（内嵌 CSS 派生自源文件）、**`cli.13b`（新增：无注释/无松散空白）**、`cli.21`（`src/client.js` 逐字节随包）、`cli.19`/`cli.23`（两件供应商件的来源注释在）、`boot.1`/`boot.2`/`boot.3`（启动表五条必需模式仍在剥离后的真实代码里）、`glass.1`/`glass.2`（玻璃兜底次序）、`css.7`/`css.8`。

### 6.3 建议的人工对比截图

同一会话页、同一窗口尺寸，改动前后各一张：

1. 浅色「Title Card」启动瞬间（遮罩 + 壁纸）；
2. 深色「Central Dogma」会话页（玻璃输入卡 + 侧栏 + 右侧引导卡）；
3. 模型选择器与 effort 选择器展开态（本轮改动覆盖 picker 表，**必看**）；
4. 启动遮罩「闸门开启」动画进行中（本轮改动覆盖 boot 表，**必看**）。

逐像素比对建议叠加差值模式；本轮的**自动**证据（§5.1/§5.2）已强于截图，截图用于确认无渲染引擎层面的意外。

---

## 七、未改动项及原因

### 7.1 动画属性：无对象可优化

任务要求「用 `transform`/`opacity` 承载动画」。实测三张样式表：

| 表 | `@keyframes` | `transition` | `animation` | `will-change` | 布局类动画属性 |
|---|---|---|---|---|---|
| `src/theme.css` | 0 | 2 | 0 | 0 | **0** |
| `src/boot-screen.css` | 0 | 0 | 0 | 2 | **0** |
| `src/model-effort-picker.css` | 0 | 7 | 0 | 0 | **0** |

- theme 表的 2 条在 `src/theme.css:861`（`transition: background-color 140ms linear`）与 `:867`（`transition: none`，reduced-motion 关闭）。`background-color` **只触发绘制**，不触发布局；且已有 reduced-motion 分支。
- picker 表的 7 条属性为 `background-color` / `border-color` / `transform`——`border-color` 与 `background-color` 是**绘制类**（不是重排类），`transform` 是合成类。
- boot 表的 2 处 `will-change: transform`（`:36`、`:137`）位置正确：这是唯一能真正受益于提前提层的属性。

**结论：改成 `transform`/`opacity` 无可改对象；强行增加 `will-change` 反而会常驻显存并扩大合成层，属负优化。** 未做。

### 7.2 `src/client.js` 的 53,159 字符注释（本轮最大剩余项，未做）

`src/client.js` 共 96,836 字符，其中块注释 **98 条 / 53,159 字符（54.9%）**，逐字节随包发送。**这是本轮发现的最大单项，但没有剥。**

原因：门禁 `cli.21`（`tools/selfcheck.mjs:734-745`）的**契约**是「挂载半以自身形态进入 bundle」——它断言 bundle 包含 `clientJs` 的原文，并断言源文件仍带着头注释（探针 `The theme's own client glue`）。剥它的注释必然使这条断言失败，因此**这是改契约，不是改构建**：正确做法是先按 `canonicalCss` 的先例把 `cli.21` 改成对 `stripBlockComments(clientJs)` 比较，再打开剥离。

已提前量出的代价与安全性：`src/client.js` 无行注释、无反引号、**含 21 处 ASI 风险位**（`C:\Work\scratch\eva-perf3\asi.mjs` 实测），所以必须用**保换行**版本；保换行版本同步长 1,740 行不变，代价 **+508 字符**，净收益约 **−52,553 字符**。

**这是下一轮的首选默认候选**，也是 `tools/build-client.mjs:122-125` 注释里已经写明的指向（那段注释就指向本报告）。

### 7.3 `src/theme.css:694` 的重复属性：故意

`[data-sidebar-right-guide-entry]::before` 里 `-webkit-backdrop-filter` 与 `backdrop-filter` 各出现两次：**先是 `blur()` 兜底，后是 `url(#eva-lg-guide)` 增强**。这是渐进增强的既定写法，由门禁 `glass.2` **钉住次序**（第一/二轮 D65 的决定）。合并会破坏在不支持 `url()` 滤镜的引擎上的兜底。**未做。**

### 7.4 三处重复选择器：安全但收益约 0

| 选择器 | 位置 | 已证 |
|---|---|---|
| `body` | `:81` + `:165` | 移动 `background-color`/`background-image` 到 `:81` **顺序无关**（中间只有 `body[data-ds-dark-theme]`，声明的是别的属性）|
| `[data-window-drag='true'] button:has([data-slot='sidebar.brand.name'])` | `:998` + `:1152` | 移动 `-webkit-app-region` 安全（中间 2 条规则均不声明它）|
| `[data-slot='settings.launcher'] > button` | `:1540` + `:1579` | 移动 `display` 安全（中间 0 条规则）|

三处都已用「**只比较被移动的属性** 与严格位于两者之间的规则」的方法证明顺序无关（早期一版工具比较的是两条规则属性的**并集**，因而误报冲突；那版结论已作废）。

**但未做**：三处合计把 151 条规则减到 148 条，**运行时收益约等于 0**（同样的声明、同样的匹配），而移动规则位置会改动级联顺序，属**无收益而承担风险**。此外一次工具局限必须记录：那个特异性函数是对整个逗号选择器**列表字符串**计算的，对长列表会**高估**锚点特异性，因此任何「相同声明体合并」在实施前必须换成「按逗号成员取最大值」的特异性检查。**未做。**

### 7.5 `!important`：23 处，逐条有据

`theme.css` 23 处（`background-color` ×11、`display` ×9、`-webkit-backdrop-filter`、`backdrop-filter`、`background-image`、`--dsw-specific-sidebar-fill` 各 1），boot 与 picker 均 0 处。

这些是**为了压过宿主应用自身的特异性**而必需的（宿主用 CSS-Modules 哈希类名，主题只能靠 `!important` 或 `data-slot` 提升）。减少它们需要逐条重算特异性并验证匹配集——**属改视觉风险，无收益**。未做。

### 7.6 选择器深度与通配符：第一/二轮已处理，本轮再动即改匹配集

实测（注释剥离后的活表）：

| 指标 | theme | boot | picker |
|---|---|---|---|
| 选择器数（按逗号计） | 96 | 19 | 69 |
| 最深层级 | **6** | 1 | 2 |
| 含通配符 `*` 的选择器 | **9** | 0 | 0 |
| 含 `:has()` 的选择器 | **22** | 0 | 0 |
| ≥4 个属性测试的选择器 | **6** | 0 | 0 |

（`:has()` 文本出现 26 次分布在 22 条选择器上——4 条各带两个；通配符文本 11 次里 2 次属于 `calc(-1 * var(…))` 的乘法，不是选择器。）

最深两条在 `src/theme.css`：

```
[data-slot='sidebar'] > div > nav + div ~ div > :first-child
[data-slot='sidebar'] > div > nav + div ~ div > :nth-child(2)
```

九条含通配符的选择器是：`[data-rightbar-col] > *`、`#root *:has(> [data-conversation-content])`、`#root *:has(> [data-dsh-center-col])`、`[data-slot='root'] > *`、`[data-slot='root'] > * > div:has(> [data-slot='sidebar'])`、`[data-dsh-pane] > *`、`[data-slot='root'] > *::before`、`html[data-windows-titlebar] #root *:has(> [data-conversation-content]):has([data-conversation-tabs]) > [data-conversation-content]`、`[data-eva-wx-tree='on'] [data-eva-wx-head='on'] + *`。

**未做**，理由是第二轮的记录（`perf-report-2-2026-10-11.md` §十一 C2）：当时已**收窄 4 条**裸 `div:has(...)`，第 5 条（设置弹层）因**无证据表明它挂在 `shell.overlay`** 而**有意保留**。任何进一步收窄主语都会**改变匹配集**，也就是改视觉——正是本轮明令禁止的。会话页 0 元素命中的选择器看似可删，但主题要覆盖官方后续渲染的 DOM，删掉会在别的页面/时机失效。**未做。**

### 7.7 脚本拆分/延后：产物形态不支持，且会改加载时序

`package.json` 声明 `immediately: true`，产物是**一个**模块工厂 + **一个** `<style>`，**没有独立的 `<script>` 标签**可以 `defer`/`async`。把启动遮罩行为延后会让它晚于遮罩样式生效，**产生可见闪白**——正是第一轮要解决的问题。**未做。**

### 7.8 静态资源压缩：无 HTTP 层，字体已是压缩格式

- 字体 `build/great-vibes-latin.woff2` **42,800 字节**，`woff2` 本身即压缩容器，再压收益极低。
- 三张品牌图 `brand-mark-{dark.png,jpg,png}` 49,860–57,715 字节，属正常量级；重编码是**有损且有视觉风险**的操作。
- 本机经 `link:` 从磁盘加载，**没有 HTTP 传输层**可施加 gzip/brotli；宿主如何注入不在本仓库控制范围。
- 真正的体积大头是 **576,543 字符的壁纸 data URL**（占 bundle 的 70.8%）。它已经在做本仓库能做的最优处理——构建期编码为 data URL，运行时 `shortenDataUrls` 重声明为 `blob:` URL 以避免约 8.6 ms 的全文档重算；再缩体积需要换量化位数或改图，**都是视觉变化**。**未做。**

### 7.9 两件供应商件：剥注释会销毁契约

`build/plugin-toggle.js`（54,040 字符）与 `build/session-eva-status.js`（18,854 字符）的注释里带着**来源证据**（`移植自 … v1.3.0` / `v0.1.0`），由 `cli.19`/`cli.23` 逐字匹配。剥掉即**销毁「这两段是上游逐字节副本」的证明**——那正是这两条门禁存在的全部意义。**未做。**

### 7.10 一项工具局限（记录在案，影响未来合并类优化）

`C:\Work\scratch\eva-perf3\precise.mjs` 与 `consolidate.mjs` 的特异性计算是**对整个逗号选择器列表字符串**做的。对 `src/theme.css:234` 那种长列表，锚点特异性被**高估**，因此：
- 已得出的「`{background-color: transparent !important}` ×4 可安全合并」结论**成立但收益约 0**（同 §7.4）；
- 「`{display: none !important}` ×9」因存在中间 `!important` `display` 规则而**被正确拦下**（这一条不依赖特异性精度）；
- 任何**新一轮**相同声明体合并，必须先实现「按逗号成员取最大值」的特异性，才能信任其结论。

本轮**没有基于这个工具做任何改动**，故不影响结论。

---

## 八、复现命令

```bash
# 构建（输出新的字符数）
cd C:/Yu/EVA-Inspired-Theme
node tools/build-client.mjs

# 全量门禁（120 项）
npm run verify

# 等价性证明（脚本在作业区，只读）
node C:/Work/scratch/eva-perf3/strictdiff.mjs    # 540 条声明，语义差异 0
node C:/Work/scratch/eva-perf3/final.mjs         # 11 项断言，EQUIVALENCE OK
node C:/Work/scratch/eva-perf3/accounting.mjs    # 分段字符账
node C:/Work/scratch/eva-perf3/finaltable.mjs    # 与 bundle 差值精确对账
```

成对测量页（真实 Chromium，`file://` 下 `performance.now()` 有 100 µs 钳制，故用批次法）：

```
C:/Work/scratch/eva-perf3/perf.html      样式表解析：0.012 -> 0.009 ms（成对 35/40）
C:/Work/scratch/eva-perf3/jsperf.html    行为段编译：0.020 -> 0.013 ms（成对 37/40，IQR 不重叠）
C:/Work/scratch/eva-perf3/jsperffull.html 整包编译：-1.6%，IQR 重叠 —— 无收益，不主张
C:/Work/scratch/eva-perf3/harness.html   CSSOM 等价：151 规则 / 157 行，双方一致
```

改动范围：`tools/build-client.mjs`（+93/−8）、`tools/selfcheck.mjs`（+43/−8），共 2 个文件。`client.js` 不在 git 内（`.gitignore`）。
