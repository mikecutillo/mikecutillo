/**
 * site-adapter types — shared contract between the orchestrator and
 * each site-specific adapter (linkedin/workday/greenhouse/etc).
 *
 * Each adapter implements `SiteAdapter` and exports its instance as
 * the module default so `detect.ts` can `import()` it dynamically.
 *
 * The orchestrator NEVER touches Playwright selectors directly — it
 * only calls these methods and lets the adapter decide which buttons
 * to click. That isolation is the whole reason adapters exist.
 */

import { Page } from 'playwright'
import { TaskPhase } from '../task-store'

export type SiteName =
  | 'linkedin'
  | 'workday'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'icims'
  | 'generic'

/**
 * Lightweight context passed to every adapter method. The
 * orchestrator fills this in before calling the adapter — adapters
 * don't need to know about the file system or the fetch() layer.
 */
export interface ApplyContext {
  page: Page
  job: {
    id: string
    company?: string
    title?: string
    url: string
    description?: string
  }
  /** Absolute path to the PDF to upload (from resume-exporter). */
  resumePdfPath: string
  /** The task id — used for pauseForAnswer() calls via the hooks. */
  taskId: string
  /** Hook: called by the adapter whenever it transitions phase. */
  setPhase: (phase: TaskPhase, message?: string) => void
  /**
   * Hook: ask the bank for an answer to a form field. If the bank
   * doesn't know (and the question isn't in `sensitiveKeywordsPause`),
   * returns the answer. Otherwise suspends until Mike types it in
   * Mission Control and the /resume endpoint is hit, then returns it.
   * Throws if cancelled.
   */
  resolveAnswer: (question: {
    question: string
    fieldLabel?: string
    fieldType?: string
  }) => Promise<string>
  /** Configuration (autoSubmit, jitter, etc). */
  config: {
    autoSubmit: boolean
    jitterMinMs: number
    jitterMaxMs: number
  }
}

export interface ApplyOutcome {
  status: 'applied' | 'failed'
  message?: string
  submittedAt?: string
  /** Screenshot buffer for the audit trail, if the adapter captured one. */
  screenshot?: Buffer
}

export interface SiteAdapter {
  name: SiteName
  /** True if this adapter can handle `url`. */
  canHandle(url: string): boolean
  /** Run the full apply flow. Returns when the page is in a terminal state. */
  apply(ctx: ApplyContext): Promise<ApplyOutcome>
}
