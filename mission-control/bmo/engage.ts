/**
 * engage.ts — BMO's REAL engagement system
 *
 * No fluff. Every message uses actual data, delivers actual insights,
 * and asks questions that fill actual profile gaps.
 *
 * Survey responses update family-profiles.json and family-goals.json.
 *
 * Run: npx tsx bmo/engage.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import { setPending, buildDiscordIdMap, ConversationType } from './conversation'

dotenv.config({ path: path.join(process.cwd(), '..', '.env.local') })
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

// Build Discord ID → member ID map for setPending
buildDiscordIdMap()

const TOKEN = process.env.DISCORD_BOT_TOKEN!
const HEADERS = {
  Authorization: `Bot ${TOKEN}`,
  'Content-Type': 'application/json',
}
const DATA_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data'

// Discord user IDs for registering pending conversations
const FAMILY_IDS: Record<string, string> = {
  mike: process.env.DISCORD_MIKE_ID || '',
  erin: process.env.DISCORD_ERIN_ID || '',
  liam: process.env.DISCORD_LIAM_ID || '',
  clara: process.env.DISCORD_CLARA_ID || '',
}

async function readJSON(file: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf-8'))
  } catch { return null }
}

/** Post a message and return the message ID for pending conversation tracking */
async function postMessage(channelId: string, content: string): Promise<{ success: boolean; messageId?: string }> {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const err = await res.json()
    console.log(`    ❌ ${res.status}: ${err.message}`)
    return { success: false }
  }
  const msg = await res.json()
  return { success: true, messageId: msg.id }
}

/** Register a pending conversation for each family member who should respond */
async function registerPending(
  channelId: string,
  messageId: string,
  memberIds: string[],
  type: ConversationType,
  questionText: string,
  options: Record<string, string>,
  actionPayload: Record<string, any>
): Promise<void> {
  for (const memberId of memberIds) {
    const discordId = FAMILY_IDS[memberId]
    if (!discordId) continue

    await setPending({
      userId: discordId,
      memberId,
      channelId,
      type,
      questionText,
      options,
      actionPayload,
      bmoMessageId: messageId,
    })
  }
}

// ─── Build REAL messages from REAL data ──────────────────────────────────────

async function buildScreenTimeMessage(): Promise<string> {
  const data = await readJSON('pc-activity.json')
  if (!data) return ''

  const devices = data.devices || {}
  const reports = data.reports || []

  const lines: string[] = [
    `🎮 **Screen Time — Live Status Report**`,
    ``,
  ]

  for (const [hostname, dev] of Object.entries(devices) as any[]) {
    const msSince = Date.now() - new Date(dev.lastSeen).getTime()
    const online = msSince < 10 * 60 * 1000
    const app = (dev.lastForeground || 'unknown').replace(/\.exe$/i, '')
    const idle = dev.idleSeconds > 300

    if (online) {
      lines.push(`🟢 **${dev.displayName || hostname}** (${dev.lastUser}) — Currently on **${app}**${idle ? ' (idle)' : ''}`)
    } else {
      const ago = Math.round(msSince / 60000)
      lines.push(`⚫ **${dev.displayName || hostname}** (${dev.lastUser}) — Offline (last seen ${ago > 60 ? Math.round(ago/60) + 'h' : ago + 'min'} ago)`)
    }
  }

  // Calculate today's usage from reports
  const today = new Date().toISOString().split('T')[0]
  const todayReports = reports.filter((r: any) => r.timestamp?.startsWith(today))

  const userTime: Record<string, Record<string, number>> = {}
  for (const report of todayReports) {
    const user = report.windowsUser
    if (!user || !report.foreground || report.idleSeconds > 300) continue
    if (!userTime[user]) userTime[user] = {}
    const app = report.foreground.processName.replace(/\.exe$/i, '')
    userTime[user][app] = (userTime[user][app] || 0) + 5
  }

  if (Object.keys(userTime).length > 0) {
    lines.push(``, `📊 **Today's Usage:**`)
    for (const [user, apps] of Object.entries(userTime)) {
      const totalMin = Object.values(apps).reduce((a, b) => a + b, 0)
      const topApps = Object.entries(apps).sort(([,a],[,b]) => b - a).slice(0, 3)
      const topStr = topApps.map(([name, min]) => `${name} (${(min/60).toFixed(1)}h)`).join(', ')
      lines.push(`• **${user}**: ${(totalMin/60).toFixed(1)}h total — Top: ${topStr}`)
    }
  }

  // The real question — ties to the curfew goal
  lines.push(``, `───────────────────────────`)
  lines.push(`📋 **Family Decision Needed:**`)
  lines.push(`There's a proposed goal to enforce weekday curfews — Liam at 9 PM, Clara at 8 PM. BMO can auto-block devices at curfew time.`)
  lines.push(``)
  lines.push(`Should we activate this?`)
  lines.push(`1️⃣ Yes — enforce curfews starting this week`)
  lines.push(`2️⃣ Yes but adjust the times (reply with your times)`)
  lines.push(`3️⃣ Not yet — let's discuss first`)
  lines.push(`4️⃣ No auto-blocking — just send reminders`)

  return lines.join('\n')
}

