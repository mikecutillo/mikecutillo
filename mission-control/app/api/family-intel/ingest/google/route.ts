// ─── Google Push Notification Receiver ───────────────────────────────────────
// Handles incoming push notifications from Google Calendar and Google Drive.
//
// HOW IT WORKS:
//   Google does NOT send event content in the push notification body. Instead it sends
//   headers indicating that a resource changed. On receiving a push, we:
//     1. Check X-Goog-Resource-State (sync | exists | not_exists)
//     2. Look up which subscription/channel was triggered via X-Goog-Channel-ID
//     3. Fetch the actual changed items from the Google API
//     4. Normalize to FamilyIntelEvents and save
//
// SETUP REQUIREMENTS:
//   - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in .env.local
//   - At least one *_REFRESH_TOKEN (GOOGLE_MIKE_REFRESH_TOKEN, GOOGLE_ERIN_REFRESH_TOKEN, etc.)
//   - WEBHOOK_BASE_URL — publicly reachable URL (ngrok or Cloudflare Tunnel)
//   - GOOGLE_WEBHOOK_SECRET — token we set when creating watch channels (verified on receipt)

import { NextResponse, NextRequest } from 'next/server'
import {
  makeEvent,
  appendEvents,
  loadSubscriptions,
  getGoogleAccessToken,
  type FamilyIntelEvent,
  type FamilyPerson,
} from '@/lib/family-intel'

const GOOGLE_WEBHOOK_SECRET = process.env.GOOGLE_WEBHOOK_SECRET || 'family-intel-google-secret'

// Google POSTs to this endpoint when a watched resource changes
export async function POST(req: NextRequest) {
  const resourceState = req.headers.get('x-goog-resource-state') // 'sync' | 'exists' | 'not_exists'
  const channelId     = req.headers.get('x-goog-channel-id')     // Our channel UUID
  const channelToken  = req.headers.get('x-goog-channel-token')  // Our secret
  const resourceId    = req.headers.get('x-goog-resource-id')    // Google resource ID
  const resourceUri   = req.headers.get('x-goog-resource-uri')   // URL of changed resource

  // 'sync' is the initial handshake notification — acknowledge and ignore
  if (resourceState === 'sync') {
    return new Response(null, { status: 200 })
  }

  // Verify our secret token
  if (channelToken !== GOOGLE_WEBHOOK_SECRET) {
    console.warn('[family-intel] Google notification rejected — token mismatch')
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
  }

  // Look up the subscription to find person + resource type
  const subs = await loadSubscriptions()
  const sub = subs.find(s => s.channelId === channelId && s.source === 'google')

  if (!sub) {
    // Unknown channel — could be a stale subscription. Acknowledge anyway.
    console.warn(`[family-intel] Unknown Google channel: ${channelId}`)
    return new Response(null, { status: 200 })
  }

  const person: FamilyPerson = sub.person
  const resource = sub.resource  // 'calendar' | 'drive'

  const newEvents: FamilyIntelEvent[] = []

  if (resource === 'calendar') {
    const events = await fetchCalendarChanges(person)
    newEvents.push(...events)
  } else if (resource === 'drive') {
    const events = await fetchDriveChanges(person)
    newEvents.push(...events)
  } else if (resource === 'gmail') {
    newEvents.push(makeEvent({
      timestamp: new Date().toISOString(),
      source: 'google',
      sourceDetail: 'gmail',
      person,
      category: 'email',
      severity: 'info',
      title: 'New Gmail activity',
      description: `${capitalize(person)}'s Gmail inbox changed`,
      metadata: { channelId, resourceState, resourceUri },
    }))
  }

  await appendEvents(newEvents)
  return new Response(null, { status: 200 })
}

// GET is used by some Google verification flows
export async function GET(req: NextRequest) {
  return NextResponse.json({ status: 'google-push-ingest-endpoint', ready: true })
}

// ─── Calendar Change Fetch ────────────────────────────────────────────────────

async function fetchCalendarChanges(person: FamilyPerson): Promise<FamilyIntelEvent[]> {
  const refreshToken = getRefreshTokenForPerson(person)
  if (!refreshToken) return []

  const accessToken = await getGoogleAccessToken(refreshToken)
  if (!accessToken) return []

  // Fetch upcoming events (simple approach: get next 10 changed events)
  const now = new Date().toISOString()
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&orderBy=updated&singleEvents=true&timeMin=${now}`

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()
    const items: GoogleCalendarEvent[] = data.items || []

    return items.map(ev => makeEvent({
      timestamp: new Date().toISOString(),
      source: 'google',
      sourceDetail: 'google-calendar',
      person,
      category: 'calendar',
      severity: 'info',
      title: `Calendar event updated: ${ev.summary || '(no title)'}`,
      description: buildCalDesc(person, ev),
      metadata: {
        eventId: ev.id,
        summary: ev.summary,
        start: ev.start,
        end: ev.end,
        status: ev.status,
        htmlLink: ev.htmlLink,
        updatedAt: ev.updated,
      },
    }))
  } catch {
    return []
  }
}

// ─── Drive Change Fetch ───────────────────────────────────────────────────────

async function fetchDriveChanges(person: FamilyPerson): Promise<FamilyIntelEvent[]> {
  const refreshToken = getRefreshTokenForPerson(person)
  if (!refreshToken) return []

  const accessToken = await getGoogleAccessToken(refreshToken)
  if (!accessToken) return []

  // Fetch recent Drive activity (top 5 recently modified files)
  const url = `https://www.googleapis.com/drive/v3/files?pageSize=5&orderBy=modifiedTime+desc&fields=files(id,name,mimeType,modifiedTime,owners,webViewLink)`

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()
    const files: GoogleDriveFile[] = data.files || []

    return files.map(f => makeEvent({
      timestamp: f.modifiedTime || new Date().toISOString(),
      source: 'google',
      sourceDetail: 'google-drive',
      person,
      category: 'file',
      severity: 'info',
      title: `Drive file modified: ${f.name}`,
      description: `${capitalize(person)}'s Google Drive: "${f.name}" was recently modified`,
      metadata: {
        fileId: f.id,
        name: f.name,
        mimeType: f.mimeType,
        webViewLink: f.webViewLink,
        modifiedTime: f.modifiedTime,
      },
    }))
  } catch {
    return []
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRefreshTokenForPerson(person: FamilyPerson): string | null {
  switch (person) {
    case 'mike':  return process.env.GOOGLE_MIKE_REFRESH_TOKEN  || null
    case 'erin':  return process.env.GOOGLE_ERIN_REFRESH_TOKEN  || null
    default:      return null
  }
}

function buildCalDesc(person: FamilyPerson, ev: GoogleCalendarEvent): string {
  const name = capitalize(person)
  const start = ev.start?.dateTime || ev.start?.date || ''
  if (start) {
    const d = new Date(start)
    return `${name}'s Google Calendar: "${ev.summary || 'event'}" — ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  }
  return `${name}'s Google Calendar: "${ev.summary || 'event'}" was updated`
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

// ─── Google API types ─────────────────────────────────────────────────────────

interface GoogleCalendarEvent {
  id: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  status?: string
  htmlLink?: string
  updated?: string
}

interface GoogleDriveFile {
  id: string
  name: string
  mimeType?: string
  modifiedTime?: string
  webViewLink?: string
}
