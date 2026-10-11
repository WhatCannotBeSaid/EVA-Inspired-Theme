# EVA 主题性能排查与修复报告（2026-10-11）

对象：`C:\Yu\EVA-Inspired-Theme`（DSH 客户端主题插件，`EVA-Inspired-Theme@1.0.0`）
执行者视角：前端性能工程师 / 运维。原则：先测量后改动、改动前备份、每条结论带证据、未验证的不写进结论。

---

## 一、结论先行

1. **确认并修复了一条可复现、可量化的开销放大链**：主题的三个 DOM 效果各自在**每一批**应用 DOM 变更后做一次**全文档** `querySelectorAll`。实测流式负载下 **123 次/秒** 的全文档查询（OFF 对照为 0），是 5 秒 CPU profile 里自耗时最大的 JS 帧（`querySelectorAll` 24.9 ms）。改法是把查询收窄到 `[data-slot='sidebar.workspaces']`（查不到即回退文档），并按 `MutationRecord` 判断这一批变更是否可能影响到自己，不可能就整批丢弃。
2. **修复后同一负载同一计划复测**：主线程 task 时间 **184.0 → 66.4 ms/s（−64%）**，脚本时间 **35.5 → 14.9 ms/s（−58%）**，样式重算耗时 **655.3 → 47.5 ms（−93%）**，布局耗时 **953.1 → 190.5 ms（−80%）**，全文档查询 **3684 → 1 次/30s（那 1 次是探针自己的）**，最低 FPS **141 → 161**，长任务全程 0。
3. **功能与视觉无退化**（同一页面、重建后重新加载）：三个效果挂载状态与基线逐项一致（置顶按钮 3、微信按钮 1、composer 卡 1、液态玻璃 defs 1、状态样式表 17,532 字符、会话行 9、工作区行 4）；把三个置顶按钮和微信按钮手动删掉后 1.5 秒内全部自行重建 → 批过滤没有把该醒的批次挡掉。
4. **顺带修掉两处结构性开销**：状态轨的 `infinite` 关键帧动画从动画 `background`（绘制属性，每帧重绘）改为动画 `opacity`（合成属性），低点 35% 的合成结果逐像素不变（已用活体动画探针验证）；启动遮罩的 rAF + `setInterval` 双时钟收敛为「有 rAF 就只用 rAF」。
5. **必须说清楚的一件事**：**我没有复现用户报的灾难态**。10-09 记录的那种「renderer 被钉在一核、内存不增长、启动卡在 Loading plugins」的同步死循环，在本次排查开始前**已经在工作区里修好了**（`src/client.js:637-658` 有完整记录：改幂等前 32 ms 内跑了 2000 次 `decorate()`），并且 `build-client.mjs --check` 确认出厂 `client.js` 与 `src/` 同步 —— 也就是说桌面端当时跑的就是已修版本。本次修的是另一条**真实存在、可测量**的开销链。桌面端当前仍是**停用主题**状态（`profiles/desktop/cordis.patch.yml:363-364`），所以「重新启用后是否还卡」这件事，需要你点头重启一次才能给结论（见第七节）。

---

## 二、测量环境与仪器（可复核）

| 项 | 值 |
|---|---|
| ON 实例 | `http://127.0.0.1:19389/`，profile `eva-preview`（3 个 bundle，含 EVA），pid 32020 |
| OFF 对照 | `http://127.0.0.1:19390/`，同 profile + `--patch C:\Work\scratch\eva-off.yml`（`- id: eva-inspired-theme` / `disabled: true`），pid 32268 |
| 渲染进程 | ego-lite（Helium）浏览器，根 pid 28080；页面在 renderer 18976 |
| 被测页面 | 新建会话页：9 个 `[data-row-key^="session:"]`、4 个 `div[data-row-key^="workspace:"]`、唯一 `[role='tree']`（14 行）位于 `[data-slot='sidebar.workspaces']` 内 |
| 页内探针 | `C:\Work\scratch\eva-perf-harness.js`（v5）：包装 `Document.prototype.querySelectorAll`、`Element.prototype.setAttribute`、`CSSStyleDeclaration.prototype.setProperty`、`Element.prototype.getBoundingClientRect`，逐帧 rAF 计数 + longtask 观察器；计数分「每秒分桶」与「全会话单调累计」两套 |
| 驱动器 | `C:\Work\scratch\eva-perf-run.mjs`（v2）：每个 1 秒桶前后取 `Performance.getMetrics` 差分（用真实 `Timestamp` 毫秒归一），另含确定性负载与 5 秒 CPU profile 窗口 |
| 每态计划 | settle 9s → idle 30×1s → load 30×1s（level 1 / sync：每 33 ms 一次文本追加+裁剪+3 处属性写，实测约 150 条变更/秒，模拟流式回复）→ 5s profile |

