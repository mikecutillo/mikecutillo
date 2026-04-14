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

export async function POST(req: NextRequest) {
  try {
    const { ledger_item_id, receipt } = await req.json()
    const data = await read()
    const idx = data.items.findIndex((s: { id: string }) => s.id === ledger_item_id)
    if (idx === -1) return NextResponse.json({ error: 'Ledger item not found' }, { status: 404 })

    receipt.id = receipt.id || `rcpt_${Date.now().toString(36)}`
    data.items[idx].receipts = data.items[idx].receipts || []
    data.items[idx].receipts.push(receipt)
    data.items[idx].updated_at = new Date().toISOString()
    await write(data)
    return NextResponse.json({ ok: true, receipt })
  } catch { return NextResponse.json({ error: 'Failed to attach receipt' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const { ledger_item_id, receipt_id } = await req.json()
    const data = await read()
    const idx = data.items.findIndex((s: { id: string }) => s.id === ledger_item_id)
    if (idx === -1) return NextResponse.json({ error: 'Ledger item not found' }, { status: 404 })

    data.items[idx].receipts = (data.items[idx].receipts || [])
      .filter((r: { id: string }) => r.id !== receipt_id)
    data.items[idx].updated_at = new Date().toISOString()
    await write(data)
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: 'Failed to remove receipt' }, { status: 500 }) }
}
