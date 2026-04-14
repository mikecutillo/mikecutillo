/**
 * family-profiles.ts — BMO's individual profile builder for each family member
 *
 * BMO builds a unique, private profile for each person through natural
 * conversation. Profiles inform how BMO personalizes check-ins, celebrates
 * wins, and adapts its tone.
 *
 * BMO messages each person INDIVIDUALLY — Mike gets his own relationship
 * with BMO, Erin gets hers. Nobody sees each other's profiles.
 */

import { readJSON, writeJSON } from './data'
import { sendToMember, getMemberChannel } from './family-messenger'

const BOT_NAME = process.env.BOT_NAME || 'BMO'
const FILE = 'family-profiles.json'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FamilyProfile {
  name: string
  role: 'co-admin' | 'kid'
  channel: string
  emoji: string
  color: string
  relationship: 'individual'
  onboarded: boolean
  onboardedAt: string | null
  interests: string[]
  strengths: string[]
  stressors: string[]
  goals: string[]
  communicationStyle: string | null
  loveLanguage: string | null
  personalValues: string[]
  // Kids-specific
  favoriteSubjects?: string[]
  friends?: string[]
  worries?: string[]
  dreams?: string[]
  // BMO's observations
  bmoNotes: string[]
  moodBaseline: number | null
  lastInteraction: string | null
  totalInteractions: number
  profileQuestionIndex: number
}

interface ProfileData {
  version: string
  profiles: Record<string, FamilyProfile>
}

async function getData(): Promise<ProfileData> {
  return readJSON<ProfileData>(FILE, { version: '1.0', profiles: {} })
}

async function saveData(data: ProfileData): Promise<void> {
  await writeJSON(FILE, data)
}

// ─── Onboarding Questions ────────────────────────────────────────────────────
// BMO asks these one at a time over multiple interactions to build profiles.
// Different questions for adults vs kids.

interface OnboardingQuestion {
  text: string
  field: string      // which profile field this populates
  parseAs: 'list' | 'single' | 'note'  // how to store the answer
}

const ADULT_ONBOARDING: OnboardingQuestion[] = [
  { text: `Hello! ${BOT_NAME} is so happy to meet you! ${BOT_NAME} wants to get to know you — not as "mom" or "dad" but as YOU. What do you enjoy doing when you have time just for yourself?`, field: 'interests', parseAs: 'list' },
  { text: `${BOT_NAME} thinks everyone has superpowers. What would you say yours are? What are you naturally good at?`, field: 'strengths', parseAs: 'list' },
  { text: `Life can be a lot sometimes. What tends to stress you out the most? ${BOT_NAME} wants to understand so ${BOT_NAME} can help.`, field: 'stressors', parseAs: 'list' },
  { text: `If you could accomplish one personal goal in the next 6 months (not work, not family — just for YOU), what would it be?`, field: 'goals', parseAs: 'list' },
  { text: `How do you prefer people communicate with you? Quick and direct? Gentle and warm? Detailed and thorough? ${BOT_NAME} wants to talk to you the way YOU like.`, field: 'communicationStyle', parseAs: 'single' },
  { text: `${BOT_NAME} has read about love languages — words of affirmation, acts of service, gifts, quality time, or physical touch. Which ones matter most to you?`, field: 'loveLanguage', parseAs: 'single' },
  { text: `What values do you want the Cutillo family to be known for? What matters most to you as a family?`, field: 'personalValues', parseAs: 'list' },
  { text: `Last one for now! Is there anything else you want ${BOT_NAME} to know about you? Anything at all — ${BOT_NAME} is all ears! 🎮`, field: 'bmoNotes', parseAs: 'note' },
]

