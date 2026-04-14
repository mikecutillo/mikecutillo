import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const SCRIPT = '/Users/mikecutillo/.openclaw/workspace-shared/scripts/digest-engine.py'

export async function POST() {
  try {
    const { stdout, stderr } = await execAsync(`python3 ${SCRIPT}`, {
      timeout: 120_000,
      env: { ...process.env },
    })
    return NextResponse.json({
      status: 'ok',
      output: stdout.slice(-2000),
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
