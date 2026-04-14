// ─── Family Intel — Subscription Setup & Status ───────────────────────────────
// Manages webhook subscriptions with Microsoft Graph and Google push notification
// channels. Also provides status for all three sources.
//
// GET  /api/family-intel/setup          — return status of all sources + subscriptions
// POST /api/family-intel/setup          — body: { source: 'microsoft'|'google'|'all' }
//                                         Create or renew subscriptions
// DELETE /api/family-intel/setup?id=xxx — cancel a specific subscription

import { NextResponse, NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import {
  getMsAccessToken,
  getGoogleAccessToken,
  loadSubscriptions,
  saveSubscriptions,
  getMicrosoftStatus,
  getGoogleStatus,
  getPiholeStatus,
  loadPiholeCursor,
  type FamilyIntelSubscription,
  type FamilyPerson,
} from '@/lib/family-intel'

const WEBHOOK_BASE    = process.env.WEBHOOK_BASE_URL || ''
const MS_SECRET       = process.env.MS_WEBHOOK_SECRET || 'family-intel-ms-secret'
const GOOGLE_SECRET   = process.env.GOOGLE_WEBHOOK_SECRET || 'family-intel-google-secret'

// ─── GET — Status ─────────────────────────────────────────────────────────────

export async function GET() {
  const subs       = await loadSubscriptions()
  const piholeTs   = await loadPiholeCursor()
  const now        = new Date().toISOString()

  const microsoft = getMicrosoftStatus()
  const google    = getGoogleStatus()
  const pihole    = getPiholeStatus()

  // Annotate subscriptions with expiry health
  const annotated = subs.map(s => ({
    ...s,
    expiresSoon: new Date(s.expiresAt) < new Date(Date.now() + 2 * 60 * 60 * 1000), // < 2h
    expired:     new Date(s.expiresAt) < new Date(),
  }))

  return NextResponse.json({
    webhookBaseUrl: WEBHOOK_BASE || null,
    webhookEndpoints: {
      microsoft: WEBHOOK_BASE ? `${WEBHOOK_BASE}/api/family-intel/ingest/microsoft` : null,
      google:    WEBHOOK_BASE ? `${WEBHOOK_BASE}/api/family-intel/ingest/google` : null,
      pihole:    '/api/family-intel/ingest/pihole (local poll — no public URL needed)',
    },
    sources: { microsoft, google, pihole },
    subscriptions: annotated,
    piholeCursor: {
      lastPollTs: piholeTs,
      lastPollAt: piholeTs > 0 ? new Date(piholeTs * 1000).toISOString() : null,
    },
    generatedAt: now,
  })
}

// ─── POST — Create / Renew Subscriptions ─────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const source: string = body.source || 'all'

  const results: Record<string, unknown> = {}

  if ((source === 'microsoft' || source === 'all') && WEBHOOK_BASE) {
    results.microsoft = await setupMicrosoft()
  } else if (source === 'microsoft' && !WEBHOOK_BASE) {
    results.microsoft = { error: 'WEBHOOK_BASE_URL not configured' }
  }

  if ((source === 'google' || source === 'all') && WEBHOOK_BASE) {
    results.google = await setupGoogle()
  } else if (source === 'google' && !WEBHOOK_BASE) {
    results.google = { error: 'WEBHOOK_BASE_URL not configured' }
  }

  return NextResponse.json({ results })
}

// ─── DELETE — Cancel Subscription ────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Provide ?id=subscription-id' }, { status: 400 })

  const subs = await loadSubscriptions()
  const sub  = subs.find(s => s.id === id)
  if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })

  // Cancel with the provider
  if (sub.source === 'microsoft') {
    await cancelMsSubscription(id)
  } else if (sub.source === 'google') {
    await cancelGoogleChannel(sub.channelId!, sub.resourceId!)
  }

  await saveSubscriptions(subs.filter(s => s.id !== id))
  return NextResponse.json({ cancelled: true, id })
}

// ─── Microsoft Graph Subscription Setup ──────────────────────────────────────

