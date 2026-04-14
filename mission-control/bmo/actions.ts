/**
 * actions.ts — BMO's response processor
 *
 * When someone replies to a BMO survey or question, this module
 * figures out what to DO with the answer and writes the update
 * to the correct data file.
 *
 * Every function returns a reply message for BMO to send back,
 * and optionally a next pending conversation for follow-up questions.
 */

import fs from 'fs/promises'
import path from 'path'
import { PendingConversation, ConversationType } from './conversation'

const DATA_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data'

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf-8'))
  } catch { return fallback }
}

async function writeJSON(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActionResult {
  reply: string                          // What BMO says back
  nextPending?: Omit<PendingConversation, 'id' | 'askedAt' | 'expiresAt'>  // Follow-up question
  dataUpdated?: string                   // Which file was updated (for logging)
}

// ─── Parse the user's answer ────────────────────────────────────────────────

function parseChoice(raw: string, options: Record<string, string>): { choice: string | null; label: string | null } {
  const cleaned = raw.trim().replace(/️⃣/g, '').replace(/[^\w\s]/g, '').trim()

  // Direct number match: "1", "2", etc.
  if (options[cleaned]) {
    return { choice: cleaned, label: options[cleaned] }
  }

  // Check if they typed the option text
  const lower = cleaned.toLowerCase()
  for (const [key, label] of Object.entries(options)) {
    if (lower.includes(label.toLowerCase())) {
      return { choice: key, label }
    }
  }

  return { choice: null, label: null }
}

// ─── Dispatchers ────────────────────────────────────────────────────────────

export async function processResponse(
  conv: PendingConversation,
  rawAnswer: string
): Promise<ActionResult> {
  switch (conv.type) {
    case 'onboarding':
      return processOnboarding(conv, rawAnswer)
    case 'goal-approval':
      return processGoalApproval(conv, rawAnswer)
    case 'subscription-audit':
      return processSubscriptionAudit(conv, rawAnswer)
    case 'curfew':
      return processCurfew(conv, rawAnswer)
    case 'survey':
      return processSurvey(conv, rawAnswer)
    case 'freeform':
      return processFreeform(conv, rawAnswer)
    default:
      return { reply: "BMO got your answer but isn't sure what to do with it yet. Thanks though! 💚" }
  }
}

// ─── Onboarding ─────────────────────────────────────────────────────────────

async function processOnboarding(conv: PendingConversation, rawAnswer: string): Promise<ActionResult> {
  const { memberId, userId, channelId } = conv
  const { field, questionIndex, totalQuestions } = conv.actionPayload

  // Read profiles
  const data = await readJSON<any>('family-profiles.json', { version: '1.0', profiles: {} })
  const profile = data.profiles[memberId]
  if (!profile) return { reply: "BMO can't find your profile. That's weird!" }

  // Parse the answer
  let value: string
  const { choice, label } = parseChoice(rawAnswer, conv.options)

  if (label) {
    value = label
  } else {
    // Free-text answer — use as-is
    value = rawAnswer.trim()
  }

  // Store in the profile
  const parseAs = conv.actionPayload.parseAs || 'list'
  if (parseAs === 'list') {
    const items = value.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean)
    const existing = profile[field] || []
    profile[field] = [...existing, ...items]
  } else if (parseAs === 'single') {
    profile[field] = value
  } else if (parseAs === 'note') {
    profile.bmoNotes = profile.bmoNotes || []
    profile.bmoNotes.push(value)
  }

  // Advance the question index
  profile.profileQuestionIndex = (questionIndex || 0) + 1
  profile.lastInteraction = new Date().toISOString()
  profile.totalInteractions = (profile.totalInteractions || 0) + 1

  await writeJSON('family-profiles.json', data)

  // Check if there's a next question
  const nextQ = conv.actionPayload.nextQuestion
  const nextField = conv.actionPayload.nextField
  const nextOptions = conv.actionPayload.nextOptions
  const nextParseAs = conv.actionPayload.nextParseAs
  const remaining = (totalQuestions || 1) - (questionIndex || 0) - 1

  if (nextQ && remaining > 0) {
    const progressNote = remaining <= 2 ? `\n\n(Almost done — ${remaining} more!)` : ''
    return {
      reply: `Got it — **${value}**! BMO saved that to your profile. 💚`,
      nextPending: {
        userId,
        memberId,
        channelId,
        type: 'onboarding',
        questionText: nextQ,
        options: nextOptions || {},
        actionPayload: {
          field: nextField,
          parseAs: nextParseAs || 'list',
          questionIndex: (questionIndex || 0) + 1,
          totalQuestions,
          ...conv.actionPayload.nextPayload,
        },
      },
      dataUpdated: 'family-profiles.json',
    }
  }

  // Onboarding complete
  profile.onboarded = true
  profile.onboardedAt = new Date().toISOString()
  await writeJSON('family-profiles.json', data)

  return {
    reply: `🎮 **${value}** — saved! That was the last question! BMO knows you so much better now, ${profile.name}. I'll use everything you shared to be a better companion for you. 💚`,
    dataUpdated: 'family-profiles.json',
  }
}

