/* The theme's own client glue: apply(), the mount order, and the exports map.
 *
 * tools/build-client.mjs interpolates this file VERBATIM into the generated
 * client.js, next to src/boot-screen.js (which defines mountBootScreen) and the two
 * vendored plugins (applyPluginToggle, applySessionEvaStatus). It closes over six
 * values the builder defines above it in the same factory: PLUGIN_ID, TOKENS, MANIFEST,
 * WALLPAPER_DECLARATIONS, CSS and BOOT_CSS. Nothing here is re-parsed by the
 * builder, so the code below is exactly the code that runs — which is the whole
 * point of keeping it in a file instead of in a template string.
 *
 * It stays free of backticks and template placeholders by the same house rule
 * src/boot-screen.js follows: not because verbatim interpolation would break, but
 * because a file that reads as itself is one that can be reviewed, grepped and
 * diffed. A literal backslash is fine here and only here — the paint layer needs one
 * to join three sheets into a single tag — since nothing escapes this text on the
 * way in.
 */

    /* The two wallpaper bitmaps ship as base64 data URLs inside the generated
       --cp-wall-<id> declarations, about 441 KB and 281 KB of text. A data URL in a
       custom property is not free the way a data URL in a paint rule is: every element
       that inherits the property carries the whole string in its computed value, so a
       full style recalculation has to build and compare those strings across the
       document. Measured on this machine, the two wallpapers alone were ~8.6 ms of a
       ~15 ms full-document recalculation -- ~56% of the theme's recalculation cost --
       while the identical bytes painted from a rule cost nothing measurable.

       So the bytes move out of the stylesheet and into blob URLs at apply time: the
       sheet that reaches the parser is the short value, and the pixels are still
       exactly the shipped ones. The names and the shape of the chain stay untouched
       (--cp-wall-<id>, --cp-pick-light/dark, and the documented no-wallpaper knob that
       sets --cp-pick-* to none) -- only the value is shortened. Any failure falls back
       to the data URL verbatim, so this cannot break the theme: worst case it is
       exactly what it was before. */
    function shortenDataUrls(text, created) {
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' ||
          typeof URL.createObjectURL !== 'function' || typeof atob !== 'function') return text
      return text.replace(/url\("(data:[^"]+)"\)/g, function (whole, dataUrl) {
        try {
          var comma = dataUrl.indexOf(',')
          if (comma < 0) return whole
          var meta = dataUrl.slice(5, comma)
          var body = dataUrl.slice(comma + 1)
          /* Base64 is the only shape the theme ships, and the byte loop below is the whole
             cost of this pass. The platform decoder returns the same bytes measurably
             faster (11.0ms -> 8.0ms on this theme's payload, measured in Chromium), so use
             it when it exists and keep the loop as the fallback for builds that lack it.
             Both paths throw on malformed input, and any failure still falls through to
             the catch that returns the data URL verbatim. */
          var isBase64 = meta.indexOf('base64') >= 0
          var bytes
          if (isBase64 && typeof Uint8Array.fromBase64 === 'function') {
            bytes = Uint8Array.fromBase64(body)
          } else {
            var binary = isBase64 ? atob(body) : decodeURIComponent(body)
            bytes = new Uint8Array(binary.length)
            for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
          }
          var blobUrl = URL.createObjectURL(new Blob([bytes], { type: meta.split(';')[0] }))
          if (created) created.push(blobUrl)
          return 'url("' + blobUrl + '")'
        } catch (err) {
          return whole
        }
      })
    }

    /* 2026-10-12 性能：非关键功能延迟到浏览器空闲时执行。品牌行点击拦截、工作区
       置顶这两个功能在主题激活时不关键（主题的视觉在令牌层、液态玻璃、样式挂载
       与启动遮罩就绪后即完整），同步执行会阻塞插件加载。延迟到
       requestIdleCallback 后，关键路径缩短约 30-50ms（实测：这两个 effect 的
       初始化合计 42ms），用户感知是主题立即可用，这两个功能在 50-100ms 内跟上。

       2026-10-16 修复：requestIdleCallback 不能是唯一的出口。规范上，不带 timeout
       选项的调用可以在页面「永远不空闲」时永不执行 —— 桌面渲染器里实测就是这样：
       注册三个空闲任务后 30 秒内一次回调都没有（同一页面里 setTimeout 照常触发，
       所以不是定时器被冻结）。于是所有走 defer 的 effect —— 品牌行、工作区置顶、
       微信会话开关 —— 在桌面窗口里静默地永不执行，而浏览器标签页里一切正常：
       用户的微信按钮就是这样消失的。
       现在两件事同时做：给空闲回调带上 { timeout }（规范承诺的最迟执行时间），
       并另挂一个定时器兜底（不依赖宿主是否真的会空闲，也覆盖没有 rIC 的宿主）。
       谁先到谁执行，先到的那个取消另一个。有闲时仍然空闲回调优先，浏览器标签页
       行为不变；没有闲时也一定在 DEFER_FALLBACK_MS 内执行。 */
    var DEFER_FALLBACK_MS = 200

    function defer(fn) {
      var settled = false
      var idleHandle = null
      var timerHandle = null

      function run() {
        if (settled) return
        settled = true
        if (idleHandle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle)
        if (timerHandle !== null) clearTimeout(timerHandle)
        fn()
      }

      if (typeof requestIdleCallback === 'function') {
        idleHandle = requestIdleCallback(function () { run() }, { timeout: DEFER_FALLBACK_MS })
      }
      /* 兜底：不依赖宿主是否真的会空闲。两者同时挂上，run() 里的 settled 保证只执行一次。 */
      timerHandle = setTimeout(function () { run() }, DEFER_FALLBACK_MS)

      return { idle: idleHandle, timer: timerHandle }
    }

    function cancelDefer(handle) {
      if (handle === null || handle === undefined) return
      if (handle.idle !== null && handle.idle !== undefined && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(handle.idle)
      }
      if (handle.timer !== null && handle.timer !== undefined) clearTimeout(handle.timer)
    }

    /* 包装一个 effect，使其延迟到浏览器空闲时执行。返回的 disposer 会在插件卸载时
       取消待执行的延迟任务，并调用已执行功能的 disposer。 */
    function deferEffect(fn) {
      var disposed = false
      var disposer = null

      function run() {
        if (disposed) return
        disposer = fn()
      }

      var handle = defer(run)

      return function () {
        disposed = true
        cancelDefer(handle)
        if (typeof disposer === 'function') disposer()
      }
    }

    /* ------------------------------------------------------------------------
       Round 50 (2026-10-14) -- the composer's model seat becomes two controls.

       The official composer hands the merged control to one seat: a single button
       reading "DeepSeek V4.1 Flash · 高" whose panel also carries the reasoning
       levels. The user asked for the reference layout instead: TWO buttons, each
       with its own panel -- the model on the left, the reasoning level on the
       right -- so the two choices stop sharing one surface.

       Nothing official is edited. "conversation.input.model" is a "single" slot,
       and a single slot is claimed per PRIORITY: register() refuses a second
       occupant at the same priority, and the renderer takes the lowest priority
       that is still live. The official registers at 0, so this one registers at
       -1 and shadows it. Turning the theme off disposes the registration and the
       official control returns unchanged -- the same removable-layer rule the
       token layer and the paint layer follow.

       Why a React component instead of the DOM-level bridges the brand row and
       the workspace pins use: those drive elements the official UI already
       rendered, and this seat has to be the component that renders. The two
       pickers keep their own vanilla-DOM implementations (src/model-effort-
       picker.js, ported verbatim from the standalone build); the component is a
       thin mount -- one container, one createPair, one destroy -- so the
       behaviour is unchanged from the version that was self-tested on its own.

       The inject face is the official one, name for name: "directory" is the
       session's model store, "load" refreshes the catalog on open, and "select"
       is the single verb both panels end up calling. "available" is false for an
       addressed subagent session, where the host refuses model selection; that
       case renders nothing at all, exactly as the official control does.
       ------------------------------------------------------------------------ */

    function EvaModelSeat(props) {
      /* Two components, not one, for a hooks reason: a component that returns before
         some of its hooks changes the hook count between renders, which React rejects.
         The outer one decides whether the seat exists at all; every hook lives in the
         inner one, where none is ever skipped. */
      var react = null
      try { react = require('react') } catch (err) { react = null }
      if (react === null) return null
      if (props.available === false) return null
      return react.createElement(EvaModelSeatHost, props)
    }

    function EvaModelSeatHost(props) {
      var react = require('react')
      var hostRef = react.useRef(null)
      var pairRef = react.useRef(null)

      /* Mount once per directory. "directory" is the session's store, so a session
         switch remounts the two controls; a re-render inside one session does not. */
      react.useEffect(function () {
        var node = hostRef.current
        if (!node) return undefined
        var made = EvaModelEffortPicker.createPair({
          directory: props.directory,
          load: props.load,
          select: props.select,
          disabled: props.locked === true
        })
        node.appendChild(made.model.el)
        node.appendChild(made.effort.el)
        pairRef.current = made
        /* Both triggers are in the document now, so the row has a width to fit
           the model name into. Doing this before the append would measure a
           detached node and fit against zero. */
        if (typeof made.watch === 'function') made.watch()
        return function () {
          pairRef.current = null
          made.destroy()
        }
      }, [props.directory])

      /* "locked" is a render-time fact (a running turn locks the composer) and it
         changes without the session changing, so it is applied on every render rather
         than folded into the mount above -- which is why the pair is held in a ref. */
      react.useEffect(function () {
        var made = pairRef.current
        if (!made) return
        made.model.setDisabled(props.locked === true)
        made.effort.setDisabled(props.locked === true)
      })

      return react.createElement('div', {
        'data-eva-mep-seat': '',
        className: 'eva-mep-seat',
        ref: hostRef
      })
    }

    /* The seat's registration.

       The dependency list is the official plugin's own -- its exports.inject names
       ["commandUi","locale","sessions","slots","remote","remote.session"], and the five
       this seat actually reaches for are the five named here. That list is not
       decoration: a cordis scope is *traced*, so reading a service the context was not
       injected with throws "cannot get property X without inject" AT CALL TIME, and
       that throw lands inside the slot's render, where the error boundary treats it as
       an abdication -- the entry is silently retired and the official control shows
       through again with nothing in the console a user would see. Measured on a live
       instance, exactly that: a list without "remote.session" rendered the official
       button and looked for all the world like the theme had done nothing at all.

       "sessions" is read off the injected scope at injection time rather than listed as
       a separate wait, because that is what the shipped control does and the two must
       stay symmetric. */
    function mountModelSeat(ctx) {
      ctx.inject(['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'], function (scope) {
        var models = scope.modelDirectories
        scope.slots.inject('conversation.input.model', function () {
          return scope.slots.register({
            name: 'conversation.input.model',
            priority: -1,
            inject: function (sessionId) {
              var directory = models.directoryFor(sessionId)
              var sessions = scope.sessions
              var available = sessions === undefined ||
                sessions.subagentAddress(sessionId) === undefined
              return {
                available: available,
                directory: directory.store,
                load: function () {
                  if (available) directory.load().catch(function () {})
                },
                select: function (selection) {
                  return available ? directory.select(selection) : Promise.resolve(undefined)
                }
              }
            }
          }, EvaModelSeat)
        })
      })
    }

    function apply(ctx) {
      var theme = ctx.get('theme')
      if (theme === undefined) return

      /* The whole theme is one token override plus one stylesheet -- nothing else.
         There is no settings panel any more: it was removed on 2026-10-06 at the
         user's request (「去掉设置里的「EVA主题」选项，不需要手动选择了」), so the
         look is fixed rather than a preference, and nothing is read from browser
         storage. The shipped map is applied as-is. */
      ctx.effect(() => {
        var dispose = theme.overrideTokens(PLUGIN_ID, TOKENS)
        return () => { if (typeof dispose === 'function') dispose() }
      }, 'evangelion: token layer')

      /* ---- Selected-title rainbow: no client code here (round 20, 2026-10-07)
         The marquee that used to live at this spot is gone. Its replacement is a
         static rainbow, and a static colour needs neither a driver nor a marker:
         src/theme.css paints it from a structural selector on the selected row's
         own title span, so the shape lives in one place only.

         Everything the marquee had to own has no counterpart here, which is the
         point of the swap: no per-frame loop, no width measurement, no remembered
         title, and no MutationObserver keeping that memory in step with the app --
         so there is also no attribute to retract on unload. Right-to-left, hidden
         tabs, the auto-title plugin rewriting a title mid-flight: all of it used to
         need a branch here and now needs none. reduced motion is not consulted for
         the title either, because a colour is not motion (the row's own 140ms hover
         fade still is, and that is what the matchMedia below still serves). */

      /* ---- Liquid glass: the refraction maps (2026-10-07)
         「为左侧边栏添加液态玻璃效果」「为输入框添加液态玻璃效果」.

         Liquid glass is not more blur. A blur throws the backdrop away; the glass in
         the reference implementations bends it, which is why the wallpaper becomes
         legible through the surface again while the type on top stays readable. The
         bend is one SVG filter per surface: an RG map (R = horizontal offset, G =
         vertical, 128 = leave the pixel alone) fed to feDisplacementMap, where the
         map is bright near an edge and neutral in the middle.

         Why the maps are built here and not written into the sheet: the map's bevel is
         a distance, and feImage stretches whatever it is given across the filter
         region. One fixed map would therefore scale its own bevel with the element —
         the composer is 877x114, so a square map would make its horizontal bevel seven
         times thicker than the vertical one. Measuring the box and drawing the map for
         it is the only way to keep the bevel constant in px, which is also what makes
         a resize re-draw rather than re-stretch.

         The map is drawn at the size of the filter REGION, not of the element, and the
         feImage is left with no placement of its own. Both details are load-bearing and
         both were measured: an feImage carrying its own x/y/width/height is sampled as
         something else entirely (the rim then reads a constant, which shifts the whole
         backdrop by half the scale instead of bending it near the edge), while one that
         simply fills its region lands one map pixel per region pixel. The region in turn
         has to reach past the border box, because the samples the rim pulls in have to
         exist as backdrop pixels; with the region equal to the box the rim can only
         sample what is inside it and the edge goes flat.

         The sheet names this filter (url(#eva-lg-input)) and carries a blur-only
         fallback line before it; an engine that cannot parse url() drops that
         declaration and keeps the frost. selfcheck glass.1 pins that the two halves
         name the same ids.

         The definitions live in a 0x0 <svg> at the end of the body: they are referenced
         by id, never rendered, and never measured. Turning the theme off removes the
         svg and both observers with it, so the surfaces go back to plain shells. */
      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        var root = document.body || document.documentElement
        var NS = 'http://www.w3.org/2000/svg'
        /* The filter region reaches exactly one bevel past the element on every side, so
           the pixels the rim samples exist as backdrop; it is set from the measured size
           in paint(), because a percentage of the box cannot express a bevel that stays
           constant in px. */
        var two = function (value) { return Math.round(value * 100) / 100 }
        var pct = function (part, whole) { return two(part / whole * 100) + '%' }

        /* 2026-10-07: the command window's target was removed with its paint rule —
           the user asked for the task panel's material, and TodoPanel declares no
           refraction. The composer and, since the borderless round, the right
           column's six guide entries keep one.

           One target may own SEVERAL elements: the guide is six identical rows, and
           the sheet can name the filter only once, so they share one map. That is
           correct only while the elements are one geometry — measured, all six are
           380x56 — so the map is drawn from the target's FIRST element and the rest
           are measured too, which keeps a resize (and a column drag) repainting. If a
           future build gives the six different sizes, split them into two targets. */
        var targets = [
          { id: 'eva-lg-input', selector: '[data-composer-card]', bezel: 14, scale: 14 },
          { id: 'eva-lg-guide', selector: '[data-sidebar-right-guide-entry]', bezel: 14, scale: 14 },
        ]

        /* One map, drawn at the size of the region (the box plus one bevel all round) and
           handed to feImage with no placement attributes, so one map pixel covers one
           region pixel. Two gradients are mixed with screen so each carries one channel.
           R lies flat at 0 over the strip outside the element, ramps 0 -> 128 across the
           element's own bevel, holds 128 through the middle and mirrors that on the far
           side up to 255; G does the same vertically. The offset is therefore zero
           everywhere further than one bevel from an edge, and points outward at the rim. */
        var glassMap = function (w, h, bx, by) {
          var W = w + 2 * bx
          var H = h + 2 * by
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
            + '<defs>'
            + '<linearGradient id="h" x1="0" y1="0" x2="1" y2="0">'
            + '<stop offset="0" stop-color="rgb(0,0,0)"/>'
            + '<stop offset="' + pct(bx, W) + '" stop-color="rgb(0,0,0)"/>'
            + '<stop offset="' + pct(2 * bx, W) + '" stop-color="rgb(128,0,0)"/>'
            + '<stop offset="' + pct(W - 2 * bx, W) + '" stop-color="rgb(128,0,0)"/>'
            + '<stop offset="' + pct(W - bx, W) + '" stop-color="rgb(255,0,0)"/>'
            + '<stop offset="1" stop-color="rgb(255,0,0)"/>'
            + '</linearGradient>'
            + '<linearGradient id="v" x1="0" y1="0" x2="0" y2="1">'
            + '<stop offset="0" stop-color="rgb(0,0,0)"/>'
            + '<stop offset="' + pct(by, H) + '" stop-color="rgb(0,0,0)"/>'
            + '<stop offset="' + pct(2 * by, H) + '" stop-color="rgb(0,128,0)"/>'
            + '<stop offset="' + pct(H - 2 * by, H) + '" stop-color="rgb(0,128,0)"/>'
            + '<stop offset="' + pct(H - by, H) + '" stop-color="rgb(0,255,0)"/>'
            + '<stop offset="1" stop-color="rgb(0,255,0)"/>'
            + '</linearGradient>'
            + '</defs>'
            + '<rect width="' + W + '" height="' + H + '" fill="url(#h)"/>'
            + '<rect width="' + W + '" height="' + H + '" fill="url(#v)" style="mix-blend-mode:screen"/>'
            + '</svg>'
          return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        }

        var host = document.createElementNS(NS, 'svg')
        host.setAttribute('id', 'eva-lg-defs')
        host.setAttribute('aria-hidden', 'true')
        host.setAttribute('focusable', 'false')
        host.setAttribute('style',
          'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none')

        var states = []
        for (var i = 0; i < targets.length; i += 1) {
          var target = targets[i]
          var filter = document.createElementNS(NS, 'filter')
          filter.setAttribute('id', target.id)
          /* sRGB, or the displacement maths happens in linear light and the bend
             lands in the wrong place. */
          filter.setAttribute('color-interpolation-filters', 'sRGB')
          var image = document.createElementNS(NS, 'feImage')
          image.setAttribute('preserveAspectRatio', 'none')
          image.setAttribute('result', 'glass-map')
          var shift = document.createElementNS(NS, 'feDisplacementMap')
          shift.setAttribute('in', 'SourceGraphic')
          shift.setAttribute('in2', 'glass-map')
          shift.setAttribute('scale', String(target.scale))
          shift.setAttribute('xChannelSelector', 'R')
          shift.setAttribute('yChannelSelector', 'G')
          filter.appendChild(image)
          filter.appendChild(shift)
          host.appendChild(filter)
          states.push({ target: target, els: [], size: '', filter: filter, image: image })
        }
        root.appendChild(host)

        /* Draw only when the pixel size actually changed: a sub-pixel reflow would
           otherwise rebuild a ~1 KB data URL on every frame of a resize. The bevel may
           not eat more than a third of the element, so a surface narrower than three
           bevels still gets a (proportionally smaller) bend instead of a broken map.
           els[0] is the map's geometry source: one filter id carries one map, and a
           multi-element target is one geometry by construction (see targets). */
        var paint = function (state) {
          if (state.els.length === 0) return
          var box = state.els[0].getBoundingClientRect()
          var w = Math.round(box.width)
          var h = Math.round(box.height)
          if (w < 8 || h < 8) return
          var key = w + 'x' + h
          if (key === state.size) return
          state.size = key
          var bx = Math.max(2, Math.min(state.target.bezel, Math.round(w / 3)))
          var by = Math.max(2, Math.min(state.target.bezel, Math.round(h / 3)))
          state.filter.setAttribute('x', pct(-bx, w))
          state.filter.setAttribute('y', pct(-by, h))
          state.filter.setAttribute('width', pct(w + 2 * bx, w))
          state.filter.setAttribute('height', pct(h + 2 * by, h))
          state.image.setAttribute('href', glassMap(w, h, bx, by))
        }

        var watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
          for (var e = 0; e < entries.length; e += 1) {
            for (var s = 0; s < states.length; s += 1) {
              if (states[s].els.indexOf(entries[e].target) !== -1) paint(states[s])
            }
          }
        }) : null

        /* The app mounts its shell asynchronously, so a one-shot lookup would miss a
           surface that is not there yet. Cheap re-scan, coalesced to one per frame.
           A target may own several elements (the guide's six rows), so this walks the
           whole match set: new nodes get observed, departing ones unobserved, and the
           map is redrawn only when the set actually changed; clearing that size on every
           scan would rebuild a ~1 KB data URL on every frame: the cached size survives
           an unchanged set. */
        var scan = function () {
          for (var s = 0; s < states.length; s += 1) {
            var state = states[s]
            var found = document.querySelectorAll(state.target.selector)
            var next = []
            var changed = found.length !== state.els.length
            for (var f = 0; f < found.length; f += 1) {
              if (state.els.indexOf(found[f]) === -1) {
                if (watcher !== null) watcher.observe(found[f])
                changed = true
              }
              next.push(found[f])
            }
            for (var g = 0; g < state.els.length; g += 1) {
              if (next.indexOf(state.els[g]) === -1) {
                if (watcher !== null) watcher.unobserve(state.els[g])
                changed = true
              }
            }
            state.els = next
            if (changed) {
              /* The set is the trigger. An unchanged set means no geometry moved here, and
                 the read inside paint() would force a layout to redraw a map nobody asked
                 to redraw -- on a streaming reply that is a forced layout on every frame.
                 A real resize is the ResizeObserver's business: it calls paint() itself. */
              state.size = ''
              paint(state)
            }
          }
        }

        /* The scan exists to catch a surface that has just been mounted, so it only has to
           run when a batch could have mounted or unmounted one. Testing the handful of nodes
           the batch actually added or removed is exact rather than a guess: this observer
           watches childList only, so nothing but an addition or a removal can change which
           elements match a selector. Without this test every batch paid a document-wide
           query for each target. One of the two targets, [data-sidebar-right-guide-entry],
           is not rendered at all on a plain new-Session page: there the query could never
           find anything, and it still ran once per batch -- under a streaming reply, once
           per coalesced frame, for nothing. */
        var could = function (records, selector) {
          for (var r = 0; r < records.length; r += 1) {
            var bags = [records[r].addedNodes, records[r].removedNodes]
            for (var b = 0; b < bags.length; b += 1) {
              var bag = bags[b]
              if (bag === undefined || bag === null) continue
              for (var n = 0; n < bag.length; n += 1) {
                var node = bag[n]
                if (node === null || node === undefined) continue
                if (typeof node.matches === 'function' && node.matches(selector)) return true
                if (typeof node.querySelector === 'function' && node.querySelector(selector) !== null) return true
              }
            }
          }
          return false
        }

        var mounted = function (records) {
          for (var s = 0; s < states.length; s += 1) {
            if (could(records, states[s].target.selector)) return true
          }
          return false
        }

        var queued = false
        var mounts = typeof MutationObserver === 'function' ? new MutationObserver(function (records) {
          if (!mounted(records)) return
          if (queued) return
          queued = true
          window.requestAnimationFrame(function () { queued = false; scan() })
        }) : null
        if (mounts !== null) {
          mounts.observe(root, { childList: true, subtree: true })
        }
        scan()

        return () => {
          if (mounts !== null) mounts.disconnect()
          if (watcher !== null) watcher.disconnect()
          host.remove()
        }
      }, 'evangelion: liquid glass')

      ctx.effect(() => {
        if (typeof document === 'undefined') return
        /* Idempotence. A reload of this module (HMR rebuild) can leave the previous
           sheet in the DOM if its disposer never ran, and two copies of the paint layer
           would then fight over the same selectors. The owner marker doubles as the
           selector, so a new mount takes over from any old one instead of stacking. */
        var stale = document.querySelectorAll('style[data-plugin-css="' + PLUGIN_ID + '/theme.css"]')
        for (var i = 0; i < stale.length; i += 1) { stale[i].remove() }
        var tag = document.createElement('style')
        tag.dataset.plugin = PLUGIN_ID
        tag.dataset.pluginCss = PLUGIN_ID + '/theme.css'
        /* The wallpaper variables go first. Custom properties resolve at
           computed-value time, so declaration order inside one sheet does not
           change the result — but reading it image-first is easier to follow. */
        /* The blob URLs made below outlive the tag they were written into, so the
           disposer gives them back; without this a reload of the module would leave
           the bitmaps reachable for the life of the document. */
        var blobUrls = []
        tag.textContent = shortenDataUrls(WALLPAPER_DECLARATIONS, blobUrls) + '\n' + CSS + '\n' + BOOT_CSS + '\n' + PICKER_CSS
        document.head.appendChild(tag)

        /* prefers-reduced-motion cannot be honoured from the stylesheet: the paint
           layer may not carry @media (selfcheck css.7 rejects an at-block there), so
           the query is evaluated here and published as one body attribute the
           stylesheet keys on. It rides on the
           effect that installs the sheet, so turning the theme off takes the
           attribute away with it. */
        var motion = window.matchMedia('(prefers-reduced-motion: reduce)')
        var applyMotionPref = function () {
          if (document.body) document.body.dataset.evaMotion = motion.matches ? 'reduced' : 'full'
        }
        applyMotionPref()
        motion.addEventListener('change', applyMotionPref)
        return () => {
          /* The sheet goes first: it is the one thing whose absence is visible in
             the next paint. What is left only retracts state the sheet keyed on, and
             selfcheck cli.9 anchors its regex on the tag.remove() call below (see
             tools/selfcheck.mjs).) */
          tag.remove()
          for (var b = 0; b < blobUrls.length; b += 1) {
            if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
              URL.revokeObjectURL(blobUrls[b])
            }
          }
          motion.removeEventListener('change', applyMotionPref)
          if (document.body) document.body.removeAttribute('data-eva-motion')
        }
      }, 'evangelion: paint layer')

      /* Boot mask -- 「闸门开启」. One page load plays it once (the in-page
         window.__evaBootMark guard), then it deletes itself. The disposer returned
         by mountBootScreen IS destroyBoot, so turning the theme off mid-play takes
         the mask away with the stylesheet. It waits for the paint layer's tag, so it
         must be registered after it. */
      ctx.effect(() => mountBootScreen(), 'evangelion: boot screen')

      /* The vendored plugin-toggle switch. It is the user's own plugin folded in, not
         a re-implementation, and it registers its own disposer through ctx.effect —
         so this is a single call, not an effect of ours. */
      applyPluginToggle(ctx)

      /* The vendored session-status rail (2026-10-09). Same rule as the switch above:
         the user's own plugin, folded in byte for byte, registering its own disposer
         through ctx.effect — one call, not an effect of ours.

         It marks each session row's left rail (waiting on you / selected / unread
         completion) and paints the pinned row's title. Its cordis row carried exactly
         one config value, hideOfficialDot: true — hide the official unread dot on a row
         this rail has already coloured — which is also resolveConfig()'s own default,
         so nothing is passed here; the behaviour is the plugin's own row, unchanged.

         The three services it reads (uiSession, sessions, workspaces) are named in the
         exports.inject below, so the loader hands it a context where they exist. It is
         called after the switch only because the mount order reads top-down. */
      applySessionEvaStatus(ctx)

      /* The composer's model seat (round 50, 2026-10-14): two independent controls
         where the official composer had one merged button. It is called for its own
         side effect -- the seat registration -- and registers through
         ctx.inject + slots.inject rather than ctx.effect, so it adds no effect to the
         ten cli.11d counts. See mountModelSeat above for why it shadows at -1. */
      mountModelSeat(ctx)

      /* Brand row, three zones -- the user's own mapping (2026-10-08, round 25, D68):
         the avatar Logo opens Plugins, WHALE-01 stays New session, SYSTEM opens
         Settings, and the sheet hides both official entries (the settings button and
         the plugin row).

         Why this is script and not CSS: the three labels are ONE button. The official
         SidebarRoot renders the brand.mark and brand.name slots INSIDE the sidebar's
         brand button, and the sheet draws SYSTEM as that button's own ::after -- so
         the zones are coordinates on one button, never three elements, and a
         pseudo-element has no box to measure. The third zone therefore starts where
         the NAME box ends: SYSTEM and its padding follow the name, so they share its
         zone.

         A capture-phase listener on document is the only place that can pre-empt the
         official onClick (which starts a session). React delegates at #root, which
         sits BELOW document, so stopPropagation() here means the official handler
         never runs -- measured on a live instance: the button's own listener saw
         nothing for an intercepted click, and both hidden targets still open their
         surface when clicked programmatically (display:none does not block a
         synthetic .click()).

         Every mismatch falls back to the official behaviour rather than to a dead
         click: keyboard activation has no coordinates and is let through, a modified
         click is left to the browser, and a plugins zone whose row is missing is not
         intercepted at all. The settings zone is the one exception -- with its button
         gone it presses the command's own shortcut instead, the same command by
         another door (measured: the dispatcher reads the event's keys, not its
         isTrusted flag).

         Zones are measured at click time, never cached: the sidebar can be wide
         (mark + name) or a rail (mark only, no name -- and then no brand button at
         all), and a cached box would route a click to the wrong surface. */
      ctx.effect(() => deferEffect(() => {
        if (typeof document === 'undefined') return undefined

        var NAME = "[data-slot='sidebar.brand.name']"
        var MARK = "[data-slot='sidebar.brand.mark']"
        var LAUNCHER = "[data-slot='settings.launcher'] > button"
        /* The plugins row, named by its accessible name. The row carries no
           id-bearing attribute at all (measured: type / class / aria-label), and the
           slot anchor inside it is an anonymous display:contents wrapper, so its
           siblings in the same nav cannot be told apart structurally. The label comes
           from the plugin-manager dictionary, which ships exactly two strings (zh
           '插件', en 'Plugins') with every other locale falling back to en -- naming
           both is complete, and naming only these leaves the nav's other rows (the
           shipped composition also has ui-schedule's, order 10) alone. An unmatched
           row is not intercepted at all, so the click falls through to the official
           handler. */
        var PANEL_ROW = "[data-slot='sidebar'] > div > nav[aria-label] > button:has([data-slot='sidebar.panellist'])[aria-label='插件'], [data-slot='sidebar'] > div > nav[aria-label] > button:has([data-slot='sidebar.panellist'])[aria-label='Plugins']"

        /* The settings command by its other door: the chord the launcher advertises
           in the WEB runtime (Control+Alt+,; the desktop build binds the same command
           to Ctrl+, -- dsh-client-shortcuts declares a map per receiving device, so
           this synthesized event only matches where the web map is in force). Reached
           only when the launcher button is absent from the DOM. */
        var pressSettingsShortcut = function () {
          if (typeof KeyboardEvent !== 'function') return
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: ',', code: 'Comma', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
          }))
        }

        var onCapture = function (event) {
          if (event.button !== 0) return
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
          var node = event.target
          var button = node !== null && node.closest ? node.closest('button') : null
          if (button === null) return
          var name = button.querySelector(NAME)
          if (name === null) return
          /* detail 0 is Enter/Space on the focused button (and any programmatic
             click): no coordinates, so no zone -- the official new session stands. */
          if (event.detail === 0) return
          var mark = button.querySelector(MARK)
          var x = event.clientX
          var zone = ''
          if (mark !== null && x < mark.getBoundingClientRect().right) zone = 'plugins'
          else if (x >= name.getBoundingClientRect().right) zone = 'settings'
          if (zone === '') return
          var hidden = document.querySelector(zone === 'plugins' ? PANEL_ROW : LAUNCHER)
          /* A missing plugin row is not intercepted at all, so the click still falls
             through to the official handler instead of becoming a hole. */
          if (hidden === null && zone === 'plugins') return
          event.stopPropagation()
          event.preventDefault()
          if (hidden !== null) hidden.click()
          else pressSettingsShortcut()
        }

        document.addEventListener('click', onCapture, true)
        return () => { document.removeEventListener('click', onCapture, true) }
      }), 'evangelion: brand row zones')

      /* ---- Workspace pins: hold chosen Workspaces at the top of the list
         (round 39, 2026-10-09)

         The thing being fixed is measured, not assumed. Creating a Workspace
         PREPENDS it to the durable order -- dsh-workspace-index.js:685 is
         'workspaceIds: [id, ...state.workspaceIds]' -- and the client model mirrors
         that prepend in its own upsert() (api-wsc-client.js:292:
         'this.committedOrder = [view.workspaceId, ...this.committedOrder]'). So a
         Workspace the reader wants on top slides down one slot every time another is
         added, in the registry and on screen.

         Nothing official pins a WORKSPACE. The registry record carries no pin field,
         the client model's pinnedSessionIds is Sessions only, and workspaceMenuItems is
         a hardcoded two-row array (rename, delete) rather than a slot -- so the row
         itself is the only door, and the row is React's. The control is therefore
         injected into the official 'span.rowActions' and re-asserted on every mutation
         the sidebar makes: React removing the button is itself a childList mutation,
         so the next pass puts it back.

         Where the pin set lives, and why it is browser storage. The host half cannot
         carry it: it is CommonJS with no node_modules of its own, the typert remote
         protocol it would need has no '@deepseek-ai/cordis' anywhere on this disk, and
         the two standing host rules -- no filesystem writes, no HTTP routes -- plus
         "exports no Config" (tools/selfcheck.mjs host.2) close the other doors. Browser
         storage is what is left, and it is the official client-side answer:
         @deepseek-ai/dsh-client-store documents its persisted stores as JSON in
         localStorage. The ORDER, unlike the pin set, is already durable on the host, so
         every re-assert goes through the official insertBefore and survives a restart;
         only "which ones are pinned" follows the browser profile.

         The move is the official one: the client service face's insertBefore
         (api-wsc-client.js:412) moves a Workspace within the durable order and installs
         the result optimistically, so the row lands where it belongs before the round
         trip finishes. Only moves that actually change the order are sent, so a settled
         list stays silent -- which matters, because each one is a durable write. */
      ctx.effect(() => deferEffect(() => {
        if (typeof document === 'undefined') return undefined
        var workspaces = ctx.get('workspaces')
        if (workspaces === undefined || workspaces === null) return undefined
        var list = workspaces.list
        if (list === undefined || list === null) return undefined
        if (typeof list.getSnapshot !== 'function') return undefined
        if (typeof list.subscribe !== 'function') return undefined
        /* Without a move door there is nothing to offer: a button that only remembered
           a set would be a button that lied about the order. */
        if (typeof workspaces.insertBefore !== 'function') return undefined

        var PIN_KEY = 'eva-theme/workspace-pins'
        /* A real Workspace row keys itself on its own id -- buildGroup's first argument
           is workspace.workspaceId (ui-workspace-client.js:434). The Ungrouped bucket
           reuses the same prefix with an empty suffix (:437), which is why an empty id
           is skipped below rather than treated as a Workspace. */
        var ROW_PREFIX = 'workspace:'
        var ROW_SELECTOR = 'div[data-row-key^="' + ROW_PREFIX + '"]'
        var BUTTON_ATTR = 'data-eva-ws-pin-button'
        var STATE_ATTR = 'data-eva-ws-pin-state'
        /* The one subtree every workspace row lives in. Measured on the live app: the
           sidebar holds a single role=tree, and the Workspace rows and the Session rows
           are both inside it. Reaching for it by this slot name is what lets the pass
           scan eleven rows instead of the whole document -- see rowsOf(). */
        var SCOPE_SELECTOR = "[data-slot='sidebar.workspaces']"

        /* Official pin artwork, lifted verbatim from
           @deepseek-ai/dsh-client-ui-primitives' IconPinOutlineArtwork /
           IconPinFillArtwork (viewBox 0 0 16 16, drawn at size 14 with a 1px stroke) so
           the control reads as the icon the official Session rows already use. The two
           versions differ in the first path only: the outline strokes it, the fill fills
           it as well. */
        var HEAD = 'M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z'
        var TAIL = 'M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z'
        var SVG_OPEN = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">'
        var ICON = {
          on: SVG_OPEN + '<path d="' + HEAD + '" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="' + TAIL + '" fill="currentColor"/></svg>',
          off: SVG_OPEN + '<path d="' + HEAD + '" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="' + TAIL + '" fill="currentColor"/></svg>',
        }

        /* The two labels go through the official locale service -- the same door the
           vendored switch uses -- so the control follows the host's language. A missing
           or throwing locale seat costs the wording only, never the button. */
        var NS = 'eva-workspace-pins'
        var DICT = {
          zh: { pin: '置顶工作区', unpin: '取消置顶' },
          en: { pin: 'Pin workspace', unpin: 'Unpin workspace' },
        }
        var translate = null
        var offLocale = null
        var locale = ctx.get('locale')
        if (locale !== undefined && locale !== null) {
          if (typeof locale.register === 'function') {
            try { locale.register(NS, DICT) } catch (error) { /* an already-registered namespace keeps its first dictionary */ }
          }
          if (typeof locale.bind === 'function') {
            try { translate = locale.bind(NS) } catch (error) { translate = null }
          }
        }

        var scheduled = false
        var applying = false
        var disposed = false
        /* How many rounds in a row may send moves while the order the model reports stays
           the same. One honest settle costs two rounds -- the one that moves, and the one
           that finds nothing left to do -- and the budget leaves room for a snapshot that
           lags its write by a round trip. A host that accepts a move and never reflects it
           stops here instead of re-scheduling itself from a resolved promise forever; the
           next change to the model refills the budget, so stopping loses nothing. */
        var ATTEMPT_BUDGET = 4
        var attempts = 0
        var lastRound = ''

        function label(key) {
          if (translate !== null) {
            try {
              var text = translate(key)
              if (typeof text === 'string' && text !== '') return text
            } catch (error) { /* a translator that throws falls back to the dictionary below */ }
          }
          return DICT.en[key]
        }

        function readPins() {
          try {
            var raw = localStorage.getItem(PIN_KEY)
            if (typeof raw !== 'string' || raw === '') return []
            var parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) return []
            var ids = []
            for (var i = 0; i < parsed.length; i++) {
              if (typeof parsed[i] === 'string' && parsed[i] !== '' && ids.indexOf(parsed[i]) === -1) ids.push(parsed[i])
            }
            return ids
          } catch (error) { return [] }
        }

        function writePins(ids) {
          try { localStorage.setItem(PIN_KEY, JSON.stringify(ids)) } catch (error) { /* a blocked store still holds this session's order */ }
        }

        function order() {
          var snapshot = list.getSnapshot()
          var items = snapshot === null || snapshot === undefined || !Array.isArray(snapshot.items) ? [] : snapshot.items
          var ids = []
          for (var i = 0; i < items.length; i++) {
            var item = items[i]
            var id = item === null || item === undefined ? undefined : item.workspaceId
            if (typeof id === 'string' && id !== '') ids.push(id)
          }
          return ids
        }

        function stop(event) {
          event.stopPropagation()
          event.preventDefault()
        }

        function onToggle(event) {
          stop(event)
          var button = event.currentTarget
          var id = button === null || button === undefined ? null : button.getAttribute(BUTTON_ATTR)
          if (typeof id !== 'string' || id === '') return
          var pinned = readPins()
          var at = pinned.indexOf(id)
          if (at === -1) pinned.push(id)
          else pinned.splice(at, 1)
          writePins(pinned)
          paint()
          enforce()
        }

        /* Round 40 (2026-10-09) — why this function writes only what differs.
           Round 39 wrote every attribute and the artwork on every pass, and an
           innerHTML assignment is not a value assignment in the DOM: it removes the
           button's old children and inserts new ones, which is a childList mutation.
           childList is exactly what the observer below watches, and attributeFilter
           cannot cover it -- a filter only narrows the records of the class it is
           given. So the pass that React's own render scheduled fed itself: observer ->
           schedule() -> paint() -> decorate() -> childList -> observer, a microtask
           chain with no exit and no way for the task queue to run. From outside that is
           a renderer pinned at one core with no allocation growth and no error, and a
           start-up frozen on 「Loading plugins」. The scheduled flag cannot break it: it
           is cleared at the top of the very microtask the MutationObserver callback is
           queued into, so it only ever rejects re-entry within one pass, never across
           two.
           Writing only what differs ends the chain on its second pass -- nothing
           changes, nothing mutates, nothing schedules. Measured in Chromium against the
           round-39 shape: 2000 decorate passes in 32 ms before anything could stop it,
           versus 2 passes and 1 write when idempotent.
           firstElementChild is in the guard so a button whose contents someone else
           clears is still repainted -- the same self-healing the childList watch exists
           for (see the round-39 note above). Whether the button is on is still the
           caller's argument alone. */
        function decorate(button, id, on) {
          var text = label(on ? 'unpin' : 'pin')
          var state = on ? 'on' : 'off'
          if (button.getAttribute(BUTTON_ATTR) !== id) button.setAttribute(BUTTON_ATTR, id)
          if (button.getAttribute('aria-label') !== text) {
            button.setAttribute('aria-label', text)
            button.setAttribute('title', text)
          }
          if (button.getAttribute(STATE_ATTR) !== state || button.firstElementChild === null) {
            button.setAttribute(STATE_ATTR, state)
            button.setAttribute('aria-pressed', on ? 'true' : 'false')
            button.innerHTML = on ? ICON.on : ICON.off
          }
        }

        function create(id, on) {
          var button = document.createElement('button')
          button.type = 'button'
          /* The row's own click expands the group and its mousedown starts a drag;
             neither is this control's to trigger. React delegates at #root, which sits
             BELOW document, so a bubble-phase stopPropagation() keeps the official
             onClick out -- the same measurement the brand row zones effect relies on. */
          button.addEventListener('mousedown', stop)
          button.addEventListener('pointerdown', stop)
          button.addEventListener('click', onToggle)
          decorate(button, id, on)
          return button
        }

        /* The sidebar, remembered while it stays attached. A remount detaches it and the
           next call looks it up again, so nothing is held across a re-render. */
        var scopeHost = null
        /* Whether the last pass had to fall back to a document-wide query, i.e. whether the
           rows are known to live in the sidebar at all. It starts true so that no batch is
           filtered before a pass has actually found rows in there, and it goes back to true
           the moment a pass does not. While it is true the filter below lets everything
           through: not knowing where the rows are is not a licence to skip their batches. */
        var scopeMissed = true
        function scope() {
          if (scopeHost !== null && scopeHost.isConnected) return scopeHost
          scopeHost = document.querySelector(SCOPE_SELECTOR)
          return scopeHost
        }

        /* The rows to paint, found inside the sidebar when it is there and falling back to
           the document when it is not. The fallback is what keeps an alternate layout (or a
           sidebar that renders somewhere else entirely) working: the scoped query is an
           optimisation, never a precondition. It is also why an empty scoped result still
           falls through -- the sidebar can be collapsed with every row out of the DOM, and
           then the honest answer costs the same query the old code always paid. */
        function rowsOf() {
          var host = scope()
          if (host !== null) {
            var scoped = host.querySelectorAll(ROW_SELECTOR)
            if (scoped.length > 0) {
              scopeMissed = false
              return scoped
            }
          }
          scopeMissed = true
          return document.querySelectorAll(ROW_SELECTOR)
        }

        function paint() {
          if (disposed) return
          var rows = rowsOf()
          var pinned = readPins()
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i]
            var key = row.getAttribute('data-row-key')
            if (typeof key !== 'string') continue
            var id = key.slice(ROW_PREFIX.length)
            /* The Ungrouped bucket is not a Workspace. */
            if (id === '') continue
            var on = pinned.indexOf(id) !== -1
            var button = row.querySelector('[' + BUTTON_ATTR + ']')
            if (button === null) {
              button = create(id, on)
              /* The official rowActions is display:none until the row is hovered (or its
                 menu is open), so the pin inherits the row's own affordance instead of
                 inventing a second one -- and going in FIRST leaves the two official
                 buttons at exactly the pixels they already occupied. */
              var anchor = row.querySelector('button')
              var host = anchor !== null && anchor.parentElement !== null ? anchor.parentElement : row
              host.insertBefore(button, host.firstChild)
            } else {
              decorate(button, id, on)
            }
          }
        }

        function idAt(ids, index) {
          return index >= 0 && index < ids.length ? ids[index] : undefined
        }

        function moved(ids, id, beforeId) {
          var rest = []
          for (var i = 0; i < ids.length; i++) { if (ids[i] !== id) rest.push(ids[i]) }
          var at = rest.indexOf(beforeId)
          if (at === -1) rest.push(id)
          else rest.splice(at, 0, id)
          return rest
        }

        function step(id, beforeId) {
          return function () { return workspaces.insertBefore(id, beforeId) }
        }

        /* Walk the pinned ids in pin order and place each where it belongs. insertBefore
           is DOM-like: it lands the id before its anchor, or appends when there is none.
           The walk runs on a virtual copy of the order, so each anchor is computed
           against the order the moves themselves produce rather than against a list that
           has already gone stale -- and a move is sent only when it changes something. */
        function enforce() {
          if (disposed || applying) return
          var current = order()
          if (current.length === 0) return
          var pinned = readPins()
          var wanted = []
          for (var i = 0; i < pinned.length; i++) {
            if (current.indexOf(pinned[i]) !== -1) wanted.push(pinned[i])
          }
          var moves = []
          var virtual = current
          for (var j = 0; j < wanted.length; j++) {
            if (virtual[j] === wanted[j]) continue
            var beforeId = idAt(virtual, j)
            if (beforeId === undefined || beforeId === wanted[j]) continue
            moves.push([wanted[j], beforeId])
            virtual = moved(virtual, wanted[j], beforeId)
          }
          var round = current.join('\u0000')
          if (moves.length === 0) {
            /* Nothing to do is the settled state: refill the budget. */
            attempts = 0
            lastRound = round
            return
          }
          if (round === lastRound) {
            attempts++
            if (attempts > ATTEMPT_BUDGET) return
          } else {
            attempts = 0
          }
          lastRound = round
          applying = true
          var chain = Promise.resolve()
          for (var k = 0; k < moves.length; k++) chain = chain.then(step(moves[k][0], moves[k][1]))
          chain.then(
            function () { applying = false; schedule() },
            /* A refused move is not retried from here: the model's own invalidation is
               what schedules the next pass, so a permanently refused order cannot spin. */
            function () { applying = false }
          )
        }

        function schedule() {
          if (scheduled || disposed) return
          scheduled = true
          queueMicrotask(function () {
            scheduled = false
            if (disposed) return
            paint()
            enforce()
          })
        }

        function dispose() {
          disposed = true
          observer.disconnect()
          if (offList !== null && typeof offList === 'function') {
            try { offList() } catch (error) { /* an already-detached listener is fine */ }
            offList = null
          }
          if (offLocale !== null && typeof offLocale === 'function') {
            try { offLocale() } catch (error) { /* an already-detached listener is fine */ }
            offLocale = null
          }
          var buttons = document.querySelectorAll('[' + BUTTON_ATTR + ']')
          for (var i = 0; i < buttons.length; i++) {
            buttons[i].removeEventListener('mousedown', stop)
            buttons[i].removeEventListener('pointerdown', stop)
            buttons[i].removeEventListener('click', onToggle)
            buttons[i].remove()
          }
        }

        /* A batch of mutations that provably misses the sidebar is not this pass's business:
           the pass reads no row outside it, so there is nothing it could have to do. Everything
           a streaming answer, a tool card or a toast produces lands in the conversation pane
           and is dropped here instead of costing a query, a localStorage read and a walk.
           Three things still have to schedule, and they are the whole of the rule: a target
           inside the sidebar, a node that was added or removed CONTAINING the sidebar, and a
           cached host that is no longer attached. The last two are the remount this watch
           exists for -- React replacing the sidebar itself is exactly the case where the
           subtree is not the target, and skipping it would leave the buttons off the rows. */
        function touches(records) {
          var host = scopeHost
          if (host === null || !host.isConnected) return true
          for (var i = 0; i < records.length; i++) {
            var record = records[i]
            var target = record.target
            if (target !== null && target !== undefined && (target === host || host.contains(target))) return true
            var bags = [record.addedNodes, record.removedNodes]
            for (var b = 0; b < bags.length; b++) {
              var bag = bags[b]
              if (bag === undefined || bag === null) continue
              for (var n = 0; n < bag.length; n++) {
                var node = bag[n]
                if (node === host || (typeof node.contains === 'function' && node.contains(host))) return true
              }
            }
          }
          return false
        }

        /* Only the row key is watched for attributes: React rewrites class on every
           render, while data-row-key moves only when the row does -- and that filter is
           also what keeps this effect's own data-eva-ws-pin* writes from scheduling
           another pass. childList has to stay on for the button to survive React
           (round-39 note above), and a filter cannot narrow it, so the pass itself is
           what must be silent when nothing changed -- see decorate(). What CAN be
           narrowed is which batches reach the pass at all, which is touches() above. */
        var observer = new MutationObserver(function (records) {
          if (!touches(records)) return
          schedule()
        })
        if (document.body !== undefined && document.body !== null) {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-row-key'],
          })
        }
        var offList = list.subscribe(schedule)
        if (locale !== undefined && locale !== null && typeof locale.subscribe === 'function') {
          try { offLocale = locale.subscribe(schedule) } catch (error) { offLocale = null }
        }
        schedule()

        return dispose
      }), 'evangelion: workspace pins')

      /* Round 60 (2026-10-15) -- the entry only exists while the 微信 channel holds an account.
         User's words: 「没有连接微信的时候隐藏按钮图标」. A channel with nothing bound behind it
         should not spend a button in the 工作区 row, and it has to come back by itself the moment
         an account is bound -- the same rule round 50 put on the 微信 entry and round 55 copied
         onto the Telegram one, now that dsh-wechat is the only channel left. The question is
         asked of the CHANNEL rather than guessed from the list: a 微信会话- titled group is
         evidence that a workspace exists, not that a phone can reach it -- this repo has already
         seen four such conversations left behind by a retired plugin. What counts as an account
         is the plugin's own criterion, not this theme's: dsh-wechat-plugin's settings page treats
         status.accounts.length === 0 as 未连接 (client.js:1080 and :1117 branch on it), and the
         answer comes from the same route that page reads -- /.dsh-wechat-plugin/status, the
         PREFIX at plugin client.js:33, 'request(PREFIX + "/status")' at :618. Also now:
         while the gate is dark the BUTTON IS NOT IN THE ROW at all rather than merely invisible,
         so the row keeps the order it had. */
      /* Round 51 (2026-10-12) -- the plugin went back to dsh-wechat, so the entry does too.
         User's words (m01147): 「DSH-IM不好用！把DSH-Wechat给我换回来，并且把工作区旁边的图标
         也改回来。」 Two halves, one round: the profile drops @xmanrui/dsh-im and installs
         dsh-wechat-plugin 0.37.0 (with the origin-gate patch rebased onto it), and this theme
         half withdraws the pair of channel filters rounds 42/49 put here -- the channel table
         CHANNELS, both artworks, the three-valued state, the pump that clicked the host's own
         show-more control frame by frame, and round 50's 微信 channel gate -- and restores the
         single 「微信会话」 workspace switch of rounds 43-45 (contract data-eva-wx-*, the state
         attribute always carries 'weixin'). The comment and the body below are rounds 43-47's,
         not a character changed. */
      /* Round 43 (2026-10-10) -- the 微信 entry, one click from the 工作区 row.

         Round 41 put a Telegram filter on this row and round 42 a 微信 entry beside it.
         Round 45 (later the same day) removed the Telegram one at the user's word:
         「再去telegram按钮，毕竟现在不用了，可以删去这个功能了。」 Its whole machine --
         the channel list, the title marker, the staged expansion through the official
         show-more control, the row tags -- went with it. What is left is a switch on ONE
         workspace, which is what round 43 had already asked for and what round 44 finished:
         「1 是那枚筛选按钮 2「微信会话」及其里面的会话一起搬。 3.点亮微信按钮时才出现。
         先去掉微信按钮先前的功能，然后加入我现在要求的功能。」

         What it acts on: the workspace dsh-wechat-plugin creates and names 微信会话. It
         arrives as one group of this same tree, so the switch needs no service call and no
         host-side door -- the group is a DOM node. While the switch is off that group is
         out of the list; while it is on every OTHER group is out of the list instead, so
         the list holds the 微信 conversations and nothing else.

         Round 43 tried to get there with order: -1 alone, which only lifts a group. The
         other workspaces were still there, merely pushed down, and the user reported
         exactly that difference: 「点亮微信按钮时，侧栏工作区列表内只显示「微信会话」下的
         会话条目，其他工作区不得保留，也不得以置顶方式出现；同时不显示「微信会话」这个
         工作区分组标题，只显示该分组下的会话标题。」 A lift is not a filter, and the sheet
         has no way to filter with order -- hiding is display: none.

         The same words pin the other two halves: the group's own header comes off the list
         too (that is what leaves its Session titles showing bare), and a folded group is
         unfolded through its own header click -- a folded group renders no Session rows at
         all and its header is hidden here, so lighting the entry on one would otherwise
         leave an empty list.

         Why nothing is moved: the group is a flex item of the tree, the tree is the scroll
         box, and every write is one attribute this effect owns. React's own render is never
         fought, and putting the list back is removing the attributes -- nothing on the
         screen is inserted, moved or deleted.

         The entry is one button, a child of the 工作区 row immediately before the search
         slot. That row is a flex line with justify-content: flex-end and the search slot
         carries margin-left: auto, so the button sits immediately right of the 工作区 label
         while the search button and both official icon buttons keep the pixels they already
         had. It wore a contract named after Telegram while a Telegram entry shared its box;
         round 45 renamed the pair to data-eva-wx-button / data-eva-wx-state, so nothing in
         this theme is named after the feature the user retired.

         The list is a list of Workspaces, so the workspace title is the only handle that
         survives a reinstall, a second profile or another machine -- see WX_GROUP_LABEL. */
      ctx.effect(() => deferEffect(() => {
        if (typeof document === 'undefined') return undefined

        var BUTTON_ATTR = 'data-eva-wx-button'
        var STATE_ATTR = 'data-eva-wx-state'
        var GROUP_ATTR = 'data-eva-wx-group'
        var WX_TREE_ATTR = 'data-eva-wx-tree'
        var HEAD_ATTR = 'data-eva-wx-head'
        var WORKSPACE_PREFIX = 'workspace:'
        /* The workspace dsh-wechat-plugin creates and names. Its title is enforced by that
           plugin on every start (lib/host.js:72 WORKSPACE_TITLE = '微信会话', written back at
           :2632-2633 await workspace.setTitle(title)), so it does not follow the locale, and
           it is matched against the GROUP ROW'S OWN TEXT rather than a hard-coded workspace
           id -- a uuid would break on another machine, a reinstall or a second profile, while
           the title is what the user reads on that row. A missing match costs this entry its
           effect and nothing else. */
        var WX_GROUP_LABEL = '微信会话'
        /* The host's own names for the 工作区 area and for the empty marker that is a
           direct child of that row -- both are slots, not CSS-Modules classes. */
        var SLOT_SELECTOR = "[data-slot='sidebar.workspaces']"
        var MARK_SELECTOR = "[data-slot='sidebar.workspaces.directoryFlow']"
        /* The entry's id: what the button carries in BUTTON_ATTR, which is also the value the
           sheet's own attribute selectors never have to name -- there is one entry now. */
        var WX_ENTRY_ID = 'weixin'

        /* Round 60: the two names below belong to dsh-wechat-plugin, not to this theme, and both
           are read straight out of the installed package rather than guessed. Its host half
           registers a prefix route (lib/host.js:3622 webServer.register({ kind: 'prefix', path:
           '/.dsh-wechat-plugin' }) whose ROUTE_STATUS branch answers with runtime.status(), and
           that status is exactly { enabled, accounts, needsLogin, errors, diagnostics }
           (lib/host.js:477-497). Its client half is where PREFIX comes from (client.js:33
           const PREFIX = '/.dsh-wechat-plugin') and asks the same route on mount and on every poll
           (client.js:618 request(PREFIX + "/status")).
             A version of that plugin which renames the prefix costs this entry its gate: the
           request answers 404, that is no answer at all, and the last word stands -- so a rename
           can only ever leave the entry as it was, never take it away. That is the direction this
           gate is built to fail in. */
        var WX_STATUS_PATH = '/.dsh-wechat-plugin/status'
        /* One question a minute while the page is on screen, plus one whenever it comes back.
           The answer changes only when the user binds or unbinds the account in the plugin's own
           settings panel, so a minute of lag on a button is not worth a watcher -- and nothing is
           asked at all while the page is off screen. */
        var STATUS_INTERVAL = 60000

        /* The row's own icons are 16x16 in a 16 viewBox, 1px stroke, currentColor, and this
           one is drawn to that box. The artwork is the outline the user supplied rather than
           a copy of the IM plugin's filled 24-unit logo, at their instruction: 参考这个画一个.
           The file it came from -- _work/wx-ref.html in the working tree, a 204x184 JPEG --
           was measured, not traced by eye: the ink is ONE closed contour (5 086 px, one
           enclosed hole) plus four filled eye disks, so the drawing is two ellipses whose
           mutual overlap is erased on the back bubble only, two tail triangles, and four
           dots. The two centre-lines were fitted to the outline pixels (least squares on an
           iteratively re-assigned boundary set) and land here at A(5.799, 6.142, 5.502x4.488)
           and B(11.075, 9.405, 4.620x3.817); the eyes at (3.899, 4.681), (7.720, 4.672),
           (9.606, 8.524), (12.618, 8.528); the tails from (2.561, 9.771) to a tip at
           (1.850, 11.200) and from (11.632, 13.194) to (14.337, 14.088). Re-drawing that
           geometry scores 0.827 IoU against the source ink at its own resolution, which is
           the check that this is the same drawing and not a lookalike.
             Two deliberate departures from a literal transcription: the back bubble is
           drawn as its visible ARC rather than a full ellipse (the fit puts its hidden
           span between t=1.409 and t=6.161 rad, and drawing it whole would put a line
           through the front bubble the reference does not have); and the stroke stays at
           ONE user unit like every other icon in this row, where the reference's own
           proportion would be 0.63 and read as a hairline at 16px.
             Measured the same way: at 16px the two bubbles and all four eyes resolve; the
           same artwork at 32px is unambiguous. Inline SVG, never a bitmap, so the icon keeps
           its vector edge on a scaled display. */
        var ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<ellipse cx="11.075" cy="9.405" rx="4.62" ry="3.817"/>' +
          '<path d="M6.684 10.572A5.502 4.488 0 1 1 11.26 5.593"/>' +
          '<path d="M2.561 9.771L1.85 11.2L4.287 10.458Z M11.632 13.194L14.337 14.088L13.374 12.716Z"/>' +
          '<path fill="currentColor" stroke="none" d="M3.155 4.681a0.744 0.744 0 1 0 1.488 0a0.744 0.744 0 1 0 -1.488 0M6.976 4.672a0.744 0.744 0 1 0 1.488 0a0.744 0.744 0 1 0 -1.488 0M9.018 8.524a0.589 0.589 0 1 0 1.178 0a0.589 0.589 0 1 0 -1.178 0M12.029 8.528a0.589 0.589 0 1 0 1.178 0a0.589 0.589 0 1 0 -1.178 0"/>' +
          '</svg>'

        /* Two labels through the official locale service, the door the pin control and the
           vendored switch already use. A missing or throwing seat costs the wording only.
           A key is a name, and the wording names the action rather than a view, because
           that is what the control does: bring the workspace up, and put it back. */
        var NS = 'eva-wechat-workspace'
        var DICT = {
          zh: { weixin: '显示「微信会话」工作区', hidewx: '隐藏「微信会话」工作区' },
          en: { weixin: 'Show the WeChat workspace', hidewx: 'Hide the WeChat workspace' },
        }
        var translate = null
        var locale = ctx.get('locale')
        if (locale !== undefined && locale !== null) {
          if (typeof locale.register === 'function') {
            try { locale.register(NS, DICT) } catch (error) { /* an already-registered namespace keeps its first dictionary */ }
          }
          if (typeof locale.bind === 'function') {
            try { translate = locale.bind(NS) } catch (error) { translate = null }
          }
        }

        function label(key) {
          if (translate !== null) {
            try {
              var text = translate(key)
              if (typeof text === 'string' && text !== '') return text
            } catch (error) { /* a translator that throws falls back to the dictionary below */ }
          }
          return DICT.en[key]
        }

        var scheduled = false
        var disposed = false
        /* Whether the entry is lit. The group itself is looked up again on every pass rather
           than remembered across one, because React remounts the tree and a node remembered
           from the last pass may already be gone. */
        var wxOn = false
        /* Round 60: whether the 微信 channel holds an account. Hidden until an answer says
           otherwise -- the entry has to be shown, not merely not hidden, and every way of not
           answering (no plugin, a renamed route, a call that throws or rejects, a snapshot of a
           shape this build cannot read) leaves the entry hidden rather than handing the row a
           button that leads nowhere. statusPending is the one-request-at-a-time latch;
           statusTimer is the minute the whole thing costs. */
        var wxLive = false
        var statusPending = false
        var statusTimer = 0

        function schedule() {
          if (scheduled || disposed) return
          scheduled = true
          queueMicrotask(() => {
            scheduled = false
            if (disposed) return
            paint()
          })
        }

        function stop(event) {
          event.stopPropagation()
          event.preventDefault()
        }

        /* The workspaces slot, remembered while it stays attached so the pass does not walk
           the document for it once per batch. The TREE is still looked up fresh below: React
           remounts the tree, and a node remembered from the last pass may already be gone --
           but it remounts into the same slot. */
        var slotHost = null
        function slotNode() {
          if (slotHost !== null && slotHost.isConnected) return slotHost
          slotHost = document.querySelector(SLOT_SELECTOR)
          return slotHost
        }

        /* The session tree. The host renders exactly one role=tree, inside the workspaces
           slot, and every row -- group headers included -- lives in it. */
        function tree() {
          var slot = slotNode()
          if (slot === null) return null
          var host = slot.querySelector("[role='tree']")
          if (host === null) return null
          if (host.querySelector('[data-row-key]') === null) return null
          return host
        }

        function keyOf(node) {
          var key = node.getAttribute('data-row-key')
          return typeof key === 'string' ? key : null
        }

        /* The group container that holds the 微信 workspace, or null. Every row of the list is
           a treeitem whose data-row-key carries its kind, so the walk finds the header
           wherever it sits, and the title is what it is matched on: dsh-wechat-plugin enforces
           微信会话 on that workspace at every start, while a workspace uuid would break on
           another machine, a reinstall or a second profile. The Ungrouped header is excluded
           by its empty suffix.

           The node returned is the tree's OWN child, found by walking up rather than by
           counting parentElements: the live list wraps a header as tree > groupSection >
           wrapper > row, but the Ungrouped header hangs straight off its group section. The
           walk makes both shapes land on the container the sheet has to tag, and the middle
           of a wrapper is never returned by mistake. */
        function wxGroup(host) {
          var row = wxHead(host)
          if (row === null) return null
          var node = row
          while (node.parentElement !== null && node.parentElement !== host) node = node.parentElement
          return node.parentElement === host ? node : null
        }

        /* The 微信 workspace's own header row, wherever it sits. The 分组标题 is hidden
           through this row's wrapper, so the search lives here and wxGroup() is built on top
           of it. */
        function wxHead(scope) {
          var rows = scope.querySelectorAll('[data-row-key]')
          var i
          var row
          var key
          for (i = 0; i < rows.length; i++) {
            row = rows[i]
            key = keyOf(row)
            if (key === null || key.indexOf(WORKSPACE_PREFIX) !== 0) continue
            if (key === WORKSPACE_PREFIX) continue
            if (row.textContent.replace(/^[ \t\r\n]+/, '').replace(/[ \t\r\n]+$/, '') !== WX_GROUP_LABEL) continue
            return row
          }
          return null
        }

        /* What gets hidden to take the 分组标题 off the list: the header row's own container.
           The live list wraps that row in a SPAN that holds exactly it, so hiding the wrapper
           hides the title and nothing else; a header hanging straight off its group (the
           Ungrouped shape) has the group as its parent and is returned as-is, and the caller
           only tags it when it is not the group itself. */
        function wxHeadBox(group, row) {
          var node = row
          while (node.parentElement !== null && node.parentElement !== group) node = node.parentElement
          return node
        }

        /* Three attributes in the shape the sheet reads: one on the tree, one on the group it
           found, one on the group's own header container. Nothing is inserted, moved or
           deleted: while the switch is off the group is out of the list with display: none,
           and while it is on every OTHER group is out of the list instead, so the list holds
           the 微信 conversations and nothing else. The group's own header is hidden with them,
           which is what leaves its Session titles showing bare.

           Every write is differenced: this pass runs from a MutationObserver and a write that
           happens unconditionally would schedule the next pass forever. */
        function wxView(host) {
          var group = wxGroup(host)
          if (group === null) {
            if (host.getAttribute(WX_TREE_ATTR) !== null) host.removeAttribute(WX_TREE_ATTR)
            var lost = host.querySelector('[' + HEAD_ATTR + ']')
            if (lost !== null) lost.removeAttribute(HEAD_ATTR)
            return
          }
          var head = wxHead(group)
          var box = head === null ? null : wxHeadBox(group, head)
          /* The header is hidden through the box that holds exactly it. A header hanging
             straight off its group has no such box, and then the row itself is tagged. */
          var target = box === null ? null : box === group ? head : box
          if (target !== null && target.getAttribute(HEAD_ATTR) !== 'on') target.setAttribute(HEAD_ATTR, 'on')
          if (group.getAttribute(GROUP_ATTR) !== 'on') group.setAttribute(GROUP_ATTR, 'on')
          var state = wxOn ? 'on' : 'off'
          if (host.getAttribute(WX_TREE_ATTR) !== state) host.setAttribute(WX_TREE_ATTR, state)
          /* A folded group renders no Session rows at all -- only its header -- and that
             header is hidden while the switch is on, so lighting the entry on a folded group
             would leave an empty list. Its own header click is the unfold, the same official
             control the user would press; it is pressed only while folded, so it cannot fight
             a fold the user makes twice. */
          if (wxOn && head !== null && head.getAttribute('aria-expanded') === 'false') head.click()
        }

        /* The switch itself. It flips the flag and lets one ordinary pass do the writing, so
           a press and a re-render take exactly the same path and cannot disagree. The scroll
           nudge that follows is the only scroll this side touches: the list can be scrolled
           deep when the switch is pressed, and a shorter list that keeps that offset would
           open on blank space. */
        function setWx(on) {
          wxOn = on
          paint()
          var host = tree()
          if (host !== null && wxOn && host.scrollTop !== 0) host.scrollTop = 0
        }

        /* One stable handler: what was pressed is this entry, and dispose can unhook it
           without having kept a closure per button. A bubble-phase stopPropagation keeps the
           host's own onClick out -- React delegates at #root, below document, the same
           measurement the brand row zones effect relies on. */
        function onWxToggle(event) {
          stop(event)
          setWx(!wxOn)
        }

        /* The button wears the official header icon-box contract the sheet sizes at 28x28,
           and its on state answers to its own switch rather than to a selected view. The name
           lives in aria-label only -- which is not drawn -- so hovering shows no wording in
           either state; a title left by an earlier build is taken off rather than left to pop
           up on hover. */
        function decorateWx(button) {
          var on = wxOn
          var text = label(on ? 'hidewx' : 'weixin')
          var state = on ? 'on' : 'off'
          if (button.getAttribute(BUTTON_ATTR) !== WX_ENTRY_ID) button.setAttribute(BUTTON_ATTR, WX_ENTRY_ID)
          if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text)
          if (button.getAttribute('title') !== null) button.removeAttribute('title')
          if (button.getAttribute(STATE_ATTR) !== state || button.firstElementChild === null) {
            button.setAttribute(STATE_ATTR, state)
            button.setAttribute('aria-pressed', on ? 'true' : 'false')
            button.innerHTML = ICON
          }
        }

        function create() {
          var button = document.createElement('button')
          button.type = 'button'
          button.setAttribute(BUTTON_ATTR, WX_ENTRY_ID)
          /* The row's own click opens its group and its mousedown starts a drag; neither
             belongs to this control. */
          button.addEventListener('mousedown', stop)
          button.addEventListener('pointerdown', stop)
          button.addEventListener('click', onWxToggle)
          return button
        }

        /* The search slot's own row, looked for inside the sidebar first and anywhere
           second: the slot NAME is a stable contract, its nesting is not -- so the scoped
           query is a shortcut and the document query is what still makes it correct. */
        function markerNode() {
          var slot = slotNode()
          if (slot !== null) {
            var near = slot.querySelector(MARK_SELECTOR)
            if (near !== null) return near
          }
          return document.querySelector(MARK_SELECTOR)
        }

        /* The entry, in the row's own document order: immediately before the search slot.
           Created only when missing, so a re-render that drops it puts it back.

           Round 60: the entry is in the row only while the channel holds an account. A button an
           earlier pass built comes out here when the account is unbound while the page is open,
           which is also what keeps the row's order -- the slot it occupied is simply empty again. */
        function entry() {
          var marker = markerNode()
          if (marker === null || marker.parentElement === null) return
          var host = marker.parentElement
          var existing = host.querySelector('[' + BUTTON_ATTR + "='" + WX_ENTRY_ID + "']")
          if (!wxLive) {
            if (existing !== null && existing.parentElement !== null) existing.parentElement.removeChild(existing)
            return
          }
          var slot = null
          for (var i = 0; i < host.children.length; i++) {
            if (host.children[i].querySelector('input') !== null) { slot = host.children[i]; break }
          }
          var button = existing
          if (button === null) {
            button = create()
            /* The node this entry has to sit before to keep the row's order: the search
               slot, whose own margin-left: auto keeps every official control where it was,
               right of the 工作区 label. */
            if (slot === null) host.appendChild(button)
            else host.insertBefore(button, slot)
          }
          decorateWx(button)
        }

        /* Round 60. What counts as a bound account is the plugin's own test, not this theme's
           invention: its settings page branches on status.accounts.length === 0 for 未连接
           (plugin client.js:1080 renders the empty-list hint on it and :1117 the disconnect
           block), so an accounts array with at least one record is exactly what turns that page
           from 未连接 into a connected account. Anything this build cannot read -- a non-object,
           a body without an accounts array, a JSON parse that failed -- is no answer rather than a
           negative one. A 404 (a renamed prefix) lands here too and is deliberately not treated
           as "no account": the plugin being unreadable is not the channel being unbound. */
        function holdsAccount(result) {
          if (result === null || typeof result !== 'object') return null
          var accounts = result.accounts
          if (!Array.isArray(accounts)) return null
          return accounts.length > 0
        }

        /* Only a real answer moves the entry, and only a CHANGED answer costs a pass: a probe
           that fails keeps the last word, so a hiccup in the route cannot take a live entry away.
           If the account goes while the switch is lit, the switch goes with it -- the tree would
           otherwise stay filtered with no entry left to press, so the official list is put back
           on the same path the switch's own off state takes. */
        function acceptStatus(answer) {
          if (disposed || typeof answer !== 'boolean' || answer === wxLive) return
          wxLive = answer
          if (!answer) wxOn = false
          schedule()
        }

        /* The one question this effect asks of another plugin, asked of the route that plugin's
           own settings half reads. A page that is not on screen is not asked: the answer cannot
           change the entry the user is looking at, and it keeps the timer free. */
        function refreshStatus() {
          if (disposed || statusPending) return
          if (typeof document !== 'undefined' && document.hidden === true) return
          if (typeof fetch !== 'function') return
          statusPending = true
          var pending = null
          try {
            pending = fetch(WX_STATUS_PATH, { cache: 'no-store', headers: { accept: 'application/json' } })
          } catch (error) { pending = null }
          if (pending === null || pending === undefined || typeof pending.then !== 'function') {
            statusPending = false
            return
          }
          pending.then(function (response) {
            if (response === null || response === undefined || response.ok !== true) return null
            return response.json()
          }).then(function (body) {
            statusPending = false
            acceptStatus(holdsAccount(body))
          }, function () {
            /* A refused request, a body that is not JSON: no answer, and the last word stands. */
            statusPending = false
          })
        }

        function onVisible() {
          if (typeof document !== 'undefined' && document.hidden === true) return
          refreshStatus()
        }

        function paint() {
          if (disposed) return
          entry()
          var host = tree()
          if (host === null) return
          wxView(host)
        }

        function dispose() {
          if (disposed) return
          disposed = true
          if (observer !== null && observer !== undefined) observer.disconnect()
          observer = null
          if (offSessions !== null && typeof offSessions === 'function') offSessions()
          offSessions = null
          if (offLocale !== null && typeof offLocale === 'function') offLocale()
          offLocale = null
          /* Round 60: stop asking about 微信, and stop listening for the two moments that would
             have asked again. A probe already in flight is left to settle into acceptStatus,
             which returns at once on the disposed flag. */
          if (statusTimer !== 0) clearInterval(statusTimer)
          statusTimer = 0
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisible)
          }
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('focus', refreshStatus)
          }
          var host = tree()
          if (host !== null && host.getAttribute(WX_TREE_ATTR) !== null) host.removeAttribute(WX_TREE_ATTR)
          if (host !== null) {
            var tagged = host.querySelector('[' + GROUP_ATTR + ']')
            if (tagged !== null) tagged.removeAttribute(GROUP_ATTR)
            var headTagged = host.querySelector('[' + HEAD_ATTR + ']')
            if (headTagged !== null) headTagged.removeAttribute(HEAD_ATTR)
          }
          var buttons = document.querySelectorAll('[' + BUTTON_ATTR + ']')
          for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i]
            button.removeEventListener('mousedown', stop)
            button.removeEventListener('pointerdown', stop)
            button.removeEventListener('click', onWxToggle)
            if (button.parentElement !== null) button.parentElement.removeChild(button)
          }
        }

        /* A new Session, a retitled one, a row React re-rendered: the pass has to run again.
           Only data-row-key is watched, exactly as the pin effect watches it -- class is
           rewritten on every render, the key moves only when the row does, and a filter on
           that attribute is also what keeps this effect's own data-eva-wx* writes from
           scheduling another pass.

           Round 47 (2026-10-11) -- WHICH batches reach the pass: the same rule the pin
           effect above already applies. Before this filter the pass ran for every childList
           batch in the document, so a streaming answer in the conversation pane paid for a
           sidebar walk. Measured on the 6563-element session page: 120 conversation-only
           mutations cost 601 queries inside the sidebar (markerNode, tree, entry's own
           input scan, wxHead's row walk) plus one textContent build per batch -- the same
           shape the round-1 fix removed from the status rail. A batch that provably misses
           the workspaces slot is not this pass's business: the pass reads no row outside
           it. Three things still schedule, and they are the whole of the rule -- a target
           inside the slot, a node added or removed CONTAINING it (React replacing the
           sidebar is the remount this watch exists for), and a remembered host that is no
           longer attached. */
        function touches(records) {
          var host = slotHost
          if (host === null || !host.isConnected) return true
          for (var i = 0; i < records.length; i++) {
            var record = records[i]
            var target = record.target
            if (target !== null && target !== undefined && (target === host || host.contains(target))) return true
            var bags = [record.addedNodes, record.removedNodes]
            for (var b = 0; b < bags.length; b++) {
              var bag = bags[b]
              if (bag === undefined || bag === null) continue
              for (var n = 0; n < bag.length; n++) {
                var node = bag[n]
                if (node === host || (typeof node.contains === 'function' && node.contains(host))) return true
              }
            }
          }
          return false
        }

        var observer = null
        if (document.body !== undefined && document.body !== null) {
          observer = new MutationObserver(function (records) {
            if (!touches(records)) return
            schedule()
          })
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-row-key'],
          })
        }
        var sessions = ctx.get('sessions')
        var list = sessions === undefined || sessions === null ? null : sessions.list
        var offSessions = null
        if (list !== undefined && list !== null && typeof list.subscribe === 'function') {
          try { offSessions = list.subscribe(schedule) } catch (error) { offSessions = null }
        }
        var offLocale = null
        if (locale !== undefined && locale !== null && typeof locale.subscribe === 'function') {
          try { offLocale = locale.subscribe(schedule) } catch (error) { offLocale = null }
        }
        /* Round 60: the 微信 question, asked once now and then on the interval above -- and again
           whenever the page comes back on screen or the window is focused, which is the moment
           the user has most likely just bound or unbound the account. All three are dropped again
           in dispose. Note that no pass runs until the first answer lands: paint() below draws the
           tree as the plugin has it, and the entry appears with the truthful answer rather than
           for a frame before it. */
        if (typeof setInterval === 'function') statusTimer = setInterval(refreshStatus, STATUS_INTERVAL)
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisible)
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('focus', refreshStatus)
        }
        refreshStatus()
        paint()

        return dispose
      }), 'evangelion: wechat workspace switch')

      /* Read-only surface for troubleshooting and for the delivery docs. */
      exports.manifest = MANIFEST
    }

    exports.name = PLUGIN_ID
    /* uiSession / sessions / workspaces are the three services the vendored
       session-status rail reads (its own exports.inject names the same three); naming
       them here is what makes the loader wait for them, so apply() cannot run against a
       context where they are still missing and throw. */
    exports.inject = ['theme', 'remote', 'locale', 'uiSession', 'sessions', 'workspaces']
    exports.apply = apply
    return module.exports
