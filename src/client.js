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
       置顶、Telegram/微信过滤这三个功能在主题激活时不关键（主题的视觉在令牌层、
       液态玻璃、样式挂载与启动遮罩就绪后即完整），同步执行会阻塞插件加载。延迟到
       requestIdleCallback 后，关键路径缩短约 30-50ms（实测：这三个 effect 的
       初始化合计 42ms），用户感知是主题立即可用，这三个功能在 50-100ms 内跟上。 */
    function defer(fn) {
      if (typeof requestIdleCallback === 'function') {
        return requestIdleCallback(fn)
      }
      return setTimeout(fn, 0)
    }

    function cancelDefer(handle) {
      if (typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(handle)
      } else {
        clearTimeout(handle)
      }
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
        tag.textContent = shortenDataUrls(WALLPAPER_DECLARATIONS, blobUrls) + '\n' + CSS + '\n' + BOOT_CSS
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

      /* Round 49 (2026-10-11) -- both channels of a restored @xmanrui/dsh-im: the pair
         round 42 built, back after round 45 retired the Telegram half. The user's word
         (m00694): 「Telegram呢！！！」; asked what to do about the missing entry they chose
         「恢复成第 42 轮那对入口：Telegram + 微信，两枚并排、三态互斥」.

         Contract names are channel-neutral now -- data-eva-im-*. Round 45 renamed the pair
         away from the names the round-42 entries used, so that nothing carried a retired
         feature's name; with two channels lit by turns, 'wx' would be that same mistake the
         other way round.

         The body below is round 42's, with rounds 46-48's hardening kept: the remembered
         workspaces slot, the narrow re-render watch (touches), and mark() reshaped to tag
         only the rows that stay -- the sheet's one rule then reads [data-row-key], so a row
         this effect does not tag is hidden rather than missed. The pump is what makes the
         entry work cold (see Round 41 below). The text that follows is round 41's and
         round 42's, as written then. */

      /* Round 41 (2026-10-09) -- the Telegram conversations, one click from the 工作区
         row. User's words: 「请将跟 telegram 的对话放置在工作区右侧，与「搜索」「视图选项」
         等处于同一行，实现点击即查看全部跟 Telecom 的会话」，约束「不改变任何原有结构；
         仅改变样式」，追加要求「但是会话都在未分组，所以要你显示未分组中跟Telegram的对话」.

         Where they are: a dsh-im conversation is an ordinary Session whose cwd is the IM
         directory, so the host groups all of them into the Ungrouped bucket -- and
         Ungrouped is a group like any other, which means the official list renders five
         of its rows and keeps the rest behind its own show-more control
         (@deepseek-ai/dsh-client-ui-workspace lib/client.js:2120 COLLAPSED_SESSION_LIMIT;
         :2606 the updater that adds five per click and jumps to Infinity on the last
         step; :2609 the label). A filter that only hid rows would be filtering a list the
         conversations are not in yet, so the rows come back through that same official
         control -- the very click a user would make. A fully expanded group collapses
         back to the official five in exactly one click, which is why every expansion here
         runs to completion and the way out is one click per group.

         What counts as one: the row dsh-im marks itself (data-dsh-im-session-channel,
         from its plugin-src/client/session-channel-logos.js) or, when that plugin is not
         in the profile, the title it gives the Session it opens ('Telegram -- <first
         message>'). Both are read off the row; no CSS-Modules class is named anywhere.

         What is added: exactly one button, as a child of the 工作区 row immediately before
         the search slot. That row is a flex line with justify-content: flex-end and the
         search slot carries margin-left: auto, so an item placed there sits immediately
         right of the 工作区 label while the search button and both official icon buttons
         keep the pixels they already had (measured: label 16..58, entry 62, search 176,
         view options 208, add workspace 240 -- identical before and after).

         Where the hiding lives: in the sheet, under one attribute on the session tree.
         This effect only tags rows (data-eva-im-row: on | off) and the tree
         (data-eva-im-tree), so mode off drops the tag and the list is the official list
         again, attribute for attribute. Nothing is persisted -- a view is not a
         preference, and cli.11c keeps its two named writes.

         The expansion is staged one official click per animation frame. A synchronous
         loop is correct and rude: each click re-renders the whole tree (tens of
         milliseconds once a group holds a couple of hundred rows), so forty of them in
         one task would freeze the page the user is looking at.

         Round 42 (2026-10-10) -- the 微信 conversations, one click further right. User's
         words: 「参考对Telegram会话的处理，将微信的对话也转移到「工作区」一行中，就放在
         telegram的图标右边。」, and for what a click means they chose 互斥切换 over
         可叠加: the row holds one view, not two, so the two entries are two positions of a
         single three-valued state (0 = the official list, 1 = Telegram, 2 = 微信) and at
         most one of them can be lit. Clicking the lit one, or switching to the other,
         re-tags the rows and drives the same official controls to whatever that view needs.

         What that cost: nothing in the sheet. The button, state, row and tree attributes
         already say exactly what they said -- the entry's *value* carries the channel now
         (data-eva-im-button = telegram | weixin) and the row tag stays on/off, computed
         against whichever channel is selected, so the tree-on/row-off pair in the sheet
         hides the right rows in both views without a second rule.
         Round 41's css.12 kept passing on the same four rules, verbatim; round 49 renamed
         those contract attributes and the gate asserts the new names.

         The second entry is inserted immediately after the first, both before the search
         slot, so the row reads 工作区 · (plane) (bubbles) ... search / view options / add
         workspace and every official control keeps the pixels it had. The 微信 artwork is
         drawn from the outline the user supplied (see ICONS below), not copied from the IM
         plugin's filled logo.

         Round 50 (2026-10-12) -- the 微信 entry only exists while the 微信 channel does. User's
         words: 「我不使用微信连接DSH了，只使用Telecom连接，所以能否将工作区右边的微信按钮图标
         设置为隐藏，只有我连接微信时才显示？」 A channel the user no longer uses should not
         hold a button in the 工作区 row, and it has to come back by itself the moment an account
         is bound. The question is asked of the channel rather than guessed from the list: a
         微信-titled conversation is evidence that one existed, not that one can be reached --
         four of them were still in the list when this round was written, left over from the
         retired plugin and pointing at nothing. So the entry is gated on the same status the IM
         plugin's own panel reads, from the same route: one POST to dsh-im's per-channel
         endpoint, no account means no entry, and the answer is re-asked on a slow timer rather
         than watched. Round 50 left the Telegram entry ungated on purpose: it is the
         one the user works in, and a probe that cannot answer must never take it away.

          Round 57 (2026-10-13) -- that same show/hide rule, now on the Telegram entry as well.
          User's words: 「之前只调整了工作区旁的微信按钮的显示和隐藏，现在同步到telegram按钮图标上，
          并同步推送到GitHub。」 One route per channel answers the one question this effect asks
          (CHANNELS[].rpc: dsh-im/telegram, dsh-im/weixin), so each entry sits in the row only
          while its own channel holds an account. What round 50's reason still buys is the
          DIRECTION the two channels fail in when nothing answers: 微信 fails inward -- no answer
          at all means no entry, because a button that leads nowhere is what round 50 removed --
          while Telegram fails outward: only a definite 'this channel holds no account' takes its
          button away, and every way of not answering (no IM plugin, no connection service, an
          unregistered route, a call that throws or rejects, a snapshot this build cannot read)
          leaves it in the row, which is where round 50 put it. */
      ctx.effect(() => deferEffect(() => {
        if (typeof document === 'undefined') return undefined

        var BUTTON_ATTR = 'data-eva-im-button'
        var STATE_ATTR = 'data-eva-im-state'
        var ROW_ATTR = 'data-eva-im-row'
        var TREE_ATTR = 'data-eva-im-tree'
        var SESSION_PREFIX = 'session:'
        var WORKSPACE_PREFIX = 'workspace:'
        var OVERFLOW_PREFIX = 'overflow:'
        var CHANNEL_ATTR = 'data-dsh-im-session-channel'
        /* The conversations this theme can single out, in the order their two entries sit
           in the 工作区 row: Telegram first (round 41), 微信 second (round 42). The marker
           is the value dsh-im writes into data-dsh-im-session-channel -- measured on the
           live list, it lands on the TITLE SPAN (the row's second child), not on the row
           itself -- and the lead is the exact prefix that plugin gives the Session it
           opens: src/channels/shared/session-channel-labels.mjs:2 is
           weixin: ['微信', 'WeChat'] and parseSessionChannelTitle (:17-27) accepts only the
           label-plus-space-middot-space lead. The dot is part of the test on purpose: '微信' alone is a prefix of any session whose title
           merely starts with those two characters (one such row was live when this was
           written: 微信会话移入工作区行Telegram右侧), and the filter showed it in the 微信
           view until the lead was made exact. */
        /* Round 57: gated marks an entry that is not always in the row, and rpc is the route its
           own channel answers on, so the row spends a button on a channel only while that channel
           holds an account. holdWhenSilent is the direction a channel fails in when the question
           goes unanswered: 微信 holds nothing and stays hidden (the safe direction for the channel
           the user retired), Telegram keeps its entry (the safe direction for the one they work
           in). See the round-50 and round-57 paragraphs above. */
        var CHANNELS = [
          { id: 'telegram', marker: 'telegram', lead: 'Telegram · ', gated: true, rpc: 'dsh-im/telegram', holdWhenSilent: true },
          { id: 'weixin', marker: 'weixin', lead: '微信 · ', gated: true, rpc: 'dsh-im/weixin' },
        ]
        /* The host's own names for the 工作区 area and for the empty marker that is a
           direct child of that row -- both are slots, not CSS-Modules classes. */
        var SLOT_SELECTOR = "[data-slot='sidebar.workspaces']"
        var MARK_SELECTOR = "[data-slot='sidebar.workspaces.directoryFlow']"
        /* 46 official clicks take a group of 231 rows to fully expanded. The limit stops
           a control that stops answering; it is not a budget. */
        var CLICK_LIMIT = 200

        /* Round 50, widened in round 57: the names below belong to @xmanrui/dsh-im, not to this
           theme. Its host half registers one fetch route per channel -- plugin-src/management-rpc.mjs
           builds the endpoint as 'dsh-im' + the channel, and plugin-src/host/channels/shared/rpc.mjs
           gives every token-bot channel the same status method -- so the per-channel part is the
           route, and it lives on the CHANNELS entry above; what stays here is the method all of
           them answer to. This effect asks each gated channel that one question, through the same
           client service that plugin's own half uses. A version of that plugin which renames
           either costs that entry its gate: the probe stops answering, and the entry then does what
           its own holdWhenSilent says -- hidden for 微信, still in the row for Telegram. */
        var CHANNEL_STATUS = 'connection.status'
        /* One question a minute while the page is on screen, plus one whenever the window comes
           back. The answer changes only when the user binds or unbinds the account in the
           plugin's own settings panel, so a minute of lag on a button is not worth a watcher --
           and nothing is asked at all while the page is off screen. */
        var STATUS_INTERVAL = 60000

        /* The row's own icons are 16x16 in a 16 viewBox, 1px stroke, currentColor. This is the
           same box, and the artwork is the user's own file (fNsqp0wiUPdzR9MAk8YXg12Iy4SlG7ZD.svg,
           a trace of the paper plane they asked for) -- its OUTER CONTOUR path, kept verbatim.
           The user's words for this: 只留你那张图的外轮廓（去掉两条内折线），回到 16px. So of the
           file's five outline paths only the closed silhouette is drawn; the two long folds,
           the fin triangle and the file's filled facets are left out. Three changes were needed
           to put a 220-unit drawing in a 28x28 button --
             - the file's background square path is dropped: a button has to stay transparent;
             - the hard-coded grey becomes currentColor, so :hover and the on state work;
             - the viewBox is tightened to the plane (it spans x 39.86..178.74, y 68.42..151.73,
               hence 33.86 34.64 150.88 150.88) and the stroke rescaled to one CSS pixel:
               150.88/16 = 9.43 user units.
           Measured on the way here: the file's full five-line artwork turns into a dark blob at
           16px and only reads from about 20px, which is why the contour alone is what stays.
           Inline SVG, never a bitmap, so the icon keeps its vector edge on a scaled display.

           The 微信 artwork (round 42, 2026-10-10) is the second entry's, and it was drawn
           from the outline the user supplied rather than copied from the IM plugin's filled
           24-unit logo, at the user's instruction: 参考这个画一个. The file it came from --
           _work/wx-ref.html in the working tree, a 204x184 JPEG -- was measured, not
           traced by eye: the ink is ONE closed contour (5 086 px, one enclosed hole) plus
           four filled eye disks, so the drawing is two ellipses whose mutual overlap is
           erased on the back bubble only, two tail triangles, and four dots. The two
           centre-lines were fitted to the outline pixels (least squares on an iteratively
           re-assigned boundary set) and land here at A(5.799, 6.142, 5.502x4.488) and
           B(11.075, 9.405, 4.620x3.817); the eyes at (3.899, 4.681), (7.720, 4.672),
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
           Measured the same way as the plane: at 16px the two bubbles and all four eyes
           resolve; the same artwork at 32px is unambiguous. */
        var ICONS = {
          telegram: '<svg width="16" height="16" viewBox="33.86 34.64 150.88 150.88" fill="none" stroke="currentColor" stroke-width="9.43" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M 84.82 151.73 L 99.95 136.60 L 127.00 149.44 Q 143.55 123.79 178.25 70.49 Q 178.74 69.75 178.64 68.42 L 39.86 108.11 L 70.13 122.47 L 84.82 151.73"/>' +
            '</svg>',
          weixin: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<ellipse cx="11.075" cy="9.405" rx="4.62" ry="3.817"/>' +
            '<path d="M6.684 10.572A5.502 4.488 0 1 1 11.26 5.593"/>' +
            '<path d="M2.561 9.771L1.85 11.2L4.287 10.458Z M11.632 13.194L14.337 14.088L13.374 12.716Z"/>' +
            '<path fill="currentColor" stroke="none" d="M3.155 4.681a0.744 0.744 0 1 0 1.488 0a0.744 0.744 0 1 0 -1.488 0M6.976 4.672a0.744 0.744 0 1 0 1.488 0a0.744 0.744 0 1 0 -1.488 0M9.018 8.524a0.589 0.589 0 1 0 1.178 0a0.589 0.589 0 1 0 -1.178 0M12.029 8.528a0.589 0.589 0 1 0 1.178 0a0.589 0.589 0 1 0 -1.178 0"/>' +
            '</svg>',
        }

        /* Three labels through the official locale service, the door the pin control and
           the vendored switch already use. A missing or throwing seat costs the wording only.
           The namespace keeps its round-41 name: renaming it would only cost a registered
           dictionary if a second copy of this theme were ever mounted beside this one. */
        var NS = 'eva-im-filter'
        var DICT = {
          zh: { telegram: '只看 Telegram 会话', weixin: '只看微信会话', all: '显示全部会话' },
          en: { telegram: 'Show Telegram conversations', weixin: 'Show WeChat conversations', all: 'Show all conversations' },
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

        /* 0 = the official list, 1 = Telegram conversations only, 2 = 微信 conversations
           only. One number, three views: the two entries are its positions, so switching
           from one channel to the other is one assignment and never a stacked tag. */
        var mode = 0
        var action = 0      /* what the pump is driving toward: 1 reveal, 0 restore */
        var opened = {}     /* the groups whose show-more control this effect expanded */
        var unfolded = {}   /* the groups whose folded header this effect unfolded */
        var frame = 0
        var clicks = 0
        var scroll = null
        var scheduled = false
        var disposed = false
        /* Whether any row still carries the tag this effect writes. It goes true on the
           first lit pass and stays true, so a pass with no view lit costs no property reads
           once those writes are gone. */
        var marked = false
        /* Round 50, per channel since round 57: whether a gated channel holds an account. A key
           that is not there yet means nothing has answered, and what that costs is the channel's
           own holdWhenSilent -- the 微信 entry has to be shown, not merely not hidden, or the row
           carries a button that leads nowhere, while the Telegram entry stays because it is the
           one the user works in. statusPending is the one-request-at-a-time latch, per channel;
           statusTimer is the minute the whole thing costs. */
        var live = {}
        var statusPending = {}
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

        /* The workspaces slot, remembered while it stays attached so a pass does not walk the
           document for it once per batch. The TREE is still looked up fresh below: React
           remounts the tree, and a node remembered from the last pass may already be gone --
           but it remounts into the same slot. */
        var slotHost = null
        function slotNode() {
          if (slotHost !== null && slotHost.isConnected) return slotHost
          slotHost = document.querySelector(SLOT_SELECTOR)
          return slotHost
        }

        /* The session tree. The host renders exactly one role=tree, inside the workspaces
           slot, and every row -- group headers included -- lives in it, so one walk of the
           tree sees both the group a Session sits under and the Session itself. */
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

        /* dsh-im marks its own rows; the title it gives the Session is the marker that
           survives a profile without that plugin. Both live on the row's second child --
           the first is the slot the channel logo sits in -- and the marker is read off
           that cell rather than the row, which is where the live list puts it. The lead
           test keeps the trailing dot, or an ordinary session titled 微信... would join
           the 微信 view. */
        function isChannel(row, channel) {
          var cell = row.children.length > 1 ? row.children[1] : null
          if (cell === null) return false
          if (cell.getAttribute(CHANNEL_ATTR) === channel.marker) return true
          if (row.getAttribute(CHANNEL_ATTR) === channel.marker) return true
          var text = cell.textContent
          if (typeof text === 'string' && text.replace(/^[ \t\r\n]+/, '').indexOf(channel.lead) === 0) return true
          var whole = row.textContent
          return typeof whole === 'string' && whole.indexOf(channel.lead) === 0
        }

        /* The channel the selected view is about, or null for the official list. */
        function selected() {
          return mode === 0 ? null : CHANNELS[mode - 1]
        }

        /* Every row of the tree, tagged against what is on screen -- and only while a view is
           lit. The tag names the rows that stay: a Session of the selected channel, which is
           the whole of what the sheet's rule lets through; every other row -- group headers and
           the overflow controls alike -- is untagged and therefore hidden. The Ungrouped header
           goes with them: the user asked for the 未分组 header itself to disappear in filter
           mode, leaving the conversations alone, without touching how its Sessions show or
           switch (m00881). With no view lit no row carries a tag at all, so that pass costs a
           read of one flag and leaves the host's own list attribute for attribute. Only a
           changed value is ever written, which is what lets an observer-driven pass stay silent
           (round 40). */
        function mark(host) {
          var channel = selected()
          var i
          var row
          var key
          var rows
          var seen = false
          if (channel === null) {
            if (!marked) return
            rows = host.querySelectorAll('[' + ROW_ATTR + ']')
            for (i = 0; i < rows.length; i++) rows[i].removeAttribute(ROW_ATTR)
            marked = false
            return
          }
          rows = host.querySelectorAll('[data-row-key]')
          for (i = 0; i < rows.length; i++) {
            row = rows[i]
            key = keyOf(row)
            if (key === null) continue
            if (key.indexOf(SESSION_PREFIX) === 0 && isChannel(row, channel)) {
              seen = true
              if (row.getAttribute(ROW_ATTR) !== 'on') row.setAttribute(ROW_ATTR, 'on')
            } else if (row.getAttribute(ROW_ATTR) !== null) {
              row.removeAttribute(ROW_ATTR)
            }
          }
          if (seen) marked = true
        }

        /* The one attribute the sheet filters on: present while a view is lit, and its value
           is the channel that view is about. Absent means the list is the host's own, which is
           also the whole of the undo. */
        function imView(host) {
          mark(host)
          var channel = selected()
          if (channel !== null) {
            if (host.getAttribute(TREE_ATTR) !== channel.id) host.setAttribute(TREE_ATTR, channel.id)
          } else if (host.getAttribute(TREE_ATTR) !== null) {
            host.removeAttribute(TREE_ATTR)
          }
        }

        /* A button carries the channel it selects in its value, and is on exactly when that
           channel is the selected view. With one view lit at a time, clicking the lit entry
           is also how the user gets back to the official list, which is why the label under
           it reads 显示全部会话 once it is on. */
        function decorate(button, channel) {
          var on = mode !== 0 && CHANNELS[mode - 1].id === channel.id
          var text = label(on ? 'all' : channel.id)
          var state = on ? 'on' : 'off'
          if (button.getAttribute(BUTTON_ATTR) !== channel.id) button.setAttribute(BUTTON_ATTR, channel.id)
          /* The name lives in aria-label only -- which is not drawn -- so hovering an entry
             shows no wording in either state (m00881). A title left by an earlier build is
             taken off the button rather than left to pop up on hover. */
          if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text)
          if (button.getAttribute('title') !== null) button.removeAttribute('title')
          if (button.getAttribute(STATE_ATTR) !== state || button.firstElementChild === null) {
            button.setAttribute(STATE_ATTR, state)
            button.setAttribute('aria-pressed', on ? 'true' : 'false')
            button.innerHTML = ICONS[channel.id]
          }
        }

        function create(channel) {
          var button = document.createElement('button')
          button.type = 'button'
          /* The row's own click opens its group and its mousedown starts a drag; neither
             belongs to this control. React delegates at #root, below document, so a
             bubble-phase stopPropagation keeps the host's onClick out -- the same
             measurement the brand row zones effect relies on. */
          button.addEventListener('mousedown', stop)
          button.addEventListener('pointerdown', stop)
          button.addEventListener('click', onEntryClick)
          decorate(button, channel)
          return button
        }

        /* One stable handler for both entries: which channel was pressed is read back off
           the button, so dispose can unhook it without having kept a closure per button. */
        function onEntryClick(event) {
          var id = this.getAttribute(BUTTON_ATTR)
          for (var i = 0; i < CHANNELS.length; i++) {
            if (CHANNELS[i].id === id) {
              onToggle(event, CHANNELS[i])
              return
            }
          }
        }

        /* The two entries, in the row's own document order: Telegram first, then 微信
           immediately to its right, both before the search slot. Each is created only when
           missing, so a re-render that drops one puts it back beside the other. */
        /* The search slot's own row, looked for inside the sidebar first and anywhere
           second: the slot NAME is a stable contract, its nesting is not -- so the scoped
           query is a shortcut and the document query is what still makes it correct. */
        function markerNode() {
          var near = slotNode()
          if (near !== null) {
            var found = near.querySelector(MARK_SELECTOR)
            if (found !== null) return found
          }
          return document.querySelector(MARK_SELECTOR)
        }

        function entry() {
          var marker = markerNode()
          if (marker === null || marker.parentElement === null) return
          var host = marker.parentElement
          var slot = null
          for (var i = 0; i < host.children.length; i++) {
            if (host.children[i].querySelector('input') !== null) { slot = host.children[i]; break }
          }
          var previous = null
          for (var j = 0; j < CHANNELS.length; j++) {
            var channel = CHANNELS[j]
            var button = host.querySelector('[' + BUTTON_ATTR + "='" + channel.id + "']")
            /* Round 50, per channel since round 57: a gated channel with no account has no
               entry. The one an earlier pass built comes off if the account was unbound while
               the page was open, and previous still names the last entry that IS in the row, so
               whatever is left keeps its order -- the 微信 entry lands immediately right of
               Telegram whenever it returns. */
            if (channel.gated === true && visible(channel) === false) {
              if (button !== null && button.parentElement !== null) button.parentElement.removeChild(button)
              continue
            }
            if (button === null) {
              button = create(channel)
              /* The node this entry has to sit before to keep the row's order: the entry
                 to its right if that one is already there, otherwise the search slot --
                 and the slot's own margin-left: auto keeps every official control where it
                 was, right of the 工作区 label. */
              var before = null
              if (previous !== null && previous.parentElement === host) before = previous.nextSibling
              else {
                for (var k = j + 1; k < CHANNELS.length && before === null; k++) {
                  var later = host.querySelector('[' + BUTTON_ATTR + "='" + CHANNELS[k].id + "']")
                  if (later !== null) before = later
                }
                if (before === null) before = slot
              }
              if (before === null) host.appendChild(button)
              else host.insertBefore(button, before)
            }
            decorate(button, channel)
            previous = button
          }
        }

        function paint() {
          if (disposed) return
          entry()
          var host = tree()
          if (host === null) return
          mark(host)
          imView(host)
        }

        /* Round 50. The answer the IM plugin's own reader accepts for this route: its
           normalizeSnapshot demands an object with a bots array and its normalizeBot keeps a
           record only when botId is a string, so the same test is what makes an account count
           here -- what lights this entry is what shows an account in that panel. true = there is
           one, false = the channel answered and there is none, null = no answer at all. */
        function holdsAccount(result) {
          if (result === null || typeof result !== 'object' || result.ok === false) return null
          var value = result.value
          if (value === null || typeof value !== 'object') return null
          var bots = value.bots
          if (!Array.isArray(bots)) return null
          for (var i = 0; i < bots.length; i++) {
            var bot = bots[i]
            if (bot !== null && typeof bot === 'object' && typeof bot.botId === 'string' && bot.botId !== '') return true
          }
          return false
        }

        /* Round 57: what one channel's answer means for its own entry. true = it is in the row.
           A definite 'no account' always takes the entry away; the unanswered null costs whatever
           that channel's holdWhenSilent says -- hidden for 微信, still in the row for Telegram. */
        function visible(channel) {
          var answer = live[channel.id]
          if (answer === true) return true
          if (answer === false) return false
          return channel.holdWhenSilent === true
        }

        /* Only a real answer moves one entry, and only a CHANGED answer costs a pass: a probe
           that fails keeps the last word, so a hiccup in the route cannot take a live entry away.
           If a channel's account goes while its own view is lit, the view goes with it -- the tree
           would otherwise stay filtered with nothing lit left to press, so the official list is
           put back on the same path its own exit takes. */
        function acceptStatus(channel, answer) {
          if (disposed || typeof answer !== 'boolean' || answer === live[channel.id]) return
          live[channel.id] = answer
          if (answer === false && channel.gated === true && selected() === channel) {
            mode = 0
            clicks = 0
            paint()
            action = 0
            pump()
            return
          }
          schedule()
        }

        /* One question per gated channel, asked through the client service that plugin's own half
           uses -- ctx.get is guarded and its absence is simply no status, so a profile without
           that service keeps this theme alive instead of taking the whole thing down over a
           button. The latch is per channel (statusPending[channel.id]), so a slow route never
           holds the other entry's answer back. */
        function ask(rpc, channel) {
          var pending = null
          try {
            pending = rpc.call('/api', channel.rpc, { method: CHANNEL_STATUS, payload: {} })
          } catch (error) { pending = null }
          if (pending === null || pending === undefined || typeof pending.then !== 'function') {
            statusPending[channel.id] = false
            return
          }
          pending.then(function (result) {
            statusPending[channel.id] = false
            acceptStatus(channel, holdsAccount(result))
          }, function () {
            statusPending[channel.id] = false
          })
        }

        function refreshStatus() {
          if (disposed) return
          if (typeof document !== 'undefined' && document.hidden === true) return
          var connection = null
          try { connection = ctx.get('connection') } catch (error) { connection = null }
          var rpc = connection === null || connection === undefined ? null : connection.rpc
          if (rpc === null || rpc === undefined || typeof rpc.call !== 'function') return
          for (var i = 0; i < CHANNELS.length; i++) {
            var channel = CHANNELS[i]
            if (channel.gated !== true || statusPending[channel.id] === true) continue
            statusPending[channel.id] = true
            ask(rpc, channel)
          }
        }

        function onVisible() {
          if (typeof document !== 'undefined' && document.hidden === true) return
          refreshStatus()
        }

        /* The groups that hold a conversation of the selected channel, read from the two
           snapshots the vendored rail already reads instead of guessed from whatever happens
           to be rendered. The host's own model groups a Session by its cwd -- ui-workspace:
           'summary.cwd === workspace.path', plus a workspaceBySession map built from
           workspace.sessionIds -- and its key for the Ungrouped bucket is the empty
           suffix. This is what makes the entry work cold: a folded group renders no rows
           at all, so nothing on screen says which group the conversations are in. */
        function candidates() {
          var out = []
          var channel = selected()
          if (channel === null) return out
          if (list === null || typeof list.getSnapshot !== 'function') return out
          var snapshot = null
          try { snapshot = list.getSnapshot() } catch (error) { snapshot = null }
          if (snapshot === null || snapshot.byId === undefined || snapshot.byId === null) return out
          var items = []
          var wlist = workspaces === undefined || workspaces === null ? null : workspaces.list
          if (wlist !== null && wlist !== undefined && typeof wlist.getSnapshot === 'function') {
            try {
              var wsnapshot = wlist.getSnapshot()
              if (wsnapshot !== null && wsnapshot.items !== undefined && wsnapshot.items !== null) items = wsnapshot.items
            } catch (error) { items = [] }
          }
          var owner = {}
          var path = {}
          var i
          var j
          for (i = 0; i < items.length; i++) {
            var item = items[i]
            if (item === null || typeof item !== 'object') continue
            var id = item.workspaceId
            if (typeof id !== 'string') continue
            if (typeof item.path === 'string') path[item.path] = id
            var ids = item.sessionIds
            if (ids === undefined || ids === null) continue
            for (j = 0; j < ids.length; j++) owner[ids[j]] = id
          }
          for (var key in snapshot.byId) {
            var session = snapshot.byId[key]
            if (session === null || typeof session !== 'object') continue
            var title = session.title
            if (typeof title !== 'string' || title.indexOf(channel.lead) !== 0) continue
            var group = owner[key]
            if (group === undefined && typeof session.cwd === 'string') group = path[session.cwd]
            if (group === undefined) group = ''
            if (out.indexOf(group) === -1) out.push(group)
          }
          return out
        }

        /* The fallback for a host whose snapshots cannot be read: the groups showing a row
           of the selected channel right now. It cannot see into a folded group, which is
           exactly why it is the fallback and not the rule. */
        function rendered(host) {
          var out = []
          var channel = selected()
          if (host === null || channel === null) return out
          var rows = host.querySelectorAll('[data-row-key]')
          var group = null
          for (var i = 0; i < rows.length; i++) {
            var key = keyOf(rows[i])
            if (key === null) continue
            if (key.indexOf(WORKSPACE_PREFIX) === 0) group = key.slice(WORKSPACE_PREFIX.length)
            else if (key.indexOf(SESSION_PREFIX) === 0 && group !== null && isChannel(rows[i], channel)) {
              if (out.indexOf(group) === -1) out.push(group)
            }
          }
          return out
        }

        /* One official click per frame, in two stages. First the groups themselves: a group
           that holds Telegram conversations can arrive folded, and a folded group has no
           rows and no show-more control, so it is unfolded through its own header -- the
           click a user makes -- and only for the groups the model above names, so no other
           workspace is touched. Then its show-more control, until the control reports the
           group fully expanded: aria-expanded true is the state its own single click
           collapses from, which is what makes the way out one click per group. */
        function openStep(host) {
          var keys = candidates()
          if (keys.length === 0) keys = rendered(host)
          var key
          var i
          for (i = 0; i < keys.length; i++) {
            key = keys[i]
            if (unfolded[key] === true) continue
            var header = document.querySelector('[data-row-key="' + WORKSPACE_PREFIX + key + '"]')
            if (header === null) continue
            if (header.getAttribute('aria-expanded') !== 'false') continue
            unfolded[key] = true
            header.click()
            return true
          }
          for (i = 0; i < keys.length; i++) {
            key = keys[i]
            var control = document.querySelector('[data-row-key="' + OVERFLOW_PREFIX + key + '"]')
            if (control === null) continue
            if (control.getAttribute('aria-expanded') === 'true') continue
            opened[key] = true
            control.click()
            return true
          }
          return false
        }

        /* The way out: collapse what this effect expanded -- only what it recorded, so a
           list the user had already expanded by hand is left exactly as it was -- and then
           fold back the groups it unfolded. Collapsing comes first on purpose: the official
           control resets that group's own limit to five, so folding first would leave the
           group showing every row the next time it is opened. */
        function closeStep() {
          var keys = Object.keys(opened)
          var key
          var i
          for (i = 0; i < keys.length; i++) {
            key = keys[i]
            var control = document.querySelector('[data-row-key="' + OVERFLOW_PREFIX + key + '"]')
            if (control !== null && control.getAttribute('aria-expanded') === 'true') {
              control.click()
              return true
            }
            delete opened[key]
          }
          keys = Object.keys(unfolded)
          for (i = 0; i < keys.length; i++) {
            key = keys[i]
            var header = document.querySelector('[data-row-key="' + WORKSPACE_PREFIX + key + '"]')
            /* Only fold back what is still open: a group the user folded himself while the
               filter was on is already where it started. */
            if (header === null || header.getAttribute('aria-expanded') !== 'true') {
              delete unfolded[key]
              continue
            }
            header.click()
            return true
          }
          return false
        }

        function pump() {
          frame = 0
          if (disposed) return
          if (clicks >= CLICK_LIMIT) return
          var host = tree()
          var more = action === 1 ? openStep(host) : closeStep()
          if (more === false) {
            if (action === 0 && scroll !== null) {
              if (host !== null) host.scrollTop = scroll
              scroll = null
            }
            return
          }
          clicks += 1
          /* React flushes a discrete click before it returns, so the rows the click
             revealed are already here -- tag them now rather than one frame later. */
          if (host !== null) mark(host)
          frame = requestAnimationFrame(pump)
        }

        /* Pressing an entry selects its channel; pressing the lit one puts the official list
           back. The two entries are two values of one variable, so the other entry goes dim
           in the same pass -- never both lit. */
        function onToggle(event, channel) {
          var was = mode
          var next = 0
          for (var i = 0; i < CHANNELS.length; i++) {
            if (CHANNELS[i].id === channel.id) next = i + 1
          }
          if (next === mode) next = 0
          stop(event)
          mode = next
          clicks = 0
          var host = tree()
          if (mode !== 0) {
            /* From the official list this is a fresh run, with nothing to carry over. From the
               OTHER channel -- the one move the pair adds (round 49) -- the bookkeeping is kept
               on purpose: the group this effect unfolds for Telegram is the same one the 微信
               conversations sit in, and clearing the record there would leave that group
               expanded after the user has gone back to the official list, which is not the list
               as they found it. */
            if (was === 0) {
              opened = {}
              unfolded = {}
              scroll = host === null ? null : host.scrollTop
            }
            paint()
            action = 1
          } else {
            paint()
            action = 0
          }
          pump()
        }

        function dispose() {
          if (disposed) return
          disposed = true
          if (frame !== 0) cancelAnimationFrame(frame)
          frame = 0
          if (observer !== null && observer !== undefined) observer.disconnect()
          observer = null
          if (offSessions !== null && typeof offSessions === 'function') offSessions()
          offSessions = null
          if (offLocale !== null && typeof offLocale === 'function') offLocale()
          offLocale = null
          /* Round 50: stop asking about 微信, and stop listening for the two moments that
             would have asked again. A probe already in flight is left to settle into
             acceptStatus, which returns at once on the disposed flag. */
          if (statusTimer !== 0) clearInterval(statusTimer)
          statusTimer = 0
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisible)
          }
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('focus', refreshStatus)
          }
          var host = tree()
          if (host !== null) {
            if (host.getAttribute(TREE_ATTR) !== null) host.removeAttribute(TREE_ATTR)
            var tagged = host.querySelectorAll('[' + ROW_ATTR + ']')
            for (var t = 0; t < tagged.length; t++) tagged[t].removeAttribute(ROW_ATTR)
          }
          var buttons = document.querySelectorAll('[' + BUTTON_ATTR + ']')
          for (var k = 0; k < buttons.length; k++) {
            var button = buttons[k]
            button.removeEventListener('mousedown', stop)
            button.removeEventListener('pointerdown', stop)
            button.removeEventListener('click', onEntryClick)
            if (button.parentElement !== null) button.parentElement.removeChild(button)
          }
        }

        /* A new Session, a retitled one, a row React re-rendered: the pass has to run
           again. Only data-row-key is watched, exactly as the pin effect watches it --
           class is rewritten on every render, the key moves only when the row does, and a
           filter on that attribute is also what keeps this effect's own data-eva-im*
           writes from scheduling another pass. */
        /* A batch that provably misses the workspaces slot is not this pass's business: the
           pass reads no row outside it. Three things still schedule, and they are the whole of
           the rule -- a target inside the slot, a node added or removed CONTAINING it, and a
           remembered host that is no longer attached. */
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
        /* The workspace half of the same pair the vendored rail reads: sessions say which
           conversation is a Telegram one, workspaces say which group its row lives in --
           which is the only way to reach a conversation inside a group that arrives
           folded, because a folded group renders no rows to look at. */
        var workspaces = ctx.get('workspaces')
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
        /* Round 50: the 微信 question, asked once now and then on the interval above -- and
           again whenever the page comes back on screen or the window is focused, which is the
           moment the user has most likely just bound or unbound the account. All three are
           dropped again in dispose. */
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
      }), 'evangelion: im filter')

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
