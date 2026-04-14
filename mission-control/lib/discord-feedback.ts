/**
 * discord-feedback.ts — Private feedback loop for Cutillo HQ
 *
 * After reports are posted to Discord channels, BMO DMs each relevant
 * family member requesting feedback. Responses are tracked per report per
 * member. Daily reminders are sent until all required feedback is collected.
 *
 * Mike and Erin are EQUAL co-admins — both see all parent reports,
 * both can trigger feedback, both receive all parent-channel DMs.
 *
 * Requires DISCORD_BOT_TOKEN in .env.local.
 */

import { readJSON, writeJSON } from './data'
import { sendToMember, getMemberChannel, isAdmin } from './family-messenger'

// Discord user IDs — still needed for request tracking
const FAMILY_DISCORD_IDS: Record<string, string> = {
  mike: process.env.DISCORD_MIKE_ID || '',
  erin: process.env.DISCORD_ERIN_ID || '',
  liam: process.env.DISCORD_LIAM_ID || '',
  clara: process.env.DISCORD_CLARA_ID || '',
}

// Which channels require feedback from whom
const CHANNEL_FEEDBACK_MAP: Record<string, { parents: boolean; kids: boolean; extraParentQuestions: boolean }> = {
  // Parent-only channels — only Mike + Erin
  'bills':          { parents: true, kids: false, extraParentQuestions: true },
  'cash-flow':      { parents: true, kids: false, extraParentQuestions: true },
  'subscriptions':  { parents: true, kids: false, extraParentQuestions: true },
  'job-pipeline':   { parents: true, kids: false, extraParentQuestions: false },
  'applications':   { parents: true, kids: false, extraParentQuestions: false },
  'resume':         { parents: true, kids: false, extraParentQuestions: false },
  'network':        { parents: true, kids: false, extraParentQuestions: false },
  'cloud':          { parents: true, kids: false, extraParentQuestions: false },
  'news':           { parents: true, kids: false, extraParentQuestions: false },
  // Family channels — everyone
  'announcements':  { parents: true, kids: true, extraParentQuestions: true },
  'calendar':       { parents: true, kids: true, extraParentQuestions: false },
  'school':         { parents: true, kids: true, extraParentQuestions: false },
  'screen-time':    { parents: true, kids: true, extraParentQuestions: false },
}

// Standard feedback questions
const STANDARD_QUESTIONS = [
  'Rate this report 1–5 (1 = not useful, 5 = very useful)',
  'What stood out to you?',
  'Anything to add or correct?',
]

const PARENT_FINANCE_QUESTIONS = [
  'Is the financial information accurate?',
  'Any missing items or bills?',
  'Should any priorities change?',
  'What should TurboDot focus on improving?',
]

export interface FeedbackRequest {
  id: string
  reportId: string
  channel: string
  memberId: string           // mike, erin, liam, clara
  discordUserId: string
  questions: string[]
  response: string | null
  rating: number | null
  requestedAt: string
  respondedAt: string | null
  remindersSent: number
  lastReminderAt: string | null
}

interface FeedbackData {
  version: string
  requests: FeedbackRequest[]
}

const FILE = 'discord-feedback.json'

async function getData(): Promise<FeedbackData> {
  return readJSON<FeedbackData>(FILE, { version: '1.0', requests: [] })
}

async function saveData(data: FeedbackData): Promise<void> {
  await writeJSON(FILE, data)
}

/** Open a DM channel with a Discord user via the bot API */
async function openDMChannel(userId: string): Promise<string | null> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token || !userId) return null

  const res = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  })

  if (!res.ok) {
    console.error(`[discord-feedback] Failed to open DM with ${userId}: ${res.status}`)
    return null
  }

  const data = await res.json()
  return data.id
}

/** Send a DM to a Discord user */
async function sendDM(userId: string, content: string): Promise<boolean> {
  const channelId = await openDMChannel(userId)
  if (!channelId) return false

  const token = process.env.DISCORD_BOT_TOKEN
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })

  if (!res.ok) {
    console.error(`[discord-feedback] Failed to send DM to ${userId}: ${res.status}`)
    return false
  }

  return true
}

/**
 * Request feedback from all relevant family members after a report is posted.
 *
 * @param channel - The channel the report was posted to
 * @param reportId - Unique ID for this report (e.g. "bills-2026-04-12")
 * @param reportSummary - Short summary of the report content
 */
