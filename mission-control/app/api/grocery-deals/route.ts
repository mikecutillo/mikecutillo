import { NextRequest, NextResponse } from 'next/server'
import { readJSON, writeJSON } from '@/lib/data'

interface Deal {
  item: string
  matched_db_item: string | null
  deal_price: number | null
  regular_price: number | null
  savings: number | null
  savings_pct: number | null
  unit: string
  price_per_unit: number | null
  store: string
  availability: string
  limit: number | null
  notes: string
}

interface DealsFile {
  last_scan: string
  scan_source: string
  scan_email_id: string
  valid_from: string
  valid_to: string
  deals: Deal[]
}

const EMPTY: DealsFile = {
  last_scan: '',
  scan_source: '',
  scan_email_id: '',
  valid_from: '',
  valid_to: '',
  deals: [],
}

export async function GET() {
  const data = await readJSON<DealsFile>('grocery-deals.json', EMPTY)
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = await readJSON<DealsFile>('grocery-deals.json', EMPTY)

    if (body.action === 'add-deal') {
      const deal: Deal = {
        item: body.item,
        matched_db_item: body.matched_db_item ?? null,
        deal_price: body.deal_price ?? null,
        regular_price: body.regular_price ?? null,
        savings: body.savings ?? null,
        savings_pct: body.savings_pct ?? null,
        unit: body.unit ?? 'each',
        price_per_unit: body.price_per_unit ?? null,
        store: body.store ?? 'Costco',
        availability: body.availability ?? '',
        limit: body.limit ?? null,
        notes: body.notes ?? '',
      }
      data.deals.push(deal)
      data.last_scan = new Date().toISOString()
      await writeJSON('grocery-deals.json', data)
      return NextResponse.json({ ok: true, deal })
    }

    if (body.action === 'replace-all') {
      const updated: DealsFile = {
        last_scan: new Date().toISOString(),
        scan_source: body.scan_source ?? 'manual',
        scan_email_id: body.scan_email_id ?? '',
        valid_from: body.valid_from ?? '',
        valid_to: body.valid_to ?? '',
        deals: body.deals ?? [],
      }
      await writeJSON('grocery-deals.json', updated)
      return NextResponse.json({ ok: true, count: updated.deals.length })
    }

    return NextResponse.json({ error: 'Unknown action. Use "add-deal" or "replace-all".' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
