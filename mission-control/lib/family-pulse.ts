/**
 * family-pulse.ts — BMO Family Pulse check-in system
 *
 * BMO is the family's neutral AI companion. BMO sends periodic psychology-based
 * check-in questions to each family member, captures responses, detects patterns,
 * and surfaces insights in the weekly brief.
 *
 * BMO is a neutral third party — not Mike's bot, not Erin's bot.
 * What one person tells BMO stays with BMO. Only anonymous patterns are surfaced.
 */

import { readJSON, writeJSON, generateId } from './data'
import { sendToMember, sendToParents, sendJointMessage, readReplies, getMemberChannel, isAdmin } from './family-messenger'

export const BOT_NAME = process.env.BOT_NAME || 'BMO'

// ─── Question Bank ───────────────────────────────────────────────────────────

export type PulseCategory =
  | 'emotional'
  | 'gratitude'
  | 'growth-mindset'
  | 'connection'
  | 'self-awareness'
  | 'reflection'
  | 'couples'
  | 'parenting'  // Joint Mike+Erin — sent to BOTH together

export interface PulseQuestion {
  id: string
  category: PulseCategory
  text: string
  kidsVersion?: string
  ageGroup: 'kids' | 'adults' | 'couples' | 'parenting' | 'all' // couples = private 1-on-1, parenting = joint to both
  responseType: 'emoji-scale' | 'text' | 'number-scale'
  scaleLabels?: string[]
  weight: number
  followUp?: string
}

