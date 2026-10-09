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

        var queued = false
        var mounts = typeof MutationObserver === 'function' ? new MutationObserver(function () {
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
      ctx.effect(() => {
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

        /* The settings command by its other door: the shortcut the launcher button
           itself advertises (Control+Alt+,). */
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
      }, 'evangelion: brand row zones')

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
      ctx.effect(() => {
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

        function paint() {
          if (disposed) return
          var rows = document.querySelectorAll(ROW_SELECTOR)
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
          if (moves.length === 0) return
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

        /* Only the row key is watched for attributes: React rewrites class on every
           render, while data-row-key moves only when the row does -- and that filter is
           also what keeps this effect's own data-eva-ws-pin* writes from scheduling
           another pass. childList has to stay on for the button to survive React
           (round-39 note above), and a filter cannot narrow it, so the pass itself is
           what must be silent when nothing changed -- see decorate(). */
        var observer = new MutationObserver(schedule)
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
      }, 'evangelion: workspace pins')

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
         This effect only tags rows (data-eva-tg-row: on | off) and the tree
         (data-eva-tg-tree), so mode off drops the tag and the list is the official list
         again, attribute for attribute. Nothing is persisted -- a view is not a
         preference, and cli.11c keeps its two named writes.

         The expansion is staged one official click per animation frame. A synchronous
         loop is correct and rude: each click re-renders the whole tree (tens of
         milliseconds once a group holds a couple of hundred rows), so forty of them in
         one task would freeze the page the user is looking at. */
      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined

        var BUTTON_ATTR = 'data-eva-tg-button'
        var STATE_ATTR = 'data-eva-tg-state'
        var ROW_ATTR = 'data-eva-tg-row'
        var TREE_ATTR = 'data-eva-tg-tree'
        var SESSION_PREFIX = 'session:'
        var WORKSPACE_PREFIX = 'workspace:'
        var OVERFLOW_PREFIX = 'overflow:'
        var CHANNEL_ATTR = 'data-dsh-im-session-channel'
        var CHANNEL = 'telegram'
        var TITLE_PREFIX = 'Telegram'
        /* The host's own names for the 工作区 area and for the empty marker that is a
           direct child of that row -- both are slots, not CSS-Modules classes. */
        var SLOT_SELECTOR = "[data-slot='sidebar.workspaces']"
        var MARK_SELECTOR = "[data-slot='sidebar.workspaces.directoryFlow']"
        /* 46 official clicks take a group of 231 rows to fully expanded. The limit stops
           a control that stops answering; it is not a budget. */
        var CLICK_LIMIT = 200

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
           Inline SVG, never a bitmap, so the icon keeps its vector edge on a scaled display. */
        var ICON = '<svg width="16" height="16" viewBox="33.86 34.64 150.88 150.88" fill="none" stroke="currentColor" stroke-width="9.43" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M 84.82 151.73 L 99.95 136.60 L 127.00 149.44 Q 143.55 123.79 178.25 70.49 Q 178.74 69.75 178.64 68.42 L 39.86 108.11 L 70.13 122.47 L 84.82 151.73"/>' +
          '</svg>'

        /* Two labels through the official locale service, the door the pin control and the
           vendored switch already use. A missing or throwing seat costs the wording only. */
        var NS = 'eva-telegram-filter'
        var DICT = {
          zh: { telegram: '只看 Telegram 会话', all: '显示全部会话' },
          en: { telegram: 'Show Telegram conversations', all: 'Show all conversations' },
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

        var mode = 0        /* 0 = the official list, 1 = Telegram conversations only */
        var action = 0      /* what the pump is driving toward: 1 reveal, 0 restore */
        var opened = {}     /* the groups whose show-more control this effect expanded */
        var unfolded = {}   /* the groups whose folded header this effect unfolded */
        var frame = 0
        var clicks = 0
        var scroll = null
        var scheduled = false
        var disposed = false

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

        /* The session tree. The host renders exactly one role=tree, inside the workspaces
           slot, and every row -- group headers included -- lives in it, so one walk of the
           tree sees both the group a Session sits under and the Session itself. */
        function tree() {
          var slot = document.querySelector(SLOT_SELECTOR)
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
           survives a profile without that plugin. The title cell is the row's second
           child in every render -- the first is the slot the channel logo sits in. */
        function isTelegram(row) {
          if (row.getAttribute(CHANNEL_ATTR) === CHANNEL) return true
          var cell = row.children.length > 1 ? row.children[1] : null
          if (cell === null) return false
          var text = cell.textContent
          if (typeof text !== 'string') return false
          return text.replace(/^[ \t\r\n]+/, '').indexOf(TITLE_PREFIX) === 0
        }

        /* Tag every row for the sheet: a Session row says whether it is a Telegram
           conversation, and every other row -- group headers and the overflow controls
           alike -- is off. The Ungrouped header goes off with them: the user asked for the
           未分组 header itself to disappear in filter mode, leaving the conversations alone,
           without touching how its Sessions show or switch (m00881). Only a changed value
           is written: an observer-driven pass has to be silent when nothing changed
           (round 40). */
        function mark(host) {
          var list = host.querySelectorAll('[data-row-key]')
          var i
          var row
          var key
          for (i = 0; i < list.length; i++) {
            row = list[i]
            key = keyOf(row)
            if (key === null) continue
            var state = key.indexOf(SESSION_PREFIX) === 0 && isTelegram(row) ? 'on' : 'off'
            if (row.getAttribute(ROW_ATTR) !== state) row.setAttribute(ROW_ATTR, state)
          }
        }

        /* The one attribute the sheet filters on. Absent means the list is the host's. */
        function view(host) {
          if (mode === 1) {
            if (host.getAttribute(TREE_ATTR) !== 'on') host.setAttribute(TREE_ATTR, 'on')
            return
          }
          if (host.getAttribute(TREE_ATTR) !== null) host.removeAttribute(TREE_ATTR)
        }

        function decorate(button) {
          var text = label(mode === 1 ? 'all' : 'telegram')
          var state = mode === 1 ? 'on' : 'off'
          if (button.getAttribute(BUTTON_ATTR) !== CHANNEL) button.setAttribute(BUTTON_ATTR, CHANNEL)
          /* The name lives in aria-label only -- which is not drawn -- so hovering the entry
             shows no wording in either state (m00881). A title left by an earlier build is
             taken off the button rather than left to pop up on hover. */
          if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text)
          if (button.getAttribute('title') !== null) button.removeAttribute('title')
          if (button.getAttribute(STATE_ATTR) !== state || button.firstElementChild === null) {
            button.setAttribute(STATE_ATTR, state)
            button.setAttribute('aria-pressed', mode === 1 ? 'true' : 'false')
            button.innerHTML = ICON
          }
        }

        function create() {
          var button = document.createElement('button')
          button.type = 'button'
          /* The row's own click opens its group and its mousedown starts a drag; neither
             belongs to this control. React delegates at #root, below document, so a
             bubble-phase stopPropagation keeps the host's onClick out -- the same
             measurement the brand row zones effect relies on. */
          button.addEventListener('mousedown', stop)
          button.addEventListener('pointerdown', stop)
          button.addEventListener('click', onToggle)
          decorate(button)
          return button
        }

        function entry() {
          var marker = document.querySelector(MARK_SELECTOR)
          if (marker === null || marker.parentElement === null) return
          var host = marker.parentElement
          var button = host.querySelector('[' + BUTTON_ATTR + ']')
          if (button === null) {
            button = create()
            var slot = null
            for (var i = 0; i < host.children.length; i++) {
              if (host.children[i].querySelector('input') !== null) { slot = host.children[i]; break }
            }
            /* Immediately before the search slot: right of the 工作区 label, and the
               slot's own margin-left: auto keeps every official control where it was. */
            if (slot === null) host.appendChild(button)
            else host.insertBefore(button, slot)
          }
          decorate(button)
        }

        function paint() {
          if (disposed) return
          entry()
          var host = tree()
          if (host === null) return
          mark(host)
          view(host)
        }

        /* The groups that hold a Telegram conversation, read from the two snapshots the
           vendored rail already reads instead of guessed from whatever happens to be
           rendered. The host's own model groups a Session by its cwd -- ui-workspace:
           'summary.cwd === workspace.path', plus a workspaceBySession map built from
           workspace.sessionIds -- and its key for the Ungrouped bucket is the empty
           suffix. This is what makes the entry work cold: a folded group renders no rows
           at all, so nothing on screen says which group the conversations are in. */
        function candidates() {
          var out = []
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
            if (typeof title !== 'string' || title.indexOf(TITLE_PREFIX) !== 0) continue
            var group = owner[key]
            if (group === undefined && typeof session.cwd === 'string') group = path[session.cwd]
            if (group === undefined) group = ''
            if (out.indexOf(group) === -1) out.push(group)
          }
          return out
        }

        /* The fallback for a host whose snapshots cannot be read: the groups showing a
           Telegram row right now. It cannot see into a folded group, which is exactly why
           it is the fallback and not the rule. */
        function rendered(host) {
          var out = []
          if (host === null) return out
          var rows = host.querySelectorAll('[data-row-key]')
          var group = null
          for (var i = 0; i < rows.length; i++) {
            var key = keyOf(rows[i])
            if (key === null) continue
            if (key.indexOf(WORKSPACE_PREFIX) === 0) group = key.slice(WORKSPACE_PREFIX.length)
            else if (key.indexOf(SESSION_PREFIX) === 0 && group !== null && isTelegram(rows[i])) {
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

        function onToggle(event) {
          stop(event)
          mode = mode === 1 ? 0 : 1
          clicks = 0
          var host = tree()
          if (mode === 1) {
            opened = {}
            unfolded = {}
            scroll = host === null ? null : host.scrollTop
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
          var host = tree()
          if (host !== null && host.getAttribute(TREE_ATTR) !== null) host.removeAttribute(TREE_ATTR)
          var buttons = document.querySelectorAll('[' + BUTTON_ATTR + ']')
          for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i]
            button.removeEventListener('mousedown', stop)
            button.removeEventListener('pointerdown', stop)
            button.removeEventListener('click', onToggle)
            if (button.parentElement !== null) button.parentElement.removeChild(button)
          }
        }

        /* A new Session, a retitled one, a row React re-rendered: the pass has to run
           again. Only data-row-key is watched, exactly as the pin effect watches it --
           class is rewritten on every render, the key moves only when the row does, and a
           filter on that attribute is also what keeps this effect's own data-eva-tg*
           writes from scheduling another pass. */
        var observer = null
        if (document.body !== undefined && document.body !== null) {
          observer = new MutationObserver(schedule)
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
        paint()

        return dispose
      }, 'evangelion: telegram filter')

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
