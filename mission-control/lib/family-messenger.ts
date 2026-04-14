/**
 * family-messenger.ts — Unified messaging layer for the Cutillo family
 *
 * Routes messages to the right channel per family member:
 * - Mike → Discord DM (co-admin)
 * - Erin → iMessage (co-admin, full control)
 * - Liam → Discord DM
 * - Clara → iMessage
 *
 * Mike and Erin are EQUAL co-admins. BMO has:
 * - Individual 1-on-1 relationships with each family member
 * - A joint "couple" channel for Mike+Erin together (parenting, goals, reports)
 *
 * Used by: discord-feedback.ts, family-pulse.ts, weekly-brief.ts
 */

import { sendiMessage, readNewMessages, isIMemberConfigured } from './imessage-bridge'

// Discord DM helper (extracted from discord-feedback.ts pattern)
async function openDiscordDM(userId: string): Promise<string | null> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token || !userId) return null

  const res = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  })

  if (!res.ok) return null
  const data = await res.json()
  return data.id
}

async function sendDiscordDM(userId: string, content: string): Promise<boolean> {
  const channelId = await openDiscordDM(userId)
  if (!channelId) return false

  const token = process.env.DISCORD_BOT_TOKEN
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })

  return res.ok
}

// Member routing config
type Channel = 'discord' | 'imessage'

interface MemberConfig {
  channel: Channel
  discordId?: string    // Discord user ID (for discord channel)
  imessageId?: string   // 'erin' or 'clara' (for imessage-bridge)
}

function getMemberConfig(memberId: string): MemberConfig {
  switch (memberId) {
    case 'mike':
      return { channel: 'discord', discordId: process.env.DISCORD_MIKE_ID }
    case 'erin':
      // Prefer iMessage if configured, fall back to Discord
      if (isIMemberConfigured('erin')) {
        return { channel: 'imessage', imessageId: 'erin' }
      }
      return { channel: 'discord', discordId: process.env.DISCORD_ERIN_ID }
    case 'liam':
      return { channel: 'discord', discordId: process.env.DISCORD_LIAM_ID }
    case 'clara':
      // Prefer iMessage if configured, fall back to Discord
      if (isIMemberConfigured('clara')) {
        return { channel: 'imessage', imessageId: 'clara' }
      }
      return { channel: 'discord', discordId: process.env.DISCORD_CLARA_ID }
    default:
      return { channel: 'discord' }
  }
}

/**
 * Send a message to a family member via their preferred channel.
 *
 * @param memberId - 'mike', 'erin', 'liam', or 'clara'
 * @param message - Text content
 * @returns true if sent successfully
 */
export async function sendToMember(memberId: string, message: string): Promise<boolean> {
  const config = getMemberConfig(memberId)

  if (config.channel === 'imessage' && config.imessageId) {
    return sendiMessage(config.imessageId, message)
  }

  if (config.channel === 'discord' && config.discordId) {
    return sendDiscordDM(config.discordId, message)
  }

  console.warn(`[family-messenger] No channel configured for ${memberId}`)
  return false
}

/**
 * Read new replies from a family member (iMessage members only).
 * Discord responses come through the bot's message handler instead.
 *
 * @param memberId - 'erin' or 'clara'
 * @returns Array of new message texts
 */
export async function readReplies(memberId: string): Promise<string[]> {
  const config = getMemberConfig(memberId)

  if (config.channel === 'imessage' && config.imessageId) {
    return readNewMessages(config.imessageId)
  }

  // Discord replies come through webhook/bot events, not polling
  return []
}

/**
 * Get the delivery channel name for display purposes.
 */
export function getMemberChannel(memberId: string): string {
  const config = getMemberConfig(memberId)
  return config.channel === 'imessage' ? 'iMessage' : 'Discord DM'
}

/**
 * Send a message to all family members.
 */
export async function sendToAll(message: string): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {}
  for (const id of ['mike', 'erin', 'liam', 'clara']) {
    results[id] = await sendToMember(id, message)
  }
  return results
}

/**
 * Send to parents only.
 */
export async function sendToParents(message: string): Promise<Record<string, boolean>> {
  return {
    mike: await sendToMember('mike', message),
    erin: await sendToMember('erin', message),
  }
}

/**
 * Send to kids only.
 */
export async function sendToKids(message: string): Promise<Record<string, boolean>> {
  return {
    liam: await sendToMember('liam', message),
    clara: await sendToMember('clara', message),
  }
}

// ─── Admin & Role Helpers ────────────────────────────────────────────────────

/** Both Mike and Erin are co-admins with full control */
const ADMINS = ['mike', 'erin']

export function isAdmin(memberId: string): boolean {
  return ADMINS.includes(memberId)
}

export function getAdmins(): string[] {
  return [...ADMINS]
}

// ─── Couple (Joint Mike + Erin) ──────────────────────────────────────────────

/**
 * Send a message to Mike and Erin TOGETHER as a couple.
 * Both receive the same message simultaneously on their own channels.
 * Used for: joint parenting check-ins, shared reports, goal discussions,
 * co-parenting decisions, weekly parents brief.
 *
 * This is different from sendToParents() — conceptually, sendToCouple()
 * is for conversations where BMO is talking to them AS a unit, not just
 * sending the same alert to two individuals.
 */
export async function sendToCouple(message: string): Promise<Record<string, boolean>> {
  return {
    mike: await sendToMember('mike', message),
    erin: await sendToMember('erin', message),
  }
}

/**
 * Send a couples message with a header indicating it's a joint message.
 * Both Mike and Erin see that the other person received it too.
 */
export async function sendJointMessage(message: string): Promise<Record<string, boolean>> {
  const BOT_NAME = process.env.BOT_NAME || 'BMO'
  const jointMessage = [
    `🎮 ${BOT_NAME} — Message for Mike & Erin`,
    `(You're both receiving this)`,
    ``,
    message,
  ].join('\n')

  return sendToCouple(jointMessage)
}

/**
 * Send the parents edition of a report to both admins jointly.
 */
export async function sendParentsReport(title: string, content: string): Promise<Record<string, boolean>> {
  const BOT_NAME = process.env.BOT_NAME || 'BMO'
  const report = [
    `🎮 ${BOT_NAME} — ${title}`,
    `(Parents report — you and your partner both have this)`,
    ``,
    content,
  ].join('\n')

  return sendToCouple(report)
}
