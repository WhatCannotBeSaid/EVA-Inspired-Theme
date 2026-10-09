/**
 * Build `client.js` — the browser half of EVA-Inspired-Theme.
 *
 * Five inputs, one output, no interpretation in between:
 *
 *   src/tokens.json         the token layer's source of truth, both modes per token
 *   src/theme.css           the paint layer (wallpaper stack, shell rescue)
 *   build/wallpapers.json   the art, already encoded as data URLs
 *
 * Two more inputs joined on 2026-10-06 — the boot mask, 「闸门开启」:
 *
 *   src/boot-screen.css     paint rules, appended to the same paint-layer tag
 *   src/boot-screen.js      behaviour, interpolated verbatim
 *
 * And a third on 2026-10-07 — the glue that mounts all of it. It used to be written
 * inline in the template below, which is how a `.hIlkoa_*`-shaped review of a string
 * became the only way to read the half that actually mounts the theme:
 *
 *   src/client.js           apply(), the mount order and the exports map, verbatim
 *                           (same rule as the mask's behaviour: the file IS the code,
 *                           so it is neither re-indented nor re-quoted on the way in)
 *
 * The generated bundle is a single `window.__ModuleLoader__.load({...})` call,
 * which is the shape the client module loader expects a plugin's browser half to
 * have. Since 2026-10-09 (D79) it is NOT committed any more: `client.js` is ignored
 * by git and built right after a checkout, because two of its data URLs would be a
 * third party's picture and the remote must not carry them. What a fresh checkout
 * builds points at that picture instead (D81): the tracked manifest names its
 * address, and the bytes stay with whoever hosts them. A machine that keeps the
 * local art in `out/wallpapers.local.json` (also ignored) embeds its own copy with
 * no flag, and `--public` forces the tracked form on such a machine too.
 *
 * Why the art goes into variables rather than into the stylesheet
 * --------------------------------------------------------------
 * The two data URLs are ~700 KB together. Inlined into `src/theme.css` they would
 * make the paint layer unreadable and unreviewable; as custom properties the sheet
 * stays a document, and the images can be swapped without touching it. The build
 * still owns the pairing — which image each mode starts on — so there is exactly one
 * place where that pairing is written down: the wallpaper manifest, read by this
 * build. No image id is quoted in prose here, so swapping a wallpaper cannot leave a
 * stale name behind in a comment.
 *
 * Which manifest that is (2026-10-09, D79; revised the same day, D81)
 * ------------------------------------------------------------------
 * The art would otherwise ride in a tracked file, which is how it got onto the
 * remote the first time. So the manifest is split in two:
 *
 *   build/wallpapers.json      TRACKED. Two entries, each with a `direct:` URL that
 *                              names a third party's copy of the picture. The build
 *                              emits `url("https://…")`, so the theme keeps its
 *                              background while the repository holds no image bytes.
 *                              `--public` forces this file.
 *   out/wallpapers.local.json  LOCAL, ignored by git. The same shape, with the two
 *                              pairs the author keeps on this machine, each carrying
 *                              a `dataUrl:`. If it exists it wins, so the daily
 *                              driver keeps embedding its own art while nothing that
 *                              could be pushed ever carries it.
 *
 * An entry with both keys prefers `dataUrl`, so a machine that holds the file keeps
 * building exactly the bundle it built before.
 *
 * Two consequences worth stating out loud: a fresh clone builds a theme whose
 * background the browser fetches from the host named in the manifest (the plugin
 * itself still opens no socket), and redistributed bytes cannot come back by
 * accident — `client.js` is ignored, and the tracked manifest holds no `dataUrl:`,
 * which `npm run selfcheck` asserts.
 *
 * Usage:
 *   node tools/build-client.mjs            # write client.js (local art if it is there)
 *   node tools/build-client.mjs --public   # write client.js from the tracked manifest
 *   node tools/build-client.mjs --check    # fail if client.js is stale
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'EVA-Inspired-Theme'

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/* The manifest this build reads: the local pair when it is there (daily driver),
 * otherwise the tracked one (a fresh checkout, and always under `--public`). The
 * rule is stated in the header; tools/selfcheck.mjs resolves it the same way so the
 * gates describe the bundle this machine actually runs. */