口径说明：`taskMsPerSec` 是 CDP `TaskDuration` 差分，按单核百分比换算（100 = 单核跑满）；`qsa` 只统计 **Document 原型**上的 `querySelectorAll`（元素级 `host.querySelectorAll` 不计入），这正是本次要压的指标。

---

## 三、基线数据（同一台机、同一浏览器、同一计划）

### 3.1 修复前 ON vs OFF（配对）

| 指标 | ON 修复前 | OFF 对照 | 差 |
|---|---|---|---|
| 全文档 querySelectorAll（30s） | 3684 ≈ **123/s** | 0 | 主题独有 |
| 每秒唤醒批次数 | ≈30 批/s × 4 个效果 | 0 | — |
| load task | **184.0 ms/s（18.4% 单核）** | 86.4 ms/s（8.6%） | +113% |
| load script | 35.5 ms/s | 9.2 ms/s | +286% |
| load 样式重算次数 | 192.9 /s | 190.4 /s | 相同 |
| load 样式重算耗时 | **655.3 ms** | 353.0 ms | +86% |
| load 布局次数 | 30.8 /s | 30.3 /s | 相同 |
| load 布局耗时 | **953.1 ms** | 203.3 ms | +369% |
| load querySelector（单数） | 2053 ≈ 68/s | 6 | 主题独有 |
| load FPS 均/最低 | 160.9 / 141 | 160 / 161 | — |
| idle task | 80.0 ms/s（8.0%） | 60.9 ms/s（6.1%） | +31% |
| idle 样式重算耗时 | 443 ms | 330.6 ms | +34% |
| idle FPS 均/最低 | 161.4 / 148 | 159.8 / 160 | — |
| 5s profile `querySelectorAll` 自耗时 | **24.9 ms / 0.5%** | — | 最大自耗时 JS 帧 |
| 5s profile `(program)` | 19.5% | 15.6% | — |

**RC1 的机理（本报告最重要的一条）**：三个效果 + 上游两个插件的 5 个 `MutationObserver` 都观察 `document.body` 的 `childList+subtree`；`childList` 无法用 `attributeFilter` 过滤，所以**每一批** DOM 变更都会唤醒全部 5 个观察者。三个 EVA 效果的 `schedule()` 都用 rAF/微任务合并，因此**唤醒次数≈变更批次数（≈30/s），不是变更条目数（≈150/s）**：30 批/s × 4 次查询 ≈ 121/s，与实测 123/s 吻合。也就是说：**主题的查询开销按「批次」计价**；真实流式回复若每个 token 各自成批，唤醒数就等于消息速率。

### 3.2 修复前 → 修复后（同实例同计划）