export const QUESTION_BANK: PulseQuestion[] = [
  // ── Emotional ──────────────────────────────────────────────────────────────
  { id: 'emo-01', category: 'emotional', text: `${BOT_NAME} wants to know — how are you feeling right now?`, kidsVersion: `${BOT_NAME} wants to know — how are you feeling? 😊😐😢😡😴`, ageGroup: 'all', responseType: 'emoji-scale', scaleLabels: ['😊', '🙂', '😐', '😢', '😡'], weight: 1.2, followUp: `${BOT_NAME} cares about you. Is there anything ${BOT_NAME} can do?` },
  { id: 'emo-02', category: 'emotional', text: `${BOT_NAME}'s checking in! Rate your emotional energy today (1-5)`, ageGroup: 'adults', responseType: 'number-scale', scaleLabels: ['1', '2', '3', '4', '5'], weight: 1.0 },
  { id: 'emo-03', category: 'emotional', text: `Did anything make you feel sad or worried today? ${BOT_NAME} is here to listen.`, kidsVersion: `Did anything make you feel sad or worried today? You can tell ${BOT_NAME}!`, ageGroup: 'all', responseType: 'text', weight: 0.8, followUp: `${BOT_NAME} is sorry you felt that way. Thank you for telling ${BOT_NAME}.` },
  { id: 'emo-04', category: 'emotional', text: `What was the best part of today? ${BOT_NAME} loves hearing good news!`, ageGroup: 'all', responseType: 'text', weight: 1.1 },
  { id: 'emo-05', category: 'emotional', text: `If your feelings had a color right now, what color would they be? ${BOT_NAME} is curious!`, ageGroup: 'kids', responseType: 'text', weight: 0.9 },
  { id: 'emo-06', category: 'emotional', text: `${BOT_NAME} knows life gets heavy sometimes. What's weighing on your mind most this week?`, ageGroup: 'adults', responseType: 'text', weight: 0.9 },
  { id: 'emo-07', category: 'emotional', text: `On a scale of 1-5, how peaceful do you feel right now?`, ageGroup: 'adults', responseType: 'number-scale', scaleLabels: ['1', '2', '3', '4', '5'], weight: 0.8 },
  { id: 'emo-08', category: 'emotional', text: `${BOT_NAME} wants to check — did you laugh today? What made you laugh?`, ageGroup: 'all', responseType: 'text', weight: 1.0 },

  // ── Gratitude ──────────────────────────────────────────────────────────────
  { id: 'grt-01', category: 'gratitude', text: `Tell ${BOT_NAME} — what made you smile today?`, ageGroup: 'all', responseType: 'text', weight: 1.2 },
  { id: 'grt-02', category: 'gratitude', text: `${BOT_NAME} is curious — name 3 things you're grateful for!`, ageGroup: 'adults', responseType: 'text', weight: 1.0 },
  { id: 'grt-03', category: 'gratitude', text: `Who did something nice for you this week? ${BOT_NAME} wants to hear about it!`, kidsVersion: `Who did something nice for you? Tell ${BOT_NAME}!`, ageGroup: 'all', responseType: 'text', weight: 1.0 },
  { id: 'grt-04', category: 'gratitude', text: `What's something you have that you're really glad about?`, kidsVersion: `What's something you have that makes you happy? ${BOT_NAME} is curious!`, ageGroup: 'all', responseType: 'text', weight: 0.9 },
  { id: 'grt-05', category: 'gratitude', text: `${BOT_NAME} thinks the little things matter. What small thing made today better?`, ageGroup: 'adults', responseType: 'text', weight: 0.9 },
  { id: 'grt-06', category: 'gratitude', text: `What's your favorite thing about your family? ${BOT_NAME} loves this family!`, ageGroup: 'kids', responseType: 'text', weight: 1.1 },
  { id: 'grt-07', category: 'gratitude', text: `What's something your partner did this week that you appreciated? ${BOT_NAME} is curious.`, ageGroup: 'adults', responseType: 'text', weight: 0.9 },
  { id: 'grt-08', category: 'gratitude', text: `${BOT_NAME} is grateful for this family. What are YOU grateful for today?`, ageGroup: 'all', responseType: 'text', weight: 1.0 },

  // ── Growth Mindset ─────────────────────────────────────────────────────────
  { id: 'grw-01', category: 'growth-mindset', text: `${BOT_NAME} loves learning! What's something hard you tried today?`, kidsVersion: `${BOT_NAME} loves learning! What's something hard you tried today, even if it didn't work?`, ageGroup: 'all', responseType: 'text', weight: 1.1 },
  { id: 'grw-02', category: 'growth-mindset', text: `${BOT_NAME} thinks mistakes are adventures. Where are you being too hard on yourself?`, ageGroup: 'adults', responseType: 'text', weight: 0.9 },
  { id: 'grw-03', category: 'growth-mindset', text: `If you could learn any new skill, what would it be? ${BOT_NAME} wants to know!`, ageGroup: 'kids', responseType: 'text', weight: 1.0 },
  { id: 'grw-04', category: 'growth-mindset', text: `What's one mistake you made recently? What did it teach you?`, ageGroup: 'adults', responseType: 'text', weight: 0.8 },
  { id: 'grw-05', category: 'growth-mindset', text: `${BOT_NAME} believes in getting better every day. What's one thing you improved at this week?`, ageGroup: 'all', responseType: 'text', weight: 1.0 },
  { id: 'grw-06', category: 'growth-mindset', text: `Did you try something new today? ${BOT_NAME} thinks new things are exciting!`, ageGroup: 'kids', responseType: 'text', weight: 0.9 },
  { id: 'grw-07', category: 'growth-mindset', text: `What's a goal you're working toward? How's it going?`, ageGroup: 'adults', responseType: 'text', weight: 0.9 },
  { id: 'grw-08', category: 'growth-mindset', text: `${BOT_NAME} knows practice makes progress. What have you been practicing lately?`, ageGroup: 'all', responseType: 'text', weight: 0.8 },

  // ── Connection ─────────────────────────────────────────────────────────────
  { id: 'con-01', category: 'connection', text: `Who did you have the most fun with today? ${BOT_NAME} wants to know!`, ageGroup: 'kids', responseType: 'text', weight: 1.1 },
  { id: 'con-02', category: 'connection', text: `How connected do you feel to your family this week? (1-5)`, ageGroup: 'adults', responseType: 'number-scale', scaleLabels: ['1', '2', '3', '4', '5'], weight: 1.0 },
  { id: 'con-03', category: 'connection', text: `Did you help anyone today? Did anyone help you? ${BOT_NAME} loves hearing about teamwork!`, ageGroup: 'kids', responseType: 'text', weight: 1.0 },
  { id: 'con-04', category: 'connection', text: `Is there someone at school you want to be better friends with? ${BOT_NAME} is curious!`, ageGroup: 'kids', responseType: 'text', weight: 0.8 },
  { id: 'con-05', category: 'connection', text: `When was the last time you had a genuine conversation with each kid? ${BOT_NAME} thinks it matters.`, ageGroup: 'adults', responseType: 'text', weight: 0.9 },
  { id: 'con-06', category: 'connection', text: `Did you eat dinner together as a family today? ${BOT_NAME} loves family dinner!`, ageGroup: 'all', responseType: 'text', weight: 0.9 },
  { id: 'con-07', category: 'connection', text: `Who made you feel loved today? ${BOT_NAME} thinks that's important.`, ageGroup: 'all', responseType: 'text', weight: 1.0 },
  { id: 'con-08', category: 'connection', text: `${BOT_NAME} wants to know — do you feel heard by the people around you?`, ageGroup: 'all', responseType: 'text', weight: 0.8 },

  // ── Self-Awareness ───────────────────────────────────────��─────────────────
  { id: 'saw-01', category: 'self-awareness', text: `If your day was weather, what would it be? ☀️🌤️⛅🌧️⛈️ ${BOT_NAME} is curious!`, ageGroup: 'kids', responseType: 'emoji-scale', scaleLabels: ['☀️', '🌤️', '⛅', '🌧️', '⛈️'], weight: 1.2 },
  { id: 'saw-02', category: 'self-awareness', text: `What do you do when you feel frustrated? ${BOT_NAME} wants to understand.`, ageGroup: 'kids', responseType: 'text', weight: 0.9 },
  { id: 'saw-03', category: 'self-awareness', text: `${BOT_NAME} noticed life is busy. What triggered stress for you this week?`, ageGroup: 'adults', responseType: 'text', weight: 0.9 },
  { id: 'saw-04', category: 'self-awareness', text: `How much sleep did you get last night? ${BOT_NAME} thinks sleep matters!`, ageGroup: 'adults', responseType: 'text', weight: 0.8 },
  { id: 'saw-05', category: 'self-awareness', text: `When you got upset today, what did your body feel like? ${BOT_NAME} is learning about feelings!`, ageGroup: 'kids', responseType: 'text', weight: 0.8 },
  { id: 'saw-06', category: 'self-awareness', text: `What's one thought you keep coming back to this week?`, ageGroup: 'adults', responseType: 'text', weight: 0.9 },
  { id: 'saw-07', category: 'self-awareness', text: `${BOT_NAME} thinks knowing yourself is a superpower. What's something about yourself you learned recently?`, ageGroup: 'all', responseType: 'text', weight: 0.8 },
  { id: 'saw-08', category: 'self-awareness', text: `Rate your energy level right now (1-5). ${BOT_NAME} just wants to check!`, ageGroup: 'all', responseType: 'number-scale', scaleLabels: ['1', '2', '3', '4', '5'], weight: 0.9 },

  // ── Reflection / Self-Care ─────────────────────────────────────────────────
  { id: 'ref-01', category: 'reflection', text: `${BOT_NAME} thinks you're great at something. What is it?`, ageGroup: 'kids', responseType: 'text', weight: 1.1 },
  { id: 'ref-02', category: 'reflection', text: `Did you do something just for you this week? ${BOT_NAME} hopes so!`, ageGroup: 'adults', responseType: 'text', weight: 1.0 },
  { id: 'ref-03', category: 'reflection', text: `If you could change one thing about your day, what would it be?`, kidsVersion: `If you could change one thing about today, what would it be? ${BOT_NAME} is listening!`, ageGroup: 'all', responseType: 'text', weight: 0.9 },
  { id: 'ref-04', category: 'reflection', text: `What did you learn today that surprised you? ${BOT_NAME} loves surprises!`, ageGroup: 'kids', responseType: 'text', weight: 0.9 },
  { id: 'ref-05', category: 'reflection', text: `Are you taking care of your physical health? ${BOT_NAME} thinks your body matters!`, ageGroup: 'adults', responseType: 'text', weight: 0.8 },
  { id: 'ref-06', category: 'reflection', text: `What's something you're looking forward to? ${BOT_NAME} loves plans!`, ageGroup: 'all', responseType: 'text', weight: 1.0 },
  { id: 'ref-07', category: 'reflection', text: `${BOT_NAME} thinks rest is important. How do you recharge?`, ageGroup: 'adults', responseType: 'text', weight: 0.8 },
  { id: 'ref-08', category: 'reflection', text: `What made today different from yesterday? ${BOT_NAME} is paying attention!`, ageGroup: 'all', responseType: 'text', weight: 0.8 },

  // ── Couples (Mike + Erin only) ─────────────────────────────────────────────
  { id: 'cpl-01', category: 'couples', text: `${BOT_NAME}'s couples check: How connected do you feel to your partner this week? (1-5)`, ageGroup: 'couples', responseType: 'number-scale', scaleLabels: ['1', '2', '3', '4', '5'], weight: 1.2 },
  { id: 'cpl-02', category: 'couples', text: `Is there something you wish you could tell your partner but haven't? This is just between you and ${BOT_NAME}.`, ageGroup: 'couples', responseType: 'text', weight: 0.9 },
  { id: 'cpl-03', category: 'couples', text: `What did your partner do well this week? ${BOT_NAME} thinks appreciation matters!`, ageGroup: 'couples', responseType: 'text', weight: 1.1 },
  { id: 'cpl-04', category: 'couples', text: `On a scale of 1-5, how's the teamwork feeling between you two?`, ageGroup: 'couples', responseType: 'number-scale', scaleLabels: ['1', '2', '3', '4', '5'], weight: 1.0 },
  { id: 'cpl-05', category: 'couples', text: `When was the last time you two had fun together — just the two of you? ${BOT_NAME} is curious!`, ageGroup: 'couples', responseType: 'text', weight: 0.9 },
  { id: 'cpl-06', category: 'couples', text: `What's one thing your partner could do this week that would mean a lot to you?`, ageGroup: 'couples', responseType: 'text', weight: 0.8 },
  { id: 'cpl-07', category: 'couples', text: `${BOT_NAME} believes in you two. How are you feeling about your relationship right now? (1-5)`, ageGroup: 'couples', responseType: 'number-scale', scaleLabels: ['1', '2', '3', '4', '5'], weight: 1.0 },
  { id: 'cpl-08', category: 'couples', text: `Are there any decisions you two need to make together that you've been putting off?`, ageGroup: 'couples', responseType: 'text', weight: 0.7 },

  // ── Parenting (JOINT — sent to Mike + Erin together) ─────────────────────
  // These are sent via sendJointMessage() so both parents know the other sees it.
  // Used for co-parenting alignment, shared goals, and raising the kids together.
  { id: 'par-01', category: 'parenting', text: `${BOT_NAME} wants to check in on the kids. How are Liam and Clara doing this week? Anything ${BOT_NAME} should know?`, ageGroup: 'parenting', responseType: 'text', weight: 1.2 },
  { id: 'par-02', category: 'parenting', text: `Is there a parenting challenge you two are navigating right now? ${BOT_NAME} is here to help think it through.`, ageGroup: 'parenting', responseType: 'text', weight: 1.0 },
  { id: 'par-03', category: 'parenting', text: `What's one thing each kid did this week that made you proud? ${BOT_NAME} loves hearing these!`, ageGroup: 'parenting', responseType: 'text', weight: 1.1 },
  { id: 'par-04', category: 'parenting', text: `Are you and your partner aligned on any rules or boundaries that need adjusting? Screen time, bedtime, anything?`, ageGroup: 'parenting', responseType: 'text', weight: 0.9 },
  { id: 'par-05', category: 'parenting', text: `${BOT_NAME} thinks about the future. What's one value or skill you want to make sure the kids learn this year?`, ageGroup: 'parenting', responseType: 'text', weight: 0.9 },
  { id: 'par-06', category: 'parenting', text: `How's the division of parenting duties feeling? Is it balanced? (1-5)`, ageGroup: 'parenting', responseType: 'number-scale', scaleLabels: ['1', '2', '3', '4', '5'], weight: 0.8 },
  { id: 'par-07', category: 'parenting', text: `Is there something about the kids' school, friends, or activities that you two should discuss? ${BOT_NAME} wants to make sure nothing falls through the cracks.`, ageGroup: 'parenting', responseType: 'text', weight: 0.9 },
  { id: 'par-08', category: 'parenting', text: `${BOT_NAME} has a fun one: If you could plan one family activity this weekend, what would it be?`, ageGroup: 'parenting', responseType: 'text', weight: 1.0 },
]

