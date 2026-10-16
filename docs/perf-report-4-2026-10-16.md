# EVA 主题第六轮性能报告：挂载半的注释（2026-10-16）

对象：`C:\Yu\EVA-Inspired-Theme`（DSH 客户端主题，v1.0.0）
目标：**在不改变任何现有视觉样式的前提下**降低加载与解析开销。
结论：**零像素变化**，四道门禁全绿；本轮剥掉的是**唯一一个还在随包发送、且每次加载都被编译的注释体**——挂载胶水 `src/client.js` 的 99 条块注释，**53,079 字符**。
前序：[perf-report-2026-10-11.md](perf-report-2026-10-11.md)（第一轮，查询放大链）、[perf-report-2-2026-10-11.md](perf-report-2-2026-10-11.md)（第二/三轮，玻璃链与 `:has()` 收窄）、[perf-report-3-2026-10-15.md](perf-report-3-2026-10-15.md)（第五轮，付费字节的剥离）。

---

## 一、结论先行

1. **改动是上一轮留下的那一项，收益 53,079 字符。** 第五轮报告 §7.2 把 `src/client.js` 的注释列为「下一轮性价比最高的默认候选」，本轮就是把它做掉。bundle **815,305 → 762,226 字符（−6.5%）**；同一批输入交给引擎解析的文本 **158,401 → 105,322 字符（−33.5%）**。被剥掉的是 **99 条块注释 / 53,697 字符**——占该文件 **54.7%**。

2. **等价性是证明出来的，不是估计的。** 四条独立证据：① 逐 **token** 比对，7,436 个 token 的**类型、行号、取值全部一致，差异 0 条**，行数 1,767 → 1,767 不变（`prove.mjs`）；② 剥完的文本仍通过 `node --check`；③ 手工 tokenizer 先经过**不可能性检验**（字符串字面量里出现裸换行 = 扫描器失步）——三个文件全部 0 条不可能 token，故 ① 的结论可信；④ **骨架比对**：六个 `var NAME = <字面量>` 常量在新旧 bundle 中**逐字节相同（605,853 字符）**，其余 209,530 → 156,451，差异全部落在**唯一一个**插值洞上。

3. **像素不可能变，因为样式表一个字节没动。** 运行时**唯一**的 `<style>` 文本是新旧两侧的 `WALLPAPER_DECLARATIONS + CSS + BOOT_CSS + PICKER_CSS` 拼接，实测**两侧各 599,765 字符、逐字节相同**。CSSOM 因此相同，计算样式因此相同。另五个输入（三张样式表、两个行为文件）本轮**一个字符未碰**，五者小计 60,307 字符两侧一致。

4. **一项被上一轮留下的错误记述，本轮订正（不重写历史）。** 第五轮报告 §7.2 与 §一.4 说 `src/client.js`「含 **21 处** ASI 风险位」，并以此为「必须保换行」的理由。实测**那个 21 数错了东西**：它数的是「某行不以终结符结尾、下一行以延续 token 开头」——这是**普通的多行源码**（换行参数表、SVG 字符串拼接），与注释无关，剥注释根本改变不了它。**真正决定安全性的问题**是「注释本身是否是两 token 之间唯一的那次换行」——三个文件实测 **0 处**。所以保换行是**给未来编辑上的保险，不是当前缺陷的修复**。本轮保留该规则（一条代码路径、一个保证，比两条只靠一次测量区分的路径更值得信任），代价 519 字符，并在构建注释里把措辞改成了准确版。

5. **两处诚实降级。**
   - **整包编译只有 −5.5%，而这个数字被 576 KB 壁纸摊薄。** 配对测量（`whole-paired.mjs`，N=120、逐次加盐破缓存、交替顺序）25.776 → 24.371 ms，120 轮里 99 轮更快。真正的因果量是**行为区自身**：98,094 → 45,015 字符的编译配对中位数 **5.757 → 3.320 ms（−42.3%）**，200 轮里 193 轮更快。整包比值小，纯粹因为壁纸占 75.6%。
   - **样式重算（style recalc）本轮没有改动，也不主张任何收益**：选择器一个字未改，规则数与匹配集不变。

6. **任务清单里仍然有一项无事可做。** 「用 `transform`/`opacity` 承载动画」在本仓库**依然无对象**：三张表 `@keyframes` **0 条**、触发重排的动画属性 **0 条**（详见 §7.1，与第五轮实测一致，本轮复核）。

7. **未改动项 8 条，全部给了理由**（§7）。其中体积最大的三条都属于**契约**而非优化空间：`build/plugin-toggle.js` 的 62 条注释（7,633 字符）与 `build/session-eva-status.js` 的 31 条（5,129 字符）是「这两段是上游逐字节副本」的**来源证据**，由 `cli.19`/`cli.23` 逐字匹配；构建自产的 3 条（5,422 字符）里两条是同一份证据。剥它们等于销毁门禁存在的理由。

8. **下一轮首选已有实测数字**：三个行为文件的**行首缩进**合计 **15,822 字符**（`client.js` 10,129 + `boot-screen.js` 1,531 + `model-effort-picker.js` 4,162），已用同一套扫描器证明**去掉它 token 全等、行号不变**（`dedent.mjs`）。它比注释剥离更安全——删缩进**不删任何换行**，所以 ASI 问题在这一项上**根本不存在**。本轮**未做**（见 §7.2）。

---

