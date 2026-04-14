import { google } from 'googleapis'

export type CalEvent = {
  id: string
  title: string
  owner: string
  calendarId: string
  start: string
  end: string
  tags: string[]
  location: string | null
  status: 'busy' | 'tentative' | 'free'
  notes: string
  htmlLink: string | null
}

export async function fetchGoogleEvents(
  refreshToken: string,
  owner: string,
  tags: string[]
): Promise<CalEvent[]> {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2.setCredentials({ refresh_token: refreshToken })

  const cal = google.calendar({ version: 'v3', auth: oauth2 })

  const now = new Date()
  const future = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  const calListRes = await cal.calendarList.list()
  const calendars = calListRes.data.items || []

  const allEvents: CalEvent[] = []

  for (const calendar of calendars) {
    if (!calendar.id) continue
    try {
      const eventsRes = await cal.events.list({
        calendarId: calendar.id,
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      })

      for (const item of eventsRes.data.items || []) {
        if (!item.id || !item.summary) continue
        const start = item.start?.dateTime || item.start?.date || ''
        const end = item.end?.dateTime || item.end?.date || ''
        allEvents.push({
          id: `google-${item.id}`,
          title: item.summary,
          owner,
          calendarId: calendar.id,
          start,
          end,
          tags,
          location: item.location || null,
          status: item.status === 'tentative' ? 'tentative' : item.transparency === 'transparent' ? 'free' : 'busy',
          notes: item.description || '',
          htmlLink: item.htmlLink || null,
        })
      }
    } catch {
      // Skip calendars we can't access
    }
  }

  return allEvents
}
