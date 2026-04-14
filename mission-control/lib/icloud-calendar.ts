import { createDAVClient } from 'tsdav'
import type { CalEvent } from './google-calendar'

export type { CalEvent }

function unfold(ical: string): string {
  return ical.replace(/\r?\n[ \t]/g, '')
}

function getProp(ical: string, key: string): string | null {
  const unfolded = unfold(ical)
  const regex = new RegExp(`^${key}(?:;[^:]+)?:(.+)$`, 'm')
  const m = unfolded.match(regex)
  return m ? m[1].trim() : null
}

function parseICalDate(val: string | null): string {
  if (!val) return new Date().toISOString()
  // All-day: YYYYMMDD
  if (/^\d{8}$/.test(val)) {
    return `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`
  }
  // With time: YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
  const m = val.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/)
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : ''}`
  }
  return val
}

function extractVEvents(icalData: string): string[] {
  const events: string[] = []
  const regex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g
  let match
  while ((match = regex.exec(icalData)) !== null) {
    events.push(match[0])
  }
  return events
}

export async function fetchICloudEvents(
  appleId: string,
  appPassword: string,
  owner: string,
  tags: string[]
): Promise<CalEvent[]> {
  const client = await createDAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: {
      username: appleId,
      password: appPassword,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  })

  const calendars = await client.fetchCalendars()
  const now = new Date()
  const future = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  const allEvents: CalEvent[] = []

  for (const calendar of calendars) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: {
          start: now.toISOString(),
          end: future.toISOString(),
        },
      })

      for (const obj of objects) {
        if (!obj.data) continue
        const vevents = extractVEvents(obj.data)
        for (const vevent of vevents) {
          const uid = getProp(vevent, 'UID') || obj.url
          const summary = getProp(vevent, 'SUMMARY')
          if (!summary) continue
          const dtstart = getProp(vevent, 'DTSTART')
          const dtend = getProp(vevent, 'DTEND')
          allEvents.push({
            id: `icloud-${uid}`,
            title: summary,
            owner,
            calendarId: (calendar as { url?: string; displayName?: string }).url || (calendar as { url?: string; displayName?: string }).displayName || 'icloud',
            start: parseICalDate(dtstart),
            end: parseICalDate(dtend),
            tags,
            location: getProp(vevent, 'LOCATION'),
            status: 'busy',
            notes: getProp(vevent, 'DESCRIPTION') || '',
            htmlLink: null,
          })
        }
      }
    } catch {
      // Skip calendars we can't access
    }
  }

  return allEvents
}