## 二、插件的文件结构与加载方式

### 2.1 构建链

**七个输入，一个输出，中间不做解释**（`tools/build-client.mjs` 开头即这样声明）：

| 角色 | 文件 | 处理 | 本轮 |
|---|---|---|---|
| 令牌层 | `src/tokens.json` | 55 个覆盖令牌，构建为 `--dsw-*` 声明 | 未动 |
| 绘制层 | `src/theme.css` | 93,282 字符 → 剥注释 → 收缩空白 | 未动（第五轮） |
| 启动遮罩样式 | `src/boot-screen.css` | 4,741 字符 → 剥注释 + 收缩空白 | 未动（第五轮） |
| 启动遮罩行为 | `src/boot-screen.js` | 12,281 字符 → 剥注释 | 未动（第五轮） |
| 模型选择器样式 | `src/model-effort-picker.css` | 20,108 字符 → 剥注释 + 收缩空白 | 未动（第五轮） |
| 模型选择器行为 | `src/model-effort-picker.js` | 45,755 字符 → 剥注释 | 未动（第五轮） |
| **挂载胶水** | **`src/client.js`** | 98,095 字符，**本轮起剥注释**（此前逐字节原样） | **本轮** |
| 壁纸 | `build/wallpapers.json` 或 `out/wallpapers.local.json` | 2 条，本机走 local（内嵌 data URL） | 未动 |
| 供应商件 | `build/plugin-toggle.js`、`build/session-eva-status.js` | 逐字节原样（`cli.19`/`cli.23` 钉住注释里的来源证据） | 未动 |

输出是**一个** `window.__ModuleLoader__.load({...})` 调用，即 DSH 客户端模块加载器要求的插件浏览器半形态。`client.js` 不进 git（`.gitignore`），检出后由 `prepare` 脚本重建。

### 2.2 运行时：一个样式标签，四段拼接

`src/client.js:530` 创建**唯一一个** `<style data-plugin-css>`；其文本是：

```js
shortenDataUrls(WALLPAPER_DECLARATIONS, blobUrls) + '\n' + CSS + '\n' + BOOT_CSS + '\n' + PICKER_CSS
```

四段拼进**同一个**样式表。这就是第五轮「只剥了 paint 层」的成因，也是**本轮为什么必须证明这四个常量逐字节相同**：只要它们相同，运行时那一个 `<style>` 的文本就相同，CSSOM 就相同，像素就不可能变。

### 2.3 挂载半的形态：为什么它的注释是「付费字节」

`src/client.js` 是**一个模块工厂的函数体**，被构建直接插值进 `window.__ModuleLoader__.load({ factory: () => { <这里> } })`。也就是说：

- 它**不是**被 `require` 的外部文件，**没有**独立的 `<script>` 标签，也**没有**任何加载器能在运行时跳过它；
- 它的每一个字节都在**每次加载**时进入 V8 的解析器；
- 注释对解析器**没有语义**，却占了该文件 **54.7%**。

这三条合起来，决定了它是本仓库最后一个「纯付费」的大块。

### 2.4 加载方式

`package.json` 的 `dsh.client` 声明 `platform: web`、**`immediately: true`**、依赖 6 个官方服务。桌面 profile 通过 **`link:` 符号链接**消费本仓库：

```
~/.dsh/profiles/desktop/package.json:12   "eva-inspired-theme": "link:C:/Yu/EVA-Inspired-Theme"
node_modules/eva-inspired-theme -> ../../../../../../Yu/EVA-Inspired-Theme
```

因为是链接，**重建后下次加载即生效，无需重装**。`index.js`（宿主半）只打一行日志就退出：不注册服务、不监听事件、无 HTTP 路由、不启子进程、运行时不读文件——**无需也不应在此优化**（第五轮已如此判断，本轮复核无变化）。

---

## 三、瓶颈清单

### 3.1 清单表

