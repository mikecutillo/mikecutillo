// ─── Microsoft Graph Webhook Receiver ────────────────────────────────────────
// Handles both the subscription validation handshake and live change notifications.
//
// HOW IT WORKS:
//   1. When you create a subscription via /api/family-intel/setup, Microsoft sends a
//      GET request to this URL with ?validationToken=xxx — we echo it back as text/plain.
//   2. For every change to subscribed resources (calendar, OneDrive, sign-ins, security),
//      Microsoft POSTs a notification batch to this URL.
//   3. We normalize each notification into a FamilyIntelEvent and append to the store.
//
// SETUP REQUIREMENTS:
//   - MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET in .env.local
//   - MS_WEBHOOK_SECRET — secret string verified on every notification
//   - WEBHOOK_BASE_URL — publicly reachable URL (use ngrok or Cloudflare Tunnel locally)

import { NextResponse, NextRequest } from 'next/server'
import {
  makeEvent,
  appendEvents,
  loadSubscriptions,
  type FamilyIntelEvent,
  type FamilyPerson,
} from '@/lib/family-intel'

const MS_WEBHOOK_SECRET = process.env.MS_WEBHOOK_SECRET || 'family-intel-ms-secret'

// ─── Validation Handshake (GET) ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const validationToken = new URL(req.url).searchParams.get('validationToken')
  if (validationToken) {
    // Microsoft requires we echo the token back as text/plain within 10 seconds
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return NextResponse.json({ status: 'microsoft-graph-ingest-endpoint', ready: true })
}

// ─── Notification Processing (POST) ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Handle validation in POST as well (some Graph setups use POST for validation)
  const validationToken = new URL(req.url).searchParams.get('validationToken')
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  let body: { value?: MsNotification[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const notifications: MsNotification[] = body.value ?? []
  if (!notifications.length) {
    return NextResponse.json({ received: 0 }, { status: 202 })
  }

  // Load subscriptions so we can map subscriptionId → person
  const subs = await loadSubscriptions()
  const subPersonMap = Object.fromEntries(subs.map(s => [s.id, s.person]))

  const newEvents: FamilyIntelEvent[] = []

  for (const notif of notifications) {
    // Verify client state to prevent spoofed notifications
    if (notif.clientState !== MS_WEBHOOK_SECRET) {
      console.warn('[family-intel] MS notification rejected — clientState mismatch')
      continue
    }

    const ts = new Date().toISOString()
    const resource: string = notif.resource || ''
    const changeType: string = notif.changeType || 'updated'
    const person: FamilyPerson = subPersonMap[notif.subscriptionId] ?? inferPersonFromResource(resource)

    newEvents.push(normalizeNotification(notif, ts, resource, changeType, person))
  }

  const added = await appendEvents(newEvents)
  // Always return 202 — Microsoft retries if we return non-2xx
  return NextResponse.json({ received: added }, { status: 202 })
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeNotification(
  notif: MsNotification,
  ts: string,
  resource: string,
  changeType: string,
  person: FamilyPerson,
): FamilyIntelEvent {
  const resourceData = notif.resourceData || {}

  // Calendar event
  if (resource.includes('/events/') || resource.includes('/calendarView/')) {
    return makeEvent({
      timestamp: ts,
      source: 'microsoft',
      sourceDetail: 'graph-calendar',
      person,
      category: 'calendar',
      severity: 'info',
      title: `Outlook calendar event ${changeType}`,
      description: buildCalendarDesc(person, changeType, resourceData),
      metadata: { resource, changeType, resourceData, subscriptionId: notif.subscriptionId },
    })
  }

  // OneDrive file
  if (resource.includes('/drive/') || resource.includes('/driveItem/')) {
    const fileName = (resourceData as Record<string, unknown>)?.name as string || 'unknown file'
    return makeEvent({
      timestamp: ts,
      source: 'microsoft',
      sourceDetail: 'graph-onedrive',
      person,
      category: 'file',
      severity: 'info',
      title: `OneDrive file ${changeType}: ${fileName}`,
      description: `${capitalize(person)}'s OneDrive had a file ${changeType}`,
      metadata: { resource, changeType, resourceData, subscriptionId: notif.subscriptionId },
    })
  }

  // Sign-in
  if (resource.includes('signIns') || resource.includes('auditLogs')) {
    const ip = (resourceData as Record<string, unknown>)?.ipAddress as string || 'unknown IP'
    const app = (resourceData as Record<string, unknown>)?.appDisplayName as string || 'unknown app'
    return makeEvent({
      timestamp: ts,
      source: 'microsoft',
      sourceDetail: 'graph-signin',
      person,
      category: 'signin',
      severity: 'info',
      title: `Microsoft sign-in detected`,
      description: `${capitalize(person)} signed in${app ? ` via ${app}` : ''}${ip ? ` from ${ip}` : ''}`,
      metadata: { resource, changeType, resourceData, subscriptionId: notif.subscriptionId },
    })
  }

  // Security alert
  if (resource.includes('security')) {
    const alertTitle = (resourceData as Record<string, unknown>)?.title as string || 'Security event'
    return makeEvent({
      timestamp: ts,
      source: 'microsoft',
      sourceDetail: 'graph-security',
      person,
      category: 'security',
      severity: 'alert',
      title: `Security alert: ${alertTitle}`,
      description: `Microsoft Defender security event detected`,
      metadata: { resource, changeType, resourceData, subscriptionId: notif.subscriptionId },
    })
  }

  // Teams / communication
  if (resource.includes('/messages/') || resource.includes('/chats/')) {
    return makeEvent({
      timestamp: ts,
      source: 'microsoft',
      sourceDetail: 'graph-teams',
      person,
      category: 'communication',
      severity: 'info',
      title: `Teams message activity`,
      description: `${capitalize(person)} had Teams message activity`,
      metadata: { resource, changeType, resourceData, subscriptionId: notif.subscriptionId },
    })
  }

  // Fallback
  return makeEvent({
    timestamp: ts,
    source: 'microsoft',
    sourceDetail: 'graph-calendar',
    person,
    category: 'communication',
    severity: 'info',
    title: `Microsoft Graph: ${changeType} on resource`,
    description: `Resource changed: ${resource}`,
    metadata: { resource, changeType, resourceData, subscriptionId: notif.subscriptionId },
  })
}

function buildCalendarDesc(person: FamilyPerson, changeType: string, resourceData: unknown): string {
  const data = resourceData as Record<string, unknown>
  const subject = data?.subject as string || ''
  const name = capitalize(person)
  if (subject) return `${name}'s Outlook Calendar: "${subject}" was ${changeType}`
  return `${name}'s Outlook Calendar had an event ${changeType}`
}

function inferPersonFromResource(resource: string): FamilyPerson {
  // Try to pull userId from /users/{userId}/... — requires matching against known IDs
  // Without a mapping we can't reliably identify the person here; setup route stores it
  return 'unknown'
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

// ─── MS Graph notification shape ─────────────────────────────────────────────

interface MsNotification {
  subscriptionId: string
  subscriptionExpirationDateTime?: string
  clientState: string
  changeType: string
  resource: string
  resourceData?: unknown
  tenantId?: string
}
