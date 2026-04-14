import { NextRequest, NextResponse } from 'next/server'
import { readJSON, writeJSON, generateId } from '@/lib/data'
import { getEnabledCapabilities } from '@/lib/spellbook/capabilities'
import { generateActionPlan } from '@/lib/spellbook/brain'
import { Capture } from '@/lib/spellbook/types'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function GET() {
  const captures = await readJSON<Capture[]>('spellbook-captures.json', [])
  return NextResponse.json({ captures }, { headers: CORS_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: NextRequest) {
  try {
    const { url, title, text } = await req.json()
    if (!url) {
      return NextResponse.json(
        { error: 'url is required' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const enabledCapabilities = await getEnabledCapabilities()
    const plan = await generateActionPlan(
      url,
      title || '',
      text || '',
      enabledCapabilities
    )

    const capture: Capture = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      source: { url, title: title || url },
      rawText: (text || '').slice(0, 8000),
      plan,
      stepResults: plan.steps.map((_, i) => ({
        index: i,
        status: 'pending' as const,
      })),
    }

    const captures = await readJSON<Capture[]>('spellbook-captures.json', [])
    captures.unshift(capture)
    await writeJSON('spellbook-captures.json', captures)

    return NextResponse.json({ capture }, { headers: CORS_HEADERS })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: message },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}