| # | 位置 | 问题 | 严重度 | 优化手段 | 预估/实测收益 |
|---|---|---|---|---|---|
| 1 | `src/client.js`（98,095 字符，构建插值洞 `${clientJs}`，`tools/build-client.mjs:674`） | **99 条块注释 / 53,697 字符（54.7%）随包发送，每次加载都被编译后丢弃** | **高** | 构建期 `stripBlockComments`（保换行） | **实测 −53,079 字符**；行为区编译 −42.3% |
| 2 | 三个行为文件的**行首缩进**（`src/client.js` 10,129 + `src/boot-screen.js` 1,531 + `src/model-effort-picker.js` 4,162） | 缩进对解析器无语义，纯付费 | 中 | `dedent`（去行首空白，**不删换行**） | **潜在 −15,822 字符**；已证 token 全等，**本轮未做**，见 §7.2 |
| 3 | `build/plugin-toggle.js` 的 62 条注释（7,633 字符） | 随包发送的注释 | 低（**契约**） | 不可剥 | `cli.19` 逐字匹配 `移植自 dsh-disable-unofficial-plugins v1.3.0`，剥即销毁来源证据，见 §7.3 |
| 4 | `build/session-eva-status.js` 的 31 条注释（5,129 字符） | 随包发送的注释 | 低（**契约**） | 不可剥 | `cli.23` 同理由，见 §7.3 |
| 5 | 构建自产的 3 条注释（5,422 字符：banner + 两条 vendor 来源标记） | 随包发送的注释 | 低（**契约**） | 不可剥 | banner 是 `GENERATED FILE, DO NOT EDIT`；另两条是 3/4 的同一份证据 |
| 6 | `src/theme.css` 三处重复选择器（`:81`+`:165`、`:998`+`:1152`、`:1540`+`:1579`） | 同一选择器声明块分裂 | 低 | 合并 | 顺序无关已证，**收益约 0**（151→148 条规则），**未做**，见 §7.4 |
| 7 | `src/theme.css` 若干**相同声明体**（`{background-color: transparent !important}` ×4 等） | 重复声明体 | 低 | 合并 | 多数被中间 `!important` 规则**正确拦下**；可合并者收益约 0，**未做**，见 §7.5 |
| 8 | `src/theme.css:694` 同一规则内 `backdrop-filter` 出现两次 | 看似重复属性 | **不是问题** | 不可动 | 渐进增强（`blur()` 兜底 → `url(#eva-lg-guide)`），`glass.2` 钉住次序，见 §7.6 |
| 9 | `src/theme.css` 23 处 `!important` | 看似滥用 | **不是问题** | 不可减 | 为压过宿主 CSS-Modules 哈希类名的特异性所必需，见 §7.6 |
| 10 | 三张样式表的动画属性 | 任务要求「用 `transform`/`opacity` 承载动画」 | **无对象** | 无 | `@keyframes` 0 条、触发重排的动画属性 0 条，见 §7.1 |
| 11 | 脚本拆分/延后 | 任务要求「拆分或延后非关键脚本」 | **不适用** | 无 | 产物是**一个**模块工厂 + **一个** `<style>`，没有独立脚本标签；延后启动遮罩行为会产生可见闪白，见 §7.7 |
| 12 | 静态资源压缩 | 任务要求「压缩并缓存静态资源」 | **不适用** | 无 | 本机经 `link:` 从磁盘加载，**没有 HTTP 传输层**；字体已是 `woff2`；见 §7.8 |

### 3.2 排序后的收益

```
已实现（本轮）
  ① src/client.js 注释剥离         −53,079 字符   ← 本轮全部收益都来自这一项
     └ 行为区编译                    −42.3%（配对中位数 5.757 → 3.320 ms，193/200 轮更快）
     └ 整包编译                      −5.5%（配对中位数 25.776 → 24.371 ms，99/120 轮更快；被 576 KB 壁纸摊薄）

下一轮候选（已量、已证、未做）
  ② 三个行为文件的行首缩进          −15,822 字符   ← 比 ① 更安全：不删任何换行

不可做（契约 / 无对象 / 无收益）
  ③ 供应商件注释                    12,762 字符   ← cli.19 / cli.23 钉住来源证据
  ④ 构建自产注释                     5,422 字符   ← 同上（banner + 两条 vendor 标记）
  ⑤ 重复选择器合并                  151 → 148 条  ← 收益约 0，且改级联顺序
  ⑥ 动画 / 脚本拆分 / 资源压缩      无对象
```

**结构性事实**：本轮之后，新 bundle 里**只剩 96 条块注释 / 18,184 字符**，其中**每一条都可归因**——62 条来自 `plugin-toggle.js`、31 条来自 `session-eva-status.js`、3 条由构建自产。`src/client.js` 的 99 条**在包里一条不剩**（`attribution.mjs` 实测）。

---

## 四、关键改动前后对比

### 4.1 剥离函数：本来就已存在，本轮只是多接一个洞

`tools/build-client.mjs:179`（第五轮引入，本轮未改其定义）：

```js
/* 注释替换为它自身携带的换行（不含换行时替换为一个空格），绝不替换为空 ——
   这样两个 token 不可能被并到一起。 */
const stripBlockComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
  const newlines = comment.match(/\n/g)
  return newlines === null ? ' ' : newlines.join('')
})
```

**为何等价**：一个块注释在词法上等价于「空白 + 其中的换行数」。把它换成**同样数量的换行**，则 ① 任何两个 token 之间的换行边界逐行不变（行号不变 → ASI 行为不变）；② 注释本身对解析无贡献，删掉不改变 token 流。`prove.mjs` 把这两条都测了：7,436 个 token 的 `type/value/startLine` 三元组在新旧两侧**逐条相同**。

### 4.2 模板：唯一改动的那个插值洞

`tools/build-client.mjs:670-674`：

```diff
 ${stripBlockComments(bootJs)}
 ${stripBlockComments(pickerJs)}
 ${pluginToggleJs}
 ${sessionEvaStatusJs}
-${clientJs}
+${stripBlockComments(clientJs)}
```

**为何等价**：这是模板里**唯一**改变的字节。`pluginToggleJs` 与 `sessionEvaStatusJs` 仍然原样插入（它们是契约，见 §7.3）；上方三张样式表与 `bootJs`/`pickerJs` 的表达式一字未动。因此新 bundle 与旧 bundle 的差异**只可能**来自这一个洞——这一点由 `skeleton.mjs` 独立证明（六个常量逐字节相同，骨架差异段落在偏移 5,509 处开始、在结尾前 155 字节处结束，恰好覆盖这一段）。

### 4.3 门禁：**先改门禁，再开剥离**（沿用第五轮 `cli.13` 的先例）

`cli.21` 原本的契约是「挂载半以**自身字节**进入 bundle」。剥注释必然使它失败，所以这是一个**契约变更**，不是一个构建变更。做法与第五轮改 `cli.13` 完全一致：在 `tools/selfcheck.mjs:95` 加一个**与构建同式**的变换，让门禁问「bundle 是否携带**经构建变换后**的文件」。