// ─── Goal Approval ──────────────────────────────────────────────────────────

async function processGoalApproval(conv: PendingConversation, rawAnswer: string): Promise<ActionResult> {
  const { memberId } = conv
  const { choice } = parseChoice(rawAnswer, conv.options)
  const goalIds: string[] = conv.actionPayload.goalIds || []

  const data = await readJSON<any>('family-goals.json', { version: '1.0', generated_at: '', goals: [] })

  if (choice === '1') {
    // Activate all goals
    const approved: string[] = []
    for (const goal of data.goals) {
      if (goalIds.includes(goal.id) && goal.status === 'proposed') {
        if (!goal.approvedBy.includes(memberId)) {
          goal.approvedBy.push(memberId)
        }
        if (goal.approvedBy.length >= 1) {
          goal.status = 'approved'
        }
        approved.push(goal.title)
      }
    }
    await writeJSON('family-goals.json', data)

    return {
      reply: `✅ **${approved.length} goals activated!**\n\n${approved.map(t => `• ${t}`).join('\n')}\n\nBMO will start tracking progress and reporting updates. 💪`,
      dataUpdated: 'family-goals.json',
    }
  }

  if (choice === '2') {
    // List individually for picking
    const goalList = data.goals
      .filter((g: any) => goalIds.includes(g.id) && g.status === 'proposed')
      .map((g: any, i: number) => `${i + 1}️⃣ ${g.title}`)
      .join('\n')

    const individualOptions: Record<string, string> = {}
    data.goals
      .filter((g: any) => goalIds.includes(g.id) && g.status === 'proposed')
      .forEach((g: any, i: number) => {
        individualOptions[String(i + 1)] = g.id
      })

    return {
      reply: `Pick which goals to activate (reply with the numbers, separated by commas):\n\n${goalList}`,
      nextPending: {
        userId: conv.userId,
        memberId,
        channelId: conv.channelId,
        type: 'goal-approval',
        questionText: 'Pick goals to activate',
        options: individualOptions,
        actionPayload: { goalIds, mode: 'individual-pick' },
      },
    }
  }

  if (conv.actionPayload.mode === 'individual-pick') {
    // They're picking individual goals by number
    const picks = rawAnswer.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const approved: string[] = []

    for (const pick of picks) {
      const goalId = conv.options[pick]
      if (!goalId) continue

      const goal = data.goals.find((g: any) => g.id === goalId)
      if (!goal || goal.status !== 'proposed') continue

      if (!goal.approvedBy.includes(memberId)) {
        goal.approvedBy.push(memberId)
      }
      goal.status = 'approved'
      approved.push(goal.title)
    }

    await writeJSON('family-goals.json', data)
    return {
      reply: approved.length > 0
        ? `✅ **Activated ${approved.length} goals:**\n${approved.map(t => `• ${t}`).join('\n')}\n\nBMO is on it! 💪`
        : `No matching goals found. Try replying with the numbers from the list above.`,
      dataUpdated: approved.length > 0 ? 'family-goals.json' : undefined,
    }
  }

  if (choice === '3') {
    return { reply: `No problem. BMO will keep these goals as proposals. Bring it up whenever you're ready to discuss! 💚` }
  }

  if (choice === '4') {
    return { reply: `Got it — BMO will brainstorm some different goals based on the latest data and propose them soon. 🧠` }
  }

  return { reply: `BMO didn't catch that. Reply with 1, 2, 3, or 4 to choose what to do with the proposed goals.` }
}

// ─── Subscription Audit ─────────────────────────────────────────────────────

async function processSubscriptionAudit(conv: PendingConversation, rawAnswer: string): Promise<ActionResult> {
  const { choice, label } = parseChoice(rawAnswer, conv.options)
  const subs = await readJSON<any>('cloud-subscriptions.json', { subscriptions: [] })

  if (choice === '1') {
    return { reply: `Keeping both. When you find the costs, tell BMO and I'll update the records! 💚`, dataUpdated: undefined }
  }

  if (choice === '2' || choice === '3' || choice === '4') {
    const toCancel: string[] = []
    if (choice === '2' || choice === '4') toCancel.push('nintendo')
    if (choice === '3' || choice === '4') toCancel.push('ubereats')

    for (const sub of subs.subscriptions) {
      if (toCancel.includes(sub.id)) {
        sub.status = 'cancelled'
        sub.notes = `Cancelled via BMO survey on ${new Date().toISOString().split('T')[0]}`
      }
    }
    await writeJSON('cloud-subscriptions.json', subs)

    const cancelledNames = toCancel.map(id => {
      const s = subs.subscriptions.find((x: any) => x.id === id)
      return s?.name || id
    })

    return {
      reply: `✅ Marked as cancelled: **${cancelledNames.join(', ')}**\n\nNote: BMO updated the records but you may need to actually cancel them in the app/website. Want a reminder to do that?`,
      dataUpdated: 'cloud-subscriptions.json',
    }
  }

  return { reply: `Reply with 1 (keep both), 2 (cancel Nintendo), 3 (cancel Uber Eats), or 4 (cancel both).` }
}

