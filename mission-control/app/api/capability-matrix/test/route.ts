// POST /api/capability-matrix/test
//
// Runs a "smoke test" for API rows. v1: if the row has a companion testScript,
// execute it (python3 <testScript> <testArgs...>). Otherwise returns
// `no_test_defined` so the UI can show "Test not configured".
//
// v2: actual HTTP smoke calls using vault-apis.json credentials.

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

type Row = { id: string; action: Action; name: string }
type Data = { rows: Row[] }

const EMPTY: Data = { rows: [] }

export async function POST(req: NextRequest) {
  let body: { rowId?: string }
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

  if (row.action.type !== 'test') {
    return NextResponse.json(
      { ok: false, error: 'action_not_testable', actionType: row.action.type },
      { status: 400 }
    )
  }

  if (!row.action.testScript) {
    return NextResponse.json({
      ok: false,
      error: 'no_test_defined',
      message: `No smoke-test script configured for ${row.name} yet.`,
    })
  }

  const args = [row.action.testScript, ...(row.action.testArgs ?? [])]
  const started = Date.now()
  try {
    const { stdout, stderr } = await execFileAsync('python3', args, {
      cwd: getWorkspacePath(),
      timeout: 60_000,
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
      stdout?: string
      stderr?: string
      message?: string
    }
    if (e.code === 'ENOENT') {
      return NextResponse.json({ ok: false, error: 'bin_not_found', rowId })
    }
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