```diff
-checks.check('cli.21', 'the mounting half lives in src/client.js, verbatim', () => {
+checks.check('cli.21', 'the mounting half lives in src/client.js, transformed by the build', () => {
   if (!exists('src/client.js')) return 'src/client.js is missing'
   const banned = /[`]|\$\{/.exec(clientJs)
   if (banned !== null) { ... }
   const probe = "The theme's own client glue"
   if (!clientJs.includes(probe)) return 'src/client.js lost its header comment'
-  if (!client.includes(probe)) return 'the bundle does not carry src/client.js'
-  if (!client.includes(clientJs.replace(/\n$/, ''))) return 'the bundle carries a different copy'
+  const shipped = stripJsComments(clientJs.replace(/\n$/, ''))
+  if (shipped.length >= clientJs.length) {
+    return 'the strip removed nothing, so this check proves nothing about the transform'
+  }
+  if (!client.includes(shipped)) return 'the bundle carries a different copy'
   return /applyPluginToggle\(ctx\)/.test(clientJs) || 'src/client.js no longer applies the switch'
 })
```

**为何门禁的意图被保住**：它仍然是**整文件比对**（不是抽样），所以丢掉或改写任何一条语句仍然会失败；`shipped.length >= clientJs.length` 那一句是**反向探针**——如果构建某天不再剥离，比对会因为「什么都没变」而被拦下，而不是无声通过。探针字符串 `The theme's own client glue` 移到**源文件**一侧，它原本的职责（抓「头注释被删 / 文件被换成桩」）在那里依然成立。

`cli.22` 同步（`tools/selfcheck.mjs:781`）：

```diff
-  return /\$\{clientJs\}/.test(builder) || 'the template does not interpolate clientJs'
+  return /\$\{stripBlockComments\(clientJs\)\}/.test(builder) ||
+    'the template does not interpolate clientJs'
```

它问的仍然是「模板插值的是 `clientJs` 这个**变量**，不是一份重打的副本」。

### 4.4 构建注释：把上一轮的错误记述改成准确版

`tools/build-client.mjs:146` 起的 P5d 段里，原来有一段说保换行是因为「文件里有 21 处 ASI 风险位」。本段已改写为准确表述（并给出可复跑的计数）：

```diff
- * Why this file needs the newline-preserving form: it holds 21 sites where a line does
- * not end in a terminator and the next line starts with a token that could continue the
- * expression ...
+ * Why this file uses the newline-preserving form. The rule is INSURANCE, not a fix for a
+ * defect: the case that would actually matter is a multi-line comment that supplies the
+ * ONLY line break between two tokens that would otherwise join, and this file has ZERO of
+ * those (so do the other two). A looser census — a line that does not end in a terminator
+ * while the next line starts with a continuation token — counts 21 here, but it counts
+ * ordinary intentional multi-line code, and stripping a comment cannot change any of it.
```

**为何等价**：这是注释，只影响可读性。改动后四道门禁**全绿**，bundle 字符数与 boot mark 均未变（见 §5.6）。

---

## 五、行为不变说明（等价性证据）

### 5.1 逐 token 比对（最强的一条）

`prove.mjs`，用同一个扫描器扫原文与剥离后文本，比较每个 token 的**类型 / 行号 / 取值**：

| 文件 | 字符 | 行数 | token 数 | token 差异 | 判定 |
|---|---|---|---|---|---|
| `src/client.js` | 98,095 → 45,016 | 1,768 → 1,768 | 7,436 → 7,436 | **0** | PASS |
| `src/boot-screen.js` | 12,281 → 8,625 | 290 → 290 | 1,486 → 1,486 | **0** | PASS（第五轮已证，本轮复核） |
| `src/model-effort-picker.js` | 45,755 → 28,465 | 1,074 → 1,074 | 5,902 → 5,902 | **0** | PASS（同上） |

**行号是关键**：ASI 读的就是行边界。行号逐条不变，意味着 `return` / `throw` / 续行括号等受限产生式的行为**不可能**改变。

### 5.2 扫描器的可信度（先证明尺子是准的）

`prove.mjs` 用的是本项目自写的 tokenizer，所以它自己也要被检验。`audit-prove.mjs` 用一条**不可能性判据**：JavaScript 的字符串字面量**不能**包含未转义的换行，所以只要扫描器把任何「字符串」token 读成含裸换行，就说明它在某处（通常是正则字面量）失步，其结论不可信。

```
src/client.js                tokens   7436   impossible string tokens: 0   <-- clean
src/boot-screen.js           tokens   1486   impossible string tokens: 0   <-- clean
src/model-effort-picker.js   tokens   5902   impossible string tokens: 0   <-- clean
```

（背景：本项目**先前自写的另一个扫描器**在这个检验下暴露了 13 条不可能 token，其结论已被**丢弃而非辩解**——这正是为什么这条检验被保留下来。）

**独立佐证**：剥完的文本写入磁盘后过 `node --check`，三个文件**全部 ok**。这一条不依赖任何自写扫描器。**诚实的边界**：`src/client.js` 是模块工厂的**函数体**，`--check` 按**脚本**解析它，所以它证明的是「仍然可解析」，**不是**「token 相同」——后者由 §5.1 负责，前者独立成立。

