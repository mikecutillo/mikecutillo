import { NextRequest, NextResponse } from 'next/server'
import {
  getAllCapabilities,
  getSettings,
  updateSettings,
} from '@/lib/spellbook/capabilities'
import { SpellbookSettings } from '@/lib/spellbook/types'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET() {
  const capabilities = getAllCapabilities()
  const settings = await getSettings()
  const merged = capabilities.map((c) => ({
    ...c,
    enabled: settings.capabilities[c.id]?.enabled !== false,
  }))
  return NextResponse.json({ capabilities: merged }, { headers: CORS_HEADERS })
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as SpellbookSettings
    await updateSettings(body)
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: message },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}
