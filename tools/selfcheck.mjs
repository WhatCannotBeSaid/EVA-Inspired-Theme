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
const budget = JSON.parse(read('build/veil-budget.json'))
/* Fonts ride in the same bundle as the wallpaper data URLs (build-client.mjs reads this
   record and emits the @font-face), so their provenance is checkable the same way. */
const fonts = JSON.parse(read('build/fonts.json'))
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

/* Which wallpaper manifest these checks describe (D79, revised D81, 2026-10-09). A
   built bundle has three states and each has its own manifest rule: art embedded (a
   machine that holds the pictures) reads the LOCAL, ignored manifest; art by URL (a
   fresh checkout, or `--public`) reads the TRACKED manifest, which carries addresses
   instead of bytes; and an empty manifest is the no-art build, where every art
   assertion below goes vacuous rather than wrong. `client.js` is ignored by git, so
   the file on disk is the SPECIMEN and it is what tells the first two apart. The
   TRACKED manifest is also checked on its own terms by wall.6 — that is the file a
   push would carry. */
const LOCAL_WALLPAPERS = 'out/wallpapers.local.json'
const clientHasArt = client.includes('data:image/webp;base64,')
const wallpaperFile = clientHasArt && exists(LOCAL_WALLPAPERS) ? LOCAL_WALLPAPERS : 'build/wallpapers.json'
const wallpapers = JSON.parse(read(wallpaperFile))
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
checks.check('pkg.4', 'exports["./client"] resolves to the built client.js', () =>
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
checks.check('tok.1', 'token count matches the A+B plan (41+14 = 55)', () =>
  tokenNames.length === 55 || `found ${tokenNames.length}`)
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

checks.check('css.11', 'the workspace pin button is styled by contract, not by hash class', () => {
  /* Round 39 (2026-10-09). The button is injected by src/client.js, so the only thing this
   * sheet may key on is the theme's own data attribute -- a CSS-Modules class name would
   * break on the next rebuild (css.6). The official `.iconButton` box is copied verbatim
   * (16x16, radius-xs, no border, no background) so the control lands on the pixels the
   * two official buttons beside it already occupy. */
  const sheet = css.replace(/\/\*[\s\S]*?\*\//g, '')
  if (!/\[data-eva-ws-pin-button\]\s*\{/.test(sheet)) return 'the pin button has no rule'
  if (!/\[data-eva-ws-pin-state='on'\]\s*\{/.test(sheet)) return 'the pinned state has no rule'
  const box = sheet.match(/\[data-eva-ws-pin-button\]\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  if (!/width:\s*16px/.test(box) || !/height:\s*16px/.test(box)) {
    return 'the pin button does not copy the official 16x16 icon box'
  }
  if (!/border-radius:\s*var\(--dsw-radius-xs\)/.test(box)) {
    return 'the pin button does not copy the official icon radius'
  }
  return /color:\s*var\(--dsw-alias-label-tertiary\)/.test(box) ||
    'the pin button does not start on the official tertiary label colour'
})

checks.check('css.12', 'the WeChat entry is styled by contract, and the switch owns its group', () => {
  /* Rounds 41-44 (2026-10-09/10) styled two entries on one contract, `data-eva-tg-*`. Round 45
   * removed the Telegram one and renamed what is left to `data-eva-wx-*`, so nothing in the
   * sheet is named after the feature the user retired. The entry button is injected by
   * src/client.js either way, so this sheet may key only on the theme's own data attributes.
   * The official header icon-button box is copied verbatim (28x28, radius-sm, no border, no
   * background, secondary label) so the control lands on the pixels the three official buttons
   * beside it already occupy, and no rule may hide a group or a header unless the theme's own
   * tag on the tree is part of the selector. */
  const sheet = css.replace(/\/\*[\s\S]*?\*\//g, '')
  if (!/\[data-eva-wx-button\]\s*\{/.test(sheet)) return 'the WeChat entry has no rule'
  if (!/\[data-eva-wx-state='on'\]\s*\{/.test(sheet)) return 'the lit state has no rule'
  const box = sheet.match(/\[data-eva-wx-button\]\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  if (!/width:\s*28px/.test(box) || !/height:\s*28px/.test(box)) {
    return 'the entry does not copy the official 28x28 header icon box'
  }
  if (!/border-radius:\s*var\(--dsw-radius-sm\)/.test(box)) {
    return 'the entry does not copy the official header icon radius'
  }
  if (!/color:\s*var\(--dsw-alias-label-secondary\)/.test(box)) {
    return 'the entry does not start on the official secondary label colour'
  }
  /* Both directions of the switch have to be in the sheet: the group is out while the entry is
   * dark, and every other group is out while it is lit. One rule alone would leave the user
   * with a list that only ever grows. */
  const off = sheet.match(/\[data-eva-wx-tree='off'\]\s*\[data-eva-wx-group='on'\]\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  if (!/display:\s*none/.test(off)) return 'the dark state does not take the group out of the list'
  const on = sheet.match(/\[data-eva-wx-tree='on'\]\s*>\s*:not\(\[data-eva-wx-group='on'\]\)\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  if (!/display:\s*none/.test(on)) return 'the lit state does not take the other groups out of the list'
  /* Every rule that names a group or a header must also name the tree, so a group can never be
   * hidden by the sheet alone -- the theme's own tag on the tree is part of the selector. */
  const hideRules = sheet.match(/[^{}]*\[data-eva-wx-(?:group|head)[^{}]*\{/g) ?? []
  const loose = hideRules.filter((rule) => !/\[data-eva-wx-tree=/.test(rule))
  if (loose.length > 0) {
    return `a group is hidden outside the tree the theme tagged: ${loose.join(' | ')}`
  }
  /* Round 45: the Telegram half is gone, so its contract may not be left behind in the sheet. */
  return !/data-eva-tg/.test(sheet) || 'the retired Telegram contract is still styled'
})



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
    ['already played this build', /getItem\(BOOT_SEEN_KEY\) === BOOT_MARK/],
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
  /* 2026-10-09: the sheet text now goes through shortenDataUrls() first, which
     re-declares the wallpaper bitmaps as blob URLs (see src/client.js). The anchor
     keeps its meaning -- the sheet is still built from WALLPAPER_DECLARATIONS and
     still appended by the paint layer -- so only the optional call is allowed in. */
  /tag\.textContent = (?:shortenDataUrls\()?WALLPAPER_DECLARATIONS/.test(client) &&
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
  /* The LAST appendChild in the bundle, not the first. Since 2026-10-09 the vendored
     session-status rail is mounted before the theme's own glue and it also appends a
     style tag bound to a local named `tag`, so the first occurrence is now the vendored
     one -- anchoring there would test somebody else's disposer against our shape. The
     theme's paint layer is the last block in the bundle, so lastIndexOf is the anchor. */
  const at = client.lastIndexOf('document.head.appendChild(tag)')
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
   last WRITE to browser storage with it. What is left is the boot mask and its flags.
   Round 26 (2026-10-08): 「启动屏只播首次」 — the mask records that it already played
   this build, so exactly ONE storage write is allowed, and it is named below. Any
   other write, a preference above all, still fails this check. */
checks.check('cli.11b', 'no settings.section registration any more', () =>
  !/settings\.section|slots\.inject|slots\.register/.test(client) ||
  'client.js still registers a settings section')
checks.check('cli.11c', 'the client half writes browser storage only for the two named keys', () => {
  /* Round 39 (2026-10-09) added the second and, by intent, last write: the set of
     pinned Workspaces. It has to live in the browser -- see the workspace-pins effect in
     src/client.js for why no host-side door exists (no node_modules of its own, no
     `@deepseek-ai/cordis` anywhere on this disk, no filesystem writes, no routes, no
     Config) -- and it is named here so that any further write still fails this check. */
  const writes = [...client.matchAll(/localStorage\.setItem\(([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  const allowed = ['BOOT_SEEN_KEY', 'PIN_KEY']
  const stray = writes.filter((name) => !allowed.includes(name))
  if (stray.length > 0) return 'client.js writes browser storage outside the named keys: ' + stray.join(', ')
  if (!writes.includes('BOOT_SEEN_KEY')) return 'the boot mask never records that it played'
  if (!writes.includes('PIN_KEY')) return 'the workspace pin set is never written'
  if (!/localStorage\.setItem\(BOOT_SEEN_KEY,\s*BOOT_MARK\)/.test(client)) {
    return 'the boot one-shot write does not store BOOT_MARK'
  }
  if (!/localStorage\.getItem\(BOOT_SEEN_KEY\) === BOOT_MARK/.test(client)) {
    return 'the boot mask never checks whether it already played'
  }
  if (!/localStorage\.getItem\(BOOT_KEY\) === '0'/.test(client)) {
    return 'the boot mask lost its off-switch read'
  }
  return true
})
checks.check('cli.11d', 'the client half owns exactly ten effects', () => {
  /* Five are the theme's own (token layer, liquid-glass maps, paint layer, boot mask,
     and since round 25 the brand row's three-zone bridge).
     Two come from the vendored plugin-toggle switch: it registers its own disposer plus
     one for its locale dictionaries from inside its apply(), so they count here but
     carry its own labels, not ours.
     The eighth (2026-10-09) is the vendored session-status rail's own disposer, also
     registered from inside its apply().
     The ninth (round 39, 2026-10-09) is the theme's own workspace-pin effect.
     The tenth is the 工作区 row's entry, which rounds 41-44 grew into two controls and round
     45 (2026-10-10) cut back to one: the Telegram filter it was born as was removed at the
     user's word (「再去telegram按钮，毕竟现在不用了，可以删去这个功能了。」) and the 微信
     switch beside it -- rounds 42 to 44 -- is all that is left, under its own label. The
     effect was renamed, never added or split: the count is the same 10 it has been since
     round 41. */
  const effects = client.match(/ctx\.effect\(/g) ?? []
  if (effects.length !== 10) return `${effects.length} ctx.effect() calls, expected exactly 10`
  if (!/tag\.dataset\.pluginCss = PLUGIN_ID \+ '\/theme\.css'/.test(client)) {
    return 'the paint layer is not namespaced'
  }
  if (!/'evangelion: boot screen'/.test(client)) return 'the boot mask effect has no label'
  if (!/'evangelion: brand row zones'/.test(client)) return 'the brand row bridge has no label'
  if (!/'evangelion: workspace pins'/.test(client)) return 'the workspace pin effect has no label'
  if (!/'evangelion: wechat workspace switch'/.test(client)) return 'the WeChat switch has no label'
  if (!/applyPluginToggle\(ctx\)/.test(client)) return 'the vendored toggle is never applied'
  return /applySessionEvaStatus\(ctx\)/.test(client) || 'the vendored session rail is never applied'
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
/* The second vendor (2026-10-09): `build/session-eva-status.js` is the upstream client
   bundle of the user's `dsh-session-eva-status` v0.1.0, copied byte for byte and sliced
   into the theme the same way the switch is. The two checks below exist for the same
   reasons cli.19/cli.20 do: the copy must stay the upstream copy (no hand-rolled
   replacement under the same name), and it must still read the real services -- plus the
   invariant that makes those reads safe, that the theme's own exports.inject names the
   same services the vendored body requires, or apply() could run before they exist. */
checks.check('cli.23', 'the session status rail is the vendored upstream copy', () =>
  (/移植自 dsh-session-eva-status v0\.1\.0/.test(client) &&
    /applySessionEvaStatus = \(function/.test(client)) ||
  'the vendored session-status block is missing from client.js')
checks.check('cli.24', 'the vendored rail still reads the real session services', () => {
  const reads = ["requireService(ctx, 'uiSession')", "requireService(ctx, 'workspaces')",
    "requireService(ctx, 'sessions')"]
  const missing = reads.filter((call) => !client.includes(call))
  if (missing.length > 0) return 'the vendored rail lost its service reads: ' + missing.join(', ')
  const match = client.match(/exports\.inject = \[([^\]]*)\]/)
  if (match === null) return 'exports.inject not found'
  const names = match[1].split(',').map((part) => part.trim().replace(/['"]/g, '')).filter(Boolean)
  const absent = ['uiSession', 'sessions', 'workspaces'].filter((name) => !names.includes(name))
  return absent.length === 0 ||
    `exports.inject is missing ${absent.join(', ')} — apply() could run before they exist`
})
/* D78 (2026-10-09): the rail is the one vendored block the theme patches by hand, so the
   three patches are pinned here. cli.23 only checks the provenance markers, not the body:
   a refresh of the upstream copy (D29/D77) that silently drops a patch would be a silent
   performance regression. This is a tripwire for those three spots, not a hash. */
checks.check('cli.27', 'the vendored rail still carries its three theme-side patches', () => {
  const patches = [
    ['the frame-coalesced schedule', /frame = window\.requestAnimationFrame\(\(\) => \{/],
    ['the compare-then-write pin attribute',
      /if \(row\.getAttribute\(PIN_ATTR\) !== 'true'\) row\.setAttribute\(PIN_ATTR, 'true'\)/],
    ['the disposal of the pending frame', /window\.cancelAnimationFrame\(frame\)/],
  ]
  const missing = patches.filter(([, re]) => !re.test(client)).map(([name]) => name)
  return missing.length === 0 || `the vendored rail lost its patches: ${missing.join(', ')}`
})
/* D79 (2026-10-09): the switch is the second vendored block the theme patches by hand, so
   the same reasoning as cli.27 applies — cli.19/cli.20 only check the provenance markers and
   the remote calls, not the body. Five spots, all performance-only, none of them behavioural:
   a refresh of the upstream copy that silently drops one would be a silent regression.
   D82 (2026-10-10) added a sixth, and it *is* behavioural: the vendored switch now excludes
   its host bundle as well as SELF, so the theme stops listing itself as disableable. That one
   regresses invisibly too — the button merely reappears in its own list — so it is pinned
   here as well, in the same one-entry-per-patch shape. */
checks.check('cli.28', 'the vendored switch still carries its six theme-side patches', () => {
  const patches = [
    ['the reload sequence guard', /const seq = \(reloadSeq \+= 1\);/],
    ['the single-slot reload debounce', /if \(!busy\) scheduleReload\(\);/],
    ['the compare-then-write button text', /function setText\(el, text\) \{/],
    ['the throttled body redraw', /force === true \|\| now - lastBodyAt >= BODY_REDRAW_MS/],
    ['the Set-based reason dedupe', /new Set\(blocked\.map\(\(bundle\) => bundle\.readOnlyReason\)\)/],
    /* Either half alone is useless — a probe nothing calls, or a call to a name that no longer
       exists — so patch f's single entry asserts both, by lookahead rather than by adjacency
       (the probe and its only call site are ~150 lines apart in the file). */
    ['the host-bundle exclusion (D82)',
      /(?=[\s\S]*function isSelfBundle\(name\) \{)(?=[\s\S]*if \(isSelfBundle\(bundle\.name\)\) continue;)/],
  ]
  const missing = patches.filter(([, re]) => !re.test(client)).map(([name]) => name)
  return missing.length === 0 || `the vendored switch lost its patches: ${missing.join(', ')}`
})
/* Round 39 (2026-10-09): the workspace pin control. It is the theme's own code, so it is
   held to the theme's own standard: the row hook it selects on is the official data
   attribute's real shape (a workspace row keys itself on its own id, and the ungrouped
   bucket is the same prefix with an empty suffix), the artwork is the official pin path
   data verbatim rather than a redrawn lookalike, the move is the official service call
   rather than a local reorder, and the two labels go through the locale service the
   vendored switch already proved out. */
checks.check('cli.25', 'the workspace pin control is injected and moves rows officially', () => {
  if (!/var ROW_PREFIX = 'workspace:'/.test(client)) {
    return 'the workspace row prefix is not the official one'
  }
  if (!/list\.subscribe\(schedule\)/.test(client)) return 'the pin effect never follows the workspace list'
  if (!/workspaces\.insertBefore\(id, beforeId\)/.test(client)) {
    return 'the pin effect never moves a row through the official service'
  }
  if (!/locale\.register\(NS, DICT\)/.test(client)) {
    return 'the pin labels are not registered with the locale service'
  }
  const head = 'M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605'
  const tail = 'M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457'
  if (!client.includes(head) || !client.includes(tail)) {
    return 'the pin artwork is not the official path data'
  }
  return /data-eva-ws-pin-button/.test(client) || 'the pin control carries no contract attribute'
})
/* Rounds 41-44 (2026-10-09/10): the 工作区 row's entry button. Round 41 made it a Telegram
   conversation filter, round 42 added a 微信 one beside it, rounds 43-44 turned the 微信 one
   into a switch on the dsh-wechat-plugin workspace, and round 45 removed the Telegram one at
   the user's word (「再去telegram按钮，毕竟现在不用了，可以删去这个功能了。」). What is left
   is one control, and it is held to the theme's own standard: the workspace is recognised by
   the title its own plugin enforces rather than a workspace uuid (which would break on another
   machine, a reinstall or a second profile), a folded group is unfolded through its own header
   -- the click a user makes -- rather than by any private expansion, and the labels go through
   the locale service. Nothing is persisted and nothing is inserted, moved or deleted: the
   switch is attributes on the rows plus rules in the sheet. */
checks.check('cli.26', 'the WeChat entry switches one workspace through the official controls', () => {
  if (!/var SLOT_SELECTOR = "\[data-slot='sidebar\.workspaces'\]"/.test(client)) {
    return 'the switch does not key on the official workspaces slot'
  }
  if (!/var MARK_SELECTOR = "\[data-slot='sidebar\.workspaces\.directoryFlow'\]"/.test(client)) {
    return 'the switch does not key the header row on the official marker slot'
  }
  if (!/var WX_GROUP_LABEL = '微信会话'/.test(client)) {
    return 'the switch does not name the workspace by the title its plugin enforces'
  }
  if (!/var WORKSPACE_PREFIX = 'workspace:'/.test(client)) {
    return 'the switch does not read the official workspace row prefix'
  }
  if (!/key === WORKSPACE_PREFIX\) continue/.test(client)) {
    return 'the switch would match the Ungrouped bucket as the workspace'
  }
  if (!/if \(row\.textContent\.replace\(\/\^\[ \\t\\r\\n\]\+\/, ''\)\.replace\(\/\[ \\t\\r\\n\]\+\$\/, ''\) !== WX_GROUP_LABEL\) continue/.test(client)) {
    return 'the switch does not trim the row text before comparing it'
  }
  if (!/scope\.querySelectorAll\('\[data-row-key\]'\)/.test(client)) {
    return 'the switch does not walk the rows by their official key attribute'
  }
  if (!/function wxGroup\(host\)/.test(client) || !/node\.parentElement !== host/.test(client)) {
    return 'the switch does not walk up to the tree child that holds the group'
  }
  if (!/function wxHeadBox\(group, row\)/.test(client)) {
    return 'the switch cannot take the group header off without its conversations'
  }
  if (!/aria-expanded/.test(client) || !/head\.click\(\)/.test(client)) {
    return 'the switch does not unfold a folded group through its own header'
  }
  if (!/locale\.register\(NS, DICT\)/.test(client)) {
    return 'the entry labels are not registered with the locale service'
  }
  if (!/var sessions = ctx\.get\('sessions'\)/.test(client) || !/list\.subscribe\(schedule\)/.test(client)) {
    return 'the switch never follows the session list'
  }
  if (!/attributeFilter: \['data-row-key'\]/.test(client)) {
    return 'the switch does not watch the row key, so its own writes would re-enter it'
  }
  if (!/data-eva-wx-button/.test(client)) return 'the entry carries no contract attribute'
  if (!/var state = wxOn \? 'on' : 'off'/.test(client)) {
    return 'the switch does not write both directions of its tree attribute'
  }
  if (!/host\.removeAttribute\(WX_TREE_ATTR\)/.test(client) || !/tagged\.removeAttribute\(GROUP_ATTR\)/.test(client)) {
    return 'the switch cannot put the list back the way it found it'
  }
  if ((client.match(/setAttribute\('title'/g) ?? []).length !== 1) {
    return 'the entry sets hover wording again (only the pin button may carry a title)'
  }
  /* Round 45: the retired contract and its machine may not be left behind in the client half. */
  return !/data-eva-tg/.test(client) || 'the retired Telegram contract is still written'
})
checks.check('cli.12', 'client.js embeds every token from src/tokens.json', () => {
  const embedded = client.match(/var TOKENS = (\{.*?\})\n\n/s)
  if (embedded === null) return 'TOKENS block not found'
  const parsed = JSON.parse(embedded[1])
  const missing = tokenNames.filter((t) => JSON.stringify(parsed[t]) !== JSON.stringify(TOKENS[t]))
  return missing.length === 0 || `differs: ${missing.join(', ')}`
})
/* P5 (2026-10-09): the paint layer ships with its comments stripped (see the strip in
   tools/build-client.mjs). "Verbatim" therefore means verbatim-apart-from-comments, and
   the second half of the check pins the strip itself: a build that started shipping the
   comments again would still equal the source, but it would be back to 87 KB of comments
   in the CSSOM, which is the thing P5 removed. */
checks.check('cli.13', 'client.js embeds the paint layer, comments stripped', () => {
  const embedded = client.match(/var CSS = ("(?:[^"\\]|\\.)*")/)
  if (embedded === null) return 'CSS block not found'
  const shipped = JSON.parse(embedded[1])
  if (shipped !== css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    return 'CSS differs from src/theme.css (comments stripped)'
  }
  return !/\/\*/.test(shipped) || 'the embedded paint layer carries comments again'
})
checks.check('cli.14', 'client.js carries the art of every wallpaper it names', () => {
  /* Embedded art: proving the data URL is in the bundle needs a prefix, not a 700 KB
     comparison twice. Hotlinked art: the bundle must carry the address itself. */
  const missing = wallpapers.filter((w) => {
    if (typeof w.dataUrl === 'string' && w.dataUrl.length > 0) {
      return !client.includes(w.dataUrl.slice(0, 64))
    }
    return typeof w.direct === 'string' ? !client.includes(w.direct) : true
  })
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
  /* Scanned over the sources the theme OWNS (its glue, its two sheets, the boot mask)
     rather than over the whole bundle. Since 2026-10-09 the bundle also carries the
     vendored session-status rail, whose `{ ...DEFAULT_COLORS, ... }` spread is a false
     positive for a regex hunting hashed class names (`_COLORS`); the vendored copy is
     byte-fixed upstream code and not the theme's to police. The theme's own sources are
     what the bundle embeds verbatim (cli.21), so nothing of ours escapes this scan. */
  const hits = (clientJs + bootJs + css + bootCss).match(HASH_CLASS)
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
   * and `Program`: the one-shot player resolves its system path from `%SystemRoot%`
   * rather than a hard-coded drive letter, so those two markers can only fire on a
   * genuine leak and never on the player's own argv.
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
checks.check('wall.1', 'one default per mode, for the manifest this bundle was built from', () => {
  if (wallpapers.length === 0) return true
  const defaults = wallpapers.filter((w) => w.role === 'default')
  const modes = new Set(defaults.map((w) => w.mode))
  return (defaults.length === 2 && modes.size === 2) ||
  `${defaults.length} defaults across ${modes.size} modes`
})
checks.check('wall.2', 'every wallpaper is an embedded webp or a direct https URL', () => {
  const bad = wallpapers.filter((w) => {
    const art = typeof w.dataUrl === 'string' && w.dataUrl.length > 0
      ? w.dataUrl
      : (typeof w.direct === 'string' ? w.direct : '')
    return !art.startsWith('data:image/webp;base64,') && !/^https:\/\//.test(art)
  })
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

/* D79/D81 (2026-10-09) — the pair is the author's to look at, not ours to publish. The
   tracked manifest names it by URL and the bundle embeds nothing; these assertions are
   what keeps that true after the fact, because each failure is silent: a tracked
   manifest with bytes looks exactly like a provenance record, a committed bundle with
   art looks exactly like one without it until you search for `data:image/webp`, and a
   `direct:` URL the bundle never resolves would ship a background that is simply
   missing. */
checks.check('wall.6', 'the TRACKED manifest carries no image bytes', () => {
  const tracked = JSON.parse(read('build/wallpapers.json'))
  if (!Array.isArray(tracked)) return 'build/wallpapers.json is not an array'
  const withBytes = tracked.filter((w) => typeof w.dataUrl === 'string' && w.dataUrl.length > 0)
  return withBytes.length === 0 || `tracked, with bytes: ${withBytes.map((w) => w.id).join(', ')}`
})
checks.check('wall.7', 'client.js is ignored, so an art bundle cannot be committed', () =>
  /^client\.js\s*$/m.test(read('.gitignore')) ||
  '.gitignore does not ignore client.js')
checks.check('wall.8', 'the tracked manifest names its art by https URL and the bundle resolves it', () => {
  const tracked = JSON.parse(read('build/wallpapers.json'))
  if (!Array.isArray(tracked)) return 'build/wallpapers.json is not an array'
  const broken = tracked.filter((w) => typeof w.direct !== 'string' || !/^https:\/\//.test(w.direct))
  if (broken.length > 0) return `not an https URL: ${broken.map((w) => w.id).join(', ')}`
  /* A bundle that embeds its own art has no reason to carry these URLs; a bundle built
     from this manifest must carry every one of them, or the paint layer falls back to
     no background and nothing else would notice. */
  const unresolved = clientHasArt ? [] : tracked.filter((w) => !client.includes(w.direct))
  return unresolved.length === 0 || `client.js does not reference: ${unresolved.map((w) => w.id).join(', ')}`
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

/* --------------------------------------------------------------------- fonts */

checks.group('font')
checks.check('font.1', 'every embedded font carries attribution and a shipped licence text', () => {
  /* wall.5's shape, for the same reason: an asset whose terms are not in the package is
     an asset nobody can redistribute. OFL condition 2 makes the licence text itself part
     of the requirement, so it is asserted as a file that exists, not as a field. */
  const bad = fonts.filter((f) => !f.credit || !f.page || !f.license || !f.licenseFile || !exists(f.licenseFile))
  return bad.length === 0 || bad.map((f) => f.id).join(', ')
})
checks.check('font.2', 'each font record matches its file and the @font-face in the bundle', () => {
  const bad = []
  for (const font of fonts) {
    if (!exists(font.file)) { bad.push(`${font.id}: ${font.file} is missing`); continue }
    const bytes = readFileSync(join(ROOT, font.file)).length
    if (bytes !== font.bytes) bad.push(`${font.id}: ${bytes} bytes on disk, ${font.bytes} recorded`)
    if (!client.includes(`font-family: '${font.family}'`)) {
      bad.push(`${font.id}: client.js declares no @font-face for ${font.family}`)
    }
  }
  return bad.length === 0 || bad.join('; ')
})
checks.check('font.3', 'the hero headline cannot wrap: nowrap plus a container-relative size', () => {
  /* The headline row's width is not a function of its content -- measured identical with
     and without container queries at 41 viewport widths (520..2400) -- so a container unit
     tracks it and a linear vw formula does not. 5.3cqw was derived FROM this face's width
     factor, which is why the family is pinned here as well: swapping the face without
     re-deriving the coefficient is the one edit that silently reintroduces wrapping. */
  const missing = []
  const rule = css.match(/div:has\(> span > \[data-slot='conversation\.hero\.brand\.mark'\]\)[^{]*::before\s*\{[^}]*\}/)?.[0] ?? ''
  if (rule === '') missing.push('the headline ::before rule')
  else {
    if (!/white-space:\s*nowrap/.test(rule)) missing.push('white-space: nowrap')
    if (!/font-size:\s*min\([^)]*cqw/.test(rule)) missing.push('a container-relative font-size')
    if (!/font-family:\s*'Great Vibes'/.test(rule)) missing.push("font-family 'Great Vibes'")
  }
  if (!/div:has\(> span > \[data-slot='conversation\.hero\.brand\.mark'\]\)\s*\{[^}]*container-type:\s*inline-size/.test(css)) {
    missing.push('container-type: inline-size on the headline row')
  }
  return missing.length === 0 || `missing ${missing.join(', ')}`
})

/* ---------------------------------------------------------------- dark freeze */

// Dark mode was FROZEN by the user on 2026-10-08: 「暗色模式不动，就此固定下来，以后不得再
// 做任何变更」. Light mode stays editable, and the two modes no longer have to share a
// scheme -- the borderless idea is the only constraint they still hold in common. These
// two checks pin dark's implementation so a later light-mode edit cannot drift it by
// accident. Recompute the digest ONLY after a user-approved dark change:
//   node -e "const c=require('node:crypto');const t=require('./src/tokens.json');const p=Object.entries(t.tokens).map(([k,v])=>[k,v.dark]).sort((a,b)=>a[0]<b[0]?-1:1);console.log(c.createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0,16))"
// Recompute #1 (2026-10-08, round 26): 8b21c97a5e815eaf -> d29a6d36e8a444fc, WITH the
// user's approval (they chose "open the freeze once, change both modes" over "light only").
// Two things moved the digest and only one of them is a dark change: `--dsw-font-family`'s
// dark value went to the Roam `--body-font` stack, and the NEW key `--ds-font-family-code`
// entered the map (the digest covers every key, so adding a token moves it even when that
// token's dark value is untouched). Both modes ship the same two font stacks.
// Round 33 recomputed this to 48e69ac8f0e1ab24 for the D1 split; round 34 UNDID the split
// (the user put the body and the UI back under D1 alone, on the Roam `--body-font` stack), so
// the digest returns to the round-26 value. It is identical to Recompute #1 by construction:
// the same 55 keys with the same dark values.
const DARK_TOKENS_SHA = 'd29a6d36e8a444fc'
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