export async function requestFeedback(
  channel: string,
  reportId: string,
  reportSummary: string
): Promise<FeedbackRequest[]> {
  const config = CHANNEL_FEEDBACK_MAP[channel]
  if (!config) return []

  const data = await getData()
  const created: FeedbackRequest[] = []

  const members: string[] = []
  if (config.parents) members.push('mike', 'erin')
  if (config.kids) members.push('liam', 'clara')

  for (const memberId of members) {
    const discordUserId = FAMILY_DISCORD_IDS[memberId]
    if (!discordUserId) continue

    // Don't create duplicate requests
    const exists = data.requests.find(
      r => r.reportId === reportId && r.memberId === memberId
    )
    if (exists) continue

    const isParent = memberId === 'mike' || memberId === 'erin'
    const questions = [
      ...STANDARD_QUESTIONS,
      ...(isParent && config.extraParentQuestions ? PARENT_FINANCE_QUESTIONS : []),
    ]

    const request: FeedbackRequest = {
      id: `fb_${Date.now()}_${memberId}`,
      reportId,
      channel,
      memberId,
      discordUserId,
      questions,
      response: null,
      rating: null,
      requestedAt: new Date().toISOString(),
      respondedAt: null,
      remindersSent: 0,
      lastReminderAt: null,
    }

    data.requests.push(request)
    created.push(request)

    // Send via the member's preferred channel (Discord DM or iMessage)
    const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
    const deliveryChannel = getMemberChannel(memberId)
    const message = [
      `TurboDot — Feedback Request`,
      ``,
      `A new report was posted to #${channel}:`,
      `> ${reportSummary}`,
      ``,
      `Please reply with your feedback:`,
      questionList,
      ``,
      `Reply with your answers. Your feedback is private — only TurboDot sees it.`,
      `(Sent via ${deliveryChannel})`,
    ].join('\n')

    await sendToMember(memberId, message)
  }

  await saveData(data)
  return created
}

/** Record a member's feedback response */
export async function recordFeedback(
  reportId: string,
  memberId: string,
  response: string,
  rating?: number
): Promise<FeedbackRequest | null> {
  const data = await getData()
  const idx = data.requests.findIndex(
    r => r.reportId === reportId && r.memberId === memberId
  )
  if (idx === -1) return null

  data.requests[idx].response = response
  data.requests[idx].rating = rating ?? null
  data.requests[idx].respondedAt = new Date().toISOString()

  await saveData(data)
  return data.requests[idx]
}

/** Get all pending (unanswered) feedback requests */
export async function getPendingFeedback(): Promise<FeedbackRequest[]> {
  const data = await getData()
  return data.requests.filter(r => !r.respondedAt)
}

/** Get all feedback for a specific report */
export async function getReportFeedback(reportId: string): Promise<FeedbackRequest[]> {
  const data = await getData()
  return data.requests.filter(r => r.reportId === reportId)
}

/** Check if all required feedback has been collected for a report */
export async function isReportComplete(reportId: string): Promise<boolean> {
  const requests = await getReportFeedback(reportId)
  return requests.length > 0 && requests.every(r => r.respondedAt !== null)
}

/**
 * Send daily reminders for pending feedback.
 * Call this from a scheduled job (e.g. daily at 9 AM).
 */
export async function sendDailyReminders(): Promise<number> {
  const data = await getData()
  let sent = 0
  const now = new Date()

  for (const req of data.requests) {
    if (req.respondedAt) continue // already answered

    // Don't send more than one reminder per day
    if (req.lastReminderAt) {
      const lastReminder = new Date(req.lastReminderAt)
      const hoursSince = (now.getTime() - lastReminder.getTime()) / (1000 * 60 * 60)
      if (hoursSince < 20) continue // less than ~20 hours since last reminder
    }

    const message = [
      `Reminder: TurboDot is still waiting for your feedback on the #${req.channel} report.`,
      ``,
      `Report ID: ${req.reportId}`,
      ``,
      `Reply with your answers. Your feedback is private.`,
    ].join('\n')

    const success = await sendToMember(req.memberId, message)
    if (success) {
      req.remindersSent += 1
      req.lastReminderAt = now.toISOString()
      sent++
    }
  }

  await saveData(data)
  return sent
}

/**
 * Generate an aggregated (anonymous) feedback summary for a report.
 * No names are attached — just aggregated responses.
 */
export async function getAnonymousSummary(reportId: string): Promise<string> {
  const requests = await getReportFeedback(reportId)
  const answered = requests.filter(r => r.respondedAt)

  if (answered.length === 0) return 'No feedback received yet.'

  const ratings = answered.filter(r => r.rating !== null).map(r => r.rating as number)
  const avgRating = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : 'N/A'

  const total = requests.length
  const responded = answered.length

  const lines = [
    `**Feedback Summary — ${reportId}**`,
    `Responses: ${responded}/${total}`,
    `Average Rating: ${avgRating}/5`,
    ``,
  ]

  // Include anonymous feedback snippets
  for (let i = 0; i < answered.length; i++) {
    lines.push(`**Response ${i + 1}:** ${answered[i].response}`)
  }

  return lines.join('\n')
}