### 5.3 骨架比对：改动只发生在一个洞里（实测，非重构）

`skeleton.mjs` 把两个 bundle 里每个 `var NAME = <字面量>` 常量替换成占位符，然后比对骨架：

```
六个常量：baseline 605,853 字符   new 605,853 字符   逐字节相同: true
骨架：    baseline 209,530 字符   new 156,451 字符   −53,079（−25.33%）
第一个不同的字节：骨架偏移 5,509（之前 5,509 字节完全相同）
变化段落：baseline 203,866 → new 150,787，移除 53,079
段落之后：155 字节完全相同
```

**这是「改动范围」的直接测量**，而不是对构建模板的推理。它同时闭合了字符账：`53,079` 与 bundle 总差**完全相等**。

### 5.4 浏览器 CSSOM 层：样式表逐字节相同

`visual.mjs` 从两个 bundle 里取出每一个样式表常量并逐字节比对：

```
ok   CSS                     10351 chars  byte-identical
ok   BOOT_CSS                 2985 chars  byte-identical
ok   PICKER_CSS               9883 chars  byte-identical
ok   WALLPAPER_DECLARATIONS 576543 chars  byte-identical
ok   TOKENS                   4131 json chars  byte-identical
ok   MANIFEST                 1823 json chars  byte-identical

推导：运行时安装的 <style> 文本
  baseline style text : 599765 chars
  new      style text : 599765 chars
  ok   安装的样式表逐字节相同
       => CSSOM 相同 => 每个计算样式相同 => 不可能有任何像素不同
```

`TOKENS` 与 `MANIFEST` 虽不进 `<style>`，也一并比对（`TOKENS` 是 55 个覆盖令牌，`MANIFEST` 是插件清单）。

### 5.5 本轮**未触碰**的输入（必须逐字符相同）

| 输入 | 本轮处理 | 新旧字符数 | 相同 |
|---|---|---|---|
| `src/theme.css` | 无（第五轮已剥注释 + 收缩空白） | 10,351 | ✔ |
| `src/boot-screen.css` | 无（同上） | 2,985 | ✔ |
| `src/model-effort-picker.css` | 无（同上） | 9,883 | ✔ |
| `src/boot-screen.js` | 无（第五轮已剥注释） | 8,625 | ✔ |
| `src/model-effort-picker.js` | 无（第五轮已剥注释） | 28,465 | ✔ |
| `build/plugin-toggle.js` | 无（原样） | 逐字节 | ✔ |
| `build/session-eva-status.js` | 无（原样） | 逐字节 | ✔ |

五张「会被解析的输入」小计 **60,307 字符**，两侧一致——**第五轮的收益原封不动**，本轮的 −53,079 是在此之上**新增**的。

### 5.6 未改变的运行时行为（门禁与产物）

| 证据 | 结果 |
|---|---|
| `node tools/build-client.mjs` | `wrote client.js 762226 chars (775941 bytes) 55 tokens 2 wallpapers from out/wallpapers.local.json css 93282 chars (11865 after the comment strip, 10351 after comment+whitespace) wallpaper block 576543 chars boot mark eva-boot/3359114a` |
| `node tools/build-client.mjs --check` | `client.js check: OK (in sync with src/, 762226 chars, 55 tokens, 2 wallpapers from out/wallpapers.local.json)` |
| `node tools/selfcheck.mjs` | `120 assertions, 0 failed, 120 passed` / `all green` |
| `node tools/token-audit.mjs` | `AUDIT OK — 55 overrides, exactly the planned 55 (A 41 + B 14); no component-level override; no unchanged token.` |
| `node --check client.js` / `index.js` | 通过 |
| 注册点 | `src/client.js` 的 **7 处 `ctx.effect(`** 与 **1 处 `ctx.inject(`**、`apply(ctx)` 入口、`exports` 形状均未变（逐 token 比对已证：token 流未变，注册点数量与位置因此不变） |

**55 个令牌逐字节相同**、**2 张壁纸的 data URL 逐字节相同**、**boot mark 只按构建输入的正常方式变化**（它是 `sha256(bundle)[0..8]`，任何源码变化都会移动它，这不属于等价性主张的一部分）。

### 5.7 结论

**像素不可能改变。** 两条路径都封死了：
- **绘制路径**：运行时那一个 `<style>` 的文本逐字节相同（§5.4）→ CSSOM 相同 → 计算样式相同。
- **行为路径**：挂载半的 token 流、行号、注册点完全相同（§5.1、§5.3）→ 它写进 DOM 的属性、类名、结构与时序相同。

本轮**没有**触碰任何选择器、任何声明值、任何 `!important`、任何动画属性、任何脚本执行时序。

---

## 六、验证方式

### 6.1 建议的 DevTools 面板

| 面板 | 看什么 | 期望 |
|---|---|---|
| **Sources → Coverage** | `client.js` 的已用字节点 | 未用比例下降；注释区不再出现在源码视图里 |
| **Performance（录制加载）** | `Compile Script` / `Parse HTML` 阶段的 `client.js` 条目 | 该条目时长下降；**帧率与首帧时间不变** |
| **Performance → Bottom-Up** | `Compile Script` 自身耗时 | 行为区编译减少约 42%（配对测量），整包约 5% |
| **Elements → Styles** | `<style data-plugin-css>` 的规则树 | **规则数、顺序、声明值逐一不变** |
| **Elements → Computed** | 与旧版逐项对比 | **必须完全一致**（这是「零像素」的直接检验） |
| **Rendering → Paint flashing** | 加载与交互 | 重绘区域不变 |
| **Layers** | 合成层数量与位置 | 不变（本轮未加 `will-change`、未建层） |
| **Lighthouse（Performance）** | 总评分与 TBT | 不主张改善；TBT 受壁纸与宿主主导 |

