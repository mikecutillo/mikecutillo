/**
 * task-store — in-process map of apply tasks for status polling.
 *
 * The auto-apply route kicks off the worker asynchronously and returns
 * a `taskId` immediately. The page.tsx UI polls `/api/job-pipeline/
 * auto-apply/status?taskId=...` to drive the card's live status + the
 * "needs answer" banner.
 *
 * Scope: single-process only. That's fine for personal use — Next.js
 * dev + prod both run as one process. If this ever needs to survive a
 * restart, swap to a small JSON-file backing store.
 *
 * We also gate each task through a resume promise so the worker can
 * pause on an unknown question and be woken up when Mike submits the
 * answer via `/api/job-pipeline/auto-apply/resume`.
 */

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'needs-answer'
  | 'needs-sensitive-confirm'
  | 'applied'
  | 'failed'

export type TaskPhase =
  | 'analyzing-fit'
  | 'generating-resume'
  | 'exporting-pdf'
  | 'opening-site'
  | 'filling-form'
  | 'answering-screening'
  | 'submitting'
  | 'done'
  | 'error'

export interface UnknownPrompt {
  question: string
  fieldLabel?: string
  fieldType?: string
  candidateAnswer?: string
  similarity?: number
  sensitive?: boolean
}

export interface ApplyTask {
  taskId: string
  jobId: string
  status: TaskStatus
  phase: TaskPhase
  startedAt: string
  updatedAt: string
  finishedAt?: string
  /** Live progress message shown in the UI. */
  message?: string
  /** Populated when `status === 'needs-answer'` or `'needs-sensitive-confirm'`. */
  pendingQuestion?: UnknownPrompt
  /** Populated on failure. */
  error?: string
  /** When `status === 'applied'` or `'failed'`, the associated ApprovalItem id. */
  approvalItemId?: string
}

interface Waiter {
  resolve: (answer: string) => void
  reject: (err: Error) => void
}

const tasks = new Map<string, ApplyTask>()
const waiters = new Map<string, Waiter>()

function makeTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createTask(jobId: string): ApplyTask {
  const now = new Date().toISOString()
  const task: ApplyTask = {
    taskId: makeTaskId(),
    jobId,
    status: 'queued',
    phase: 'analyzing-fit',
    startedAt: now,
    updatedAt: now,
  }
  tasks.set(task.taskId, task)
  return task
}

export function getTask(taskId: string): ApplyTask | undefined {
  return tasks.get(taskId)
}

export function findActiveTaskForJob(jobId: string): ApplyTask | undefined {
  for (const t of tasks.values()) {
    if (t.jobId !== jobId) continue
    if (t.status === 'applied' || t.status === 'failed') continue
    return t
  }
  return undefined
}

export function listTasks(): ApplyTask[] {
  return Array.from(tasks.values())
}

export function updateTask(taskId: string, patch: Partial<ApplyTask>): ApplyTask | undefined {
  const t = tasks.get(taskId)
  if (!t) return undefined
  Object.assign(t, patch, { updatedAt: new Date().toISOString() })
  return t
}

export function finishTask(
  taskId: string,
  status: 'applied' | 'failed',
  extras: Partial<ApplyTask> = {},
): ApplyTask | undefined {
  const t = tasks.get(taskId)
  if (!t) return undefined
  const finishedAt = new Date().toISOString()
  Object.assign(t, extras, {
    status,
    phase: status === 'applied' ? 'done' : 'error',
    finishedAt,
    updatedAt: finishedAt,
  })
  return t
}

/**
 * Pause the task on an unknown question. Returns a promise that
 * resolves when the UI calls `resumeTask(taskId, answer)`. If Mike
 * abandons the run or the task is cancelled, the worker's `await`
 * throws and the orchestrator captures it as a failure.
 *
 * Scope note: the waiter map is in-process. If the server restarts
 * mid-pause the browser keeps its state but the worker loses its
 * await — the task shows up stuck in `needs-answer` and the UI
 * surfaces a retry button. A future phase could checkpoint the
 * waiter to disk, but for personal use a restart during apply is
 * vanishingly rare.
 */
export function pauseForAnswer(taskId: string, prompt: UnknownPrompt, sensitive = false): Promise<string> {
  const t = tasks.get(taskId)
  if (!t) return Promise.reject(new Error(`task ${taskId} not found`))
  const status: TaskStatus = sensitive ? 'needs-sensitive-confirm' : 'needs-answer'
  updateTask(taskId, { status, pendingQuestion: { ...prompt, sensitive } })
  return new Promise<string>((resolve, reject) => {
    waiters.set(taskId, { resolve, reject })
  })
}

export function resumeTask(taskId: string, answer: string): boolean {
  const w = waiters.get(taskId)
  if (!w) return false
  waiters.delete(taskId)
  const t = tasks.get(taskId)
  if (t) updateTask(taskId, { status: 'running', pendingQuestion: undefined })
  w.resolve(answer)
  return true
}

export function cancelTask(taskId: string, reason = 'cancelled'): boolean {
  const w = waiters.get(taskId)
  if (w) {
    waiters.delete(taskId)
    w.reject(new Error(reason))
  }
  const t = tasks.get(taskId)
  if (t && t.status !== 'applied' && t.status !== 'failed') {
    finishTask(taskId, 'failed', { error: reason })
    return true
  }
  return false
}

/** Count applies completed today (based on finishedAt date). */
export function countAppliedToday(): number {
  const today = new Date().toISOString().slice(0, 10)
  let n = 0
  for (const t of tasks.values()) {
    if (t.status !== 'applied') continue
    if (!t.finishedAt) continue
    if (t.finishedAt.slice(0, 10) === today) n++
  }
  return n
}

/** Last applied task (for cooldown calculation). */
export function lastFinishedAt(): Date | null {
  let latest: Date | null = null
  for (const t of tasks.values()) {
    if (!t.finishedAt) continue
    const d = new Date(t.finishedAt)
    if (!latest || d > latest) latest = d
  }
  return latest
}