// ─── State Types ─────────────────────────────────────────────────────────────

export interface PulseCheckin {
  id: string
  memberId: string
  questionId: string
  questionText: string
  category: PulseCategory
  scheduledAt: string
  deliveredAt: string | null
  deliveryChannel: string
  response: string | null
  rating: number | null
  respondedAt: string | null
  notionPageId: string | null
  flagged: boolean
}

export interface PulseAlert {
  id: string
  memberId: string
  type: 'low-mood-streak' | 'declining-trend' | 'non-response' | 'keyword-flag' | 'couples-low' | 'couples-high'
  message: string
  createdAt: string
  acknowledged: boolean
}

interface MemberState {
  checkins: PulseCheckin[]
  currentStreak: number
  lastCheckinDate: string | null
  lastCategory: PulseCategory | null
  categoryHistory: PulseCategory[]
}

interface PulseState {
  version: string
  lastScheduleRun: string | null
  members: Record<string, MemberState>
  alerts: PulseAlert[]
}

const FILE = 'family-pulse.json'
const FAMILY_MEMBERS = ['mike', 'erin', 'liam', 'clara']
const PARENTS = ['mike', 'erin']
const KIDS = ['liam', 'clara']

const EMPTY_MEMBER: MemberState = {
  checkins: [],
  currentStreak: 0,
  lastCheckinDate: null,
  lastCategory: null,
  categoryHistory: [],
}

