/* EVA model picker + EVA effort picker -- two independent controls.
 *
 * The composer's merged model control becomes TWO buttons, each with its OWN popover:
 *
 *   [ DeepSeek V4.1 Flash  ^ ]      [ 大脑图标  高  v ]
 *            |                              |
 *      model panel                    effort panel
 *      (search + groups + models)      (Default / 低 / 中 / 高)
 *
 * Nothing is shared between them but the store they read and the selection verb they
 * call -- opening one closes the other, and neither can reach into the other's list.
 *
 * The data contract is the one the official composer seat already hands over, so
 * selection, defaults and callbacks are untouched:
 *
 *   options.directory.subscribe(fn)   -> unsubscribe; notifies on store change
 *   options.directory.getSnapshot()   -> state
 *   options.load()                    -> refresh the catalog (fire and forget)
 *   options.select(selection)         -> Promise<{ ok: boolean, error?: unknown }>
 *   options.t(key)                    -> localized string (optional)
 *
 *   model selection  = { provider, model }
 *   effort selection = { provider, model, reasoningEffort }   // key omitted when the
 *                      effort is undefined (the provider's own default)
 *
 *   state = {
 *     current: { provider, model, reasoningEffort? } | null,
 *     groups: [{ id, name,
 *                models: [{ id, name,
 *                           reasoning?: { defaultEffort, efforts: [{ id, name }] } }] }],
 *     pending: boolean,
 *     status: 'loading' | 'ready' | ...,
 *     retainedEffort?: string
 *   }
 *
 * Usage:
 *   var pair = EvaModelEffortPicker.createPair({ directory: store, load: load,
 *                                                select: select, t: t })
 *   bar.appendChild(pair.model.el)
 *   bar.appendChild(pair.effort.el)
 *
 * No backticks and no template placeholders anywhere in this file: it is written to be
 * pasted verbatim into src/client.js, which carries the same house rule.
 */
