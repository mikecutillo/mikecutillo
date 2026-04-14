/**
 * brain.ts — BMO's intelligence layer
 *
 * Processes incoming messages, determines intent, queries data,
 * and generates responses. Uses Claude API when available for
 * natural language understanding, falls back to pattern matching.
 */

import Anthropic from '@anthropic-ai/sdk'
import { BMO_SYSTEM_PROMPT, TEMPLATES, pickRandom } from './personality'
import * as data from './data'
import { logInteraction, getRecentInteractions, getMemorySummary } from './memory'

// ─── Intent Detection ───────────────────────────────────────────────────────

type Intent =
  | 'device-status'      // "is Liam online?" / "what's Liam doing?"
  | 'screen-time'        // "how much time did Liam spend gaming?"
  | 'top-apps'           // "what apps did Clara use today?"
  | 'browsing-history'   // "what was Liam watching?"
  | 'bills'              // "what bills are due?"
  | 'jobs'               // "how's the job search going?"
  | 'calendar'           // "what's on the calendar?"
  | 'cloud'              // "how's the cloud storage?"
  | 'goals'              // "what are the family goals?"
  | 'news'               // "what's in the news?"
  | 'greeting'           // "hey bmo" / "hello"
  | 'about-bmo'          // "who are you?" / "what can you do?"
  | 'general'            // anything else

const NAME_ALIASES: Record<string, string> = {
  liam: 'Liam',
  clara: 'Clara',
  mike: 'Mike',
  dad: 'Mike',
  mom: 'Erin',
  erin: 'Erin',
}

interface ParsedMessage {
  intent: Intent
  subject: string | null   // person being asked about
  timeWindow: number        // hours to look back
  raw: string
  channelName: string
}

function extractSubject(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [alias, name] of Object.entries(NAME_ALIASES)) {
    if (lower.includes(alias)) return name
  }
  return null
}

function extractTimeWindow(text: string): number {
  const lower = text.toLowerCase()
  if (/today|this morning|this afternoon|this evening/.test(lower)) return 24
  if (/yesterday/.test(lower)) return 48
  if (/this week|this weekend|past week/.test(lower)) return 168
  if (/(\d+)\s*hours?/.test(lower)) {
    const match = lower.match(/(\d+)\s*hours?/)
    return match ? parseInt(match[1]) : 24
  }
  if (/(\d+)\s*days?/.test(lower)) {
    const match = lower.match(/(\d+)\s*days?/)
    return match ? parseInt(match[1]) * 24 : 24
  }
  return 24 // default: last 24 hours
}