const LOCAL_WALLPAPERS = 'out/wallpapers.local.json'
const publicBuild = process.argv.includes('--public')
const wallpaperFile = (!publicBuild && existsSync(join(ROOT, LOCAL_WALLPAPERS)))
  ? LOCAL_WALLPAPERS
  : 'build/wallpapers.json'

/* ------------------------------------------------------------------ inputs */

const tokensDoc = JSON.parse(read('src/tokens.json'))
const wallpapers = JSON.parse(read(wallpaperFile))
const css = read('src/theme.css')

/* P5 (2026-10-09): the paint layer ships with its comments stripped. They are most of
 * the sheet — 87,429 characters of which roughly 11,700 are live code — and every byte
 * of a `<style>` tag is parsed and then held in the CSSOM for the life of the page.
 * `src/theme.css` itself keeps every comment: they are the reasons for the rules, and
 * they are what a reviewer reads. The strip is the same naive block-comment pattern
 * tools/selfcheck.mjs already uses (css.7, cli.13); it runs on the paint layer only and
 * never on `declarations` — the art is a data URL, not CSS text. */
const cssPaint = css.replace(/\/\*[\s\S]*?\*\//g, '')

/* The boot mask (「闸门开启」) is two more inputs but no third stylesheet: its paint
 * rules are appended to the SAME `<style data-plugin-css>` tag as the paint layer,
 * and its behaviour layer is interpolated verbatim next to the vendored switch. The
 * file is inserted with `${…}` — verbatim — so it must contain no backtick, no `${`
 * and no backslash (that is the double-escaping lesson from 2026-10-06). */
const bootCss = read('src/boot-screen.css')
const bootJs = read('src/boot-screen.js')

/* The rule in the comment above now has teeth. `bootJs` is interpolated verbatim, so
 * one backtick in it would be read as this template's own terminator — the 2026-10-06
 * failure produced a bundle the app reported as "Failed to load plugins /
 * EVA-Inspired-Theme / import failed". tools/selfcheck.mjs (boot.1) asserts the same
 * thing after the fact; checking here stops the build before it can write the file. */
const bootVerbanned = /[`\\]|\$\{/.exec(bootJs)
if (bootVerbanned !== null) {
  throw new Error(
    'src/boot-screen.js must stay free of backticks, backslashes and template '
    + 'placeholders (tools/selfcheck.mjs boot.1); found ' + JSON.stringify(bootVerbanned[0])
    + ' at offset ' + bootVerbanned.index)
}

/* The theme's own glue is a file too, interpolated the same way, so the half that
 * mounts the theme can be read as code instead of as template text. It is allowed one
 * thing src/boot-screen.js is not — a literal backslash, because the paint layer joins
 * three sheets with '\n' — since nothing escapes this text on the way into the
 * template: a backslash here is data, not syntax. The final newline is dropped because
 * the template supplies the line break, which keeps the generated bytes identical to
 * the ones this extraction replaced. */
const clientJs = read('src/client.js').replace(/\n$/, '')
const clientVerbanned = /[`]|\$\{/.exec(clientJs)
if (clientVerbanned !== null) {
  throw new Error(
    'src/client.js must stay free of backticks and template placeholders; found '
    + JSON.stringify(clientVerbanned[0]) + ' at offset ' + clientVerbanned.index)
}

const TOKENS = tokensDoc.tokens
if (TOKENS === undefined || typeof TOKENS !== 'object') {
  throw new Error('src/tokens.json has no `tokens` object')
}

/* Each mode needs exactly one default. Zero entries is still a legal state — it puts
 * `--cp-pick-*` at `none`, the paint layer's documented no-art form — but since D81
 * the tracked manifest is no longer that state: it names two `direct:` URLs, one per
 * mode. One default per mode is required as soon as one entry exists, so the shipped
 * look cannot depend on array order. */
const defaults = {}
for (const paper of wallpapers) {
  if (paper.role !== 'default') continue
  if (defaults[paper.mode] !== undefined) {
    throw new Error(`two default wallpapers for mode "${paper.mode}"`)
  }
  defaults[paper.mode] = paper
}
if (wallpapers.length > 0) {
  for (const mode of ['light', 'dark']) {
    if (defaults[mode] === undefined) throw new Error(`no default wallpaper for mode "${mode}"`)
  }
}

/* ------------------------------------------------------- wallpaper block */

const variableFor = (paper) => `--cp-wall-${paper.id}`

/* The WHALE-01 SYSTEM brand mark: the user's transparent illustration replaces the
 * official whale logo in the `sidebar.brand.mark` slot. It rides in the same `:root`
 * block as the wallpapers as a data URL, so the theme remains one self-contained
 * bundle with no second file to fetch and no runtime path to resolve.
 *
 * D33 originally shipped separate daylight and dark marks. On 2026-10-07 the user
 * explicitly replaced the daylight mark with the dark one, so both modes now publish
 * the SAME `brand-mark-dark.png`. Do not keep a second unused data URL in the bundle:
 * the old daylight asset remains in `build/brand-mark.png` only for rollback, while
 * this build reads one file and emits one variable. The selected mark is cropped to
 * the subject, padded by 6%, and brighter than the retired daylight mark (solid-pixel
 * mean luminance 147 vs 106 of 255). Generator: `tools/make-brand-mark-dark.py`. */
const brandMark = readFileSync(join(ROOT, 'build', 'brand-mark-dark.png')).toString('base64')

/* ---------------------------------------------------------------- fonts (D75)
 * 2026-10-08, round 35: the user asked for the new-session headline in a calligraphic
 * face, free for commercial use, and never wrapping. The face is Great Vibes (SIL OFL
 * 1.1, 2015 The Great Vibes Pro Project Authors), and it is embedded HERE — as an
 * @font-face with a data URL — for the same reason the brand mark is: the theme stays
 * one self-contained bundle with no second file to fetch and no runtime path to
 * resolve, and nothing is installed on the user's machine.
 *
 * It is prepended to the declarations block that opens the paint layer's single
 * <style>, so it is a global declaration in the same sheet as the wallpaper variables
 * (and it cannot live in src/theme.css: the paint layer forbids `@` blocks — css.7).
 * The variable below keeps its old name because src/client.js and cli.8 pin that exact
 * expression; what it carries is "the declarations the paint tag opens with".
 *
 * Provenance is build/fonts.json (asserted by font.1/font.2), the licence text ships
 * next to the file in build/great-vibes-OFL.txt, and the byte count is checked against
 * the record so a swapped file cannot slip in under an old attribution. */
const fonts = JSON.parse(readFileSync(join(ROOT, 'build', 'fonts.json'), 'utf8'))
const fontFaces = fonts.map((font) => {
  const bytes = readFileSync(join(ROOT, font.file))
  if (bytes.length !== font.bytes) {
    throw new Error(
      `${font.file}: ${bytes.length} bytes on disk, fonts.json records ${font.bytes} — update the record`,
    )
  }
  return [
    '@font-face {',
    `  font-family: '${font.family}';`,
    '  font-style: normal;',
    '  font-weight: 400;',
    '  font-display: block;',
    `  src: url("data:font/${font.format};base64,${bytes.toString('base64')}") format('${font.format}');`,
    '}',
  ].join('\n')
})

/* ------------------------------------------------- caret metric face (D76)
 * 2026-10-08, round 36: the user reported, with a screenshot of the dark composer, that
 * the text caret is not flush with the text — it sits about 1px low, so its tail hangs
 * below the glyphs. Measured cause (8x native CDP captures, pixel masks): Chromium draws
 * the caret as a bar whose height is the LINE's dominant font metrics (ascent+descent),
 * its box being [baseline - a, baseline + d] with baseline = line top + (24 - (a+d))/2
 * + a, so the caret's centre sits (D_line - D_c)/2 below the line box's centre, D = a-d.
 * With the theme's serif stack the dominant face on this machine yields D ~ 8 at 14px
 * (TiemposText-Regular hhea 761/-239/1000; HYXuanSong-45S 1038/-276), while the INK of
 * both scripts has D ~ 10 (CJK 矮 ink [11,1], Latin H ink [9.88,0] px at 14px), so the
 * caret's centre lands 0.88-0.94px below the glyph centre.
 *
 * The only lever is the metrics: a face with the SAME glyphs and overridden ascent/
 * descent moves the line's baseline 1px down, which centres the glyphs on the caret.
 * `src` resolves to the theme's own Latin face by its PostScript name, so no file ships,
 * no glyph changes (CSS.getPlatformFontsForNode reports Tiempos Text / HYXuanSong before
 * and after, font-weight 400 unchanged), and the caret's own width, height, colour,
 * shape and blink are untouched (measured byte-identical). It is emitted here, next to
 * the Great Vibes faces, for the same reason: src/theme.css forbids `@` blocks (css.7).
 * The rule that applies it lives at the end of src/theme.css. Rollback = delete this
 * constant (and that rule). */
const caretFace = [
  '@font-face {',
  "  font-family: 'CP Caret Metric';",
  '  font-style: normal;',
  '  font-weight: 400;',
  "  src: local('TiemposText-Regular');",
  '  ascent-override: 85.714%;',
  '  descent-override: 14.286%;',
  '  line-gap-override: 0%;',
  '}',
].join('\n')

/* `none` is not a fallback invented here: it is the no-wallpaper state src/theme.css
 * documents, and it is what a build with an empty manifest publishes for BOTH modes
 * so `--cp-wall` still resolves — to nothing — instead of to an undefined variable. */
const pick = (mode) => defaults[mode] === undefined
  ? 'none'
  : `var(${variableFor(defaults[mode])})`

/* Which URL a wallpaper variable gets (D81, 2026-10-09). Two shapes are legal:
 * a `dataUrl:` entry — art this machine holds, embedded as before — and a
 * `direct:` entry, which is how the tracked manifest points at a third party's
 * picture without carrying its bytes. An entry with both prefers the embedded
 * art, so a machine that has the file builds the same bundle it always did. */
const artFor = (paper) => {
  const src = paper.dataUrl || paper.direct
  if (typeof src !== 'string' || src === '') {
    throw new Error(`wallpaper "${paper.id}" has neither a dataUrl nor a direct URL`)
  }
  return src
}

const declarations = [
  ...fontFaces,
  caretFace,
  ':root {',
  ...wallpapers.map((paper) => `  ${variableFor(paper)}: url("${artFor(paper)}");`),
  `  --cp-pick-light: ${pick('light')};`,
  `  --cp-pick-dark: ${pick('dark')};`,
  `  --cp-brand-mark: url("data:image/png;base64,${brandMark}");`,
  '}',
].join('\n')

/* ------------------------------------------- vendored: plugin toggle switch
 * 2026-10-06: the user asked to fold his own plugin `dsh-disable-unofficial-plugins`
 * v1.3.0 (MIT, same author — the display name in 设置 → 插件 is 「插件一键启停」) into
 * the theme, so one plugin does the skin AND the switch.
 *
 * This is a VENDOR, not a rewrite: `build/plugin-toggle.js` is the plugin's own
 * published client bundle, copied byte for byte, and what is embedded below is its
 * factory BODY (the part between `factory: () => {` and its final `return {...}`).
 * Re-implementing 1,300 lines of somebody's tested DOM code by hand would risk
 * silently changing behaviour; copying it keeps the switch identical and makes the
 * provenance checkable. Refresh it by copying the new lib/client.js over the copy.
 *
 * Two mechanical adaptations, both asserted so a future copy cannot drift silently:
 *   · the body is wrapped in an IIFE, so none of its ~90 top-level names can collide
 *     with the theme's own client code (`apply`, `sync`, `palette`, …);
 *   · nothing else — and that is deliberate. The body is injected with `${…}`
 *     INTERPOLATION, which copies the string verbatim, so its backticks and `${`
 *     need no escaping. (The first attempt escaped them anyway and produced a file
 *     containing a literal `\``, which broke the whole bundle: the app showed
 *     "Failed to load plugins / EVA-Inspired-Theme / import failed". Escaping is only
 *     ever needed for text written literally INSIDE this template, never for a value
 *     interpolated into it.)
 * Its `apply(ctx)` registers its own `ctx.effect` disposer, so the theme just calls
 * it once. The switch itself is inert until the remote/locale services exist. */
const VENDOR_OPEN = 'factory: () => {'
const VENDOR_TAIL = "return { name: SELF, apply, inject: ['remote', 'locale'] };"
const vendorSrc = readFileSync(join(ROOT, 'build', 'plugin-toggle.js'), 'utf8')
const vendorOpenAt = vendorSrc.indexOf(VENDOR_OPEN)
const vendorTailAt = vendorSrc.indexOf(VENDOR_TAIL)
if (vendorOpenAt < 0 || vendorTailAt < vendorOpenAt) {
  throw new Error('build/plugin-toggle.js: factory boundaries not found — re-vendor it')
}
const vendorBody = vendorSrc.slice(vendorOpenAt + VENDOR_OPEN.length, vendorTailAt)
if (!/function apply\(ctx\)/.test(vendorBody)) {
  throw new Error('build/plugin-toggle.js: the factory body has no apply(ctx)')
}
if (new RegExp(VENDOR_TAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(vendorBody)) {
  throw new Error('build/plugin-toggle.js: the tail marker leaked into the body')
}
const pluginToggleJs = [
  '    /* --- 移植自 dsh-disable-unofficial-plugins v1.3.0（MIT，同一作者）---',
  '     * 原样 vendor：下面这段是它 factory 的主体，只做了两处机械处理 ——',
  '     * 包进 IIFE 避免与主题自己的 ~90 个顶层名字撞车、并按模板字符串转义。',
  '     * 它自己的 apply(ctx) 会用 ctx.effect 注册清理，主题只负责调用一次。 */',
  '    var applyPluginToggle = (function () {',
  vendorBody,
  '    ; return apply })()',
].join('\n')

/* ------------------------------------------- vendored: session status rail
 * 2026-10-09: the same treatment for the user's other plugin, `dsh-session-eva-status`
 * v0.1.0 (MIT, same author) — the session list's left rail: one colour per state, a
 * breathing track while a session waits on the user, and the static rainbow on a pinned
 * row. It is VENDORED, not rewritten, for the reason D29 gives for the switch (the code
 * is tested; a hand copy would introduce silent behavioural drift), and the mechanical
 * handling below is the switch's, repeated rather than shared so each copy stays
 * readable on its own:
 *   · the factory body is sliced between its own boundaries — the cutter throws rather
 *     than guessing if either boundary is missing;
 *   · it is wrapped in an IIFE, because its top level owns module, exports, apply,
 *     PLUGIN_ID, STYLE_ID and a dozen more names that must not reach the theme's;
 *   · it is interpolated with `${…}` — verbatim — so its own backticks and `${` need no
 *     escaping (same lesson as the switch: escaping is only for text written literally
 *     inside a template, never for a value handed to it).
 * Its `apply(ctx, rawConfig)` registers its own `ctx.effect` disposer, so the theme
 * calls it once. The row in its own cordis.patch.yml carried exactly one config value,
 * hideOfficialDot: true, which is resolveConfig()'s own default, so the call passes
 * nothing. Refresh it by copying the new lib/client.js over the copy. */
const VENDOR_STATUS_OPEN = 'factory: () => {'
const VENDOR_STATUS_TAIL = 'return module.exports'
const statusSrc = readFileSync(join(ROOT, 'build', 'session-eva-status.js'), 'utf8')
const statusOpenAt = statusSrc.indexOf(VENDOR_STATUS_OPEN)
const statusTailAt = statusSrc.indexOf(VENDOR_STATUS_TAIL)
if (statusOpenAt < 0 || statusTailAt < statusOpenAt) {
  throw new Error('build/session-eva-status.js: factory boundaries not found — re-vendor it')
}
const statusBody = statusSrc.slice(statusOpenAt + VENDOR_STATUS_OPEN.length, statusTailAt)
if (!/function apply\(ctx, rawConfig\)/.test(statusBody)) {
  throw new Error('build/session-eva-status.js: the factory body has no apply(ctx, rawConfig)')
}
/* The cut has to land after the exports map: a body that still ended in
 * `return module.exports` would not hand back `apply` at all, and the bundle would
 * fail at load time rather than here. */
if (!/exports\.apply = apply/.test(statusBody)) {
  throw new Error('build/session-eva-status.js: the tail cut landed before the exports map')
}
const sessionEvaStatusJs = [
  '    /* --- 移植自 dsh-session-eva-status v0.1.0（MIT，同一作者）---',
  '     * 原样 vendor：下面这段是它 factory 的主体，只做了两处机械处理 ——',
  '     * 包进 IIFE（它顶层有 module / exports / apply / PLUGIN_ID 等名字，',
  '     * 不包会与主题自己的名字撞车），以及用 ${…} 直接插值。',
  '     * 它自己的 apply(ctx) 用 ctx.effect 注册清理，主题只负责调用一次。 */',
  '    var applySessionEvaStatus = (function () {',
  statusBody,
  '    ; return apply })()',
].join('\n')

/* ---------------------------------------------------------------- manifest */

const MANIFEST = {
  id: PLUGIN_ID,
  name: 'EVA-Inspired-Theme / 霓虹闸口',
  modes: { light: 'Daylight City', dark: 'Neon Night' },
  tokens: Object.keys(TOKENS).length,
  wallpapers: wallpapers.map((paper) => ({
    id: paper.id,
    name: paper.name,
    mode: paper.mode,
    role: paper.role,
    page: paper.page,
    direct: paper.direct,
    credit: paper.credit,
    shippedResolution: paper.shippedResolution,
    sourceResolution: paper.sourceResolution,
    meanLuminance: paper.meanLuminance,
  })),
  fonts: fonts.map((font) => ({
    id: font.id,
    name: font.name,
    family: font.family,
    role: font.role,
    page: font.page,
    direct: font.direct,
    credit: font.credit,
    license: font.license,
    licenseFile: font.licenseFile,
    file: font.file,
    format: font.format,
    subset: font.subset,
    bytes: font.bytes,
  })),
  veil: tokensDoc.meta.veilAlpha,
  byLayer: tokensDoc.meta.byLayer,
}


/* ------------------------------------------------------------- generation */

/* The banner names the manifest it actually read, and says which of the two states
 * this bundle is in. Both facts are otherwise invisible in a 1.1 MB file: a bundle
 * that embeds art, a bundle that points at art and a bundle with no art at all look
 * alike until you search for `data:image/webp` or for `https://`. */
const wallpaperNote = wallpapers.length === 0
  ? '\n *                          (no wallpaper in this build: the manifest is empty)'
  : (wallpaperFile === LOCAL_WALLPAPERS
    ? '\n *                          (from out/wallpapers.local.json — LOCAL, not in git, art embedded)'
    : '\n *                          (from the tracked manifest — art by URL, no image bytes)')

const banner = `/**
 * EVA-Inspired-Theme — browser client bundle. GENERATED FILE, DO NOT EDIT.
 *
 * Generated by tools/build-client.mjs from:
 *   src/tokens.json        ${MANIFEST.tokens} tokens, every one with a light and a dark value
 *   src/theme.css          the paint layer
 *   ${wallpaperFile}  ${MANIFEST.wallpapers.length} wallpapers (embedded art or URL)${wallpaperNote}
 *   build/fonts.json       ${MANIFEST.fonts.length} font, embedded as an @font-face data URL
 *
 * Eight blocks, nine effects — six of our own plus the two the vendored switch
 * installs and the one the vendored session-status rail installs — all mounted through \`ctx.effect\` so unloading the plugin retracts
 * everything it added:
 *
 *   1. theme.overrideTokens — the token layer. The service composes this over the
 *      active theme and writes it as inline custom properties on \`body\`, so it wins
 *      over the shipped declarations without a stylesheet of ours and without
 *      copying any value that was not deliberately changed. Two of the tokens ship
 *      as the wallpaper VEIL (their alpha is the number the contrast budget solved
 *      for), which is why they are also read by the paint layer.
 *
 *   2. an svg of filters — the liquid glass. The refraction map behind each glass
 *      surface is drawn here at the element's own pixel size (a map is not an input
 *      file; it is computed from the box), and the paint layer only names it by id.
 *      The split is forced: feImage stretches what it is given, so a fixed map would
 *      scale its own bevel with the element.
 *
 *   3. a plugin-owned <style> — the paint layer. A custom property can carry a
 *      colour but not a stack of composited background layers, so the art and its
 *      veil live in a stylesheet. It writes no colour of its own. Since round 35 it
 *      also opens with the hero face's @font-face (an inline data URL), so the font
 *      ships inside these same bytes and nothing is fetched or installed.
 *
 *   4. src/boot-screen.js — the startup mask: one overlay and one wall-clock
 *      timeline, taken down again by the same disposer. It is pure paint: since
 *      2026-10-07 it makes no request at all, and the startup chime it used to ask
 *      the host for is gone (see 2b in the host half's header).
 *
 *   5. the sidebar brand row's three zones (since round 25) — that row is ONE
 *      official button whose click starts a session, and two of the three labels
 *      drawn on it open surfaces this theme hides, so a capture-phase click
 *      listener reroutes by coordinate. It is the one effect that has to be a
 *      listener instead of a style: React delegates at #root, which sits BELOW
 *      document, so nothing registered later can win the event first.
 *
 *   6. the workspace list's pin control (round 39) — one button per workspace row,
 *      injected into that row's own action span, plus the durable reordering it drives.
 *      The set of pinned workspaces is the one thing this theme keeps in browser
 *      storage: the host half has no node_modules of its own, the remote protocol it
 *      would need has no cordis anywhere on this disk, and its two standing rules (no
 *      filesystem writes, no routes) together with "exports no Config" close every
 *      other door. The ORDER is already durable on the host, so each reorder goes
 *      through the official insertBefore and survives a restart.
 *
 *   7. build/plugin-toggle.js — vendored byte for byte (MIT, same author) and
 *      wrapped in an IIFE; it registers the two disposers for the switch's own
 *      remote and locale services.
 *
 *   8. build/session-eva-status.js — the user's other plugin, vendored byte for byte
 *      (MIT, same author) and wrapped the same way. It registers the last disposer
 *      and paints the session list's left rail (waiting on you / selected / unread
 *      completion, plus the pinned row's rainbow). Its own apply() reads the uiSession,
 *      sessions and workspaces services, which is why the exports map below names all
 *      three in its inject list.
 *
 * Nine is pinned by tools/selfcheck.mjs (cli.11d), so another effect cannot slip in
 * unnoticed.
 *
 * The effect disposers are the whole uninstall story: the theme is one removable
 * layer, and turning it off returns the app to the shipped theme with no residue.
 * A theme that leaks a token keeps affecting the UI after it is disabled, and the
 * leak is invisible — which is why nothing here is applied outside \`ctx.effect\`.
 */`

const body = `
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PLUGIN_ID)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var PLUGIN_ID = ${JSON.stringify(PLUGIN_ID)}

    var TOKENS = ${JSON.stringify(TOKENS)}

    var MANIFEST = ${JSON.stringify(MANIFEST)}

    var WALLPAPER_DECLARATIONS = ${JSON.stringify(declarations)}

    var CSS = ${JSON.stringify(cssPaint)}

    var BOOT_CSS = ${JSON.stringify(bootCss)}
${bootJs}
${pluginToggleJs}
${sessionEvaStatusJs}
${clientJs}
  },
})
`

const output = `${banner}\n${body}`

/* ------------------------------------------------------------------- check */

const target = join(ROOT, 'client.js')

if (process.argv.includes('--check')) {
  if (!existsSync(target)) {
    console.error('client.js is missing — run `node tools/build-client.mjs` first')
    process.exit(1)
  }
  const onDisk = readFileSync(target, 'utf8')
  if (onDisk === output) {
    console.log(`client.js check: OK (in sync with src/, ${output.length} chars, ` +
      `${MANIFEST.tokens} tokens, ${MANIFEST.wallpapers.length} wallpapers from ${wallpaperFile})`)
    process.exit(0)
  }
  console.error('client.js is STALE — it does not match src/ + the wallpaper manifest.')
  console.error(`  on disk ${onDisk.length} chars, generated ${output.length} chars ` +
    `(${wallpaperFile}, ${MANIFEST.wallpapers.length} wallpapers)`)
  const a = onDisk.split('\n')
  const b = output.split('\n')
  let shown = 0
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 8; i += 1) {
    if (a[i] !== b[i]) {
      console.error(`  line ${i + 1}:`)
      console.error(`    on disk:   ${String(a[i]).slice(0, 120)}`)
      console.error(`    generated: ${String(b[i]).slice(0, 120)}`)
      shown += 1
    }
  }
  console.error('  run: node tools/build-client.mjs   (--public to drop the local art)')
  process.exit(1)
}

writeFileSync(target, output)
/* `.length` is a CHARACTER count, not bytes: the bundle contains Chinese text, so
 * the file on disk is a little larger. Both numbers are reported honestly rather
 * than calling the character count "bytes". */
console.log(`wrote client.js  ${output.length} chars (${Buffer.byteLength(output, 'utf8')} bytes)  ` +
  `${MANIFEST.tokens} tokens  ${MANIFEST.wallpapers.length} wallpapers from ${wallpaperFile}  ` +
  `css ${css.length} chars (${cssPaint.length} after the comment strip)  ` +
  `wallpaper block ${declarations.length} chars`)