var EvaModelEffortPicker = (function () {
  'use strict'

  var NS = 'http://www.w3.org/2000/svg'
  var PATH_CHECK = 'M3.4 8.6 6.4 11.6 12.6 4.4'
  var PATH_CHEVRON = 'M4 6.6 8 10.6 12 6.6'
  /* The reasoning axis is labelled with a glyph so the two triggers keep their width
   * when the model name beside them runs long. Drawn as a stroked outline in the
   * theme's own icon idiom -- 16-grid, fill none, currentColor, no fill and no colour
   * of its own -- so it inherits the trigger's ink and the dark/light switch for free.
   *
   * The geometry is Lucide's brain icon scaled from its native 24-grid to this one rather
   * than eyeballed, so the curves are the ones the family was drawn with. The three
   * subpaths share a single path element: this glyph is pure stroke, so it needs no
   * second element the way a two-tone filled icon would. */
  var PATH_BRAIN = 'M8 3.333 a2 2 0 1 0 -3.998 0.083 a2.667 2.667 0 0 0 -1.684 3.847 a2.667 2.667 0 0 0 0.371 4.392 A2.667 2.667 0 1 0 8 12 Z M8 3.333 a2 2 0 1 1 3.998 0.083 a2.667 2.667 0 0 1 1.684 3.847 a2.667 2.667 0 0 1 -0.371 4.392 A2.667 2.667 0 1 1 8 12 Z M10 8.667 a3 3 0 0 1 -2 -2.667 a3 3 0 0 1 -2 2.667'
  /* The model axis normally names itself with the selected model's name, so it has no
   * glyph. The composer's compact mode hides that name -- see the contract note by the
   * compact-seat rules in the stylesheet -- which would leave the trigger as a bare
   * chevron. This is the seat's own axis mark, drawn in the same stroked 16-grid idiom
   * as the brain, and it is only ever displayed in that compact mode: the name is the
   * better label when there is room for it.
   *
   * The stack-of-discs shape is what the shipped control uses for this same seat, so it
   * already reads as "the model button" to anyone who has used the app without the theme.
   * Scaled from Lucide's 24-grid database to this one rather than eyeballed: in an arc
   * command only rx, ry, x and y are lengths, so the rotation and both flags are copied
   * through untouched -- scaling them would silently flip the arcs' direction. */
  var PATH_MODEL = 'M2 3.3333 A6 2 0 0 1 14 3.3333 A6 2 0 0 1 2 3.3333 Z M2 3.3333 V12.6667 A6 2 0 0 0 14 12.6667 V3.3333 M2 8 A6 2 0 0 0 14 8'
  var ATTR = 'data-eva-mep'
  var SEARCH_THRESHOLD = 4

  /* Which provider groups the user has collapsed is a preference about the panel, not a
   * property of one conversation. Held per-instance it is forgotten the moment the chat
   * is switched, so collapsing a group in one conversation and finding it re-expanded
   * in the next reads as the panel losing the user's choice.
   *
   * One shared map under one named storage key, so every instance -- including two
   * panels mounted in two different conversations -- reads and writes the same object
   * and they cannot disagree.
   *
   * Both directions are guarded. A blocked store (private mode, an embedding host that
   * denies storage) must degrade to in-memory state for this session, not throw from
   * inside a dropdown. */
  var MEP_KEY = 'eva-theme/model-groups-collapsed'
  var collapseStore = null

  function collapsedMap() {
    if (collapseStore) return collapseStore
    var parsed = null
    try {
      var raw = localStorage.getItem(MEP_KEY)
      if (raw) parsed = JSON.parse(raw)
    } catch (err) { parsed = null }
    collapseStore = parsed && typeof parsed === 'object' && !(parsed instanceof Array) ? parsed : {}
    return collapseStore
  }

  function persistCollapsed() {
    try {
      localStorage.setItem(MEP_KEY, JSON.stringify(collapsedMap()))
    } catch (err) { /* a blocked store keeps this session's choices in memory */ }
  }

  /* Only one popover of this pair lives on screen at a time. The registry is module
   * level because the two halves are separate DOM trees by construction. */
  var openInstance = null

  var ZH = {
    'model.trigger.fallback': '请选择模型',
    'model.trigger.aria': '选择模型，当前 {model}',
    /* The panels no longer print a title row, so the label has to come from
     * aria-label instead -- a menu with no accessible name is just "menu". */
    'model.title': '模型选择',
    /* The trigger names this axis with a glyph rather than a word -- see PATH_BRAIN.
     * The accessible name spells it out: effort.trigger.aria below. */
    'effort.trigger.aria': '选择推理强度，当前 {effort}',
    'effort.title': '推理强度',
    'group.toggle': '展开或折叠分组',
    'search.placeholder': '搜索模型…',
    'search.clear': '清除搜索',
    'search.empty': '没有匹配的模型。',
    'empty.models': '没有可用的模型。',
    'empty.efforts': '当前模型未提供推理等级。',
    'effort.providerDefault': 'Default'
  }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) }

  function makeT(overrides) {
    var table = {}
    var k
    for (k in ZH) if (own(ZH, k)) table[k] = ZH[k]
    if (overrides) for (k in overrides) if (own(overrides, k)) table[k] = overrides[k]
    return function (key, vars) {
      var text = own(table, key) ? table[key] : key
      if (!vars) return text
      var name
      for (name in vars) if (own(vars, name)) {
        text = text.split('{' + name + '}').join(String(vars[name]))
      }
      return text
    }
  }

  function h(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function icon(path, cls) {
    var s = document.createElementNS(NS, 'svg')
    s.setAttribute('viewBox', '0 0 16 16')
    s.setAttribute('aria-hidden', 'true')
    s.setAttribute('focusable', 'false')
    if (cls) s.setAttribute('class', cls)
    var p = document.createElementNS(NS, 'path')
    p.setAttribute('d', path)
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke', 'currentColor')
    p.setAttribute('stroke-width', '1.4')
    p.setAttribute('stroke-linecap', 'round')
    p.setAttribute('stroke-linejoin', 'round')
    s.appendChild(p)
    return s
  }

  function slug(text) {
    return String(text).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 48)
  }

  /* The model name is data the theme does not control, and some of them run long. At a
   * fixed 13px the composer row is left with two bad options: wrap to a second line, or
   * clip the name to an ellipsis. Shrinking the type to the room the row actually handed
   * us keeps the row on one line AND keeps the name readable.
   *
   * Two things keep this from chasing its own tail. Measuring the natural width means
   * writing the type back to its base size and reading scrollWidth -- that write moves
   * the label's box -- so the measurement is cached per string and every later pass is
   * pure arithmetic. And the loop reads the room fresh on each pass, because shrinking
   * the type inside a row that hands out leftover space does change the room back; the
   * pass budget is what stops that from running away.
   *
   * Bounded on purpose: three passes, a 10px floor, and a write only when the size
   * actually changes. */
  var FIT_BASE = 13
  var FIT_FLOOR = 10
  var fitNatural = new WeakMap()

  function naturalOf(node, text) {
    var known = fitNatural.get(node)
    if (known && known.text === text) return known.width
    var applied = node.style.fontSize
    if (applied) node.style.removeProperty('font-size')
    var width = node.scrollWidth
    if (applied) node.style.fontSize = applied
    /* A detached node measures 0, and the first paint runs before the caller has
     * appended the trigger. Caching that zero would poison every later pass -- the
     * fit would keep reading "natural width 0" and conclude the name already fits.
     * So only a real measurement is remembered. */
    if (width) fitNatural.set(node, { text: text, width: width })
    return width
  }

  function fitText(node) {
    if (!node) return
    var natural = naturalOf(node, node.textContent || '')
    if (!natural) return
    var pass
    for (pass = 0; pass < 3; pass++) {
      var room = node.clientWidth
      /* No room means no box to fit into: the label is either display:none (the
       * composer's compact mode hid it) or not in the document yet. Either way the
       * right answer is the unshrunk base size, so a stale inline size from an earlier
       * narrow layout cannot survive the label coming back. */
      if (!room) {
        if (node.style.fontSize) node.style.removeProperty('font-size')
        return
      }
      if (natural <= room) {
        if (node.style.fontSize) node.style.removeProperty('font-size')
        return
      }
      var size = (FIT_BASE * room) / natural
      if (size < FIT_FLOOR) size = FIT_FLOOR
      size = Math.round(size * 100) / 100
      var current = parseFloat(node.style.fontSize)
      if (current === size) return
      node.style.fontSize = size + 'px'
    }
  }

  function closer() {
    if (openInstance) {
      var previous = openInstance
      openInstance = null
      previous.setOpen(false)
    }
  }

  function createShell(kind, t) {
    var anchor = h('div', 'eva-mep-anchor')
    anchor.setAttribute(ATTR, '')
    anchor.setAttribute('data-eva-mep-kind', kind)
    anchor.setAttribute('data-eva-mep-open', 'false')

    var trigger = h('button', 'eva-mep-trigger')
    trigger.type = 'button'
    trigger.setAttribute('data-eva-mep-trigger', '')
    trigger.setAttribute('aria-haspopup', 'dialog')
    trigger.setAttribute('aria-expanded', 'false')

    var label = h('span', 'eva-mep-triggerLabel')
    var value = h('span', 'eva-mep-triggerValue')
    /* The reasoning axis names itself with a glyph, so its label is an SVG rather than
     * text. Both triggers share one shell, so the glyph is swapped in here by kind
     * instead of duplicating the builder. It carries no accessible text of its own --
     * icon() already marks it aria-hidden, and the trigger's aria-label spells the
     * axis out (see effort.trigger.aria). */
    if (kind === 'effort') label.appendChild(icon(PATH_BRAIN, 'eva-mep-triggerGlyph'))
    /* The model axis mark is a SIBLING of the label, never a child of it. paint() names
     * the model by assigning label.textContent, and assigning textContent discards
     * child elements -- a glyph parented there would be wiped on the first repaint.
     * The effort half can keep its glyph inside the label because its label is never
     * given text; that half writes its value into shell.value instead. */
    if (kind === 'model') trigger.appendChild(icon(PATH_MODEL, 'eva-mep-triggerAxis'))
    trigger.appendChild(label)
    trigger.appendChild(value)
    trigger.appendChild(icon(PATH_CHEVRON, 'eva-mep-chev'))

    var pop = h('div', 'eva-mep-pop')
    pop.setAttribute('data-eva-mep-pop', '')
    var panel = h('div', 'eva-mep-panel')
    panel.setAttribute('role', 'dialog')
    pop.appendChild(panel)

    anchor.appendChild(trigger)
    anchor.appendChild(pop)

    return { anchor: anchor, trigger: trigger, label: label, value: value, pop: pop, panel: panel }
  }

  /* ------------------------------------------------------------ shared plumbing -- */

  function attachCommon(instance, options, t) {
    var opts = options || {}
    var store = opts.directory || null
    var shell = instance.shell
    instance.disabled = opts.disabled === true
    if (instance.disabled) shell.trigger.disabled = true

    function outside(event) {
      if (!instance.open) return
      if (shell.anchor.contains(event.target)) return
      instance.setOpen(false)
    }

    /* The composer row changes width without either control re-rendering: the window
     * resizes, a sibling appears, the sidebar collapses. Re-fitting is therefore a
     * listener of its own rather than something folded into paint().
     *
     * The observer watches the PARENT, never the anchor. A fit writes a font-size,
     * which changes the label's own box, so observing the anchor would let the fit
     * trigger itself: in an over-full row the two triggers share the negative space
     * in proportion to their content widths, and the width the fit just changed is
     * the width it measures next time. Watching the parent measures only the room
     * the composer handed the seat, which a font-size never moves.
     *
     * The parent does not exist while the pair is being built -- the caller appends
     * the trigger afterwards -- so the observer is attached by watch(), which the
     * caller invokes once the node is in the document. The window listener is here
     * from the start and needs no such handshake. */
    function refit() {
      if (instance.destroyed) return
      if (typeof instance.fit === 'function') instance.fit()
    }
    window.addEventListener('resize', refit)

    instance.watch = function () {
      if (instance.destroyed || instance.observer) return
      if (typeof ResizeObserver !== 'function') return
      var room = shell.anchor.parentNode
      if (!room) return
      instance.observer = new ResizeObserver(refit)
      instance.observer.observe(room)
      refit()
    }

    function onKey(event) {
      if (event.key === 'Escape' && instance.open) {
        event.preventDefault()
        instance.setOpen(false)
        shell.trigger.focus()
      }
    }

    /* The panel is centred on its trigger and sized by its contents, so two things move
     * its edges without the window ever resizing: a trigger near the left or right of a
     * narrow composer centres a wide panel partly off screen, and expanding or collapsing
     * a provider group changes the panel's width under it. Measuring settles both --
     * the trigger's position decides the first, the measured rect the second -- and the
     * correction rides on a transform so it stays out of layout: nothing above reflows
     * and the panel never animates its geometry.
     *
     * Callers must therefore re-run this after anything that can change the measured
     * width, not only on resize: a stale correction is worse than none, because it drags
     * a panel that would otherwise have been centred cleanly back off the edge. */
    function place() {
      if (!instance.open || !shell.pop || !shell.panel) return
      /* Measure uncorrected: the previous shift must not be mistaken for the panel's
       * natural position, or each pass would build on the last one's error. */
      shell.pop.style.removeProperty('--eva-mep-shift')
      var rect = shell.panel.getBoundingClientRect()
      if (!rect.width) return
      var margin = 8
      var view = document.documentElement.clientWidth || window.innerWidth || 0
      if (!view) return
      var shift = 0
      if (rect.width + margin * 2 > view) shift = margin - rect.left
      else if (rect.right > view - margin) shift = (view - margin) - rect.right
      else if (rect.left < margin) shift = margin - rect.left
      if (shift) shell.pop.style.setProperty('--eva-mep-shift', Math.round(shift) + 'px')
    }
    instance.place = place

    function replace() {
      if (instance.open) place()
    }

    instance.setOpen = function (next) {
      var want = next === true
      if (want === instance.open) return
      if (want) closer()
      instance.open = want
      shell.anchor.setAttribute('data-eva-mep-open', want ? 'true' : 'false')
      shell.trigger.setAttribute('aria-expanded', want ? 'true' : 'false')
      if (want) {
        openInstance = instance
        /* Wire the dismiss listeners before painting: if painting ever throws,
         * the panel must still be closable rather than stuck open. */
        document.addEventListener('mousedown', outside, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('resize', replace)
        if (typeof opts.load === 'function') opts.load()
        /* paint() re-measures the panel edge itself when it had to rebuild the rows, and
         * returns that fact. Only ask for the measurement when it did not: a second
         * reading of an unchanged panel is a second forced layout for one answer, and it
         * is the same cost whether the rebuild happened or not. */
        var placed = false
        if (typeof instance.paint === 'function') placed = instance.paint() === true
        if (!placed) place()
        if (typeof instance.focusFirst === 'function') instance.focusFirst()
      } else {
        if (openInstance === instance) openInstance = null
        document.removeEventListener('mousedown', outside, true)
        document.removeEventListener('keydown', onKey, true)
        window.removeEventListener('resize', replace)
        shell.pop.style.removeProperty('--eva-mep-shift')
      }
    }

    shell.trigger.addEventListener('click', function () {
      instance.setOpen(!instance.open)
    })
    shell.trigger.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        instance.setOpen(true)
      }
    })

    if (store && typeof store.subscribe === 'function') {
      instance.subscribe = store.subscribe(function () { instance.sync() })
    }

    instance.snapshot = function () {
      if (!store || typeof store.getSnapshot !== 'function') return null
      try { return store.getSnapshot() } catch (err) { return null }
    }

    /* Locking is a render-time fact (a running turn locks the composer) rather than a
     * mount-time one, so it is settable after construction: the trigger is disabled,
     * any open panel is closed, and the state is remembered for later paints. */
    instance.setDisabled = function (next) {
      var want = next === true
      if (want === instance.disabled) return
      instance.disabled = want
      shell.trigger.disabled = want
      if (want) instance.setOpen(false)
      if (typeof instance.paint === 'function') instance.paint()
    }

    instance.destroy = function () {
      if (instance.subscribe) instance.subscribe()
      instance.setOpen(false)
      window.removeEventListener('resize', refit)
      if (instance.observer) {
        instance.observer.disconnect()
        instance.observer = null
      }
      instance.destroyed = true
      if (shell.anchor.parentNode) shell.anchor.parentNode.removeChild(shell.anchor)
    }

    return t
  }

  /* The whole popover is one roving-focus region: exactly one visited row carries
   * tabindex 0 and the rest -1, so Tab leaves the panel and arrows walk it, and no
   * synthetic ring is ever painted on a row the user did not move to. */
  function rove(rows, next) {
    var i
    for (i = 0; i < rows.length; i++) rows[i].tabIndex = rows[i] === next ? 0 : -1
    if (next && typeof next.focus === 'function') next.focus()
  }

  function step(rows, from, delta) {
    if (!rows.length) return null
    var index = rows.indexOf(from)
    if (index < 0) index = delta > 0 ? -1 : 0
    return rows[(index + delta + rows.length) % rows.length]
  }

  function trapTab(event, panel) {
    /* Rows folded inside a collapsed group are display:none but still match the
     * selector, so an unfiltered list can name a hidden node as the last focusable:
     * Tab would then never see itself at the end and would escape the open panel.
     * offsetParent is null exactly for those hidden nodes (and only while the panel is
     * itself laid out, which it always is when this runs). */
    var all = panel.querySelectorAll('button:not([disabled]), input:not([disabled])')
    var nodes = []
    for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null) nodes.push(all[i])
    if (!nodes.length) return
    var first = nodes[0]
    var last = nodes[nodes.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  /* ---------------------------------------------------------------- the model -- */

  function createModelSelect(options) {
    var opts = options || {}
    var t = makeT(opts.i18n)
    var state = null
    var query = ''
    /* A provider group opens expanded unless the user collapsed it, and that choice is
     * read from the shared store rather than a per-instance object -- see collapsedMap.
     * The list is the panel's whole content now that the aggregate row and the title are
     * gone, so an unvisited group has to default to open: a collapsed default would
     * leave an empty-looking popover. */
    var closedGroups = collapsedMap()
    /* The list currently in the DOM, as a signature of everything that decides it.
     * Rebuilding is expensive -- the real directory is a few hundred models, and every
     * rebuild throws away and recreates every row and every row's check glyph -- while
     * the common case (opening a panel nobody has touched) reproduces exactly the DOM
     * that is already there. Null means "nothing painted yet". */
    var painted = null
    /* Mirrors what the rows currently carry, so applyPending() can skip a write that
     * would change nothing. Reset to null on every rebuild, which is what re-applies it
     * to freshly built rows. */
    var rowsDisabled = null
    var instance = { kind: 'model', open: false, destroyed: false, shell: createShell('model', t) }
    var shell = instance.shell
    instance.el = shell.anchor
    var rows = []
    var empty = h('div', 'eva-mep__empty', t('empty.models'))
    empty.setAttribute('data-eva-mep-empty', '')

    var searchRow = h('div', 'eva-mep__searchRow')
    var searchInput = document.createElement('input')
    searchInput.type = 'search'
    searchInput.className = 'eva-mep__search'
    searchInput.setAttribute('data-eva-mep-search', '')
    searchInput.setAttribute('placeholder', t('search.placeholder'))
    searchInput.setAttribute('aria-label', t('search.placeholder'))
    var searchClear = h('button', 'eva-mep__searchClear')
    searchClear.type = 'button'
    searchClear.setAttribute('data-eva-mep-search-clear', '')
    searchClear.setAttribute('aria-label', t('search.clear'))
    searchClear.appendChild(icon('M5 5 11 11 M11 5 5 11'))
    searchRow.appendChild(searchInput)
    searchRow.appendChild(searchClear)

    var scroll = h('div', 'eva-mep__scroll')
    scroll.setAttribute('role', 'menu')
    scroll.setAttribute('aria-label', t('model.title'))

    shell.panel.appendChild(searchRow)
    shell.panel.appendChild(scroll)

    attachCommon(instance, opts, t)

    function providers() {
      return state && state.groups ? state.groups : []
    }

    /* Every model carries the provider it came from, so a row selected out of the
     * flattened list still selects through the same verb with the same payload. */
    function entries() {
      var out = []
      var groups = providers()
      var i, j
      for (i = 0; i < groups.length; i++) {
        for (j = 0; j < groups[i].models.length; j++) {
          out.push({ provider: groups[i].id, group: groups[i].name, model: groups[i].models[j] })
        }
      }
      return out
    }

    function visibleGroups() {
      var all = entries()
      var filtering = query !== ''
      var groups = []
      var i, j
      for (i = 0; i < providers().length; i++) {
        var provider = providers()[i]
        var list = []
        for (j = 0; j < all.length; j++) if (all[j].provider === provider.id) list.push(all[j])
        groups.push({ id: provider.id, name: provider.name, entries: list })
      }
      if (!filtering) return groups
      var needle = query.toLowerCase()
      var filtered = []
      for (i = 0; i < groups.length; i++) {
        var kept = groups[i].entries.filter(function (entry) {
          return String(entry.model.name).toLowerCase().indexOf(needle) >= 0 ||
            String(entry.group).toLowerCase().indexOf(needle) >= 0
        })
        if (kept.length) filtered.push({ id: groups[i].id, name: groups[i].name, entries: kept })
      }
      return filtered
    }

    function currentEntry() {
      var cur = state && state.current
      if (!cur) return null
      var all = entries()
      var i
      for (i = 0; i < all.length; i++) {
        if (all[i].provider === cur.provider && all[i].model.id === cur.model) return all[i]
      }
      return null
    }

    function choose(provider, model) {
      if (typeof opts.select !== 'function' || (state && state.pending)) return
      opts.select({ provider: provider, model: model })
      instance.setOpen(false)
      shell.trigger.focus()
    }

    function toggleGroup(id) {
      /* Only the keys this control toggles are written back, so two instances sharing
       * the map cannot clobber each other's entries. */
      closedGroups[id] = !closedGroups[id]
      persistCollapsed()
      paint()
    }

    /* Everything that decides what the list looks like, as one comparable string: which
     * groups are shown, whether each is folded, and every visible model's id and name.
     * Building it costs a few hundred string joins; rebuilding the DOM it describes
     * costs every row and every row's check glyph, which at the real directory's size is
     * the whole click. That trade is what makes this worth computing on every paint.
     *
     * The separator is a control character no model or provider name can contain, so two
     * different lists cannot collide into one signature.
     *
     * The pending flag is deliberately NOT part of this. It toggles one property on rows
     * that already exist, and folding it in here would make every load-flip rebuild all
     * 244 rows to change a boolean they are already carrying. applyPending() does that
     * cheap pass instead. */
    function signatureOf(groups, filtering, entry) {
      var parts = [query]
      parts.push(entry ? entry.provider + '/' + entry.model.id : '')
      for (var i = 0; i < groups.length; i++) {
        var group = groups[i]
        parts.push(group.id, group.name,
          filtering || closedGroups[group.id] !== true ? 'open' : 'folded')
        for (var j = 0; j < group.entries.length; j++) {
          parts.push(group.entries[j].model.id, group.entries[j].model.name)
        }
      }
      return parts.join('\u0001')
    }

    /* Applies the one thing that can change without changing the list: whether model
     * rows are selectable while a load is in flight. It walks the rows already in the
     * DOM instead of forcing a rebuild, and it writes only on a real change so a stable
     * store notification cannot dirty layout. */
    function applyPending() {
      var want = !!(state && state.pending)
      if (want === rowsDisabled) return
      rowsDisabled = want
      for (var i = 0; i < rows.length; i++) rows[i].disabled = want
    }

    function paint() {
      if (instance.destroyed) return
      var entry = currentEntry()
      var all = entries()
      var hasSearch = all.length > SEARCH_THRESHOLD || query !== ''
      var filtering = query !== ''
      var label = entry ? entry.model.name : t('model.trigger.fallback')

      /* Every write below is guarded by a read of the value it would replace, because a
       * redundant write is not free here. Assigning textContent invalidates layout, and
       * fitText() then reads clientWidth -- which flushes that invalidation as a
       * synchronous layout of the WHOLE document, not just this trigger. In the real app
       * that document is the entire DSH interface, so the cost of "set the label to what
       * it already says" is a full-document reflow on every click.
       *
       * Reading is safe: these are plain attribute and text reads that match nothing in
       * layout, so checking before writing costs a string compare and saves the flush.
       * The common click changes none of them -- the selected model is the same one --
       * so the open path stops dirtying layout and the forced layout never happens. */
      if (searchRow.hidden === hasSearch) searchRow.hidden = !hasSearch
      if (searchInput.value !== query) searchInput.value = query
      if (searchClear.hidden !== (query === '')) searchClear.hidden = query === ''
      if (shell.label.textContent !== label) {
        shell.label.textContent = label
        fitText(shell.label)
      }
      var aria = t('model.trigger.aria', { model: label })
      if (shell.trigger.getAttribute('aria-label') !== aria) {
        shell.trigger.setAttribute('aria-label', aria)
      }

      var groups = visibleGroups()
      var signature = signatureOf(groups, filtering, entry)
      /* Nothing that decides the list has moved, so the rows already on screen are the
       * rows this paint would build -- down to the selected check and the folded groups.
       * Rebuilding them would produce the same DOM at full price, which is exactly what
       * a click pays for today. The trigger-side work above still runs, so a repaint that
       * only moved the label is still honoured. */
      applyPending()
      if (signature === painted) return

      var hold = document.activeElement && shell.panel.contains(document.activeElement)
        ? (document.activeElement.getAttribute('data-eva-mep-model') ||
           document.activeElement.getAttribute('data-eva-mep-group-toggle') ||
           document.activeElement.getAttribute('data-eva-mep-search'))
        : null
      var top = scroll.scrollTop

      scroll.textContent = ''
      rows = []
      painted = signature
      /* Fresh rows, so the pending mirror no longer describes them; the pass below
       * re-applies it once the rows exist. */
      rowsDisabled = null
      if (!groups.length) {
        empty.textContent = query ? t('search.empty') : t('empty.models')
        scroll.appendChild(empty)
        if (typeof instance.place === 'function') instance.place()
        /* Same contract as the main path: the caller must not measure again. */
        return true
      }

      var i, j
      for (i = 0; i < groups.length; i++) {
        var group = groups[i]
        /* Results always render open: a filter the user cannot see is worse than a
         * collapsed group the user chose to collapse. */
        var isClosed = !filtering && closedGroups[group.id] === true
        var wrap = h('div', 'eva-mep__group')
        wrap.setAttribute('data-eva-mep-group', slug(group.id))

        var groupRow = h('button', 'eva-mep__groupRow')
        groupRow.type = 'button'
        groupRow.setAttribute('data-eva-mep-group-toggle', slug(group.id))
        groupRow.setAttribute('aria-expanded', isClosed ? 'false' : 'true')
        groupRow.tabIndex = -1
        /* Presentation-only hook: a caller that wants the reference's leading glyph per
         * provider supplies one, and the slot stays invisible when it does not. */
        groupRow.appendChild(h(
          'span',
          'eva-mep__groupIcon',
          typeof opts.iconFor === 'function' ? opts.iconFor(group) : ''
        ))
        groupRow.appendChild(h('span', 'eva-mep__groupName', group.name))
        groupRow.appendChild(h('span', 'eva-mep__groupCount', group.entries.length))
        groupRow.appendChild(icon(PATH_CHEVRON, 'eva-mep__chev'))
        groupRow.addEventListener('click', function (id) {
          return function () { toggleGroup(id) }
        }(group.id))
        wrap.appendChild(groupRow)
        rows.push(groupRow)

        var body = h('div', 'eva-mep__groupBody')
        body.hidden = isClosed
        for (j = 0; j < group.entries.length; j++) {
          body.appendChild(modelRow(group.entries[j], group.id, isClosed))
        }
        wrap.appendChild(body)
        scroll.appendChild(wrap)
      }
      scroll.scrollTop = top
      applyPending()

      var restored = null
      if (hold) restored = shell.panel.querySelector('[data-eva-mep-model="' + hold + '"]') ||
        shell.panel.querySelector('[data-eva-mep-group-toggle="' + hold + '"]')
      if (restored && rows.indexOf(restored) >= 0) rove(rows, restored)
      else if (rows.length && !rows.some(function (r) { return r.tabIndex === 0 })) rows[0].tabIndex = 0

      /* Repainting can change the panel's width -- folding a group away drops its rows,
       * filtering swaps one result set for a shorter one -- and the edge correction was
       * measured against the old width. Re-measure here, at the one point where the
       * contents are known to have settled, rather than trying to guess which callers
       * can move a panel edge.
       *
       * A rebuild means this already ran, and the caller must not run it again: two
       * measurements of the same panel cost two forced layouts for one answer. The
       * return value is how the caller knows which case it got. */
      if (typeof instance.place === 'function') instance.place()
      return true
    }

    function modelRow(entry, groupId, isClosed) {
      var selected = !!state.current &&
        state.current.provider === entry.provider && state.current.model === entry.model.id
      /* A model belongs to exactly one provider group now that the aggregate list is
       * gone, so the row key is the provider plus the model id. */
      var row = h('button', 'eva-mep__option eva-mep__option--indent')
      row.type = 'button'
      row.setAttribute('role', 'menuitemradio')
      row.setAttribute('aria-checked', selected ? 'true' : 'false')
      row.setAttribute('data-eva-mep-model', slug(groupId + '|' + entry.provider + ':' + entry.model.id))
      row.setAttribute('data-eva-mep-model-id', slug(entry.provider + ':' + entry.model.id))
      row.tabIndex = -1
      row.appendChild(h('span', 'eva-mep__optionLabel', entry.model.name))
      /* The check is invisible on every row but the selected one -- CSS holds it at
       * opacity 0 -- yet each one used to be a full 8-node SVG. At the real directory's
       * size that is 244 glyphs built to show one, and it is the bulk of the first
       * paint. The slot is kept as an empty box either way, because its 14px width comes
       * from CSS, so a row that skips the glyph has exactly the layout it had before. */
      row.appendChild(selected ? icon(PATH_CHECK, 'eva-mep__check') : h('span', 'eva-mep__check'))
      if (state.pending) row.disabled = true
      row.addEventListener('click', function () { choose(entry.provider, entry.model.id) })
      /* A row folded inside a collapsed group is still in the DOM, so pushing it here
       * would put it in the roving-focus ring: arrows would step onto a row nobody can
       * see, moving focus by nothing and stalling the walk inside the hidden group. The
       * ring is built from what is on screen, so a closed group contributes only its
       * header row. */
      if (!isClosed) rows.push(row)
      return row
    }

    function onKey(event) {
      var active = event.target
      if (event.key === 'Tab') {
        trapTab(event, shell.panel)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (active && active.getAttribute && active.getAttribute('data-eva-mep-search') !== null) return
        if (active && active.click && rows.indexOf(active) >= 0) {
          event.preventDefault()
          active.click()
        }
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        rove(rows, step(rows, active, event.key === 'ArrowDown' ? 1 : -1))
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        if (rows.length) rove(rows, event.key === 'Home' ? rows[0] : rows[rows.length - 1])
        return
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        active && active.getAttribute && active.getAttribute('data-eva-mep-group-toggle') !== null) {
        event.preventDefault()
        toggleGroup(active.getAttribute('data-eva-mep-group-toggle'))
      }
    }

    searchInput.addEventListener('input', function () {
      query = searchInput.value
      paint()
    })
    searchClear.addEventListener('click', function () {
      query = ''
      paint()
      searchInput.focus()
    })
    shell.panel.addEventListener('keydown', onKey)

    instance.paint = paint
    instance.focusFirst = function () {
      if (!searchRow.hidden) searchInput.focus()
      else if (rows.length) rove(rows, rows[0])
    }
    instance.sync = function () {
      state = instance.snapshot()
      paint()
    }
    instance.fit = function () {
      fitText(shell.label)
    }
    /* A fresh open starts from the whole list: a filter left over from the last
     * visit would silently hide models the user never meant to exclude. */
    var baseSetOpen = instance.setOpen
    instance.setOpen = function (next) {
      var want = next === true
      baseSetOpen(next)
      if (!want && query) {
        query = ''
        searchInput.value = ''
      }
    }
    state = instance.snapshot()
    paint()
    return instance
  }

  /* --------------------------------------------------------------- the effort -- */

  function createEffortSelect(options) {
    var opts = options || {}
    var t = makeT(opts.i18n)
    var state = null
    var instance = { kind: 'effort', open: false, destroyed: false, shell: createShell('effort', t) }
    var shell = instance.shell
    instance.el = shell.anchor
    var rows = []
    var empty = h('div', 'eva-mep__empty', t('empty.efforts'))
    empty.setAttribute('data-eva-mep-empty', '')

    var scroll = h('div', 'eva-mep__scroll')
    scroll.setAttribute('role', 'menu')

    scroll.setAttribute('aria-label', t('effort.title'))

    shell.panel.appendChild(scroll)

    attachCommon(instance, opts, t)

    function currentEntry() {
      var cur = state && state.current
      if (!cur) return null
      var groups = state.groups || []
      var i, j
      for (i = 0; i < groups.length; i++) {
        for (j = 0; j < groups[i].models.length; j++) {
          if (groups[i].id === cur.provider && groups[i].models[j].id === cur.model) {
            return { provider: groups[i].id, model: groups[i].models[j] }
          }
        }
      }
      return null
    }

    function reasoning() {
      var entry = currentEntry()
      return entry && entry.model.reasoning ? entry.model.reasoning : null
    }

    function effective() {
      var cur = state && state.current
      if (!cur || cur.reasoningEffort === undefined) return undefined
      return cur.reasoningEffort
    }

    /* Mirrors the official choice list: a provider that declares no default effort gets
     * an explicit "provider default" row; one that declares a default does not. */
    function choices() {
      var scale = reasoning()
      var out = []
      if (!scale) return out
      if (scale.defaultEffort === undefined) {
        out.push({ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') })
      }
      var efforts = scale.efforts || []
      var i
      for (i = 0; i < efforts.length; i++) {
        out.push({ key: 'effort:' + efforts[i].id, effort: efforts[i].id, label: efforts[i].name })
      }
      return out
    }

    function labelOf() {
      var scale = reasoning()
      var value = effective()
      if (!scale) return state && state.retainedEffort ? state.retainedEffort : ''
      if (value === undefined) return t('effort.providerDefault')
      var efforts = scale.efforts || []
      var i
      for (i = 0; i < efforts.length; i++) if (efforts[i].id === value) return efforts[i].name
      return String(value)
    }

    function choose(effort) {
      if (typeof opts.select !== 'function' || !state || !state.current || state.pending) return
      var selection = { provider: state.current.provider, model: state.current.model }
      if (effort !== undefined) selection.reasoningEffort = effort
      opts.select(selection)
      instance.setOpen(false)
      shell.trigger.focus()
    }

    function paint() {
      if (instance.destroyed) return
      var hold = document.activeElement && shell.panel.contains(document.activeElement)
        ? document.activeElement.getAttribute('data-eva-mep-effort')
        : null
      var top = scroll.scrollTop
      var label = labelOf()
      shell.value.textContent = label
      shell.value.hidden = label === ''
      shell.trigger.setAttribute('aria-label', t('effort.trigger.aria', { effort: label }))

      scroll.textContent = ''
      rows = []
      var list = choices()
      if (!list.length) {
        scroll.appendChild(empty)
        return
      }
      var value = effective()
      var i
      for (i = 0; i < list.length; i++) {
        rows.push(effortRow(list[i], list[i].effort === value))
      }
      scroll.scrollTop = top
      var restored = hold ? shell.panel.querySelector('[data-eva-mep-effort="' + hold + '"]') : null
      if (restored && rows.indexOf(restored) >= 0) rove(rows, restored)
      else if (rows.length && !rows.some(function (r) { return r.tabIndex === 0 })) rows[0].tabIndex = 0
    }

    function effortRow(spec, selected) {
      var row = h('button', 'eva-mep__option')
      row.type = 'button'
      row.setAttribute('role', 'menuitemradio')
      row.setAttribute('aria-checked', selected ? 'true' : 'false')
      row.setAttribute('data-eva-mep-effort', slug(spec.key))
      row.tabIndex = -1
      row.appendChild(h('span', 'eva-mep__optionLabel', spec.label))
      row.appendChild(icon(PATH_CHECK, 'eva-mep__check'))
      if (state.pending) row.disabled = true
      row.addEventListener('click', function () { choose(spec.effort) })
      scroll.appendChild(row)
      return row
    }

    function onKey(event) {
      if (event.key === 'Tab') {
        trapTab(event, shell.panel)
        return
      }
      var active = event.target
      if ((event.key === 'Enter' || event.key === ' ') && rows.indexOf(active) >= 0) {
        event.preventDefault()
        active.click()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        rove(rows, step(rows, active, event.key === 'ArrowDown' ? 1 : -1))
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        if (rows.length) rove(rows, event.key === 'Home' ? rows[0] : rows[rows.length - 1])
      }
    }

    shell.panel.addEventListener('keydown', onKey)

    instance.paint = paint
    instance.focusFirst = function () {
      if (rows.length) rove(rows, rows[0])
    }
    instance.sync = function () {
      state = instance.snapshot()
      paint()
    }
    state = instance.snapshot()
    paint()
    return instance
  }

  function createPair(options) {
    var model = createModelSelect(options)
    var effort = createEffortSelect(options)
    return {
      model: model,
      effort: effort,
      sync: function () {
        model.sync()
        effort.sync()
      },
      /* Called by the host once the two triggers are in the document. Until then
       * neither has a measured width, so the fit has nothing to work from and the
       * first paint leaves the type at its base size.
       *
       * Only the model half observes: it is the half that owns a fit. The effort
       * trigger is one glyph plus one short word, sized by its content, so there is
       * nothing to re-fit and a second observer on the same parent would only wake
       * the same callback twice. */
      watch: function () {
        if (typeof model.watch === 'function') model.watch()
      },
      destroy: function () {
        model.destroy()
        effort.destroy()
      }
    }
  }

  return {
    createModelSelect: createModelSelect,
    createEffortSelect: createEffortSelect,
    createPair: createPair,
    defaults: ZH
  }
})()