### 6.2 回归检查项（自动，已全绿）

```bash
cd C:/Yu/EVA-Inspired-Theme
node tools/build-client.mjs           # 期望：762226 chars / 775941 bytes / boot mark eva-boot/3359114a
node tools/build-client.mjs --check   # 期望：client.js check: OK (in sync with src/, 762226 chars ...)
npm run verify                        # 期望：node --check ×2、120/120、AUDIT OK、--check OK
node tools/selfcheck.mjs              # 期望：120 assertions, 0 failed, 120 passed / all green
node tools/token-audit.mjs            # 期望：AUDIT OK — 55 overrides, exactly the planned 55 (A 41 + B 14)
```

关键的门禁是 **`cli.21`**（新的变换后整文件比对 + 反向探针）、**`cli.22`**（模板插值表达式）、**`cli.13`/`cli.13b`**（三张样式表的注释与空白性质，第五轮新增），以及 **`boot.1`/`boot.2`/`boot.3`**（启动遮罩行为文件，本轮未动其内容，门禁只需保持绿）。

### 6.3 建议的人工对比截图

自动化能证明「CSSOM 相同」，人眼检查仍值得做一次，覆盖**真实 Electron 窗口**而非浏览器：

| 场景 | 对比点 |
|---|---|
| 冷启动 | 启动遮罩出现的时机、时长、文本（boot mark 变化会导致**这一次**遮罩重新播放——**这是设计行为**，不是回归） |
| 侧栏 | 会话行状态轨、置顶行彩虹标题、工作区行（**含微信按钮**） |
| 输入区 | 模型选择器的两个控件（模型 / 推理档）布局与悬停态 |
| 输入区玻璃 | 玻璃边的折射、`url(#eva-lg-guide)` 是否生效 |
| 设置弹层 / 快捷键弹层 | 是否仍然被压制（23 处 `!important` 的对象） |
| 明暗两档 | 各看一遍；`data-ds-dark-theme` 规则未动 |
| 窗口拖拽态 | `[data-window-drag='true']` 下的品牌名按钮 |

### 6.4 复现脚本（作业区，只读）

```
C:\Work\scratch\eva-perf4\
  prove.mjs        逐 token 比对（本轮最强证据）
  audit-prove.mjs  扫描器的可信度检验（不可能性判据）+ node --check 佐证
  skeleton.mjs     骨架比对：改动只发生在一个插值洞
  visual.mjs       样式常量逐字节比对 + 运行时 <style> 文本推导
  attribution.mjs  剩余注释归因（证明 client.js 的 99 条一条不剩）
  final-numbers.mjs 本报告引用的每一个数字，一次跑出
  dedent.mjs       下一轮候选（行首缩进）的 token 等价性证明
  region.mjs       行为区编译的配对测量（−42.3%）
  whole-paired.mjs 整包编译的配对测量（−5.5%，破缓存）
  q1q2.mjs         ASI 记述订正的两个计数（21 / 0）
  figures.mjs      注释条数与质量的清点
```

---

## 七、未改动项及原因

### 7.1 动画属性：仍然无对象可优化

任务要求「用 `transform`/`opacity` 承载动画」。本轮复核三张样式表：

| 表 | `@keyframes` | `transition` | `animation` | `will-change` | 布局类动画属性 |
|---|---|---|---|---|---|
| `src/theme.css` | 0 | 2 | 0 | 0 | **0** |
| `src/boot-screen.css` | 0 | 0 | 0 | 2 | **0** |
| `src/model-effort-picker.css` | 0 | 7 | 0 | 0 | **0** |

- theme 的 2 条在 `src/theme.css:861`（`transition: background-color 140ms linear`）与 `:867`（`transition: none`，reduced-motion 关闭）。`background-color` **只触发绘制**，不触发布局。
- picker 的 7 条属性为 `background-color` / `border-color` / `transform`——前两者是**绘制类**，后者是**合成类**。
- boot 的 2 处 `will-change: transform`（`src/boot-screen.css:36`、`:137`）位置正确：启动遮罩是唯一真正全视口动画的部件。

**结论：改成 `transform`/`opacity` 无可改对象；强行增加 `will-change` 会常驻显存并扩大合成层，属负优化。未做。**

### 7.2 三个行为文件的**行首缩进**（15,822 字符，下一轮首选，未做）

这是本轮量出来、证明完、但**故意留给下一轮**的一项，理由是本轮范围应与上一轮报告 §7.2 承诺的**唯一一项**一致，避免一次改动承担两个独立风险。

**已完成的测量与证明**（`dedent.mjs`）：

| 文件 | 剥离后 | 去行首缩进后 | 省 | 行数 | token 差异 | 判定 |
|---|---|---|---|---|---|---|
| `src/client.js` | 45,015 | 34,886 | 10,129 | 1,767 → 1,767 | **0** | PASS |
| `src/boot-screen.js` | 8,624 | 7,093 | 1,531 | 289 → 289 | **0** | PASS |
| `src/model-effort-picker.js` | 28,464 | 24,302 | 4,162 | 1,073 → 1,073 | **0** | PASS |

