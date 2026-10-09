/**
 * Structural self-check for EVA-Inspired-Theme.
 *
 * Pure Node, no dependencies, no network, no side effects: it reads the package and
 * fails loudly. It exists because every claim this package makes about itself —
 * "one removable layer", "no hash class names", "unmodified tokens are absent",
 * "client.js is in sync with src/" — is a claim that a later edit can silently
 * break. Run it before every hand-off.
 *
 * Usage:
 *   node tools/selfcheck.mjs
 *   node tools/selfcheck.mjs --quiet
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')
const exists = (relative) => existsSync(join(ROOT, relative))

const results = []
let group = 'general'
const checks = {
  group: (name) => { group = name },
  check: (id, description, fn) => {
    let ok = false
    let detail = ''
    try {
      const outcome = fn()
      if (outcome === true || outcome === undefined) ok = true
      else if (typeof outcome === 'string') { detail = outcome }
      else { ok = false; detail = String(outcome) }
    } catch (error) {
      detail = `threw: ${error.message}`
    }
    results.push({ group, id, description, ok, detail })
  },
}

/* ------------------------------------------------------------------- inputs */

const pkg = JSON.parse(read('package.json'))
const tokensDoc = JSON.parse(read('src/tokens.json'))
const wallpapers = JSON.parse(read('build/wallpapers.json'))
const budget = JSON.parse(read('build/veil-budget.json'))
const TOKENS = tokensDoc.tokens
const tokenNames = Object.keys(TOKENS)
const css = read('src/theme.css')
/* The boot mask rides in the SAME paint-layer tag, so the selector/colour checks
   below run over both sheets: what ships as one stylesheet is what gets checked. */
const bootCss = read('src/boot-screen.css')
const bootJs = read('src/boot-screen.js')
/* The half that actually mounts the theme is a file too since 2026-10-07, interpolated
   verbatim next to the mask's behaviour: the bundle must carry its bytes, not a
   retyped copy of them (cli.21/cli.22). */
const clientJs = read('src/client.js')
const paintCss = css + '\n' + bootCss
const client = read('client.js')
const index = read('index.js')
const patch = read('cordis.patch.yml')

/* A CSS-Modules hash looks like `BynINW_frame` — a random base62 prefix, an
 * underscore, then the local name. A rebuild is free to change it, which is exactly
 * why a theme must not select on one. */
const HASH_CLASS = /\.(?:[A-Za-z0-9_-]*[A-Z0-9][A-Za-z0-9_-]{4,}_[A-Za-z][A-Za-z0-9_-]*)/g

/* ------------------------------------------------------------------ package */

checks.group('package')
checks.check('pkg.1', 'package.json parses and declares the agreed name', () => {
  if (pkg.name !== 'EVA-Inspired-Theme') return `name is ${pkg.name}`
  return true
})
checks.check('pkg.2', 'main points at index.js', () => pkg.main === 'index.js')
checks.check('pkg.3', 'exports has ".", "./client" and "./package.json"', () => {
  const want = ['.', './client', './package.json']
  const missing = want.filter((key) => !(key in (pkg.exports ?? {})))
  return missing.length === 0 || `missing ${missing.join(', ')}`
})
checks.check('pkg.4', 'exports["./client"] resolves to the committed client.js', () =>
  (pkg.exports?.['./client'] === './client.js' && exists('client.js')) ||
  `exports["./client"] = ${pkg.exports?.['./client']}`)
checks.check('pkg.5', 'dsh.bundle.patch points at cordis.patch.yml', () =>
  pkg.dsh?.bundle?.patch === './cordis.patch.yml')
checks.check('pkg.6', 'dsh.client declares platform web', () =>
  pkg.dsh?.client?.platform === 'web')
checks.check('pkg.7', 'dsh.client is immediately: true', () =>
  pkg.dsh?.client?.immediately === true)
checks.check('pkg.8', 'dsh.client injects ui-theme and ui-renderer', () => {
  const inject = pkg.dsh?.client?.inject ?? []
  const want = ['@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-ui-renderer']
  return want.every((id) => inject.includes(id)) || `inject = ${JSON.stringify(inject)}`
})
checks.check('pkg.9', 'files[] covers the four-piece set', () => {
  const files = pkg.files ?? []
  const want = ['index.js', 'client.js', 'cordis.patch.yml']
  const missing = want.filter((f) => !files.includes(f))
  return missing.length === 0 || `missing ${missing.join(', ')}`
})
checks.check('pkg.10', 'peerDependencies declares @deepseek-ai/cordis', () =>
  '@deepseek-ai/cordis' in (pkg.peerDependencies ?? {}))
checks.check('pkg.11', 'that peer dependency is optional', () =>
  pkg.peerDependenciesMeta?.['@deepseek-ai/cordis']?.optional === true)
checks.check('pkg.12', 'no runtime dependencies (nothing to install)', () =>
  Object.keys(pkg.dependencies ?? {}).length === 0 ||
  `dependencies = ${JSON.stringify(pkg.dependencies)}`)

/* ---------------------------------------------------------------- four piece */

checks.group('four-piece')
for (const file of ['package.json', 'index.js', 'client.js', 'cordis.patch.yml']) {
  checks.check(`file.${file}`, `${file} exists`, () => exists(file))
}
checks.check('file.src-tokens', 'src/tokens.json exists (token source of truth)', () =>
  exists('src/tokens.json'))
checks.check('file.src-theme', 'src/theme.css exists (paint source of truth)', () =>
  exists('src/theme.css'))
checks.check('file.build-walls', 'build/wallpapers.json exists', () =>
  exists('build/wallpapers.json'))

/* ------------------------------------------------------------------- tokens */

checks.group('tokens')
checks.check('tok.1', 'token count matches the A+B plan (41+13 = 54)', () =>
  tokenNames.length === 54 || `found ${tokenNames.length}`)
checks.check('tok.2', 'meta.tokenCount agrees with the map', () =>
  tokensDoc.meta.tokenCount === tokenNames.length)
