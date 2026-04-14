/**
 * memory.ts — BMO's learning system
 *
 * Logs every interaction so BMO can learn from questions over time.
 * Tracks: what was asked, who asked it, which channel, what BMO answered,
 * and whether the user seemed satisfied.
 *
 * The memory file grows over time — BMO uses it to spot patterns,
 * remember preferences, and get smarter.
 */

import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data'
const MEMORY_FILE = path.join(DATA_DIR, 'bmo-memory.json')

export interface BmoInteraction {
  id: string
  timestamp: string
  userId: string
  username: string
  channelId: string
  channelName: string        // human-readable channel name
  question: string           // what the user said
  response: string           // what BMO replied
  intent: string             // classified intent (screen-time, status, greeting, etc.)
  dataSourcesUsed: string[]  // which data files BMO queried
  responseTimeMs: number     // how long it took to respond
}

export interface BmoMemory {
  version: string
  totalInteractions: number
  firstInteraction: string | null
  interactions: BmoInteraction[]
  // Learned patterns: track frequently asked questions
  frequentTopics: Record<string, number>  // topic -> count
  userPreferences: Record<string, {       // userId -> preferences
    favoriteQuestions: string[]
    lastSeen: string
  }>
}

const EMPTY_MEMORY: BmoMemory = {
  version: '1.0',
  totalInteractions: 0,
  firstInteraction: null,
  interactions: [],
  frequentTopics: {},
  userPreferences: {},
}

// Keep last 500 interactions in memory (older ones are summarized in frequentTopics)
const MAX_INTERACTIONS = 500

async function readMemory(): Promise<BmoMemory> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { ...EMPTY_MEMORY }
  }
}

async function writeMemory(memory: BmoMemory): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf-8')
}

/**
 * Log a new interaction to BMO's memory
 */
export async function logInteraction(interaction: Omit<BmoInteraction, 'id'>): Promise<void> {
  const memory = await readMemory()

  const entry: BmoInteraction = {
    ...interaction,
    id: `bmo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  }

  memory.interactions.push(entry)
  memory.totalInteractions += 1

  if (!memory.firstInteraction) {
    memory.firstInteraction = interaction.timestamp
  }

  // Update frequent topics
  if (interaction.intent) {
    memory.frequentTopics[interaction.intent] =
      (memory.frequentTopics[interaction.intent] || 0) + 1
  }

  // Update user preferences
  if (!memory.userPreferences[interaction.userId]) {
    memory.userPreferences[interaction.userId] = {
      favoriteQuestions: [],
      lastSeen: interaction.timestamp,
    }
  }
  const userPref = memory.userPreferences[interaction.userId]
  userPref.lastSeen = interaction.timestamp

  // Track their question patterns (keep last 10)
  userPref.favoriteQuestions.push(interaction.question)
  if (userPref.favoriteQuestions.length > 10) {
    userPref.favoriteQuestions = userPref.favoriteQuestions.slice(-10)
  }

  // Trim old interactions
  if (memory.interactions.length > MAX_INTERACTIONS) {
    memory.interactions = memory.interactions.slice(-MAX_INTERACTIONS)
  }

  await writeMemory(memory)
}

/**
 * Get recent interactions for context
 */
export async function getRecentInteractions(limit = 20): Promise<BmoInteraction[]> {
  const memory = await readMemory()
  return memory.interactions.slice(-limit)
}

/**
 * Get the full memory summary (for AI context)
 */
export async function getMemorySummary(): Promise<string> {
  const memory = await readMemory()

  const topTopics = Object.entries(memory.frequentTopics)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([topic, count]) => `  ${topic}: ${count} times`)
    .join('\n')

  return [
    `BMO Memory Summary`,
    `Total interactions: ${memory.totalInteractions}`,
    `First interaction: ${memory.firstInteraction || 'never'}`,
    `Active users: ${Object.keys(memory.userPreferences).length}`,
    ``,
    `Top topics:`,
    topTopics || '  (none yet)',
  ].join('\n')
}

/**
 * Get a user's past questions for personalization
 */
export async function getUserHistory(userId: string): Promise<string[]> {
  const memory = await readMemory()
  return memory.userPreferences[userId]?.favoriteQuestions || []
}
