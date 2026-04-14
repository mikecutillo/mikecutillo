// POST /api/capability-matrix/run
//
// Whitelisted child-process execution. Only runs rows present in the unified
// capability-matrix.json data file whose action.type === 'run'.
// Never accepts a command from the request body — only a rowId.
//
// Uses execFile (no shell) with timeout + maxBuffer caps for injection safety.

import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readJSON, getWorkspacePath } from '@/lib/data'

const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'

type Action =
  | { type: 'run'; bin: string; args: string[] }
  | { type: 'open'; url: string }
  | { type: 'reveal'; path: string }
  | { type: 'test'; testScript?: string; testArgs?: string[] }
  | { type: 'copy'; prompt: string }

type Row = {
  id: string
  kind: string
  name: string
  safety: 'safe' | 'confirm' | 'risky'
  action: Action
}

type Data = { rows: Row[] }

const EMPTY: Data = { rows: [] }

export async function POST(req: NextRequest) {
  let body: { rowId?: string; confirmed?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const rowId = body.rowId
  if (!rowId || typeof rowId !== 'string') {
    return NextResponse.json({ ok: false, error: 'missing_row_id' }, { status: 400 })
  }

  const data = await readJSON<Data>('capability-matrix.json', EMPTY)
  const row = data.rows.find(r => r.id === rowId)
  if (!row) {
    return NextResponse.json({ ok: false, error: 'row_not_found' }, { status: 404 })
  }

  if (row.action.type !== 'run') {
    return NextResponse.json(
      { ok: false, error: 'action_not_runnable', actionType: row.action.type },
      { status: 400 }
    )
  }

  if (row.safety !== 'safe' && !body.confirmed) {
    return NextResponse.json(
      { ok: false, error: 'confirmation_required', safety: row.safety, name: row.name },
      { status: 412 }
    )
  }

  const { bin, args } = row.action
  const started = Date.now()

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: getWorkspacePath(),
      timeout: 120_000,
      maxBuffer: 512 * 1024,
      env: process.env,
    })
    return NextResponse.json({
      ok: true,
      exitCode: 0,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      durationMs: Date.now() - started,
      rowId,
    })
  } catch (err: unknown) {
    const e = err as {
      code?: number | string
      killed?: boolean
      signal?: string
      stdout?: string
      stderr?: string
      message?: string
    }

    // ENOENT: bin missing
    if (e.code === 'ENOENT') {
      return NextResponse.json({
        ok: false,
        error: 'bin_not_found',
        bin,
        durationMs: Date.now() - started,
        rowId,
      })
    }

    // Timeout / killed
    if (e.killed || e.signal === 'SIGTERM') {
      return NextResponse.json({
        ok: false,
        error: 'timeout',
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? '',
        durationMs: Date.now() - started,
        rowId,
      })
    }

    // Non-zero exit — still a 200 so the UI can render stdout/stderr
    return NextResponse.json({
      ok: false,
      exitCode: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      durationMs: Date.now() - started,
      rowId,
    })
  }
}
