import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const SCRIPT = '/Users/mikecutillo/.openclaw/workspace-shared/scripts/financial-scan.py'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const days = (body as { days?: number }).days || 90
    const merge = (body as { merge?: boolean }).merge ? '--merge' : ''

    const { stdout, stderr } = await execAsync(
      `python3 ${SCRIPT} --days ${days} ${merge}`,
      { timeout: 300_000, env: { ...process.env } }
    )
    return NextResponse.json({
      status: 'ok',
      output: stdout.slice(-3000),
      errors: stderr ? stderr.slice(-500) : null,
    })
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string }
    return NextResponse.json(
      { status: 'error', message: e.message, errors: e.stderr },
      { status: 500 }
    )
  }
}
