import { NextResponse } from 'next/server'
import { fetchGoogleEvents } from '@/lib/google-calendar'
import { fetchICloudEvents } from '@/lib/icloud-calendar'
import { mergeAndDedup, HOUSEHOLD, TAGS, type CalendarData, type CalEvent } from '@/lib/calendar-merge'
import fs from 'fs/promises'

const LEDGER_FILE = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/financial-ledger.json'

// 3-minute in-memory cache (reset on HMR)
let cache: { data: CalendarData; ts: number } | null = null
const CACHE_TTL = 3 * 60 * 1000

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  try {
    const tasks: Promise<Awaited<ReturnType<typeof fetchGoogleEvents>>>[] = []

    if (process.env.GOOGLE_MIKE_REFRESH_TOKEN) {
      tasks.push(fetchGoogleEvents(process.env.GOOGLE_MIKE_REFRESH_TOKEN, 'mike', ['mike']))
    }
    if (process.env.GOOGLE_ERIN_REFRESH_TOKEN) {
      tasks.push(fetchGoogleEvents(process.env.GOOGLE_ERIN_REFRESH_TOKEN, 'erin', ['erin']))
    }
    if (process.env.GOOGLE_ERIN2_REFRESH_TOKEN) {
      tasks.push(fetchGoogleEvents(process.env.GOOGLE_ERIN2_REFRESH_TOKEN, 'erin', ['erin']))
    }
    if (process.env.ICLOUD_ERIN_APPLE_ID && process.env.ICLOUD_ERIN_APP_PASSWORD) {
      tasks.push(fetchICloudEvents(process.env.ICLOUD_ERIN_APPLE_ID, process.env.ICLOUD_ERIN_APP_PASSWORD, 'erin', ['erin']))
    }
    if (process.env.ICLOUD_LIAM_APPLE_ID && process.env.ICLOUD_LIAM_APP_PASSWORD) {
      tasks.push(fetchICloudEvents(process.env.ICLOUD_LIAM_APPLE_ID, process.env.ICLOUD_LIAM_APP_PASSWORD, 'liam', ['liam', 'kids']))
    }
    if (process.env.ICLOUD_CLARA_APPLE_ID && process.env.ICLOUD_CLARA_APP_PASSWORD) {
      tasks.push(fetchICloudEvents(process.env.ICLOUD_CLARA_APPLE_ID, process.env.ICLOUD_CLARA_APP_PASSWORD, 'clara', ['clara', 'kids']))
    }

    const results = await Promise.allSettled(tasks)
    const eventArrays = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchGoogleEvents>>> => r.status === 'fulfilled')
      .map((r) => r.value)

    if (results.some((r) => r.status === 'rejected')) {
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`Calendar source ${i} failed:`, r.reason)
      })
    }

    // Read bill due-date events directly from the financial ledger JSON
    let billEvents: CalEvent[] = []
    try {
      const raw = await fs.readFile(LEDGER_FILE, 'utf-8')
      const ledger = JSON.parse(raw)
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth()

      for (const item of ledger.items || []) {
        if (item.category === 'one_time') continue
        const amount = item.amount || item.monthly_estimate
        const amountStr = amount ? ` — $${amount.toLocaleString()}` : ''
        const statusStr = item.status === 'auto_pay' ? ' (auto-pay)' : ''

        if (item.due_date) {
          billEvents.push({
            id: `bill-${item.id}`,
            title: `${item.vendor}${amountStr} due${statusStr}`,
            owner: item.owner || 'shared',
            calendarId: 'financial-ledger',
            start: item.due_date,
            end: item.due_date,
            tags: [item.owner || 'shared', 'bills'],
            location: null,
            status: 'free',
            notes: item.status === 'auto_pay' ? 'Auto-pay enabled' : '',
            htmlLink: '/financial-ledger',
          })
        } else if (item.billing_day) {
          for (let offset = 0; offset <= 1; offset++) {
            const m = month + offset
            const y = m > 11 ? year + 1 : year
            const actualMonth = m % 12
            const day = Math.min(item.billing_day, new Date(y, actualMonth + 1, 0).getDate())
            const dateStr = `${y}-${String(actualMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            billEvents.push({
              id: `bill-${item.id}-${dateStr}`,
              title: `${item.vendor}${amountStr} due${statusStr}`,
              owner: item.owner || 'shared',
              calendarId: 'financial-ledger',
              start: dateStr,
              end: dateStr,
              tags: [item.owner || 'shared', 'bills'],
              location: null,
              status: 'free',
              notes: item.status === 'auto_pay' ? 'Auto-pay enabled' : '',
              htmlLink: '/financial-ledger',
            })
          }
        }
      }
    } catch { /* ledger read is best-effort */ }

    const data: CalendarData = {
      generated_at: new Date().toISOString(),
      household: HOUSEHOLD,
      tags: TAGS,
      events: [...mergeAndDedup(eventArrays), ...billEvents],
    }

    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err) {
    console.error('household-calendar fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch calendar data' }, { status: 500 })
  }
}