async function buildBillsMessage(): Promise<string> {
  const ledger = await readJSON('financial-ledger.json')
  if (!ledger?.items) return ''

  const today = new Date()
  const dayOfMonth = today.getDate()

  // Find bills coming up in the next 7 days
  const upcoming = ledger.items
    .filter((item: any) => {
      if (!item.billing_day) return false
      const daysUntil = item.billing_day >= dayOfMonth
        ? item.billing_day - dayOfMonth
        : (30 - dayOfMonth) + item.billing_day
      return daysUntil <= 7 && item.category === 'recurring_fixed'
    })
    .slice(0, 8)

  const lines: string[] = [
    `💰 **Bills — Real Financial Snapshot**`,
    ``,
    `📅 Today is April ${dayOfMonth}. Here's what's on the radar:`,
    ``,
  ]

  if (upcoming.length > 0) {
    lines.push(`**Coming up in the next 7 days:**`)
    for (const bill of upcoming) {
      const amount = bill.amount || bill.monthly_estimate
      const amtStr = amount ? ` — $${Number(amount).toLocaleString()}` : ''
      lines.push(`• **${bill.vendor}**${amtStr} (bills on the ${bill.billing_day}th)`)
    }
  } else {
    lines.push(`No bills due in the next 7 days. 🎉`)
  }

  // Credit card goal
  const goals = await readJSON('family-goals.json')
  const ccGoal = goals?.goals?.find((g: any) => g.id === 'goal_cc_paydown')
  if (ccGoal) {
    lines.push(``)
    lines.push(`💳 **BofA Credit Card Paydown Goal:**`)
    lines.push(`Current balance: **$${ccGoal.currentValue?.toLocaleString()}**`)
    lines.push(`Target: **$${ccGoal.targetValue?.toLocaleString()}** by July 2026`)
    lines.push(`Trend: $10,098 (Jan) → $9,998 (Feb) → $9,899 (Mar)`)
    lines.push(`Progress: Moving in the right direction — $199 paid down in 3 months.`)
  }

  // Checking buffer goal
  const bufferGoal = goals?.goals?.find((g: any) => g.id === 'goal_checking_buffer')
  if (bufferGoal) {
    lines.push(``)
    lines.push(`⚠️ **Checking Account Warning:**`)
    lines.push(`Both checking accounts dropped below $100 in early April.`)
    lines.push(`Goal: Keep combined balance above $500.`)
  }

  lines.push(``, `───────────────────────────`)
  lines.push(`**Mike & Erin — BMO needs your input:**`)
  lines.push(`These goals are **proposed but not approved**. Should I track them?`)
  lines.push(`1️⃣ Yes — activate both goals, send me weekly progress`)
  lines.push(`2️⃣ Activate the CC paydown only`)
  lines.push(`3️⃣ Activate the checking buffer only`)
  lines.push(`4️⃣ Let me review the numbers first — show me the full ledger`)

  return lines.join('\n')
}

