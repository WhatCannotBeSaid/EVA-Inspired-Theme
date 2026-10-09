
    /* --------------------------------------------------------- boot screen
     * 「闸门开启」启动遮罩：两层挡板盖住首屏，左侧进度按墙钟推进，结束后
     * 挡板左右分开、整块淡出并自删。默认开启，localStorage 写 '0' 关闭，
     * URL 加 ?boot=0 只跳过一次；**同一份构建只播一次**（播过就记标记，
     * 之后每次启动、每次加载都不再播）。
     *
     * 这里刻意不读 Host 设置：唯一开关是浏览器本地值，任何时刻都读得到，
     * 因此没有「apply() 首帧读到的只是 schema 默认值」那个竞态。
     * 想改成 Host 设置时，见 README 的「加设置开关」一节。
     *
     * 五条硬约束（照抄 dsh-theme-endfield 的实测教训，别省）：
     *   1. 进度按已过墙钟时间算，不逐帧累加，帧率再抖也不漂移；
     *   2. rAF 与 setInterval 双时钟驱动同一个幂等 step()，标签页被挂起时
     *      不会有一块全屏挡板永远盖着应用；
     *   3. fuse（强制收尾）+ hard kill（无条件删节点）两级兜底；
     *   4. 收尾动画由 JS 逐帧写，不用 CSS transition——有的渲染器不跑它；
     *   5. destroyBoot 幂等，且是 ctx.effect 的 disposer，主题一关挡板就撤。
     *
     * 2026-10-09 性能（本轮只动写入方式，动画时序与外观一字不改）：
     *   挡板是一块 position:fixed 的全屏层，原先每帧写三笔都是最贵的那一类——
     *   进度写进 width（每帧一次布局，还会往文档根上冒）、六边形呼吸写在
     *   遮罩根节点上（每帧把整棵子树标记成样式失效）。现在：进度只驱动
     *   rail::after 的 scaleX（样式表里加了 contain: layout paint 与
     *   will-change: transform），呼吸写在自己的节点上，且逐帧值先比再写。
     *   双时钟与 fuse / hard kill 两级兜底都原样保留。
     * ---------------------------------------------------------------- */
    var BOOT_KEY = PLUGIN_ID + '/boot'
    /* 「这份构建已播过」的标记落点：同一构建只播一次靠它。 */
    var BOOT_SEEN_KEY = BOOT_KEY + '/seen'
    /* 换一次构建想重播一次，就改这个标记（它同时挡住 HMR 换包时的二次播放）。 */
    var BOOT_MARK = 'eva-boot/2026-10-06-a'
    var BOOT_MS = 1600
    var BOOT_SLIDE_MS = 620
    var BOOT_FADE_MS = 320
    var BOOT_HOLD_MS = 200
    /* 挡板全遮多久：**1600 + 200 = 1800 ms，这是默认值**（2026-10-07 恢复）。
       历史：2026-10-07 早先为对齐「启动音效第一声」把它抬到 1750 + 520 = 2270 ms
       —— 那条注释原话是「按『启动音效第一声』定，不按观感定」。同日用户先要求去掉
       启动音效（音效那一侧已整条删除：宿主回环路由与 sounds/startup.wav 都不在了），
       随后要求「把遮罩长度改回默认」，于是回到 1600 + 200。
       现在这四个数都是纯观感值，不再挂靠任何东西。想再往 endfield 靠（那边全遮
       2490 ms）就把 BOOT_HOLD_MS 改成 890。 */
    var bootEl = null
    var bootRaf = null
    var bootTick = null
    var bootFuse = null
    var bootKill = null
    var bootExit = null
    var bootDone = false

    function bootEnabled() {
      if (typeof window === 'undefined') return false
      /* 同一份构建在一张页面里只播一次：HMR 换包、重复 apply 都拦在这里。 */
      if (window.__evaBootMark === BOOT_MARK) return false
      try {
        if (typeof location !== 'undefined' && String(location.search).indexOf('boot=0') >= 0) return false
      } catch (e) { /* 读不到就当没写 */ }
      try {
        if (window.localStorage && window.localStorage.getItem(BOOT_KEY) === '0') return false
      } catch (e) { /* 隐私模式读不到：照常播 */ }
      /* 这份构建已经播过一次：跨页面、跨重启都不再播。 */
      try {
        if (window.localStorage && window.localStorage.getItem(BOOT_SEEN_KEY) === BOOT_MARK) return false
      } catch (e) { /* 读不到：按没播过处理 */ }
      return true
    }

    /* 主题的样式表在不在。挡板的排版全在那张表里，表没了就只剩裸文本。
       顺带把「主题已卸载但 DOMContentLoaded 还没到」这种情况挡在外面。 */
    function bootSheetPresent() {
      if (typeof document === 'undefined' || !document.querySelector) return false
      return document.querySelector('style[data-plugin-css="' + PLUGIN_ID + '/theme.css"]') !== null
    }

    function bootReduceMotion() {
      try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch (e) { return false }
    }

    function bootClearTimers() {
      if (bootRaf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(bootRaf)
      bootRaf = null
      if (bootTick !== null && typeof clearInterval === 'function') clearInterval(bootTick)
      bootTick = null
      if (bootFuse !== null && typeof clearTimeout === 'function') clearTimeout(bootFuse)
      bootFuse = null
      if (bootExit !== null && typeof clearTimeout === 'function') clearTimeout(bootExit)
      bootExit = null
    }

    /* 幂等：重复调用只是把已经不在的东西再删一次。 */
    function destroyBoot() {
      bootClearTimers()
      if (bootKill !== null && typeof clearTimeout === 'function') clearTimeout(bootKill)
      bootKill = null
      if (bootEl !== null && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl)
      bootEl = null
    }

    /* 返回 disposer：apply() 里那条标着 'evangelion: boot screen' 的注册直接收下它，
       所以主题一关，挡板就随样式表一起撤。
       所有文案都写在 CSS 的 content 里，DOM 上一个可翻译的字都没有。 */
    function mountBootScreen() {
      if (bootDone || bootEl !== null || typeof document === 'undefined') return destroyBoot
      if (!bootEnabled()) return destroyBoot
      /* 挡板是 body 的孩子：bundle 早于 body 求值时，改到 DOMContentLoaded 再试，
         bootDone 保持 false，所以那一次重试就是真正的首播。 */
      if (!document.body || !bootSheetPresent()) {
        if (typeof document.addEventListener === 'function') {
          document.addEventListener('DOMContentLoaded', function () {
            if (!bootSheetPresent()) return
            mountBootScreen()
          }, { once: true })
        }
        return destroyBoot
      }
      if (bootReduceMotion()) return destroyBoot
      bootDone = true
      if (typeof window !== 'undefined') window.__evaBootMark = BOOT_MARK
      /* 在开播处就记下「已播」：中途关窗也算播过，下次启动不再播第二次。 */
      try {
        if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(BOOT_SEEN_KEY, BOOT_MARK)
      } catch (e) { /* 写不进去：退化成同页只播一次 */ }

      var el = document.createElement('div')
      el.setAttribute('data-eva-boot', '')
      el.setAttribute('translate', 'no')
      el.setAttribute('aria-hidden', 'true')
      el.className = 'notranslate'
      el.innerHTML = '' +
        '<div class="eva-boot-tex"></div>' +
        '<div class="eva-boot-panel eva-boot-panel-l"></div>' +
        '<div class="eva-boot-panel eva-boot-panel-r"></div>' +
        '<div class="eva-boot-body">' +
        '<span class="eva-boot-tag"></span>' +
        '<span class="eva-boot-mark">' +
        '<span class="eva-boot-word"></span>' +
        '<span class="eva-boot-sub"></span>' +
        '</span>' +
        '<span class="eva-boot-hex"></span>' +
        '<span class="eva-boot-rail">' +
        '<span class="eva-boot-pct"></span>' +
        '<span class="eva-boot-state"></span>' +
        '</span>' +
        '</div>'
      document.body.appendChild(el)
      bootEl = el

      var left = el.querySelector('.eva-boot-panel-l')
      var right = el.querySelector('.eva-boot-panel-r')
      var body = el.querySelector('.eva-boot-body')
      var rail = el.querySelector('.eva-boot-rail')
      var hex = el.querySelector('.eva-boot-hex')
      var pct = el.querySelector('.eva-boot-pct')
      var state = el.querySelector('.eva-boot-state')
      var now = function () {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now() : Date.now()
      }
      var start = now()
      var finished = false
      /* 2026-10-09 性能：逐帧写入的值先缓存，值没变就一个字节都不动 DOM。 */
      var railFill = null
      var hexOp = null
      var leftShift = null
      var rightShift = null
      var wordOp = null
      var exitOp = null

      /* 收尾：挡板左右分开 → 整块淡出 → 删节点。三段都由 JS 按墙钟推进，
         时间和进度用同一个 now()，两段之间不会因为 transition 没跑而卡住。 */
      var finish = function () {
        if (finished) return
        finished = true
        bootClearTimers()
        if (bootEl === null) return
        el.setAttribute('data-eva-boot-open', '')
        var exitAt = now()
        var slide = function () {
          if (bootEl === null) return
          var elapsed = now() - exitAt
          var st = Math.min(1, elapsed / BOOT_SLIDE_MS)
          var eased = 1 - Math.pow(1 - st, 3)
          var shift = (-100 * eased).toFixed(2) + '%'
          var back = (100 * eased).toFixed(2) + '%'
          if (left && leftShift !== shift) { leftShift = shift; left.style.transform = 'translateX(' + shift + ')' }
          if (right && rightShift !== back) { rightShift = back; right.style.transform = 'translateX(' + back + ')' }
          /* 文字在挡板分开的同时先走一步，否则它会孤零零地飘在应用上。 */
          var word = Math.max(0, 1 - elapsed / 240).toFixed(3)
          if (body && wordOp !== word) { wordOp = word; body.style.opacity = word }
          var fadeMs = elapsed - BOOT_SLIDE_MS
          if (fadeMs > 0) {
            var exitValue = Math.max(0, 1 - fadeMs / BOOT_FADE_MS).toFixed(3)
            if (exitOp !== exitValue) { exitOp = exitValue; el.style.opacity = exitValue }
          }
          if (elapsed >= BOOT_SLIDE_MS + BOOT_FADE_MS) { destroyBoot(); return }
          bootRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(slide) : null
        }
        slide()
        if (typeof setInterval === 'function') bootTick = setInterval(slide, 30)
        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
          bootExit = window.setTimeout(destroyBoot, BOOT_SLIDE_MS + BOOT_FADE_MS + 300)
        }
      }

      /* 进度：值只由「已过墙钟时间」决定，所以两个时钟谁先跑都只是把当前值画一遍。 */
      var step = function () {
        if (finished || bootEl === null) return
        var ms = now() - start
        var t = Math.min(1, ms / BOOT_MS)
        var eased = 1 - Math.pow(1 - t, 3)
        var value = Math.round(eased * 100)
        /* 2026-10-09 性能：进度是「已过墙钟」的函数，双时钟下同一次渲染窗口里
           可能被算两遍；下面每一笔都先比再写，顺带把「改宽」换成「缩放」——
           样式表那条 rail::after 现在读的是无单位的缩放比，不再是百分比宽度。 */
        if (rail) {
          var fill = eased.toFixed(4)
          if (railFill !== fill) {
            railFill = fill
            rail.style.setProperty('--eva-boot-progress', fill)
          }
        }
        /* 六边形的呼吸：这家主题的 paint layer 不许出现 @keyframes（选择器检查会把紧跟
           规则之后的 @ 块当成非契约选择器），所以同一条墙钟顺手把它算出来。
           2026-10-09 性能：这笔写在自己的节点上 —— 以前写在遮罩根节点上，等于每帧
           把整棵挡板子树标记成样式失效。 */
        if (hex) {
          var op = (0.45 + 0.55 * Math.abs(Math.sin(ms / 420))).toFixed(3)
          if (hexOp !== op) {
            hexOp = op
            hex.style.setProperty('--eva-boot-hex-op', op)
          }
        }
        var shown = value + '%'
        if (pct && pct.textContent !== shown) pct.textContent = shown
        var label = value < 45 ? 'SYNC' : (value < 99 ? 'GATE' : 'OPEN')
        if (state && state.textContent !== label) state.textContent = label
        if (t >= 1) {
          el.setAttribute('data-eva-boot-full', '')
          /* 满格停一拍，让 100% 真的被看清。 */
          if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
            if (bootExit === null) bootExit = window.setTimeout(finish, BOOT_HOLD_MS)
          } else finish()
          return
        }
        bootRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(step) : null
      }
      step()
      if (typeof setInterval === 'function') bootTick = setInterval(step, 60)
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        bootFuse = window.setTimeout(function () { finished = false; finish() }, BOOT_MS + 1400)
        bootKill = window.setTimeout(destroyBoot, BOOT_MS + 1400 + BOOT_SLIDE_MS + BOOT_FADE_MS + 300)
      } else if (bootRaf === null && bootTick === null) {
        destroyBoot()
      }
      return destroyBoot
    }
