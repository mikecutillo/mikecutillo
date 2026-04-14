import { NextRequest, NextResponse } from 'next/server'
import { readJSON, writeJSON, generateId } from '@/lib/data'

interface RelayMessage {
  id: string
  from: string
  to: string
  type: string
  subject: string
  body: string
  timestamp: string
  read: boolean
}

// GET /api/relay?for=<machine>&unread=true
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const forMachine = searchParams.get('for')
  const unreadOnly = searchParams.get('unread') === 'true'

  let messages = await readJSON<RelayMessage[]>('relay.json', [])

  if (forMachine) {
    messages = messages.filter(m => m.to === forMachine || m.to === 'all')
  }
  if (unreadOnly) {
    messages = messages.filter(m => !m.read)
  }

  return NextResponse.json({ messages })
}

// POST /api/relay — send a message
export async function POST(req: NextRequest) {
  const body = await req.json()
  const messages = await readJSON<RelayMessage[]>('relay.json', [])

  const msg: RelayMessage = {
    id: generateId(),
    from: body.from || 'unknown',
    to: body.to || 'all',
    type: body.type || 'note',
    subject: body.subject || '',
    body: body.body || '',
    timestamp: new Date().toISOString(),
    read: false,
  }

  messages.push(msg)
  await writeJSON('relay.json', messages)
  return NextResponse.json({ message: msg })
}

// PUT /api/relay — update a message (mark as read, etc.)
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const messages = await readJSON<RelayMessage[]>('relay.json', [])
  const idx = messages.findIndex(m => m.id === body.id)

  if (idx === -1) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  messages[idx] = { ...messages[idx], ...body }
  await writeJSON('relay.json', messages)
  return NextResponse.json({ message: messages[idx] })
}

// DELETE /api/relay?id=<id> — delete a message
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  let messages = await readJSON<RelayMessage[]>('relay.json', [])
  messages = messages.filter(m => m.id !== id)
  await writeJSON('relay.json', messages)
  return NextResponse.json({ success: true })
}