async function buildSubscriptionsMessage(): Promise<string> {
  const subs = await readJSON('cloud-subscriptions.json')
  if (!subs?.subscriptions) return ''

  const active = subs.subscriptions.filter((s: any) => s.status === 'active')
  const unknown = subs.subscriptions.filter((s: any) => s.status === 'unknown')
  const totalMonthly = active.reduce((sum: number, s: any) => sum + (s.cost_monthly || 0), 0)

  const lines: string[] = [
    `📦 **Subscriptions — The Real Numbers**`,
    ``,
    `**Active subscriptions:** ${active.length}`,
    `**Monthly cost:** $${totalMonthly.toFixed(2)}`,
    ``,
  ]

  for (const s of active) {
    lines.push(`• **${s.name}** — $${s.cost_monthly?.toFixed(2) || '?'}/mo (${s.category})`)
  }

  if (unknown.length > 0) {
    lines.push(``, `⚠️ **Unknown status — BMO can't find the cost:**`)
    for (const s of unknown) {
      lines.push(`• **${s.name}** — cost unknown, billing day unknown`)
    }
    lines.push(``)
    lines.push(`**Action needed:** Do we still use these? Reply:`)
    lines.push(`1️⃣ Keep both — I'll find the costs`)
    lines.push(`2️⃣ Cancel Nintendo Online`)
    lines.push(`3️⃣ Cancel Uber Eats Pass`)
    lines.push(`4️⃣ Cancel both — we don't use them`)
  }

  return lines.join('\n')
}

async function buildJobsMessage(): Promise<string> {
  const jobs = await readJSON('job-pipeline.json')
  if (!jobs || !Array.isArray(jobs)) return ''

  const total = jobs.length
  const lines: string[] = [
    `💼 **Job Pipeline — Current State**`,
    ``,
    `**${total} roles** in the pipeline.`,
    ``,
  ]

  // Show first few with actual data
  const sample = jobs.slice(0, 5)
  for (const job of sample) {
    const title = job.title || 'Untitled'
    const company = job.company || 'Unknown'
    const remote = job.remote ? '🌐 Remote' : '🏢 On-site'
    lines.push(`• **${title}** @ ${company} ${remote}`)
  }

  if (total > 5) {
    lines.push(`• ...and ${total - 5} more`)
  }

  lines.push(``, `───────────────────────────`)
  lines.push(`**Mike — Pipeline health check:**`)
  lines.push(`Are you actively applying, or is this list stale?`)
  lines.push(`1️⃣ Actively applying — keep tracking`)
  lines.push(`2️⃣ Paused — clear the pipeline and start fresh when ready`)
  lines.push(`3️⃣ Need help — BMO should surface better-matched roles`)
  lines.push(`4️⃣ Got a lead — let me update you on something`)

  return lines.join('\n')
}

async function buildCalendarMessage(): Promise<string> {
  const cal = await readJSON('household-calendar.json')
  if (!cal) return ''

  const events = cal.household || cal.events || []
  const today = new Date().toISOString().split('T')[0]

  const lines: string[] = [
    `📅 **Calendar — Today & This Week**`,
    ``,
  ]

  if (Array.isArray(events) && events.length > 0) {
    // The calendar data has people with connected sources
    lines.push(`**Connected calendars:**`)
    for (const person of events) {
      if (person.name && person.sources) {
        const connected = person.sources.filter((s: any) => s.status === 'connected').length
        const total = person.sources.length
        lines.push(`• **${person.name}** — ${connected}/${total} calendars synced`)
      }
    }
  }

  lines.push(``, `───────────────────────────`)
  lines.push(`**Family check-in:**`)
  lines.push(`What's the ONE thing everyone needs to know about this week?`)
  lines.push(`Reply with your answer — BMO will compile a weekly brief for the family.`)

  return lines.join('\n')
}

async function buildCloudMessage(): Promise<string> {
  const cloud = await readJSON('cloud-accounts.json')
  if (!cloud?.people) return ''

  const lines: string[] = [
    `☁️ **Cloud Storage — Actual Account Status**`,
    ``,
  ]

  for (const person of cloud.people) {
    lines.push(`**${person.name}:**`)
    for (const acct of person.accounts || []) {
      const used = acct.used_gb ? `${acct.used_gb} GB used` : 'usage unknown'
      const total = acct.total_gb ? `of ${acct.total_gb} GB` : ''
      const cost = acct.plan_cost || ''
      lines.push(`• ${acct.service} (${acct.email}) — ${acct.plan || 'unknown plan'}`)
      lines.push(`  ${used} ${total} ${cost ? `| ${cost}` : ''} | Status: ${acct.status}`)
    }
    lines.push(``)
  }

  lines.push(`───────────────────────────`)
  lines.push(`**Storage audit question:**`)
  lines.push(`The data migration is focused on legacy content already on ClawBotLoot.`)
  lines.push(`Are there any accounts here that should be prioritized or can be downgraded?`)
  lines.push(`Reply with the account name and what you'd like to do.`)

  return lines.join('\n')
}

