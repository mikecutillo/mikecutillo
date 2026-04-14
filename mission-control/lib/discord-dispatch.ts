/**
 * discord-dispatch.ts — Discord webhook dispatcher for Mission Control
 *
 * Maps logical channel names to DISCORD_WH_* env vars and posts embeds.
 * Rate-limited to 30 req/min per webhook (Discord's limit).
 * Webhook username uses BOT_NAME (defaults to "BMO").
 */

const BOT_NAME = process.env.BOT_NAME || 'BMO'

const CHANNEL_ENV_MAP: Record<string, string> = {
  'announcements':    'DISCORD_WH_ANNOUNCEMENTS',
  'general':          'DISCORD_WH_GENERAL',
  'calendar':         'DISCORD_WH_CALENDAR',
  'school':           'DISCORD_WH_SCHOOL',
  'screen-time':      'DISCORD_WH_SCREEN_TIME',
  'bills':            'DISCORD_WH_BILLS',
  'cash-flow':        'DISCORD_WH_CASH_FLOW',
  'subscriptions':    'DISCORD_WH_SUBSCRIPTIONS',
  'financial-digest': 'DISCORD_DIGEST_WEBHOOK',
  'job-pipeline':     'DISCORD_WH_JOB_PIPELINE',
  'applications':     'DISCORD_WH_APPLICATIONS',
  'resume':           'DISCORD_WH_RESUME',
  'network':          'DISCORD_WH_NETWORK',
  'cloud':            'DISCORD_WH_CLOUD',
  'smart-home':       'DISCORD_WH_SMART_HOME',
  'bot-log':          'DISCORD_WH_BOT_LOG',
  'news':             'DISCORD_WH_NEWS',
  'content':          'DISCORD_WH_CONTENT',
  'misc':             'DISCORD_WH_MISC',
  'grocery':          'DISCORD_WH_GROCERY',
}

// Brand colors matching Mission Control sections
export const DISCORD_COLORS = {
  family:   0x26C26E, // green — family hub
  finance:  0xF5A623, // gold — money
  jobs:     0x22C55E, // green — unemployment section
  infra:    0x5EEAD4, // teal — cutillo cloud
  intel:    0x7C8CFF, // blue — city
  alert:    0xE05C5C, // red — urgent
  bot:      0x5E6AD2, // indigo — turbodot
  grocery:  0x26C26E, // green — grocery deals
} as const

export interface DiscordEmbed {
  title: string
  description?: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string
}

interface WebhookPayload {
  content?: string
  embeds?: DiscordEmbed[]
  username?: string
  avatar_url?: string
}

// Simple per-webhook rate limiter: track last call timestamps
const lastCallTimestamps: Record<string, number[]> = {}
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
const RATE_LIMIT_MAX = 28 // leave 2 buffer under Discord's 30/min

async function waitForRateLimit(webhookUrl: string): Promise<void> {
  const now = Date.now()
  if (!lastCallTimestamps[webhookUrl]) lastCallTimestamps[webhookUrl] = []

  // Prune old timestamps
  lastCallTimestamps[webhookUrl] = lastCallTimestamps[webhookUrl].filter(
    t => now - t < RATE_LIMIT_WINDOW
  )

  if (lastCallTimestamps[webhookUrl].length >= RATE_LIMIT_MAX) {
    const oldest = lastCallTimestamps[webhookUrl][0]
    const waitMs = RATE_LIMIT_WINDOW - (now - oldest) + 100
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }

  lastCallTimestamps[webhookUrl].push(Date.now())
}

/**
 * Post an embed to a Discord channel via webhook.
 *
 * @param channel - Logical channel name (e.g. 'screen-time', 'bills', 'bot-log')
 * @param embed - Discord embed object
 * @param content - Optional plain text content (appears above embed)
 * @returns true if sent successfully, false if webhook not configured
 */
export async function postToDiscord(
  channel: string,
  embed: DiscordEmbed,
  content?: string
): Promise<boolean> {
  const envKey = CHANNEL_ENV_MAP[channel]
  if (!envKey) {
    console.warn(`[discord-dispatch] Unknown channel: ${channel}`)
    return false
  }

  const webhookUrl = process.env[envKey]
  if (!webhookUrl) {
    // Webhook not configured yet — silent skip
    return false
  }

  // Add default footer if not set
  if (!embed.footer) {
    embed.footer = { text: 'Mission Control' }
  }
  if (!embed.timestamp) {
    embed.timestamp = new Date().toISOString()
  }

  const payload: WebhookPayload = {
    embeds: [embed],
    username: BOT_NAME,
  }
  if (content) payload.content = content

  try {
    await waitForRateLimit(webhookUrl)

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.status === 429) {
      // Rate limited by Discord — wait and retry once
      const retryAfter = Number(res.headers.get('Retry-After') || '2') * 1000
      await new Promise(resolve => setTimeout(resolve, retryAfter))
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    if (!res.ok && res.status !== 429) {
      console.error(`[discord-dispatch] ${channel}: HTTP ${res.status}`)
      return false
    }

    return true
  } catch (e: any) {
    console.error(`[discord-dispatch] ${channel}: ${e.message}`)
    return false
  }
}

/**
 * Post to multiple channels at once (e.g. bills → #bills + #financial-digest)
 */
export async function postToMultiple(
  channels: string[],
  embed: DiscordEmbed,
  content?: string
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {}
  for (const ch of channels) {
    results[ch] = await postToDiscord(ch, embed, content)
  }
  return results
}

/**
 * Get the webhook URL for a channel (for external callers like digest-engine.py)
 */
export function getWebhookUrl(channel: string): string | undefined {
  const envKey = CHANNEL_ENV_MAP[channel]
  return envKey ? process.env[envKey] : undefined
}
