/**
 * dsh-session-eva-status —— 浏览器半边（侧栏会话行状态着色）。
 *
 * 这份文件是宿主直接送给浏览器的「束」，不是普通 ESM：必须包在
 * window.__ModuleLoader__.load({ id, factory }) 信封里，只能 require 外壳种子里
 * 预置的模块，并导出具名的 name / inject / apply。本插件不渲染任何 React 组件，
 * 所以这里一个种子模块都不 require。
 *
 * 它不拥有任何状态：只读官方已有的事实，给每一行写一个 data 属性，再用一张
 * 注入的样式表给那个属性上色。三种左轨状态：
 *
 *   pending   有待处理的交互（批准 / 提问 / 计划评审）→ 蓝轨 + 呼吸（亮档用更深的一支）
 *   selected  当前主区域打开着的就是这一个会话        → 红轨（亮档用更红的一支）
 *   unread    跑完但没看过（completionUnread）        → 紫轨
 *
 * 置顶行再叠一层：标题文字走静态彩虹渐变（background-clip:text），行本身不画轨。
 * 彩虹分两档：暗档是冻结的原六色，亮档是按 4.5:1 压暗的六色（见 PIN_RAINBOW_*）。
 *
 * 其余一律不画，让官方自己说：
 *   运行中 / 子智能体在跑   → 官方转圈点，插件让位
 *   空闲 / 空白新会话       → 官方本来就不画点
 *   归档                    → 官方已把标题压到 caption 档，插件不再叠一层
 *
 * 用到的锚点（都在 dsh 0.2.0-rc.2 上核对过）：
 *   - 行：      [data-row-key="session:<id>"]（ui-workspace 的 Rows.tsx 渲染）
 *   - 状态：    ctx.uiSession.sessionStatus（running / pendingInteraction / completionUnread）
 *   - 选中：    ctx.sessions.list 快照里 retainedBy.mainView > 0 的那一个（官方 Rows 的 selected 同源）
 *   - 归档/置顶：ctx.workspaces.list 快照里 archivedSessionIds / pinnedSessionIds
 *   - 标题：    行内第 2 个子元素（行首格永远渲染，所以标题位次稳定，不必匹配哈希类名）
 *
 * 行自身的背景一律不动（不铺底色），所以官方的 hover 与选中反馈照旧；
 * 状态只由左轨这一条 ::before 伪元素表达。
 *
 * 左轨为什么不用 inset box-shadow：inset 阴影是「贴着边框内缘的一条带」，会跟着
 * 官方行的圆角（约 8px）一路拐弯，两端拐成朝右的大弯钩，看上去像个中括号，而不是
 * 一条直轨。::before 绝对定位在行内、不受行圆角裁剪，才是整行高、两端直角的一条轨。
 *
 * ── 主题侧补丁（EVA-Inspired-Theme）─────────────────────────────────────────
 * 这份副本已不是上游 v0.1.0 的逐字节拷贝：主题仓库对热路径打了三处补丁（见 D78）——
 *   a. schedule() 由 queueMicrotask 改为 rAF 合并：微任务只合并同一批观察记录，流式
 *      回复里每到一个 token 就是一批，一帧能落好几次对账；rAF 把上限压到每帧一次。
 *   b. 置顶属性 data-eva-pinned 改为先比后写：它被样式表选中，同值重写也会让该行样式失效。
 *   c. dispose() 补 window.cancelAnimationFrame，清掉挂起的那一帧。
 * 刷新上游仍按 D29/D77 的办法：用新版 lib/client.js 覆盖本文件，再把 a/b/c 贴回来
 * （本机已无该 checkout，无法先改上游再 vendor）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-eva-status',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** 调试/自检入口，卸载时删除。 */
    const GLOBAL_KEY = '__DSH_SESSION_EVA_STATUS__'
    /** 注入样式表的 id 与归属标记（防兄弟插件 HMR 认领后删掉）。 */
    const STYLE_ID = 'dsh-session-eva-status-style'
    const PLUGIN_ID = 'dsh-session-eva-status'
    /** 会话行锚点。 */
    const ROW_SELECTOR = '[data-row-key^="session:"]'
    const ROW_PREFIX = 'session:'
    /** 行上承载状态的属性（React 不管它，重渲染不会冲掉）。 */
    const STATE_ATTR = 'data-eva-state'
    /** 置顶行的标记属性；标题彩虹字挂在这上面，与状态轨互不干扰。 */
    const PIN_ATTR = 'data-eva-pinned'

    /**
     * 设计定稿的 EVA 调色；不跟随主题品牌色，明暗主题下都读得清。
     *
     * 两支颜色按底色分档，理由都是「同一支色撑不住两种底色」：
     *
     *   `pending` / `pendingLight` —— 蓝轨取卡 C「Newtype 封面」的两支蓝：暗档用浅蓝
     *        `#AAC7EF`（对暗底 9.94:1），亮档用板岩蓝 `#3F629C`（对亮底 5.84:1）。
     *        两支不能对调：浅蓝在亮底上只有 1.66:1，几乎看不见。
     *   `selected` / `selectedLight` —— `#FF3B30` 的 G 通道偏高（59），对浅底只有 3.39:1；
     *        亮档换成更红、更深的一支（4.62:1），暗档逐字节不动。
     */
    const DEFAULT_COLORS = {
      pending: '#AAC7EF',
      pendingLight: '#3F629C',
      selected: '#FF3B30',
      selectedLight: '#E01B24',
      unread: '#7A4FD6',
    }
    /**
     * 置顶行标题的静态彩虹。形状两档完全一致（六色标、90° 线性渐变、裁到文字上），
     * 只有色标取值按所在底色分档：
     *
     *   暗档 底纱 α 0.35，底本来压得暗，原六色照旧。
     *   亮档 底纱 α 0.70 把标题脚下的底抬到亮度 0.405–0.658（真机实测），同一组
     *        中明度色标在它上面只剩 1.15–3.63:1，黄与青几乎看不见。亮档六色因此按
     *        「每个色标对最暗背景块 ≥ 4.5:1」重新解出（最暗块 0.405 为约束）。
     *
     * 暗档自 2026-10-07 冻结（EVA 主题的 dark.1 / dark.2 门禁盯着它），
     * PIN_RAINBOW_DARK 因此逐字节保持原值，本次改动只落在亮档。
     */
    const PIN_RAINBOW_DARK = ['#E5484D', '#F76B15', '#C99700', '#2E9E5B', '#0E8AA8', '#6E56CF']
    const PIN_RAINBOW_LIGHT = ['#7A0F14', '#632A00', '#4A3900', '#0A4623', '#063B49', '#382B78']
    const DEFAULT_BREATHE_MS = 1600
    /** 左轨宽度（px）。 */
    const RAIL_WIDTH = 3
    /** 呼吸低点的不透明度（%）。 */
    const BREATHE_LOW = 35
    /**
     * 蓝轨色值的自定义属性名。两档共用同一份 @keyframes 靠它切换：关键帧里的 var()
     * 是在被动画的那个元素上求值的，所以暗档读到 `pending`、亮档读到 `pendingLight`，
     * 而动画声明与关键帧本身只有一份 —— 呼吸的周期、缓动与低点比例因此逐字不变。
     */
    const PENDING_VAR = `${PLUGIN_ID}-pending`

    /**
     * 校验并补齐配置。配置错就当场抛，不静默降级。
     * @param {unknown} input cordis.patch.yml 里 entry 的 config，或 undefined。
     * @returns {{hideOfficialDot: boolean, breatheMs: number, colors: {pending: string, pendingLight: string, selected: string, selectedLight: string, unread: string}}}
     */
    function resolveConfig(input) {
      const raw = input === undefined || input === null ? {} : input
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TypeError(`${PLUGIN_ID}: config 必须是对象`)
      }
      const colors = { ...DEFAULT_COLORS, ...(raw.colors === undefined || raw.colors === null ? {} : raw.colors) }
      for (const key of Object.keys(DEFAULT_COLORS)) {
        const value = colors[key]
        if (typeof value !== 'string' || value.trim() === '') {
          throw new TypeError(`${PLUGIN_ID}: colors.${key} 必须是非空 CSS 颜色字符串`)
        }
      }
      const breatheMs = raw.breatheMs === undefined ? DEFAULT_BREATHE_MS : raw.breatheMs
      if (typeof breatheMs !== 'number' || !Number.isFinite(breatheMs) || breatheMs < 200) {
        throw new TypeError(`${PLUGIN_ID}: breatheMs 必须是不小于 200 的数字`)
      }
      return {
        hideOfficialDot: raw.hideOfficialDot !== false,
        breatheMs,
        colors,
      }
    }

    /** 半透明版本，用于呼吸低点。 */
    const faint = (color, percent) => `color-mix(in srgb, ${color} ${percent}%, transparent)`

    /** 一条左轨的声明：绝对定位、整行高、直角收尾（含收尾的右花括号）。 */
    const railRule = (color, extra = '') => [
      'content:"";position:absolute;left:0;top:0;bottom:0;',
      `width:${RAIL_WIDTH}px;background:${color};`,
      extra,
      '}',
    ].join('')

    /**
     * 一条置顶标题的彩虹声明。`scope` 是模式限定（官方把暗色标记写在 body 上，
     * 见 dsh 的 `theme-presenter.ts` DARK_ATTRIBUTE），两档各一条、互不重叠。
     */
    const pinRule = (scope, stops) => [
      `html ${scope} ${ROW_SELECTOR}[${PIN_ATTR}="true"]>:nth-child(2){`,
      `background-image:linear-gradient(90deg,${stops.join(',')});`,
      '-webkit-background-clip:text;background-clip:text;',
      'color:transparent;-webkit-text-fill-color:transparent}',
    ].join('')

    /**
     * 生成整张样式表。所有选择器都带 html 前缀：官方 hover/选中的
     * `background` 简写与本表同权重，靠更高权重与后注入取胜。
     * @param {ReturnType<typeof resolveConfig>} config
     * @returns {string}
     */
    function buildCss(config) {
      const { pending, pendingLight, selected, selectedLight, unread } = config.colors
      const pendingRef = `var(--${PENDING_VAR})`
      const pendingLow = faint(pendingRef, BREATHE_LOW)
      const lines = [
        // 行本身要当定位上下文，伪元素轨才挂得住。
        `html ${ROW_SELECTOR}[${STATE_ATTR}="pending"],`,
        `html ${ROW_SELECTOR}[${STATE_ATTR}="selected"],`,
        `html ${ROW_SELECTOR}[${STATE_ATTR}="unread"]{position:relative}`,
        // 左轨：整行高的一条，两端直角。呼吸只属于「要你动手」的那一档。
        // 蓝轨色值走自定义属性（见 PENDING_VAR），好让两档共用同一份 @keyframes。
        `html ${ROW_SELECTOR}[${STATE_ATTR}="pending"]::before{`,
        `--${PENDING_VAR}:${pending};`,
        railRule(pendingRef, `animation:${PLUGIN_ID}-breathe ${config.breatheMs}ms ease-in-out infinite`),
        // 亮档蓝轨覆盖：只改那一个自定义属性，形状、位置、层级、动画一概不碰。多一层
        // body:not([data-ds-dark-theme]) 提高特异性，暗色下整条不成立，暗档因此逐字节不变。
        `html body:not([data-ds-dark-theme]) ${ROW_SELECTOR}[${STATE_ATTR}="pending"]::before{--${PENDING_VAR}:${pendingLight}}`,
        `html ${ROW_SELECTOR}[${STATE_ATTR}="selected"]::before{`,
        railRule(selected),
        // 亮档红轨覆盖：只换颜色。多一层 body:not([data-ds-dark-theme]) 提高特异性，
        // 暗色下整条不成立，暗档的 selected 因此逐字节不变。形状、位置、层级、
        // 动画一概不碰——选中轨本来就没有动画。
        `html body:not([data-ds-dark-theme]) ${ROW_SELECTOR}[${STATE_ATTR}="selected"]::before{background:${selectedLight}}`,
        `html ${ROW_SELECTOR}[${STATE_ATTR}="unread"]::before{`,
        railRule(unread),
        // 置顶行：标题（行内第 2 个子元素）走静态彩虹渐变，行自身背景仍然不动。
        // 两档各一条：暗档用冻结原值，亮档用按 4.5:1 压暗的六色。
        pinRule('body[data-ds-dark-theme]', PIN_RAINBOW_DARK),
        pinRule('body:not([data-ds-dark-theme])', PIN_RAINBOW_LIGHT),
      ]
      if (config.hideOfficialDot) {
        // 这两行的行首 16px 格里只有官方状态点：leading 席只在 primary status 为
        // idle 时渲染，archived 行整格留空。所以隐藏整格内容等于只隐藏状态点。
        lines.push(
          `html ${ROW_SELECTOR}[${STATE_ATTR}="pending"]>:first-child,`,
          `html ${ROW_SELECTOR}[${STATE_ATTR}="unread"]>:first-child{visibility:hidden}`,
        )
      }
      lines.push(
        `@keyframes ${PLUGIN_ID}-breathe{`,
        `0%,100%{background:${pendingRef}}`,
        `50%{background:${pendingLow}}}`,
        `@media (prefers-reduced-motion: reduce){`,
        `html ${ROW_SELECTOR}[${STATE_ATTR}="pending"]::before{animation:none}}`,
      )
      return lines.join('')
    }

    /** 注入样式表；已存在就补归属标记（热替换后自愈）。 */
    function ensureStyle(config) {
      let tag = document.getElementById(STYLE_ID)
      if (tag === null) {
        tag = document.createElement('style')
        tag.id = STYLE_ID
        document.head.appendChild(tag)
      }
      tag.textContent = buildCss(config)
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/styles`
      return tag
    }

    /**
     * 取一个必需服务；缺失即报错，不静默跳过。
     * @param {object} ctx 插件上下文
     * @param {string} key 服务名
     */
    function requireService(ctx, key) {
      const service = ctx.get(key)
      if (service === undefined || service === null) {
        throw new Error(`${PLUGIN_ID}: 缺少服务 ${key}`)
      }
      return service
    }

    /**
     * 取一个必需的可观察源；缺失即报错。
     * @param {unknown} source 候选源
     * @param {string} label 报错里用的名字
     */
    function requireObservable(source, label) {
      if (source === undefined || source === null
        || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') {
        throw new Error(`${PLUGIN_ID}: ${label} 不是可观察源`)
      }
      return source
    }

    const name = PLUGIN_ID
    const inject = ['uiSession', 'sessions', 'workspaces']

    /**
     * 给侧栏会话行按官方状态打标记。
     * @param {object} ctx 插件上下文（已声明 uiSession / workspaces）
     * @param {unknown} rawConfig entry 的 config
     */
    function apply(ctx, rawConfig) {
      const config = resolveConfig(rawConfig)
      const status = requireObservable(
        requireService(ctx, 'uiSession').sessionStatus, 'uiSession.sessionStatus')
      const workspaceList = requireObservable(requireService(ctx, 'workspaces').list, 'workspaces.list')
      const sessionList = requireObservable(requireService(ctx, 'sessions').list, 'sessions.list')

      ensureStyle(config)

      /**
       * 一个会话当前该有的标记；null 表示这一行不画东西。
       * 优先级：等人 > 选中 > 子智能体让位 > 完成未读。归档行官方不画状态点，这里也不画。
       * @param {string} id 会话 id
       * @param {Map<string, {pendingInteraction?: unknown, completionUnread?: boolean, running?: boolean}>} statuses 官方状态快照
       * @param {object} list sessions.list 快照（取子智能体目录）
       * @param {ReadonlySet<string>} archived 归档集合
       * @param {ReadonlySet<string>} selected 当前主区域打开着的会话集合
       * @returns {'pending' | 'selected' | 'unread' | null}
       */
      function stateOf(id, statuses, list, archived, selected) {
        if (archived.has(id)) return null
        const entry = statuses.get(id)
        if (entry === undefined) return null
        if (entry.pendingInteraction !== undefined) return 'pending'
        if (selected.has(id)) return 'selected'
        if (hasRunningSubagent(id, list, statuses)) return null
        if (entry.completionUnread === true) return 'unread'
        return null
      }

      /**
       * 这个会话有没有仍在跑的子智能体。算法与官方 runningChildCount 一致
       * （ui-workspace/src/client/tree.ts:390-395）：数子智能体目录里 running 为真的。
       * 官方此时把主状态判为 ongoing（转圈），插件必须让位，否则会把「还在跑」说成「跑完未读」。
       * @param {string} id 会话 id
       * @param {object} list sessions.list 快照
       * @param {Map<string, {running?: boolean}>} statuses 官方状态快照
       * @returns {boolean}
       */
      function hasRunningSubagent(id, list, statuses) {
        const children = list?.projectionsBySession?.[id]?.values?.subagentCatalog
        if (!Array.isArray(children)) return false
        return children.some((child) => {
          const entry = statuses.get(child.id)
          const running = entry === undefined ? undefined : entry.running
          return (running ?? list?.byId?.[child.id]?.running) === true
        })
      }

      /**
       * 当前主区域打开着的会话。官方行的 selected 就是这个来源
       * （WorkspaceBrowser.tsx:661-663：取 retainedBy.mainView > 0 的那一条），
       * 所以这里读同一份事实，不去匹配官方哈希类名。
       * @param {object} list sessions.list 快照
       * @returns {Set<string>}
       */
      function mainViewIds(list) {
        const ids = new Set()
        for (const [id, session] of Object.entries(list?.byId ?? {})) {
          if ((session?.retainedBy?.mainView ?? 0) > 0) ids.add(id)
        }
        return ids
      }

      /** 全量对账一次：读官方快照，逐行写/清 data 属性。 */
      function sync() {
        const rows = document.querySelectorAll(ROW_SELECTOR)
        if (rows.length === 0) return
        const statuses = status.getSnapshot()
        const list = sessionList.getSnapshot()
        const workspace = workspaceList.getSnapshot()
        const archived = new Set(workspace.archivedSessionIds)
        const pinned = new Set(workspace.pinnedSessionIds)
        const selected = mainViewIds(list)
        for (const row of rows) {
          const key = row.getAttribute('data-row-key')
          if (typeof key !== 'string' || !key.startsWith(ROW_PREFIX)) continue
          const id = key.slice(ROW_PREFIX.length)
          const next = stateOf(id, statuses, list, archived, selected)
          if (next === null) {
            if (row.hasAttribute(STATE_ATTR)) row.removeAttribute(STATE_ATTR)
          } else if (row.getAttribute(STATE_ATTR) !== next) {
            row.setAttribute(STATE_ATTR, next)
          }
          // 置顶标记与状态轨正交：归档行不画，其余置顶行上彩虹标题。
          // PIN_ATTR 被样式表选中，同值重写也会让这一行样式失效，所以先比后写。
          if (pinned.has(id) && !archived.has(id)) {
            if (row.getAttribute(PIN_ATTR) !== 'true') row.setAttribute(PIN_ATTR, 'true')
          } else if (row.hasAttribute(PIN_ATTR)) {
            row.removeAttribute(PIN_ATTR)
          }
        }
      }

      let scheduled = false
      let frame = 0
      /** 把同一帧里的多次触发合并成一次对账。 */
      function schedule() {
        if (scheduled) return
        scheduled = true
        /* 微任务只合并同一批观察记录；流式回复里每到一个 token 就是一批，一帧可以落下
           好几次对账，而每次对账都要写行属性（可能触发样式失效）。rAF 把上限压到
           每帧一次，正好在渲染之前。 */
        frame = window.requestAnimationFrame(() => {
          scheduled = false
          frame = 0
          sync()
        })
      }

      const offs = [
        status.subscribe(schedule),
        sessionList.subscribe(schedule),
        workspaceList.subscribe(schedule),
      ]
      const observer = new MutationObserver(schedule)
      // 只盯行键：React 重渲染整段重写 class，但 data-row-key 只在换行时变。
      observer.observe(document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['data-row-key'],
      })
      sync()

      /** 卸载即净：订阅、观察器、行属性、样式表、调试入口一起清掉。 */
      function dispose() {
        if (frame !== 0) {
          window.cancelAnimationFrame(frame)
          frame = 0
        }
        scheduled = false
        for (const off of offs.splice(0)) {
          try {
            off()
          } catch { /* 已注销 */ }
        }
        try {
          observer.disconnect()
        } catch { /* 已断开 */ }
        for (const row of document.querySelectorAll(ROW_SELECTOR)) {
          row.removeAttribute(STATE_ATTR)
          row.removeAttribute(PIN_ATTR)
        }
        const tag = document.getElementById(STYLE_ID)
        if (tag !== null) tag.remove()
        if (window[GLOBAL_KEY] === api) delete window[GLOBAL_KEY]
      }

      const api = { sync, stateOf, dispose, config }
      window[GLOBAL_KEY] = api
      ctx.effect(() => dispose, `${PLUGIN_ID}: dispose`)
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
