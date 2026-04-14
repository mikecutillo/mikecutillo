// ─── Pi-hole DNS Intelligence Poller ─────────────────────────────────────────
// Polls the Pi-hole v6 query log and converts interesting DNS activity into
// FamilyIntelEvents. Works entirely on your local network — no public URL needed.
//
// WHAT IT DOES:
//   - Fetches all queries since the last poll timestamp
//   - Maps client IP → family member via data/family-intel-devices.json
//   - Filters for: blocked domains + known categories (gaming/streaming/social/etc.)
//   - Deduplicates: same domain + same device within a 5-minute window = one event
//   - Saves cursor so each poll only processes new queries
//
// TRIGGER:
//   GET  /api/family-intel/ingest/pihole         — poll now, return summary
//   POST /api/family-intel/ingest/pihole         — same (for scheduled calls)
//   GET  /api/family-intel/ingest/pihole?reset=1 — reset cursor to 0 (re-scan all)

import { NextResponse, NextRequest } from 'next/server'
import { phGet } from '@/app/api/router/pihole/client'
import {
  makeEvent,
  appendEvents,
  loadDevices,
  lookupDomain,
  loadPiholeCursor,
  savePiholeCursor,
  personFromDevice,
  type FamilyIntelEvent,
  type FamilyPerson,
  type EventSeverity,
} from '@/lib/family-intel'

// Domains we don't care about even if they're interesting categories
const NOISE_DOMAINS = new Set([
  'connectivitycheck.gstatic.com',
  'captive.apple.com',
  'time.apple.com',
  'gateway.icloud.com',
  'push.apple.com',
])

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  if (sp.get('reset') === '1') {
    await savePiholeCursor(0)
    return NextResponse.json({ reset: true, message: 'Pi-hole cursor reset to 0' })
  }
  return poll()
}

export async function POST() {
  return poll()
}

// ─── Core Poll Logic ──────────────────────────────────────────────────────────

async function poll() {
  try {
    const lastTs  = await loadPiholeCursor()
    const nowTs   = Math.floor(Date.now() / 1000)
    const fromTs  = lastTs > 0 ? lastTs : nowTs - 120 // default: last 2 minutes on first run

    const data = await phGet(`/queries?from=${fromTs}&until=${nowTs}`)
    const queries: PiholeQuery[] = data?.queries ?? []

    if (!queries.length) {
      await savePiholeCursor(nowTs)
      return NextResponse.json({ polled: true, newEvents: 0, queriesScanned: 0, from: fromTs, until: nowTs })
    }

    const devices  = await loadDevices()
    const newEvents: FamilyIntelEvent[] = []

    // Deduplicate: (clientIP, baseDomain, 5-min bucket) → only emit once
    const seen = new Set<string>()

    for (const q of queries) {
      const domain    = q.domain || ''
      const clientIp  = q.client?.ip || ''
      const isBlocked = (q.status || '').startsWith('BLOCKED')

      if (NOISE_DOMAINS.has(domain)) continue

      const profile    = lookupDomain(domain)
      const baseDomain = getBaseDomain(domain)

      // Only emit events for:
      //   1. Blocked queries (always interesting)
      //   2. Queries matching our domain intelligence map
      if (!isBlocked && !profile) continue

      const bucket    = Math.floor(q.time / 300)   // 5-minute bucket
      const dedupeKey = `${clientIp}:${baseDomain}:${bucket}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const person   = personFromDevice(clientIp, devices)
      const device   = devices.find(d => d.identifier === clientIp)
      const severity : EventSeverity = isBlocked ? 'warning' : (profile?.severity ?? 'info')
      const label    = profile?.label ?? domain

      if (isBlocked) {
        newEvents.push(makeEvent({
          timestamp:    new Date(q.time * 1000).toISOString(),
          source:       'pihole',
          sourceDetail: 'dns-blocked',
          person,
          device:       device?.deviceName || clientIp,
          category:     'network',
          severity,
          title:        `Blocked: ${label}`,
          description:  buildDesc(person, device?.deviceName || clientIp, label, domain, true, profile?.flag),
          domain:       baseDomain,
          metadata: {
            queryType:     q.type,
            status:        q.status,
            clientName:    q.client?.name || clientIp,
            fullDomain:    domain,
            domainCategory: profile?.flag ?? 'blocked',
            count:         countInBatch(queries, clientIp, baseDomain, bucket),
          },
        }))
      } else {
        newEvents.push(makeEvent({
          timestamp:    new Date(q.time * 1000).toISOString(),
          source:       'pihole',
          sourceDetail: 'dns-query',
          person,
          device:       device?.deviceName || clientIp,
          category:     'network',
          severity,
          title:        `${flagLabel(profile?.flag)}: ${label}`,
          description:  buildDesc(person, device?.deviceName || clientIp, label, domain, false, profile?.flag),
          domain:       baseDomain,
          metadata: {
            queryType:     q.type,
            status:        q.status,
            clientName:    q.client?.name || clientIp,
            fullDomain:    domain,
            domainCategory: profile?.flag ?? 'network',
            count:         countInBatch(queries, clientIp, baseDomain, bucket),
          },
        }))
      }
    }

    await appendEvents(newEvents)
    await savePiholeCursor(nowTs)

    return NextResponse.json({
      polled:        true,
      newEvents:     newEvents.length,
      queriesScanned: queries.length,
      from:          fromTs,
      until:         nowTs,
    })
  } catch (err) {
    console.error('[family-intel/pihole] poll error:', err)
    return NextResponse.json({
      polled:    false,
      error:     err instanceof Error ? err.message : 'Poll failed',
      newEvents: 0,
    }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBaseDomain(domain: string): string {
  const parts = domain.split('.')
  if (parts.length <= 2) return domain
  return parts.slice(-2).join('.')
}

function flagLabel(flag?: string): string {
  switch (flag) {
    case 'gaming':        return 'Gaming'
    case 'streaming':     return 'Streaming'
    case 'social':        return 'Social'
    case 'educational':   return 'Educational'
    case 'communication': return 'Chat'
    case 'shopping':      return 'Shopping'
    default:              return 'Network'
  }
}

function buildDesc(
  person: FamilyPerson,
  deviceName: string,
  label: string,
  domain: string,
  blocked: boolean,
  flag?: string,
): string {
  const name = person === 'unknown' ? deviceName : capitalize(person)
  if (blocked) {
    return `${name}'s device attempted to reach ${domain} — blocked by Pi-hole`
  }
  const verb = flag === 'streaming' ? 'is streaming on' : flag === 'gaming' ? 'is playing on' : 'is on'
  return `${name} ${verb} ${label}`
}

function countInBatch(queries: PiholeQuery[], ip: string, base: string, bucket: number): number {
  return queries.filter(q => {
    const qBucket = Math.floor(q.time / 300)
    return q.client?.ip === ip && getBaseDomain(q.domain) === base && qBucket === bucket
  }).length
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

// ─── Pi-hole v6 query shape ───────────────────────────────────────────────────

interface PiholeQuery {
  id: number
  time: number           // Unix timestamp (float)
  type: string           // 'A' | 'AAAA' | 'CNAME' | etc.
  domain: string
  client: {
    ip: string
    name?: string
  }
  status: string         // 'FORWARDED' | 'CACHE' | 'BLOCKED_GRAVITY' | 'BLOCKED_*' | etc.
  reply?: {
    type?: string
    time?: number
  }
  upstream?: string
}
