# EVA 主题卡顿复现与第二根因归因（2026-10-11 第二轮）

对象：`C:\Yu\EVA-Inspired-Theme`（DSH 客户端主题，v1.0.0）
背景：上一轮修掉「每批 DOM 变更触发 4 次全文档 `querySelectorAll`」的放大链（123 次/秒 → 0）后，用户复现「启用 EVA 主题后依然特别卡」。
本轮目标：复现灾难态、给出第二根因、量化到毫秒与频次、区分因果与相关、给出最小复现与可量化基线。

**本轮未修改任何主题源码。** 桌面 profile（`~/.dsh/profiles/desktop/`）与 DSH 本体（`app.asar`）全程只读；全部临时仪器写在 `C:\Work\scratch\`。

> **第三轮（同日）收尾见 §十一**：按用户点名实施了 **C1 + C2**（C1 保留一行式回退，并由门禁 `glass.1` 钉住回退路径）、补做**真实流式负载**倍数测量，并对实施后的**新旧样式表做同页配对复测**。其中包含一条对 §3.7 **绝对单价的降级修正**（本轮不可复现）。

---

## 一、结论先行

1. **复现了，但不是死循环。** 桌面实况：DSH renderer 进程（pid 17132）在 94 秒窗口内烧 **133.4% 单核**、RSS 1065 MB；线程级拆分显示**恰好 2 个线程在跑**（tid 2004 = 62.9%、tid 25784 = 44.8%，均 `Running`），其余 30 个线程等待。**这不是「单线程 JS 死循环」的签名**（那会是一条约 100% 的曲线），更像主线程与另一线程的高频往返。
2. **第二根因是「每帧计费」的合成/栅格开销，不在 JS 里，也不在上一轮的查询链上。** 8.85 秒主线程 profile：`TaskDuration` 2078 ms（占墙钟 23%）、**`ScriptDuration` 仅 57 ms（0.6%）**、`LayoutCount` **0**、`RecalcStyleCount` 989（112/s，耗时 195.7 ms）、堆 39 MB；自耗时榜首是 `(idle) 910.4 ms / 85.7%`，`requestAnimationFrame` 只有 4.2 ms。
3. **主题是放大器，不是触发器。** 同一页面、同一浏览器、同一秒级采样：EVA 开 = renderer **396 ms/s**，EVA 关 = renderer **157 ms/s**（2.5 倍）；但**关掉主题后页面照样在烧** 157 ms/s、GPU 进程约 1000 ms/s（饱和）。持续产帧的源头在应用/环境层，不在 EVA 代码里。
4. **放大器的落点只有一处**：输入卡的 `backdrop-filter` 链 —— `src/theme.css:352-363` 的 `[data-composer-card]::before`，计算值 `url("#eva-lg-input") blur(4px) saturate(135%)`。同页同轮消融：**整条玻璃链 = 约 +144 ~ 147 ms/s 渲染器 CPU（+120 ms/s GPU）**，其中 **SVG 位移滤镜 `url(#eva-lg-input)` 一项约占 +98 ms/s**（占主题在该页开销的约 30%）。
5. **已排除的（都有测量）**：查询放大链（已修，主题侧文档级查询现为 0）、启动遮罩（`EVA-Inspired-Theme/boot/seen` 已置位，永不重播）、微信分组点击环（`wxOn` 不落盘、默认 false）、观察者/微任务死循环（12 秒内 **0** 条 DOM 变更）、图层爆炸（全页**只有 1 个** backdrop 面）、壁纸与 veil 两层 fixed 全视口层（消融后无成本变化）、ego 的画面捕获（停播无变化）、devicePixelRatio（强制 2 无收益）、内存泄漏（RSS 在 918.9 → 1065 → 1107 → 1079 MB 之间churn，非单调增长）。
6. **第二个放大器（本轮新增，与玻璃同量级）**：主题样式表让**每一次全文档样式重算**从 **11.5 ms 涨到 25.5 ms（×2.2）**。同一页、同一负载、只切换 `style[data-plugin-css^="EVA-Inspired-Theme"].disabled`：负载 FPS **39 → 17–19**；A/C 两相同表复现差 ≤2%。其中**含 `:has()` 的 17 条规则独占每次重算约 7.4 ms（约 27%）**（剔除后 FPS 15 → 21），其余约 8.5 ms 摊在另外 75 条规则上。证据见 §3.7。
7. **两个候选修复（均未实施，等用户点头）**：(a) 玻璃链去掉 `url(#eva-lg-input)` → 预计 **−98 ms/s 渲染器**（视觉：失去折射位移，磨砂与着色不变）；(b) 收窄/改写 `:has()` 主语（尤其 5 条裸 `div:has(...)`）→ 预计 **−约 7 ms/次重算**（视觉可做到零变化，须逐条验证匹配集）。
8. **第三轮（同日，用户点头后）已实施 C1 + C2。** C1：玻璃链去掉 `url(#eva-lg-input)`，只留 `blur() saturate()`；C1 的**一行式回退**保留，并由门禁 `glass.1` 改写为**钉住回退路径**（先断言 `src/client.js` 仍构建 `eva-lg-input`，再断言构建数 == 2）。C2：5 条裸 `div:has(...)` 里**收窄 4 条**（`:243`、`:509`、hero 两条藏元素、hero 两条加 `[data-phase='hero']` 门），`:615`（设置弹层）因**镜像打不开设置弹层、且无证据表明它挂在 `shell.overlay`** 而**有意保留**。门禁 **117 项 0 失败**，`client.js` 重建 761388 chars。改动后**命中集与计算值逐项等价**（`:509` 在带 3 个真代码块的真实会话页上实测同集 `[1101,1337,1573]`）。详见 §十一。
9. **补做的真实负载测量：重算单价 ON/OFF = 1.40×（下界）。** 同实例同一提示词的真实流式回复下：已发布表 **0.350 ms/次重算**（151 次/s，净 **+15 ms/s** 主线程）、主题表清空 **0.250**；只回退 C1 为 0.406（1.62×）。FPS 145.6 vs 147.5（~160 Hz）**在噪声内，无可见掉帧**。⇒ **§3.7 的 2.2× 应读作「合成最坏失效面」的读数，不是真实流式的恒定倍数**。
10. **诚实修正：§3.7 的绝对单价本轮不可复现。** 在真机会话页（1865 元素、3 个真代码块）上用三种负载复测——弱负载、SL（body 属性 + 侧栏行属性 + 对话区内追加/裁剪）、**SL2（把追加 host 顶到 `document.body` 直接子节点＝最大失效面）**——单次重算价落在 **0.053–0.067 ms**，与 §3.7 的 4.52 / 25.5 ms 差 **70–85 倍**，且**新旧表无可测差异**（SL2 四相：新 0.056/0.054、旧 0.056/0.053 ms）。⇒ §3.7 的**绝对量级降级为「负载形态相关、未复现」**；`:has()` 切片的**相对结论保留**（当轮同页配对），**绝对常数不保留**。细节见 §11.5。

---

## 二、测量环境

### 2.1 桌面实况（只读）

| 项 | 值 |
|---|---|
| EVA 状态 | **已启用**（`~/.dsh/profiles/desktop/cordis.patch.yml:363-364` = `- id: eva-inspired-theme` / `disabled: false`，mtime 2026-10-11 14:38:07） |
| 桌面重启 | 14:38:22–14:38:36（进程 StartTime）→ 加载的是 14:29:33 重建后的 `client.js`（**旧构建已排除**） |
| renderer | pid 17132，`--type=renderer --user-data-dir=…\@deepseek-ai\dsh-desktop --enable-sandbox --device-scale-factor=2 --num-raster-threads=4` |
| GPU / 宿主 | gpu-process pid 23864；宿主 node pid 30896（监听 19387） |
| bundle 数 | 29（含 dsh-pet、dsh-smooth-stream、dsh-better-sidebar、dsh-wechat-plugin、…） |
| CDP | **无 `--remote-debugging-port`**，19387/json/version = 404 → 桌面 renderer 无法挂 JS 级剖析 |

### 2.2 受控镜像（可 CDP）

* `dsh --profile eva-preview --no-open --port 19391` → **主题开**（该 profile 仅 3 个 bundle：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`EVA-Inspired-Theme`）。
* `C:\Work\scratch\run-web-patched.ps1 -Port 19392 -Profile eva-preview -Patch C:\Work\scratch\eva-off.patch.yml` → **主题关**（`- id: eva-inspired-theme` / `disabled: true`；不改任何 profile 文件）。
* 被测页：同一个「已完成」长会话 `session-c93af668`（3689 个元素），非直播状态。
* 浏览器为 ego-lite 的 Helium；页面渲染在 **renderer pid 23052**（用 3.5 秒阻塞忙循环注入标定：只有它在三个秒窗各烧 ≈1000 ms），GPU = pid 7332。
* 采样器 `C:\Work\scratch\eva-proc-tree.ps1`（约 1.8 s/样本，按真实墙钟归一为 ms/s）。

**噪声声明**：桌面实例自身持续烧 1.3 核，与 ego 的 ~2 核（GPU 饱和）争抢 CPU，跨轮绝对数值会漂移 ±30%。因此本报告只采用**同一轮内的配对对比**，并保留 A/F 对照相（下文多次出现，复现差 ≤0.7%）。

---

## 三、基线数据

### 3.1 灾难态（桌面实况，EVA 开启）

| 进程 | 窗口 94 s | 说明 |
|---|---|---|
| renderer 17132 | **133.39% 单核**（125391 ms），RSS 1065 MB（窗口内 +110 MB） | 用户可感知的卡顿源 |
| gpu-process 23864 | 48.47% 单核，359 MB | |
| 宿主 30896 | 5.72%，466 MB | |
| 线程（另一 15 s 窗口，总 111%） | tid 2004 = **62.9%** `Running`；tid 25784 = **44.8%** `Running`；第三名 1.4%；`Running 2 / Wait 30` | 双线程乒乓，不是单线程死循环 |

### 3.2 同一页面 ON / OFF 配对（受控镜像，唯一变量是主题）

| 指标 | EVA **开**（19391） | EVA **关**（19392） | 差值 |
|---|---|---|---|
| renderer CPU | **396 ms/s**（39.6%） | **157 ms/s**（15.7%） | **+239（×2.5）** |
| GPU 进程 | 1095 ms/s | 799 ms/s | +296 |
| 元素数 | 3689 | 3670 | ≈0 |
| 正文长度 | 6504 | 6565 | ≈0 |
| 主题旗标 | evaCss 1 / statusCss 1 / backdrop 面 1 / glassDefs 1 / pin 3 / wx 1 | 全 0 | — |
| 运行中的动画 | 0 | 0 | 0 |

### 3.3 主线程 profile（EVA 开，8.85 s，100 µs 采样）

| 指标 | 值 |
|---|---|
| `TaskDuration` | 2078 ms（墙钟 23%） |
| **`ScriptDuration`** | **57 ms（0.6%）** |
| `LayoutCount` / `LayoutDuration` | **0** / 0 |
| `RecalcStyleCount` / `RecalcStyleDuration` | 989（112/s） / 195.7 ms |
| `JSHeapUsedSize` | 39 MB |
| 自耗时 Top | `(idle) 910.4 ms / 85.7%`、`(program) 146.2 ms / 13.8%`、`requestAnimationFrame 4.2 ms / 0.4%`、`loop @ (native):29 1.0 ms`、`querySelector 0.6 ms` |
| 12 秒内 DOM 变更 | **0 批 / 0 条**（`MutationObserver` 覆盖 childList+subtree+attributes+characterData） |
| rAF 回调 | 1922 次 / 12 s（= 160 Hz 显示器的 vsync 供帧，**不等于合成器画了 160 帧**） |

### 3.4 每帧定价（同一静止重页，20 s 一相，同一轮）

| 相位 | renderer ms/s | GPU ms/s |
|---|---|---|
| A 原样 `url(#eva-lg-input) blur(4px) saturate(135%)` | **330** | **561** |
| B 只留 `blur(4px) saturate(135%)`（去 SVG 位移） | **232** | 440 |
| C `backdrop-filter:none !important` | **183** | 440 |
| D 杀壁纸（该选择器 0 命中 = 空操作，**对照**） | 328 | 532 |
| E 复原 | 328 | 497 |

**玻璃链 ≈ +147 ms/s 渲染器、+120 ms/s GPU；其中 SVG 位移滤镜 ≈ +98 ms/s。A 与 D 差 0.6%，说明该轮测量可重复。**

### 3.5 背景层与玻璃的交互消融（25 s 一相，第二轮，A/F 对照）

| 相位 | renderer ms/s | GPU ms/s |
|---|---|---|
| A 基线 | 456 | 1033 |
| B 关壁纸图（`body::before{background-image:none}`） | 441 | 1039 |
| C 关 veil（`body::after{display:none}`） | 478 | 1010 |
| D 两者都关 | 418 | 973 |
| **E 只关玻璃**（`[data-composer-card]::before{backdrop-filter:none}`） | **312** | 995 |
| F 复原（对照） | 459 | 1052 |

**结论：壁纸与 veil 两层全视口 fixed 层本身**没有可测成本**（B/C/D 都在噪声内）；玻璃成本是 `backdrop-filter` 链自身的固有代价，与「背板是固定艺术层」无关（该假设被否）。A/F 差 0.7%。**

---

## 四、检查清单（用户第二步逐项）

| 项 | 结论 | 证据 |
|---|---|---|
| 高频 rAF 循环 | **无**（rAF 自耗时 4.2 ms / 8.85 s；无应用侧 rAF 热函数） | 3.3 |
| CSS 关键帧动画 | **有但未触发**；呼吸轨由 `background` 改为 `opacity`（上一轮），本页 `getAnimations()` = 0 | `build/session-eva-status.js:209-211` |
| 未节流 scroll/resize/mousemove | **无**（主题不订阅这三者；ResizeObserver 仅在尺寸变化时重画位移贴图） | `src/client.js:250-256` |
| 定时器未清理 | **无泄漏**；启动遮罩双时钟已在上一轮收敛，`bootClearTimers()` 两个时钟都清 | `src/boot-screen.js:83-86` |
| DOM 频繁读写 / 强制同步布局 | **无**；12 s 内 0 变更、`LayoutCount` 0、`getBoundingClientRect` 全页 0 次（本页） | 3.3 |
| 大面积 blur / filter / backdrop-filter | **有 1 处实际生效面**，即输入卡玻璃；这是本轮唯一可量化的主题开销 | 3.4、3.5 |
| canvas / 粒子 | **无**（0 个 canvas、0 个 shadow root） | 3.6 |
| 事件重复绑定 / 内存泄漏 | **无**；堆 39 MB、监听器随页面生命周期稳定；桌面 RSS 为churn 非泄漏 | 3.1 |
| 观察者重复唤醒 | 观察者存在但**未被唤醒**（0 变更）；上一轮的批过滤仍生效 | 3.3 |
| 重复挂载 | **无**：全页 1 张主题样式表（`data-plugin-css="EVA-Inspired-Theme/theme.css"`）、1 张状态轨样式表、1 个 `#eva-lg-defs`、3 个置顶按钮、1 个微信按钮 | 3.2 |

### 3.6 图层与艺术层清点

* backdrop 面：**1**（`div.RlGAzG_card::before`，712×98 CSS px，计算值 `url("#eva-lg-input") blur(4px) saturate(1.35)`）。
* `#eva-lg-defs`：`<filter id="eva-lg-input">`（`width="103.93%" height="128.57%"`，`feImage` 的 href 为约 1.5 KB 的 data URL + `feDisplacementMap`）与 `<filter id="eva-lg-guide">`（`feImage` href 长度 4 → 空桩，本页无右栏导引行，从未被画过）。
* 壁纸 = `body::before`：`position: fixed; inset: calc(-1 * var(--cp-blur,0px)); z-index: -1; background-image: var(--cp-wall)`（运行时为 blob: URL）；**`filter: none`**（`src/theme.css:178-184` 已刻意去掉 `blur(0px)` 的滤镜节点）。
* veil = `body::after`：`position: fixed; inset: 0; z-index: -1; background-image: linear-gradient(var(--dsw-alias-bg-base), …)`，亮档合成值 `rgba(226,225,237,0.84)`。
* 输入卡祖先链：`backdrop-filter / filter / transform` 全为 `none`，`isolation: auto`、`will-change: auto` —— 符合 `src/theme.css:340-351` 记录的不变量。

### 3.7 样式重算放大（同页切换主题样式表 —— 本轮最决定性的一组）

方法：同一个 ON 实例、同一个静止长会话页（3689 元素）、同一条负载（每 33 ms 往 `[data-conversation-content]` 追加一个 `<div data-eva-load>` 并裁剪到 40 个，同时写 `host[data-probe-a]`、`document.body[data-probe-b]`、`[data-composer-card][data-probe-c]`，故意制造全文档样式失效），每相 15 秒。**唯一被切换的变量是 `style[data-plugin-css^="EVA-Inspired-Theme"].disabled`**，A/C 为同一配置的两次测量（可逆性对照）。

| 相 | 主题 CSS | FPS 均/最低 | task ms/s | 重算次数 | 重算 ms/s | **ms/次重算** | 布局次数 / 布局 ms/s |
|---|---|---|---|---|---|---|---|
| A | 开 | 17 / 8 | 978 | 450 | 763 | **25.67** | 204 / 94 |
| B | 关 | 39 / 22 | 919 | 832 | 638 | **11.52** | 276 / 121 |
| C | 开（对照） | 19 / 14 | 969 | 441 | 740 | **25.45** | 178 / 93 |

* **主题样式表把每次全文档重算的价格抬到 2.2 倍**（25.5 ms vs 11.5 ms），负载下的 FPS 从 39 掉到 17–19。A/C 复现差 ≤2%。
* 注意两相的**重算次数**不同（开 450 / 关 832）：Chromium 在更贵的样式环境下会合并更多失效批次，所以「总耗时」被摊薄，**必须看 `ms/次重算` 这个单价**。
* 这是**纯 CSS 归因**：JS 在该窗口内只做写属性与 appendChild（`ScriptDuration` 同量级），放大发生在样式系统里。

同页第二组：把 92 条规则中**含 `:has()` 的 17 条**剔除（保留 76 条）后重测，15 秒一相：

| 相 | 规则集 | FPS 均 | task ms/s | 重算次数 | 重算 ms/s | **ms/次重算** |
|---|---|---|---|---|---|---|
| A | 全表 92 条 | 15 | 962 | 407 | 742 | **27.49** |
| B | 去掉 17 条 `:has()`（76 条） | 21 | 932 | 503 | 665 | **20.00** |
| C | 全表（对照） | 16 | 967 | 394 | 727 | **27.73** |

* **`:has()` 规则独占约 7.4 ms/次重算（约占单价 27%）**，FPS 15 → 21。
* `src/theme.css` 里 `:has(` 共命中 33 处，其中约 11 处在注释中 → 约 20 条活规则；**5 条主语是裸 `div:has(...)`**（`:243`、`:509`、`:615`、`:1609`、`:1646`），作者自己在 `:1269-1274` 已把裸 `:has()` 称为「本表最贵的一类选择器」并把其中一条收窄为 `#root *:has(...)` —— **收窄主语是既有先例**。

> ⚠ **第三轮降级修正（2026-10-11 同日，见 §11.5）**：本节的**绝对单价本轮无法复现**。在真机会话页（1865–1953 元素、3 个真代码块）上用四种负载复测（弱负载、对话区内追加、body 属性级、body 级 childList 最大面）：**主题表 ON/OFF 的单次重算价之比 = 1.03×**（ON 0.059 / 0.060 / 0.062 ms，OFF 0.058 ms；重算次数两相同为 244–245 次 / 8 s，布局次数同为 244–245），**不是 2.2×**；**旧表 vs 新表的比 = 1.00×**。真实流式负载下 ON/OFF = **1.40×（下界）**（0.350 vs 0.250 ms/次，§11.4）。
> **本节保留**：①「同页配对、只切样式表」的方法；② `:has()` 切片在**该轮负载形态下**相对更贵（相对排序）。**本节不可保留**：25.5 / 11.5 / 27.5 / 20.0 / 4.52 / 2.96 这些**绝对毫秒数** —— 它们高度依赖负载形态，本轮用四种负载都重建不出（§11.5、§11.6）。

---

## 五、根因排行（按开销从高到低）

| 等级 | 根因 | 频次 | 耗时 | 证据 |
|---|---|---|---|---|
| **RC1** | 输入卡 `backdrop-filter` 链在**每一合成帧**重做：`url(#eva-lg-input) blur(4px) saturate(135%)` | 随合成帧率（该页持续产帧） | **+144 ~ 147 ms/s 渲染器、+120 ms/s GPU**；其中 SVG 位移 **+98 ms/s** | 3.4 A−C、3.5 A−E。**C1 已于第三轮实施**（删掉 `url()`，见 §11.1）；计算值与视觉回归已验证，**该项的合成器收益本轮未重测** |
| **RC1b**（第三轮**未能复现**） | 主题样式表把**每次全文档样式重算的价格抬到 2.2×**（25.5 ms vs 11.5 ms） | 每批样式失效（负载 30 次/s；真实流式更新同样触发） | 第二轮：负载 FPS **39 → 17–19**、重算单价 **+14 ms/次**；**第三轮四种负载下 ON/OFF = 1.03×**（0.060 vs 0.058 ms），真实流式 **1.40×（下界）** | §3.7 A/B/C；§11.4、§11.5 |
| **RC1c**（第三轮**未能复现**） | 其中**含 `:has()` 的 17 条规则**（5 条主语是裸 `div:has(...)`） | 同上 | 第二轮：**+7.4 ms/次重算（约 27%）**，剔除后 FPS 15 → 21；**第三轮：旧表 vs 新表 = 1.00×**（0.056 vs 0.053–0.056 ms/次） | §3.7 第二组；§11.1（C2 已收窄 4 条）、§11.5；`src/theme.css:243/509/615/1609/1646` |
| **RC2** | **触发器不在主题内**：同一页主题关闭仍持续产帧 | 持续 | renderer 157 ms/s、GPU ~1000 ms/s 饱和 | 3.2、3.5 |
| RC3 | 主题 CSS 的其余滤镜/玻璃声明（42 处 `backdrop-filter`、22 处 `filter`）在本页**只有 1 处命中**，其余选择器不渲染 | — | 0 | 3.6 |
| RC4 | 壁纸 / veil 两层全视口 fixed 层 | 持续 | **0（不可测）** | 3.5 B/C/D |
| RC5 | 上一轮已修：每批 DOM 变更 4 次全文档 `querySelectorAll` | — | 现值 0 | 上一轮报告 |
| RC6 | 10-09 微任务死循环（`decorate()` 无条件写 `innerHTML`） | — | 已于上一轮修复并验证（幂等后 2 pass / 1 写） | `src/client.js:637-658` |
| RC7 | 桌面独有未覆盖变量：29 bundles、`device-scale-factor=2`、160 Hz | — | 未决 | 二、3.1 |

---

## 六、逐项改动说明

**第二轮 0 处源码改动**（理由见下）。**第三轮已实施 C1 与 C2**（用户点名，见 §11.1）；C3 未实施。

第二轮不改的理由：本轮的根因（RC1）落在主题的**视觉主张**上 —— 拿掉它必然改变输入卡玻璃的外观，而外观是用户反复打磨过的产品决定；RC1b/RC1c 则落在 `theme.css` 的选择器上，虽然理论上可做到零视觉变化，但**必须逐条验证匹配集**（`:has()` 规则负责的正是标题行、快捷键弹窗、代码块横幅这些结构接管），所以同样先出候选、等点头。

候选一览（**状态已更新到第三轮**）：

| # | 改动 | 落点 | 预期收益 | 视觉影响 | 状态 |
|---|---|---|---|---|---|
| C1 | 玻璃链去掉 `url(#eva-lg-input)` | `src/theme.css:359-362` | **−98 ms/s 渲染器** | 失去折射位移；模糊与着色不变 | **已实施**（§11.1），保留一行式回退，门禁 `glass.1` 钉住回退路径 |
| C2 | 5 条裸 `div:has(...)` 的主语收窄（如 `#root div:has(...)`）或改写为等效的祖先限定 | `src/theme.css:243`、`:509`、`:615`、`:1609`、`:1646` | 预计吃掉 7.4 ms 中的一部分（须测） | **目标为零**；需逐条比对匹配元素集合与计算样式 | **已实施 4 条**（`:243`、`:509`、hero 两条），hero 另两条加 `[data-phase='hero']` 祖先门；**`:615` 有意保留**（打不开设置弹层，无法验证）；等价性实测通过（§11.3） |
| C3 | 进一步压其余 75 条规则的属性选择器/后代链深度 | `src/theme.css` 全表 | 余下约 8.5 ms/次重算 | 需逐条评估 | **未实施**；第三轮复测显示其分母（8.5 ms）不可复现，见 §11.5 |

不受影响面：`~/.dsh/profiles/**` 与 `app.asar` 全程未改；桌面 profile 里 EVA 现为 `disabled: false`（用户自己改回的），三轮均未动。

---

## 七、验证方式

对一个候选改动，验证协议固定为：

1. **配对同轮**：ON 与 OFF 两实例、同一会话页、同一次采样轮内交替，A/F 对照相复现差须 ≤1%。
2. **60 秒进程级采样**：renderer 与 GPU 进程的 ms/s（`eva-proc-tree.ps1`）。
3. **8.85 秒主线程 profile**：`ScriptDuration`、`LayoutCount`、`RecalcStyleCount`、Top 自耗时。
4. **功能与视觉对等**：`document.querySelectorAll` 计数（1 张主题样式表、1 个 `#eva-lg-defs`、3 个 pin、1 个 wx 按钮、`[data-composer-card]::before` 的 `backdrop-filter` 计算值仍含 `blur`）、以及输入卡玻璃仍模糊着色的截图对比。
5. **门禁**：`node tools/build-client.mjs` 重建 + `npm run verify`（上一轮 25 项 0 失败）。

---

## 八、回归风险与回滚

| 候选改动 | 预期收益 | 视觉影响 | 回归风险 | 回滚 |
|---|---|---|---|---|
| 选项 1：不动玻璃（仅归档本轮归因） | 0 | 无 | 无 | — |
| **选项 2（第三轮已实施）**：玻璃链去掉 `url(#eva-lg-input)`，只留 `blur() saturate()` | **−98 ms/s 渲染器**（该页主题开销的约 30%；第三轮未重测该项） | 输入卡玻璃内失去折射位移，磨砂与着色不变（**计算值与改动前逐项比对通过**，§11.3） | 低：`#eva-lg-input` 的 `feImage`/`feDisplacementMap` 注入**仍照常构建**（门禁 `glass.1` 会断言它仍在，否则报 `…so C1 has no rollback path`），所以不会静默烂掉 | **一行式**：把那两行 `url() blur() saturate()` 加回 `[data-composer-card]::before` 末尾；并把门禁 `glass.1` 期望命名数 1 → 2、`glass.2` 规则数 1 → 2。整体回滚：`Copy-Item src\theme.css.bak-20261011-1530-c1c2 src\theme.css -Force` + `node tools/build-client.mjs` |
| **选项 3（第三轮已实施 4/5 条）**：收窄裸 `:has()` 主语（`theme.css:243`、`:509`、hero ×2；`:615` 保留） | 第二轮预期 **−数 ms/次重算**（上限 7.4 ms）；**第三轮实测：无可测差异**（旧/新 = 1.00×，§11.5） | 目标为零 —— **实测通过**：`:243` 命中集 [172]、`:509` 命中集 [1101,1337,1573]（真会话页 3 个真代码块）、hero [537]/[538]/[542]/[543,544] 全部与改动前相同，计算样式逐项一字不差（§11.3） | 低（已逐条验证匹配集）；**残留**：`:615`（设置弹层）仍是全表唯一裸 `div:has()`，镜像打不开该弹层 ⇒ 未验证 | `Copy-Item src\theme.css.bak-20261011-1530-c1c2 src\theme.css -Force`（C1/C2 之前）或 `…-1600-post`（第三轮之后）+ `node tools/build-client.mjs` + `npm run verify`；或 `git checkout -- src/theme.css` + 重建 |

风险提示：`device-scale-factor=2` 时玻璃按 4 倍像素计费，理论上桌面收益大于镜像实测值；但本次 dpr 强制测试**未显示增益**（594 → 522 ms/s，噪声内），所以桌面收益目前只能标为**待验证**。

---

## 九、最小复现步骤与可量化基线

1. 起 ON 实例：`dsh --profile eva-preview --no-open --port 19391`。
2. 起 OFF 实例：`pwsh -File C:\Work\scratch\run-web-patched.ps1 -Port 19392 -Profile eva-preview -Patch C:\Work\scratch\eva-off.patch.yml`（`eva-off.patch.yml` 内容：`- id: eva-inspired-theme` + `  disabled: true`）。
3. 两实例打开同一个长会话（约 3.7k 元素），等它停止流式输出（静止）。
4. 采样 60 秒 renderer / GPU 进程 CPU。
5. **可量化基线**：同一页 EVA 开 = renderer ≈ 400 ms/s、关 = ≈ 160 ms/s；差值 ≈ **+240 ms/s 渲染器**，其中输入卡玻璃 ≈ **+144 ms/s**、SVG 位移 ≈ **+98 ms/s**。
6. 桌面侧对应基线：renderer pid 17132 = **133% 单核**、双线程 62.9% + 44.8% `Running`、RSS ≈ 1.05 GB。
7. **样式重算单价的复现（不需要第二个实例，最可移植的一组）**：在同一个 ON 页上装一条 33 ms 的合成负载（追加/裁剪 `[data-eva-load]` 节点 + 写 3 处属性），15 秒一相，只切换 `document.querySelector('style[data-plugin-css^="EVA-Inspired-Theme"]').disabled`：
   * 开 → `RecalcStyleDuration/RecalcStyleCount` ≈ **25.5 ms/次**、FPS ≈ 17–19；
   * 关 → ≈ **11.5 ms/次**、FPS ≈ 39；
   * 回来再开一次 → ≈ 25.5 ms/次（复现差 ≤2%）。
   采样用 CDP `Performance.getMetrics` 的 `RecalcStyleCount` / `RecalcStyleDuration`（**单位毫秒**）差分，按真实 `Timestamp` 归一。
8. `:has()` 的复现：在页内把主题样式表按花括号配对切成顶层规则，剔除选择器里含 `:has(` 的 17 条，克隆成第二张 `<style>` 并禁用原表 → `ms/次重算` 从 ≈27.5 掉到 ≈20.0，FPS 15 → 21。

---

## 十、复现条件缺失项与下一步需要的信息

1. **桌面 29 bundles 未镜像**：镜像 profile 只有 3 个 bundle。若持续产帧的触发器是 `dsh-pet` / `dsh-smooth-stream` / `dsh-better-sidebar` / `dsh-wechat-plugin` 之一，在镜像里看不见。注：`dsh-pet` 有自己的一套 Electron 进程（gpu 28288 = 17.7%、renderer 34496 = 8.1%），**它的开销独立于主窗口**，桌面 133% 里不含它。
2. **桌面 renderer 无调试端口**：JS 级归因在桌面上做不到。要做就必须能起一个「同 bundle 集合 + 带 `--remote-debugging-port`」的实例（或临时带调试端口重启桌面，需要用户点头）。
3. **需要用户确认的现象边界**：桌面「特别卡」是在①静止看已完成的会话、②流式回复过程中、③滚动时，还是④输入时最明显？镜像已复现①；若痛感在②，同一份每帧成本会乘以流式更新的帧数。
4. **RC2 的触发器需要可控实验**：建议在镜像里逐个开/关桌面 bundle 做二分（下一步），或在桌面临时停 `dsh-pet` 对比。
5. **~~RC1b 的真实放大倍数尚未在真实工作负载上测~~ → 第三轮已测（§11.4）**：真实流式下 ON/OFF = **1.40×（下界）**（DOM 逐相增长未控制，见 §11.4 混杂项）。**仍未做**的是**录制真实 DOM 变更序列再重放** —— 这是把「1.40× 还是 2.2×」彻底钉死的唯一办法。
6. **~~`:has()` 的 7.4 ms 是哪几条规则贡献的尚未分解~~ → 第三轮该分母已失效**：新增的四种负载（含 body 级 childList 的“最大”面）下 **ON/OFF = 1.03×、旧表/新表 = 1.00×**，7.4 ms 的分母**复现不出来**，所以 C2 的收益上限**暂时无法用本轮仪器证明**（等价性已验证，**性能收益未证**）。要重开这个问题，必须先能重建 §3.7 的负载形态。
7. **「静止却在烧」的应用侧触发器仍未定位**（不在主题内，也不是本轮授权范围）——它决定了主题 ON 时的**基线**有多高，因此仍影响用户的主观卡顿感受。
8. **C1 的合成器收益（−98 ms/s 渲染器）与镜像 ON/OFF 配对（396 vs 157 ms/s）本轮未重测**：C1 只验证了计算值变化 + 零视觉回归。重测需要一个**持续产帧**的页面 + 两实例进程级采样（`eva-proc-tree.ps1`）。
9. **桌面端仍是最终判据，但桌面 renderer 无调试端口**：本轮未动桌面 profile（`disabled` 状态未改）。「重新启用后还卡不卡」必须由用户在桌面实例上验。
10. **本轮测量面的形态**：全部在 `--port 19391`（ON）的真机会话页上测（1865–1953 元素、3 个真代码块）；第二轮的长会话页（3689 元素）**未重建**，两轮数字不可直接相减。

---

## 十一、第三轮（同日收尾）：C1 / C2 实施、门禁、真实负载与实施后复测

用户口令（逐字）：**「1 都很强。2。C1和C2都做但要保留C1的回退可能。3补」** → ①四类场景痛感都强；②**C1 与 C2 都实施，C1 保留回退可能**；③**补做真实负载倍数测量**。

### 11.1 已实施的改动

| # | 落点 | 改动 | 回退 |
|---|---|---|---|
| **C1** | `src/theme.css` `[data-composer-card]::before`（原 359-362 行） | 删掉 `-webkit-backdrop-filter` / `backdrop-filter: url(#eva-lg-input) blur(...) saturate(135%)` **两行**，只留 `blur(var(--cp-glass-composer)) saturate(135%)` 两行；原位置留中文块注释（口径、消融数字、一行式回退写法） | **一行式**：把那两行加回本块末尾即可。`client.js` 侧从未拆掉 `#eva-lg-input`（SVG `feImage`/`feDisplacementMap` 仍照常构建） |
| **C1 门禁** | `tools/selfcheck.mjs` `glass.1` / `glass.2` | `glass.1` 期望命名滤镜数 2 → 1，并把「sheet 命名数 == client.js 构建数」的相等断言改成：**先断言 `built.includes('eva-lg-input')`**（否则报 `src/client.js no longer builds eva-lg-input, so C1 has no rollback path`），再断言 `built.length === 2`（input + guide）。`glass.2` 期望 `url()` 规则数 2 → 1 | 两处期望数改回 2 |
| **C2** | `src/theme.css` 6 处 | `:243` → `[data-slot='root'] > * > div:has(> [data-slot='sidebar'])`；`:509` → `[data-code-wrap='true'] > div:has(> [data-code-block-banner])`；hero 两条藏元素 → `span:has(> [data-slot='conversation.hero.brand.mark'])` 与 `… + span > span`；hero 另两条 → 加祖先门 `[data-phase='hero']` | `Copy-Item src\theme.css.bak-20261011-1530-c1c2 src\theme.css -Force`（C1/C2 之前）+ `node tools/build-client.mjs`，或 `git checkout -- src/theme.css` + 重建 |
| **C2 有意未动** | `:615` `div:has(> [data-shortcut-modal='settings']) > :first-child` | 镜像里点 `[data-slot='settings.launcher']` 与 Ctrl+, **都打不开设置弹层**；asar 只读检索显示 `shell.overlay` 是**全局提示（quota notice / task-deleted toast）的 overlay host**，**没有证据**表明设置弹层挂在它上面 ⇒ 盲改会静默失效且无法测出。**它是全表唯一残留的裸 `div:has()`**，待能打开设置弹层时再核祖先链 | — |

**改动前备份**：`src/theme.css.bak-20261011-1530-c1c2`（141019 B，C1/C2 之前）；第三轮改动后另存 `src/theme.css.bak-20261011-1600-post`（144216 B）。

### 11.2 门禁与构建（全绿）

* `node tools/build-client.mjs` → `wrote client.js 761388 chars (779683 bytes) 55 tokens 2 wallpapers … css 92098 chars (11850 after the comment strip)`。
* `node tools/selfcheck.mjs` → **117 assertions, 0 failed, 117 passed / all green**（`glass.1`/`glass.2` 新期望、`css.6`/`css.7` 选择器契约、`cli.17` 同型检查全过）。
* `node tools/token-audit.mjs` → AUDIT OK（55 overrides：A 41 + B 14）；`node tools/check-sound-layer.mjs` → spawns: plan, done, fail, ask；`node tools/build-client.mjs --check` → `client.js check: OK (in sync with src/)`。
* 预览实例接线：`C:\Users\Axiom\.dsh\profiles\eva-preview\node_modules\EVA-Inspired-Theme` 是 **Junction → `C:\Yu\EVA-Inspired-Theme`**（profile 里 `"EVA-Inspired-Theme": "link:C:/Yu/EVA-Inspired-Theme"`）⇒ 改仓库文件即改实例；**重建 `client.js` 后只需刷新页面即加载新 bundle，不必重启 `dsh`**（本轮 reload 后实测 sheet 17372 字符、`hasInputUrl:false`、C2 标记齐全）。

### 11.3 改动后等价性验证（命中集与计算值，不是「看起来一样」）

| 检查 | 旧 | 新 | 结果 |
|---|---|---|---|
| 玻璃计算值 | `url("#eva-lg-input") blur(4px) saturate(1.35)` | `blur(4px) saturate(1.35)`；注入的 paint CSS 里 `url(#eva-lg-input)` 计数 **0** | C1 生效，且只少了位移 |
| 侧栏列（`:243`） | `div:has(> [data-slot='sidebar'])` → **[172]** | `[data-slot='root'] > * > div:has(> …)` → **[172]** | 相等（按文档序 id 逐一比对） |
| 代码块横幅（`:509`） | `div:has(> [data-code-block-banner])` → **[1101,1337,1573]** | `[data-code-wrap='true'] > div:has(> …)` → **[1101,1337,1573]** | **相等：在真实会话页、3 个真代码块上实测**（第二轮只是推导） |
| hero 标题行 / 标题组 / 标题 span | [537] / [543,544] / [542] | 同上（加 `[data-phase='hero']` 门后仍命中同一个 [537]） | 相等 |
| 计算值逐项 | 537 flex / inline-size / bg rgba(0,0,0,0)；538 display none；542 flex + `::before` content「Wovon man nicht sprechen kann…」+ `"Great Vibes", cursive` + 36.888px；543/544 display none（544 bg rgb(228,237,253)）；172 block / bg rgba(0,0,0,0) | 与改动前基线**一字不差** | 零视觉回归 |

### 11.4 补做的真实负载测量（用户第 3 项）

方法：`--port 19391` 的空会话页，`page.keyboard.insertText` + `Enter` 发一条会流式长回复的提示词（「请用中文写一段约 300 字的说明文，主题：为什么天空是蓝色的。然后在末尾附一个 10 行的 Python 代码示例来演示计算。」），逐秒取 CDP `Performance.getMetrics` 增量。三相同实例、同会话、同提示词：

| 相 | 主题样式表 | 流式时长 | 重算次数/s | 重算 ms/s | **ms/次重算** | TaskDuration/s | FPS 均 |
|---|---|---|---|---|---|---|---|
| A | 已发布（C1+C2） | 30.7 s | 151 | 53 | **0.350** | 594 ms/s（59% 单核） | 145.6 |
| B | 只回退 C1（把 `url(#eva-lg-input)` 加回玻璃规则） | 12 s | 153 | 62 | **0.406** | 512 ms/s | 142.8 |
| C | 主题 CSS 清空（`textContent=''`，backdrop 计算值 `none`） | 13 s | 161 | 40 | **0.250** | 488 ms/s | 147.5 |

* **真实流式负载下 ON/OFF 重算单价倍数 = 1.40×**（C1 回退态 1.62×），**远低于 §3.7 合成最坏面的 2.2×**；净加价 ≈ +0.10 ms/次 × 151 次/s ≈ **+15 ms/s 主线程样式重算**。
* FPS 三相 145.6 / 142.8 / 147.5（~160 Hz 显示器）**在噪声内 —— 真实流式下没有可见掉帧**。
* **混杂项（必读）**：DOM 逐相变大（A ≈1174 / B ≈1713 / C ≈2036 元素，因每次回复都追加内容），A 是在**最小 DOM** 上测的 ⇒ **1.40× 是下界**（OFF 相在更大 DOM 上仍然更便宜）。
* 进程 CPU 旁证（ego 浏览器根 pid 33576 = Helium）：base 3732781.2 cpuMs @1791704727662 → A 相末 3795156.2 @1791704778743（**+62375 ms / 51081 ms = 1.221 单核**）→ C 相末 3838359.4 @1791704876248。括号间夹着我的思考与空转时间，**无法按相分离** ⇒ 逐相结论只用页内指标，进程 CPU 仅作旁证。

### 11.5 实施后复测：C1 / C2 在**可复现的失效面上没有可测差异**（诚实结论）

同一真机会话页（1865–1953 元素、3 个真代码块），同页切换样式表（`style[data-plugin-css="EVA-Inspired-Theme/theme.css"].textContent`；旧表用 **6 处精确逆向替换 + 补回两行 `url()`** 重建，脚本自检 6 处各命中 **1** 次，oldLen 17540、oldHasUrl true）。四种负载，每相 8 秒，逐秒差分：

| 负载 | 定义 | 旧表 ms/次重算 | 新表 ms/次重算 | 主题 ON vs OFF |
|---|---|---|---|---|
| 弱负载 | 只写 3 个侧栏行的 `data-eva-load` + 隐藏 host 追加文本 | — | 0.061 | — |
| SL | 每 33 ms：`body[data-eva-probe]` 切换 + 3 行属性 + 往 `#eva-sl-host`（对话区内）追加/裁剪 | 0.067 | 0.061 | — |
| SL2 | 同 SL，但追加 host 改成 `document.body` 的**直接子节点**（body 级 childList） | 0.056 / 0.053 | 0.056 / 0.054 | — |
| **ON/OFF 配对** | 同 SL2，删除/恢复整张主题表（5 相：ON-OFF-ON-OFF-ON） | — | — | **ON 0.060 / 0.062 / 0.059，OFF 0.058 / 0.058 ⇒ 1.03×**；重算次数两方同为 244–245 次 / 8 s，布局次数同为 244–245 |

⇒ **§3.7 的绝对单价本轮无法复现**：四种负载把单次重算价压到 **0.053–0.067 ms**，与 §3.7 的 **4.52 / 2.96 / 25.5 / 11.5 ms** 差 **70–85 倍**；主题 ON/OFF 的**单价之比只有 1.03×**（不是 2.2×），旧表/新表之比 **1.00×**。因此：

* §3.7 的**绝对量级降级为「负载形态相关、未复现」**；`:has()` 切片「相对更贵」是当轮**同页配对**结论，**不是稳定常数**。
* **C1 的收益证据仍在合成器侧**（§3.5 同页消融 330 → 232 → 183 ms/s 渲染器），第三轮**未重测该项**；本轮只验证了 C1 的**计算值变化**与**零视觉回归**。
* **C2 的收益证据是命中集等价 + 裸 `:has()` 主语确实被收窄**；在**本轮能造出的失效面上，收窄没有换来可测的毫秒**。

### 11.6 第三轮未覆盖 / 无法覆盖

1. 真实流式倍数只有一轮、一种提示词、单实例，且 **DOM 逐相增长未控制**（§11.4 混杂项）⇒ 要更硬的数字需**录制真实 DOM 变更序列再重放**。
2. §3.7 的 **4.52 / 2.96 ms 表面重建不出来**：本轮已在 1865–1953 元素真会话页上试了四种负载（含 body 级 childList），**原因未查明**。
3. C1 的**合成器侧**收益（−98 ms/s 渲染器）与镜像 ON/OFF（396 vs 157 ms/s）**本轮未重测**。
4. `:615`（设置弹层）仍是全表唯一裸 `div:has()`，**未能验证**。
5. 桌面 profile 未动；「重新启用后还卡不卡」**仍需在桌面实例上验**（这也是唯一带真实 bundle 集合与 160 Hz 的判据）。

---

## 十二、第四轮（同日续）：追 4.52 ms 与设置界面实测

用户 m00426「我重启了，好像是好多了。把第二轮的 3689 元素长会话页重建出来，专门去追那个丢掉的 4.52 ms」、m00476「另外，打开设置界面还是卡，把设置界面也优化下！」。

### 12.1 测量环境（重建，非复用）

- 镜像实例重建：`C:\Users\Axiom\.agents\skills\dsh-ai-web\scripts\run-web.ps1 -Port 19391 -Profile eva-preview`（launcher 9284 / dsh 21676），页面 = `http://127.0.0.1:19391/`。
- 长会话页重建面：打开 `session-bb0c2c0e-5d2c-4f7f-9fb8-f2fdb632181a`（侧栏标题「EVA 主题前端性能分析与优化」，`session.v4.jsonl.zstd` 4392 KB）⇒ **6564 元素**（第二轮记录为 3689，本轮面更大）。
- 结构真相：`[data-slot]` 元素是 **0×0 `display:contents` 定位桩**，真实内容在 CSS-Modules 哈希类名的 div 里；`[data-slot='sidebar']` 桩 0×0，真实列 = `DIV.BynINW_sidebarCol` [0,0,280,821]。
- **设置弹层本轮第一次被测到**：桌面地图 `Ctrl+,` 在镜像无效，**`Ctrl+Alt+,`（Web 地图）打开成功**。宿主写法（只读自 `asar-dsh`）：`ui-settings-general` 的 `SettingsPanel` 用 `createPortal` 渲染 `div.overlay > [div.mask, div.panel[data-shortcut-modal="settings"][role="dialog"]]`；主题里那条裸 `:has()` 现在位于 **`src/theme.css:640`**（第三轮 C2 注释把原 `:615` 挤后）。
- 桌面 profile 的主题按下主题的 `[data-slot='settings.launcher'] > button { display: none !important }`（`src/theme.css:1567`，D68 的既定设计）隐藏，快捷键是唯一入口；注释已写明桌面 `Ctrl+,` / Web `Ctrl+Alt+,` 两套地图。

### 12.2 4.52 ms 追捕结论：单次重算价由**失效类别**决定，不由选择器复杂度决定

同一页、同一负载、同页配对（全部为 6564 元素页，除注明）：

| 失效类别 | 重算事件 | 总重算时长 | 单次重算 | 备注 |
|---|---|---|---|---|
| 小属性 + body 级 childList 突变（弹层关闭） | 181 / 6 s | 22–29 ms | **0.12–0.16 ms** | 弱负载 |
| 同型弱负载（1865 元素页，弹层关闭） | 244 / 8 s | 14–15 ms | 0.054–0.073 ms | §11.5 |
| React 挂载：打开设置弹层 | 52 | 17.55 ms | 0.34 ms | |
| React 挂载：切 4 个设置分区 | 8 | 11.35 ms | **1.42 ms** | 单价跳一个量级 |
| 打开 + 4 次分区点击整轮 | 62–65 | 20.7–30 ms | 0.32–0.51 ms | |
| **整张主题样式表重新应用**（改 `<style>` 文本） | 3–4 | **22–26 ms**（TaskDuration 38–49 ms） | ≈7 ms/次 | 与表大小、`:has()` 无关 |

- **`:has()` 消融第一次做成直接配对**（CSSOM `deleteRule`，同页、同负载，不再靠文本重建推断）：弹层关闭时 0.0734 ms（92 条 / 17 条含 `:has()`）vs 0.085 ms（全删 17 条）；**弹层打开时** 28.77 ms（原样）→ 26.02（只删设置那条）→ 24.73（删全部 17 条）→ **22.08（恢复成原样后的对照）** ⇒ 差值被顺序/漂移吞掉，**`:has()` 无可复现代价**。
- **规则数量标定**：注入 3000 条同型规则（3929 → 6929 条，+76%）⇒ 设置打开+切分区 20.7 → 25.53 ms，回基线 23.7 ms ⇒ **无稳健关系**。
- 结论：`RecalcStyleDuration/RecalcStyleCount` 这个「单价」不是主题选择器的属性，而是**本次失效覆盖多大的子树 / 是否需要重新应用整张表**的属性。第二轮 §3.7 的 4.52 / 2.96 ms 属于上表后两类（大子树或整表重应用），**不是**「7 条裸 `div:has()` 很贵」这个机制；本轮在同一台机器、更大页面上无法把它还原成选择器代价。

### 12.3 设置界面实测：主题侧代价小，且与主题无关的量占绝大多数

- 弹层内部**主题只画一层**：`[data-shortcut-modal='settings']::before`（`src/theme.css:592-602`）＝ `blur(20px) saturate(130%)`；弹层内 139 节点中 **0 个** backdrop-filter / filter / box-shadow。mask 由 `:640` 那条规则清空（透明、无 filter）✓。
- dpr 1（1256×821）：打开 87–95 ms；打开后空闲 6 s 主线程 0.47 ms、重算 66、帧 952（160 Hz）；8 次分区点击帧 p50 6.2 / p95 6.5 / max 25、3 帧 >20 ms。
- dpr 2（`Emulation.setDeviceMetricsOverride` 1600×1000，贴近桌面）：玻璃打开 95–104 ms、帧 p95 12.8 / max 31.4 / 1 帧 >20；**去掉弹层玻璃**（`::before{backdrop-filter:none}`）打开 86–103 ms、p95 6.5 / max 7.5 / **0 帧 >20** ⇒ 20px 玻璃在 dpr 2 是**可测但小**的代价。
- **背板扰动测试**（给 `Dc7zOa_viewArea` 969×1616 加 transform 无限动画，弹层开着）：玻璃 p95 8.3 / max 24.4 vs 无玻璃 p95 6.5 / max 21.3，**控制组（弹层关闭、动画仍在）p95 12.6 / max 40.1 反而最差** ⇒ 玻璃不是设置界面的瓶颈。
- **`contain` 无效**：`contain: paint` / `layout paint` / `strict` 加在弹层上，打开+4 次分区点击的重算 65 / 65 / 65 / 64 次、时长 30 / 30 / 30 / 30 ms ⇒ 零差异（因为贵的是 React 挂载本身，不是失效扩散）。
- **主题 ON/OFF 配对**（同一打开动作 ×2 轮）：ON 重算 4.4 / 20.33 / 17.97 ms，OFF 18.7 / 7.14 ms、打开 87–292 ms 全在噪声带 ⇒ **主题的有无在噪声内**。
- **样式抖动监视器**（MutationObserver 监视全文档 `<style>` 添加/删除/文本改写）：打开弹层与切换 4 个分区 **0 次插改** ⇒ 这一侧不会触发 12.2 表里那类「整表重应用」。
- **与用户环境的唯一硬差异：插件数**。桌面 profile = **24 deps / 29 bundles**（`@changfenhuang/dsh-annotation`、`@linxin666/dsh-client-ui-task-board`、`@modusensus/dsh-mneme`、`@taxueseek/argo-dsh`、`@tt-a1i/archify-dsh`、`@weibaohui/dsh-smart-title`、`EVA-Inspired-Theme`、`billion-context`、`dsh-auto-archive`、`dsh-better-sidebar`、`dsh-client-auto-continue`、`dsh-context`、`dsh-ego-browser`、`dsh-email`、`dsh-pet`、`dsh-protocom-api`、`dsh-rewind-plugin`、`dsh-skill-mcp-panel`、`dsh-smooth-stream`、`dsh-wechat-plugin`、`dsh-zotero`、`dshmarket`、`oss-prompt-optimizer`、`schemastery`）；eva-preview = **1 dep / 3 bundles**。
- 桌面端**没有**软件光栅：`DeepSeek Harness.exe --type=gpu-process` 存在，renderer 带 `--num-raster-threads=4 --video-capture-use-gpu-memory-buffer`，命令行无 `--disable-gpu` / swiftshader。
- ⇒ 结论：**设置界面的「卡」在本轮可测的环境里复现不出来，且现有证据都指向主题之外**（插件/应用的挂载与 JS）。主题侧唯一可动的杠杆是 `::before` 那层 20px 玻璃（dpr 2 下约 5–6 ms 的 p95 级代价），收益上限很小。

### 12.4 本轮新增仪器（可复用）

| 仪器 | 用途 |
|---|---|
| `deleteRule` 消融 | 直接在 CSSOM 上删规则做同页配对，再用 `textContent = __orig` 复原；比文本层重建可靠（注意：`<style>` 改写后旧的 `CSSStyleSheet.ownerNode` 会变成 `null`，必须按 `data-plugin-css` 重新查找） |
| style 抖动监视器 | `MutationObserver(documentElement, {childList, subtree, characterData})` 统计 `<style>`/`<link>` 添加、删除与文本改写次数（只记 parent 为 STYLE 的 characterData，避免流式文本噪声） |
| `Emulation.setDeviceMetricsOverride` | 在镜像里模拟桌面 dpr 2 / 1600×1000；用完必须 `Emulation.clearDeviceMetricsOverride` |

### 12.5 第四轮未覆盖 / 需要用户决定

1. 桌面实例**没有调试端口**（进程命令行无 `--remote-debugging-port`），镜像又只有 1 个插件 ⇒ 「设置界面卡」目前**只能在用户机器上复现**。
2. 继续定位需要三选一：①把桌面 profile 的 24 个插件复制进 **预览 profile**（不动桌面配置）后由我在镜像里测；②另起一个 `dsh --profile desktop --port 19393` 让完整插件集在可测实例里跑一遍（插件双重启动，风险较高）；③**由用户在「设置 → 内置插件」里逐个停用插件二分**（最安全，我给步骤与判据）。
3. 4.52 ms 的「原样还原」本轮判定为**不可复现**，机制已按失效类别重新归类（12.2）；若还要更硬的证据，需要**录制桌面实例真实的 DOM 变更序列再重放**。

---

## 附：本轮仪器（全部在 `C:\Work\scratch\`）

| 文件 | 用途 |
|---|---|
| `eva-proc-tree.ps1` | 按端口/根 pid 展开进程树，逐样本取 `TotalProcessorTime` 与 `WorkingSet64`，输出 pctCore 与 CSV（`-Ports` / `-RootPids` / `-Seconds` / `-Out`） |
| `eva-off.patch.yml` | `--patch` 覆盖层，关掉 `eva-inspired-theme`（不改 profile 文件） |
| `run-web-patched.ps1` | 带 `--patch` 起 `dsh web`（stdout 必须走管道，否则日志 0 字节） |
| `ls-probe.mjs` | 只读解析桌面 Local Storage LevelDB（键值取证） |
| `eva-perf-harness.js` | 页内 instrument（包装 `querySelectorAll`/`getBoundingClientRect`/`setProperty` 计数、longtask、MutationObserver、确定性负载 `S.load`） |
| `eva-perf-run.mjs` | CDP driver（`Performance.getMetrics` 逐秒差分、Profiler 窗口、进程采样汇总） |
| `c2-apply.mjs` | 第三轮 C2 的一次性改写脚本（6 处逐字替换，每处**先断言出现次数 = 1**，全成才写盘；`theme.css` 是 **CRLF**） |
| `build-old.txt` / `build-new.txt` / `selfcheck-new.txt` | 第三轮旧表重建、新表重建、门禁的原始输出 |
| `ego-*.csv` | 各轮相位采样的原始样本 |

> 回滚点（仓库内，未跟踪）：`src/theme.css.bak-20261011-1500-perf`（141019 B，第二轮之前）、`src/theme.css.bak-20261011-1530-c1c2`（141019 B，C1/C2 之前）、`src/theme.css.bak-20261011-1600-post`（144216 B，第三轮之后）。
