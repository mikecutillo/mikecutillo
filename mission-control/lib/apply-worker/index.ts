/**
 * apply-worker — one-click apply orchestrator.
 *
 * Public entry: `applyToJob(jobId)`. Called by
 * `/api/job-pipeline/auto-apply` — returns a taskId immediately, then
 * runs the full apply flow in the background:
 *
 *   1. Guard against duplicate runs + enforce daily cap / cooldown
 *   2. Run fit analysis across all 4 lanes (best-effort — failures here
 *      are non-fatal, we fall back to the master resume)
 *   3. Pick the resume PDF to upload:
 *        custom-generated (if Mike clicked Generate Custom Resume) →
 *        recommended lane (from fit analysis) →
 *        job.lane (if Mike tagged the card) →
 *        master resume (absolute fallback)
 *   4. Open the persistent Playwright context
 *   5. Pick the right site adapter for job.url
 *   6. Run `adapter.apply(ctx)` where `ctx.resolveAnswer` closes over
 *      the answer bank + pause/resume flow:
 *        - Known non-sensitive question → answer immediately
 *        - Sensitive or unknown → pauseForAnswer() → waits on UI
 *          resume endpoint → new answer is saved permanently
 *   7. On success: update job status, write ApprovalItem audit record,
 *      desktop notification
 *   8. On failure: desktop notification, finishTask('failed')
 *
 * The whole flow is async — the HTTP route kicks it off and returns.
 * Status is surfaced through `task-store` and polled by the UI.
 */

import fs from 'fs/promises'
import path from 'path'
import { tailorLane, TailorResult, Lane } from '../tailor-core'
import {
  createTask,
  updateTask,
  finishTask,
  pauseForAnswer,
  findActiveTaskForJob,
  countAppliedToday,
  lastFinishedAt,
  ApplyTask,
  TaskPhase,
} from './task-store'
import { openSession, releaseSession } from './browser'
import { pickAdapter } from './site-adapters/detect'
import { ApplyContext, ApplyOutcome } from './site-adapters/types'
import {
  findBestMatch,
  isSensitive,
  touchEntry,
  addEntry,
} from './answer-bank-client'
import {
  exportJobResumePdf,
  exportLaneResumePdf,
  exportMasterResumePdf,
} from './resume-exporter'
import { logUnknown, markResolved } from './unknowns-log'
import { notifyApplied, notifyUnknownQuestion, notifyFailure } from './notify'
import { loadConfig, ApplyConfig } from './config'
import { readJSON, writeJSON, generateId } from '../data'

const GENERATED_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/resumes/generated'
const LANES: Lane[] = ['A', 'B', 'C', 'D']

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Matches the shape read by `/api/job-pipeline` — intentionally loose
 * because the worker only needs a handful of fields and the pipeline
 * schema may grow.
 */
interface PipelineJob {
  id: string
  company: string
  title: string
  url: string
  description: string
  location?: string
  remote?: boolean
  lane?: string
  status?: string
  appliedDate?: string
}

/**
 * Matches `app/api/approval-queue/route.ts` — keep this in sync if that
 * file's ApprovalItem interface grows.
 */
interface ApprovalItem {
  id: string
  jobId: string
  company: string
  jobTitle: string
  jobUrl: string
  location: string
  remote: boolean
  resumeLane: Lane
  resumeContent: string
  coverLetter: string
  tailoredAnswers: { question: string; answer: string }[]
  matchScore: number
  status: 'pending' | 'approved' | 'rejected' | 'needs-edit'
  agentNotes: string
  keywordsMatched: string[]
  createdAt: string
  reviewedAt?: string
  submittedAt?: string
  approvedForSubmission: boolean
}

export type StartResult =
  | { ok: true; taskId: string; note?: string }
  | { ok: false; reason: string }

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Start a one-click apply run for `jobId`. Returns immediately with a
 * taskId. The heavy lifting happens asynchronously in `runWorker()`.
 *
 * Idempotency: if a task is already active for this job, returns that
 * task's id instead of starting a new one. Prevents the UI from kicking
 * off duplicates if Mike double-clicks.
 */