| 指标 | 修复前 | 修复后 | 变化 |
|---|---|---|---|
| 全文档 querySelectorAll | 3684 ≈ 123/s | **1**（探针自身） | **−99.97%** |
| load task | 184.0 ms/s（18.4%） | **66.4 ms/s（6.6%）** | **−64%** |
| load script | 35.5 ms/s | **14.9 ms/s** | **−58%** |
| load 样式重算次数 | 192.9 /s | 30.3 /s | 见「口误与盲区」② |
| load 样式重算耗时 | 655.3 ms | **47.5 ms** | **−93%** |
| load 布局次数 | 30.8 /s | 30.3 /s | 不变 |
| load 布局耗时 | 953.1 ms | **190.5 ms** | **−80%** |
| load querySelector（单数） | 2053 | 206 | −90% |
| load FPS 均/最低 | 160.9 / 141 | **160 / 161** | 最低值不再掉帧 |
| load 长任务 | 0 | 0 | 都不掉帧 |
| idle task | 80.0 ms/s | 36.8 ms/s | 见盲区② |
| 监听器（load 首→末） | 571 → 307 | 305 → 305 | 无增长 |
| JS 堆（load 首→末） | 48.13 → 30.57 MB | 27.26 → 27.61 MB | 无增长 |
| 5s profile `querySelectorAll` | 24.9 ms | **10.1 ms** | −59% |
| 5s profile 新增助手 | — | `could` 1.2 ms + `rowScope` 1.1 ms | 用 2.3 ms 换掉约 25 ms 扫描 |

### 3.3 修复后 ON vs OFF（当晚配对，同一计划）

| 指标 | ON 修复后 | OFF | 读法 |
|---|---|---|---|
| load task | 66.4 ms/s | 86.4 ms/s | ON 不再高于 OFF（差异主要来自 OFF 那 6 倍重算次数，见盲区②） |
| load script | 14.9 ms/s | 9.2 ms/s | **主题残余 JS 成本 ≈ 5.7 ms/s（0.57% 单核）** |
| load 布局耗时 | 190.5 ms | 203.3 ms | 无实质差 |
| load FPS 均/最低 | 160 / 161 | 160 / 161 | 一致 |
| 全文档查询 | 1 | 1 | 主题侧已归零 |

---

## 四、检查清单（用户第二步要求逐项过）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 高频动画 / rAF 循环 | **有 1 处，已修** | 状态轨 `infinite` 关键帧（`build/session-eva-status.js:209-211` 旧版）动画 `background`；启动遮罩 rAF+`setInterval` 双时钟（`src/boot-screen.js:203,252` 旧版）。`src/theme.css` **零个** `@keyframes`（1955 行全表无关键帧，只有注释里提到不许有） |
| 未节流的 scroll/resize/mousemove | **无** | 全库无 `addEventListener` 绑定这三类事件做脏活 |
| 定时器未清理 | **无泄漏** | `src/boot-screen.js:83-93 bootClearTimers()` 清 rAF + interval + 三个 timeout；disposer 链路完整（三个 effect 的 `dispose()` 均 `disconnect` + `removeEventListener` + 删节点） |
| DOM 频繁读写 | **有，已修** | `paint()`/`sync()` 每批一次全文档查询（RC1）；逐帧写入侧原本已「先比后写」（`decorate()` 幂等，见 `src/client.js:637-658` 记录） |
| 强制同步布局 | **无** | 探针实测 `getBoundingClientRect` 在 load 全程 **0 次**；玻璃效果只在 rAF 合并后的扫描里量一次 |
| 大面积 box-shadow / blur / 滤镜 / 渐变 | **静态存在，但本页零生效，未改** | `src/theme.css`：`backdrop-filter` 42 处、独立 `filter:` 22 处、`box-shadow` 12、`url(` 16、`position:fixed` 16；但被测页 `document.querySelectorAll` 计算样式回读：`backdropEls 0`、`filterEls 0`、`animCount 0`。**没有测量证据就不动它**（F5），且玻璃是用户反复打磨过的视觉 |
| canvas / 粒子 | **无** | 全库无 canvas、无粒子、无 WebGL |
| 事件重复绑定 / 内存泄漏 | **无** | 监听器 305 → 305（load 30s）、堆 27.26 → 27.61 MB，均无增长 |
| MutationObserver 重复唤醒 | **有 5 个 body 子树观察者，已在本主题侧加批过滤** | `src/client.js:305-330`（玻璃）、`src/client.js:903-926`（置顶）、`src/client.js:1189-1198`（微信）、`build/session-eva-status.js:381-385`、`build/plugin-toggle.js:1408-1409`（上游 vendored，未动） |