**为什么它比注释剥离更安全**：去行首空白**不删任何换行**，所以 §一.4 里那个「注释是否是两 token 之间唯一换行」的问题在这一项上**根本不存在**——ASI 的前提被结构性消除。前置条件也已逐条查过（三个文件：反引号 0、行注释 0、反斜杠续行 0、跨行字符串 0）。

**它的前置工作是改门禁**：`cli.21` 现在的比较是「bundle 是否包含 `stripJsComments(clientJs)`」；一旦再去缩进，这条比较要再变成「经两个变换后的文件」，做法沿用本轮与第五轮的同一先例。**未做。**

### 7.3 两件供应商件与构建自产注释：剥它们会销毁契约

| 来源 | 注释条数 | 字符 | 为什么不能剥 |
|---|---|---|---|
| `build/plugin-toggle.js`（切片入包） | 62 | 7,633 | `cli.19` 逐字匹配 `移植自 dsh-disable-unofficial-plugins v1.3.0` |
| `build/session-eva-status.js`（切片入包） | 31 | 5,129 | `cli.23` 逐字匹配 `移植自 dsh-session-eva-status v0.1.0` |
| 构建自产（banner + 两条 vendor 标记） | 3 | 5,422 | banner 是 `GENERATED FILE, DO NOT EDIT`；另两条是上两行的同一份证据 |

这两条门禁存在的**全部意义**就是证明「这两段是上游逐字节副本（MIT，同一作者）」。剥掉注释即**销毁证据本身**——这是许可证与溯源问题，不是体积问题。**未做。**

（注：`build/plugin-toggle.js` 与 `session-eva-status.js` 是**被切片的**——只有 factory 体入包。所以「文件里 63 条 / 包里 62 条」与「32 条 / 31 条」的差 1 条，是切在 body 之外的那一条。）

### 7.4 三处重复选择器：安全但收益约 0

| 选择器 | 位置 | 已证 |
|---|---|---|
| `body` | `:81` + `:165` | 移动 `background-color`/`background-image` 到 `:81` **顺序无关**（中间只有 `body[data-ds-dark-theme]`，声明的是别的属性） |
| `[data-window-drag='true'] button:has([data-slot='sidebar.brand.name'])` | `:998` + `:1152` | 移动 `-webkit-app-region` 安全（中间 2 条规则均不声明它） |
| `[data-slot='settings.launcher'] > button` | `:1540` + `:1579` | 移动 `display` 安全（中间 0 条规则） |

方法与第五轮相同：**只比较被移动的属性**与严格位于两者之间的规则（早期一版工具比较的是两条规则属性的**并集**，因而误报冲突；那版结论已作废）。

**未做**：三处合计把 151 条规则减到 148 条，**运行时收益约等于 0**（同样的声明、同样的匹配），而移动规则位置会改动级联顺序，属**无收益而承担风险**。**未做。**

### 7.5 相同声明体的合并：多数被正确拦下，可合并者收益约 0

`consolidate.mjs` 的判定（拦下条件是「锚点与目标之间存在声明同一属性、且特异性不低于锚点的 `!important` 规则」）：

| 声明体 | 位置 | 判定 |
|---|---|---|
| `{display: none !important}` ×9 | `:309`/`:506`/`:1014`/`:1390`/`:1579`/`:1582`/`:1650`/`:1653`/`:1656` | **拦下**（中间存在 `!important` 的 `display` 规则） |
| `{content:''; position:absolute; inset:0; z-index:-1; border-radius:inherit; pointer-events:none}` ×2 | `:592`/`:1823` | **拦下**（`:652` 处 `!important`，特异性 202 ≥ 锚点 100） |
| `{display: none}` ×5 | `:967`/`:985`/`:1984`/`:1988`/`:1992` | **拦下**（同第一行） |
| `{background-color: transparent !important}` ×4 | `:234`/`:278`/`:534`/`:588` | 安全，**收益约 0** |
| `{position: relative; background-color: transparent !important}` ×2 | `:689`/`:1818` | 安全，**收益约 0** |

**工具局限记录在案**：`precise.mjs`/`consolidate.mjs` 的特异性函数是**对整个逗号选择器列表字符串**计算的，对 `src/theme.css:234` 那种长列表会**高估**锚点特异性。因此：
- 「拦下」的四组结论**不依赖特异性精度**（它们靠的是「中间存在同属性 `!important`」这一事实）——可信；
- 「安全」的两组结论**成立但收益约 0**，且任何**新一轮**合并类优化，必须先实现「按逗号成员取最大值」的特异性，才能信任其结论。

本轮**没有基于这个工具做任何改动**，故不影响结论。**未做。**

### 7.6 两处「看起来有问题、实际不是问题」

- **`src/theme.css:694` 同一规则内重复属性**：`[data-sidebar-right-guide-entry]::before` 里 `-webkit-backdrop-filter` 与 `backdrop-filter` 各出现两次——先是 `blur()` 兜底，后是 `url(#eva-lg-guide)` 增强。这是**渐进增强的既定写法**，由门禁 `glass.2` **钉住次序**（第一/二轮 D65 的决定）。合并会破坏在不支持 `url()` 滤镜的引擎上的兜底。**未做。**
- **23 处 `!important`**（`theme.css` 23、boot 0、picker 0）：为了压过**宿主应用自身**的特异性而必需（宿主用 CSS-Modules 哈希类名，主题只能靠 `!important` 或 `data-slot` 提升）。逐条重算特异性并验证匹配集属**改视觉风险，无收益**。**未做。**

