/**
 * EVA-Inspired-Theme — installed (bundle) HOST half.
 *
 * Two jobs now, and the file says which is which.
 *
 * 1. Be the cordis plugin the loader mounts
 * -----------------------------------------
 * The look is entirely client-side — `exports["./client"]` -> client.js owns the
 * token layer, the paint layer, the session tint and the boot mask. Nothing about
 * the appearance is decided here.
 *
 * 2. Play the tiered task sounds (ported 2026-10-06, re-ported 2026-10-07)
 * ----------------------------------------------------------------------
 * The kernel of `dsh-perlica-ding` v0.2.0 (MIT, 117BS) is folded in so the skin also
 * speaks: a plan turn, a finished task, an agent question and a turn error each get
 * their own wav, and a plain Q&A turn stays silent. "Silent" means the turn used no
 * execution-class tool at all — that is upstream's rule (`DEFAULT_EXEC_TOOLS`), and it
 * is narrower than "used no tool": consulting a file or searching the web stays quiet.
 *
 * What came over: the four triggers, the per-kind debounce, the execution-tool
 * whitelist, the plan-mode fallback that folds `plan/mode` out of the session log, and
 * the platform playback through the `subprocess` service.
 *
 * What stayed behind, at the user's request (2026-10-07): upstream's Config schema,
 * its settings namespace, its loopback HTTP bridge, its settings page, and its
 * custom-sound resolution. The layer reads `sounds/` next to this file and nothing
 * else, so a stray wav in the cwd or in the OS sound directory can never become the
 * theme's voice, and there is no knob to point it somewhere else.
 *
 * The four wavs in `sounds/` are upstream's own Perlica voice files, scaled to **60%
 * volume at port time** (the level the user asked for). Upstream instead rescales a
 * cached copy under %TEMP% on every cold start (`scaleWavVolume`); this half writes
 * nothing at runtime and carries no volume constant, because the level is a property
 * of the shipped bytes. `tools/check-sound-layer.mjs` keeps that honest: it checks
 * each file's format, byte length and peak against the upstream peaks recorded there,
 * so an unscaled or double-scaled replacement fails the gate.
 *
 * 2b. There is no startup chime any more (2026-10-07)
 * ---------------------------------------------------
 * The user asked for the chime to go and the boot mask to stay: 「去掉启动音效，只保留
 * 遮罩！」. So `startup` is no longer a kind, `sounds/startup.wav` is gone from the
 * package, and the loopback route that carried the chime (`/eva-theme/api/boot-sound`)
 * went with it — this file now registers no HTTP route at all, and the page never asks
 * for one. The mask itself is untouched: same timings, same triggers, only the sound is
 * missing. `tools/check-sound-layer.mjs` asserts the absence behaviourally: it fails if
 * this half ever registers a route again, or ever spawns the chime's wav.
 *
 * 3. Why there is no resident player (2026-10-07)
 * -----------------------------------------------
 * A cold `-EncodedCommand` needs 1.4-1.9 s to reach its first sample on this machine,
 * and a resident PowerShell was kept up from mount to hide exactly that: it preloaded
 * every wav, printed `ready`, and answered one stdin line with `go <kind>` before
 * playing it. On this machine it never survived a line — it said `ready`, every sound
 * fell through to the one-shot path, and the ack timeout (4 s) that decided that is
 * longer than the 2.27 s the boot mask covers.
 *
 * The program was ruled out with a standalone probe (same pwsh, same -EncodedCommand,
 * same pipes, outside the host): it stayed up, acknowledged every line in 11-13 ms, and
 * was reading again 1.36 s after a `PlaySync` returned. What broke it inside the host
 * was never located, so it is gone rather than kept in a state where its failure mode is
 * worse than its absence. The one-shot path is the only path now, and since the startup
 * chime was removed (2b) nothing at boot waits on it any more.
 *
 * Its diagnostic log went with it, and that was the second reason to drop it: `trace()`
 * was the only absolute machine path in this file and `apply()` called it on every
 * decision, so running the behavioural gate wrote outside the package.
 *
 * Why this exports no `Config` (implementation option A of the S3 spec)
 * --------------------------------------------------------------------
 * The spec allowed "A. empty implementation" or "B. a Schemastery Config", and B's
 * fields exist for one purpose: to give the official settings service somewhere
 * durable to put what a settings PANEL lets the user choose. This theme ships no
 * panel — that was decided in S2, whose §6 records why (the A-layer has no quantity
 * that has one right answer per user; the official settings already own font size
 * and light/dark; and `overrideTokens` replaces the whole layer, so a runtime
 * toggle would have to hand back every token at once).
 *
 * With no panel there is nothing to persist, so a Config here would be four or five
 * string fields that no code path ever reads. That is an invalid declaration, and
 * P0 forbids shipping one. The sound layer is the worked example: its knobs are
 * constants in this file, not a schema.
 *
 * If a panel is wanted later, B becomes correct and the machinery it needs is
 * already specified: resolve `@deepseek-ai/schemastery` (then `schemastery`) from
 * ctx.baseUrl, __dirname, require.main, cwd, the DSH home and each
 * `profiles/<name>/node_modules`; mark every leaf `volatile()` (without it the
 * service silently refuses every write); keep every field a string; and degrade to
 * `Config === undefined` with a `ctx.logger.warn` if no usable builder resolves.
 * `tools/selfcheck.mjs` asserts the absence of a Config *and* the absence of the
 * dead machinery, so re-adding B has to be deliberate.
 *
 * A failing host half must never take the theme down
 * --------------------------------------------------
 * The client half is loaded by the web modules roster from `dsh.client`, not from
 * here, so nothing here can stop the theme from painting. Every entry point below is
 * wrapped: a service that is missing, a platform with no player, or a logger that
 * throws only costs the sound it was trying to make.
 */

