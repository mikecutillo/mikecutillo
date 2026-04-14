import { NextRequest, NextResponse } from 'next/server'
import { generateId, readJSON, writeJSON } from '@/lib/data'
import { spawn } from 'child_process'
import fs from 'fs/promises'

type LaneStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed'

type AgentLane = {
  id: string
  agentId: string
  agentName: string
  title: string
  prompt: string
  status: LaneStatus
  output?: string
  error?: string
  processId?: number
  createdAt: string
  updatedAt: string
}

const FILE = 'agent-lanes.json'
const CWD = '/Users/mikecutillo/.openclaw/workspace-shared'
const LOG_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/agent-lane-logs'

async function updateLane(id: string, patch: Partial<AgentLane>) {
  const lanes = await readJSON<AgentLane[]>(FILE, [])
  const idx = lanes.findIndex(l => l.id === id)
  if (idx === -1) return null
  lanes[idx] = { ...lanes[idx], ...patch, updatedAt: new Date().toISOString() }
  await writeJSON(FILE, lanes)
  return lanes[idx]
}

async function runLaneProcess(lane: AgentLane) {
  await fs.mkdir(LOG_DIR, { recursive: true })
  const logPath = `${LOG_DIR}/${lane.id}.log`
  const out = await fs.open(logPath, 'w')

  const child = spawn('openclaw', ['agent', '--local', '--agent', lane.agentId, '--message', lane.prompt, '--json'], {
    cwd: CWD,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await updateLane(lane.id, { status: 'running', processId: child.pid, output: `Launching ${lane.agentName}...\nLog: ${logPath}` })

  child.stdout.on('data', async (chunk) => { await out.appendFile(chunk) })
  child.stderr.on('data', async (chunk) => { await out.appendFile(chunk) })

  child.on('close', async (code) => {
    await out.close()
    const output = await fs.readFile(logPath, 'utf8').catch(() => '')
    if (code === 0) {
      await updateLane(lane.id, { status: 'done', output: output || `${lane.agentName} completed.` })
    } else {
      await updateLane(lane.id, { status: 'failed', error: output || `${lane.agentName} exited with code ${code}` })
    }
  })
}

export async function GET() {
  const lanes = await readJSON<AgentLane[]>(FILE, [])
  return NextResponse.json({ lanes })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const lanes = await readJSON<AgentLane[]>(FILE, [])
  const now = new Date().toISOString()
  const lane: AgentLane = {
    id: generateId(),
    agentId: body.agentId,
    agentName: body.agentName,
    title: body.title || `Task for ${body.agentName}`,
    prompt: body.prompt || '',
    status: 'queued',
    output: '',
    createdAt: now,
    updatedAt: now,
  }
  lanes.unshift(lane)
  await writeJSON(FILE, lanes)
  void runLaneProcess(lane)
  return NextResponse.json({ lane })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const lanes = await readJSON<AgentLane[]>(FILE, [])
  const idx = lanes.findIndex(l => l.id === body.id)
  if (idx === -1) return NextResponse.json({ error: 'Lane not found' }, { status: 404 })
  lanes[idx] = { ...lanes[idx], ...body, updatedAt: new Date().toISOString() }
  await writeJSON(FILE, lanes)
  return NextResponse.json({ lane: lanes[idx] })
}