### 7.7 脚本拆分 / 延后：产物形态不支持，且会改加载时序

`package.json` 声明 `immediately: true`，产物是**一个**模块工厂 + **一个** `<style>`，**没有独立的 `<script>` 标签**可以 `defer`/`async`。把启动遮罩行为延后会让它晚于遮罩样式生效，**产生可见闪白**——正是第一轮要解决的问题。**未做。**

（`src/client.js` 内部的 `defer()` 是**另一个话题**：它是 2026-10-16 为修「工作区旁的微信按钮消失」而加的 `requestIdleCallback` + 200 ms 定时器兜底，属于**行为修复**，与本轮体积优化无关，本轮未碰。该改动在 `git diff` 里体现为 `src/client.js` 的 +35/−7。）

### 7.8 静态资源压缩：无 HTTP 层，字体已是压缩格式

- 字体 `build/great-vibes-latin.woff2` **42,800 字节**，`woff2` 本身即压缩容器，再压收益极低。
- 三张品牌图 49,860–57,715 字节，属正常量级；重编码是**有损且有视觉风险**的操作。
- 本机经 `link:` 从磁盘加载，**没有 HTTP 传输层**可施加 gzip/brotli；宿主如何注入不在本仓库控制范围。
- 真正的体积大头是 **576,543 字符的壁纸 data URL**（占新 bundle **75.6%**）。它已经在做本仓库能做的最优处理——构建期编码为 data URL，运行时 `shortenDataUrls` 重声明为 `blob:` URL 以避免约 8.6 ms 的全文档重算；再缩体积需要换量化位数或改图，**都是视觉变化**。

**未做。**

### 7.9 与第五轮报告的两处数字对账（差额已解释）

| 第五轮 §7.2 的预估值 | 本轮实测 | 差额原因 |
|---|---|---|
| `src/client.js` 96,836 字符 / 98 条注释 / 53,159 字符 | 98,095 字符 / **99 条** / **53,697 字符** | 文件在两次报告之间**长大了 1,259 字符**：2026-10-16 的微信按钮 `defer()` 修复（+35/−7）新增了一条注释块与若干空行。两次测量都在各自时点准确。 |
| 净收益约 −52,553 字符（保换行代价 +508） | **−53,079 字符**（保换行代价 **+519**，行数 1,767 不变） | 同上：源文件变大，故绝对收益也变大。代价的 519 与实际一致（差额 11 来自行数口径：第五轮记 1,740 行，实测 1,767 行）。 |
| 「含 21 处 ASI 风险位」 | **该 21 数错了对象**；真正决定安全的计数是 **0** | 见 §一.4。第五轮报告作为**当时的事实**按本仓库的追加式惯例**保留不改写**，订正记在本报告中。 |

---

## 八、复现命令

```bash
# 构建（输出新的字符数）
cd C:/Yu/EVA-Inspired-Theme
node tools/build-client.mjs

# 全量门禁（120 项）
npm run verify

# 等价性证明（脚本在作业区，只读）
node C:/Work/scratch/eva-perf4/prove.mjs          # 逐 token：7436/1486/5902 全等，差异 0
node C:/Work/scratch/eva-perf4/audit-prove.mjs    # 扫描器可信度 + node --check
node C:/Work/scratch/eva-perf4/skeleton.mjs       # 骨架比对：改动只落在一个插值洞
node C:/Work/scratch/eva-perf4/visual.mjs         # 样式常量逐字节相同 → <style> 文本相同
node C:/Work/scratch/eva-perf4/attribution.mjs    # 剩余注释归因（client.js 99 条一条不剩）
node C:/Work/scratch/eva-perf4/final-numbers.mjs  # 本报告引用的每一个数字
node C:/Work/scratch/eva-perf4/q1q2.mjs           # ASI 记述订正的 21 / 0
node C:/Work/scratch/eva-perf4/dedent.mjs         # 下一轮候选（行首缩进）的 token 等价性
```

成对编译测量（真实 V8，逐次加盐破缓存、交替顺序）：

```
C:/Work/scratch/eva-perf4/region.mjs        行为区：5.757 -> 3.320 ms（−42.3%，193/200 轮更快）
C:/Work/scratch/eva-perf4/whole-paired.mjs  整包：  25.776 -> 24.371 ms（−5.5%，99/120 轮更快；被 576 KB 壁纸摊薄）
```

**改动范围**：**本轮只改了 2 个文件**——`tools/build-client.mjs`（+120/−7）与 `tools/selfcheck.mjs`（+85/−10）。

`src/` 与 `build/` 下的**输入文件本轮一个字节未改**。工作区里另有 `src/client.js` 与 `.gitignore` 处于修改状态，两者都**不属于本轮**：前者是 2026-10-16 的微信按钮 `defer()` 行为修复（§7.7 说明），后者是凭据忽略规则的补齐。`client.js` 产物不在 git 内（`.gitignore`）。

```diff
 tools/build-client.mjs | 120 +++++++++++++++++++++++++++++++++++++++++---
 tools/selfcheck.mjs    |  85 ++++++++++++++++++++++++++++++++++++++---
 2 files changed, 205 insertions(+), 17 deletions(-)
```