async function getState(): Promise<PulseState> {
  const state = await readJSON<PulseState>(FILE, {
    version: '1.0',
    lastScheduleRun: null,
    members: {},
    alerts: [],
  })
  // Ensure all members exist
  for (const id of FAMILY_MEMBERS) {
    if (!state.members[id]) state.members[id] = { ...EMPTY_MEMBER }
  }
  return state
}

async function saveState(state: PulseState): Promise<void> {
  await writeJSON(FILE, state)
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

interface TimeWindow {
  start: string // "HH:MM"
  end: string
  label: string
}

const SCHEDULE_WINDOWS: Record<string, TimeWindow[]> = {
  mike:  [{ start: '07:00', end: '08:30', label: 'morning' }, { start: '20:30', end: '21:30', label: 'evening' }],
  erin:  [{ start: '07:30', end: '09:00', label: 'morning' }, { start: '20:00', end: '21:00', label: 'evening' }],
  liam:  [{ start: '15:30', end: '17:00', label: 'after-school' }, { start: '19:30', end: '20:30', label: 'before-bed' }],
  clara: [{ start: '15:30', end: '17:00', label: 'after-school' }, { start: '19:00', end: '19:45', label: 'before-bed' }],
}

const MAX_PER_WEEK = 3
const COUPLES_MAX_PER_WEEK = 1

function getWeekKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dayNum = d.getDay() || 7
  d.setDate(d.getDate() + 4 - dayNum)
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

function getDateStr(date: Date): string {
  return date.toISOString().split('T')[0]
}

function countThisWeek(member: MemberState, weekKey: string): number {
  return member.checkins.filter(c => {
    const d = new Date(c.scheduledAt)
    return getWeekKey(d) === weekKey
  }).length
}

function countCouplesThisWeek(member: MemberState, weekKey: string): number {
  return member.checkins.filter(c => {
    const d = new Date(c.scheduledAt)
    return getWeekKey(d) === weekKey && c.category === 'couples'
  }).length
}

function selectQuestion(memberId: string, memberState: MemberState): PulseQuestion | null {
  const isKid = KIDS.includes(memberId)
  const isParent = PARENTS.includes(memberId)

  // Filter eligible questions
  const eligible = QUESTION_BANK.filter(q => {
    if (q.ageGroup === 'kids' && !isKid) return false
    if (q.ageGroup === 'adults' && isKid) return false
    if (q.ageGroup === 'couples' && !isParent) return false
    if (q.ageGroup === 'parenting' && !isParent) return false
    // Parenting questions are only selected for 'mike' (sent jointly to both)
    // This prevents double-scheduling — mike's schedule triggers the joint send
    if (q.ageGroup === 'parenting' && memberId !== 'mike') return false
    // Don't repeat the same question within 10 check-ins
    const recentIds = memberState.checkins.slice(-10).map(c => c.questionId)
    if (recentIds.includes(q.id)) return false
    return true
  })

  if (eligible.length === 0) return null

  // Check couples budget
  const weekKey = getWeekKey(new Date())
  const couplesUsed = countCouplesThisWeek(memberState, weekKey)

  // Score each question
  const scored = eligible.map(q => {
    let score = q.weight

    // Category freshness bonus
    const recentCats = memberState.categoryHistory.slice(-3)
    const catCount = recentCats.filter(c => c === q.category).length
    if (catCount === 0) score *= 2.0
    else if (catCount === 1) score *= 1.0
    else score *= 0.3

    // Couples budget check
    if (q.category === 'couples' && couplesUsed >= COUPLES_MAX_PER_WEEK) score = 0

    return { question: q, score }
  }).filter(s => s.score > 0)

  if (scored.length === 0) return null

  // Weighted random from top 5
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 5)
  const totalWeight = top.reduce((sum, s) => sum + s.score, 0)
  let rand = Math.random() * totalWeight
  for (const s of top) {
    rand -= s.score
    if (rand <= 0) return s.question
  }
  return top[0].question
}