const KID_ONBOARDING: OnboardingQuestion[] = [
  { text: `Hi! ${BOT_NAME} is so excited to talk to you! ${BOT_NAME} wants to be your friend. What's your favorite thing to do for fun?`, field: 'interests', parseAs: 'list' },
  { text: `${BOT_NAME} thinks you're awesome. What are you REALLY good at? It can be anything — school, sports, art, games, being funny, anything!`, field: 'strengths', parseAs: 'list' },
  { text: `What subjects do you like most at school? And which ones are the hardest? ${BOT_NAME} is curious!`, field: 'favoriteSubjects', parseAs: 'list' },
  { text: `Who are your best friends? ${BOT_NAME} wants to know about the people who make you happy!`, field: 'friends', parseAs: 'list' },
  { text: `Is there anything that worries you or makes you nervous? You can tell ${BOT_NAME} — it's totally private and ${BOT_NAME} won't tell anyone unless you want.`, field: 'worries', parseAs: 'list' },
  { text: `If you could be or do ANYTHING when you grow up, what would it be? Dream big! ${BOT_NAME} loves big dreams!`, field: 'dreams', parseAs: 'list' },
  { text: `Last question for now! What's one thing you wish your parents knew about you? ${BOT_NAME} will keep it private.`, field: 'bmoNotes', parseAs: 'note' },
]

// ─── Profile Operations ──────────────────────────────────────────────────────

export async function getProfile(memberId: string): Promise<FamilyProfile | null> {
  const data = await getData()
  return data.profiles[memberId] || null
}

export async function getAllProfiles(): Promise<Record<string, FamilyProfile>> {
  const data = await getData()
  return data.profiles
}

export async function updateProfile(memberId: string, updates: Partial<FamilyProfile>): Promise<FamilyProfile | null> {
  const data = await getData()
  if (!data.profiles[memberId]) return null
  data.profiles[memberId] = { ...data.profiles[memberId], ...updates }
  await saveData(data)
  return data.profiles[memberId]
}

/**
 * Record a response to an onboarding question and advance to the next one.
 */
export async function recordOnboardingResponse(
  memberId: string,
  response: string
): Promise<{ nextQuestion: string | null; profileComplete: boolean }> {
  const data = await getData()
  const profile = data.profiles[memberId]
  if (!profile) return { nextQuestion: null, profileComplete: false }

  const questions = profile.role === 'kid' ? KID_ONBOARDING : ADULT_ONBOARDING
  const currentIdx = profile.profileQuestionIndex

  if (currentIdx >= questions.length) {
    return { nextQuestion: null, profileComplete: true }
  }

  const question = questions[currentIdx]

  // Store the response in the appropriate field
  if (question.parseAs === 'list') {
    // Split by commas or newlines, trim
    const items = response.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    const existing = (profile as any)[question.field] || []
    ;(profile as any)[question.field] = [...existing, ...items]
  } else if (question.parseAs === 'single') {
    ;(profile as any)[question.field] = response.trim()
  } else if (question.parseAs === 'note') {
    profile.bmoNotes.push(response.trim())
  }

  profile.profileQuestionIndex = currentIdx + 1
  profile.lastInteraction = new Date().toISOString()
  profile.totalInteractions += 1

  // Check if onboarding is complete
  if (profile.profileQuestionIndex >= questions.length) {
    profile.onboarded = true
    profile.onboardedAt = new Date().toISOString()
    await saveData(data)

    // Send completion message
    await sendToMember(memberId, [
      `🎮 ${BOT_NAME} is SO happy! ${BOT_NAME} feels like ${BOT_NAME} knows you so much better now!`,
      ``,
      `${BOT_NAME} will use everything you shared to be a better friend to you.`,
      `Remember — what you told ${BOT_NAME} is private. ${BOT_NAME} keeps your secrets safe. 💚`,
      ``,
      `${BOT_NAME} will check in with you a few times a week. Talk to you soon!`,
    ].join('\n'))

    return { nextQuestion: null, profileComplete: true }
  }

  // Get next question
  const next = questions[profile.profileQuestionIndex]
  await saveData(data)
  return { nextQuestion: next.text, profileComplete: false }
}

/**
 * Start onboarding for a family member — send the first question.
 */
