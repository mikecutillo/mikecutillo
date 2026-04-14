import { NextResponse } from 'next/server'
import fs from 'fs/promises'

const DATA_FILE = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/financial-ledger.json'

interface LedgerItem {
  id: string
  vendor: string
  amount: number | null
  monthly_estimate: number | null
  due_date: string | null
  billing_day: number | null
  billing_cycle: string
  status: string
  owner: string
  category: string
}

interface CalendarEvent {
  title: string
  start: string
  allDay: boolean
  source: string
  tags: string[]
  color: string
  ledger_id: string
  url: string
  amount: number | null
  status: string
}

export async function GET() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    const data = JSON.parse(raw)
    const events: CalendarEvent[] = []
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()

    for (const item of data.items as LedgerItem[]) {
      if (item.category === 'one_time') continue

      const amount = item.amount || item.monthly_estimate
      const amountStr = amount ? ` -- $${amount.toLocaleString()}` : ''
      const statusStr = item.status === 'auto_pay' ? ' (auto-pay)' : ''

      // Use due_date if available, otherwise billing_day for current + next month
      if (item.due_date) {
        events.push({
          title: `${item.vendor}${amountStr} due${statusStr}`,
          start: item.due_date,
          allDay: true,
          source: 'financial-ledger',
          tags: [item.owner, 'bills'],
          color: '#f59e0b',
          ledger_id: item.id,
          url: '/financial-ledger',
          amount,
          status: item.status,
        })
      } else if (item.billing_day) {
        // Generate for current and next month
        for (let offset = 0; offset <= 1; offset++) {
          const m = month + offset
          const y = m > 11 ? year + 1 : year
          const actualMonth = m % 12
          const day = Math.min(item.billing_day, new Date(y, actualMonth + 1, 0).getDate())
          const dateStr = `${y}-${String(actualMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

          events.push({
            title: `${item.vendor}${amountStr} due${statusStr}`,
            start: dateStr,
            allDay: true,
            source: 'financial-ledger',
            tags: [item.owner, 'bills'],
            color: '#f59e0b',
            ledger_id: item.id,
            url: '/financial-ledger',
            amount,
            status: item.status,
          })
        }
      }
    }

    return NextResponse.json({ events })
  } catch {
    return NextResponse.json({ events: [] })
  }
}