'use strict'

const { existsSync } = require('node:fs')
const { join } = require('node:path')

const PLUGIN_ID = 'EVA-Inspired-Theme'

/* --------------------------------------------------------------- sound layer */

/** Every kind the skin can voice. No `startup`: the boot mask is silent by request. */
const SOUND_KINDS = ['plan', 'done', 'ask', 'fail']

/** Shipped sounds live next to this file; nothing is fetched at runtime. */
const SOUNDS_DIR = join(__dirname, 'sounds')

/** Same kind twice inside this window is only played once (per-kind, as upstream). */
const DEBOUNCE_MS = 2500

/**
 * Tool names that count as "executing a task" — upstream's whitelist, ported as-is.
 *
 * Read-only / lookup tools (read, grep, glob, web_search, skill, ...) do NOT count, so
 * a plain Q&A that happens to consult a file stays silent. That distinction is the
 * point of the layer, so the list is a constant here: upstream let `execTools: []`
 * widen it to "every tool", and that escape hatch went with the Config schema.
 */
const DEFAULT_EXEC_TOOLS = [
  'pwsh',
  'bash',
  'write',
  'edit',
  'subagent',
  'subagent_fork',
  'workflow',
  'ralph',
  'job_kill',
  'create_goal',
  'update_goal',
  'todo_write',
  'cordis_define',
  'cordis_run',
  'cordis_stop',
  'cordis_undefine',
]

const lastPlayed = Object.create(null)

/**
 * Look a service up without letting the lookup throw.
 *
 * The sound layer runs lazily — at the moment an event fires, not at mount — so a
 * service that is not ready yet costs one sound rather than the plugin.
 */
function service(ctx, name) {
  try {
    if (typeof ctx.get !== 'function') return null
    const found = ctx.get(name)
    return found === undefined ? null : found
  } catch (error) {
    return null
  }
}

/** The theme's own folder, and nothing else: a predictable path is not an audio source. */
function resolveSound(kind) {
  const candidate = join(SOUNDS_DIR, kind + '.wav')
  return existsSync(candidate) ? candidate : null
}

