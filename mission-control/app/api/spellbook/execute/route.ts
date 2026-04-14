import { NextRequest, NextResponse } from 'next/server'
import { readJSON, writeJSON } from '@/lib/data'
import { executeCapability } from '@/lib/spellbook/capabilities'
import { appendJournalEntry } from '@/lib/spellbook/journal'
import { Capture } from '@/lib/spellbook/types'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: NextRequest) {
  try {
    const { captureId, stepIndex } = await req.json()
    if (!captureId || stepIndex === undefined) {
      return NextResponse.json(
        { error: 'captureId and stepIndex are required' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const captures = await readJSON<Capture[]>('spellbook-captures.json', [])
    const capture = captures.find((c) => c.id === captureId)
    if (!capture) {
      return NextResponse.json(
        { error: 'Capture not found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const step = capture.plan.steps[stepIndex]
    if (!step) {
      return NextResponse.json(
        { error: 'Step not found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const stepResult = capture.stepResults.find((r) => r.index === stepIndex)
    if (!stepResult) {
      return NextResponse.json(
        { error: 'Step result not found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    // Execute the capability
    const result = await executeCapability(step.capability, step.params)
    stepResult.status = result.success ? 'done' : 'error'
    stepResult.output = result.output

    await writeJSON('spellbook-captures.json', captures)

    // Check if all steps are done — if so, append to journal
    const allDone = capture.stepResults.every(
      (r) => r.status === 'done' || r.status === 'error'
    )
    if (allDone) {
      await appendJournalEntry(capture)
    }

    return NextResponse.json(
      { success: result.success, output: result.output, allDone },
      { headers: CORS_HEADERS }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: message },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}
