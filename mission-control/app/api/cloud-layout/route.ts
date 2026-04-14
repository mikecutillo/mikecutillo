import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'

const DATA_FILE = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/cloud-layout.json'

export async function GET() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    return NextResponse.json(JSON.parse(raw))
  } catch { return NextResponse.json({ positions: {} }) }
}

export async function PUT(req: NextRequest) {
  try {
    const { positions } = await req.json()
    await fs.writeFile(DATA_FILE, JSON.stringify({ positions }, null, 2))
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: 'Failed to save' }, { status: 500 }) }
}
