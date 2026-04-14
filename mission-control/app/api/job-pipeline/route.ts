import { NextRequest, NextResponse } from 'next/server'
import { readJSON, writeJSON, generateId } from '@/lib/data'
import { postToDiscord, DISCORD_COLORS } from '@/lib/discord-dispatch'

interface Job {
  id: string
  company: string
  title: string
  location: string
  remote: boolean
  salary?: string
  salaryRange?: string
  datePosted?: string
  applicantCount?: string
  companyLogoUrl?: string
  quickSummary?: { greenFlag: string; redFlag: string }
  lane?: string
  status: 'found' | 'applied' | 'phone-screen' | 'interview' | 'offer' | 'rejected'
  url: string
  description: string
  easyApply: boolean
  matchScore: number
  appliedDate?: string
  notes: string
  resumeVersion?: string
  tags: string[]
  createdAt: string
  priority: 'hot' | 'good' | 'stretch'
}

// No seed data — pipeline is populated by job intake and scout runs only
const SEED_JOBS: Job[] = []

// Type guard — ensures only well-formed Job records reach the UI.
// Without this, any malformed write to job-pipeline.json (e.g. lane config
// objects accidentally saved here) would crash the kanban on first render.
function isValidJob(j: unknown): j is Job {
  if (!j || typeof j !== 'object') return false
  const r = j as Record<string, unknown>
  return typeof r.id === 'string'
    && typeof r.company === 'string'
    && typeof r.title === 'string'
    && typeof r.url === 'string'
}

export async function GET() {
  const raw = await readJSON<unknown[]>('job-pipeline.json', [])
  const jobs = Array.isArray(raw) ? raw.filter(isValidJob) : []
  return NextResponse.json(jobs)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const jobs = await readJSON<Job[]>('job-pipeline.json', SEED_JOBS)
  const newJob: Job = {
    ...body,
    id: generateId(),
    createdAt: new Date().toISOString(),
  }
  jobs.unshift(newJob)
  await writeJSON('job-pipeline.json', jobs)
  return NextResponse.json(newJob, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const jobs = await readJSON<Job[]>('job-pipeline.json', SEED_JOBS)
  const idx = jobs.findIndex((j) => j.id === body.id)
  if (idx === -1) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  const oldStatus = jobs[idx].status
  jobs[idx] = { ...jobs[idx], ...body }
  await writeJSON('job-pipeline.json', jobs)

  // Notify Discord on status change
  const job = jobs[idx]
  if (body.status && body.status !== oldStatus) {
    postToDiscord('job-pipeline', {
      title: `Job Pipeline — ${oldStatus} → ${body.status}`,
      color: body.status === 'offer' ? DISCORD_COLORS.family
        : body.status === 'rejected' ? DISCORD_COLORS.alert
        : DISCORD_COLORS.jobs,
      fields: [
        { name: 'Company', value: job.company, inline: true },
        { name: 'Title', value: job.title, inline: true },
        { name: 'Status', value: body.status, inline: true },
        ...(job.salary ? [{ name: 'Salary', value: job.salary, inline: true }] : []),
      ],
    }).catch(() => {})
  }

  return NextResponse.json(job)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const jobs = await readJSON<Job[]>('job-pipeline.json', SEED_JOBS)
  const filtered = jobs.filter((j) => j.id !== id)
  await writeJSON('job-pipeline.json', filtered)
  return NextResponse.json({ success: true })
}
