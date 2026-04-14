// POST /api/capability-matrix/open
//
// Whitelisted "open" action. Looks up rowId in capability-matrix.json, then:
//   - action.type === 'open'   → `/usr/bin/open <url>`     (macOS launches default handler)
//   - action.type === 'reveal' → `/usr/bin/open -R <path>` (macOS reveals in Finder)
//
// Never accepts a URL or path from the body — only rowId.

import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readJSON } from '@/lib/data'

const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'

type Action =
  | { type: 'run'; bin: string; args: string[] }
  | { type: 'open'; url: string }
  | { type: 'reveal'; path: string }
  | { type: 'test'; testScript?: string; testArgs?: string[] }
  | { type: 'copy'; prompt: string }

type Row = { id: string; action: Action; alt?: Action }
type Data = { rows: Row[] }

const EMPTY: Data = { rows: [] }

export async function POST(req: NextRequest) {
  let body: { rowId?: string; useAlt?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const rowId = body.rowId
  if (!rowId) {
    return NextResponse.json({ ok: false, error: 'missing_row_id' }, { status: 400 })
  }

  const data = await readJSON<Data>('capability-matrix.json', EMPTY)
  const row = data.rows.find(r => r.id === rowId)
  if (!row) {
    return NextResponse.json({ ok: false, error: 'row_not_found' }, { status: 404 })
  }

  const action = body.useAlt && row.alt ? row.alt : row.action
  let args: string[]

  if (action.type === 'open') {
    args = [action.url]
  } else if (action.type === 'reveal') {
    args = ['-R', action.path]
  } else {
    return NextResponse.json(
      { ok: false, error: 'action_not_openable', actionType: action.type },
      { status: 400 }
    )
  }

  try {
    await execFileAsync('/usr/bin/open', args, { timeout: 10_000 })
    return NextResponse.json({ ok: true, action: action.type })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
