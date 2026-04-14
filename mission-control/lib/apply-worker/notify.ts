/**
 * notify — macOS desktop notification helper.
 *
 * The zero-touch happy path means Mike walks away after one click, so
 * he needs a reliable desktop signal when the worker succeeds, pauses
 * on an unknown question, or fails. osascript is the easiest path on
 * macOS and requires zero extra deps or permissions prompts.
 *
 * The `open mission-control://...` URL handler is aspirational — until
 * that's wired up, the notification body tells Mike what happened and
 * which job, and he can click over to the tab himself.
 */

import { exec } from 'child_process'

export type NotifyKind = 'success' | 'unknown-question' | 'failure' | 'info'

interface NotifyOpts {
  title: string
  message: string
  subtitle?: string
  kind?: NotifyKind
  /** Sound name — defaults by kind. */
  sound?: string
}

const DEFAULT_SOUNDS: Record<NotifyKind, string> = {
  'success': 'Glass',
  'unknown-question': 'Ping',
  'failure': 'Basso',
  'info': '',
}

/**
 * Send a macOS notification via `osascript`. Non-blocking — we don't
 * wait for the display subsystem.
 *
 * Swallows errors: notifications are nice-to-have, never load-bearing.
 * A failed notification should not take the worker down.
 */
export function notify(opts: NotifyOpts): void {
  const kind: NotifyKind = opts.kind ?? 'info'
  const sound = opts.sound ?? DEFAULT_SOUNDS[kind]

  // AppleScript string escaping — anything that hits double-quotes or
  // backslashes has to be escaped. Keep this inline and simple.
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const parts = [`display notification "${esc(opts.message)}" with title "${esc(opts.title)}"`]
  if (opts.subtitle) parts.push(`subtitle "${esc(opts.subtitle)}"`)
  if (sound) parts.push(`sound name "${esc(sound)}"`)
  const script = parts.join(' ')

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.warn('[notify] osascript failed:', err.message)
    }
  })
}

export function notifyApplied(company: string, jobTitle: string): void {
  notify({
    kind: 'success',
    title: 'Mission Control',
    subtitle: 'Application submitted',
    message: `✓ Applied to ${company} — ${jobTitle}`,
  })
}

export function notifyUnknownQuestion(company: string, question: string): void {
  notify({
    kind: 'unknown-question',
    title: 'Mission Control needs your answer',
    subtitle: company,
    message: question.length > 180 ? question.slice(0, 177) + '…' : question,
  })
}

export function notifyFailure(company: string, reason: string): void {
  notify({
    kind: 'failure',
    title: 'Mission Control apply failed',
    subtitle: company,
    message: reason.length > 180 ? reason.slice(0, 177) + '…' : reason,
  })
}
