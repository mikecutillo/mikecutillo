/**
 * human-pause — randomized delays between form actions.
 *
 * The plan's risk mitigation #1 (LinkedIn TOS / anti-bot detection) calls
 * for the worker to behave like a careful human: no parallelism, no
 * headless, small random delays between fields. This module is the
 * per-field jitter primitive.
 *
 * Defaults come from `mission-control/data/auto-apply-config.json`:
 *   jitterMinMs: 800
 *   jitterMaxMs: 2400
 */

export interface JitterConfig {
  jitterMinMs: number
  jitterMaxMs: number
}

const DEFAULT: JitterConfig = { jitterMinMs: 800, jitterMaxMs: 2400 }

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Random delay between `jitterMinMs` and `jitterMaxMs`. Uniform
 * distribution is fine here — we're not modeling a realistic typing
 * distribution, just breaking up the "all fields filled in 200ms" signal
 * that anti-bot heuristics flag on.
 */
export async function humanPause(cfg: Partial<JitterConfig> = {}): Promise<void> {
  const { jitterMinMs, jitterMaxMs } = { ...DEFAULT, ...cfg }
  const ms = Math.floor(jitterMinMs + Math.random() * Math.max(0, jitterMaxMs - jitterMinMs))
  await sleep(ms)
}

/**
 * Slightly longer pause used between form pages / navigation steps.
 * Scales the configured jitter window by 2x.
 */
export async function pageTransitionPause(cfg: Partial<JitterConfig> = {}): Promise<void> {
  const { jitterMinMs, jitterMaxMs } = { ...DEFAULT, ...cfg }
  const ms = Math.floor(jitterMinMs * 2 + Math.random() * Math.max(0, (jitterMaxMs - jitterMinMs) * 2))
  await sleep(ms)
}