---

## 五、根因排行（按开销从高到低，含证据与预估收益）

### RC1 每批变更 4 次全文档查询 —— 已修，收益最大
- **证据**：修复前累计 `totalSel` 恰好 4 个选择器各约 1079–1080 次／40 秒：`[data-composer-card]` 1080、`[data-row-key^="session:"]` 1080、`div[data-row-key^="workspace:"]` 1079、`[data-sidebar-right-guide-entry]` 1079；`totalQsa` 4323。调用栈：`at docProto.querySelectorAll <anonymous>:33:30 < at paint(bundle:125414:31)`、`paint(bundle:125498:13)`、`sync(bundle:124635:31)`、`sync(bundle:124675:11)`。5 秒 profile 里 `querySelectorAll` 自耗时 24.9 ms（最大 JS 帧）。指标对比：ON 123 qsa/s vs OFF 0/s。
- **附带发现**：`[data-sidebar-right-guide-entry]` 在本构建的新会话页**恒为 0 命中**（右栏实际用 `data-sidebar-right-*` 属性族），那 1079 次查询是纯浪费。
- **预估收益 → 实测**：主线程 task −64%、脚本 −58%、全文档查询归零；profile 里 `querySelectorAll` 自耗时 −59%。

### RC2 主题让每一次样式重算 / 布局更贵 —— 部分可修、部分未改
- **证据（配对）**：重算**次数**相同（192.9/s vs 190.4/s），耗时 **+86%**（655.3 vs 353.0 ms）；布局**次数**相同（30.8/s vs 30.3/s），耗时 **+369%**（953.1 vs 203.3 ms）。空闲态同向：443 ms / 4849 vs 330.6 ms / 4863（单次重算 +34%）。
- **机理推断**：主题往同一文档注入 `src/theme.css`（141,019 B / 1955 行 / 55 个 token 覆盖、42 处 `backdrop-filter`、16 处 `position:fixed`）与状态样式表（17,532 字符）→ 每次重算要遍历的规则集大得多；多出来的固定层/合成层让每趟布局更贵。**这是从差值+样式表不对称推出的推断，没有单独埋点，按推断标注。**
- **修复后**：重算耗时 655.3 → 47.5 ms（−93%）、布局耗时 953.1 → 190.5 ms（−80%），次数不变。
- **未改部分**：玻璃效果（F5）。被测页 0 个元素带计算后的 `backdrop-filter`/`filter`，没有证据；收益无据 + 视觉风险高 → **不动**。

### RC3 状态轨 `infinite` 关键帧动画的是绘制属性 —— 已修
- **证据**：`build/session-eva-status.js:209-211`（旧）`@keyframes …-breathe{0%,100%{background:var(--…-pending)}50%{background:color-mix(in srgb, var(--…-pending) 35%,transparent)}}`，挂在 `::before` 上、`animation: … 1600ms ease-in-out infinite`。`background` 是绘制属性 → 只要有一行 pending 就**永不停止地逐帧重绘**整条轨。全库唯一的关键帧动画（`theme.css` 零关键帧）。
- **改法（F2）**：改动画 `opacity`（1 ↔ 0.35）。低点原本是「同一支蓝以 0.35 alpha 合成」，而伪元素里只有这一条背景、没有别的绘制 → 给伪元素 `opacity:.35` 是**同一种合成结果**，逐像素一致，关键帧与两档覆盖规则全部不变。
- **验证（活体）**：注入一张 pending 行探针后回读 —— 关键帧文本 `@keyframes dsh-session-eva-status-breathe{0%,100%{opacity:1}50%{opacity:0.35}`；轨底色 `rgb(63, 98, 156)` 不变；`::before` 的计算 `opacity` 实测在 1 → 0.9868 → 0.9363 → … → 0.3527 → … 之间摆动（低点 0.353 ≈ 0.35）；`document.getAnimations({subtree:true})` 报 `dsh-session-eva-status-breathe@::before`；`prefers-reduced-motion` 覆盖规则未动。
- **收益**：省掉「每个 pending 行、每秒 60 帧、整条轨长条重绘」。**未做 CPU 前后测量**（被测页没有 pending 行）。