function detectIntent(text: string, channelName: string): Intent {
  const lower = text.toLowerCase()

  // Greetings
  if (/^(hey|hi|hello|yo|sup|what'?s? up|howdy|hiya)\b/i.test(lower) && lower.length < 30) {
    return 'greeting'
  }

  // About BMO
  if (/who are you|what can you do|what are you|help me|what do you know/i.test(lower)) {
    return 'about-bmo'
  }

  // Device status
  if (/is\s+\w+\s+(online|on|playing|doing|using|up)|what('?s| is)\s+\w+\s+(doing|playing|using|on|up to)/i.test(lower)) {
    return 'device-status'
  }
  if (/status|currently|right now|active/i.test(lower) && extractSubject(lower)) {
    return 'device-status'
  }

  // Screen time / usage
  if (/how much time|how long|hours? (of |spent |on )|screen\s*time|time spent|usage/i.test(lower)) {
    return 'screen-time'
  }
  if (/gaming|playing games/i.test(lower) && /how|much|long/i.test(lower)) {
    return 'screen-time'
  }

  // Top apps
  if (/what apps|top apps|most used|which apps|app usage/i.test(lower)) {
    return 'top-apps'
  }

  // Browsing history
  if (/watching|browsing|visited|browser|history|websites?|what.*watch/i.test(lower)) {
    return 'browsing-history'
  }

  // Bills
  if (/bills?|payments?|due|owe|financial|money/i.test(lower) || channelName === 'bills') {
    return 'bills'
  }

  // Jobs
  if (/jobs?|applications?|pipeline|interview|career|hiring/i.test(lower) || channelName === 'job-pipeline') {
    return 'jobs'
  }

  // Calendar
  if (/calendar|schedule|events?|upcoming|plans?|what'?s? (happening|going on)/i.test(lower) || channelName === 'calendar') {
    return 'calendar'
  }

  // Cloud
  if (/cloud|storage|drive|nas|backup/i.test(lower) || channelName === 'cloud') {
    return 'cloud'
  }

  // Goals
  if (/goals?|targets?|objectives?/i.test(lower)) {
    return 'goals'
  }

  // News
  if (/news|headlines?|what'?s? new/i.test(lower) || channelName === 'news') {
    return 'news'
  }

  // Channel-aware defaults: if they ask a question in a channel, assume channel topic
  if (lower.includes('?')) {
    if (channelName === 'screen-time') return 'screen-time'
    if (channelName === 'bills' || channelName === 'cash-flow') return 'bills'
    if (channelName === 'job-pipeline' || channelName === 'applications') return 'jobs'
    if (channelName === 'calendar') return 'calendar'
    if (channelName === 'cloud') return 'cloud'
  }

  return 'general'
}

function parseMessage(text: string, channelName: string): ParsedMessage {
  return {
    intent: detectIntent(text, channelName),
    subject: extractSubject(text),
    timeWindow: extractTimeWindow(text),
    raw: text,
    channelName,
  }
}

// ─── Response Generation ────────────────────────────────────────────────────

/**
 * Generate a response using pattern matching (no API key needed)
 */
async function patternResponse(parsed: ParsedMessage): Promise<{ text: string; dataSources: string[] }> {
  const { intent, subject, timeWindow } = parsed
  const dataSources: string[] = []

  switch (intent) {
    case 'greeting':
      return { text: pickRandom(TEMPLATES.greeting), dataSources: [] }

    case 'about-bmo':
      return {
        text: [
          "BMO is your family's digital companion! Here's what I can help with:",
          '',
          '🎮 **Screen Time** — "How much time did Liam spend gaming today?"',
          '📱 **Device Status** — "Is Clara online?" / "What is Liam doing?"',
          '📊 **App Usage** — "What apps did Clara use today?"',
          '🌐 **Browsing** — "What was Liam watching?"',
          '💰 **Bills** — "What bills are due?"',
          '📅 **Calendar** — "What\'s on the calendar?"',
          '💼 **Jobs** — "How\'s the job search going?"',
          '☁️ **Cloud** — "How\'s the cloud storage?"',
          '🎯 **Goals** — "What are the family goals?"',
          '',
          'Just ask me anything! BMO is always learning. 💚',
        ].join('\n'),
        dataSources: [],
      }

    case 'device-status': {
      dataSources.push('pc-activity.json')
      const { devices } = await data.getDeviceStatus()

      if (subject) {
        const device = devices.find(d => d.user.toLowerCase() === subject.toLowerCase())
        if (!device) return { text: `BMO doesn't see a device for ${subject} right now.`, dataSources }

        if (!device.online) return { text: TEMPLATES.deviceOffline(subject), dataSources }
        return { text: TEMPLATES.currentStatus(subject, device.app, device.idle), dataSources }
      }

      // All devices
      const lines = devices.map(d => {
        const status = d.online ? (d.idle ? '💤 idle' : `🟢 **${d.app}**`) : '⚫ offline'
        return `• **${d.name}** (${d.user}) — ${status}`
      })
      return { text: `**Device Status**\n${lines.join('\n')}`, dataSources }
    }

    case 'screen-time': {
      dataSources.push('pc-activity.json')
      const name = subject || 'Liam' // default to Liam for screen-time channel
      const usage = await data.getUsageByCategory(name, timeWindow)
      const totalMin = Object.values(usage).reduce((a, b) => a + b, 0)

      if (totalMin === 0) {
        return {
          text: `BMO doesn't have any activity data for ${name} in the last ${timeWindow} hours. They might be offline!`,
          dataSources,
        }
      }

      const hours = (min: number) => (min / 60).toFixed(1)
      const lines = [
        `**${name}'s Screen Time** (last ${timeWindow}h)`,
        '',
        `🎮 Gaming: **${hours(usage.gaming)}h**`,
        `📺 Video: **${hours(usage.video)}h**`,
        `💬 Social: **${hours(usage.social)}h**`,
        `🌐 Browsing: **${hours(usage.browsing)}h**`,
        `📝 Productivity: **${hours(usage.productivity)}h**`,
        `📦 Other: **${hours(usage.other)}h**`,
        '',
        `**Total: ${hours(totalMin)}h**`,
      ]

      // Add a BMO comment
      if (usage.gaming > 180) {
        lines.push('', TEMPLATES.gamingHigh(name, usage.gaming / 60))
      } else if (usage.productivity > 60) {
        lines.push('', TEMPLATES.productivityCelebration(name, usage.productivity / 60))
      }

      return { text: lines.join('\n'), dataSources }
    }

    case 'top-apps': {
      dataSources.push('pc-activity.json')
      const name = subject || 'Liam'
      const apps = await data.getTopApps(name, timeWindow)

      if (apps.length === 0) {
        return { text: `No app data for ${name} in the last ${timeWindow} hours.`, dataSources }
      }

      const lines = [
        `**${name}'s Top Apps** (last ${timeWindow}h)`,
        '',
        ...apps.slice(0, 8).map((a, i) =>
          `${i + 1}. **${a.name}** — ${(a.minutes / 60).toFixed(1)}h (${a.category})`
        ),
      ]

      return { text: lines.join('\n'), dataSources }
    }

    case 'browsing-history': {
      dataSources.push('pc-activity.json')
      const name = subject || 'Liam'
      const history = await data.getRecentBrowsing(name, Math.min(timeWindow, 24))

      if (history.length === 0) {
        return { text: `No recent browsing data for ${name}.`, dataSources }
      }

      const lines = [
        `**${name}'s Recent Browsing**`,
        '',
        ...history.slice(0, 10).map(h => `• ${h.title}`),
      ]

      return { text: lines.join('\n'), dataSources }
    }

    case 'bills': {
      dataSources.push('accounts-bills-normalized.json')
      const summary = await data.getBillsSummary()
      return { text: summary, dataSources }
    }

    case 'jobs': {
      dataSources.push('job-pipeline.json')
      const summary = await data.getJobPipeline()
      return { text: summary, dataSources }
    }

    case 'calendar': {
      dataSources.push('household-calendar.json')
      const summary = await data.getCalendarSummary()
      return { text: summary, dataSources }
    }

    case 'cloud': {
      dataSources.push('cloud-accounts.json')
      const summary = await data.getCloudOverview()
      return { text: summary, dataSources }
    }

    case 'goals': {
      dataSources.push('family-goals.json')
      const summary = await data.getFamilyGoals()
      return { text: summary, dataSources }
    }

    case 'news': {
      dataSources.push('news-intel.json')
      const summary = await data.getNewsSummary()
      return { text: summary, dataSources }
    }

    case 'general':
    default:
      return { text: TEMPLATES.unknownQuestion, dataSources: [] }
  }
}

/**
 * Generate a response using Claude API (richer, more natural)
 */
async function aiResponse(
  parsed: ParsedMessage,
  userId: string,
  username: string
): Promise<{ text: string; dataSources: string[] } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('#')) return null

  try {
    const anthropic = new Anthropic({ apiKey })

    // Gather relevant data context
    const dataContext = await data.getFullDataContext()
    const memorySummary = await getMemorySummary()
    const recentInteractions = await getRecentInteractions(5)

    const recentContext = recentInteractions.length > 0
      ? `\nRecent conversation:\n${recentInteractions.map(i =>
          `  ${i.username}: "${i.question}" → BMO: "${i.response.slice(0, 100)}..."`
        ).join('\n')}`
      : ''

    // If the question is specifically about screen time, get detailed data
    let extraData = ''
    if (['screen-time', 'device-status', 'top-apps', 'browsing-history'].includes(parsed.intent)) {
      const name = parsed.subject || 'Liam'
      const usage = await data.getUsageByCategory(name, parsed.timeWindow)
      const apps = await data.getTopApps(name, parsed.timeWindow)
      extraData = `\n\nDetailed data for ${name} (last ${parsed.timeWindow}h):\n`
      extraData += `Usage by category (minutes): ${JSON.stringify(usage)}\n`
      extraData += `Top apps: ${apps.map(a => `${a.name} (${a.minutes}min, ${a.category})`).join(', ')}\n`
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: BMO_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            `[Channel: #${parsed.channelName}]`,
            `[User: ${username} (${userId})]`,
            `[Intent detected: ${parsed.intent}]`,
            ``,
            `Current data:`,
            dataContext,
            extraData,
            ``,
            `BMO's memory:`,
            memorySummary,
            recentContext,
            ``,
            `Message from ${username}: "${parsed.raw}"`,
            ``,
            `Respond as BMO. Keep it under 200 words. Use Discord markdown.`,
          ].join('\n'),
        },
      ],
    })

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('')

    if (text) {
      return { text, dataSources: ['claude-api', 'pc-activity.json'] }
    }
  } catch (err: any) {
    console.error(`[bmo-brain] Claude API error: ${err.message}`)
  }

  return null
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export interface BmoResponse {
  text: string
  intent: string
  dataSources: string[]
}

/**
 * Process an incoming message and generate BMO's response.
 * Tries Claude API first, falls back to pattern matching.
 */
export async function processMessage(
  messageText: string,
  channelName: string,
  channelId: string,
  userId: string,
  username: string
): Promise<BmoResponse> {
  const startTime = Date.now()
  const parsed = parseMessage(messageText, channelName)

  // Try AI response first, fall back to pattern matching
  let result = await aiResponse(parsed, userId, username)
  if (!result) {
    result = await patternResponse(parsed)
  }

  const responseTimeMs = Date.now() - startTime

  // Log to memory (fire and forget)
  logInteraction({
    timestamp: new Date().toISOString(),
    userId,
    username,
    channelId,
    channelName,
    question: messageText,
    response: result.text,
    intent: parsed.intent,
    dataSourcesUsed: result.dataSources,
    responseTimeMs,
  }).catch(err => console.error(`[bmo-memory] Failed to log: ${err.message}`))

  return {
    text: result.text,
    intent: parsed.intent,
    dataSources: result.dataSources,
  }
}