// ─── Curfew ─────────────────────────────────────────────────────────────────

async function processCurfew(conv: PendingConversation, rawAnswer: string): Promise<ActionResult> {
  const { choice } = parseChoice(rawAnswer, conv.options)
  const goals = await readJSON<any>('family-goals.json', { version: '1.0', generated_at: '', goals: [] })
  const curfewGoal = goals.goals.find((g: any) => g.id === 'goal_screen_time_weekday')

  if (choice === '1') {
    // Activate curfews
    if (curfewGoal) {
      curfewGoal.status = 'approved'
      if (!curfewGoal.approvedBy.includes(conv.memberId)) {
        curfewGoal.approvedBy.push(conv.memberId)
      }
      await writeJSON('family-goals.json', goals)
    }
    return {
      reply: `✅ **Curfew enforcement activated!** Liam: 9 PM, Clara: 8 PM on weekdays.\n\nBMO will track compliance and report weekly. Devices will get auto-block reminders. 🌙`,
      dataUpdated: 'family-goals.json',
    }
  }

  if (choice === '2') {
    return {
      reply: `Got it — what curfew times would you like? Reply like:\n"Liam 10pm, Clara 9pm"\n\nBMO will update the settings.`,
      nextPending: {
        userId: conv.userId,
        memberId: conv.memberId,
        channelId: conv.channelId,
        type: 'freeform',
        questionText: 'Custom curfew times',
        options: {},
        actionPayload: { context: 'curfew-custom-times', goalId: 'goal_screen_time_weekday' },
      },
    }
  }

  if (choice === '3') {
    return { reply: `No problem — BMO will hold off on curfew enforcement. Let's discuss it as a family first! 💬` }
  }

  if (choice === '4') {
    if (curfewGoal) {
      curfewGoal.status = 'approved'
      curfewGoal.description = curfewGoal.description.replace('auto-blocking', 'reminder-only')
      if (!curfewGoal.approvedBy.includes(conv.memberId)) {
        curfewGoal.approvedBy.push(conv.memberId)
      }
      await writeJSON('family-goals.json', goals)
    }
    return {
      reply: `✅ **Reminder-only mode activated!** BMO will send a gentle reminder at curfew time but won't block any devices. 🔔`,
      dataUpdated: 'family-goals.json',
    }
  }

  return { reply: `Reply with 1 (enforce), 2 (adjust times), 3 (discuss first), or 4 (reminders only).` }
}

// ─── Generic Survey ─────────────────────────────────────────────────────────

async function processSurvey(conv: PendingConversation, rawAnswer: string): Promise<ActionResult> {
  const { choice, label } = parseChoice(rawAnswer, conv.options)
  const { surveyType, channelName } = conv.actionPayload

  if (!choice || !label) {
    const optionList = Object.entries(conv.options)
      .map(([k, v]) => `${k} = ${v}`)
      .join(', ')
    return { reply: `BMO didn't catch that. Reply with a number: ${optionList}` }
  }

  // Store preference in profiles
  const profiles = await readJSON<any>('family-profiles.json', { version: '1.0', profiles: {} })
  const profile = profiles.profiles[conv.memberId]

  if (profile) {
    // Store survey responses as BMO notes with context
    const note = `[${new Date().toISOString().split('T')[0]}] #${channelName} survey: "${conv.questionText}" → "${label}"`
    profile.bmoNotes = profile.bmoNotes || []
    profile.bmoNotes.push(note)
    profile.lastInteraction = new Date().toISOString()
    profile.totalInteractions = (profile.totalInteractions || 0) + 1
    await writeJSON('family-profiles.json', profiles)
  }

  return {
    reply: `Got it — **${label}**! BMO saved your preference. 📝`,
    dataUpdated: 'family-profiles.json',
  }
}

// ─── Freeform ───────────────────────────────────────────────────────────────

async function processFreeform(conv: PendingConversation, rawAnswer: string): Promise<ActionResult> {
  const { context } = conv.actionPayload

  // Store as a BMO note on the member's profile
  const profiles = await readJSON<any>('family-profiles.json', { version: '1.0', profiles: {} })
  const profile = profiles.profiles[conv.memberId]

  if (profile) {
    const note = `[${new Date().toISOString().split('T')[0]}] ${context || 'freeform'}: "${rawAnswer.slice(0, 500)}"`
    profile.bmoNotes = profile.bmoNotes || []
    profile.bmoNotes.push(note)
    profile.lastInteraction = new Date().toISOString()
    profile.totalInteractions = (profile.totalInteractions || 0) + 1
    await writeJSON('family-profiles.json', profiles)
  }

  return {
    reply: `BMO heard you — saved! 💚 "${rawAnswer.slice(0, 100)}${rawAnswer.length > 100 ? '...' : ''}"`,
    dataUpdated: 'family-profiles.json',
  }
}