async function buildSchoolMessage(): Promise<string> {
  const profiles = await readJSON('family-profiles.json')
  const liam = profiles?.profiles?.liam
  const clara = profiles?.profiles?.clara

  const lines: string[] = [
    `📚 **School — Getting to Know Liam & Clara**`,
    ``,
    `BMO wants to actually help with school — but I need to know more first.`,
    `Right now, your profiles are empty. Let's fix that.`,
    ``,
  ]

  // Liam's profile gaps
  if (liam) {
    const gaps = []
    if (!liam.favoriteSubjects?.length) gaps.push('favorite subjects')
    if (!liam.strengths?.length) gaps.push('strengths')
    if (!liam.interests?.length) gaps.push('interests')
    if (!liam.dreams?.length) gaps.push('dreams')
    lines.push(`🧒 **Liam** — BMO doesn't know your: ${gaps.join(', ')}`)
  }

  if (clara) {
    const gaps = []
    if (!clara.favoriteSubjects?.length) gaps.push('favorite subjects')
    if (!clara.strengths?.length) gaps.push('strengths')
    if (!clara.interests?.length) gaps.push('interests')
    if (!clara.dreams?.length) gaps.push('dreams')
    lines.push(`👧 **Clara** — BMO doesn't know your: ${gaps.join(', ')}`)
  }

  lines.push(``)
  lines.push(`───────────────────────────`)
  lines.push(`**Liam — what's your favorite subject in school?**`)
  lines.push(`1️⃣ Math`)
  lines.push(`2️⃣ Science`)
  lines.push(`3️⃣ English / Reading`)
  lines.push(`4️⃣ History / Social Studies`)
  lines.push(`5️⃣ Art / Music / Gym`)
  lines.push(`6️⃣ Computer stuff / Tech`)
  lines.push(`7️⃣ Something else — tell me!`)
  lines.push(``)
  lines.push(`**Clara — same question for you!** What's your favorite?`)
  lines.push(``)
  lines.push(`(BMO saves your answers and uses them to help you with homework, find cool resources, and celebrate your wins.)`)

  return lines.join('\n')
}

async function buildProfileOnboardingMessage(): Promise<string> {
  const profiles = await readJSON('family-profiles.json')
  if (!profiles?.profiles) return ''

  const lines: string[] = [
    `💬 **General Chat — BMO Wants to Know Everyone Better**`,
    ``,
    `I'm not a generic chatbot. I want to be YOUR companion. But right now I barely know you.`,
    `Every answer you give me gets saved and makes me smarter about what YOU need.`,
    ``,
    `**Quick round — everyone answer:**`,
    ``,
    `🎮 **What's the one thing you're most excited about right now?**`,
    `(A game, a project, a trip, a show — anything!)`,
    ``,
    `Just type your answer. BMO remembers everything. 💚`,
  ]

  return lines.join('\n')
}

async function buildAnnouncementsMessage(): Promise<string> {
  const goals = await readJSON('family-goals.json')
  if (!goals?.goals) return ''

  const proposed = goals.goals.filter((g: any) => g.status === 'proposed')

  const lines: string[] = [
    `📢 **Announcements — Family Goals Need Approval**`,
    ``,
    `BMO has analyzed the family's data and proposed **${proposed.length} goals**. None have been approved yet.`,
    ``,
  ]

  for (const goal of proposed) {
    const vis = goal.visibility === 'parents' ? '🔒 Parents only' : '👨‍👩‍👧‍👦 Family'
    lines.push(`**${goal.title}** (${vis})`)
    lines.push(`${goal.description}`)
    lines.push(`Target: ${goal.target}`)
    lines.push(``)
  }

  lines.push(`───────────────────────────`)
  lines.push(`**Mike & Erin — which goals should we activate?**`)
  lines.push(`1️⃣ Activate all of them`)
  lines.push(`2️⃣ Let me pick individually — list them again with numbers`)
  lines.push(`3️⃣ None for now — need to discuss as a family first`)
  lines.push(`4️⃣ BMO, suggest different goals`)

  return lines.join('\n')
}

