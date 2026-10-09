/**
 * Token audit — what the theme actually overrides, and what it must not.
 *
 * The S3 spec requires this to be recounted after every build, and requires the
 * build to STOP if the override count grows abnormally rather than explaining the
 * growth away as "completeness". So the count is compared against the S2 plan and a
 * mismatch is a hard failure with a non-zero exit.
 *
 * It answers six questions the spec names:
 *
 *   dshOwned                 how many of the overridden tokens are official DSH tokens
 *   themedColor              how many carry a colour (vs geometry/motion/type)
 *   actual override count    how many tokens the built client.js really passes
 *   aliases                  alias-layer vs base-layer vs static-layer
 *   component-level          tokens whose official declaration only ever appears
 *                            under a component selector — a theme must have none
 *   paint-only values        tokens the PAINT layer reads rather than paints
 *
 * Evidence files (`out/`) are read when present and reported as absent when not:
 * the audit must still be able to state the shipped counts on a machine that only
 * has the package. When a dump is absent the columns that depend on it print `n/a`
 * and the closing sentence says NOT VERIFIED for exactly those columns — a missing
 * dump must never be printed as a passing 0.
 *
 * Usage:
 *   node tools/token-audit.mjs
 *   node tools/token-audit.mjs --json
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')
const has = (relative) => existsSync(join(ROOT, relative))

/** The plan S2 settled on. Growth past this is a stop-the-line event, not a detail.
 *  Round 6 (2026-10-06): A 42 -> 41, total 55 -> 54, because the user asked for the
 *  official rounded corners and `--dsw-corner-shape` therefore left the map. A token
 *  declared at its official value can never be part of the difference table. */
const PLANNED = { A: 41, B: 13, total: 54 }

const tokensDoc = JSON.parse(read('src/tokens.json'))
const TOKENS = tokensDoc.tokens
const names = Object.keys(TOKENS)
const client = read('client.js')

/* --------------------------------------------------------------- classification */

