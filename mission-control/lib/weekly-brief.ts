/**
 * weekly-brief.ts — BMO's Weekly Report for the Cutillo Family
 *
 * Generates a cohesive family narrative connecting calendar, finances,
 * goals, school, pulse check-ins, and action items. Posted to #announcements
 * every Sunday evening, with a parents-only detailed DM version.
 *
 * Also generates short daily digests for relevant channels.
 */

import { readJSON } from './data'
import { getGoals, getGoalSummary, type FamilyGoal } from './goal-tracker'
import { getPendingFeedback } from './discord-feedback'
import { generatePulseSection } from './family-pulse'

const BOT_NAME = process.env.BOT_NAME || 'BMO'

interface CalendarEvent {
  id: string
  title: string
  start: string
  end?: string
  allDay?: boolean
  calendar?: string
  tags?: string[]
}

interface CalendarData {
  events: CalendarEvent[]
}

interface BillItem {
  vendor: string
  amount: number
  dueDate?: string
  status?: string
  category?: string
  owner?: string
}

interface LedgerData {
  items: BillItem[]
  summary?: { total: number }
}

interface SubscriptionItem {
  name: string
  cost: number | string
  billingCycle?: string
  status?: string
}

// ─── Data Loaders ────────────────────────────────────────────────────────────

async function loadCalendar(): Promise<CalendarEvent[]> {
  const data = await readJSON<CalendarData>('household-calendar.json', { events: [] })
  return data.events || []
}


async function loadLedger(): Promise<LedgerData> {
  const data = await readJSON<LedgerData>('financial-ledger.json', { items: [], summary: { total: 0 } })
  return data
}

async function loadSubscriptions(): Promise<SubscriptionItem[]> {
  const data = await readJSON<{ subscriptions: SubscriptionItem[] }>('cloud-subscriptions.json', { subscriptions: [] })
  return data.subscriptions || []
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNextWeekDates(): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() + 1) // tomorrow
  const end = new Date(start)
  end.setDate(end.getDate() + 7) // 7 days out
  return { start, end }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function filterEventsInRange(events: CalendarEvent[], start: Date, end: Date): CalendarEvent[] {
  return events.filter(e => {
    const eventDate = new Date(e.start)
    return eventDate >= start && eventDate <= end
  })
}

// ─── Learning Opportunities ──────────────────────────────────────────────────

interface LearningMoment {
  title: string
  content: string
  category: 'financial-literacy' | 'tech-literacy' | 'life-skills' | 'school'
}

function generateLearningMoments(
  goals: FamilyGoal[],
  subscriptions: SubscriptionItem[]
): LearningMoment[] {
  const moments: LearningMoment[] = []

  // Financial literacy — subscription awareness
  const knownSubs = subscriptions.filter(s => typeof s.cost === 'number' && s.cost > 0)
  if (knownSubs.length > 0) {
    const totalMonthly = knownSubs.reduce((sum, s) => sum + (typeof s.cost === 'number' ? s.cost : 0), 0)
    moments.push({
      title: 'Subscription Math',
      content: `Did you know? The family has ${knownSubs.length} active subscriptions. ` +
        `That's $${totalMonthly.toFixed(2)}/month — or $${(totalMonthly * 12).toFixed(2)} per year! ` +
        `Every subscription is a choice. If one isn't being used, canceling it is like finding free money.`,
      category: 'financial-literacy',
    })
  }

  // Goal progress as a learning moment
  const activeGoals = goals.filter(g => g.status === 'in-progress' && g.visibility === 'family')
  if (activeGoals.length > 0) {
    const goal = activeGoals[0]
    moments.push({
      title: 'Goal Tracking',
      content: `The family is working on: **${goal.title}**. ` +
        `Setting a goal and tracking progress is how successful people and families achieve big things. ` +
        `Small steps every day add up!`,
      category: 'life-skills',
    })
  }

  // Tech literacy — network awareness
  moments.push({
    title: 'How Your Internet Works',
    content: `Every device in our house connects through the Orbi router, which talks to the internet. ` +
      `Pi-hole is like a security guard — it blocks ads and unsafe websites before they even reach your device. ` +
      `That's why you don't see as many ads at home!`,
    category: 'tech-literacy',
  })

  return moments
}