async function setupMicrosoft(): Promise<unknown> {
  const token = await getMsAccessToken()
  if (!token) {
    return { error: 'Could not get MS access token — check MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET' }
  }

  const notificationUrl = `${WEBHOOK_BASE}/api/family-intel/ingest/microsoft`
  const subs = await loadSubscriptions()
  const created: FamilyIntelSubscription[] = []

  // Define what we want to subscribe to
  const targets = buildMsTargets()
  if (!targets.length) {
    return { error: 'No MS_MIKE_USER_ID or MS_ERIN_USER_ID configured — cannot build subscriptions' }
  }

  for (const target of targets) {
    // Check if already have an active non-expired sub for this resource + person
    const existing = subs.find(s =>
      s.source === 'microsoft' &&
      s.resource === target.resource &&
      s.person === target.person &&
      new Date(s.expiresAt) > new Date(Date.now() + 30 * 60 * 1000)
    )
    if (existing) {
      created.push(existing)
      continue
    }

    const expiresAt = new Date(Date.now() + target.ttlMinutes * 60 * 1000).toISOString()

    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          changeType:                  target.changeType,
          notificationUrl,
          resource:                    target.resource,
          expirationDateTime:          expiresAt,
          clientState:                 MS_SECRET,
          latestSupportedTlsVersion:   'v1_2',
        }),
      })

      const data = await res.json()
      if (data.id) {
        const sub: FamilyIntelSubscription = {
          id:         data.id,
          source:     'microsoft',
          resource:   target.resource,
          person:     target.person,
          label:      target.label,
          expiresAt:  data.expirationDateTime || expiresAt,
          renewedAt:  new Date().toISOString(),
        }
        created.push(sub)

        // Remove any old sub for same resource + person and add new
        const filtered = subs.filter(s => !(s.source === 'microsoft' && s.resource === target.resource && s.person === target.person))
        subs.length = 0
        subs.push(...filtered)
        subs.push(sub)
      } else {
        console.error('[family-intel/setup] MS subscription failed:', data)
      }
    } catch (err) {
      console.error('[family-intel/setup] MS subscription error:', err)
    }
  }

  await saveSubscriptions(subs)
  return { created: created.length, subscriptions: created }
}

function buildMsTargets(): MsTarget[] {
  const targets: MsTarget[] = []

  // Per-user subscriptions
  const users: Array<{ envKey: string; person: FamilyPerson }> = [
    { envKey: 'MS_MIKE_USER_ID', person: 'mike' },
    { envKey: 'MS_ERIN_USER_ID', person: 'erin' },
  ]

  for (const u of users) {
    const userId = process.env[u.envKey]
    if (!userId) continue
    const name = capitalize(u.person)

    // Outlook Calendar
    targets.push({
      resource:   `/users/${userId}/events`,
      changeType: 'created,updated,deleted',
      person:     u.person,
      label:      `${name} — Outlook Calendar`,
      ttlMinutes: 4230,  // Max for calendar
    })

    // OneDrive
    targets.push({
      resource:   `/users/${userId}/drive/root`,
      changeType: 'updated',
      person:     u.person,
      label:      `${name} — OneDrive`,
      ttlMinutes: 4230,
    })
  }

  // Tenant-wide sign-ins (requires AuditLog.Read.All)
  if (process.env.MS_TENANT_ID) {
    targets.push({
      resource:   'auditLogs/signIns',
      changeType: 'created',
      person:     'unknown',
      label:      'All users — Sign-in audit log',
      ttlMinutes: 60,  // Max for signIns is 60 minutes
    })
  }

  return targets
}

// ─── Google Watch Channel Setup ───────────────────────────────────────────────