/**
 * Run the daily scheduling algorithm.
 * Determines which members get a check-in today (probabilistic ~50% each).
 */
export async function scheduleDailyCheckins(): Promise<PulseCheckin[]> {
  const state = await getState()
  const today = getDateStr(new Date())
  const weekKey = getWeekKey(new Date())
  const isWeekend = [0, 6].includes(new Date().getDay())
  const scheduled: PulseCheckin[] = []

  for (const memberId of FAMILY_MEMBERS) {
    const member = state.members[memberId]

    // Skip weekends by default
    if (isWeekend) continue

    // Already checked in today
    if (member.lastCheckinDate === today) continue

    // Max per week reached
    if (countThisWeek(member, weekKey) >= MAX_PER_WEEK) continue

    // Never two days in a row
    if (member.lastCheckinDate) {
      const lastDate = new Date(member.lastCheckinDate)
      const todayDate = new Date(today)
      const diffDays = (todayDate.getTime() - lastDate.getTime()) / 86400000
      if (diffDays < 2) continue
    }

    // Probabilistic: ~50% chance per eligible day (ensures 2-3/week average)
    if (Math.random() > 0.55) continue

    const question = selectQuestion(memberId, member)
    if (!question) continue

    // Pick a random window for this member
    const windows = SCHEDULE_WINDOWS[memberId] || []
    const window = windows[Math.floor(Math.random() * windows.length)]
    if (!window) continue

    const checkin: PulseCheckin = {
      id: `fp_${generateId()}`,
      memberId,
      questionId: question.id,
      questionText: KIDS.includes(memberId) && question.kidsVersion ? question.kidsVersion : question.text,
      category: question.category,
      scheduledAt: new Date().toISOString(),
      deliveredAt: null,
      deliveryChannel: getMemberChannel(memberId),
      response: null,
      rating: null,
      respondedAt: null,
      notionPageId: null,
      flagged: false,
    }

    member.checkins.push(checkin)
    scheduled.push(checkin)
  }

  state.lastScheduleRun = new Date().toISOString()
  await saveState(state)
  return scheduled
}

/**
 * Deliver all pending (scheduled but not yet sent) check-ins.
 */
export async function deliverPending(): Promise<number> {
  const state = await getState()
  let delivered = 0

  for (const memberId of FAMILY_MEMBERS) {
    const member = state.members[memberId]
    const pending = member.checkins.filter(c => !c.deliveredAt && !c.response)

    for (const checkin of pending) {
      let sent = false

      if (checkin.category === 'parenting') {
        // Parenting questions go to BOTH parents jointly
        const message = [
          `🎮 ${BOT_NAME}'s Parenting Check-In!`,
          ``,
          checkin.questionText,
          ``,
          `${BOT_NAME} sent this to both of you. Talk it through together or reply separately — ${BOT_NAME} is listening! 💚`,
        ].join('\n')
        const results = await sendJointMessage(message)
        sent = results.mike || results.erin
      } else if (checkin.category === 'couples') {
        // Couples questions are private — just to this individual
        const message = [
          `🎮 ${BOT_NAME}'s Question Time!`,
          ``,
          checkin.questionText,
          ``,
          `This is private — just between you and ${BOT_NAME}. 💚`,
        ].join('\n')
        sent = await sendToMember(memberId, message)
      } else {
        // Standard individual check-in
        const message = [
          `🎮 ${BOT_NAME}'s Question Time!`,
          ``,
          checkin.questionText,
          ``,
          `This is just between you and ${BOT_NAME}. 💚`,
        ].join('\n')
        sent = await sendToMember(memberId, message)
      }

      if (sent) {
        checkin.deliveredAt = new Date().toISOString()
        member.lastCheckinDate = getDateStr(new Date())
        member.lastCategory = checkin.category
        member.categoryHistory.push(checkin.category)
        if (member.categoryHistory.length > 10) {
          member.categoryHistory = member.categoryHistory.slice(-10)
        }
        delivered++
      }
    }
  }

  await saveState(state)
  return delivered
}