async function buildNetworkMessage(): Promise<string> {
  return [
    `🤝 **Networking — Building Real Connections**`,
    ``,
    `BMO can track your professional network, but I need a starting point.`,
    ``,
    `**Mike — who are the 3 most important professional contacts you should stay in touch with?**`,
    ``,
    `Reply with names (and optionally company/role). BMO will:`,
    `• Remind you to reach out on a regular cadence`,
    `• Track when you last connected`,
    `• Suggest talking points based on their industry`,
    ``,
    `This isn't busywork — warm networks land jobs. Let's build yours.`,
  ].join('\n')
}

async function buildSmartHomeMessage(): Promise<string> {
  const devices = await readJSON('family-intel-devices.json')
  const deviceCount = Array.isArray(devices) ? devices.length : 0

  return [
    `🏠 **Smart Home — Network Intelligence**`,
    ``,
    `BMO has detected **${deviceCount || 'some'}** devices on the home network.`,
    ``,
    `**Quick audit — do you know everything on your network?**`,
    `1️⃣ Yes — I know every device`,
    `2️⃣ Mostly — there might be some surprises`,
    `3️⃣ No idea — show me everything`,
    `4️⃣ I'm worried about unknown devices`,
    ``,
    `If you pick 3 or 4, BMO will run a full device audit and flag anything suspicious.`,
  ].join('\n')
}

async function buildResumeMessage(): Promise<string> {
  return [
    `📄 **Resume Workshop — 4 Variants Ready**`,
    ``,
    `Current resume arsenal:`,
    `• **AI-First** — Leads with AI/ML experience`,
    `• **Implementation-First** — Leads with delivery & consulting`,
    `• **Combined** — Full-spectrum`,
    `• **Education/CommonLit** — EdTech focused`,
    ``,
    `GitHub profile is fully built (**mikecutillo**). LinkedIn + portfolio are next.`,
    ``,
    `**Mike — what's the priority?**`,
    `1️⃣ LinkedIn needs work — help me optimize it`,
    `2️⃣ Portfolio site — let's build one`,
    `3️⃣ Tailor a resume for a specific role — paste the job description`,
    `4️⃣ I'm good on resumes — focus on applications`,
  ].join('\n')
}

async function buildContentMessage(): Promise<string> {
  return [
    `🎨 **Content Studio — What's Worth Creating?**`,
    ``,
    `BMO can help draft content, but only if it actually serves a purpose.`,
    ``,
    `**What would move the needle most right now?**`,
    `1️⃣ LinkedIn posts about my AI/tech projects (builds professional brand)`,
    `2️⃣ Technical blog posts (demonstrates expertise for job search)`,
    `3️⃣ Family updates / newsletter (keeps extended family in the loop)`,
    `4️⃣ Nothing right now — job search is the priority`,
    ``,
    `Be honest — BMO won't waste your time on content nobody reads.`,
  ].join('\n')
}

async function buildNewsMessage(): Promise<string> {
  const news = await readJSON('news-intel.json')
  const count = news?.items?.length || news?.stories?.length || 0

  return [
    `📰 **News Feed — Curated Intelligence**`,
    ``,
    count > 0 ? `BMO has **${count}** news items indexed.` : `BMO's news feed needs configuration.`,
    ``,
    `**What topics should BMO track for you?**`,
    `1️⃣ AI & machine learning (career relevant)`,
    `2️⃣ EdTech & education industry`,
    `3️⃣ Job market / tech hiring trends`,
    `4️⃣ Local NJ news`,
    `5️⃣ All of the above`,
    `6️⃣ Custom — tell me your topics`,
    ``,
    `BMO will curate a daily digest based on your picks.`,
  ].join('\n')
}