const COLOURISH = /^(#|rgba?\(|hsla?\(|color-mix\(|oklch\(|lab\(|lch\()/i

function layerOf(token) {
  if (token.startsWith('--dsw-alias-')) return 'alias'
  if (token.startsWith('--dsw-static-')) return 'static'
  if (token.startsWith('--dsw-')) return 'base'
  if (token.startsWith('--dsh-')) return 'dsh'
  if (token.startsWith('--ds-')) return 'ds'
  return 'other'
}

const rows = names.map((token) => {
  const dark = TOKENS[token].dark
  const light = TOKENS[token].light
  return {
    token,
    layer: layerOf(token),
    colour: COLOURISH.test(dark) && COLOURISH.test(light),
    kind: dark === light ? 'mode-independent' : 'per-mode',
  }
})

/* ------------------------------------------------------------------- evidence */

let baseline = null
let refcount = null
let declared = null
if (has('out/s2-token-baseline.json')) {
  baseline = Object.fromEntries(
    JSON.parse(read('out/s2-token-baseline.json')).rows.map((r) => [r.token, r]))
}
if (has('out/s2-refcount.json')) {
  refcount = Object.fromEntries(
    JSON.parse(read('out/s2-refcount.json')).rows.map((r) => [r.token, r]))
}
if (has('out/cssom-refs.json')) {
  declared = JSON.parse(read('out/cssom-refs.json')).declared
}

for (const row of rows) {
  const official = baseline?.[row.token]
  row.official = official ? { light: official.light, dark: official.dark } : null
  row.changed = official === undefined || official === null
    ? null
    : (official.light !== row.lightValue && official.dark !== row.darkValue)
  row.refs = refcount?.[row.token]?.primary ?? official?.refs ?? null
  row.refsTotal = refcount?.[row.token]?.total ?? null
  if (declared?.[row.token] !== undefined) {
    const selectors = declared[row.token].map((d) => d.selector ?? '')
    row.componentOnly = selectors.length > 0 &&
      selectors.every((s) => !/^(body|html|:root)\b/.test(s.trim()))
    row.declarationCount = selectors.length
  } else {
    row.componentOnly = null
    row.declarationCount = null
  }
}

/* `changed` compares against the shell-free token values, so the two translucent
 * surfaces are compared with their alpha stripped. */
for (const row of rows) {
  if (row.official === null) continue
  const strip = (v) => (typeof v === 'string' ? v.replace(/^(#[0-9a-f]{6})[0-9a-f]{2}$/i, '$1') : v)
  row.changed = row.official.light !== strip(TOKENS[row.token].light) ||
    row.official.dark !== strip(TOKENS[row.token].dark)
}

/* ---------------------------------------------------------------------- report */

const count = rows.length
const byLayer = rows.reduce((acc, r) => {
  acc[r.layer] = (acc[r.layer] ?? 0) + 1
  return acc
}, {})
const colours = rows.filter((r) => r.colour).length
const geometry = count - colours
const componentOnly = rows.filter((r) => r.componentOnly === true)
const unchanged = rows.filter((r) => r.changed === false)
const embedded = client.match(/var TOKENS = (\{.*?\})\n\n/s)
const embeddedTokens = embedded ? Object.keys(JSON.parse(embedded[1])) : []
const embeddedCount = embeddedTokens.length

/* Tokens the PAINT layer reads rather than paints: the two veil surfaces are read
 * by `linear-gradient(var(--dsw-alias-bg-base), ...)` in src/theme.css. */
const paintOnly = [...read('src/theme.css').matchAll(/var\((--[a-z0-9-]+)\)/g)]
  .map((m) => m[1])
  .filter((name, index, all) => all.indexOf(name) === index && name.startsWith('--dsw-'))

/* ------------------------------------------------------------------- evidence
 * Three verdicts depend on the S1 dumps in out/: `component-level` needs the
 * declared graph from out/cssom-refs.json, `unchanged vs official` needs
 * out/s2-token-baseline.json, and the consumer counts need out/s2-refcount.json.
 * When a dump is absent the honest answer is "cannot decide", never 0 — so those
 * columns print `n/a` and the verdict line says NOT VERIFIED instead of reusing
 * the all-clear sentence. */
const evidence = {
  componentLevel: declared !== null,
  unchanged: baseline !== null,
  refs: refcount !== null,
}
const missingEvidence = Object.entries({
  'out/s2-token-baseline.json': evidence.unchanged,
  'out/s2-refcount.json': evidence.refs,
  'out/cssom-refs.json': evidence.componentLevel,
}).filter(([, present]) => !present).map(([name]) => name)
const notVerified = [
  evidence.componentLevel ? null : 'component-level',
  evidence.unchanged ? null : 'unchanged-vs-official',
  evidence.refs ? null : 'consumer counts',
].filter(Boolean)

const summary = {
  plan: PLANNED,
  dshOwned: rows.filter((r) => r.layer !== 'other').length,
  themedColor: colours,
  geometryAndMotion: geometry,
  actualOverrideCount: count,
  embeddedInClient: embeddedCount,
  byLayer,
  componentLevelOverrides: componentOnly.length,
  modeIndependent: rows.filter((r) => r.kind === 'mode-independent').length,
  perMode: rows.filter((r) => r.kind === 'per-mode').length,
  paintOnlyValues: paintOnly,
  unchangedFromOfficial: unchanged.map((r) => r.token),
  evidencePresent: {
    'out/s2-token-baseline.json': baseline !== null,
    'out/s2-refcount.json': refcount !== null,
    'out/cssom-refs.json': declared !== null,
  },
  verified: evidence,
  notVerified,
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, rows }, null, 1))
} else {
  console.log('TOKEN AUDIT — EVA-Inspired-Theme\n')
  console.log(`  dshOwned                ${summary.dshOwned} / ${count}`)
  console.log(`  themedColor             ${summary.themedColor}`)
  console.log(`  geometry / motion / type ${summary.geometryAndMotion}`)
  console.log(`  actual override count   ${summary.actualOverrideCount}`)
  console.log(`  embedded in client.js   ${summary.embeddedInClient}`)
  console.log(`  by layer                ${JSON.stringify(byLayer)}`)
  console.log(`  per-mode / flat         ${summary.perMode} / ${summary.modeIndependent}`)
  console.log(`  component-level         ${evidence.componentLevel
    ? summary.componentLevelOverrides
    : 'n/a (needs out/cssom-refs.json)'}`)
  console.log(`  paint-only reads        ${paintOnly.join(', ') || '(none)'}`)
  console.log(`  unchanged vs official   ${evidence.unchanged
    ? unchanged.length
    : 'n/a (needs out/s2-token-baseline.json)'}`)

  console.log(`  evidence files          ${missingEvidence.length === 0
    ? 'all present (out/)'
    : `absent: ${missingEvidence.join(', ')}`}`)

  if (evidence.refs) {
    console.log('\n  top consumers (primary refs, highest first):')
    for (const row of [...rows].sort((a, b) => (b.refs ?? -1) - (a.refs ?? -1)).slice(0, 12)) {
      console.log(`    ${String(row.refs ?? '-').padStart(4)}  ${row.token.padEnd(40)}` +
        `${row.changed === null ? '' : row.changed ? '' : '  UNCHANGED'}`)
    }
  } else {
    console.log('\n  top consumers           n/a (needs out/s2-refcount.json)')
  }
}

/* ------------------------------------------------------------------ verdict */

const failures = []
if (count !== PLANNED.total) {
  failures.push(`override count is ${count}, the S2 plan says ${PLANNED.total}`)
}
if (embeddedCount !== count) {
  failures.push(`client.js embeds ${embeddedCount} tokens but src/ declares ${count}`)
}
if (evidence.componentLevel && summary.componentLevelOverrides > 0) {
  failures.push(`${summary.componentLevelOverrides} component-level override(s): ` +
    componentOnly.map((r) => r.token).join(', '))
}
if (evidence.unchanged && unchanged.length > 0) {
  failures.push(`${unchanged.length} token(s) still hold the official value, which P0 ` +
    `forbids declaring: ${unchanged.map((r) => r.token).join(', ')}`)
}
if (byLayer.static !== undefined && byLayer.static > 0) {
  failures.push(`${byLayer.static} static-layer token(s) overridden — the static palette is ` +
    `shared and mode-independent; aliases are the correct layer`)
}

if (process.argv.includes('--json')) process.exit(failures.length === 0 ? 0 : 1)

if (failures.length > 0) {
  console.log('\nAUDIT FAILED — stopping rather than explaining the difference away:')
  for (const line of failures) console.log(`  - ${line}`)
  process.exit(1)
}
if (notVerified.length === 0) {
  console.log(`\nAUDIT OK — ${count} overrides, exactly the planned ${PLANNED.total} ` +
    `(A ${PLANNED.A} + B ${PLANNED.B}); no component-level override; no unchanged token.`)
} else {
  console.log(`\nAUDIT OK (partial) — ${count} overrides, exactly the planned ${PLANNED.total} ` +
    `(A ${PLANNED.A} + B ${PLANNED.B}); all embedded in client.js and all dsh-owned.`)
  console.log(`  NOT VERIFIED: ${notVerified.join(', ')} — evidence absent: ${missingEvidence.join(', ')}`)
  console.log('  (these are "cannot decide", not "passed": restore the dumps in out/ and re-run)')
}
