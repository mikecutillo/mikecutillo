/**
 * conversation.ts — BMO's pending conversation state manager
 *
 * When BMO asks someone a question (survey, onboarding, goal approval),
 * this tracks that BMO is waiting for their answer. When their next
 * message arrives, the conversation state tells the system what to do
 * with the response — before any NLP or intent detection runs.
 *
 * Pending conversations are scoped per (userId, channelId) so a user
 * can have pending questions in multiple channels simultaneously.
 *
 * Persisted to data/bmo-conversations.json so state survives bot restarts.
 */

import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data'
const FILE = path.join(DATA_DIR, 'bmo-conversations.json')
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConversationType =
  | 'onboarding'          // profile building (favorite subject, interests, etc.)
  | 'goal-approval'       // approve/reject proposed family goals
  | 'subscription-audit'  // keep/cancel subscriptions
  | 'survey'              // generic channel survey (digest frequency, news topics, etc.)
  | 'curfew'              // screen time curfew settings
  | 'freeform'            // open-ended question, store the raw answer

export interface PendingConversation {
  id: string
  userId: string           // Discord user ID
  memberId: string         // 'mike' | 'erin' | 'liam' | 'clara'
  channelId: string
  type: ConversationType
  questionText: string     // The exact question BMO asked
  options: Record<string, string>  // "1" -> "Math", "2" -> "Science", etc.
  actionPayload: Record<string, any>  // Context for processing the answer
  askedAt: string
  expiresAt: string
  bmoMessageId?: string    // Discord message ID of BMO's question (for reply-to detection)
}

interface ConversationStore {
  version: string
  pending: PendingConversation[]
}

// ─── Discord user ID → member ID mapping ────────────────────────────────────

const DISCORD_ID_MAP: Record<string, string> = {}

export function buildDiscordIdMap(): void {
  const envMap: Record<string, string> = {
    DISCORD_MIKE_ID: 'mike',
    DISCORD_ERIN_ID: 'erin',
    DISCORD_LIAM_ID: 'liam',
    DISCORD_CLARA_ID: 'clara',
  }
  for (const [envKey, memberId] of Object.entries(envMap)) {
    const discordId = process.env[envKey]
    if (discordId && discordId.trim()) {
      DISCORD_ID_MAP[discordId.trim()] = memberId
    }
  }
}

export function getMemberIdByDiscordId(discordUserId: string): string | null {
  return DISCORD_ID_MAP[discordUserId] || null
}

// ─── In-memory store + persistence ──────────────────────────────────────────

// Primary store is in-memory for speed; flushed to disk on writes
let store: ConversationStore = { version: '1.0', pending: [] }
let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  try {
    const raw = await fs.readFile(FILE, 'utf-8')
    store = JSON.parse(raw)
  } catch {
    store = { version: '1.0', pending: [] }
  }
  // Prune expired on load
  const now = Date.now()
  store.pending = store.pending.filter(p => new Date(p.expiresAt).getTime() > now)
  loaded = true
}

async function flush(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), 'utf-8')
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Register that BMO is waiting for a reply from this user in this channel.
 */
export async function setPending(conv: Omit<PendingConversation, 'id' | 'askedAt' | 'expiresAt'>): Promise<PendingConversation> {
  await load()

  const pending: PendingConversation = {
    ...conv,
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    askedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
  }

  // Replace any existing pending conversation for this user+channel
  store.pending = store.pending.filter(
    p => !(p.userId === conv.userId && p.channelId === conv.channelId)
  )
  store.pending.push(pending)

  await flush()
  return pending
}

/**
 * Check if BMO is expecting a response from this user in this channel.
 */
export async function getPending(userId: string, channelId: string): Promise<PendingConversation | null> {
  await load()

  const now = Date.now()
  const conv = store.pending.find(
    p => p.userId === userId && p.channelId === channelId && new Date(p.expiresAt).getTime() > now
  )

  return conv || null
}

/**
 * Check if a message is a reply to a specific BMO message (for reply-to detection).
 */
export async function getPendingByMessageId(bmoMessageId: string): Promise<PendingConversation | null> {
  await load()

  const now = Date.now()
  return store.pending.find(
    p => p.bmoMessageId === bmoMessageId && new Date(p.expiresAt).getTime() > now
  ) || null
}

/**
 * Clear a pending conversation after processing the response.
 */
export async function clearPending(userId: string, channelId: string): Promise<void> {
  await load()
  store.pending = store.pending.filter(
    p => !(p.userId === userId && p.channelId === channelId)
  )
  await flush()
}

/**
 * Get all pending conversations (for debugging / status).
 */
export async function getAllPending(): Promise<PendingConversation[]> {
  await load()
  const now = Date.now()
  store.pending = store.pending.filter(p => new Date(p.expiresAt).getTime() > now)
  return [...store.pending]
}

/**
 * Clear all pending conversations (reset).
 */
export async function clearAll(): Promise<void> {
  store.pending = []
  await flush()
}