async function buildFinancialDigestMessage(): Promise<string> {
  const ledger = await readJSON('financial-ledger.json')
  if (!ledger?.summary) return ''

  const s = ledger.summary
  return [
    `📊 **Financial Digest — The Big Picture**`,
    ``,
    `**Ledger scan:** ${s.total_items} items across 3 email accounts`,
    `**Estimated monthly outflow:** $${s.likely_monthly?.toLocaleString()}`,
    ``,
    `Breakdown:`,
    `• Recurring fixed: ${s.by_category?.recurring_fixed?.count || 0} items — $${s.by_category?.recurring_fixed?.monthly_total?.toLocaleString() || '?'}/mo`,
    `• Subscriptions: ${s.by_category?.subscription?.count || 0} items — $${s.by_category?.subscription?.monthly_total?.toLocaleString() || '?'}/mo`,
    `• One-time: ${s.by_category?.one_time?.count || 0} items — $${s.by_category?.one_time?.monthly_total?.toLocaleString() || '?'}/mo`,
    ``,
    `By owner:`,
    `• Mike: $${s.by_owner?.mike?.monthly_total?.toLocaleString() || '?'}/mo (${s.by_owner?.mike?.count || 0} items)`,
    `• Erin: $${s.by_owner?.erin?.monthly_total?.toLocaleString() || '?'}/mo (${s.by_owner?.erin?.count || 0} items)`,
    ``,
    `⚠️ **Note:** Many items are "unverified" — BMO estimated from email patterns.`,
    ``,
    `**Should BMO send a weekly financial digest every Monday?**`,
    `1️⃣ Yes — Monday morning digest`,
    `2️⃣ Yes — but bi-weekly`,
    `3️⃣ Only alert me when something looks wrong`,
    `4️⃣ Don't automate this — I'll ask when I need it`,
  ].join('\n')
}

async function buildCashFlowMessage(): Promise<string> {
  const goals = await readJSON('family-goals.json')
  const bufferGoal = goals?.goals?.find((g: any) => g.id === 'goal_checking_buffer')

  return [
    `💵 **Cash Flow — Where the Money Goes**`,
    ``,
    bufferGoal
      ? `⚠️ **Alert:** Both checking accounts (Mike 6103 & Erin 7420) dropped below $100 in early April. Goal is to keep combined balance above $500.`
      : `Cash flow tracking is active.`,
    ``,
    `**What would help most?**`,
    `1️⃣ Weekly income vs. expenses breakdown`,
    `2️⃣ Alert me when any account drops below $200`,
    `3️⃣ Show me where we're overspending`,
    `4️⃣ Track progress toward the savings buffer goal`,
  ].join('\n')
}

async function buildApplicationsMessage(): Promise<string> {
  return [
    `📝 **Applications — Tracking Every Submission**`,
    ``,
    `BMO logs applications here. To make this useful:`,
    ``,
    `**Mike — when you apply somewhere, drop the details here:**`,
    `• Company name`,
    `• Role title`,
    `• Link (if you have it)`,
    `• How you feel about it (excited / meh / safety net)`,
    ``,
    `BMO will track response rates, follow-up timing, and help you spot patterns in what's working.`,
    ``,
    `**Have you applied anywhere this week?**`,
    `Reply here and BMO will log it.`,
  ].join('\n')
}

async function buildMiscMessage(): Promise<string> {
  return [
    `📌 **Misc Updates — The Catch-All**`,
    ``,
    `Anything that doesn't fit elsewhere goes here. But BMO has a question:`,
    ``,
    `**Is there a topic you wish had its own channel?**`,
    `Ideas: #health, #cooking, #family-trips, #homework-help, #movie-night`,
    ``,
    `Reply with your idea. If multiple people want it, BMO will create it.`,
  ].join('\n')
}

async function buildTurbodotLogMessage(): Promise<string> {
  return [
    `🤖 **TurboDot Log — System Activity**`,
    ``,
    `This is BMO's engine room. I'll log:`,
    `• Every automated task that runs`,
    `• Data collection events`,
    `• Errors and issues`,
    `• Survey responses processed`,
    `• Profile updates`,
    ``,
    `📊 **Current system status:**`,
    `• PC monitoring: 3 devices registered`,
    `• Email digest: configured for 3 Gmail accounts`,
    `• Discord: BMO active in ${Object.keys(CHANNEL_BUILDERS).length} channels`,
    `• Family profiles: 4 profiles, 0 fully onboarded`,
    `• Goals: ${(await readJSON('family-goals.json'))?.goals?.length || 0} proposed, 0 approved`,
    ``,
    `BMO will post here when things happen. No action needed from you.`,
  ].join('\n')
}

// ─── Channel → Builder map ──────────────────────────────────────────────────