/**
 * Send an immediate check-in to a specific member (admin/test use).
 */
export async function forceCheckin(memberId: string, questionId?: string): Promise<PulseCheckin | null> {
  const state = await getState()
  if (!state.members[memberId]) return null

  const member = state.members[memberId]
  let question: PulseQuestion | undefined

  if (questionId) {
    question = QUESTION_BANK.find(q => q.id === questionId)
  }
  if (!question) {
    question = selectQuestion(memberId, member) || undefined
  }
  if (!question) return null

  const checkin: PulseCheckin = {
    id: `fp_${generateId()}`,
    memberId,
    questionId: question.id,
    questionText: KIDS.includes(memberId) && question.kidsVersion ? question.kidsVersion : question.text,
    category: question.category,
    scheduledAt: new Date().toISOString(),
    deliveredAt: null,
    deliveryChannel: getMemberChannel(memberId),
    response: null,
    rating: null,
    respondedAt: null,
    notionPageId: null,
    flagged: false,
  }

  const message = [
    `🎮 ${BOT_NAME}'s Question Time!`,
    ``,
    checkin.questionText,
    ``,
    `This is just between you and ${BOT_NAME}. 💚`,
  ].join('\n')

  const sent = await sendToMember(memberId, message)
  if (sent) {
    checkin.deliveredAt = new Date().toISOString()
    member.lastCheckinDate = getDateStr(new Date())
    member.lastCategory = checkin.category
    member.categoryHistory.push(checkin.category)
  }

  member.checkins.push(checkin)
  await saveState(state)
  return checkin
}

// ─── Response Collection ─────────────────────────────────────��───────────────

const EMOJI_TO_RATING: Record<string, number> = {
  '😊': 5, '🙂': 4, '😐': 3, '😢': 2, '😡': 1, '😴': 2,
  '☀️': 5, '🌤️': 4, '⛅': 3, '🌧️': 2, '⛈️': 1,
}

function parseRating(text: string): number | null {
  const trimmed = text.trim()

  // Check emoji
  for (const [emoji, rating] of Object.entries(EMOJI_TO_RATING)) {
    if (trimmed.startsWith(emoji)) return rating
  }

  // Check number 1-5 at start
  const numMatch = trimmed.match(/^([1-5])\b/)
  if (numMatch) return parseInt(numMatch[1], 10)

  return null
}

const CONCERN_KEYWORDS = ['hurt', 'scared', 'bully', 'bullied', 'hate', 'alone', 'nobody', 'kill', 'die', 'afraid']

/**
 * Poll iMessage for new replies and match to pending check-ins.
 */
export async function collectResponses(): Promise<number> {
  const state = await getState()
  let collected = 0

  // Only poll iMessage members (Discord would need discord-dm-reader.ts)
  for (const memberId of ['erin', 'clara']) {
    const replies = await readReplies(memberId)
    if (replies.length === 0) continue

    const member = state.members[memberId]
    const pending = member.checkins.filter(c => c.deliveredAt && !c.respondedAt)
    if (pending.length === 0) continue

    // Match first reply to oldest pending check-in
    const checkin = pending[0]
    const replyText = replies[0]

    checkin.response = replyText
    checkin.rating = parseRating(replyText)
    checkin.respondedAt = new Date().toISOString()

    // Update streak
    member.currentStreak += 1

    // Check for concern keywords (kids only)
    if (KIDS.includes(memberId)) {
      const lower = replyText.toLowerCase()
      if (CONCERN_KEYWORDS.some(kw => lower.includes(kw))) {
        checkin.flagged = true
        state.alerts.push({
          id: `alert_${generateId()}`,
          memberId,
          type: 'keyword-flag',
          message: `${BOT_NAME} noticed some concerning words in ${memberId}'s response. ${BOT_NAME} wants to share privately.`,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        })
        await sendToParents(`🎮 ${BOT_NAME} noticed something about ${memberId}'s check-in response. ${BOT_NAME} wants to share privately — please check Notion or the Family Pulse dashboard.`)
      }
    }

    collected++
  }

  // Run pattern detection after collecting
  await detectPatterns(state)
  await saveState(state)
  return collected
}

/**
 * Manually record a response (from dashboard or Discord bot handler).
 */
export async function recordResponse(
  pulseId: string,
  memberId: string,
  response: string,
  rating?: number
): Promise<PulseCheckin | null> {
  const state = await getState()
  const member = state.members[memberId]
  if (!member) return null

  const idx = member.checkins.findIndex(c => c.id === pulseId)
  if (idx === -1) return null

  member.checkins[idx].response = response
  member.checkins[idx].rating = rating ?? parseRating(response)
  member.checkins[idx].respondedAt = new Date().toISOString()
  member.currentStreak += 1

  await detectPatterns(state)
  await saveState(state)
  return member.checkins[idx]
}

// ─── Pattern Detection ───────────────────────────────────────────────────────