async function setupGoogle(): Promise<unknown> {
  const notificationUrl = `${WEBHOOK_BASE}/api/family-intel/ingest/google`
  const subs = await loadSubscriptions()
  const created: FamilyIntelSubscription[] = []

  const googleUsers: Array<{ refreshToken: string; person: FamilyPerson }> = (
    [
      { refreshToken: process.env.GOOGLE_MIKE_REFRESH_TOKEN  || '', person: 'mike'  as FamilyPerson },
      { refreshToken: process.env.GOOGLE_ERIN_REFRESH_TOKEN  || '', person: 'erin'  as FamilyPerson },
      { refreshToken: process.env.GOOGLE_ERIN2_REFRESH_TOKEN || '', person: 'erin'  as FamilyPerson },
    ] as Array<{ refreshToken: string; person: FamilyPerson }>
  ).filter(u => u.refreshToken)

  for (const user of googleUsers) {
    const token = await getGoogleAccessToken(user.refreshToken)
    if (!token) continue

    // Skip if already have active calendar sub for this person
    const existingCal = subs.find(s =>
      s.source === 'google' &&
      s.resource === 'calendar' &&
      s.person === user.person &&
      new Date(s.expiresAt) > new Date(Date.now() + 30 * 60 * 1000)
    )

    if (!existingCal) {
      const calSub = await createGoogleCalendarWatch(token, user.person, notificationUrl)
      if (calSub) {
        created.push(calSub)
        subs.push(calSub)
      }
    }

    // Skip if already have active drive sub for this person
    const existingDrive = subs.find(s =>
      s.source === 'google' &&
      s.resource === 'drive' &&
      s.person === user.person &&
      new Date(s.expiresAt) > new Date(Date.now() + 30 * 60 * 1000)
    )

    if (!existingDrive) {
      const driveSub = await createGoogleDriveWatch(token, user.person, notificationUrl)
      if (driveSub) {
        created.push(driveSub)
        subs.push(driveSub)
      }
    }
  }

  await saveSubscriptions(subs)
  return { created: created.length, subscriptions: created }
}

async function createGoogleCalendarWatch(
  token: string,
  person: FamilyPerson,
  notificationUrl: string,
): Promise<FamilyIntelSubscription | null> {
  try {
    const channelId = randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id:      channelId,
          type:    'web_hook',
          address: notificationUrl,
          token:   GOOGLE_SECRET,
          expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }),
      }
    )

    const data = await res.json()
    if (!data.id) return null

    return {
      id:         data.id,
      source:     'google',
      resource:   'calendar',
      person,
      label:      `${capitalize(person)} — Google Calendar`,
      expiresAt,
      renewedAt:  new Date().toISOString(),
      channelId:  data.id,
      resourceId: data.resourceId,
    }
  } catch {
    return null
  }
}

async function createGoogleDriveWatch(
  token: string,
  person: FamilyPerson,
  notificationUrl: string,
): Promise<FamilyIntelSubscription | null> {
  try {
    const channelId = randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    // Get a changes page token first
    const ptRes = await fetch(
      'https://www.googleapis.com/drive/v3/changes/startPageToken',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const ptData = await ptRes.json()
    const pageToken = ptData.startPageToken
    if (!pageToken) return null

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/changes/watch?pageToken=${pageToken}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id:         channelId,
          type:       'web_hook',
          address:    notificationUrl,
          token:      GOOGLE_SECRET,
          expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }),
      }
    )

    const data = await res.json()
    if (!data.id) return null

    return {
      id:         data.id,
      source:     'google',
      resource:   'drive',
      person,
      label:      `${capitalize(person)} — Google Drive`,
      expiresAt,
      renewedAt:  new Date().toISOString(),
      channelId:  data.id,
      resourceId: data.resourceId,
    }
  } catch {
    return null
  }
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

async function cancelMsSubscription(id: string): Promise<void> {
  const token = await getMsAccessToken()
  if (!token) return
  await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {})
}

async function cancelGoogleChannel(channelId: string, resourceId: string): Promise<void> {
  // Need a token — use Mike's as fallback for cleanup
  const token = await getGoogleAccessToken(process.env.GOOGLE_MIKE_REFRESH_TOKEN || '')
  if (!token) return
  await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: channelId, resourceId }),
  }).catch(() => {})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MsTarget {
  resource: string
  changeType: string
  person: FamilyPerson
  label: string
  ttlMinutes: number
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