export async function applyToJob(jobId: string): Promise<StartResult> {
  const existing = findActiveTaskForJob(jobId)
  if (existing) {
    return { ok: true, taskId: existing.taskId, note: 'already running' }
  }

  const jobs = await readJSON<PipelineJob[]>('job-pipeline.json', [])
  const job = jobs.find((j) => j.id === jobId)
  if (!job) return { ok: false, reason: `Job ${jobId} not found` }
  if (!job.url) return { ok: false, reason: 'Job has no URL to apply against' }

  const cfg = await loadConfig()

  // Daily cap (counts tasks applied today in-process)
  if (countAppliedToday() >= cfg.maxApplicationsPerDay) {
    return {
      ok: false,
      reason: `Daily cap reached (${cfg.maxApplicationsPerDay}/day)`,
    }
  }

  // Cooldown between applies — behaves like a human, not a bot
  const last = lastFinishedAt()
  if (last && cfg.cooldownMinutes > 0) {
    const elapsedMin = (Date.now() - last.getTime()) / 60_000
    if (elapsedMin < cfg.cooldownMinutes) {
      const wait = Math.ceil(cfg.cooldownMinutes - elapsedMin)
      return {
        ok: false,
        reason: `Cooldown active — wait ${wait} more minute(s) before the next apply`,
      }
    }
  }

  const task = createTask(jobId)
  updateTask(task.taskId, { status: 'running', message: 'Starting worker…' })

  // Fire-and-forget — the HTTP route returns now, the worker keeps running
  void runWorker(task, job, cfg).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error('[apply-worker] top-level crash:', err)
    finishTask(task.taskId, 'failed', { error: msg })
    notifyFailure(job.company ?? 'Job', msg)
  })

  return { ok: true, taskId: task.taskId }
}

// ── Worker internals ──────────────────────────────────────────────────────────

