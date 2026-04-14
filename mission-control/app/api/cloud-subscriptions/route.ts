import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'

const DATA_FILE = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/cloud-subscriptions.json'

async function read() {
  const raw = await fs.readFile(DATA_FILE, 'utf-8')
  return JSON.parse(raw)
}
async function write(data: unknown) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
}

export async function GET() {
  try { return NextResponse.json(await read()) }
  catch { return NextResponse.json({ error: 'Failed to read' }, { status: 500 }) }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, updates } = await req.json()
    const data = await read()
    const idx = data.subscriptions.findIndex((s: { id: string }) => s.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    data.subscriptions[idx] = { ...data.subscriptions[idx], ...updates }
    await write(data)
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: 'Failed to update' }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    const { subscription } = await req.json()
    const data = await read()
    subscription.id = subscription.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
    data.subscriptions.push(subscription)
    await write(data)
    return NextResponse.json({ ok: true, subscription })
  } catch { return NextResponse.json({ error: 'Failed to add' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    const data = await read()
    data.subscriptions = data.subscriptions.filter((s: { id: string }) => s.id !== id)
    await write(data)
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: 'Failed to delete' }, { status: 500 }) }
}