/** argv lists to try in order for this platform (upstream's set, ported). */
function attemptsFor(file) {
  if (process.platform === 'win32') {
    const escaped = file.replace(/'/g, "''")
    const script = "$p = New-Object Media.SoundPlayer '" + escaped + "'; $p.PlaySync()"
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const windows = process.env.SystemRoot || process.env.windir
    const attempts = []
    if (windows) {
      attempts.push([join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
    }
    attempts.push(['pwsh.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
    return attempts
  }
  if (process.platform === 'darwin') return [['/usr/bin/afplay', file]]
  return [['paplay', file], ['aplay', file]]
}

/** Play one kind, debounced. Silent on every failure path — never throws. */
function playSound(ctx, kind) {
  try {
    const now = Date.now()
    if (now - (lastPlayed[kind] || 0) < DEBOUNCE_MS) return
    const file = resolveSound(kind)
    if (file === null) return
    const subprocess = service(ctx, 'subprocess')
    if (subprocess === null || typeof subprocess.spawn !== 'function') return
    lastPlayed[kind] = now
    const attempts = attemptsFor(file)
    let index = 0
    const tryNext = () => {
      if (index >= attempts.length) return
      const argv = attempts[index++]
      let handle
      try {
        handle = subprocess.spawn({
          argv,
          cwd: process.platform === 'win32' ? (process.env.SystemRoot || '/') : '/',
          stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
          graceMs: 3000,
        })
      } catch (error) {
        tryNext()
        return
      }
      if (handle && handle.done && typeof handle.done.catch === 'function') {
        handle.done.catch(() => { tryNext() })
      }
    }
    /* One spawn per attempt, in order: the first argv that starts plays the wav. */
    tryNext()
  } catch (error) {
    /* A missing player is not a theme failure. */
  }
}

/** Sub-agents must not ding on their own: the root turn reports for all of them. */
function isRootAgent(ctx, agent) {
  try {
    if (!agent) return false
    const agents = service(ctx, 'agents')
    if (agents === null || typeof agents.roots !== 'function') return true
    return agents.roots().some((root) => root && root.id === agent.id)
  } catch (error) {
    return true
  }
}

/**
 * Fold plan-mode state out of a session event log: the last `plan/mode` event wins,
 * and a log without one folds to inactive (upstream's helper, ported).
 */
function foldPlanModeFromEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return false
  let active = false
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (event && event.type === 'plan/mode') {
      active = !!(event.data && event.data.active)
    }
  }
  return active
}

/** Plan mode decides between the 「plan」 and 「done」 voice at turn end. */
function planIsActive(ctx, agent) {
  const planMode = service(ctx, 'planMode')
  if (planMode !== null && typeof planMode.get === 'function') {
    try {
      const state = planMode.get(agent)
      return !!(state && state.active)
    } catch (error) {
      return false
    }
  }
  /* Service not reachable (upstream notes this happens in the dynamic-plugin
   * sandbox): read the same answer out of the session log instead — read-only, and a
   * missing session simply folds to inactive. */
  try {
    const events = agent && agent.session && agent.session.events
    return foldPlanModeFromEvents(events)
  } catch (error) {
    return false
  }
}

/**
 * Wire the triggers: upstream's six, minus the settings bridge and the preview force
 * flag. Nothing here reads a preference, so nothing here needs one.
 *
 * The question trigger answers to upstream's name and no other: this half used to also
 * accept `ask_user`, and the user asked for upstream's behaviour exactly
 * (「按上有的来，只认 ask_user_question」, 2026-10-07).
 */
function registerSounds(ctx) {
  const turnStart = new Map()
  const lastTool = new Map()

  ctx.on('agent/inbox/claimed', (payload) => {
    const agent = payload && payload.agent
    if (!agent || !isRootAgent(ctx, agent)) return
    turnStart.set(agent.id, Date.now())
  })

  ctx.on('tools/result', (exec) => {
    if (!exec || !exec.agent || !isRootAgent(ctx, exec.agent)) return
    /* Only execution-class tools count as "doing a task" (upstream's whitelist): a turn
     * that merely read a file or searched the web must end in silence. */
    if (!DEFAULT_EXEC_TOOLS.includes(exec.name)) return
    lastTool.set(exec.agent.id, Date.now())
  })

  ctx.on('tools/execute', (exec, next) => {
    if (exec && exec.name === 'ask_user_question') {
      playSound(ctx, 'ask')
    }
    return typeof next === 'function' ? next() : undefined
  })

  ctx.on('approval/request', (request, next) => {
    playSound(ctx, 'ask')
    return typeof next === 'function' ? next() : undefined
  })

  ctx.on('agent/error', (payload) => {
    const agent = payload && payload.agent
    if (agent && !isRootAgent(ctx, agent)) return
    playSound(ctx, 'fail')
  })

  ctx.on('agent/turn-stopping', (payload) => {
    const agent = payload && payload.agent
    if (!agent || !isRootAgent(ctx, agent)) return
    try {
      if (planIsActive(ctx, agent)) {
        playSound(ctx, 'plan')
      } else {
        const start = turnStart.get(agent.id) || 0
        const tool = lastTool.get(agent.id) || 0
        /* Stricter than upstream's `tool >= start`: a plain Q&A turn has no tool
         * timestamp at all, and the point of this layer is that it stays quiet. */
        if (tool > 0 && tool >= start) playSound(ctx, 'done')
      }
    } finally {
      turnStart.delete(agent.id)
      lastTool.delete(agent.id)
    }
  })
}

/**
 * Mount the plugin.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Owning plugin context.
 */
function apply(ctx) {
  try {
    ctx.logger?.info?.(
      `${PLUGIN_ID}: host half mounted. The theme is applied entirely in the browser ` +
        `half (exports["./client"]); this entry registers no services, injects nothing, ` +
        `and exports no Config by design (see the header). The sound layer is armed.`,
    )
  } catch (error) {
    /* A logger that throws must not stop the row from mounting: the browser half is
     * what paints the theme, and it loads independently of this call. */
  }

  try {
    registerSounds(ctx)
    /* No startup chime, and no loopback route for one (2026-10-07): the boot mask is
     * silent because the user asked it to be (see 2b in the header). Nothing else is
     * mounted here — the appearance belongs to the browser half, so this half wires
     * the four task sounds and stops. */
  } catch (error) {
    try {
      ctx.logger?.warn?.(`${PLUGIN_ID}: sound layer not registered (${String(error)})`)
    } catch (inner) {
      /* nothing left to report with */
    }
  }
}

module.exports = {
  name: PLUGIN_ID,
  apply,
}
