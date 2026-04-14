import { NextResponse, NextRequest } from 'next/server'
import {
  loadEvents,
  saveEvents,
  makeEvent,
  type FamilyPerson,
  type EventSource,
  type EventCategory,
  type EventSeverity,
} from '@/lib/family-intel'

// GET /api/family-intel/events
// Query params: person, source, category, severity, since (ISO), limit (default 200)
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const person   = sp.get('person')   as FamilyPerson | null
  const source   = sp.get('source')   as EventSource | null
  const category = sp.get('category') as EventCategory | null
  const severity = sp.get('severity') as EventSeverity | null
  const since    = sp.get('since')
  const limit    = Math.min(parseInt(sp.get('limit') || '200'), 2000)

  let events = await loadEvents()

  if (person)   events = events.filter(e => e.person === person)
  if (source)   events = events.filter(e => e.source === source)
  if (category) events = events.filter(e => e.category === category)
  if (severity) events = events.filter(e => e.severity === severity)
  if (since)    events = events.filter(e => e.timestamp >= since)

  // Newest first
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const page = events.slice(0, limit)

  // Aggregate counts for stats
  const counts = {
    total: events.length,
    byPerson: countBy(events, 'person'),
    bySource: countBy(events, 'source'),
    byCategory: countBy(events, 'category'),
    bySeverity: countBy(events, 'severity'),
  }

  return NextResponse.json({ events: page, counts, returned: page.length })
}

// POST /api/family-intel/events — add a manual event
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const event = makeEvent({
      timestamp:    body.timestamp   || new Date().toISOString(),
      source:       body.source      || 'manual',
      sourceDetail: body.sourceDetail || 'manual',
      person:       body.person      || 'unknown',
      device:       body.device,
      category:     body.category    || 'network',
      severity:     body.severity    || 'info',
      title:        body.title       || 'Manual event',
      description:  body.description || '',
      domain:       body.domain,
      metadata:     body.metadata    || {},
    })
    const existing = await loadEvents()
    await saveEvents([...existing, event])
    return NextResponse.json({ event }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// DELETE /api/family-intel/events?all=true  — wipe all events
// DELETE /api/family-intel/events?id=xxx    — delete one event
export async function DELETE(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const all = sp.get('all')
  const id  = sp.get('id')

  if (all === 'true') {
    await saveEvents([])
    return NextResponse.json({ cleared: true })
  }

  if (id) {
    const events = await loadEvents()
    const filtered = events.filter(e => e.id !== id)
    await saveEvents(filtered)
    return NextResponse.json({ deleted: filtered.length < events.length })
  }

  return NextResponse.json({ error: 'Provide ?all=true or ?id=xxx' }, { status: 400 })
}

function countBy(arr: unknown[], key: string): Record<string, number> {
  return arr.reduce((acc: Record<string, number>, item) => {
    const val = String((item as Record<string, unknown>)[key] ?? 'unknown')
    acc[val] = (acc[val] ?? 0) + 1
    return acc
  }, {})
}