const CHANNEL_BUILDERS: Record<string, () => Promise<string>> = {
  'general':           buildProfileOnboardingMessage,
  'general-chat':      buildProfileOnboardingMessage,
  'announcements':     buildAnnouncementsMessage,
  'screen-time':       buildScreenTimeMessage,
  'school':            buildSchoolMessage,
  'bills-due':         buildBillsMessage,
  'cash-flow':         buildCashFlowMessage,
  'subscriptions':     buildSubscriptionsMessage,
  'financial-digest':  buildFinancialDigestMessage,
  'job-pipeline':      buildJobsMessage,
  'applications':      buildApplicationsMessage,
  'resume-workshop':   buildResumeMessage,
  'network':           buildNetworkMessage,
  'cloud-storage':     buildCloudMessage,
  'smart-home':        buildSmartHomeMessage,
  'turbodot-log':      buildTurbodotLogMessage,
  'news-feed':         buildNewsMessage,
  'content-studi':     buildContentMessage,
  'misc-updates':      buildMiscMessage,
  'calendar':          buildCalendarMessage,
}

// ─── Channel → Pending conversation config ─────────────────────────────────
// Maps channel names to what pending conversations to register after posting

interface PendingConfig {
  type: ConversationType
  respondents: string[]  // which family members should respond
  options: Record<string, string>
  actionPayload: Record<string, any>
}

