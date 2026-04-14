/**
 * data.ts — BMO's data access layer
 *
 * Reads from all Mission Control data files to answer questions.
 * Each function returns clean, summarized data ready for BMO to relay.
 */

import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data'

async function readJSON<T>(filename: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJSON(filename: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Types ──────────────────────────────────────────────────────────────────

type AppCategory = 'gaming' | 'video' | 'social' | 'browsing' | 'productivity' | 'other'

interface PcDevice {
  profileId: string | null
  displayName: string
  lastSeen: string
  lastUser: string
  lastForeground: string
  idleSeconds: number
}

interface PcReport {
  hostname: string
  timestamp: string
  windowsUser: string
  foreground: { processName: string; windowTitle: string } | null
  idleSeconds: number
  uptime: number
  processes: { name: string; pid: number; cpu: number; memMb: number }[]
  connections: { localPort: number; remoteAddress: string; remotePort: number; owningProcess: string }[]
  browserHistory: { url: string; title: string; visitTime: string; browser: string }[]
  loginEvents: { type: string; user: string; time: string }[]
}

interface PcActivityData {
  devices: Record<string, PcDevice>
  reports: PcReport[]
  customCategories?: Record<string, string>
}

// ─── Process categorization (mirrors pc-categories.ts) ──────────────────────

const PROCESS_CAT: [RegExp, AppCategory][] = [
  [/roblox/i, 'gaming'], [/fortnite/i, 'gaming'], [/minecraft/i, 'gaming'],
  [/javaw/i, 'gaming'], [/steam/i, 'gaming'], [/epicgameslauncher/i, 'gaming'],
  [/valorant/i, 'gaming'], [/overwatch/i, 'gaming'], [/terraria/i, 'gaming'],
  [/amongus/i, 'gaming'], [/rocketleague/i, 'gaming'], [/apexlegends/i, 'gaming'],
  [/league/i, 'gaming'], [/battlenet/i, 'gaming'],
  [/vlc/i, 'video'], [/plex/i, 'video'], [/netflix/i, 'video'],
  [/discord/i, 'social'], [/slack/i, 'social'], [/telegram/i, 'social'],
  [/winword/i, 'productivity'], [/excel/i, 'productivity'],
  [/powerpnt/i, 'productivity'], [/code/i, 'productivity'],
  [/teams/i, 'productivity'], [/zoom/i, 'productivity'],
]

const TITLE_CAT: [RegExp, AppCategory][] = [
  [/youtube/i, 'video'], [/netflix/i, 'video'], [/twitch/i, 'video'],
  [/disney/i, 'video'], [/hulu/i, 'video'], [/crunchyroll/i, 'video'],
  [/roblox/i, 'gaming'], [/coolmathgames/i, 'gaming'], [/poki/i, 'gaming'],
  [/tiktok/i, 'social'], [/instagram/i, 'social'], [/snapchat/i, 'social'],
  [/facebook/i, 'social'], [/twitter|x\.com/i, 'social'], [/reddit/i, 'social'],
  [/discord/i, 'social'],
  [/google\s?docs/i, 'productivity'], [/google\s?classroom/i, 'productivity'],
  [/khan\s?academy/i, 'productivity'], [/wikipedia/i, 'productivity'],
  [/quizlet/i, 'productivity'], [/canvas/i, 'productivity'],
]

function categorizeProcess(processName: string, windowTitle?: string): AppCategory {
  const proc = processName.replace(/\.exe$/i, '')
  for (const [re, cat] of PROCESS_CAT) {
    if (re.test(proc)) return cat
  }
  if (/^(chrome|msedge|firefox|brave)$/i.test(proc) && windowTitle) {
    for (const [re, cat] of TITLE_CAT) {
      if (re.test(windowTitle)) return cat
    }
    return 'browsing'
  }
  if (windowTitle) {
    for (const [re, cat] of TITLE_CAT) {
      if (re.test(windowTitle)) return cat
    }
  }
  return 'other'
}

// ─── Screen Time Queries ────────────────────────────────────────────────────

/**
 * Get current status of all devices
 */
export async function getDeviceStatus(): Promise<{
  devices: { name: string; user: string; online: boolean; idle: boolean; app: string; lastSeen: string }[]
}> {
  const data = await readJSON<PcActivityData>('pc-activity.json', { devices: {}, reports: [] })
  const now = Date.now()

  const devices = Object.entries(data.devices).map(([hostname, dev]) => {
    const msSinceLastSeen = now - new Date(dev.lastSeen).getTime()
    const online = msSinceLastSeen < 10 * 60 * 1000 // 10 minutes
    const idle = dev.idleSeconds > 300 // 5 minutes

    return {
      name: dev.displayName || hostname,
      user: dev.lastUser,
      online,
      idle,
      app: dev.lastForeground?.replace(/\.exe$/i, '') || 'unknown',
      lastSeen: dev.lastSeen,
    }
  })

  return { devices }
}

/**
 * Get time spent by category for a specific user over a time window.
 * Uses report frequency (every 5 min) to estimate usage.
 */
export async function getUsageByCategory(
  userName: string,
  hoursBack = 24
): Promise<Record<AppCategory, number>> {
  const data = await readJSON<PcActivityData>('pc-activity.json', { devices: {}, reports: [] })
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()

  const usage: Record<AppCategory, number> = {
    gaming: 0, video: 0, social: 0, browsing: 0, productivity: 0, other: 0
  }

  const REPORT_INTERVAL_MIN = 5 // each report represents ~5 minutes of activity

  for (const report of data.reports) {
    if (report.timestamp < cutoff) continue
    if (report.windowsUser.toLowerCase() !== userName.toLowerCase()) continue
    if (!report.foreground) continue
    if (report.idleSeconds > 300) continue // skip idle reports

    const cat = categorizeProcess(
      report.foreground.processName,
      report.foreground.windowTitle
    )
    usage[cat] += REPORT_INTERVAL_MIN
  }

  return usage
}

/**
 * Get a user's top apps for a time window
 */
export async function getTopApps(
  userName: string,
  hoursBack = 24
): Promise<{ name: string; minutes: number; category: AppCategory }[]> {
  const data = await readJSON<PcActivityData>('pc-activity.json', { devices: {}, reports: [] })
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()

  const appTime: Record<string, { minutes: number; category: AppCategory }> = {}

  for (const report of data.reports) {
    if (report.timestamp < cutoff) continue
    if (report.windowsUser.toLowerCase() !== userName.toLowerCase()) continue
    if (!report.foreground) continue
    if (report.idleSeconds > 300) continue

    const appName = report.foreground.processName.replace(/\.exe$/i, '')
    const cat = categorizeProcess(report.foreground.processName, report.foreground.windowTitle)

    if (!appTime[appName]) appTime[appName] = { minutes: 0, category: cat }
    appTime[appName].minutes += 5
  }

  return Object.entries(appTime)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 10)
}

/**
 * Get recent browser history for a user
 */
export async function getRecentBrowsing(
  userName: string,
  hoursBack = 4
): Promise<{ title: string; url: string; time: string }[]> {
  const data = await readJSON<PcActivityData>('pc-activity.json', { devices: {}, reports: [] })
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()

  const entries: { title: string; url: string; time: string }[] = []
  const seen = new Set<string>()

  for (const report of data.reports) {
    if (report.timestamp < cutoff) continue
    if (report.windowsUser.toLowerCase() !== userName.toLowerCase()) continue

    for (const entry of report.browserHistory || []) {
      if (!seen.has(entry.url)) {
        seen.add(entry.url)
        entries.push({ title: entry.title, url: entry.url, time: entry.visitTime })
      }
    }
  }

  return entries.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 15)
}