async function runWorker(
  task: ApplyTask,
  job: PipelineJob,
  cfg: ApplyConfig,
): Promise<void> {
  const setPhase = (phase: TaskPhase, message?: string) => {
    updateTask(task.taskId, { phase, message })
  }

  // ── Step 1: Fit analysis (best-effort) ─────────────────────────────────────
  // Missing ANTHROPIC_API_KEY or a network hiccup here should NOT fail the
  // whole run. The worker falls back to the master/lane PDF.
  setPhase('analyzing-fit', 'Running fit analysis across 4 resume lanes')
  let recommendedLane: Lane | null = null
  const laneResults: TailorResult[] = []
  try {
    const settled = await Promise.allSettled(
      LANES.map((lane) =>
        tailorLane({
          lane,
          jobTitle: job.title,
          company: job.company,
          description: job.description,
        }),
      ),
    )
    settled.forEach((r) => {
      if (r.status === 'fulfilled') laneResults.push(r.value)
    })
    if (laneResults.length > 0) {
      const sorted = [...laneResults].sort((a, b) => {
        if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore
        return LANES.indexOf(a.lane) - LANES.indexOf(b.lane)
      })
      recommendedLane = sorted[0].lane
      updateTask(task.taskId, {
        message: `Recommended: Lane ${recommendedLane} (fit ${sorted[0].fitScore}/100)`,
      })
    } else {
      updateTask(task.taskId, {
        message: 'Fit analysis returned no results — falling back to stored lane',
      })
    }
  } catch {
    updateTask(task.taskId, {
      message: 'Fit analysis unavailable — continuing with fallback resume',
    })
  }

  // Enforce minFitScore gate if configured
  if (cfg.minFitScore > 0 && laneResults.length > 0) {
    const topScore = Math.max(...laneResults.map((r) => r.fitScore))
    if (topScore < cfg.minFitScore) {
      const msg = `Top fit ${topScore}/100 below minFitScore ${cfg.minFitScore}`
      finishTask(task.taskId, 'failed', { error: msg })
      notifyFailure(job.company, msg)
      return
    }
  }

  // ── Step 2: Pick resume PDF ────────────────────────────────────────────────
  setPhase('exporting-pdf', 'Exporting resume PDF')
  let resumePdfPath: string
  try {
    resumePdfPath = await pickResumePdf(job, recommendedLane)
  } catch (err) {
    const msg = `Resume PDF export failed: ${(err as Error).message}`
    finishTask(task.taskId, 'failed', { error: msg })
    notifyFailure(job.company, msg)
    return
  }
  updateTask(task.taskId, { message: `Resume: ${path.basename(resumePdfPath)}` })

  // ── Step 3: Open browser + adapter ─────────────────────────────────────────
  setPhase('opening-site', 'Opening browser and navigating to job')
  let session
  try {
    session = await openSession()
  } catch (err) {
    const msg = `Browser launch failed: ${(err as Error).message}`
    finishTask(task.taskId, 'failed', { error: msg })
    notifyFailure(job.company, msg)
    return
  }

  const adapter = pickAdapter(job.url)
  updateTask(task.taskId, {
    message: `Adapter: ${adapter.name}`,
  })

  // Track answers used in this run so the audit trail can show what
  // the worker actually typed into each field.
  const usedAnswers: { question: string; answer: string }[] = []

  const ctx: ApplyContext = {
    page: session.page,
    job: {
      id: job.id,
      company: job.company,
      title: job.title,
      url: job.url,
      description: job.description,
    },
    resumePdfPath,
    taskId: task.taskId,
    setPhase,
    resolveAnswer: async (q) => {
      setPhase('answering-screening', `Resolving: ${q.question.slice(0, 60)}`)
      const match = await findBestMatch(q.question)
      const sensitive = await isSensitive(q.question, match?.entry.category)

      // Happy path: confident non-sensitive match — use it and move on.
      if (match && !sensitive) {
        await touchEntry(match.entry.id)
        usedAnswers.push({ question: q.question, answer: match.entry.answer })
        return match.entry.answer
      }

      // Slow path: log the unknown (or pending-confirm), notify, and wait.
      const unknownId = await logUnknown({
        question: q.question,
        fieldLabel: q.fieldLabel,
        fieldType: q.fieldType,
        site: adapter.name,
        jobId: job.id,
        jobTitle: job.title,
        company: job.company,
        source: 'worker',
      })
      notifyUnknownQuestion(job.company, q.question)

      const answer = await pauseForAnswer(
        task.taskId,
        {
          question: q.question,
          fieldLabel: q.fieldLabel,
          fieldType: q.fieldType,
          candidateAnswer: match?.entry.answer,
          similarity: match?.similarity,
          sensitive,
        },
        sensitive,
      )

      // Persist the answer permanently. `sensitive` questions get tagged so
      // the Settings view can scope them per-company if needed later.
      try {
        const created = await addEntry({
          question: q.question,
          answer,
          category: sensitive ? 'sensitive' : 'qualitative',
          sourceJobId: job.id,
        })
        await markResolved(unknownId, created.id)
      } catch {
        // non-fatal — the answer is still in the form, just not yet in the bank
      }

      usedAnswers.push({ question: q.question, answer })
      setPhase('filling-form', 'Resuming form fill')
      return answer
    },
    config: {
      autoSubmit: cfg.autoSubmit,
      jitterMinMs: cfg.jitterMinMs,
      jitterMaxMs: cfg.jitterMaxMs,
    },
  }

  // ── Step 4: Run the adapter ────────────────────────────────────────────────
  let outcome: ApplyOutcome
  try {
    outcome = await adapter.apply(ctx)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    outcome = { status: 'failed', message: `Adapter crashed: ${msg}` }
  } finally {
    await releaseSession(session)
  }

  // ── Step 5: Persist outcome ────────────────────────────────────────────────
  if (outcome.status === 'applied') {
    setPhase('done', outcome.message ?? 'Submitted')
    await updateJobStatus(job.id, 'applied', outcome.submittedAt)
    const approvalId = await createAuditRecord({
      job,
      laneResults,
      recommendedLane: recommendedLane ?? inferLaneFromJob(job) ?? 'A',
      resumePdfPath,
      taskId: task.taskId,
      submittedAt: outcome.submittedAt ?? new Date().toISOString(),
      adapterName: adapter.name,
      usedAnswers,
    })
    finishTask(task.taskId, 'applied', {
      approvalItemId: approvalId,
      message: outcome.message,
    })
    notifyApplied(job.company, job.title)
  } else {
    setPhase('error', outcome.message ?? 'Failed')
    finishTask(task.taskId, 'failed', { error: outcome.message })
    notifyFailure(job.company, outcome.message ?? 'Unknown failure')
  }
}