checks.check('tok.3', 'every token has a light value', () => {
  const bad = tokenNames.filter((t) => !TOKENS[t]?.light)
  return bad.length === 0 || `missing light: ${bad.join(', ')}`
})
checks.check('tok.4', 'every token has a dark value', () => {
  const bad = tokenNames.filter((t) => !TOKENS[t]?.dark)
  return bad.length === 0 || `missing dark: ${bad.join(', ')}`
})
checks.check('tok.5', 'no token carries an extra mode key', () => {
  const bad = tokenNames.filter((t) => {
    const keys = Object.keys(TOKENS[t] ?? {})
    return keys.length !== 2 || !keys.includes('light') || !keys.includes('dark')
  })
  return bad.length === 0 || `bad shapes: ${bad.join(', ')}`
})
checks.check('tok.6', 'every token name is an official --dsw-/--ds-/--dsh- token', () => {
  const bad = tokenNames.filter((t) => !/^--(dsw|ds|dsh)-/.test(t))
  return bad.length === 0 || `off-prefix: ${bad.join(', ')}`
})
checks.check('tok.7', 'the two translucent surfaces carry an alpha byte', () => {
  const surfaces = budget.surfaces
  const bad = surfaces.filter((s) => !/^#[0-9a-f]{8}$/i.test(TOKENS[s]?.dark ?? '') ||
    !/^#[0-9a-f]{8}$/i.test(TOKENS[s]?.light ?? ''))
  return bad.length === 0 || `no alpha: ${bad.join(', ')}`
})
checks.check('tok.8', 'emitted alpha equals the solved veil alpha', () => {
  const problems = []
  for (const surface of budget.surfaces) {
    for (const mode of ['dark', 'light']) {
      const want = Math.round(budget.modes[mode].chosenAlpha * 255)
      const got = parseInt((TOKENS[surface][mode] ?? '').slice(7, 9), 16)
      if (got !== want) problems.push(`${surface}/${mode}: ${got} != ${want}`)
    }
  }
  return problems.length === 0 || problems.join(', ')
})
checks.check('tok.9', 'no opaque-colour token was left with an alpha byte', () => {
  const translucent = new Set(budget.surfaces)
  const bad = tokenNames.filter((t) => !translucent.has(t) &&
    /^#[0-9a-f]{8}$/i.test(TOKENS[t].dark) === false &&
    /^#[0-9a-f]{4}$/i.test(TOKENS[t].dark))
  return bad.length === 0 || `short hex: ${bad.join(', ')}`
})
checks.check('tok.10', 'no unmodified token slipped in (spot-check official originals)', () => {
  /* Three tokens whose official values are known and which this theme deliberately
   * does NOT change. If one of them appears with the official value it means an
   * unchanged token was declared, which P0 forbids. */
  const forbidden = {
    '--dsw-alias-label-primary': ['#0f1115', '#f9fafb'],
    '--dsw-alias-bg-base': ['#fff', '#151517'],
    '--dsh-content-font-size': null,
  }
  const problems = []
  for (const [token, officials] of Object.entries(forbidden)) {
    if (!(token in TOKENS)) continue
    if (officials === null) { problems.push(`${token} is in the C layer but was declared`); continue }
    for (const mode of ['dark', 'light']) {
      const value = TOKENS[token][mode]
      if (officials.some((o) => o.toLowerCase() === value.toLowerCase())) {
        problems.push(`${token}/${mode} still the official ${value}`)
      }
    }
  }
  return problems.length === 0 || problems.join(', ')
})
checks.check('tok.11', 'the font-size family is absent from the token layer', () => {
  const banned = tokenNames.filter((t) => /content-font-(size|delta)/.test(t))
  return banned.length === 0 || `C-layer tokens declared: ${banned.join(', ')}`
})
checks.check('tok.12', 'the radius ladder is present and corner-shape is NOT overridden', () => {
  /* Round 6: `--dsw-corner-shape` was dropped from the map so the official rounded
     corners apply again. The absence is the point, so it is asserted as absence --
     a token declared at its official value never reaches this map (token-audit P0). */
  const want = ['--dsw-radius-xs', '--dsw-radius-sm',
    '--dsw-radius-md', '--dsw-radius-lg', '--dsw-radius-xl', '--dsw-radius-panel']
  const missing = want.filter((t) => !(t in TOKENS))
  if (missing.length !== 0) return `missing ${missing.join(', ')}`
  return !('--dsw-corner-shape' in TOKENS) || '--dsw-corner-shape is overridden again'
})
checks.check('tok.13', 'every token value is a non-empty string', () => {
  const bad = []
  for (const token of tokenNames) {
    for (const mode of ['light', 'dark']) {
      if (typeof TOKENS[token][mode] !== 'string' || TOKENS[token][mode].trim() === '') {
        bad.push(`${token}/${mode}`)
      }
    }
  }
  return bad.length === 0 || bad.join(', ')
})

/* --------------------------------------------------------------- paint layer */

checks.group('paint-layer')
checks.check('css.1', 'theme.css declares no color-scheme', () =>
  !/color-scheme\s*:/i.test(css) || 'theme.css sets color-scheme')
checks.check('css.2', 'theme.css paints the wallpaper', () =>
  /var\(--cp-wall\)/.test(css) || 'no --cp-wall reference')
checks.check('css.3', 'theme.css composites the veil over the art', () =>
  /linear-gradient\(\s*var\(--dsw-alias-bg-base\)/.test(css) ||
  'the veil gradient does not read the veil token')
checks.check('css.4', 'theme.css anchors the art to the viewport', () =>
  /* The art used to be a background layer, anchored with
   * `background-attachment: scroll, fixed`. Since 2026-10-06 it is `body::before`
   * (so it can be blurred), and a fixed POSITION is what anchors it now. */
  /body::before\s*\{[^}]*position:\s*fixed/.test(css) || 'the art layer is not fixed')
checks.check('css.5', 'theme.css selects the art per mode via data-ds-dark-theme', () =>
  /body\[data-ds-dark-theme\]\s*\{[^}]*--cp-wall:\s*var\(--cp-pick-dark\)/.test(css) ||
  'no per-mode art selection')
checks.check('css.6', 'theme.css contains no CSS-Modules hash class selector', () => {
  const hits = paintCss.match(HASH_CLASS)
  return hits === null || `hash selectors: ${[...new Set(hits)].join(', ')}`
})
checks.check('css.7', 'every selector in theme.css is body/:root/#root, a body pseudo-element, or a data-* contract', () => {
  /* Comments are stripped first. Without that, an English sentence inside a block
   * comment is parsed as a selector list — which is exactly how this check failed
   * the first time it ran. */
  const stripped = paintCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []
  for (const match of stripped.matchAll(/(^|\})\s*([^{}@][^{}]*?)\{/g)) {
    selectors.push(match[2])
  }
  const offenders = []
  for (const block of selectors) {
    for (const part of block.split(',')) {
      const sel = part.trim().replace(/\s+/g, ' ')
      if (sel === '') continue
      const allowed = sel === 'body' || sel === ':root' ||
        /\[data-[a-z-]+/.test(sel) || /^#root\b/.test(sel) || /^body:not\(/.test(sel) ||
        /* `body::before` is the art layer and `body::after` is the veil: they are
         * the background stack now, and they are still body-owned -- not a
         * component selector, which is what this check exists to forbid. */
        /^body::(before|after)$/.test(sel)
      if (!allowed) offenders.push(sel)
    }
  }
  return offenders.length === 0 || `non-contract selectors: ${offenders.join(' | ')}`
})
checks.check('css.8', 'theme.css invents no colour of its own', () => {
  /* Every colour in the sheet must come from a token or be `transparent`; a literal
   * hex would be a second source of truth for a colour the token layer owns. */
  const withoutComments = paintCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const literals = withoutComments.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? []
  return literals.length === 0 || `literal colours: ${literals.join(', ')}`
})
checks.check('css.9', 'the shell rescue empties rather than recolours', () => {
  const block = css.match(/\[data-slot='main'\][\s\S]*?\}/)?.[0] ?? ''
  return /background-color:\s*transparent\s*!important/.test(block) ||
  'shell rescue does not empty the wrappers'
})

checks.check('css.10', 'the plugins row is hidden by name, not by position', () => {
  /* The sidebar nav holds every panel row the composition registers -- the shipped
   * pair is plugin-manager's ('插件' / 'Plugins') and ui-schedule's ('自动化任务' /
   * 'Automation tasks'), order 0 and 10. A rule that hides that nav's buttons by
   * structure takes all of them, so the row has to be named. Comments are stripped
   * first: this sheet's prose quotes the selectors it explains. */
  const sheet = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rowRules = sheet.match(/[^{}]*nav\[aria-label\][^{}]*\{/g) ?? []
  const offenders = rowRules.filter(rule => !/aria-label='(?:插件|Plugins)'\]/.test(rule))
  if (offenders.length > 0) return `nav rows hidden without naming the row: ${offenders.join(' | ')}`
  const named = sheet.match(/nav\[aria-label\][^{}]*?aria-label='(?:插件|Plugins)'\]/g) ?? []
  return named.length >= 2 || `only ${named.length} of the row's two labels are named`
})

/* ------------------------------------------------------------------ boot mask */

checks.group('boot-screen')
/* 「闸门开启」 landed on 2026-10-06: two source files, three build changes, no host
   half. The checks below pin the parts that are silent when they break — an escaping
   slip that only shows up as an import failure, or a fallback clock that leaves a
   full-screen mask over the app forever. */
checks.check('boot.1', 'the behaviour layer can be interpolated without escaping', () => {
  const bad = [['backtick', /`/], ['template hole', /\$\{/], ['backslash', /\\/]]
    .filter(([, re]) => re.test(bootJs)).map(([name]) => name)
  return bad.length === 0 || `boot-screen.js contains ${bad.join(', ')}`
})
checks.check('boot.2', 'the five hard constraints are all in the behaviour layer', () => {
  const want = [
    ['wall-clock progress', /performance\.now\(\)/],
    ['dual clock', /requestAnimationFrame[\s\S]*setInterval|setInterval[\s\S]*requestAnimationFrame/],
    ['fuse', /bootFuse/],
    ['hard kill', /bootKill/],
    ['no transition reliance', /slide/],
  ]
  const missing = want.filter(([, re]) => !re.test(bootJs)).map(([name]) => name)
  return missing.length === 0 || `missing in boot-screen.js: ${missing.join(', ')}`
})
checks.check('boot.3', 'the paint rules ride in the theme tag, not a second sheet', () => {
  const build = read('tools/build-client.mjs')
  if (!/read\('src\/boot-screen\.css'\)/.test(build)) return 'the build does not read the boot css'
  if (!/read\('src\/boot-screen\.js'\)/.test(build)) return 'the build does not read the boot js'
  if (!/var BOOT_CSS = /.test(build)) return 'the boot css is not declared in the bundle'
  /* The concatenation that joins the three sheets into ONE tag lives in src/client.js
     since 2026-10-07, so it is checked where it is written now. cli.21 separately
     proves that file reaches the bundle byte for byte, which is what keeps looking
     here equivalent to looking at the generated text. */
  return /\+\s*'\\n'\s*\+\s*CSS\s*\+\s*'\\n'\s*\+\s*BOOT_CSS/.test(clientJs) ||
    'the boot css is not appended to the paint layer text'
})
checks.check('boot.4', 'client.js mounts the mask and destroys it on the same channel', () => {
  if (!/function mountBootScreen\(\)/.test(client)) return 'mountBootScreen is missing'
  if (!/return destroyBoot/.test(client)) return 'mountBootScreen returns no disposer'
  if (!/ctx\.effect\(\(\) => mountBootScreen\(\), 'evangelion: boot screen'\)/.test(client)) {
    return 'the boot effect is not registered'
  }
  return /--eva-boot-progress/.test(client) || 'the boot css never made it into the bundle'
})
checks.check('boot.5', 'every documented way to skip the mask exists', () => {
  const want = [
    ['?boot=0', /boot=0/],
    ["localStorage '0'", /getItem\(BOOT_KEY\) === '0'/],
    ['reduced motion', /prefers-reduced-motion/],
    ['per-load mark', /__evaBootMark/],
  ]
  const missing = want.filter(([, re]) => !re.test(client)).map(([name]) => name)
  return missing.length === 0 || `missing in client.js: ${missing.join(', ')}`
})
/* There is no startup chime any more (2026-10-07): the user asked for the mask to stay
   and the sound to go (「去掉启动音效，只保留遮罩！」). This is the old handshake assertion
   turned around — if either end of /eva-theme/api/boot-sound comes back, the pair is
   inconsistent again, and the page would be asking a route that no longer exists. */
checks.check('boot.6', 'the mask asks the host for no chime', () => {
  if (/eva-theme\/api\/boot-sound/.test(bootJs)) return 'boot-screen.js still asks for the chime'
  return !/eva-theme\/api\/boot-sound/.test(client) || 'the old request is still in client.js'
})

/* ---------------------------------------------------------------- client.js */

checks.group('client')
checks.check('cli.1', 'client.js is a __ModuleLoader__.load call', () =>
  /window\.__ModuleLoader__\.load\(\{/.test(client))
checks.check('cli.2', 'the loader id matches the package name', () =>
  client.includes(`id: ${JSON.stringify(pkg.name)}`) || 'loader id differs from pkg.name')
checks.check('cli.3', 'no color-scheme is written', () =>
  !/color-scheme\s*[:=]/i.test(client) || 'client.js writes color-scheme')
checks.check('cli.4', 'the dark-theme attribute is never written', () => {
  const writes = /setAttribute\(\s*['"]data-ds-dark-theme|toggleAttribute\(\s*['"]data-ds-dark-theme|dataset\.dsDarkTheme\s*=/.test(client)
  return !writes || 'client.js writes the app-owned theme attribute'
})
checks.check('cli.5', 'theme.setTheme() is never called', () =>
  !/setTheme\s*\(/.test(client) || 'client.js calls theme.setTheme()')
checks.check('cli.6', 'the token layer is mounted inside ctx.effect', () => {
  /* The override is called once, from inside the token-layer effect, and nowhere
     else. Since round 6 there is no settings panel, so the override is mounted from
     the shipped map directly instead of from a re-appliable helper -- matching the
     literal call inside the effect body is now the whole invariant. */
  const calls = client.match(/overrideTokens\(/g) ?? []
  if (calls.length !== 1) return `overrideTokens is called ${calls.length} times, expected exactly 1`
  return /ctx\.effect\(\(\) => \{\s*var dispose = theme\.overrideTokens\([\s\S]*?\}, 'evangelion: token layer'\)/.test(client) ||
    'the token-layer effect does not call theme.overrideTokens()'
})
checks.check('cli.7', 'the token layer returns a disposer that retracts the override', () =>
  /return \(\) => \{ if \(typeof dispose === 'function'\) dispose\(\) \}/.test(client) ||
  'no token disposer')
checks.check('cli.8', 'the paint layer appends one <style> inside ctx.effect', () =>
  /tag\.textContent = WALLPAPER_DECLARATIONS/.test(client) &&
  /document\.head\.appendChild\(tag\)/.test(client))
checks.check('cli.9', 'the paint layer returns a disposer that removes the element', () => {
  /* 2026-10-07: the disposer also retracts the reduced-motion attribute it publishes
     on <body>, so this assertion now pins the BEHAVIOUR -- a returned arrow function
     whose body removes the tag -- instead of the single-statement shape it had. The
     anchor is the appendChild that installs the tag, so an earlier `return () => {}`
     elsewhere in the bundle (the vendored switch has several) cannot satisfy it.
     2026-10-07 (round 19): the window went from 900 to 1600 characters, because the
     paint layer also wired the selected-title marquee between installing its sheet
     and returning the disposer. 2026-10-07 (round 20): that marquee was removed
     again (round 21 then deleted the static rainbow that briefly replaced it, so
     theme.css paints nothing on the selected title now), so the gap is short again --
     the window is deliberately left at 1600 anyway. It is a reach window, not a
     size bound: what the assertion pins is a returned arrow function whose body
     calls tag.remove(), and re-tightening the number would re-bind this check to
     the effect's size, which is the very thing the window exists to avoid. */
  const at = client.indexOf('document.head.appendChild(tag)')
  if (at < 0) return 'the paint layer never appends its tag'
  const tail = client.slice(at, at + 1600)
  return /return\s*\(\)\s*=>\s*\{[\s\S]*?tag\.remove\(\)/.test(tail) || 'no style disposer'
})
checks.check('cli.10', 'both effects are named for the effect log', () =>
  /'evangelion: token layer'/.test(client) && /'evangelion: paint layer'/.test(client))
checks.check('cli.11', 'the plugin injects the theme service', () => {
  const match = client.match(/exports\.inject = \[([^\]]*)\]/)
  if (match === null) return 'exports.inject not found'
  const names = match[1].split(',').map((part) => part.trim().replace(/['"]/g, '')).filter(Boolean)
  return names.includes('theme') || `exports.inject = [${match[1]}]`
})
/* Round 6 (2026-10-06) removed the EVA 主题 settings panel at the user's request:
   the look is fixed, not a preference. The session tint layer that arrived the same
   day was removed again on 2026-10-07 (also at the user's request), and it took the
   last WRITE to browser storage with it. What is left is the boot mask reading its
   own one-shot flag: reads yes, writes no. */
checks.check('cli.11b', 'no settings.section registration any more', () =>
  !/settings\.section|slots\.inject|slots\.register/.test(client) ||
  'client.js still registers a settings section')
checks.check('cli.11c', 'the client half never writes browser storage', () => {
  if (/localStorage\.setItem/.test(client)) return 'client.js writes browser storage'
  if (!/localStorage\.getItem\(BOOT_KEY\) === '0'/.test(client)) {
    return 'the boot mask lost its one-shot flag read'
  }
  return true
})
checks.check('cli.11d', 'the client half owns exactly seven effects', () => {
  /* Five are the theme's own (token layer, liquid-glass maps, paint layer, boot mask,
     and since round 25 the brand row's three-zone bridge).
     The other two come from the vendored plugin-toggle switch: it registers its own
     disposer plus one for its locale dictionaries from inside its apply(), so they
     count here but carry its own labels, not ours. */
  const effects = client.match(/ctx\.effect\(/g) ?? []
  if (effects.length !== 7) return `${effects.length} ctx.effect() calls, expected exactly 7`
  if (!/tag\.dataset\.pluginCss = PLUGIN_ID \+ '\/theme\.css'/.test(client)) {
    return 'the paint layer is not namespaced'
  }
  if (!/'evangelion: boot screen'/.test(client)) return 'the boot mask effect has no label'
  if (!/'evangelion: brand row zones'/.test(client)) return 'the brand row bridge has no label'
  return /applyPluginToggle\(ctx\)/.test(client) || 'the vendored toggle is never applied'
})
/* Round 24 (2026-10-07): liquid glass. The two halves of the effect live in two
   files on purpose -- the sheet names a filter by id, and src/client.js draws the
   displacement map, because the map's bevel is a distance in px and feImage stretches
   whatever it is handed across the filter region, so one fixed map would scale its own
   bevel with the element. That split is exactly the kind of thing that rots quietly:
   rename one id and the surfaces keep rendering -- with the blur-only fallback line,
   which looks close enough to ship. So both directions are pinned, plus the two
   invariants that make the fallback real: the blur line has to precede the url() line
   (an engine that cannot parse url() drops that declaration, not the earlier one), and
   the map has to be drawn per element rather than fixed. */
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')
checks.check('glass.1', 'the sheet names the liquid-glass filters the client half builds', () => {
  const named = [...new Set([...cssRules.matchAll(/url\(#(eva-lg-[a-z-]+)\)/g)].map((m) => m[1]))]
  /* Two since the borderless round: the composer card and the six guide entries in
     the right column. Both were asked for by name, so the count is pinned rather
     than left open — a third surface must come with a third declared intent. */
  if (named.length !== 2) {
    return `${named.length} liquid-glass filter ids in the sheet, expected 2`
  }
  for (const id of named) {
    if (!clientJs.includes(`'${id}'`)) {
      return `${id} is referenced by the sheet but never built in src/client.js`
    }
  }
  const built = [...new Set([...clientJs.matchAll(/id: '(eva-lg-[a-z-]+)'/g)].map((m) => m[1]))]
  if (built.length !== named.length) {
    return `src/client.js builds ${built.length} glass filters, the sheet names ${named.length}`
  }
  return true
})
checks.check('glass.2', 'every url() filter keeps its blur-only fallback in front of it', () => {
  const rules = cssRules.split('}').filter((rule) => rule.includes('url(#eva-lg-'))
  /* One rule per id glass.1 counts: the composer card's rule and the guide's rule. */
  if (rules.length !== 2) return `${rules.length} rules name a url() glass filter, expected 2`
  for (const rule of rules) {
    for (const prop of ['backdrop-filter', '-webkit-backdrop-filter']) {
      const blur = rule.indexOf(`${prop}: blur(`)
      const url = rule.indexOf(`${prop}: url(`)
      if (url === -1) return `${prop} never names the url() filter in one glass rule`
      if (blur === -1 || blur > url) {
        return `${prop} names url() before its blur-only fallback`
      }
    }
  }
  return true
})
checks.check('glass.3', 'the displacement map is drawn per element, not inlined in the sheet', () => {
  if (/feDisplacementMap|feImage/.test(cssRules)) return 'the sheet carries the filter pipeline itself'
  if (!/feDisplacementMap/.test(clientJs) || !/feImage/.test(clientJs)) {
    return 'src/client.js no longer builds the displacement filter'
  }
  return /getBoundingClientRect/.test(clientJs) || 'the map is no longer measured from the element'
})
/* The switch is VENDORED, not rewritten: `build/plugin-toggle.js` is the upstream
   client bundle copied byte for byte, and the build slices its factory body into the
   theme. These two checks pin the provenance and the wiring, so nobody can quietly
   replace the copy with a hand-rolled version. */
checks.check('cli.19', 'the plugin-toggle switch is the vendored upstream copy', () =>
  (/移植自 dsh-disable-unofficial-plugins v1\.3\.0/.test(client) &&
    /applyPluginToggle = \(function/.test(client)) ||
  'the vendored toggle block is missing from client.js')
checks.check('cli.20', 'the vendored switch still talks to the real remote service', () =>
  (/remote\.pluginManager/.test(client) && /setBundleEnabled/.test(client)) ||
  'the vendored switch lost its remote calls')
/* Extraction of 2026-10-07: the glue used to be written inline in the build template,
   where reading it meant reading a template string. It lives in `src/client.js` now and
   is interpolated verbatim, so the invariants are (a) that file stays simple enough to
   be copied, and (b) the bundle is shown to be carrying it — the last check compares the
   whole file against the bundle, which is the only way to prove "verbatim" and not
   "similar". */
checks.check('cli.21', 'the mounting half lives in src/client.js, verbatim', () => {
  if (!exists('src/client.js')) return 'src/client.js is missing'
  const banned = /[`]|\$\{/.exec(clientJs)
  if (banned !== null) {
    return `src/client.js carries ${JSON.stringify(banned[0])} at offset ${banned.index}`
  }
  const probe = "The theme's own client glue"
  if (!clientJs.includes(probe)) return 'src/client.js lost its header comment'
  if (!client.includes(probe)) return 'the bundle does not carry src/client.js'
  if (!client.includes(clientJs.replace(/\n$/, ''))) return 'the bundle carries a different copy'
  return /applyPluginToggle\(ctx\)/.test(clientJs) || 'src/client.js no longer applies the switch'
})
checks.check('cli.22', 'the build reads the mounting half instead of inlining it', () => {
  const builder = read('tools/build-client.mjs')
  if (!builder.includes("read('src/client.js')")) return 'the build never reads src/client.js'
  return /\$\{clientJs\}/.test(builder) || 'the template does not interpolate clientJs'
})
checks.check('cli.12', 'client.js embeds every token from src/tokens.json', () => {
  const embedded = client.match(/var TOKENS = (\{.*?\})\n\n/s)
  if (embedded === null) return 'TOKENS block not found'
  const parsed = JSON.parse(embedded[1])
  const missing = tokenNames.filter((t) => JSON.stringify(parsed[t]) !== JSON.stringify(TOKENS[t]))
  return missing.length === 0 || `differs: ${missing.join(', ')}`
})
checks.check('cli.13', 'client.js embeds the paint layer verbatim', () => {
  const embedded = client.match(/var CSS = ("(?:[^"\\]|\\.)*")/)
  if (embedded === null) return 'CSS block not found'
  return JSON.parse(embedded[1]) === css || 'CSS differs from src/theme.css'
})
checks.check('cli.14', 'client.js carries both wallpaper data URLs', () => {
  const missing = wallpapers.filter((w) => !client.includes(w.dataUrl.slice(0, 64)))
  return missing.length === 0 || `missing art: ${missing.map((w) => w.id).join(', ')}`
})
checks.check('cli.15', 'client.js is not stale: it names the current wallpaper ids', () => {
  const missing = wallpapers.filter((w) => !client.includes(`--cp-wall-${w.id}`))
  return missing.length === 0 || `stale ids: ${missing.map((w) => w.id).join(', ')}`
})
checks.check('cli.16', 'client.js is not stale: the manifest token count is current', () =>
  client.includes(`"tokens":${tokenNames.length}`) ||
  `manifest token count is not ${tokenNames.length}`)
checks.check('cli.17', 'client.js contains no CSS-Modules hash class name', () => {
  const hits = client.match(HASH_CLASS)
  return hits === null || `hash names: ${[...new Set(hits)].slice(0, 5).join(', ')}`
})
checks.check('cli.18', 'no absolute local path leaked into the bundle', () => {
  /* Concrete machine-specific markers, not a general "letter colon backslash"
   * pattern: the bundle legitimately contains JSON-escaped `\n` sequences, and a
   * loose regex matches those instead of a path (it did, on the first run). */
  const markers = [
    /[A-Za-z]:\\\\?(?:Users|DSH|Program|Windows|tmp|AppData|home)\b/i,
    /\/Users\/[A-Za-z0-9._-]+/,
    /\/home\/[A-Za-z0-9._-]+/,
    /AppData/,
    /<user>/,
  ]
  const hits = markers.flatMap((re) => client.match(new RegExp(re, 'g')) ?? [])
  return hits.length === 0 || `local paths: ${[...new Set(hits)].join(', ')}`
})

/* ---------------------------------------------------------------- host half */

checks.group('host')
checks.check('host.1', 'index.js exports name and apply', () =>
  /module\.exports = \{\s*name:/.test(index) && /\bapply,/.test(index))
checks.check('host.2', 'index.js exports no Config (option A, by design)', () =>
  !/Config\s*[,:}]/.test(index.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')) ||
  'index.js exports a Config')
checks.check('host.3', 'index.js carries no dead schemastery resolution machinery', () =>
  !/require\.resolve\(/.test(index) || 'index.js resolves schemastery but has no Config')
checks.check('host.4', 'the settings-schema assertions are declared inapplicable', () => {
  /* The S3 spec lists "settings schema fields are strings" and "all volatile". With
   * option A there is no schema; the honest form is to assert its absence (host.2,
   * host.3) rather than to assert nothing. This check records that the pairing is
   * deliberate, so a future Config cannot be added without revisiting them. */
  const declaresA = /option A|exports no `Config`|no `Config`/.test(index)
  return declaresA || 'index.js does not state which option it implements'
})
checks.check('host.5', 'the host half cannot throw out of apply()', () => {
  const body = index.match(/function apply\(ctx\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  return /try\s*\{/.test(body) || 'apply() has no try/catch around its logging'
})
/* The sound layer is the one part of the host half that fails SILENTLY: a missing
   wav, a non-PCM file or a dropped trigger costs a sound and nothing else. These
   checks pin what silence would hide. */
checks.check('host.6', 'the sound layer keeps the upstream triggers and its debounce', () => {
  const want = [
    ['plan/done split at turn end', /agent\/turn-stopping/],
    ['agent question', /ask_user_question/],
    ['approval request', /approval\/request/],
    ['turn error', /agent\/error/],
    ['per-kind debounce', /DEBOUNCE_MS/],
    ['execution-tool whitelist', /DEFAULT_EXEC_TOOLS/],
    ['plan-mode fallback off the session log', /foldPlanModeFromEvents/],
    ['windows player', /Media\.SoundPlayer/],
    ['macOS player', /afplay/],
    ['linux player', /paplay/],
  ]
  const missing = want.filter(([, re]) => !re.test(index)).map(([name]) => name)
  return missing.length === 0 || `missing in index.js: ${missing.join(', ')}`
})
checks.check('host.7', 'all four sounds ship as PCM wav, and only those four', () => {
  const kinds = ['plan', 'done', 'ask', 'fail']
  const bad = []
  for (const kind of kinds) {
    const file = join(ROOT, 'sounds', kind + '.wav')
    if (!existsSync(file)) { bad.push(kind + ': missing'); continue }
    const head = readFileSync(file).subarray(0, 36)
    const riff = head.subarray(0, 4).toString('ascii')
    const wave = head.subarray(8, 12).toString('ascii')
    const format = head.readUInt16LE(20)
    if (riff !== 'RIFF' || wave !== 'WAVE' || format !== 1) {
      bad.push(`${kind}: ${riff}/${wave}/fmt${format}`)
    }
  }
  /* The startup chime used to be the fifth file. It is gone rather than orphaned, so
     the directory has to hold exactly these four — an extra wav is a stale artifact.
     Since the 2026-10-07 port these four are UPSTREAM perlica-ding's own voice files,
     baked to 60% volume; that provenance (format, length, sample peak, sha256 against
     the recorded upstream peaks) is what `tools/check-sound-layer.mjs` recomputes, so
     this check stays on container shape alone. */
  const shipped = readdirSync(join(ROOT, 'sounds')).filter((name) => name.endsWith('.wav')).sort()
  const expected = [...kinds].map((kind) => kind + '.wav').sort()
  if (shipped.join(' ') !== expected.join(' ')) bad.push(`sounds/: ${shipped.join(' ')}`)
  return bad.length === 0 || bad.join(', ')
})
checks.check('host.8', 'the sounds directory is part of the published files', () =>
  (pkg.files ?? []).includes('sounds') || 'files[] does not list sounds')
checks.check('host.9', 'no absolute local path leaked into index.js', () => {
  /* cli.18's counterpart for the host half, and the same markers — minus `Windows`
   * and `Program`: the one-shot player ships a FIXED system path on purpose
   * (`…\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`), which is not a leak.
   * This is the assertion that keeps a diagnostic log from writing to a checkout
   * again: from 2026-10-07 a `trace()` helper appended to an absolute path under
   * `_work/`, on every sound decision, so running this very file wrote outside the
   * package. It went out with the resident player it diagnosed. */
  const markers = [
    /[A-Za-z]:\\\\?(?:Users|DSH|AppData|home)\b/i,
    /\/Users\/[A-Za-z0-9._-]+/,
    /\/home\/[A-Za-z0-9._-]+/,
    /AppData/,
    /<user>/,
  ]
  const hits = markers.flatMap((re) => index.match(new RegExp(re, 'g')) ?? [])
  return hits.length === 0 || `local paths: ${[...new Set(hits)].join(', ')}`
})
checks.check('host.10', 'a sound is read from the package, never from the cwd', () =>
  !/process\.cwd\(\)/.test(index) ||
  'index.js resolves a wav against process.cwd(): a predictable path is not an audio source')
/* The startup chime is gone (2026-10-07) and gone means gone: no kind, no route, no
   file. The behaviour gate proves nothing spawns and nothing registers; this pins the
   package's shape, so an orphan wav or a half-removed bridge cannot survive. */
checks.check('host.11', 'the startup chime, its route and its wav are all gone', () => {
  /* The header deliberately still NAMES the removed route in prose, so this matches the
     quoted path as code (single quotes) instead of the bare word. */
  if (/'\/eva-theme\/api\/boot-sound'/.test(index)) return 'index.js still routes to boot-sound'
  if (/registerSoundBridge|webServer/.test(index)) return 'index.js still carries the chime bridge'
  if (!/const SOUND_KINDS = \['plan', 'done', 'ask', 'fail'\]/.test(index)) {
    return 'SOUND_KINDS is not the four task sounds'
  }
  return !existsSync(join(ROOT, 'sounds', 'startup.wav')) || 'sounds/startup.wav is still shipped'
})
/* The 2026-10-07 port took upstream's kernel and left its preferences surface behind:
   no Config schema, no settings namespace, no loopback bridge, no settings page, no
   custom-sound lookup (cwd / OS sound directory), and no runtime file of any kind. The
   user asked for exactly that (「去掉该插件中的自定义音效功能和配置功能」), and it is the
   kind of thing that creeps back in as a "harmless" option, so it is pinned. */
checks.check('host.12', 'the port left the preference and custom-sound surface behind', () => {
  /* Comments are stripped first: the header deliberately NAMES what it left behind
     (`scaleWavVolume`, `@deepseek-ai/schemastery`), and a text-level assertion that
     scans prose fails on the very comment documenting the removal. */
  const code = index
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const bad = []
  if (/schemastery/.test(code)) bad.push('imports @deepseek-ai/schemastery')
  if (/export const Config|module\.exports\.Config/.test(code)) bad.push('exports a Config schema')
  if (/settings\s*\.\s*register/.test(code)) bad.push('registers a settings namespace')
  if (/currentVolume/.test(code)) bad.push('reads a live volume preference')
  if (/perlica-ding\/api|scaleWavVolume/.test(code)) bad.push('keeps the upstream bridge or wav scaler')
  if (/soundDir|SYSTEM_SOUNDS/.test(code)) bad.push('resolves a custom sound directory')
  if (/node:os|require\(['"]os['"]\)|tmpdir\(\)/.test(code)) bad.push('reaches for a temp directory')
  if (/writeFileSync|appendFileSync|createWriteStream|mkdirSync/.test(code)) {
    bad.push('writes to disk at runtime')
  }
  if (existsSync(join(ROOT, 'lib'))) bad.push('ships a lib/ (the upstream settings page lived there)')
  return bad.length === 0 || bad.join(', ')
})

/* ------------------------------------------------------------ patch layer */

checks.group('patch')
checks.check('patch.1', 'cordis.patch.yml is a top-level YAML array', () =>
  /^-\s/m.test(patch))
checks.check('patch.2', 'it contains exactly one entry: the theme itself', () => {
  const entries = patch.split('\n').filter((line) => /^-\s/.test(line))
  return entries.length === 1 || `${entries.length} top-level entries`
})
checks.check('patch.3', 'that entry is an insert of one row', () => {
  const inserts = patch.match(/^\s*-\s*insert:\s*$/gm) ?? []
  return inserts.length === 1 || `${inserts.length} insert entries`
})
checks.check('patch.4', 'the inserted row id and name agree with the package name', () => {
  const id = patch.match(/^\s*-\s*id:\s*(\S+)/m)?.[1]
  const name = patch.match(/^\s*name:\s*['"]?([^'"\n]+)['"]?\s*$/m)?.[1]
  if (id === undefined || name === undefined) return 'id/name not found'
  if (name !== pkg.name) return `name ${name} != package name ${pkg.name}`
  return true
})
checks.check('patch.5', 'the patch does not disable or reconfigure anything official', () =>
  !/disabled\s*:/.test(patch) && !/^\s*config\s*:/m.test(patch) ||
  'patch disables or configures a row')
/* The companion mount for dsh-auto-title was removed on 2026-10-07: the row never
   mounted anything, because the profile neither lists that package in
   dsh.profile.bundles nor depends on it (GET/POST /api/dsh-auto-title answered a
   framework 404). The check that used to pin the companion row now pins the smaller
   shape — this layer mounts the theme and nothing else — so a removed feature cannot
   come back by accident. */
checks.check('patch.6', 'the patch mounts nothing but the theme', () =>
  (!/^\s*-\s*id:\s*auto-title\s*$/m.test(patch) &&
    !/^\s*name:\s*['"]?dsh-auto-title['"]?\s*$/m.test(patch)) ||
  'a companion row is present again')

/* -------------------------------------------------------------- wallpapers */

checks.group('wallpaper')
checks.check('wall.1', 'both modes have exactly one default wallpaper', () => {
  const defaults = wallpapers.filter((w) => w.role === 'default')
  const modes = new Set(defaults.map((w) => w.mode))
  return (defaults.length === 2 && modes.size === 2) ||
  `${defaults.length} defaults across ${modes.size} modes`
})
checks.check('wall.2', 'every wallpaper is a webp data URL', () => {
  const bad = wallpapers.filter((w) => !w.dataUrl.startsWith('data:image/webp;base64,'))
  return bad.length === 0 || bad.map((w) => w.id).join(', ')
})
checks.check('wall.3', 'no wallpaper was upscaled past its source', () => {
  const bad = wallpapers.filter((w) => w.resampled !== 'down' && w.resampled !== 'none')
  return bad.length === 0 || bad.map((w) => `${w.id}:${w.resampled}`).join(', ')
})
checks.check('wall.4', 'each shipped width is <= its source width', () => {
  const bad = wallpapers.filter((w) => {
    const [sw] = w.shippedResolution.split('x').map(Number)
    const [ow] = w.sourceResolution.split('x').map(Number)
    return sw > ow
  })
  return bad.length === 0 || bad.map((w) => w.id).join(', ')
})
checks.check('wall.5', 'every wallpaper carries attribution', () => {
  const bad = wallpapers.filter((w) => !w.credit || !w.page)
  return bad.length === 0 || bad.map((w) => w.id).join(', ')
})
checks.check('veil.1', 'the veil budget is present and solved for both modes', () => {
  const modes = Object.keys(budget.modes ?? {})
  if (modes.length !== 2) return `modes = ${modes.join(', ')}`
  const unsolved = modes.filter((m) => typeof budget.modes[m].chosenAlpha !== 'number')
  return unsolved.length === 0 || `unsolved: ${unsolved.join(', ')}`
})
checks.check('veil.2', 'the strict (tertiary) contract is recorded, not hidden', () => {
  const modes = Object.keys(budget.modes ?? {})
  const recorded = modes.every((m) => budget.modes[m].strictContract !== undefined)
  return recorded || 'strictContract missing from the budget'
})

/* ---------------------------------------------------------------- dark freeze */

// Dark mode was FROZEN by the user on 2026-10-08: 「暗色模式不动，就此固定下来，以后不得再
// 做任何变更」. Light mode stays editable, and the two modes no longer have to share a
// scheme -- the borderless idea is the only constraint they still hold in common. These
// two checks pin dark's implementation so a later light-mode edit cannot drift it by
// accident. Recompute the digest ONLY after a user-approved dark change:
//   node -e "const c=require('node:crypto');const t=require('./src/tokens.json');const p=Object.entries(t.tokens).map(([k,v])=>[k,v.dark]).sort((a,b)=>a[0]<b[0]?-1:1);console.log(c.createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0,16))"
const DARK_TOKENS_SHA = '8b21c97a5e815eaf'
const DARK_VEIL_ALPHA = 0.35
const DARK_VEILED = {
  '--dsw-alias-bg-base': '#1a132559',
  '--dsw-specific-sidebar-fill': '#1a132559',
}

checks.check('dark.1', 'dark is frozen: veil alpha 0.35, both veiled surfaces byte-identical', () => {
  const alpha = tokensDoc.meta?.veilAlpha?.dark
  if (alpha !== DARK_VEIL_ALPHA) return `dark veil alpha = ${alpha}, frozen at ${DARK_VEIL_ALPHA}`
  for (const [token, value] of Object.entries(DARK_VEILED)) {
    const got = tokensDoc.tokens?.[token]?.dark
    if (got !== value) return `${token} dark = ${got}, frozen at ${value}`
  }
  return true
})

checks.check('dark.2', 'dark is frozen: every dark token value unchanged since the freeze', () => {
  const pairs = Object.entries(tokensDoc.tokens ?? {})
    .map(([k, v]) => [k, v.dark])
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
  const got = createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, 16)
  return got === DARK_TOKENS_SHA || `dark token digest = ${got}, frozen at ${DARK_TOKENS_SHA}`
})

/* -------------------------------------------------------------------- report */

const failed = results.filter((r) => !r.ok)
if (!process.argv.includes('--quiet')) {
  let current = ''
  for (const row of results) {
    if (row.group !== current) {
      current = row.group
      console.log(`\n${current}`)
    }
    const mark = row.ok ? '  ok  ' : ' FAIL '
    console.log(`${mark} ${row.id.padEnd(16)} ${row.description}`)
    if (!row.ok && row.detail) console.log(`         -> ${row.detail}`)
  }
}

console.log(`\n${results.length} assertions, ${failed.length} failed, ` +
  `${results.length - failed.length} passed`)
if (failed.length > 0) {
  console.log('\nfailed:')
  for (const row of failed) console.log(`  ${row.id}  ${row.description}  (${row.detail})`)
  process.exit(1)
}
console.log('all green')
