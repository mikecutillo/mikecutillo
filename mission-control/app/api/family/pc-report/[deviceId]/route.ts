import { NextRequest, NextResponse } from 'next/server'
import { readPcActivity } from '../../../../../lib/pc-activity'
import { categorizeApp, type AppCategory } from '../../../../../lib/pc-categories'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { deviceId } = await params
    const hostname = decodeURIComponent(deviceId)
    const data = await readPcActivity()

    const device = data.devices[hostname]
    if (!device) {
      return NextResponse.json({ error: 'device not found' }, { status: 404 })
    }

    // Last 48 hours of reports for this device
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const reports = data.reports
      .filter(r => r.hostname === hostname && r.timestamp >= cutoff)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    // Hourly breakdown for the last 24 hours
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const hourly: { hour: number; categories: Record<AppCategory, number> }[] = []

    for (let h = 0; h < 24; h++) {
      const categories: Record<AppCategory, number> = {
        gaming: 0, video: 0, social: 0, browsing: 0, productivity: 0, other: 0,
      }

      const hourStart = new Date(dayAgo)
      hourStart.setHours(dayAgo.getHours() + h, 0, 0, 0)
      const hourEnd = new Date(hourStart)
      hourEnd.setHours(hourStart.getHours() + 1)

      const hourReports = reports.filter(r => {
        const t = new Date(r.timestamp)
        return t >= hourStart && t < hourEnd
      })

      for (const r of hourReports) {
        if (r.idleSeconds < 120 && r.foreground) {
          const cat = categorizeApp(
            r.foreground.processName,
            r.foreground.windowTitle,
            data.customCategories
          )
          categories[cat] += 5 // 5 minutes per report interval
        }
      }

      hourly.push({ hour: hourStart.getHours(), categories })
    }

    return NextResponse.json({ device, reports: reports.slice(0, 200), hourly })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
