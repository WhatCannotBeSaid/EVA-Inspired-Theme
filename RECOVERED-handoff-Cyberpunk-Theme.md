# Cyberpunk-Theme 皮肤包（S1 已完成；S2 已交付，停在验收点等确认视觉方向）

**日期**：2026-10-05（Asia/Shanghai）
**状态**：**S1「侦察取真值」完成**；**S2「视觉设计与令牌选择」三份交付物已成稿并自检通过，用户已确认视觉方向、三个决策点全部结案**；**S3 未启动**，等用户下达 S3 指令。
**新会话入口**：读本文件 → `docs\recon.md`（S1 权威）→ `docs\design.md` + `docs\tokens-diff.md` + `docs\contrast-budget.md`（S2 权威）→ 继续。
**上一棒**（相关但不是同一任务）：`<USERPROFILE>\<knowledge-base>\tasks\DSH-外观主题.md`（调色台 dsh-theme-studio v2 已装）。

---

## 1. 目标

在 `<plugins>\Cyberpunk-Theme\` 从零做一款 **DSH 桌面应用皮肤包**：可安装、可验证、可干净卸载、官方默认可完整恢复、不污染官方源码、不依赖安装期构建、关键结论有可复算证据。

分阶段推进（**每个阶段完成必须停下等确认，不许一口气跑完**）：S1 侦察 → **S2 视觉设计与令牌取值** → S3 实现（client.js / paint 层）→ S4 渲染验证 → S5 装载进 profile → S6 真机验收 → 出 PDF 交付到 `<Desktop>`（**不是** `<Desktop>`）。

硬约束（P0 全文已在会话中，摘要见 `recon.md`）：唯一基线是官方默认；只允许叠加**一个可整体移除**的覆盖层；颜色只能走 `ctx.theme.overrideTokens(pkg, {token:{light,dark}})`；不得自行设置 `color-scheme` / `data-ds-dark-theme`；禁 CSS Modules 哈希选择器；**绝不改 `--dsh-content-font-size`**；圆角走 `--dsw-corner-shape`；alias 优先；**未改的令牌不许写进覆盖层**。

## 2. 已定决策

**S1 阶段**
- **包名＝`Cyberpunk-Theme`**（用户 m00312 指定），项目根 `<plugins>\Cyberpunk-Theme\`。
- **明暗双套都做**（用户 2026-10-05T16:12 拍板，原话答「3」）。官方 `ThemeTokenModes {light,dark}` **两档必填**（`ui-theme/src/client/index.ts:56-61`），与 P0「没改的令牌不许重新声明」在单套下必然顶牛。
- **颜色唯一通道**＝`overrideTokens`；**不调用 `theme.setTheme()`**（会持久化写 profile）。
- **注入面＝body 层**，实测足够（112/112 全胜），**不需要另开 paint 层**（仅颜色）。
- **S5 装载＝两步**：包进 `dependencies` + 包名追加进 `dsh.profile.bundles`（只做第一步不会挂载，`profile.ts:739,743`）。
- 不创建 skill；不 `git push` / 不 `npm publish`。

**S2 阶段（本阶段新定）**
- **视觉语言走「有参考图」分支**：从 8 张图提炼出五条关系（色彩/厚薄/几何/材质/比例），**不自行发明另一套风格**。视觉概念＝「**界面是暗室，内容是窗外那座发光的城**」。
- **信号色 5 个**：青（品牌/链接/主按钮）`#45E0F2`/`#0A6E80` · 洋红（信息/选中/焦点环）`#FF57B0`/`#B01B6E` · 绿（成功）`#4AE58C`/`#0B6B3C` · 琥珀（警告）`#FFB53D`/`#8A4A05` · 红（错误）`#FF4A55`/`#C01A28`（暗/亮）。
- **中性色阶程序化生成**（OKLCh 锚点），暗阶 h≈235°、亮阶 h≈250°，**22 个中性色全部 `b*<0`、纯灰 0 个**。
- **几何**：`--dsw-corner-shape: bevel`（官方 `superellipse(1.5)`）+ 半径对折（4/8/12/16/20/28px → **2/4/6/8/10/12px**）。不逐组件改 border-radius。
- **动效**：`--ds-ease-in-out: cubic-bezier(0.2, 0.85, 0.15, 1)`（官方 `(0.4,0,0.2,1)`）+ 三档时长同比例 ×0.7（0.14/0.07/0.22s）。
- **字体**：`--dsw-font-family` **前置** `'Bahnschrift','DIN Alternate',`（零资产；本机实测 Bahnschrift 存在、Cascadia/Rajdhani/Orbitron 等均不存在）。
- **令牌预算**（`<令牌预算>` 占位符用户未填，自行给并声明）：**A 必改 ≤45 实际 41 / B 可选 ≤15 实际 13 / C 禁止 22 组**。合计 54 个 = 官方自有令牌 432 的 12.5%。A 层只取派生图的**根**，纯转发令牌一律不写进覆盖层。
- **不做设置面板**（`<设置面板>` 占位符措辞是「如果需要」；理由见 `design.md` §6，含备选字段表）。
- **不动投影体系**（`--dsw-shadow-lv*` 官方零消费者；`--dsw-elevation-*` 是组件级合成）。层级由「发丝描边 + 表面明度阶」承担。
- **壁纸＝选项 A**（用户 2026-10-05 决议）：暗色用原图、**亮色用程序提亮的同构图**；必须走 S3 的 paint 层 CSS，且提亮步骤是**设计期**的、产物随包提交。
- **字体前置 Bahnschrift＝保留**（用户 2026-10-05 决议），留 A 层；**S4 必须验证三种文本换行**。
- **洋红承担 business / 焦点环＝接受**（用户 2026-10-05 决议）；`--dsw-focus-ring-color` 仍不写进覆盖层。