### RC4 启动遮罩双时钟 —— 已收敛（收益很小，如实标注）
- **证据**：旧 `src/boot-screen.js:252` `bootTick = setInterval(step, 60)` 与 `requestAnimationFrame(step)` **无条件并行**；退场相 `:203` 同样 30 ms 双时钟。写进注释的理由是「标签页被挂起时不让全屏挡板永远盖着应用」。
- **边界**：`BOOT_MS 1600 + HOLD 200 + SLIDE 620 + FADE 320 ≈ 2.5 s`，每次构建只播一次（`localStorage['EVA-Inspired-Theme/boot/seen']`），且 `bootClearTimers()` 每次都清 → **没有泄漏**。
- **改法（F3）**：有 rAF 就只由 rAF 驱动，没有 rAF 才退回 `setInterval`。进度与收尾都是「已过墙钟」的纯函数，两个时钟只是把同一个值多画一遍 → **时序与外观一字不改**；后台挂起时兜底仍由两条 `setTimeout`（`bootFuse` / `bootKill`，被节流也会到点）负责。
- **收益**：启动期每 60 ms 少一次冗余 `step()`，全程 <0.1 ms。**记录为结构整治，不作为性能收益主张。**

### RC5 `enforce()` 自排 promise 链没有收敛预算 —— 已加预算（属加固，不是已验证根因）
- **证据**：旧逻辑在写过 DOM 后无条件 `schedule()`，只有 `moves.length === 0` 才停；若宿主「接受调用但不改顺序」，resolved promise 链会一直自排下去 —— 与 10-09 那条微任务死循环同族（`src/client.js:637-658` 记录：幂等前 32 ms 内 2000 次 `decorate()`，之后 2 个 pass、1 次写）。
- **改法（F4）**：`ATTEMPT_BUDGET = 4` + 轮次签名 `lastRound`。一轮真的发出移动就重置预算；连续两轮签名完全相同才消耗一次（诚实收敛本来就要两轮：一轮发移动、一轮发现无事可做）。宿主滞后时仍有 4 次回旋。

### RC6 5 个 body 子树观察者共存 —— 已在主题侧加批过滤
- **证据**：见检查清单最后一行。`childList` 无法用 `attributeFilter` 过滤，所以每一批变更都会唤醒全部 5 个。
- **改法（F1 的一半）**：每个 EVA 效果在**自己的回调里**先判断这批变更是否可能与自己相关（`touches(records)` / `could(records, selector)`），不相关就直接 return —— 不查询、不排程。玻璃效果的判定是**精确**的（它只订阅 `childList`，匹配集合变化当且仅当有节点被增删，不是启发式）。上游/第三方观察者未动。

---

## 六、逐项改动说明（文件、行号、为什么）

备份（同目录、`.bak-20261011-1500-perf`）：`src/client.js`（69,289 B）、`src/boot-screen.js`（13,662 B）、`build/session-eva-status.js`（21,216 B）、`src/theme.css`（141,019 B，未改）、`build/plugin-toggle.js`（64,091 B，未改）、`client.js`（768,333 B，旧构建产物）、`index.js`（15,469 B，未改）。

