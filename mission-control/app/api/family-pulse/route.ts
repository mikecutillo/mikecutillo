import { NextRequest, NextResponse } from 'next/server'
import {
  scheduleDailyCheckins,
  deliverPending,
  forceCheckin,
  collectResponses,
  recordResponse,
  getPulseStats,
  getAlerts,
  acknowledgeAlert,
  getMemberHistory,
  getPending,
  getFullState,
} from '@/lib/family-pulse'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const member = searchParams.get('member')
  const week = searchParams.get('week') || undefined
  const alerts = searchParams.get('alerts')
  const pending = searchParams.get('pending')
  const stats = searchParams.get('stats')

  if (alerts === 'true') {
    const list = await getAlerts()
    return NextResponse.json(list)
  }

  if (pending === 'true') {
    const list = await getPending()
    return NextResponse.json(list)
  }

  if (stats === 'true') {
    const data = await getPulseStats()
    return NextResponse.json(data)
  }

  if (member) {
    const history = await getMemberHistory(member, week)
    return NextResponse.json(history)
  }

  // Default: return stats summary
  const pulseStats = await getPulseStats()
  const pendingCount = (await getPending()).length
  const alertCount = (await getAlerts()).length
  return NextResponse.json({ stats: pulseStats, pendingCount, alertCount })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'schedule-daily') {
    const scheduled = await scheduleDailyCheckins()
    return NextResponse.json({
      scheduled: scheduled.length,
      checkins: scheduled.map(c => ({ id: c.id, memberId: c.memberId, category: c.category })),
    })
  }

  if (action === 'deliver-pending') {
    const delivered = await deliverPending()
    return NextResponse.json({ delivered })
  }

  if (action === 'collect-responses') {
    const collected = await collectResponses()
    return NextResponse.json({ collected })
  }

  if (action === 'record-response') {
    const { pulseId, memberId, response, rating } = body
    if (!pulseId || !memberId || !response) {
      return NextResponse.json({ error: 'pulseId, memberId, and response required' }, { status: 400 })
    }
    const checkin = await recordResponse(pulseId, memberId, response, rating)
    if (!checkin) return NextResponse.json({ error: 'Check-in not found' }, { status: 404 })
    return NextResponse.json(checkin)
  }

  if (action === 'force-checkin') {
    const { memberId, questionId } = body
    if (!memberId) {
      return NextResponse.json({ error: 'memberId required' }, { status: 400 })
    }
    const checkin = await forceCheckin(memberId, questionId)
    if (!checkin) return NextResponse.json({ error: 'Could not create check-in' }, { status: 500 })
    return NextResponse.json(checkin)
  }

  if (action === 'acknowledge-alert') {
    const { alertId } = body
    if (!alertId) return NextResponse.json({ error: 'alertId required' }, { status: 400 })
    const ok = await acknowledgeAlert(alertId)
    if (!ok) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    return NextResponse.json({ acknowledged: true })
  }

  if (action === 'sync-notion') {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    try {
      const { stdout, stderr } = await execFileAsync('python3', [
        '/Users/mikecutillo/.openclaw/workspace-shared/scripts/notion-pulse-sync.py',
      ], { timeout: 30000 })
      return NextResponse.json({ success: true, stdout, stderr })
    } catch (err: any) {
      return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
