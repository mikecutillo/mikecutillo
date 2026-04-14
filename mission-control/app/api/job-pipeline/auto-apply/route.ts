/**
 * auto-apply — kick off the Playwright worker for a job.
 *
 * Replaces the old Python-spawn flow (`linkedin_easy_apply.py`) with a
 * pure Node/Playwright path via `lib/apply-worker`. Returns immediately
 * with a taskId — the worker runs async in the same process. The UI
 * polls `/api/job-pipeline/auto-apply/status?taskId=...` for live status.
 *
 * Contract:
 *   POST { jobId }
 *   → 200 { status: 'running' | 'already-running', taskId, note? }
 *   → 400 { error }  (missing jobId, cap/cooldown blocks)
 *   → 404 { error }  (job not found)
 */

import { NextRequest, NextResponse } from 'next/server'
import { applyToJob } from '@/lib/apply-worker'

export async function POST(req: NextRequest) {
  let jobId: string | undefined
  try {
    const body = await req.json()
    jobId = body?.jobId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  const result = await applyToJob(jobId)
  if (!result.ok) {
    // Distinguish "not found" (404) from "blocked by cap/cooldown" (400)
    const status = /not found/i.test(result.reason) ? 404 : 400
    return NextResponse.json({ error: result.reason }, { status })
  }

  return NextResponse.json({
    status: result.note === 'already running' ? 'already-running' : 'running',
    taskId: result.taskId,
    note:
      result.note ??
      'Worker launched. Poll /api/job-pipeline/auto-apply/status?taskId=… for progress.',
  })
}