### `src/client.js`（工作树 3 个被改文件之一）
| 位置 | 改动 | 为什么 |
|---|---|---|
| `:305-330` | 新增 `could(records, selector)` / `mounted(records)`，玻璃观察者回调首行 `if (!mounted(records)) return` | 玻璃效果原先每批对每个目标做一次全文档查询；它只订阅 `childList`，用增删节点精确判定即可，省掉含恒 0 命中的 `[data-sidebar-right-guide-entry]` 在内的全部扫描 |
| `:577` | 新增常量 `SCOPE_SELECTOR = "[data-slot='sidebar.workspaces']"` | 实测：唯一 `[role='tree']`（14 行）在工作区侧栏内，工作区行与会话行都在它里面 → 这是三个效果共用的唯一容器 |
| `:622-624` | 新增 `ATTEMPT_BUDGET = 4` / `attempts` / `lastRound` | RC5 收敛预算 |
| `:738-770` | 新增 `scopeHost` / `scopeMissed` / `scope()` / `rowsOf()`，`paint()` 首行改 `var rows = rowsOf()`（`:772`） | 查询先收窄到侧栏；**空结果仍回退整份文档**（侧栏可折叠、行可以全不在 DOM 里，收窄是优化不是前提）。`scopeMissed` 初值 `true`：在某一趟真的在侧栏里查到行之前，任何批次都放行；一旦走回退它回到 `true`，批过滤随之整体失效 —— 不知道行在哪，就没有资格跳过它们的批次 |
| `:847` | `enforce()` 内 `if (attempts > ATTEMPT_BUDGET) return` | RC5 |
| `:903-926` | 新增 `touches(records)`，观察者由 `new MutationObserver(schedule)` 改为 `new MutationObserver(function (records) { if (!touches(records)) return; schedule() })` | RC1/RC6。三条「必须放行」规则：变更目标在侧栏内（含侧栏自身）；或增删的节点就是侧栏／包含侧栏（整块重挂，`host.contains` 在**新**节点上求值，旧的已断开）；或侧栏已断开（重挂中，必须重新解析）。属性记录里 `attributes:true` 只观察 `data-row-key`，目标就是行本身 → 天然放行 |
| `:1108-1125` / `:1269-1275` | 新增 `slotNode()` / `markerNode()`，`tree()` 与 `entry()` 改用 | 微信效果每批 `document.querySelector(SLOT_SELECTOR)` + `document.querySelector(MARK_SELECTOR)`；只缓存**槽**（稳定契约），不缓存树（React 会换掉它）。marker 先在槽内找、找不到才回退文档。**微信效果未加批过滤**：它读的 marker 可能在槽之外，收窄查询已拿走主要收益 |

### `build/session-eva-status.js`（vendored `dsh-session-eva-status` 浏览器半 + 主题侧补丁）
| 位置 | 改动 | 为什么 |
|---|---|---|
| `:45-47`、`:114-123` | 补丁清单由 a/b/c 扩到 **a/b/c/d/e**；`PENDING_VAR` 注释整段重写 | 记录改法与上游刷新时要贴回的内容（原文要求「刷新上游时把 a/b/c 贴回来」） |
| `:182-196`、`:219-220` | 关键帧改 `0%,100%{opacity:1}` / `50%{opacity:${BREATHE_LOW / 100}}`；删除已无引用的 `pendingLow` 与助手 `faint()` | RC3。基准色仍走 `--<PLUGIN_ID>-pending` 自定义属性，亮档覆盖（`:195`）与 `BREATHE_LOW = 35` 一字未动 → 两档外观不变 |
| `:350-365` | 新增 `SCOPE_SELECTOR` / `scopeHost` / `rowScope()` / `rowsNow()`（与 client.js 同构），`sync()` 首行改用它 | 补丁 d。`sync()` 原本每批一次全文档 `querySelectorAll(ROW_SELECTOR)`，实测 1080 次/40 秒，且是 profile 里最大自耗时 JS 帧。`dispose()` 里那一次查询是一趟性收尾，未动 |

### `src/boot-screen.js`
| 位置 | 改动 | 为什么 |
|---|---|---|
| `:22-35` | 头注释第 2 条重写 + 新增「2026-10-11 性能」段 | 原注释自陈「rAF 与 setInterval 双时钟」，改后要如实说明：有 rAF 只走 rAF；后台挂起时保证挡板不永驻的是两级兜底 setTimeout；并点明 `bootTick` 一直在清、没有泄漏 |
| `:95-97` | 新增 `bootHasRaf()` | 两处时钟共用同一判定 |
| `:216` / `:219`、`:265` / `:268` | `bootRaf = bootHasRaf() ? requestAnimationFrame(…) : null`；`if (!bootHasRaf() && typeof setInterval === 'function') bootTick = setInterval(…)` | RC4 |

