import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

type AgentType = 'chief' | 'operations' | 'specialist'

type TeamAgent = {
  id: string
  name: string
  emoji: string
  role: string
  description: string
  skills: string[]
  model: string
  device: string
  status: 'working' | 'idle' | 'offline'
  currentTask: string
  type: AgentType
  accentColor: string
  purpose?: string
  rules?: string
  guardrails?: string
}

const OPENCLAW_CONFIG = '/Users/mikecutillo/.openclaw/openclaw.json'
const META_FILE = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/team-meta.json'

const DEFAULT_META: Record<string, Omit<TeamAgent, 'id' | 'name' | 'model'>> = {
  finn: { emoji: '🗡️', role: 'Chief of Staff', description: 'Orchestrates specialist work, keeps mission state coherent, and delegates tasks across the team.', skills: ['Orchestration', 'Delegation', 'Clarity'], device: "Mike's Mac mini", status: 'idle', currentTask: 'Standing by', type: 'chief', accentColor: '#5E6AD2', purpose: '', rules: '', guardrails: '' },
  jake: { emoji: '🐕', role: 'QA / Workflow Manager', description: 'Reviews work quality, tracks blockers, validates workflow state. Catches drift before it becomes a problem.', skills: ['Quality Assurance', 'Monitoring', 'Workflow'], device: "Mike's Mac mini", status: 'idle', currentTask: 'Standing by', type: 'operations', accentColor: '#F59E0B', purpose: '', rules: '', guardrails: '' },
  bmo: { emoji: '🎮', role: 'Infrastructure Engineer', description: 'Runtime wiring, backend plumbing, APIs, cron, and system integration. Owns all infrastructure-style work.', skills: ['Coding', 'Infrastructure', 'Automation'], device: "Mike's Mac mini", status: 'idle', currentTask: 'Standing by', type: 'operations', accentColor: '#26C26E', purpose: '', rules: '', guardrails: '' },
  pb: { emoji: '👑', role: 'Interface Designer', description: 'Dashboard/UI layout, visual systems, density, spacing, hierarchy, and polish. Owns all design decisions.', skills: ['Design', 'Visual Systems', 'UI/UX'], device: "Mike's Mac mini", status: 'idle', currentTask: 'Standing by', type: 'specialist', accentColor: '#EC4899', purpose: '', rules: '', guardrails: '' },
  lsp: { emoji: '🌈', role: 'Content Writer', description: 'Copywriting, drafting notes and summaries, messaging and language cleanup.', skills: ['Voice', 'Quality', 'Design'], device: "Mike's Mac mini", status: 'idle', currentTask: 'Standing by', type: 'specialist', accentColor: '#8B5CF6', purpose: '', rules: '', guardrails: '' },
  fern: { emoji: '🌿', role: 'Trend Analyst', description: 'Research, signal tracking, opportunity scanning, and prioritization inputs.', skills: ['Speed', 'Radar', 'Intuition'], device: "Mike's Mac mini", status: 'idle', currentTask: 'Standing by', type: 'specialist', accentColor: '#10B981', purpose: '', rules: '', guardrails: '' },
  'ice-king': { emoji: '❄️', role: 'Social / Outreach Manager', description: 'Outward-facing updates, distribution, visibility, follow-up messaging, and social/outreach tasks.', skills: ['Viral', 'Speed', 'Reach'], device: "Mike's Mac mini", status: 'idle', currentTask: 'Standing by', type: 'specialist', accentColor: '#60A5FA', purpose: '', rules: '', guardrails: '' },
  turbodot: { emoji: '🧠', role: 'Primary Operator', description: 'High-agency operator lane for direct execution, synthesis, and hands-on delivery.', skills: ['Execution', 'Autonomy', 'Delivery'], device: "Mike's Mac mini", status: 'working', currentTask: 'Running active control session', type: 'operations', accentColor: '#A78BFA', purpose: '', rules: '', guardrails: '' },
}

async function readJsonSafe(file: string, fallback: any) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

export async function GET() {
  const raw = JSON.parse(await fs.readFile(OPENCLAW_CONFIG, 'utf8'))
  const meta = await readJsonSafe(META_FILE, {})
  const list = raw?.agents?.list ?? []
  const ids = ['finn', 'jake', 'bmo', 'pb', 'lsp', 'fern', 'ice-king', 'turbodot']
  const agents: TeamAgent[] = ids
    .map((id) => list.find((a: any) => a.id === id))
    .filter(Boolean)
    .map((a: any) => ({
      id: a.id,
      name: a.name ?? a.id,
      model: a.model?.primary ?? raw?.agents?.defaults?.model?.primary ?? 'unknown',
      ...DEFAULT_META[a.id],
      ...(meta[a.id] ?? {}),
    }))
  return NextResponse.json({ agents })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as TeamAgent
  const meta = await readJsonSafe(META_FILE, {})
  meta[body.id] = {
    ...(meta[body.id] ?? {}),
    purpose: body.purpose ?? '',
    rules: body.rules ?? '',
    guardrails: body.guardrails ?? '',
  }
  await fs.mkdir(path.dirname(META_FILE), { recursive: true })
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n')
  return NextResponse.json({ ok: true })
}
