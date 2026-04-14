import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

const DATA_PATH = join(process.cwd(), 'data', 'email-digest.json')

const EMPTY: object = {
  generated_at: null,
  lookback_hours: 24,
  accounts: [],
  stats: { total_fetched: 0, total_classified: 0 },
  financials: {
    bills_due: [],
    recent_charges: [],
    income: [],
    month_summary: { in: 0, out: 0, due_soon: 0 },
  },
  categories: {
    action_items: [],
    bills: [],
    family: [],
    financial: [],
    digest: [],
  },
}

export async function GET() {
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8')
    return NextResponse.json(JSON.parse(raw))
  } catch {
    return NextResponse.json(EMPTY)
  }
}