## 3. 动过的文件与路径

**本任务产出（全部在项目目录内，未进桌面）**
```
<plugins>\Cyberpunk-Theme\docs\recon.md            622 行 / 69,824 B    S1 权威报告
<plugins>\Cyberpunk-Theme\docs\design.md           306 行 / 20,510 B    S2 视觉语言设计
<plugins>\Cyberpunk-Theme\docs\tokens-diff.md      201 行 / 25,770 B    S2 令牌差异表（生成物，A=41 B=13 C=22）
<plugins>\Cyberpunk-Theme\docs\contrast-budget.md  163 行 / 13,994 B    S2 对比度预算（生成物，32 对）
<plugins>\Cyberpunk-Theme\tools\*.py               20 个可复跑脚本（ast.parse failures=0）
<plugins>\Cyberpunk-Theme\out\                     19 个文件（JSON 证据 + 对照 PNG）
```
四份 docs 全部 `U+FFFD=0`（无乱码）。

- 侦察期临时根目录 `<plugins>\tmp\skin-recon\` 已于 2026-10-05T16:07:01 整体迁入上表并删除源目录。
- `recon.md` 于 16:1x–16:34 追加：§5.1 明暗把关机制、§6.2.1 声明位置≠可达性、**§7.1 补测专节**、**§15 运行时状态复核**、§11 冲突表增至 **14** 条、§12 坑增至 **14** 条、§13 探针表补 5 行、§1 摘要补第 11–13 条。
- **S2 新增工具**：`tools\s2-palette.py`（颜色唯一真源，纯标准库）、`tools\s2-emit.py`（生成 tokens-diff.md）、`tools\s2-budget.py`（生成 contrast-budget.md）、`tools\s2-lookup.py`（令牌事实查询）、`tools\s2-refcount.py`（四口径引用计数）、`tools\s2-derivation.py`（根 vs 纯转发）、`tools\s2-token-baseline.py`（官方原值）、`tools\s2-wallpaper-metrics.py`（8 图量化，需 numpy+Pillow）。
- **S2 新增产物**：`out\s2-palette.json`(37,136 B)、`out\s2-refcount.json`(68,295 B)、`out\s2-token-baseline.json`(375,719 B)、`out\s2-wallpapers.json`(15,341 B)。
- 本文件 `<USERPROFILE>\<knowledge-base>\tasks\Cyberpunk-Theme.md`（交接）。

**只读、未修改**（2026-10-05T17:12:09 复验，门槛 15:50:33 之后被改文件数）：`<plugins>\reference\deepseek-harness` **0**、`<plugins>\dsh-skin-studio` **0**、`<plugins>\dsh-theme-starwake` **0**、`app.asar` 与安装目录 0。

**profile 状态（S5 之前不得由我改动）**：2026-10-05 17:58–19:12 该 profile 被**外部**大幅改写（非本会话所为）：`cordis.patch.yml` 23,282 B → **1,811 B @18:58:40**（已无 `ui-theme` 与 `theme-starwake disabled` 条目）、`package.json` 2,540 B → **2,465 B @19:12:04**（`dependencies` 28→**25**，`dsh.profile.bundles` 33→**30**，两者均已无 theme/skin/studio 条目）、`pnpm-lock.yaml` 116,267 B @19:12:03、`pnpm-workspace.yaml` 2,548 B @19:12:04、`cordis.yml` 223 B @19:12:25。目录内留有改动备份：`cordis.patch.yml.bak-20261005-before-roam-2b3pro`(23,833 B @17:20:30)、`…bak-1791195206643`(24,112 B @17:58:29)、`…bak-1791195269419`(217 B @18:13:27)、`package.json.bak-20261005-171854-before-link-migration`(2,540 B)。**复验确认这轮改动未改变任何观测量**（见 §4）。
残留：`node_modules\` 下三个 junction（`dsh-theme-starwake`→`<plugins>\dsh-theme-starwake`、`dsh-theme-studio`→`<plugins>\theme-work\studio`、`dsh-skin-studio`→`<plugins>\dsh-skin-studio`），已不被加载，**未处理**。

## 4. 验证结果

**S1（详见 `recon.md`）**
- **三个待证问题**：(a) `dsh plugin --profile desktop list` **EXIT=0**（技能文档「desktop 必定失败」错在没区分两条入口，源码解释 `apps/cli/src/args.ts:195`）；(b) **没有令牌需要另开 paint 层**（`refsWithRootSUBJECT=3`，only-root=**0**；P0 的 4 个候选逐个复核，**实测不是 4 个**）；(c) 目标包不在 `dsh.profile.bundles`（现 29 条），**「只有 dependencies 不会挂载」源码+活证据双证**。
- **通道与杠杆**：112 组 `bodyInlineWins`/`restored` 全 True。杠杆 `--dsw-corner-shape` **597** > `--dsw-alias-label-primary` 327 > …；**第二条非颜色杠杆 `--dsw-elevation-stroke-color`**（refs=1 却撬动 600 元素）。
- **计数对账**：`432` 可复现；**`134/86/212` 本机无法复现**（同口径颜色类是 216）；493＝placed；body 上实际自定义属性名 **498**。
- **14 个 `changed=0` 令牌全部定性**：2 当前活着 / 10 状态门控 / 1 被官方有意遮蔽 / 1 值不由它供给（`--dsh-boot-bg`，**改它永不生效**）。
- **运行时基线复核**：S1 基线**未被主题插件污染**（亮色 498/498 令牌逐条一致；三个已安装主题包**根本没挂载**，因为不在 `dsh.profile.bundles` 里）。

**S2（本阶段实跑，全部可复算）**
- `$pyr tools\s2-palette.py` → **`unresolved=0`，32 对对比度全部达标**（暗 `label-primary/bg-base` 17.22、亮 18.02；暗 `brand-primary/bg-base` 12.28、亮 4.79；暗 `label-primary-foreground on brand` 12.33、亮 5.47）。
- **官方自身在其中 9 对上不达 AA**（官方暗 `label-caption` 4.24、官方亮 `caption` 2.13、官方亮 `dimmed` 1.26、官方亮 `success-primary` 2.28、官方亮 `warn-label` 2.79 等）——本主题逐个补上并写进 `contrast-budget.md` §2.1。
- **冷暖偏向实测**：22 个中性色 CIELAB `b*` 全部为负（暗 −1.92…−6.70 / 亮 −3.47…−8.62），**纯灰 0 个**。
- **色相家族互斥**：4 个状态色相邻最小间距 **46°**，与官方 warn/error 的 46° 同级，未引入更差区分度。
- **壁纸预算（P0 §9 定量化）**：8 张图 p95 代进 72%（暗）/80%（亮）veil，正文对比度 **7.01:1 … 16.64:1，8 张 24 个分位全部 OK**。两档的 art 亮度边界都退化为「无约束」（veil 已足够厚）→ **可读性不是亮色模式的瓶颈，图像可见度才是**。
- **生成物自检**：`s2-emit.py` 报 `missing` 为空（三个令牌名对不上已修正，见「别重做的坑」第 17 条）。
- **26 个脚本 `ast.parse` failures=0**；四份 docs `U+FFFD=0`。

**S2 收尾复验：基线在 profile 大幅改动之后依然成立（19:16–19:18，只读）**
- **触发**：profile 在 17:58–19:12 被外部大幅改写（`cordis.patch.yml` 23,282 B → **1,811 B**，`package.json` 2,540 → 2,721 B，`dsh.profile.bundles` 一度 29 → **33**，新增的正是 `dsh-skin-studio`/`dsh-theme-starwake`/`dsh-theme-studio`）。用户随后说明已把主题插件全部卸载并授权重验。
- **做法**：旧产物先另存为 `out\*.S1-<HHmm>.json`，再重跑 `tools\probe-runtime-state.py`(py314) 与 `tools\probe-baseline.py`(py314)。
- **结果：逐条一致**——`light/dark.bodyComputed` **498/498，0 增 / 0 删 / 0 变**；`htmlComputed` 71/71 同样 0/0/0；`bodyInline`/`htmlInline`/`dataAttrs` **完全一致**；`bodyVars` 498/498 值全同。
- **主题插件指纹两次都是 0**（扫 `valley`/`endfield`/`starwake`/`studio`）；命中的只有 `--ds-`(52，**官方前缀**)、`lc-`(16，第三方)、`scu-grad`(1，`dsh-session-colorful-unread-pin-jobs`)，两次数量完全相同。
- 样式表原始条数 233 → 236，但按「href+ownerId+ownerAttrs」去重后两次都是 **169 个唯一身份**，唯一差异是某个 ant-design CSS-in-JS 表换了 `data-css-hash`——**没有任何令牌值随之改变**。
- **顺带确证方法论前提**：`html` 的 `data-ds-theme-source=**system**`，且 `color_scheme` 两档抓取都拿到正确组合 → **明暗抓取方法依然有效**（前提 `ui-theme.preference === 'system'`，见「别重做的坑」第 1 条）。
- **结论：`out\` 与 `docs\` 四份文档继续有效，无需重新推导**；profile 那轮改动（含三个主题包短时挂载又卸载）**在渲染后的运行时里没留下任何痕迹**。已写入 `docs\recon.md` **§16**。
- **同期发现、本次未处理的残留**：profile 的 `node_modules\` 下仍有三个 **junction** 指向 `<plugins>\dsh-theme-starwake`、`<plugins>\theme-work\studio`、`<plugins>\dsh-skin-studio`；已不在 `dependencies`(25) 也不在 `bundles`(30) 里，**不会被加载**。删除只需 `cmd /c rmdir "<junction>"`（**绝不递归**，否则会删到目标源目录）。

## 5. 下一步

**S5 装载完成（2026-10-05 21:21–21:26）。`dependencies` 与 `dsh.profile.bundles` 双项齐备，install EXIT=0。等用户手动重启 DSH，不进 S6。**
- **最终核对**：`dependencies` **26 条**，`"Cyberpunk-Theme": "link:<plugins>\Cyberpunk-Theme"` · `dsh.profile.bundles` **31 条**，含 `Cyberpunk-Theme`（第 18 条）。**双项齐备 ≠ 已挂载 —— bundles 只在 DSH 启动时生效，重启前它一个字节都没被读过。**
- **手工流程用的命令**：`node "<USERPROFILE>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\pnpm\dist\pnpm.mjs" install`（workdir＝profile）。**EXIT=0**，输出：`? Verifying lockfile against supply-chain policies (348 entries)...` / `Lockfile is up to date, resolution step is skipped` / `Packages: +4 -26` / `✓ Lockfile passes supply-chain policies (348 entries in 1.6s)` / `dependencies: + Cyberpunk-Theme 1.0.0 <- ..\..\..\..\..\DSH\Cyberpunk-Theme` / `Done in 2.1s using pnpm v11.7.0`。**二次 install：EXIT=0，`Already up to date`**（幂等）。
- **`link:` 是 junction，内容即改即生效**：`node_modules\Cyberpunk-Theme` → `<plugins>\Cyberpunk-Theme`（ReparsePoint/Junction）。S6 改内容**不需要重新 install**，改完 `<plugins>\Cyberpunk-Theme\client.js` 就是新的。所以本次的 `Already up to date` **不代表内容陈旧**（与规范 §五 的陷阱不冲突：那里防的是 registry 同版本内容变化）。
- **`+4 -26` 的交代**：首次 install 移除 26 个包，是 `node_modules` 相对 lockfile 的漂移被剪掉。证据：`dependencies` **26 条逐条可解析**；`bundles` **25/31 可解析**，缺的 6 条全是 `@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-experimental-*` —— 应用自带基础包，**由安装目录提供，本来就不该出现在 profile 的 node_modules 里**；二次 install 报 `Already up to date` ⇒ node_modules 已与 lockfile 完全一致。
- **危险项未触发**：install 前后 `node_modules\@deepseek-ai\dsh-tools` 均**不存在**。workspace 文件警告的「遮蔽 bundle 副本 → 所有工具调用报 `prepare`」没有发生。
- **`pnpm-lock.yaml` 变化**：116,267 B/3,350 行 → 116,394 B/3,353 行（**+127 B / +3 行**），新增项 `Cyberpunk-Theme: specifier: link:<plugins>\Cyberpunk-Theme` / `version: link:../../../../../DSH/Cyberpunk-Theme`。
- **三个备份（都在 profile 目录）**：`package.json.bak-20261005-2115-before-cyberpunk-theme-install`(2,465 B, sha256 `7B9386ED…DFA0`) · `pnpm-lock.yaml.bak-20261005-2115-before-cyberpunk-theme-install`(116,267 B, sha256 `77EF437A…9D8C`) · `pnpm-workspace.yaml.bak-20261005-2120-before-dsh-context-merge`(2,548 B, sha256 `F4F4311A…4945`)。
- **CLI 路径最终结论**：`dsh plugin --profile desktop add` 本身**不可用**（被既有 `dsh-context` 重复行 + 供应链策略挡住，EXIT=1）；合并那一行后**没有再试 CLI**，直接走规范授权的**手动流程**成功。下次若要用 CLI，值得先单独验证它是否已恢复。
- **⏭ 用户手动重启后 → S6**（不要在重启前做任何挂载断言）：
- **① 备份（已做，哈希校验通过）**：`package.json.bak-20261005-2115-before-cyberpunk-theme-install`（2,465 B，sha256 `7B9386EDFA4A7CBE2297EAFA248B26E517F250249F37EE1F39713A422E34DFA0`）· `pnpm-lock.yaml.bak-20261005-2115-before-cyberpunk-theme-install`（116,267 B，sha256 `77EF437A07A28FAB87DF9BDB08124C268DCF0CCCDDD468C34DB8F1671EDA9D8C`）。均在 `<DSH_HOME>\profiles\desktop\`。
- **② CLI 实测**：`dsh plugin --profile desktop list` → **EXIT=0**，25 packages，无 `Cyberpunk-Theme`。`dsh plugin --profile desktop add link:<plugins>\Cyberpunk-Theme` → **EXIT=1**。
- **③ 原始错误（完整）**：
  ```
  ? Verifying lockfile against supply-chain policies (348 entries)...
  ✗ Lockfile failed supply-chain policy check (348 entries in 991ms)
  [ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:
    dsh-context@0.64.0 was published at 2026-10-05T07:27:43.654Z, within the minimumReleaseAge cutoff (2026-10-04T13:16:30.294Z)
  [WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.
  dependencies:
  + Cyberpunk-Theme link:<plugins>\Cyberpunk-Theme
  dsh: plugin command failed; diagnostics: ...\.plugin-manager\logs\operation-a7Bx80\pnpm.log
  ```
  日志尾行：`Command failed with exit code 1: "…DeepSeek Harness.exe" --expose-internals "…\runtime\pnpm\bin\pnpm.mjs" add "link:<plugins>\Cyberpunk-Theme"`
- **④ 根因（不在本包上）**：`<DSH_HOME>\profiles\desktop\pnpm-workspace.yaml` 里 **`dsh-context` 出现两行** —— **L12** `- dsh-context@0.62.3 || 0.63.0` 与 **L25** `- dsh-context@0.64.0`。按本机既定口径「同名多行只有第一条生效（pnpm first-match-wins）」，**L25 被忽略** → 0.64.0 实际未获豁免 → 策略拒绝。重复包名体检：全表**只有 `dsh-context` 一项重复**。`minimumReleaseAge` 全机只出现在 `pnpm-workspace.yaml:6`（`<USERPROFILE>\.npmrc`、profile 内 `.npmrc` 均未设置该策略）。`link:` 依赖不走 registry，**本包与这条违规无关**。
- **⑤ 一行修复（未执行，待用户点头）**：把 L25 合并进 L12 → `- dsh-context@0.62.3 || 0.63.0 || 0.64.0`，删除 L25。豁免的版本集合不变，只是让用户**已经写下**的豁免真正生效。
- **⑥ 未走手动流程的原因（两个风险，都已实测/有据）**：ⓐ 改 `pnpm-workspace.yaml` 是供应链策略文件，**不在 S5 规范点名的步骤里**，按「未点名不动」先报告；ⓑ `pnpm-workspace.yaml` 自己的注释警告：**任何把 `@deepseek-ai/dsh-tools` 带进 `profiles\desktop\node_modules` 的 install 都会遮蔽 bundle 里的副本，导致所有工具调用报 `Cannot read properties of undefined (reading 'prepare')`**（boot 正常，只有工具调用死）。当前 `node_modules\@deepseek-ai\dsh-tools` **不存在**（干净）→ 一次全量 `pnpm install` 有把它带回来的风险，可能直接打断当前会话。
- **⑦ 装载核对（现状）**：`dependencies` 无 `Cyberpunk-Theme`（25 条）· `dsh.profile.bundles` 无 `Cyberpunk-Theme`（30 条）· `node_modules\Cyberpunk-Theme` 不存在。**两者都没有，即完全未装载。规范口径：有依赖、无 bundles ＝ 未挂载。**
- **⑧ 重启机制**：`dsh.profile.bundles` 只在 DSH 启动时生效，必须**完全重启 DSH**。**重启会结束当前 AI 会话，故不自行重启** —— 由用户手动退出并重新打开。

**S6 入口（用户手动重启后，开新会话时）**：读 `<USERPROFILE>\<knowledge-base>\tasks\Cyberpunk-Theme.md` → `<plugins>\Cyberpunk-Theme\docs\render-report.md` §0 证明边界。S6 要做的：① 先核对 `dependencies` **与** `dsh.profile.bundles` **都**含 `Cyberpunk-Theme`；② 确认运行时真的挂载了（`data-plugin` 样式表出现、54 个令牌写进 body 行内、`--cp-wall` 有值）；③ 复跑四态与对比度（这次是**真实 `overrideTokens`**，不再是替身）；④ 卸载验证（干净移除、官方默认完整恢复）。

---

**S4 已完成（2026-10-05 21:0x），停在 S5 之前。**
- **产物**：`<plugins>\tmp\Cyberpunk-Theme-render\`（`census.json` 1,984 B · `samples.json` 5,310,087 B · `shots\` 6 张整页 · `samples\` 每态每区域裁剪 · `compare\` 2 张 fullpage + 14 张逐区域并排）＋ **`docs\render-report.md`**（195 行，含 §0 证明边界）。
- **工具**：`tools\verify-render.py`（`--census`/`--light`/`--dark`）。注入＝读出厂 `client.js` → 页面装 `window.__ModuleLoader__` 捕获器 → `add_script_tag` → 手工调 `factory` → 替身 theme 服务调 `apply`。**TOKENS/CSS/WALLPAPER_DECLARATIONS 全是出厂字节，唯一替身是服务对象。**
- **四态全部可复现**：`official-light` `rgb(255,255,255)`/none/230 styles → `theme-wall-light` `rgba(227,232,238,0.76)`/**gradient+url**/231 → `theme-nowall-light` **gradient-only** 且 `--cp-wall: none`；暗色同构 `rgb(21,21,23)` → `rgba(7,13,17,0.64)`。
- **采样 7 点全 ≥4.5:1**：亮色 11.52/10.46/11.50/18.82/10.09/**10.02**(代码块最紧)/18.48；暗色 15.02/14.88/14.75/12.28/13.31/14.87/14.09。**几何独立获证**：浏览器实测 `cornerShape=bevel` 全域成立、半径 0/12/16px。
- **与 S2 预算对账**：亮色模型 `#b9bdc2`/9.98 → 实测 `#b9bec8`…`#c8cad4`/10.02…18.82（**模型成立**）；暗色模型 `#414548`/8.51 → 实测 `#121d28`…`#2c2c2e`/12.28…15.02（**模型偏保守**）。无壁纸态亮 `#e5e9ef`/暗 `#080e11`。**无一项超阈值。**
- **令牌链无一处断裂**：`s2==s1`＝**0** · `s3==s2`＝104 · `s3==s2+alphaByte`＝**4** · **浏览器实际值 vs S3 生成值 108/108 全一致，MISMATCH 0**。
- **偏离官方逐条可解释**：直接 54 · 派生 80（每条带 `from`）· 画皮自有 5 · **未解释 0**；body 属性 498→503 无删除。
- **据 census 修掉一个真缺陷**：`src\theme.css` Shell 段把从 starwake 抄来的**死选择器** `[data-shell-bottom]` 换成真实契约 **`[data-dsh-bottom-panel]`**；`tools\s3-probe-shell.py` 同步 + `KNOWN_CONDITIONAL` 清空 → 重建后 **8/8 命中**。
- **不可达项（带理由）**：设置页两边都不存在（profile 的 `- id: ui-settings` 带 `config:{enabled:false}`）。
- **副作用（如实登记）**：为采样点了一次「继续」确认首启通知；之后新上下文通知未再出现。是持久偏好还是本进程内存标志**未区分**（需重启，而那会结束会话）。
- **开放问题 4 条**：① 通知副作用归属未定；② 暗色实测面比模型暗未逐层拆解；③ S2 的 strict 契约（+label-tertiary）亮色不可行**仍未裁决**——若确有 tertiary 落在半透明面上，要砍的是亮色壁纸而非对比度目标；④ **卸载路径未执行**。

**S5（下一步，等用户点头）**：安装进 profile 并要求重启 —— **重启会结束当前会话**。届时才第一次真正执行 `dsh.bundle.patch` 挂载、`exports["./client"]` roster 加载、`theme.overrideTokens` 真实服务；**S4 只证"画得对"，不证"装得上"。**


**S4 已完成（2026-10-05 21:0x），停在 S5 之前。**
- **产物**：`<plugins>\tmp\Cyberpunk-Theme-render\`（`census.json` · `samples.json` 5.3 MB 全量采样 · `shots\` 6 张整页 · `samples\` 每态每区域裁剪 · `compare\` 2 张 fullpage + 14 张逐区域并排）＋ **`docs\render-report.md`**（195 行，含 §0 证明边界）。
- **工具**：`tools\verify-render.py`（`--census` / `--light` / `--dark`）。注入法＝读出厂 `client.js` → 页面里装 `window.__ModuleLoader__` 捕获器 → `add_script_tag` → 手工调 `factory` → 用替身 theme 服务调 `apply`。**TOKENS/CSS 全是出厂字节，唯一替身是服务对象。**
- **四态全部可复现**：`official-light` `rgb(255,255,255)`/none/0 layers → `theme-wall-light` `rgba(227,232,238,0.76)`/gradient+url/3 layers → `theme-nowall-light` gradient-only 且 `--cp-wall: none`；暗色同构 `rgb(21,21,23)` → `rgba(7,13,17,0.64)`。样式表 230→231。
- **采样 7 点全部 ≥4.5:1**：亮色 11.52/10.46/11.50/18.82/10.09/**10.02**/18.48（最紧是代码块）；暗色 15.02/14.88/14.75/12.28/13.31/14.87/14.09。**几何独立获证**：浏览器实测 `cornerShape=bevel` 全域成立、半径 0/12/16px。
- **与 S2 预算对账**：亮色模型 `#b9bdc2`/9.98 → 实测 `#b9bec8`…`#c8cad4`/10.02…18.82（**模型成立**）；暗色模型 `#414548`/8.51 → 实测 `#121d28`…`#2c2c2e`/12.28…15.02（**模型偏保守**）。无壁纸态：亮 `#e5e9ef`（模型 ≈`#e7eaee`）、暗 `#080e11`（模型 ≈`#070d11`）。**无一项超阈值。**
- **令牌链无一处断裂**：`s2==s1`＝**0**（没有未改动令牌被声明）· `s3==s2`＝104 · `s3==s2+alphaByte`＝**4**（两个 veil 面×两档）· **S3 生成值 vs 浏览器实际值 108/108 全一致，MISMATCH 0**。
- **偏离官方逐条可解释**：直接覆盖 54 · 派生 80（每条追到源令牌）· 画皮自有 5 · **未解释 0**；body 属性 498→503，无删除。
- **不可达项（带理由）**：设置页两边都不存在（`ui-settings` 带 `config:{enabled:false}`）。
- **副作用（如实登记）**：为采样点了一次「继续」确认首启通知；之后新上下文通知未再出现，是持久偏好还是本进程内存标志**未区分**。
- **开放问题**：暗色实测面比模型暗未逐层拆解；S2 的 strict 契约（+label-tertiary）在亮色不可行**仍未裁决**；卸载路径未执行。

**S5（下一步，等用户点头）**：安装进 profile 并要求重启 —— **重启会结束当前会话**。届时才第一次真正执行 `dsh.bundle.patch` 挂载路径、`exports["./client"]` roster 加载、以及 `theme.overrideTokens` 的真实服务；S4 只证"画得对"，**不证"装得上"**。

---

1. **视觉方向已确认（2026-10-05，用户复「1 A / 2 保留 / 3 接受」），三个决策点全部结案**：
   - **决策点 1｜壁纸＝选项 A**：暗色用原图、亮色用**程序提亮的同构图**。⇒ **S3 必须引入 paint 层 CSS**（`overrideTokens` 只能改颜色，加不了 `background-image`），并新增一个**设计期**提亮步骤；提亮后的图必须随包提交，**不得安装期生成**（与 `client.js` 同一条纪律）。已写进 `design.md` §7 决议表。
   - **决策点 2｜字体＝保留** `--dsw-font-family` 前置 `'Bahnschrift','DIN Alternate',`，留在 A 层；**S4 必须验证长中文段落 / 长英文标识符 / 代码块三种文本的换行**。
   - **决策点 3｜洋红＝接受**承担 `state-business-primary` 与焦点环；`--dsw-focus-ring-color` 仍然**不写**进覆盖层（官方 `focus.css` 的 `var()` 回退自动继承）。
2. **S3 范围**（已明确，**待用户下达 S3 指令后执行；未下达不得动手**）：写 `index.js` + `client.js`（浏览器半边，只调 `overrideTokens`）+ `src\` 单一真源 + `cordis.patch.yml`；壁纸走 paint 层 CSS（壁纸以自定义属性承载 + `background-attachment: fixed`），亮色档用提亮后的派生图。**`client.js` 必须随包提交，不允许安装时再生成。**
3. **S4 必须用浏览器真实合成色重做对比度验证**（不能复用 S2 的计算值），并覆盖渐变/`color-mix()`/`backdrop-filter`/四种交互态；若改字族，必须验证「长中文段落 + 长英文标识符 + 代码块」三种文本。
4. 未决项（不许当默认值用）：`134/86/212` 的出处；`489` vs `491` 差 2 个是谁；`cordis.patch.yml` 在 16:20:28 被谁改了（净减 3 字节，**未改变任何观测量**，但未归因）。

## 6. 别重做的坑

**S1 遗留（1–16，逐条保留）**
1. **`color_scheme` 式探针只在 `ui-theme.preference === 'system'` 时有效**（`boot-theme.ts:27`）。偏好是显式亮/暗时 `matchMedia` **根本不被查询**，探针会**静默**给错档。当前 `cordis.patch.yml:115` = `preference: system`。上一棒交接说「`color_scheme` 无效」——那条在当时对（那时是 `light`），**现已过时**。抄结论要连前提一起抄。
2. **`dsh plugin --profile desktop exec <anything>` 会触发 pnpm 锁文件校验/安装流程**——S1 误跑过一次，事后核对无损伤。**S5 之前不要碰 `exec`。**
3. **`Select-Object -First N` 会掐死上游原生命令**（`EXIT=1` 是测量伪影）。要么全量消费，要么先落文件再截。
4. **`<plugins>\dsh-theme-starwake` 有 7 个文件 mtime 落在 15:06–15:35，早于本会话第一次写入（15:50:33）——不是我改的**；S5 动 profile 前确认那个任务已收工。
5. **建引用图不要用 `rule.style[i]` 索引枚举**（会让 `@supports` 内的属性凭空消失）。必须解析 `rule.style.cssText`。
6. **不要手工翻 `data-ds-dark-theme` 取暗色真值**（`preference=system` 下会得到混合态）。要让浏览器 context 的 `color_scheme` 驱动官方 boot 链。
7. **「只声明在 `:root`」≠「不可达」**：body 是 html 后代，body 行内仍压得过 `:root`。只有「消费规则**主体**是 html」才不可达，实测 **0**。
8. **`--dsh-boot-*` 家族声明在 `._boot_u7vgf_3`**（boot 屏自身作用域），body 层到不了。
9. **不要调用 `theme.setTheme()`**：会把外观偏好**持久化写进 profile 的 `cordis.patch.yml`**。
10. **`remove` 清不掉 `node_modules\<pkg>` 的 junction**，要 `cmd /c rmdir "<路径>"`（**绝不递归进目标**）——未复验。
11. **不要用 CSS Modules 哈希类名**（`RlGAzG_input` 等在实测输出里大量出现，随构建变化）。用官方 `data-*` 契约（`recon.md` §9 列了 59 个）。
12. 看真实渲染要用**本机会话 cookie**；**带 token 的 URL 从不打印**。
13. 别用 pwsh 递归列 `~/.dsh` 下所有 `*.log`/`*.txt`，也别全盘 `Get-ChildItem -Recurse` 找文件——先 `Test-Path` / `where`。
14. **不要靠读 `data-ds-theme-source` 守门**（它在 `<html>` 上不在 body 上）。**用渲染结果守门**：`html` 的 `color-scheme`、body 的 `data-ds-dark-theme`、`--dsh-boot-bg` 三值与所请求档一致。
15. **不要用「假 `<body>`」测以 `body`/`html` 为主体的规则**：Chromium 不渲染嵌套 body，computed 不重算 → **假阴性**。合成元素测试只证明「规则接好了」，不证明「应用渲染了它」。
16. **判「规则主体」要看最右的复合选择器**（剥 `[...]`/`(...)` 后按 `[\s>+~]` 切，取最后一个 token）。看最左会把 `html[...] body :focus-visible` 误判成 html 主体。

**S2 新增（17–22）**
17. **`--dsw-specific-sidebar-fill` 不带 `alias` 前缀**（官方命名不一致，A 级实测）。生成器必须用 `prefix = "--dsw-" if suffix == "specific-sidebar-fill" else "--dsw-alias-"`；写死前缀会**静默漏掉**这个令牌。`s2-emit.py` 的 `missing` 自检就是为此——**新增令牌后必须看它是否报 missing**。
18. **对比度表用短名（`label-primary`），官方原值表用全名（`--dsw-alias-label-primary`）**：直接 join 会**静默**得出「官方 0 处不达 AA」的错误结论（我第一次跑出 `officialFail=0` 就是这个 bug）。join 前必须做全名解析（`s2-budget.py` 的 `full()`）。
19. **半透明可读性求解器必须分方向**：亮 ink + 暗 veil ⇒ 求合成色**上限**；暗 ink + 亮 veil ⇒ 求**下限**。对亮色模式沿用「越暗越安全」会得 `compMax #000000 / artMax 0` 的**荒谬值**（且不报错）。
20. **别把手写的引用数写进生成物**。`s2-emit.py` 的 PLAN 里我写过「N 处引用」，与生成表的 `primary` 口径不一致（44 处），已全部改成「引用数见左表」。**同一数字只能有一个来源。**
21. **8 张参考图没有一张是亮的**——最亮 `l89r6q` 平均亮度仅 0.2228、中位 0.1593；我最初目视判断「这张很亮」是**错的**（亮的是窗区）。**亮度必须量化，不能目视。** 这直接决定了亮色模式的壁纸方案必须另想办法。
22. **`--dsh-content-font-size` 之外，`--dsh-content-font-delta`（121 引用）也是同族禁改**：它是行高补偿，单独改会让行距与字号脱钩。

**S3 新增（23–28）**
23. **块注释里别写带 `*/` 的路径**：`index.js` 的文档注释里写了 `profiles/*/node_modules`，其中的 `*/` **提前终止了注释**，`node --check` 报 `SyntaxError: Unexpected identifier 'volatile'`（index.js:28）。写成 `profiles/<name>/node_modules`。**只要注释里出现通配路径就先想一下 `*/`。**
24. **校验脚本自己也会把注释当代码**：`selfcheck.mjs` 的 `css.7` 一上来把 CSS 注释文本当成选择器解析（报了一堆英文句子）。**任何"抽取选择器/键值"的校验，第一步都得先剥注释。**
25. **别用 `[A-Za-z]:\\` 这种宽泛正则查泄漏路径**：client.js 里合法地含 JSON 转义的 `\n`，该正则会报出 `r:\`、`e:\` 这种假命中。改用具体标记（`<drive>:\Users|DSH|Program|AppData|<user>`、`/Users/`、`/home/`）。
26. **`STEPS = [round(0.20 + 0.01*i, 76) ...]`**：`round` 的第二个参数是小数位，写成 76 不报错但语义全错。**数值工具的步进表要看一眼。**
27. **汇总打印别用上一轮循环遗留的变量**：`s3-veil-budget.py` 的打印用了上一个 mode 遗留的 `toned`（拿亮色图的色调去验暗色），解与打印自相矛盾却不报错。**跨 mode 复用的量要存进结果对象，不要靠循环变量。**
28. **从别的项目抄选择器必须实测**：Shell 段的 8 条 `data-*` 选择器里，`[data-shell-bottom]` 在本应用**命中 0**（我从 starwake 抄来没验证）。`tools\s3-probe-shell.py` 现在**是门**：未被声明为 conditional 的死选择器会让它 exit 1。**死 CSS 在运行时是不可见的**——界面只会"看起来不对"，控制台什么都不说。