// ── Resume PDF picker ─────────────────────────────────────────────────────────

/**
 * Resolution order:
 *   1. Custom generated markdown at `resumes/generated/{jobId}.md`
 *      (Mike clicked "Generate Custom Resume" in the UI before applying)
 *   2. Recommended lane from fit analysis
 *   3. `job.lane` if Mike tagged the card with A/B/C/D
 *   4. Master resume (never fails)
 */
async function pickResumePdf(
  job: PipelineJob,
  recommendedLane: Lane | null,
): Promise<string> {
  // 1. Custom (UI-generated) markdown
  const customMd = path.join(GENERATED_DIR, `${job.id}.md`)
  try {
    await fs.access(customMd)
    return await exportJobResumePdf(job.id)
  } catch {
    // no custom → fall through
  }

  // 2. Fit-analysis recommendation
  if (recommendedLane) {
    return await exportLaneResumePdf(recommendedLane)
  }

  // 3. Card-tagged lane
  const tagged = inferLaneFromJob(job)
  if (tagged) {
    return await exportLaneResumePdf(tagged)
  }

  // 4. Master fallback
  return await exportMasterResumePdf()
}

function inferLaneFromJob(job: PipelineJob): Lane | null {
  if (!job.lane) return null
  const cleaned = job.lane.replace(/^lane-/i, '').toUpperCase()
  if (cleaned === 'A' || cleaned === 'B' || cleaned === 'C' || cleaned === 'D') {
    return cleaned
  }
  return null
}

// ── Job status + audit trail writers ──────────────────────────────────────────

async function updateJobStatus(
  jobId: string,
  status: string,
  submittedAt?: string,
): Promise<void> {
  try {
    const jobs = await readJSON<PipelineJob[]>('job-pipeline.json', [])
    const idx = jobs.findIndex((j) => j.id === jobId)
    if (idx === -1) return
    jobs[idx] = {
      ...jobs[idx],
      status,
      appliedDate: submittedAt ?? new Date().toISOString(),
    }
    await writeJSON('job-pipeline.json', jobs)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[apply-worker] updateJobStatus failed:', err)
  }
}

/**
 * Create an ApprovalItem as a historical audit record. Per the plan,
 * approved-for-submission is set automatically at the point of submit —
 * this is a read-only trail, not a review gate.
 */
async function createAuditRecord(input: {
  job: PipelineJob
  laneResults: TailorResult[]
  recommendedLane: Lane
  resumePdfPath: string
  taskId: string
  submittedAt: string
  adapterName: string
  usedAnswers: { question: string; answer: string }[]
}): Promise<string> {
  try {
    const items = await readJSON<ApprovalItem[]>('approval-queue.json', [])
    const top = input.laneResults.find((r) => r.lane === input.recommendedLane)
    const allKeywords = new Set<string>()
    for (const r of input.laneResults) {
      for (const k of r.matchedKeywords ?? []) allKeywords.add(k)
    }
    const item: ApprovalItem = {
      id: generateId(),
      jobId: input.job.id,
      company: input.job.company,
      jobTitle: input.job.title,
      jobUrl: input.job.url,
      location: input.job.location ?? 'Remote',
      remote: input.job.remote ?? true,
      resumeLane: input.recommendedLane,
      resumeContent: `Uploaded PDF: ${input.resumePdfPath}`,
      coverLetter: '',
      tailoredAnswers: input.usedAnswers,
      matchScore: top?.fitScore ?? 0,
      status: 'approved',
      agentNotes: [
        `Auto-applied via ${input.adapterName} adapter.`,
        `Task: ${input.taskId}`,
        top?.fitSummary ? `Fit: ${top.fitSummary}` : '',
      ]
        .filter(Boolean)
        .join(' '),
      keywordsMatched: Array.from(allKeywords).slice(0, 15),
      createdAt: new Date().toISOString(),
      submittedAt: input.submittedAt,
      approvedForSubmission: true,
    }
    items.push(item)
    await writeJSON('approval-queue.json', items)
    return item.id
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[apply-worker] createAuditRecord failed:', err)
    return ''
  }
}
