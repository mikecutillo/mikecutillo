/**
 * auto-apply status — poll endpoint for the UI.
 *
 * GET ?taskId=task_xxx → current ApplyTask shape
 * GET (no taskId)      → list of all tasks (debug view)
 *
 * Surfaces everything the UI needs to render:
 *   - status + phase + message for the live progress bar
 *   - pendingQuestion when status === 'needs-answer' / 'needs-sensitive-confirm'
 *   - error when status === 'failed'
 *   - approvalItemId when status === 'applied' (link to audit record)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTask, listTasks } from '@/lib/apply-worker/task-store'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const taskId = searchParams.get('taskId')

  if (!taskId) {
    // Debug list — the UI usually calls with a specific taskId
    return NextResponse.json({ tasks: listTasks() })
  }

  const task = getTask(taskId)
  if (!task) {
    return NextResponse.json({ error: `Task ${taskId} not found` }, { status: 404 })
  }
  return NextResponse.json({ task })
}
