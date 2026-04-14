// GET /api/capability-matrix/data
//
// Reads the unified capability-matrix.json. If missing, triggers a refresh
// inline so the page never loads empty.

import { NextResponse } from 'next/server'
import { readJSON } from '@/lib/data'

export const dynamic = 'force-dynamic'

type Data = {
  lastUpdated: string
  localModel: { label: string; source: string }
  rows: unknown[]
}

const EMPTY: Data = {
  lastUpdated: '',
  localModel: { label: 'Ollama (gemma4:e2b)', source: 'default' },
  rows: [],
}

export async function GET() {
  const data = await readJSON<Data>('capability-matrix.json', EMPTY)

  if (!data.rows.length) {
    // Self-heal: fire the refresh endpoint once so the file exists next call.
    // We re-read after to return fresh data.
    try {
      const mod = await import('../refresh/route')
      await mod.POST()
      const next = await readJSON<Data>('capability-matrix.json', EMPTY)
      return NextResponse.json(next)
    } catch {
      return NextResponse.json(data)
    }
  }

  return NextResponse.json(data)
}
