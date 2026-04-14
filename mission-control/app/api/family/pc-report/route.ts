import { NextRequest, NextResponse } from 'next/server'
import {
  readPcActivity, writePcActivity, trimOldReports,
  isDeviceOnline, isDeviceIdle,
  type PcHeartbeat, type PcActivityData,
} from '../../../../lib/pc-activity'

// ─── POST: receive heartbeat from a Windows PC agent ─────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body: PcHeartbeat = await req.json()
    if (!body.hostname) {
      return NextResponse.json({ error: 'hostname is required' }, { status: 400 })
    }

    const data = await readPcActivity()

    // Upsert device registry
    data.devices[body.hostname] = {
      profileId: data.devices[body.hostname]?.profileId ?? null,
      displayName: data.devices[body.hostname]?.displayName ?? body.hostname,
      lastSeen: body.timestamp || new Date().toISOString(),
      lastUser: body.windowsUser || '',
      lastForeground: body.foreground?.processName || '',
      idleSeconds: body.idleSeconds ?? 0,
    }

    // Append report and trim old entries
    data.reports.push(body)
    data.reports = trimOldReports(data.reports)

    await writePcActivity(data)
    return NextResponse.json({ ok: true, deviceCount: Object.keys(data.devices).length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// ─── GET: return all device statuses for the dashboard ───────────────────────
export async function GET() {
  try {
    const data = await readPcActivity()
    const devices: Record<string, any> = {}

    for (const [hostname, entry] of Object.entries(data.devices)) {
      devices[hostname] = {
        ...entry,
        isOnline: isDeviceOnline(entry.lastSeen),
        isIdle: isDeviceIdle(entry.idleSeconds),
      }
    }

    return NextResponse.json({ devices })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// ─── PATCH: assign hostname to a profile or update display name ──────────────
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { hostname, profileId, displayName } = body
    if (!hostname) {
      return NextResponse.json({ error: 'hostname is required' }, { status: 400 })
    }

    const data = await readPcActivity()
    if (!data.devices[hostname]) {
      return NextResponse.json({ error: 'device not found' }, { status: 404 })
    }

    if (profileId !== undefined) data.devices[hostname].profileId = profileId
    if (displayName !== undefined) data.devices[hostname].displayName = displayName

    await writePcActivity(data)
    return NextResponse.json({ ok: true, device: data.devices[hostname] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