// ─── Other Data Sources ─────────────────────────────────────────────────────

/**
 * Get bills summary
 */
export async function getBillsSummary(): Promise<string> {
  const bills = await readJSON<any>('accounts-bills-normalized.json', null)
  if (!bills) return 'No billing data available yet.'

  try {
    const entries = Array.isArray(bills) ? bills : bills.bills || bills.entries || []
    if (entries.length === 0) return 'No bills on file.'

    const lines = entries.slice(0, 10).map((b: any) => {
      const name = b.name || b.vendor || b.description || 'Unknown'
      const amount = b.amount ? `$${Number(b.amount).toFixed(2)}` : ''
      const due = b.dueDate || b.due || ''
      return `• **${name}** ${amount} ${due ? `(due ${due})` : ''}`
    })

    return lines.join('\n')
  } catch {
    return 'BMO had trouble reading the bills data.'
  }
}

/**
 * Get job pipeline summary
 */
export async function getJobPipeline(): Promise<string> {
  const jobs = await readJSON<any>('job-pipeline.json', null)
  if (!jobs) return 'No job pipeline data available.'

  try {
    const entries = Array.isArray(jobs) ? jobs : jobs.jobs || jobs.applications || jobs.entries || []
    if (entries.length === 0) return 'Job pipeline is empty.'

    const statusCounts: Record<string, number> = {}
    for (const job of entries) {
      const status = job.status || 'unknown'
      statusCounts[status] = (statusCounts[status] || 0) + 1
    }

    const lines = Object.entries(statusCounts)
      .map(([status, count]) => `• **${status}**: ${count}`)

    return `**Job Pipeline Overview**\n${lines.join('\n')}\nTotal: ${entries.length} applications`
  } catch {
    return 'BMO had trouble reading the job pipeline.'
  }
}

