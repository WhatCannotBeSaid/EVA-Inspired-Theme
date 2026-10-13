/**
 * EVA-Inspired-Theme — installed (bundle) HOST half.
 *
 * One job, and the file says what it is.
 *
 * 1. Be the cordis plugin the loader mounts
 * -----------------------------------------
 * The look is entirely client-side — `exports["./client"]` -> client.js owns the
 * token layer, the paint layer, the session tint and the boot mask. Nothing about
 * the appearance is decided here.
 *
 * 2. The tiered task sounds are gone (2026-10-13)
 * ----------------------------------------------
 * The kernel of `dsh-perlica-ding` v0.2.0 (MIT, 117BS) was folded in on 2026-10-06 and
 * re-ported on 2026-10-07, so the skin also spoke: a plan turn, a finished task, an
 * agent question and a turn error each got their own wav, a plain Q&A turn stayed
 * silent because it used no execution-class tool, and from 2026-10-12 a turn typed into
 * a phone stayed silent on the desk as well.
 *
 * The user asked for the whole thing to go — 「去掉dsh-perlica-ding v0.2.0 并同步更正
 * README。」 — and it went whole: the four kinds, the `sounds/` directory with its four
 * wavs inside it, the per-kind debounce, the execution-tool whitelist, the plan-mode
 * fold, the phone-originated-turn check, the Windows/macOS/Linux players, and
 * `tools/check-sound-layer.mjs` together with the `sounds` npm script that ran it.
 *
 * What this half does now is log one line and get out of the way. It registers no
 * service, no event listener and no HTTP route, spawns no subprocess, and reads no file
 * at runtime. The gate that used to assert the sound layer was sound asserts its absence
 * instead (`host.6` to `host.12` in `tools/selfcheck.mjs`), so a sound layer that comes
 * back has to be deliberate.
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
 * With no panel there is nothing to persist, so a Config here would be a handful of
 * string fields that no code path ever reads. That is an invalid declaration, and P0
 * forbids shipping one.
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
 * here, so nothing here can stop the theme from painting. The one entry point below
 * is wrapped: a logger that throws costs the log line and nothing else, because the
 * browser half loads independently of this call.
 */

'use strict'

const PLUGIN_ID = 'EVA-Inspired-Theme'

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
        `and exports no Config by design (see the header). Nothing is played: the tiered ` +
        `task sound layer was removed on 2026-10-13.`,
    )
  } catch (error) {
    /* A logger that throws must not stop the row from mounting: the browser half is
     * what paints the theme, and it loads independently of this call. */
  }
}

module.exports = {
  name: PLUGIN_ID,
  apply,
}