async function detectPatterns(state: PulseState): Promise<void> {
  for (const memberId of FAMILY_MEMBERS) {
    const member = state.members[memberId]
    const recent = member.checkins.filter(c => c.respondedAt).slice(-10)
    const ratedRecent = recent.filter(c => c.rating !== null)

    // Low mood streak: 3+ consecutive ratings ≤ 2
    if (ratedRecent.length >= 3) {
      const lastThree = ratedRecent.slice(-3)
      const allLow = lastThree.every(c => c.rating !== null && c.rating <= 2)
      const existingAlert = state.alerts.find(
        a => a.memberId === memberId && a.type === 'low-mood-streak' && !a.acknowledged
      )
      if (allLow && !existingAlert) {
        state.alerts.push({
          id: `alert_${generateId()}`,
          memberId,
          type: 'low-mood-streak',
          message: `${BOT_NAME} noticed that ${memberId} has been feeling down for 3 check-ins in a row. ${BOT_NAME} thinks a conversation might help.`,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        })
        await sendToParents(`🎮 ${BOT_NAME} noticed something about ${memberId}. ${memberId} has been feeling down for the last 3 check-ins. ${BOT_NAME} thinks a conversation might help. 💚`)
      }
    }

    // Non-response streak: 3+ unanswered
    const unanswered = member.checkins.filter(c => c.deliveredAt && !c.respondedAt)
    if (unanswered.length >= 3) {
      const existingAlert = state.alerts.find(
        a => a.memberId === memberId && a.type === 'non-response' && !a.acknowledged
      )
      if (!existingAlert) {
        state.alerts.push({
          id: `alert_${generateId()}`,
          memberId,
          type: 'non-response',
          message: `${BOT_NAME} misses talking to ${memberId}. They haven't responded to 3+ check-ins.`,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        })
        await sendToParents(`🎮 ${BOT_NAME} misses talking to ${memberId}. They haven't responded to ${BOT_NAME}'s last ${unanswered.length} check-ins. Maybe worth checking in with them? 💚`)
      }
    }

    // Celebration: streak milestones
    if ([5, 10, 20, 50].includes(member.currentStreak)) {
      await sendToMember(memberId, `🎮 ${BOT_NAME} counted! That's ${member.currentStreak} in a row! ${BOT_NAME} does a little dance! 💃🎮`)
    }

    // Positivity boost: 3+ consecutive high ratings
    if (ratedRecent.length >= 3) {
      const lastThree = ratedRecent.slice(-3)
      if (lastThree.every(c => c.rating !== null && c.rating >= 4)) {
        // Only send once per streak (check if we already sent recently)
        const lastCelebration = member.checkins.find(
          c => c.response?.includes('feeling great')
        )
        if (!lastCelebration) {
          await sendToMember(memberId, `🎮 ${BOT_NAME} noticed you've been feeling great lately! That makes ${BOT_NAME} so happy! 💚`)
        }
      }
    }
  }

  // ── Couples pattern detection ──────────────────────────────────────────────
  const mikeRecent = state.members.mike?.checkins.filter(c => c.category === 'couples' && c.respondedAt).slice(-3) || []
  const erinRecent = state.members.erin?.checkins.filter(c => c.category === 'couples' && c.respondedAt).slice(-3) || []

  if (mikeRecent.length > 0 && erinRecent.length > 0) {
    const mikeLatest = mikeRecent[mikeRecent.length - 1]
    const erinLatest = erinRecent[erinRecent.length - 1]
    const weekKey = getWeekKey(new Date())

    const mikeThisWeek = mikeLatest && getWeekKey(new Date(mikeLatest.respondedAt!)) === weekKey
    const erinThisWeek = erinLatest && getWeekKey(new Date(erinLatest.respondedAt!)) === weekKey

    if (mikeThisWeek && erinThisWeek) {
      const bothLow = (mikeLatest.rating ?? 3) <= 2 && (erinLatest.rating ?? 3) <= 2
      const bothHigh = (mikeLatest.rating ?? 3) >= 4 && (erinLatest.rating ?? 3) >= 4

      if (bothLow) {
        const existing = state.alerts.find(a => a.type === 'couples-low' && getWeekKey(new Date(a.createdAt)) === weekKey)
        if (!existing) {
          state.alerts.push({
            id: `alert_${generateId()}`, memberId: 'couples', type: 'couples-low',
            message: `Both partners reported low connection this week.`,
            createdAt: new Date().toISOString(), acknowledged: false,
          })
          // Send to each separately — never reveal the other's answers
          await sendToMember('mike', `🎮 ${BOT_NAME} thinks this week has been a little tough. Sometimes a 20-minute walk together or a night out can help. ${BOT_NAME} believes in you two! 💚`)
          await sendToMember('erin', `🎮 ${BOT_NAME} thinks this week has been a little tough. Sometimes a 20-minute walk together or a night out can help. ${BOT_NAME} believes in you two! 💚`)
        }
      } else if (bothHigh) {
        const existing = state.alerts.find(a => a.type === 'couples-high' && getWeekKey(new Date(a.createdAt)) === weekKey)
        if (!existing) {
          state.alerts.push({
            id: `alert_${generateId()}`, memberId: 'couples', type: 'couples-high',
            message: `Both partners reported strong connection this week!`,
            createdAt: new Date().toISOString(), acknowledged: true,
          })
          await sendToMember('mike', `🎮 ${BOT_NAME} can tell things are good between you two! That makes ${BOT_NAME} happy! 🎮💚`)
          await sendToMember('erin', `🎮 ${BOT_NAME} can tell things are good between you two! That makes ${BOT_NAME} happy! 🎮💚`)
        }
      }
    }
  }
}

