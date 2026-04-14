/**
 * scheduler.ts — BMO's automated data feed system
 *
 * Runs inside the bot process. Posts real data to channels on a schedule.
 * Every post that asks a question also registers a pending conversation
 * so responses are captured.
 *
 * Tasks:
 * - Screen time digest → #screen-time every 6h
 * - Bill alerts → #bills-due daily at 9am
 * - Goal progress → #announcements Wednesday 7pm
 * - System log → #turbodot-log after each task
 */

import { Client, ChannelType, TextChannel } from 'discord.js'
import fs from 'fs/promises'
import path from 'path'
import { setPending, buildDiscordIdMap, getMemberIdByDiscordId } from './conversation'

const DATA_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data'
const STATE_FILE = path.join(DATA_DIR, 'bmo-scheduler-state.json')

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf-8'))
  } catch { return fallback }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface SchedulerState {
  lastRun: Record<string, string>  // taskId → ISO timestamp
}

interface ScheduledTask {
  id: string
  name: string
  channelName: string
  intervalHours: number
  runAtHour?: number       // hour of day (0-23) to prefer running
  runOnDays?: number[]     // 0=Sun, 1=Mon, ... 6=Sat
  handler: (channel: TextChannel) => Promise<void>
}

// ─── State persistence ──────────────────────────────────────────────────────

async function loadState(): Promise<SchedulerState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf-8'))
  } catch {
    return { lastRun: {} }
  }
}

async function saveState(state: SchedulerState): Promise<void> {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

function shouldRun(task: ScheduledTask, state: SchedulerState): boolean {
  const now = new Date()
  const lastRun = state.lastRun[task.id]

  // Never ran → run now
  if (!lastRun) return true

  const lastRunTime = new Date(lastRun).getTime()
  const hoursSinceLastRun = (now.getTime() - lastRunTime) / (1000 * 60 * 60)

  // Not enough time has passed
  if (hoursSinceLastRun < task.intervalHours) return false

  // Check day-of-week restriction
  if (task.runOnDays && !task.runOnDays.includes(now.getDay())) return false

  // Check preferred hour (within 1 hour window)
  if (task.runAtHour !== undefined) {
    const currentHour = now.getHours()
    if (Math.abs(currentHour - task.runAtHour) > 1) return false
  }

  return true
}

// ─── Data builders (produce REAL content from REAL data) ────────────────────

async function buildScreenTimeDigest(): Promise<string> {
  const data = await readJSON<any>('pc-activity.json', { devices: {}, reports: [] })
  const now = Date.now()
  const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000).toISOString()

  const lines: string[] = [`🎮 **Screen Time Report** (last 6 hours)`, ``]

  // Device status
  for (const [hostname, dev] of Object.entries(data.devices || {}) as any[]) {
    const msSince = now - new Date(dev.lastSeen).getTime()
    const online = msSince < 10 * 60 * 1000
    const app = (dev.lastForeground || 'unknown').replace(/\.exe$/i, '')
    const status = online ? (dev.idleSeconds > 300 ? '💤 idle' : `🟢 ${app}`) : '⚫ offline'
    lines.push(`**${dev.displayName || hostname}** (${dev.lastUser}) — ${status}`)
  }

  // Usage breakdown per user
  const recentReports = (data.reports || []).filter((r: any) => r.timestamp >= sixHoursAgo)
  const userUsage: Record<string, Record<string, number>> = {}

  for (const report of recentReports) {
    const user = report.windowsUser
    if (!user || !report.foreground || report.idleSeconds > 300) continue
    if (!userUsage[user]) userUsage[user] = {}
    const app = report.foreground.processName.replace(/\.exe$/i, '')

    // Categorize
    const proc = app.toLowerCase()
    let cat = 'other'
    if (/roblox|fortnite|minecraft|steam|epic|valorant|terraria/i.test(proc)) cat = 'gaming'
    else if (/youtube|netflix|twitch|disney|hulu|vlc|plex/i.test(report.foreground.windowTitle || '')) cat = 'video'
    else if (/discord|tiktok|instagram|snapchat|reddit/i.test(report.foreground.windowTitle || '')) cat = 'social'
    else if (/chrome|msedge|firefox|brave/i.test(proc)) cat = 'browsing'
    else if (/word|excel|code|teams|zoom|notepad/i.test(proc)) cat = 'productivity'

    userUsage[user][cat] = (userUsage[user][cat] || 0) + 5
  }

  if (Object.keys(userUsage).length > 0) {
    lines.push(``, `📊 **Usage Breakdown:**`)
    for (const [user, cats] of Object.entries(userUsage)) {
      const total = Object.values(cats).reduce((a, b) => a + b, 0)
      const topCat = Object.entries(cats).sort(([,a],[,b]) => b - a)[0]
      lines.push(`• **${user}**: ${(total/60).toFixed(1)}h total — mostly ${topCat[0]} (${(topCat[1]/60).toFixed(1)}h)`)
    }
  } else {
    lines.push(``, `No active usage data in the last 6 hours.`)
  }

  return lines.join('\n')
}

