import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'

const DATA_FILE = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/cloud-nodes.json'

type Node = { id: string; label: string; sub: string; r: number; parent: string | null; brand: string; href: string; color: string; used_pct?: number | null }

async function read(): Promise<{ nodes: Node[] }> {
  const raw = await fs.readFile(DATA_FILE, 'utf-8')
  return JSON.parse(raw)
}
async function write(data: { nodes: Node[] }) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
}

export async function GET() {
  try { return NextResponse.json(await read()) }
  catch { return NextResponse.json({ nodes: [] }) }
}

export async function POST(req: NextRequest) {
  try {
    const { node } = await req.json()
    const data = await read()
    node.id = node.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now()
    node.r = node.parent ? 48 : 80
    data.nodes.push(node)
    await write(data)
    return NextResponse.json({ ok: true, node })
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    const data = await read()
    // Also remove children of this node
    const toRemove = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      data.nodes.forEach(n => { if (n.parent && toRemove.has(n.parent) && !toRemove.has(n.id)) { toRemove.add(n.id); changed = true } })
    }
    data.nodes = data.nodes.filter(n => !toRemove.has(n.id))
    await write(data)
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }) }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, updates } = await req.json()
    const data = await read()
    const idx = data.nodes.findIndex(n => n.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    data.nodes[idx] = { ...data.nodes[idx], ...updates }
    await write(data)
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }) }
}