/**
 * Get calendar events
 */
export async function getCalendarSummary(): Promise<string> {
  const cal = await readJSON<any>('household-calendar.json', null)
  if (!cal) return 'No calendar data loaded yet.'

  try {
    const events = Array.isArray(cal) ? cal : cal.events || cal.entries || []
    if (events.length === 0) return 'Calendar is empty!'

    const today = new Date().toISOString().split('T')[0]
    const upcoming = events
      .filter((e: any) => (e.date || e.start || '') >= today)
      .slice(0, 8)
      .map((e: any) => {
        const date = e.date || e.start || ''
        const title = e.title || e.summary || 'Untitled'
        return `• **${title}** — ${date}`
      })

    return upcoming.length > 0
      ? `**Upcoming Events**\n${upcoming.join('\n')}`
      : 'No upcoming events on the calendar.'
  } catch {
    return 'BMO had trouble reading the calendar.'
  }
}

/**
 * Get cloud storage overview
 */
export async function getCloudOverview(): Promise<string> {
  const cloud = await readJSON<any>('cloud-accounts.json', null)
  if (!cloud) return 'No cloud storage data available.'

  try {
    const accounts = Array.isArray(cloud) ? cloud : cloud.accounts || []
    if (accounts.length === 0) return 'No cloud accounts on file.'

    const lines = accounts.slice(0, 10).map((a: any) => {
      const name = a.name || a.provider || a.email || 'Unknown'
      const used = a.usedGB ? `${a.usedGB} GB used` : ''
      const total = a.totalGB ? `of ${a.totalGB} GB` : ''
      return `• **${name}** — ${used} ${total}`.trim()
    })

    return lines.join('\n')
  } catch {
    return 'BMO had trouble reading cloud data.'
  }
}

/**
 * Get family goals
 */
export async function getFamilyGoals(): Promise<string> {
  const goals = await readJSON<any>('family-goals.json', null)
  if (!goals) return 'No family goals set yet.'

  try {
    const entries = Array.isArray(goals) ? goals : goals.goals || []
    if (entries.length === 0) return 'No goals set yet — want to add some?'

    const lines = entries.map((g: any) => {
      const title = g.title || g.goal || g.name || 'Unnamed goal'
      const status = g.status || g.progress || ''
      return `• **${title}** ${status ? `(${status})` : ''}`
    })

    return lines.join('\n')
  } catch {
    return 'BMO had trouble reading family goals.'
  }
}

/**
 * Get news summary
 */
export async function getNewsSummary(): Promise<string> {
  const news = await readJSON<any>('news-intel.json', null)
  if (!news) return 'No news data available.'

  try {
    const items = Array.isArray(news) ? news : news.items || news.articles || news.stories || []
    if (items.length === 0) return 'No news items on file.'

    const recent = items.slice(0, 5).map((n: any) => {
      const title = n.title || n.headline || 'Untitled'
      return `• ${title}`
    })

    return `**Recent News**\n${recent.join('\n')}`
  } catch {
    return 'BMO had trouble reading the news.'
  }
}

/**
 * Master data summary — gives BMO context about everything
 */
export async function getFullDataContext(): Promise<string> {
  const [devices, bills, jobs, calendar, cloud, goals] = await Promise.all([
    getDeviceStatus(),
    getBillsSummary(),
    getJobPipeline(),
    getCalendarSummary(),
    getCloudOverview(),
    getFamilyGoals(),
  ])

  const deviceLines = devices.devices.map(d =>
    `  ${d.name} (${d.user}): ${d.online ? (d.idle ? 'idle' : `active — ${d.app}`) : 'offline'}`
  )

  return [
    `=== BMO Data Context ===`,
    ``,
    `DEVICES:`,
    ...deviceLines,
    ``,
    `BILLS:`,
    bills,
    ``,
    `JOBS:`,
    jobs,
    ``,
    `CALENDAR:`,
    calendar,
    ``,
    `CLOUD:`,
    cloud,
    ``,
    `FAMILY GOALS:`,
    goals,
  ].join('\n')
}
