// GET /api/family-intel/report
// Returns a structured capability report for the Family Intel system — what each
// source can do, current status, setup steps, and a markdown document version.

import { NextResponse } from 'next/server'
import {
  getMicrosoftStatus,
  getGoogleStatus,
  getPiholeStatus,
  loadEvents,
  loadSubscriptions,
  loadPiholeCursor,
} from '@/lib/family-intel'

export async function GET() {
  const [events, subs, piholeTs, ms, google, pihole] = await Promise.all([
    loadEvents(),
    loadSubscriptions(),
    loadPiholeCursor(),
    Promise.resolve(getMicrosoftStatus()),
    Promise.resolve(getGoogleStatus()),
    Promise.resolve(getPiholeStatus()),
  ])

  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const todayEvents = events.filter(e => new Date(e.timestamp) >= todayStart)

  const report = {
    generatedAt: now.toISOString(),
    systemName: 'Family Intel — Unified Cross-Platform Event Timeline',
    version: '1.0.0',

    summary: {
      totalEventsStored: events.length,
      eventsToday: todayEvents.length,
      activeSubscriptions: subs.filter(s => new Date(s.expiresAt) > now).length,
      sourcesConfigured: [ms, google, pihole].filter(s => s.configured).length,
      piholeLastPoll: piholeTs > 0 ? new Date(piholeTs * 1000).toISOString() : null,
    },

    sources: {
      microsoft: {
        ...ms,
        what_it_gives_you: [
          'Real-time Outlook Calendar changes (events created, modified, deleted)',
          'OneDrive file activity (uploads, edits, deletes) for each family member',
          'Azure AD sign-in log: who signed in, from which app and IP address',
          'Microsoft Defender security alerts (malware, suspicious sign-ins)',
          'Microsoft Teams message activity (if M365 Family or Business plan)',
        ],
        what_it_cannot_do: [
          'Cannot read email body content (only signal that email activity occurred)',
          'OneDrive gives file names and times but not file contents',
          'Sign-in log only shows Azure AD authentications (not all web logins)',
          'Requires Azure App Registration (free) — cannot use personal MSA accounts directly',
          'Subscriptions expire — calendar subs last 4,230 min; sign-in subs last 60 min',
        ],
        setup_steps: [
          '1. Create an Azure App Registration at portal.azure.com',
          '2. Add API permissions: Calendars.Read, Files.Read.All, AuditLog.Read.All, User.Read.All, SecurityEvents.Read.All',
          '3. Grant admin consent for all permissions',
          '4. Create a client secret (expires — use 24 months)',
          '5. Add MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET to .env.local',
          '6. Add MS_MIKE_USER_ID and MS_ERIN_USER_ID (get from Graph /users endpoint)',
          '7. Expose this server publicly (ngrok or Cloudflare Tunnel) — add URL to WEBHOOK_BASE_URL',
          '8. POST /api/family-intel/setup with { "source": "microsoft" }',
        ],
        subscription_renewal_note: 'Subscriptions must be renewed before expiry. Calendar and Drive subs last ~3 days max. Use POST /api/family-intel/setup to renew. Consider a cron job every 2 days.',
      },

      google: {
        ...google,
        what_it_gives_you: [
          'Real-time Google Calendar changes for Mike and Erin (all 3 Google accounts already wired)',
          'Google Drive file activity — files modified, created, deleted',
          'Gmail push notification when inbox changes (message count / labels)',
          'Per-account granularity — can track which account had activity',
        ],
        what_it_cannot_do: [
          'Google does not send event content in the webhook — we have to fetch changed items',
          'Gmail push only tells you "something changed" — no email body or subject without a fetch',
          'Google Drive watch tells you "something changed" — need an additional API call to get what',
          'Watch channels expire after 7 days max — need renewal',
          'Kids accounts (Liam/Clara) would need their own Google OAuth tokens — not configured yet',
        ],
        setup_steps: [
          '1. Google credentials are already configured (GOOGLE_CLIENT_ID, SECRET, refresh tokens)',
          '2. Expose this server publicly and set WEBHOOK_BASE_URL',
          '3. Set GOOGLE_WEBHOOK_SECRET in .env.local (any random string)',
          '4. POST /api/family-intel/setup with { "source": "google" }',
          '5. This creates Calendar and Drive watch channels for Mike + Erin',
          '6. Renew every 6 days (channels expire after 7 days max)',
        ],
        subscription_renewal_note: 'Google watch channels expire after 7 days. Use POST /api/family-intel/setup to renew. Consider a cron job every 6 days.',
      },

      pihole: {
        ...pihole,
        what_it_gives_you: [
          'Complete DNS query log for every device on your network',
          'Blocked domain detection — every time a blocked site is attempted',
          'Per-device attribution via IP → person mapping (data/family-intel-devices.json)',
          'Domain category intelligence — gaming, streaming, social, educational, chat',
          'Activity patterns — can correlate when kids are active vs. when they should be in school',
          'Works entirely locally — no public URL required',
        ],
        what_it_cannot_do: [
          'Cannot see encrypted SNI or ESNI traffic (if DNS-over-HTTPS is bypassed)',
          'IP-to-person mapping requires keeping the device list current',
          'DNS queries don\'t tell you what was done on a site, only that the site was visited',
          'Cannot see HTTPS traffic content — only domain names',
          'VPN usage by a device bypasses Pi-hole entirely',
        ],
        polling_notes: [
          'Pi-hole is polled via GET /api/family-intel/ingest/pihole — not a webhook',
          'Can be called from the UI or via a scheduled task',
          'Cursor tracks last poll time — safe to call frequently without re-processing old data',
          'Reset cursor with GET /api/family-intel/ingest/pihole?reset=1 to re-scan history',
          'Current cursor: ' + (piholeTs > 0 ? new Date(piholeTs * 1000).toISOString() : 'not set (will scan last 2 minutes on first poll)'),
        ],
      },
    },

    routerVsPlatformComparison: {
      router_gives_you: [
        'All network traffic by device (DNS level)',
        'Block/allow by domain, IP, or category',
        'Traffic volume and timing patterns',
        'Works for every device — phones, tablets, consoles, smart TVs',
        'No platform cooperation required',
      ],
      platform_gives_you: [
        'What apps and services are being used (beyond just network)',
        'Calendar events — schedule and context',
        'File activity — what was created/modified',
        'Sign-in events — authentication across devices',
        'Cross-device correlation — same person on phone + laptop',
      ],
      together: [
        'Router sees: Liam\'s iPad → roblox.com at 10pm',
        'Calendar has: Liam\'s bedtime = 9:30pm',
        'Together: Roblox past bedtime — actionable alert',
        '',
        'Router sees: Clara\'s iPad → youtube.com 14 times between 8am-3pm',
        'Calendar has: School hours 8am-3pm',
        'Together: Device active during school — investigate',
        '',
        'MS Graph sees: Erin signed in from unknown IP',
        'Router sees: No LAN device with that IP',
        'Together: Possible sign-in from outside home — security alert',
      ],
    },

    webhookUrls: {
      microsoft: process.env.WEBHOOK_BASE_URL
        ? `${process.env.WEBHOOK_BASE_URL}/api/family-intel/ingest/microsoft`
        : 'Set WEBHOOK_BASE_URL first',
      google: process.env.WEBHOOK_BASE_URL
        ? `${process.env.WEBHOOK_BASE_URL}/api/family-intel/ingest/google`
        : 'Set WEBHOOK_BASE_URL first',
      pihole: 'http://localhost:3333/api/family-intel/ingest/pihole (local only)',
    },

    envVarsRequired: {
      microsoft: ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_MIKE_USER_ID', 'WEBHOOK_BASE_URL'],
      google:    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_MIKE_REFRESH_TOKEN', 'WEBHOOK_BASE_URL', 'GOOGLE_WEBHOOK_SECRET'],
      pihole:    ['PIHOLE_HOST', 'PIHOLE_PORT', 'PIHOLE_PASS'],
      optional:  ['MS_ERIN_USER_ID', 'GOOGLE_ERIN_REFRESH_TOKEN', 'MS_WEBHOOK_SECRET'],
    },

    eventStats: {
      total: events.length,
      today: todayEvents.length,
      bySource: countBy(events, 'source'),
      byPerson: countBy(events, 'person'),
      byCategory: countBy(events, 'category'),
      bySeverity: countBy(events, 'severity'),
    },

    activeSubscriptions: subs,
  }

  return NextResponse.json(report)
}

function countBy(arr: unknown[], key: string): Record<string, number> {
  return arr.reduce((acc: Record<string, number>, item) => {
    const val = String((item as Record<string, unknown>)[key] ?? 'unknown')
    acc[val] = (acc[val] ?? 0) + 1
    return acc
  }, {})
}