**未改**：`src/theme.css`（玻璃/MATERIAL 一律不动，F5）、`build/plugin-toggle.js`、`index.js`、`cordis.patch.yml`、`package.json` —— 以及**DSH 本体一个字都没动**。

---

## 七、验证结果

**门禁**（`npm run verify`，25 项 0 失败）：
- `node --check` × 3 个被改文件 —— 通过
- `selfcheck.mjs` —— 25 checks, 0 failed（含「hooks registered 6 handlers」「no startup chime」「sounds 恰好 4 个」等）
- `token-audit.mjs` —— `AUDIT OK — 55 overrides, exactly the planned 55 (A 41 + B 14)`
- `build-client.mjs --check` —— `client.js check: OK (in sync with src/, 761544 chars, 55 tokens, 2 wallpapers from out/wallpapers.local.json)`
- 声音层与「宿主半边不注册 HTTP 路由」等既有断言全部通过

**部署版本可信性**：重建后重新加载，宿主重新下发的 EVA bundle 修订号由 `rev=86188ced2f1f` 变为 `rev=a6c17b893a6e` → 正在跑的确实是修好的代码（不是缓存）。

**功能与视觉对等**（重建后重载同一页，与基线逐项比对）：`evaThemeCss true`（17,532 字符）、`__DSH_SESSION_EVA_STATUS__` 为 object、`#eva-lg-defs` 1、`[data-eva-ws-pin-button]` 3、`[data-eva-wx-button]` 1、`[data-composer-card]` 1、会话行 9、工作区行 4、节点数 747 → 746。

**反向验证（防「过滤过头」）**：把 3 个置顶按钮 + 1 个微信按钮全部 `remove()`，1.5 秒后回读 —— **3 / 1，全部自行重建**。批过滤没有挡掉该醒的批次，观察者链路端到端仍然活着。

**状态轨呼吸（活体探针）**：关键帧文本、轨底色、`::before` 计算 `opacity` 在 1↔0.353 之间摆动、`getAnimations` 报 `…-breathe@::before`、`prefers-reduced-motion` 为 false（本机），与该媒体查询的关闭规则互不影响。

**无泄漏**：load 30 秒监听器 305 → 305（修复前 571 → 307）、堆 27.26 → 27.61 MB；三个相位**长任务全程 0**；最低 FPS 141 → 161。

**回滚判据**：任何一项指标劣于修复前基线，或出现功能损失（按钮不再重建、状态轨消失）→ 立即回滚。

---

## 八、口误与盲区（未验证的不写成结论）

