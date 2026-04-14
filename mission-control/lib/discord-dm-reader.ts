/**
 * discord-dm-reader.ts — Poll Discord DM channels for new messages
 *
 * Used by family-pulse.ts to collect responses from Mike and Liam
 * (who receive check-ins via Discord DM).
 *
 * Requires DISCORD_BOT_TOKEN in .env.local.
 */

export interface DMMessage {
  id: string
  content: string
  authorId: string
  timestamp: string
}

/**
 * Open a DM channel with a user (or return existing).
 */
async function getDMChannelId(userId: string): Promise<string | null> {
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

/**
 * Read messages from a DM channel, optionally after a specific message ID.
 *
 * @param userId - Discord user ID to read DMs from
 * @param afterMessageId - Only fetch messages after this ID (for incremental polling)
 * @returns Array of messages from the USER (not from the bot)
 */
export async function readDiscordDMHistory(
  userId: string,
  afterMessageId?: string
): Promise<DMMessage[]> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) return []

  const channelId = await getDMChannelId(userId)
  if (!channelId) return []

  // Build URL with optional after parameter
  let url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=20`
  if (afterMessageId) {
    url += `&after=${afterMessageId}`
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bot ${token}` },
  })

  if (!res.ok) {
    console.error(`[discord-dm-reader] Failed to read DMs for ${userId}: ${res.status}`)
    return []
  }

  const messages: any[] = await res.json()

  // Get bot's own user ID to filter out bot messages
  const botRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${token}` },
  })
  const botUser = botRes.ok ? await botRes.json() : { id: '' }

  // Return only messages from the user (not from the bot)
  return messages
    .filter((m: any) => m.author.id !== botUser.id && m.content)
    .map((m: any) => ({
      id: m.id,
      content: m.content,
      authorId: m.author.id,
      timestamp: m.timestamp,
    }))
    .reverse() // oldest first
}
