/**
 * auto-apply resume — wake a paused worker with Mike's answer.
 *
 * Called by the UI's `needs-answer` banner inline form:
 *   POST { taskId, answer }
 *
 * Flow:
 *   1. Validate the task is actually in a `needs-answer` /
 *      `needs-sensitive-confirm` state (otherwise there's no waiter)
 *   2. Call `resumeTask(taskId, answer)` — resolves the worker's
 *      `pauseForAnswer()` promise inside the orchestrator
 *   3. The worker then persists the answer to the bank (via
 *      `addEntry` inside the orchestrator's `resolveAnswer` closure)
 *      and continues filling the form
 *
 * Also supports POST { taskId, cancel: true } to abort a paused task
 * without supplying an answer — flags the task as failed and releases
 * the waiter with a rejection.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTask, resumeTask, cancelTask } from '@/lib/apply-worker/task-store'

export async function POST(req: NextRequest) {
  let body: { taskId?: string; answer?: string; cancel?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { taskId, answer, cancel } = body
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  }

  const task = getTask(taskId)
  if (!task) {
    return NextResponse.json({ error: `Task ${taskId} not found` }, { status: 404 })
  }

  // Cancel path
  if (cancel) {
    const cancelled = cancelTask(taskId, 'cancelled by user')
    return NextResponse.json({
      ok: cancelled,
      status: getTask(taskId)?.status ?? 'unknown',
    })
  }

  // Answer path — only valid when actually waiting
  if (task.status !== 'needs-answer' && task.status !== 'needs-sensitive-confirm') {
    return NextResponse.json(
      { error: `Task is in ${task.status} state — not waiting for an answer` },
      { status: 409 },
    )
  }
  if (!answer || typeof answer !== 'string' || !answer.trim()) {
    return NextResponse.json({ error: 'answer required' }, { status: 400 })
  }

  const resumed = resumeTask(taskId, answer.trim())
  if (!resumed) {
    return NextResponse.json(
      { error: 'No active waiter — task may already have timed out' },
      { status: 409 },
    )
  }
  return NextResponse.json({
    ok: true,
    taskId,
    status: getTask(taskId)?.status ?? 'running',
  })
}