const CHANNEL_PENDING: Record<string, PendingConfig> = {
  'screen-time': {
    type: 'curfew',
    respondents: ['mike', 'erin'],
    options: { '1': 'Enforce curfews now', '2': 'Adjust times', '3': 'Discuss first', '4': 'Reminders only' },
    actionPayload: { goalId: 'goal_screen_time_weekday' },
  },
  'announcements': {
    type: 'goal-approval',
    respondents: ['mike', 'erin'],
    options: { '1': 'Activate all', '2': 'Pick individually', '3': 'Discuss first', '4': 'Suggest different goals' },
    actionPayload: { goalIds: [] }, // filled dynamically
  },
  'subscriptions': {
    type: 'subscription-audit',
    respondents: ['mike', 'erin'],
    options: { '1': 'Keep both', '2': 'Cancel Nintendo', '3': 'Cancel Uber Eats', '4': 'Cancel both' },
    actionPayload: {},
  },
  'bills-due': {
    type: 'survey',
    respondents: ['mike', 'erin'],
    options: { '1': 'Activate both goals', '2': 'CC paydown only', '3': 'Checking buffer only', '4': 'Show full ledger' },
    actionPayload: { surveyType: 'goal-activation', channelName: 'bills-due' },
  },
  'school': {
    type: 'onboarding',
    respondents: ['liam', 'clara'],
    options: { '1': 'Math', '2': 'Science', '3': 'English / Reading', '4': 'History / Social Studies', '5': 'Art / Music / Gym', '6': 'Computer stuff / Tech', '7': 'Something else' },
    actionPayload: { field: 'favoriteSubjects', parseAs: 'list', questionIndex: 0, totalQuestions: 7 },
  },
  'general': {
    type: 'freeform',
    respondents: ['mike', 'erin', 'liam', 'clara'],
    options: {},
    actionPayload: { context: 'excited-about', channelName: 'general' },
  },
  'general-chat': {
    type: 'freeform',
    respondents: ['mike', 'erin', 'liam', 'clara'],
    options: {},
    actionPayload: { context: 'excited-about', channelName: 'general-chat' },
  },
  'financial-digest': {
    type: 'survey',
    respondents: ['mike', 'erin'],
    options: { '1': 'Monday morning digest', '2': 'Bi-weekly', '3': 'Only alerts', '4': 'On demand only' },
    actionPayload: { surveyType: 'digest-frequency', channelName: 'financial-digest' },
  },
  'cash-flow': {
    type: 'survey',
    respondents: ['mike', 'erin'],
    options: { '1': 'Weekly breakdown', '2': 'Low balance alerts', '3': 'Overspending analysis', '4': 'Savings progress' },
    actionPayload: { surveyType: 'cashflow-preference', channelName: 'cash-flow' },
  },
  'job-pipeline': {
    type: 'survey',
    respondents: ['mike'],
    options: { '1': 'Actively applying', '2': 'Clear and restart', '3': 'Surface better roles', '4': 'Got a lead' },
    actionPayload: { surveyType: 'job-status', channelName: 'job-pipeline' },
  },
  'resume-workshop': {
    type: 'survey',
    respondents: ['mike'],
    options: { '1': 'LinkedIn optimization', '2': 'Portfolio site', '3': 'Tailor for a role', '4': 'Focus on applications' },
    actionPayload: { surveyType: 'resume-priority', channelName: 'resume-workshop' },
  },
  'smart-home': {
    type: 'survey',
    respondents: ['mike', 'erin'],
    options: { '1': 'Know every device', '2': 'Mostly', '3': 'Show me everything', '4': 'Worried about unknown devices' },
    actionPayload: { surveyType: 'network-audit', channelName: 'smart-home' },
  },
  'news-feed': {
    type: 'survey',
    respondents: ['mike'],
    options: { '1': 'AI & ML', '2': 'EdTech', '3': 'Job market', '4': 'Local NJ', '5': 'All of the above', '6': 'Custom topics' },
    actionPayload: { surveyType: 'news-topics', channelName: 'news-feed' },
  },
  'content-studi': {
    type: 'survey',
    respondents: ['mike'],
    options: { '1': 'LinkedIn posts', '2': 'Technical blog', '3': 'Family newsletter', '4': 'Nothing right now' },
    actionPayload: { surveyType: 'content-priority', channelName: 'content-studi' },
  },
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎮 BMO Real Engagement — Posting data-driven messages + registering pending conversations...\n')

  const CUTILLO_HQ = '1492789209361154210'

  // Get goal IDs for announcements
  const goals = await readJSON('family-goals.json')
  if (goals?.goals && CHANNEL_PENDING['announcements']) {
    CHANNEL_PENDING['announcements'].actionPayload.goalIds =
      goals.goals.filter((g: any) => g.status === 'proposed').map((g: any) => g.id)
  }

  const chRes = await fetch(`https://discord.com/api/v10/guilds/${CUTILLO_HQ}/channels`, {
    headers: HEADERS,
  })
  const channels = await chRes.json()
  const textChannels = channels.filter((c: any) => c.type === 0)

  let success = 0
  let fail = 0
  let pendingRegistered = 0

  for (const channel of textChannels) {
    const builder = CHANNEL_BUILDERS[channel.name]
    if (!builder) {
      console.log(`  ⏭️  #${channel.name} — no builder`)
      continue
    }

    try {
      const content = await builder()
      if (!content) {
        console.log(`  ⏭️  #${channel.name} — no data available`)
        continue
      }

      // Post the message (handle splitting for long content)
      let lastMessageId: string | undefined
      if (content.length <= 2000) {
        console.log(`  📨 #${channel.name}...`)
        const result = await postMessage(channel.id, content)
        if (result.success) {
          console.log(`     ✅ Sent (${content.length} chars)`)
          success++
          lastMessageId = result.messageId
        } else { fail++ }
      } else {
        const parts = content.split('───────────────────────────')
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i].trim()
          if (!part) continue
          console.log(`  📨 #${channel.name} (part ${i+1})...`)
          const result = await postMessage(channel.id, part)
          if (result.success) {
            console.log(`     ✅ Sent`)
            success++
            lastMessageId = result.messageId // Track the last (survey) message
          } else { fail++ }
          await new Promise(r => setTimeout(r, 1000))
        }
      }

      // Register pending conversations for this channel's survey
      const pendingConfig = CHANNEL_PENDING[channel.name]
      if (pendingConfig && lastMessageId) {
        for (const memberId of pendingConfig.respondents) {
          const discordId = FAMILY_IDS[memberId]
          if (!discordId) continue

          await setPending({
            userId: discordId,
            memberId,
            channelId: channel.id,
            type: pendingConfig.type,
            questionText: `Survey in #${channel.name}`,
            options: pendingConfig.options,
            actionPayload: { ...pendingConfig.actionPayload },
            bmoMessageId: lastMessageId,
          })
          pendingRegistered++
        }
        console.log(`     🔗 Registered ${pendingConfig.respondents.length} pending conversation(s)`)
      }
    } catch (err: any) {
      console.log(`  ❌ #${channel.name}: ${err.message}`)
      fail++
    }

    await new Promise(r => setTimeout(r, 1500))
  }

  console.log(`\n🎮 Done!`)
  console.log(`   ✅ ${success} messages sent`)
  console.log(`   🔗 ${pendingRegistered} pending conversations registered`)
  console.log(`   ❌ ${fail} failed`)
}

main().catch(console.error)

export { CHANNEL_BUILDERS, postMessage }
