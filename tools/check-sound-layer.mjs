/**
 * Behavioural check for the host half's sound layer.
 *
 * `tools/selfcheck.mjs` asserts the layer's SHAPE (the triggers, the debounce, the
 * player commands, the absence of a preferences surface). This one asserts its
 * BEHAVIOUR: it mounts `index.js` against a fake cordis context, records every spawn,
 * fires the real events, and checks which wav each one asked for. Nothing is played —
 * the fake `subprocess` swallows the argv — so it is safe to run while the desktop app
 * is open.
 *
 * There is no resident player any more (2026-10-07; see the header of `index.js`), so
 * this file covers the one-shot path alone and runs synchronously: every trigger
 * spawns from the event, never from a timer.
 *
 * There is no startup chime either. The user asked for the mask to stay and the chime
 * to go (「去掉启动音效，只保留遮罩！」), so the host half must not register the old
 * loopback route and must never spawn `startup.wav`. Three checks here pin that
 * absence, because silence is exactly what a regression would look like.
 *
 * What the port added (2026-10-07) is pinned here too:
 *
 *   - the execution-tool whitelist (`DEFAULT_EXEC_TOOLS`). A turn that only READ a file
 *     or searched the web must end in silence; a turn that ran a tool that changes
 *     something must speak. `plain turn stays silent` alone cannot tell those apart, so
 *     both sides are checked.
 *   - the plan-mode fallback: when the `planMode` service is unreachable the layer folds
 *     `plan/mode` out of the session log instead, and when the service IS reachable the
 *     log must be ignored.
 *   - the question trigger answers to upstream's spelling only (`ask_user_question`).
 *     This half used to also accept `ask_user`; the user asked for upstream's behaviour
 *     exactly, so the old spelling is checked to be SILENT.
 *   - the four shipped wavs are upstream Perlica's own files, baked to 60% volume at
 *     port time. The gate recomputes that: byte length, format, sample peak against the
 *     recorded upstream peak, and the exact sha256.
 *
 * Each scenario gets a FRESH module instance: the per-kind debounce lives in module
 * scope, so a second scenario in the same instance would be silenced by the first one's
 * play and the check would pass for the wrong reason.
 *
 * Usage:
 *   node tools/check-sound-layer.mjs
 */

import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX = join(ROOT, 'index.js')
const SOUNDS = join(ROOT, 'sounds')

/**
 * The shipped sounds, and what upstream ships for the same four kinds (v0.1.0 and
 * master agree byte for byte; recorded 2026-10-07). Porting scaled every sample by 0.6,
 * which changes the samples but not the byte length, so both numbers are checkable:
 * `peak` must be `Math.round(upstreamPeak * VOLUME)`, and `sha256` pins the exact bytes.
 */
const VOLUME = 0.6
const SHIPPED = {
  plan: { bytes: 235086, upstreamPeak: 28908, peak: 17345, sha256: '43c8758716a553357be0770ce9c333e883967be5b5aab9b59b70d80b4242e78a' },
  done: { bytes: 189006, upstreamPeak: 28330, peak: 16998, sha256: '4d8aee456ab9c908850d295c5d077200a67ddfefaeb7239a13e9777c23c5c478' },
  ask: { bytes: 281166, upstreamPeak: 29437, peak: 17662, sha256: '09289ef974add2899b14d7b846c22beb4c8276bddffece2a9e420147ac7e1f28' },
  fail: { bytes: 225870, upstreamPeak: 28700, peak: 17220, sha256: '7466747e067f80077ff94d27a3145bf9fbc5c52e5dfd877eb921db85b6e48ebe' },
}

/** Decode a PowerShell `-EncodedCommand` argv into the script it carries. */
function decodeArgv(line) {
  const encoded = line.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)
  return encoded ? Buffer.from(encoded[1], 'base64').toString('utf16le') : line
}

/**
 * Mount a fresh copy of `index.js` against a fake cordis context and hand back the
 * recorder for it. `delete require.cache` is what makes the debounce start empty.
 */