1. **没复现用户的灾难态**。用户报的是「明显卡顿、CPU 与内存开销高」，10-09 记录的是「renderer 钉在一核、100%+、内存不增长」。本次 ON 基线测得主题自身开销是 idle 8.0% 单核 / load 18.4% 单核，**不是钉在一核**；而那条同步死循环在本次排查开始前已在工作区修好（`src/client.js:637-658`）且 `--check` 验证出厂包与之同步。**本报告只声明修掉了「可测量、可复现」的那条开销链，不声明修掉了用户的灾难态。**
2. **每帧样式重算噪声（会误导 idle 结论）**：三个会话里有两个出现「约 160 次/秒的样式重算」= 每帧一次（pre-fix ON 161.6/s、OFF 160.1/s），而修复后那次 ON 是 0。**这个噪声与主题无关**（主题关着也有、主题开着也可以是 0），最可能是页面/会话状态差异（焦点、光标、瞬时动画）。因此：**idle 的跨运行对比被污染**，不可单独引用；能被两个会话共同佐证的只有「主题让同样的重算更贵」这一条（+34% / +86%）。修复后 load 的 `RecalcStyleCount` 从 192.9/s 掉到 30.3/s 主要是这噪声消失了，**不是**主题少做了重算 —— 次数本来两边就一样。
3. **修复前基线的负载强度略有差异**：该次累计 3731 条变更，重建后两次为 4561 / 4556 条（同一计划）。修复后**变更更多、开销更低**，所以 pre/post 对比如果偏，是偏向旧代码的。
4. **启动遮罩是测量盲区**：`localStorage['EVA-Inspired-Theme/boot/seen']` 已存在，A/B 全程从未播放 → F3 未做前后测量，RC4 的收益是结构性推算（<0.1 ms）。
5. **pending 呼吸路径同样是盲区**：被测页 `animCount 0`、`evaStates {}`，F2 的「省掉每帧重绘」未做 CPU 测量，只有活体动画正确性验证。
6. **GPU / 栅格开销无法归因**：ego 浏览器的 GPU 进程即使停在 `about:blank` 也持续烧掉约 **36.9% 单核**（renderer 5.8%）—— 那是 screencast/cast 恒定税，不能用它归因主题；`SystemInfo.getProcessInfo` 在 page target 上不可用。renderer 进程差值（ON 15.62% vs OFF 8.59%，单次采样）只能当**指示值**，其中约 1.2 个点可由 CDP task 差值解释。
7. **最小 profile 的局限**：`eva-preview` 只有 3 个 bundle；用户桌面 profile 有 **30 个 bundle**（含 `dsh-wechat-plugin`、`dsh-better-sidebar`、`dsh-smooth-stream`、`dsh-pet`、`dsh-ego-browser`、`dsh-auto-archive` 等）。因此微信分组路径（`WX_GROUP_LABEL='微信会话'`）与右栏路径在预览实例里**根本不会被触发** —— 本次测量隔离的是主题自身的成本，也正是我改掉的那部分；灾难态在最小 profile 中无法复现。
8. **RC2 的机理是推断**：样式表体量 → 单次重算变贵的因果链没有单独埋点，是从配对差值与样式表不对称推出来的。

---

## 九、回滚步骤

**整体回滚（回到本次排查前的 HEAD 状态）**
```powershell
cd C:\Yu\EVA-Inspired-Theme
git checkout -- src/client.js src/boot-screen.js build/session-eva-status.js
node tools/build-client.mjs          # 重新生成 client.js
node tools/build-client.mjs --check   # 应报 in sync
```
（HEAD = `7252007`「Retire the Telegram entry, and leave the WeChat switch on its own」；本次改动前工作树除新 `.bak` 外干净。）

**单项回滚**：把对应 `.bak-20261011-1500-perf` 复制回去覆盖，然后同样跑一次 `node tools/build-client.mjs`。回滚单个文件不影响其它文件的改动。

**注意**：桌面端 profile 现在仍是**停用主题**（`C:\Users\Axiom\.dsh\profiles\desktop\cordis.patch.yml:363-364` 的 `disabled: true`，改前备份 `cordis.patch.yml.bak-20261011-1339-before-eva-cpu-test`，15,474 B）。所以在你重新启用之前，桌面端的实际表现不受本次改动影响。

---

## 十、下一步（需要你点头，我不擅自改）

1. **重新启用桌面端主题**：删掉 `C:\Users\Axiom\.dsh\profiles\desktop\cordis.patch.yml:364` 那一行 `disabled: true`（该块 363-364 两行即 10-09 的停用记录），重启 DSH 桌面端。若不再卡 → 收工；若仍卡 → 剩下的嫌疑就是盲区 4/5/7（启动遮罩、pending 呼吸、30 个 bundle 的桌面实况），探针与驱动器都在 `C:\Work\scratch\`，可以直接在桌面实例上按同一计划复测。
2. **提交**：三个被改文件（`src/client.js`、`src/boot-screen.js`、`build/session-eva-status.js`）目前只在工作树里，未提交；`client.js` 是 gitignore 的构建产物，按 D79 约定不进仓库。要不要提交（以及是否连带走一次发布）由你定。
3. **可选加固**（本次未做，因为无测量证据）：把 `[data-sidebar-right-guide-entry]` 这条恒 0 命中的选择器从玻璃目标里删掉；或把五个 body 观察者收敛成一个共用调度器 —— 两者都需要先拿到「桌面实况仍然贵」的证据再动。