export async function startOnboarding(memberId: string): Promise<boolean> {
  const data = await getData()
  const profile = data.profiles[memberId]
  if (!profile) return false
  if (profile.onboarded) return false // already done

  const questions = profile.role === 'kid' ? KID_ONBOARDING : ADULT_ONBOARDING
  const currentIdx = profile.profileQuestionIndex

  if (currentIdx >= questions.length) return false

  const question = questions[currentIdx]

  const intro = currentIdx === 0
    ? [
        `🎮 Hey ${profile.name}! It's ${BOT_NAME}!`,
        ``,
        `${BOT_NAME} is the Cutillo family's AI companion. ${BOT_NAME} is here for EVERYONE — equally and independently.`,
        ``,
        `${BOT_NAME} wants to build a real relationship with you — to know what makes you tick, what you care about, what stresses you out, and how ${BOT_NAME} can actually be helpful.`,
        ``,
        `Everything you tell ${BOT_NAME} is private. ${BOT_NAME} doesn't share your answers with anyone (not even ${profile.role === 'kid' ? 'your parents' : 'your partner'}) unless there's a safety concern.`,
        ``,
        `${BOT_NAME} has a few questions to get started. Just reply naturally — there are no wrong answers! Here's the first one:`,
        ``,
        question.text,
      ].join('\n')
    : question.text

  const sent = await sendToMember(memberId, intro)
  if (sent) {
    profile.lastInteraction = new Date().toISOString()
    await saveData(data)
  }
  return sent
}

/**
 * Send the next onboarding question (after receiving a response).
 */
export async function sendNextQuestion(memberId: string): Promise<boolean> {
  const data = await getData()
  const profile = data.profiles[memberId]
  if (!profile || profile.onboarded) return false

  const questions = profile.role === 'kid' ? KID_ONBOARDING : ADULT_ONBOARDING
  const idx = profile.profileQuestionIndex

  if (idx >= questions.length) return false

  const question = questions[idx]
  const remaining = questions.length - idx
  const progressNote = remaining <= 2 ? `\n\n(Almost done — ${remaining} more!)` : ''

  const sent = await sendToMember(memberId, `${question.text}${progressNote}`)
  return sent
}

/**
 * Add a note to someone's profile (from BMO's observations during conversations).
 */
export async function addBmoNote(memberId: string, note: string): Promise<boolean> {
  const data = await getData()
  if (!data.profiles[memberId]) return false
  data.profiles[memberId].bmoNotes.push(`[${new Date().toISOString().split('T')[0]}] ${note}`)
  await saveData(data)
  return true
}

/**
 * Get a summary of a member's profile for BMO to reference.
 */
export async function getProfileSummary(memberId: string): Promise<string> {
  const profile = await getProfile(memberId)
  if (!profile) return 'No profile found.'
  if (!profile.onboarded) return `${profile.name} hasn't been onboarded yet.`

  const lines = [`**${BOT_NAME}'s Profile: ${profile.name}**`]

  if (profile.interests.length > 0) lines.push(`Interests: ${profile.interests.join(', ')}`)
  if (profile.strengths.length > 0) lines.push(`Strengths: ${profile.strengths.join(', ')}`)
  if (profile.stressors && profile.stressors.length > 0) lines.push(`Stressors: ${profile.stressors.join(', ')}`)
  if (profile.goals && profile.goals.length > 0) lines.push(`Goals: ${profile.goals.join(', ')}`)
  if (profile.communicationStyle) lines.push(`Communication style: ${profile.communicationStyle}`)
  if (profile.loveLanguage) lines.push(`Love language: ${profile.loveLanguage}`)
  if (profile.personalValues && profile.personalValues.length > 0) lines.push(`Values: ${profile.personalValues.join(', ')}`)
  if (profile.favoriteSubjects && profile.favoriteSubjects.length > 0) lines.push(`Favorite subjects: ${profile.favoriteSubjects.join(', ')}`)
  if (profile.friends && profile.friends.length > 0) lines.push(`Friends: ${profile.friends.join(', ')}`)
  if (profile.dreams && profile.dreams.length > 0) lines.push(`Dreams: ${profile.dreams.join(', ')}`)
  if (profile.bmoNotes.length > 0) lines.push(`Notes: ${profile.bmoNotes.join('; ')}`)
  lines.push(`Interactions: ${profile.totalInteractions}`)

  return lines.join('\n')
}