async function buildBillAlerts(): Promise<string | null> {
  const ledger = await readJSON<any>('financial-ledger.json', null)
  if (!ledger?.items) return null

  const today = new Date()
  const dayOfMonth = today.getDate()

  const upcoming = ledger.items.filter((item: any) => {
    if (!item.billing_day || item.category !== 'recurring_fixed') return false
    const daysUntil = item.billing_day >= dayOfMonth
      ? item.billing_day - dayOfMonth
      : (30 - dayOfMonth) + item.billing_day
    return daysUntil <= 3 && daysUntil >= 0
  })

  if (upcoming.length === 0) return null

  const lines = [
    `💰 **Bill Alert — Due in the next 3 days**`,
    ``,
    ...upcoming.map((b: any) => {
      const amt = b.amount || b.monthly_estimate
      return `• **${b.vendor}** — ${amt ? `$${Number(amt).toLocaleString()}` : 'amount TBD'} (day ${b.billing_day})`
    }),
  ]

  return lines.join('\n')
}

async function buildGoalProgress(): Promise<string> {
  const data = await readJSON<any>('family-goals.json', { goals: [] })
  const goals = data.goals || []

  const active = goals.filter((g: any) => g.status === 'approved' || g.status === 'in-progress')
  const proposed = goals.filter((g: any) => g.status === 'proposed')
  const completed = goals.filter((g: any) => g.status === 'completed')

  const lines = [`🎯 **Goal Progress Report**`, ``]

  if (completed.length > 0) {
    lines.push(`✅ **Completed:** ${completed.map((g: any) => g.title).join(', ')}`)
  }

  if (active.length > 0) {
    lines.push(`📈 **Active Goals:**`)
    for (const g of active) {
      const pct = g.currentValue !== null && g.startValue !== undefined
        ? g.direction === 'decrease'
          ? Math.round(((g.startValue - g.currentValue) / (g.startValue - g.targetValue)) * 100)
          : Math.round(((g.currentValue - g.startValue) / (g.targetValue - g.startValue)) * 100)
        : 0
      lines.push(`• **${g.title}** — ${Math.max(0, Math.min(100, pct))}% (${g.currentValue ?? '?'} → ${g.targetValue} ${g.unit})`)
    }
  }

  if (proposed.length > 0) {
    lines.push(``, `⏳ **Waiting for approval (${proposed.length}):** ${proposed.map((g: any) => g.title).join(', ')}`)
  }

  if (active.length === 0 && proposed.length === 0 && completed.length === 0) {
    lines.push(`No goals set yet. Ask BMO to propose some!`)
  }

  return lines.join('\n')
}

// ─── Task definitions ───────────────────────────────────────────────────────

function buildTasks(channelMap: Map<string, string>): ScheduledTask[] {
  function getChannel(client: Client, name: string): TextChannel | null {
    const id = channelMap.get(name)
    if (!id) return null
    const ch = client.channels.cache.get(id)
    if (!ch || ch.type !== ChannelType.GuildText) return null
    return ch as TextChannel
  }

  return [
    {
      id: 'screen-time-digest',
      name: 'Screen Time Digest',
      channelName: 'screen-time',
      intervalHours: 6,
      handler: async (channel) => {
        const content = await buildScreenTimeDigest()
        await channel.send(content)
      },
    },
    {
      id: 'bill-alerts',
      name: 'Bill Alerts',
      channelName: 'bills-due',
      intervalHours: 24,
      runAtHour: 9,
      handler: async (channel) => {
        const content = await buildBillAlerts()
        if (content) {
          await channel.send(content)
        }
      },
    },
    {
      id: 'goal-progress',
      name: 'Goal Progress',
      channelName: 'announcements',
      intervalHours: 168, // weekly
      runAtHour: 19,
      runOnDays: [3], // Wednesday
      handler: async (channel) => {
        const content = await buildGoalProgress()
        await channel.send(content)
      },
    },
  ]
}

// ─── Main scheduler loop ────────────────────────────────────────────────────

let schedulerClient: Client | null = null
let schedulerChannelMap: Map<string, string> = new Map()

export function startScheduler(client: Client, channelMap: Map<string, string>): void {
  schedulerClient = client
  schedulerChannelMap = channelMap

  console.log(`\n  [Scheduler] Starting with ${channelMap.size} channels mapped`)

  // Run the check every 60 seconds
  setInterval(async () => {
    await runScheduledTasks()
  }, 60 * 1000)

  // Also run once immediately (after a small delay to let caches populate)
  setTimeout(async () => {
    await runScheduledTasks()
  }, 5000)
}

async function runScheduledTasks(): Promise<void> {
  if (!schedulerClient) return

  const state = await loadState()
  const tasks = buildTasks(schedulerChannelMap)
  const logChannel = schedulerChannelMap.get('turbodot-log')
  const logCh = logChannel ? schedulerClient.channels.cache.get(logChannel) as TextChannel | undefined : undefined

  for (const task of tasks) {
    if (!shouldRun(task, state)) continue

    const channelId = schedulerChannelMap.get(task.channelName)
    if (!channelId) continue

    const channel = schedulerClient.channels.cache.get(channelId)
    if (!channel || channel.type !== ChannelType.GuildText) continue

    try {
      console.log(`  [Scheduler] Running: ${task.name} → #${task.channelName}`)
      await task.handler(channel as TextChannel)

      state.lastRun[task.id] = new Date().toISOString()
      await saveState(state)

      // Log to #turbodot-log
      if (logCh) {
        await logCh.send(`🤖 **[Scheduler]** Ran **${task.name}** → #${task.channelName} at ${new Date().toLocaleTimeString()}`)
      }
    } catch (err: any) {
      console.error(`  [Scheduler] Error in ${task.name}: ${err.message}`)
      if (logCh) {
        await logCh.send(`❌ **[Scheduler]** Failed: **${task.name}** — ${err.message}`)
      }
    }
  }
}
