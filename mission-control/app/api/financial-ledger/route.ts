import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'

const DATA_FILE = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/financial-ledger.json'

async function read() {
  const raw = await fs.readFile(DATA_FILE, 'utf-8')
  return JSON.parse(raw)
}
async function write(data: unknown) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
}

export async function GET() {
  try { return NextResponse.json(await read()) }
  catch { return NextResponse.json({ error: 'Failed to read ledger' }, { status: 500 }) }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, updates } = await req.json()
    const data = await read()
    const idx = data.items.findIndex((s: { id: string }) => s.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    data.items[idx] = { ...data.items[idx], ...updates, updated_at: new Date().toISOString() }
    await write(data)
    return NextResponse.json({ ok: true, item: data.items[idx] })
  } catch { return NextResponse.json({ error: 'Failed to update' }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    const { item } = await req.json()
    const data = await read()
    const slug = (item.vendor || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
    item.id = `fin_${slug}_${Date.now().toString(36)}`
    item.created_at = new Date().toISOString()
    item.updated_at = new Date().toISOString()
    item.evidence = item.evidence || []
    item.receipts = item.receipts || []
    item.notion_page_id = item.notion_page_id || null
    item.notes = item.notes || ''
    item.tags = item.tags || []
    data.items.push(item)
    data.summary.total_items = data.items.length
    await write(data)
    return NextResponse.json({ ok: true, item })
  } catch { return NextResponse.json({ error: 'Failed to add' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    const data = await read()
    data.items = data.items.filter((s: { id: string }) => s.id !== id)
    data.summary.total_items = data.items.length
    await write(data)
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: 'Failed to delete' }, { status: 500 }) }
}
