import { NextResponse } from 'next/server'
import { readPcActivity, type PcWeeklySummary, type AppCategory } from '../../../../../lib/pc-activity'
import { categorizeApp } from '../../../../../lib/pc-categories'

export async function GET() {
  try {
    const data = await readPcActivity()
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Filter to last 7 days
    const weekReports = data.reports.filter(r => r.timestamp >= weekAgo)

    // Group by hostname
    const grouped: Record<string, typeof weekReports> = {}
    for (const r of weekReports) {
      if (!grouped[r.hostname]) grouped[r.hostname] = []
      grouped[r.hostname].push(r)
    }

    const summaries: PcWeeklySummary[] = []

    for (const [hostname, reports] of Object.entries(grouped)) {
      const device = data.devices[hostname]
      const byCategory: Record<AppCategory, number> = {
        gaming: 0, video: 0, social: 0, browsing: 0, productivity: 0, other: 0,
      }
      const appMinutes: Record<string, number> = {}
      const domainVisits: Record<string, number> = {}

      for (const r of reports) {
        // Count active (non-idle) intervals as 5 minutes each
        if (r.idleSeconds < 120 && r.foreground) {
          const cat = categorizeApp(
            r.foreground.processName,
            r.foreground.windowTitle,
            data.customCategories
          )
          byCategory[cat] += 5

          const appName = r.foreground.processName.replace(/\.exe$/i, '')
          appMinutes[appName] = (appMinutes[appName] || 0) + 5
        }

        // Count browser history domain visits
        for (const entry of r.browserHistory || []) {
          try {
            const domain = new URL(entry.url).hostname.replace(/^www\./, '')
            domainVisits[domain] = (domainVisits[domain] || 0) + 1
          } catch { /* skip malformed URLs */ }
        }
      }

      const totalMinutes = Object.values(byCategory).reduce((a, b) => a + b, 0)

      const topApps = Object.entries(appMinutes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, minutes]) => ({ name, minutes }))

      const topDomains = Object.entries(domainVisits)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([domain, visits]) => ({ domain, visits }))

      summaries.push({
        hostname,
        profileId: device?.profileId ?? null,
        displayName: device?.displayName ?? hostname,
        totalMinutes,
        byCategory,
        topApps,
        topDomains,
        avgDailyMinutes: Math.round(totalMinutes / 7),
      })
    }

    return NextResponse.json({ summaries })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