// ─── Stats & Brief Integration ───────────────────────────────────────────────

export interface PulseStats {
  sent: number
  responded: number
  avgRating: number | null
  streak: number
}

export async function getPulseStats(): Promise<Record<string, PulseStats>> {
  const state = await getState()
  const weekKey = getWeekKey(new Date())
  const stats: Record<string, PulseStats> = {}

  for (const memberId of FAMILY_MEMBERS) {
    const member = state.members[memberId]
    const thisWeek = member.checkins.filter(c => getWeekKey(new Date(c.scheduledAt)) === weekKey)
    const responded = thisWeek.filter(c => c.respondedAt)
    const ratings = responded.filter(c => c.rating !== null).map(c => c.rating as number)

    stats[memberId] = {
      sent: thisWeek.length,
      responded: responded.length,
      avgRating: ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      streak: member.currentStreak,
    }
  }

  return stats
}

export async function getAlerts(unacknowledgedOnly = true): Promise<PulseAlert[]> {
  const state = await getState()
  return unacknowledgedOnly ? state.alerts.filter(a => !a.acknowledged) : state.alerts
}

export async function acknowledgeAlert(alertId: string): Promise<boolean> {
  const state = await getState()
  const alert = state.alerts.find(a => a.id === alertId)
  if (!alert) return false
  alert.acknowledged = true
  await saveState(state)
  return true
}

/**
 * Generate the Family Pulse section for the weekly brief.
 * Returns family-friendly and parents-only versions.
 */
export async function generatePulseSection(): Promise<{ familySection: string; parentsSection: string }> {
  const stats = await getPulseStats()
  const alerts = await getAlerts()
  const state = await getState()

  // Family version (kid-friendly, no couples data)
  const familyLines = [`🎮 **${BOT_NAME}'s Family Pulse**`]
  const totalSent = Object.values(stats).reduce((s, m) => s + m.sent, 0)
  const totalResponded = Object.values(stats).reduce((s, m) => s + m.responded, 0)

  if (totalSent > 0) {
    familyLines.push(`Everyone checked in with ${BOT_NAME} this week! ${totalResponded}/${totalSent} answered.`)
    // Find streak leader
    const leader = Object.entries(stats).sort((a, b) => b[1].streak - a[1].streak)[0]
    if (leader && leader[1].streak > 0) {
      familyLines.push(`Streak leader: **${leader[0]}** (${leader[1].streak} in a row — ${BOT_NAME} is impressed!)`)
    }
  } else {
    familyLines.push(`${BOT_NAME} didn't send any check-ins this week. See you next week! 💚`)
  }
  familyLines.push(`Keep talking, keep sharing. ${BOT_NAME} is always here! 💚`)

  // Parents version (detailed stats + couples + alerts)
  const parentLines = [`🎮 **${BOT_NAME}'s Pulse Report — Parents Only**`]
  parentLines.push(`**Check-in Summary**`)
  for (const id of FAMILY_MEMBERS) {
    const s = stats[id]
    const ratingStr = s.avgRating !== null ? `, avg mood ${s.avgRating}` : ''
    parentLines.push(`- ${id}: ${s.responded}/${s.sent} responded${ratingStr}, streak ${s.streak}`)
  }

  // Couples summary
  const mikeC = state.members.mike?.checkins.filter(c => c.category === 'couples' && c.respondedAt).slice(-1)[0]
  const erinC = state.members.erin?.checkins.filter(c => c.category === 'couples' && c.respondedAt).slice(-1)[0]
  if (mikeC || erinC) {
    const mikeR = mikeC?.rating ?? '—'
    const erinR = erinC?.rating ?? '—'
    parentLines.push(`**Couples connection:** Mike ${mikeR}/5, Erin ${erinR}/5`)
  }

  if (alerts.length > 0) {
    parentLines.push(`**Alerts (${alerts.length}):** ${alerts.map(a => a.message).join('; ')}`)
  } else {
    parentLines.push(`**Alerts:** None — ${BOT_NAME} is happy!`)
  }

  return {
    familySection: familyLines.join('\n'),
    parentsSection: parentLines.join('\n'),
  }
}

/**
 * Get full state for API consumers.
 */
export async function getFullState(): Promise<PulseState> {
  return getState()
}

/**
 * Get a member's check-in history.
 */
export async function getMemberHistory(memberId: string, weekFilter?: string): Promise<PulseCheckin[]> {
  const state = await getState()
  const member = state.members[memberId]
  if (!member) return []

  if (weekFilter) {
    return member.checkins.filter(c => getWeekKey(new Date(c.scheduledAt)) === weekFilter)
  }
  return member.checkins
}

/**
 * Get pending (unanswered) check-ins.
 */
export async function getPending(): Promise<PulseCheckin[]> {
  const state = await getState()
  const pending: PulseCheckin[] = []
  for (const memberId of FAMILY_MEMBERS) {
    const member = state.members[memberId]
    pending.push(...member.checkins.filter(c => c.deliveredAt && !c.respondedAt))
  }
  return pending
}