function mount({ planModeAvailable = true, planActive = false } = {}) {
  delete require.cache[require.resolve(INDEX)]
  const plugin = require(INDEX)

  const state = {
    handlers: new Map(),
    /** Every spawn the layer asked for, in order. */
    spawns: [],
    /** The options behind each spawn, same order — the base spec wants them explicit. */
    options: [],
    warnings: [],
    /** Every webServer.register() call asked for. Since 2026-10-07 the expected answer
     *  is none: the startup chime and the loopback route carrying it are gone. */
    routes: [],
    /** Every service looked up, so "it never even asks for webServer" is pinned. */
    looked: [],
    planActive,
    planModeAvailable,
  }

  const ctx = {
    logger: { info: () => {}, warn: (message) => state.warnings.push(String(message)) },
    effect: (fn) => {
      const disposer = typeof fn === 'function' ? fn() : undefined
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get: (name) => {
      state.looked.push(name)
      if (name === 'subprocess') {
        return {
          spawn: (given) => {
            state.spawns.push(given.argv.join(' '))
            state.options.push(given)
            return { done: Promise.resolve() }
          },
        }
      }
      if (name === 'webServer') {
        return {
          register: (row) => {
            state.routes.push(row)
            return () => {}
          },
        }
      }
      /* One root agent, so the sub-agent gate has something to compare against. */
      if (name === 'agents') return { roots: () => [{ id: 'root' }] }
      /* The fallback scenario removes the service entirely: `service()` then reports
       * it missing and the layer has to read the session log instead. */
      if (name === 'planMode' && state.planModeAvailable) {
        return { get: () => ({ active: state.planActive }) }
      }
      return undefined
    },
    on: (name, fn) => {
      state.handlers.set(name, fn)
      return () => {}
    },
  }

  plugin.apply(ctx)

  /** Which wav each spawn asked for. On Windows the path travels base64-encoded inside
   *  a PowerShell `-EncodedCommand`, so the argv has to be decoded first. */
  state.kinds = () => state.spawns.map((line) => {
    const found = decodeArgv(line).match(/([a-z]+)\.wav/)
    return found ? found[1] : 'unknown'
  })
  state.fire = (name, ...args) => {
    const fn = state.handlers.get(name)
    if (typeof fn !== 'function') throw new Error(`no handler for ${name}`)
    return fn(...args)
  }
  return state
}

/** Read a 16-bit PCM wav's format, sample peak and sha256. */
function inspectWav(file) {
  const bytes = readFileSync(file)
  let format = null
  let channels = null
  let rate = null
  let bits = null
  let data = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      format = bytes.readUInt16LE(offset + 8)
      channels = bytes.readUInt16LE(offset + 10)
      rate = bytes.readUInt32LE(offset + 12)
      bits = bytes.readUInt16LE(offset + 22)
    } else if (id === 'data') {
      data = { start: offset + 8, size }
    }
    offset += 8 + size + (size % 2)
  }
  let peak = 0
  if (data) {
    const end = Math.min(data.start + data.size, bytes.length)
    for (let i = data.start; i + 1 < end; i += 2) {
      const magnitude = Math.abs(bytes.readInt16LE(i))
      if (magnitude > peak) peak = magnitude
    }
  }
  return { format, channels, rate, bits, peak, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

const results = []
const check = (id, ok, detail = '') => results.push({ id, ok, detail })

/* ------------------------------------------------------------------ scenario A ---
 * The ordinary triggers, with the planMode service available. */

const a = mount()
check('hooks', a.handlers.size === 6, `registered ${a.handlers.size} handlers`)

/* Plan mode on: only the root agent's voice counts, and it is the `plan` one. */
a.planActive = true
a.fire('agent/inbox/claimed', { agent: { id: 'child' } })
a.fire('agent/turn-stopping', { agent: { id: 'child' } })
check('sub-agent turn stays silent', a.kinds().length === 0, `spawned ${a.kinds().join(',') || 'nothing'}`)

a.fire('agent/inbox/claimed', { agent: { id: 'root' } })
a.fire('agent/turn-stopping', { agent: { id: 'root' } })
check('plan turn plays plan', a.kinds().includes('plan'), a.kinds().join(',') || 'nothing')
a.planActive = false

// A plain Q&A turn: the agent takes the inbox, no tool runs, the turn stops.
a.fire('agent/inbox/claimed', { agent: { id: 'root' } })
a.fire('agent/turn-stopping', { agent: { id: 'root' } })
check('plain turn stays silent',
  a.kinds().filter((k) => k === 'done').length === 0, `spawned ${a.kinds().join(',') || 'nothing'}`)

/* A turn that only READ something is a plain turn too: the whitelist is what makes
 * that true, so a lookup tool must not talk. */
a.fire('agent/inbox/claimed', { agent: { id: 'root' } })
a.fire('tools/result', { agent: { id: 'root' }, name: 'read' })
a.fire('agent/turn-stopping', { agent: { id: 'root' } })
check('read-only tool stays silent',
  a.kinds().filter((k) => k === 'done').length === 0, `spawned ${a.kinds().join(',') || 'nothing'}`)

// A working turn: an execution-class tool runs between inbox and stop.
a.fire('agent/inbox/claimed', { agent: { id: 'root' } })
a.fire('tools/result', { agent: { id: 'root' }, name: 'edit' })
a.fire('agent/turn-stopping', { agent: { id: 'root' } })
check('working turn plays done', a.kinds().includes('done'), a.kinds().join(',') || 'nothing')

// An error.
a.fire('agent/error', { agent: { id: 'root' } })
check('agent error plays fail', a.kinds().includes('fail'), a.kinds().join(',') || 'nothing')

/* The question trigger answers to upstream's name and no other. This is checked FIRST:
 * `ask` has not played yet in this instance, so a regression that still accepted the old
 * spelling would show up as a spawn here instead of being swallowed by the debounce. */
a.fire('tools/execute', { name: 'ask_user' }, () => {})
check('the old ask_user spelling stays silent',
  !a.kinds().includes('ask'), a.kinds().join(',') || 'nothing')

// A question, through the tools door, under upstream's name.
a.fire('tools/execute', { name: 'ask_user_question' }, () => {})
check('agent question plays ask', a.kinds().includes('ask'), a.kinds().join(',') || 'nothing')

// Debounce: the same kind again inside 2.5 s must not spawn a second time.
const before = a.kinds().filter((k) => k === 'fail').length
a.fire('agent/error', { agent: { id: 'root' } })
const after = a.kinds().filter((k) => k === 'fail').length
check('per-kind debounce holds', before === after, `${before} -> ${after}`)

/* ------------------------------------------------------------------ scenario B ---
 * No planMode service: the layer has to fold the answer out of the session log. Both
 * directions are checked, because a fallback stuck on one answer would pass one of them. */

const b = mount({ planModeAvailable: false })
const planLog = (active) => ({ agent: { id: 'root', session: { events: [{ type: 'plan/mode', data: { active } }] } } })

b.fire('agent/inbox/claimed', planLog(true))
b.fire('agent/turn-stopping', planLog(true))
check('plan mode falls back to the session log', b.kinds().includes('plan'),
  b.kinds().join(',') || 'nothing')

/* Same fallback, opposite answer, on an execution-class turn: the log decides between
 * `plan` and `done`, so an inactive log must land on `done`. */
const bRoot = { id: 'root', session: { events: [{ type: 'plan/mode', data: { active: false } }] } }
b.fire('agent/inbox/claimed', { agent: bRoot })
b.fire('tools/result', { agent: bRoot, name: 'pwsh' })
b.fire('agent/turn-stopping', { agent: bRoot })
check('folded-inactive log plays done', b.kinds().includes('done'), b.kinds().join(',') || 'nothing')

/* ------------------------------------------------------------------ scenario C ---
 * The service IS available and says "not planning", while the log claims otherwise: the
 * service wins and the turn speaks `done`. A layer that always folded would say `plan`. */

const c = mount({ planModeAvailable: true, planActive: false })
const cAgent = { id: 'root', session: { events: [{ type: 'plan/mode', data: { active: true } }] } }
c.fire('agent/inbox/claimed', { agent: cAgent })
c.fire('tools/result', { agent: cAgent, name: 'edit' })
c.fire('agent/turn-stopping', { agent: cAgent })
check('the planMode service outranks the log', c.kinds().join(',') === 'done',
  c.kinds().join(',') || 'nothing')

/* ------------------------------------------------------- what the port must NOT do --- */

// There is no startup chime any more (2026-10-07). The mask stays; the sound is gone,
// and with it the loopback route that carried it. Both halves of that absence are
// checked here, because "it simply never fires" is what a regression looks like.
const everySpawn = [a, b, c].reduce((all, row) => all.concat(row.kinds()), [])
check('no startup chime was ever asked for', !everySpawn.includes('startup'),
  everySpawn.join(',') || 'nothing')
const everyRoute = [a, b, c].reduce((all, row) => all.concat(row.routes), [])
check('the host half registers no HTTP route', everyRoute.length === 0,
  everyRoute.length === 0 ? 'no webServer.register() call' : `${everyRoute.length} route(s)`)
const everyLookup = [a, b, c].reduce((all, row) => all.concat(row.looked), [])
check('the host half never even looks up webServer', !everyLookup.includes('webServer'),
  everyLookup.includes('webServer') ? 'webServer was resolved' : `looked up: ${[...new Set(everyLookup)].join(', ')}`)

/* There is also no startup.wav left to play: the package ships four sounds, and the file
 * the chime used is gone rather than orphaned. */
check('sounds/startup.wav is not in the package', !existsSync(join(SOUNDS, 'startup.wav')),
  existsSync(join(SOUNDS, 'startup.wav')) ? 'startup.wav is still there' : 'four sounds only')
const present = readdirSync(SOUNDS).filter((name) => name.endsWith('.wav')).sort()
check('sounds/ holds exactly the four kinds',
  present.join(',') === Object.keys(SHIPPED).map((kind) => `${kind}.wav`).sort().join(','),
  present.join(',') || 'no wav files')

/* Every sound came out of the package: the wav path is the one next to index.js, never a
 * file that happened to sit in the host's cwd or in the OS sound directory. */
const decoded = a.spawns.map(decodeArgv)
const packaged = decoded.every((script) => script.indexOf(SOUNDS) !== -1)
check('every sound is the packaged wav', a.spawns.length > 0 && packaged,
  packaged ? `${a.spawns.length} spawns, all under ${SOUNDS}` : 'a spawn asked for another path')

/* The base spec wants spawn arguments explicit: no defaults are provided. */
const explicit = a.options.every((row) => row.cwd && row.graceMs === 3000 && row.stdio &&
  row.stdio.stdin === 'ignore' && row.stdio.stdout === 'ignore' && row.stdio.stderr === 'ignore')
check('spawn options are explicit', a.options.length > 0 && explicit,
  explicit ? 'cwd + stdio(ignore x3) + graceMs on every spawn' : JSON.stringify(a.options[0] || null))

/* The four files ARE upstream Perlica's voice, at the level the user asked for: same
 * byte length as upstream, peak equal to upstream's peak times 0.6, exact bytes pinned. */
for (const [kind, want] of Object.entries(SHIPPED)) {
  const file = join(SOUNDS, `${kind}.wav`)
  if (!existsSync(file)) {
    check(`${kind}.wav is upstream Perlica at 60%`, false, 'missing')
    continue
  }
  const got = inspectWav(file)
  const shape = got.format === 1 && got.channels === 1 && got.bits === 16 && got.rate === 44100
  const scaled = got.peak === Math.round(want.upstreamPeak * VOLUME)
  const length = got.bytes === want.bytes
  const exact = got.sha256 === want.sha256
  const ok = shape && scaled && length && exact
  check(`${kind}.wav is upstream Perlica at 60%`, ok,
    ok
      ? `${got.bytes} B, peak ${got.peak} = round(${want.upstreamPeak} x 0.6), sha256 ${got.sha256.slice(0, 12)}`
      : `${got.bytes} B (want ${want.bytes}), peak ${got.peak} (want ${Math.round(want.upstreamPeak * VOLUME)}), fmt ${got.format}/${got.channels}ch/${got.bits}bit/${got.rate}Hz, sha256 ${got.sha256.slice(0, 12)}${exact ? '' : ' != ' + want.sha256.slice(0, 12)}`)
}

check('nothing warned', [a, b, c].every((row) => row.warnings.length === 0),
  [a, b, c].map((row) => row.warnings.join(' | ')).filter(Boolean).join(' | '))

const failed = results.filter((row) => !row.ok)
for (const row of results) {
  console.log(`${row.ok ? '  ok  ' : ' FAIL '} ${row.id.padEnd(36)} ${row.detail}`)
}
console.log(`\n${results.length} checks, ${failed.length} failed, ${results.length - failed.length} passed`)
console.log(`spawns: ${a.kinds().join(', ') || 'none'}`)
console.log(`fallback: log-only ${b.kinds().join(', ') || 'none'} | service-wins ${c.kinds().join(', ') || 'none'}`)
console.log(`looked up: ${[...new Set(everyLookup)].join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
