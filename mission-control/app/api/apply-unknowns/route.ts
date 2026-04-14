/**
 * apply-unknowns — log of questions the worker (Phase 2) and the
 * Chrome extension (Phase 3) couldn't match against the answer bank.
 *
 * This is the queue side of the unknowns loop: each row that lands
 * here gets surfaced in the Mission Control Answer Bank UI's
 * UnknownsQueuePanel and in the extension popup's inline-resolve list.
 * When Mike answers one — either in Mission Control or in the popup —
 * the matching unknown is PATCHed to `resolved: true` so it disappears
 * from both surfaces.
 *
 * The underlying file storage is owned by `lib/apply-worker/unknowns-log.ts`,
 * which both the worker and this route share. This route is just an
 * HTTP surface.
 *
 *   GET ?unresolved=true   → { entries: UnknownEntry[] }
 *   GET ?unresolved=false  → { entries: UnknownEntry[] }   // all
 *   POST { label, url?, pageTitle?, source?, jobId?, jobTitle?, company? }
 *                          → { entry: UnknownEntry }
 *   PATCH { id, resolvedBankEntryId }
 *                          → { entry: UnknownEntry }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  listAll,
  listUnresolved,
  logUnknown,
  markResolved,
  type UnknownEntry,
} from '@/lib/apply-worker/unknowns-log'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const unresolvedOnly = searchParams.get('unresolved')
  const entries: UnknownEntry[] =
    unresolvedOnly === 'false' ? await listAll() : await listUnresolved()
  // Newest first so the queue panel shows recent gaps at the top.
  entries.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest) {
  let body: {
    label?: string
    question?: string
    url?: string
    pageTitle?: string
    source?: 'worker' | 'extension'
    jobId?: string
    jobTitle?: string
    company?: string
    fieldType?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Accept either `label` (extension shape) or `question` (worker shape).
  const question = (body.question || body.label || '').trim()
  if (!question) {
    return NextResponse.json({ error: 'question (or label) required' }, { status: 400 })
  }

  // De-dupe: if an unresolved entry with the same question already
  // exists, return it instead of creating a fresh one. This protects
  // the queue panel from accumulating dozens of identical "LinkedIn
  // URL" rows when Mike scans the same form multiple times.
  const unresolved = await listUnresolved()
  const existing = unresolved.find(
    (e) => e.question.trim().toLowerCase() === question.toLowerCase(),
  )
  if (existing) return NextResponse.json({ entry: existing }, { status: 200 })

  const id = await logUnknown({
    question,
    fieldLabel: body.label,
    fieldType: body.fieldType,
    site: body.url ? safeHost(body.url) : undefined,
    jobId: body.jobId,
    jobTitle: body.jobTitle,
    company: body.company,
    source: body.source === 'worker' ? 'worker' : 'extension',
  })

  // Re-read so we return the full record
  const all = await listAll()
  const entry = all.find((e) => e.id === id)
  return NextResponse.json({ entry }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; resolvedBankEntryId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!body.resolvedBankEntryId) {
    return NextResponse.json({ error: 'resolvedBankEntryId required' }, { status: 400 })
  }

  await markResolved(body.id, body.resolvedBankEntryId)
  const all = await listAll()
  const entry = all.find((e) => e.id === body.id)
  if (!entry) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ entry })
}

function safeHost(u: string): string | undefined {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}