// ─── Brief Generators ────────────────────────────────────────────────────────

/**
 * Generate the full "State of the Cutillos" weekly brief.
 * Returns two versions: family (kid-friendly) and parents (full details).
 */
export async function generateWeeklyBrief(): Promise<{
  familyBrief: string
  parentsBrief: string
  learningMoments: LearningMoment[]
}> {
  const [calendar, goals, subscriptions, pendingFeedback, pulseSection] = await Promise.all([
    loadCalendar(),
    getGoals(),
    loadSubscriptions(),
    getPendingFeedback(),
    generatePulseSection(),
  ])

  const { start, end } = getNextWeekDates()
  const upcomingEvents = filterEventsInRange(calendar, start, end)
  const goalSummary = await getGoalSummary()
  const learningMoments = generateLearningMoments(goals, subscriptions)
  const completedGoals = goals.filter(g => g.status === 'completed')
  const activeGoals = goals.filter(g => g.status === 'in-progress' || g.status === 'approved')

  // ── Family Brief (kid-friendly, no debt details) ──────────────────────────

  const familyLines: string[] = [
    `# 🎮 ${BOT_NAME}'s Weekly Report for the Cutillo Family`,
    `_Week of ${formatDate(start.toISOString())}_`,
    ``,
  ]

  // This Week's Story
  familyLines.push(`## This Week's Story`)
  if (upcomingEvents.length > 0) {
    familyLines.push(`It's going to be a busy week! Here's what's coming up:`)
    for (const evt of upcomingEvents.slice(0, 8)) {
      familyLines.push(`- **${formatDate(evt.start)}** — ${evt.title}`)
    }
  } else {
    familyLines.push(`A quieter week ahead — a good time to focus on our goals!`)
  }
  familyLines.push(``)

  // Goal Progress
  if (activeGoals.length > 0 || completedGoals.length > 0) {
    familyLines.push(`## Family Goals`)
    if (completedGoals.length > 0) {
      familyLines.push(`**Completed:** ${completedGoals.map(g => g.title).join(', ')}`)
    }
    for (const g of activeGoals.filter(g => g.visibility === 'family')) {
      familyLines.push(`- **${g.title}** — ${g.target}`)
    }
    familyLines.push(``)
  }

  // Wins & Celebrations
  familyLines.push(`## Wins & Celebrations`)
  if (completedGoals.length > 0) {
    familyLines.push(`We completed ${completedGoals.length} goal${completedGoals.length > 1 ? 's' : ''} — great teamwork!`)
  }
  familyLines.push(`Every week we show up and work together is a win.`)
  familyLines.push(``)

  // Family Pulse section
  if (pulseSection.familySection) {
    familyLines.push(pulseSection.familySection)
    familyLines.push(``)
  }

  // Learning moment (pick first one)
  if (learningMoments.length > 0) {
    const moment = learningMoments[0]
    familyLines.push(`## ${BOT_NAME}'s Did You Know?`)
    familyLines.push(`**${moment.title}:** ${moment.content}`)
    familyLines.push(``)
  }

  // ── Parents Brief (full financial detail) ─────────────────────────────────

  const parentLines: string[] = [
    `# 🎮 ${BOT_NAME}'s Weekly Report — Parents Edition`,
    `_Week of ${formatDate(start.toISOString())}_`,
    ``,
  ]

  // Calendar Preview
  parentLines.push(`## Calendar Preview`)
  if (upcomingEvents.length > 0) {
    for (const evt of upcomingEvents) {
      const tags = evt.tags?.length ? ` [${evt.tags.join(', ')}]` : ''
      parentLines.push(`- **${formatDate(evt.start)}** — ${evt.title}${tags}`)
    }
  } else {
    parentLines.push(`No events scheduled for the coming week.`)
  }
  parentLines.push(``)

  // Financial Snapshot
  parentLines.push(`## Financial Snapshot`)
  const financialGoals = goals.filter(g => g.category === 'financial')
  if (financialGoals.length > 0) {
    for (const g of financialGoals) {
      const progress = g.currentValue !== null
        ? `Current: ${g.currentValue} ${g.unit} (target: ${g.targetValue} ${g.unit})`
        : `Not yet tracked`
      parentLines.push(`- **${g.title}:** ${progress}`)
    }
  }
  const subTotal = subscriptions
    .filter(s => typeof s.cost === 'number')
    .reduce((sum, s) => sum + (typeof s.cost === 'number' ? s.cost : 0), 0)
  parentLines.push(`- **Subscriptions:** $${subTotal.toFixed(2)}/mo across ${subscriptions.length} services`)
  parentLines.push(``)

  // Goal Progress (all goals, including parent-only)
  parentLines.push(`## Goal Progress`)
  parentLines.push(goalSummary || '_No goals set yet._')
  parentLines.push(``)

  // Pending Feedback
  if (pendingFeedback.length > 0) {
    parentLines.push(`## Pending Feedback`)
    parentLines.push(`${pendingFeedback.length} feedback request(s) still waiting for responses.`)
    parentLines.push(``)
  }

  // Family Pulse — parents detailed
  if (pulseSection.parentsSection) {
    parentLines.push(pulseSection.parentsSection)
    parentLines.push(``)
  }

  // Action Items
  parentLines.push(`## Action Items This Week`)
  const proposedGoals = goals.filter(g => g.status === 'proposed')
  if (proposedGoals.length > 0) {
    parentLines.push(`- **Review ${proposedGoals.length} proposed goal(s):** ${proposedGoals.map(g => g.title).join(', ')}`)
  }
  if (pendingFeedback.length > 0) {
    parentLines.push(`- **Complete ${pendingFeedback.length} pending feedback request(s)**`)
  }
  const unknownSubs = subscriptions.filter(s => s.cost === 'unknown' || s.status === 'unknown')
  if (unknownSubs.length > 0) {
    parentLines.push(`- **Audit ${unknownSubs.length} unknown subscription(s):** ${unknownSubs.map(s => s.name).join(', ')}`)
  }
  parentLines.push(``)

  return {
    familyBrief: familyLines.join('\n'),
    parentsBrief: parentLines.join('\n'),
    learningMoments,
  }
}

