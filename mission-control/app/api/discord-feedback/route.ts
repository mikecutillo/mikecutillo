import { NextRequest, NextResponse } from 'next/server'
import {
  requestFeedback,
  recordFeedback,
  getPendingFeedback,
  getReportFeedback,
  isReportComplete,
  sendDailyReminders,
  getAnonymousSummary,
} from '@/lib/discord-feedback'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const reportId = searchParams.get('reportId')
  const pending = searchParams.get('pending')
  const summary = searchParams.get('summary')

  if (summary && reportId) {
    const text = await getAnonymousSummary(reportId)
    return NextResponse.json({ summary: text })
  }

  if (reportId) {
    const requests = await getReportFeedback(reportId)
    const complete = await isReportComplete(reportId)
    return NextResponse.json({ requests, complete })
  }

  if (pending === 'true') {
    const requests = await getPendingFeedback()
    return NextResponse.json(requests)
  }

  // Default: return all pending
  const requests = await getPendingFeedback()
  return NextResponse.json(requests)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'request') {
    const { channel, reportId, reportSummary } = body
    if (!channel || !reportId || !reportSummary) {
      return NextResponse.json(
        { error: 'channel, reportId, and reportSummary required' },
        { status: 400 }
      )
    }
    const created = await requestFeedback(channel, reportId, reportSummary)
    return NextResponse.json({ created: created.length, requests: created })
  }

  if (action === 'respond') {
    const { reportId, memberId, response, rating } = body
    if (!reportId || !memberId || !response) {
      return NextResponse.json(
        { error: 'reportId, memberId, and response required' },
        { status: 400 }
      )
    }
    const updated = await recordFeedback(reportId, memberId, response, rating)
    if (!updated) {
      return NextResponse.json({ error: 'Feedback request not found' }, { status: 404 })
    }
    return NextResponse.json(updated)
  }

  if (action === 'send-reminders') {
    const sent = await sendDailyReminders()
    return NextResponse.json({ remindersSent: sent })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