/**
 * Generate a short daily digest for key channels.
 * Returns channel → content pairs.
 */
export async function generateDailyDigest(): Promise<Record<string, string>> {
  const [calendar, goals] = await Promise.all([
    loadCalendar(),
    getGoals(),
  ])

  const digest: Record<string, string> = {}
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // Calendar: today's events
  const todayEvents = calendar.filter(e => {
    const d = new Date(e.start)
    return d.toDateString() === today.toDateString()
  })
  const tomorrowEvents = calendar.filter(e => {
    const d = new Date(e.start)
    return d.toDateString() === tomorrow.toDateString()
  })

  if (todayEvents.length > 0 || tomorrowEvents.length > 0) {
    const lines = [`**Daily Calendar — ${formatDate(today.toISOString())}**`, ``]
    if (todayEvents.length > 0) {
      lines.push(`**Today:**`)
      todayEvents.forEach(e => lines.push(`- ${e.title}`))
    }
    if (tomorrowEvents.length > 0) {
      lines.push(`**Tomorrow:**`)
      tomorrowEvents.forEach(e => lines.push(`- ${e.title}`))
    }
    digest['calendar'] = lines.join('\n')
  }

  // Goals: any milestones due today
  const activeGoals = goals.filter(g => g.status === 'in-progress')
  const dueCheckpoints = activeGoals.filter(g =>
    g.checkpoints.some(cp =>
      cp.date === today.toISOString().split('T')[0] && cp.actual === null
    )
  )
  if (dueCheckpoints.length > 0) {
    const lines = [`**Goal Checkpoints Due Today:**`, ``]
    dueCheckpoints.forEach(g => lines.push(`- **${g.title}** — checkpoint due`))
    digest['announcements'] = lines.join('\n')
  }

  return digest
}
