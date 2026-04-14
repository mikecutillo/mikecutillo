/**
 * BMO — The Cutillo Family's Discord Companion
 *
 * A living bot that sits in every channel of Cutillo HQ Discord,
 * answers questions, shares data, processes survey responses,
 * and supports the family's growth.
 *
 * Key behaviors:
 * 1. Pending conversation check — if BMO asked you a question, your reply
 *    is the answer. This runs BEFORE intent detection.
 * 2. Normal Q&A — intent detection + data queries for everything else.
 * 3. Scheduler — automated data feeds on a timer (screen time, bills, etc.)
 *
 * Start: npx tsx bmo/index.ts
 *   or: npm run bmo
 */

import { Client, GatewayIntentBits, Message, Partials, ChannelType } from 'discord.js'
import { processMessage } from './brain'
import { getPending, getPendingByMessageId, clearPending, setPending, buildDiscordIdMap, getMemberIdByDiscordId } from './conversation'
import { processResponse } from './actions'
import { logInteraction } from './memory'
import { startScheduler } from './scheduler'
import dotenv from 'dotenv'
import path from 'path'

// Load environment from mission-control's .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const TOKEN = process.env.DISCORD_BOT_TOKEN

if (!TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN is not set in .env.local')
  process.exit(1)
}

// Build the Discord ID → member ID map
buildDiscordIdMap()

// ─── Create the Discord client ──────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel,  // needed for DM support
    Partials.Message,
  ],
})

// ─── Channel name cache ─────────────────────────────────────────────────────

const channelNameCache = new Map<string, string>()

function getChannelName(message: Message): string {
  if (message.channel.type === ChannelType.DM) return 'dm'

  const cached = channelNameCache.get(message.channelId)
  if (cached) return cached

  if ('name' in message.channel && message.channel.name) {
    channelNameCache.set(message.channelId, message.channel.name)
    return message.channel.name
  }

  return 'unknown'
}

// ─── Should BMO respond? (for normal Q&A, NOT survey responses) ─────────────

function shouldRespond(message: Message): boolean {
  if (message.author.id === client.user?.id) return false
  if (message.author.bot) return false
  if (message.channel.type === ChannelType.DM) return true

  const content = message.content.toLowerCase()
  if (message.mentions.has(client.user!.id)) return true
  if (/\bbmo\b/i.test(content)) return true
  if (content.trim().endsWith('?') && content.length > 10) return true
  if (/^(hey|hi|hello|yo)\s/i.test(content) && content.length < 40) return true

  return false
}

// ─── Reply helper (handles Discord's 2000 char limit) ───────────────────────

async function sendReply(message: Message, text: string): Promise<void> {
  if (text.length <= 2000) {
    await message.reply(text)
    return
  }

  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > 1900) {
      chunks.push(current)
      current = line
    } else {
      current = current ? current + '\n' + line : line
    }
  }
  if (current) chunks.push(current)

  for (const chunk of chunks) {
    await message.reply(chunk)
  }
}

// ─── Message Handler ────────────────────────────────────────────────────────

client.on('messageCreate', async (message: Message) => {
  // Never respond to self or bots
  if (message.author.id === client.user?.id) return
  if (message.author.bot) return

  const channelName = getChannelName(message)
  const startTime = Date.now()

  // ─── PRIORITY 1: Check for pending conversation ───────────────────────
  // If BMO asked this user a question in this channel, their message is the answer.
  // This runs BEFORE shouldRespond() because survey answers like "3" or "yes"
  // would fail the normal response filters.

  let pending = await getPending(message.author.id, message.channelId)

  // Also check if this is a Discord reply-to one of BMO's messages
  if (!pending && message.reference?.messageId) {
    const refPending = await getPendingByMessageId(message.reference.messageId)
    if (refPending && refPending.userId === message.author.id) {
      pending = refPending
    }
  }

  if (pending) {
    try {
      if ('sendTyping' in message.channel) {
        await (message.channel as any).sendTyping()
      }

      const result = await processResponse(pending, message.content)

      // Clear the old pending conversation
      await clearPending(message.author.id, message.channelId)

      // If there's a follow-up question, register it
      if (result.nextPending) {
        const sent = await sendReply(message, result.reply + '\n\n' + result.nextPending.questionText)
        await setPending(result.nextPending)
      } else {
        await sendReply(message, result.reply)
      }

      // Log to memory
      logInteraction({
        timestamp: new Date().toISOString(),
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channelId,
        channelName,
        question: message.content,
        response: result.reply,
        intent: `survey-response:${pending.type}`,
        dataSourcesUsed: result.dataUpdated ? [result.dataUpdated] : [],
        responseTimeMs: Date.now() - startTime,
      }).catch(() => {})

      console.log(
        `[BMO] #${channelName} | ${message.author.username}: "${message.content.slice(0, 40)}" → [${pending.type}] ${result.dataUpdated ? `✏️ ${result.dataUpdated}` : ''}`
      )

      return // Done — don't fall through to normal Q&A
    } catch (err: any) {
      console.error(`[BMO] Error processing survey response: ${err.message}`)
      try {
        await message.reply("BMO tried to process your answer but had a glitch. Try again? 🔧")
      } catch {}
      return
    }
  }

  // ─── PRIORITY 2: Normal Q&A (intent detection + data queries) ──────────

  if (!shouldRespond(message)) return

  let text = message.content
  if (client.user) {
    text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim()
  }
  if (!text || text.length < 2) {
    text = 'hello'
  }

  try {
    if ('sendTyping' in message.channel) {
      await (message.channel as any).sendTyping()
    }

    const response = await processMessage(
      text,
      channelName,
      message.channelId,
      message.author.id,
      message.author.username
    )

    await sendReply(message, response.text)

    console.log(
      `[BMO] #${channelName} | ${message.author.username}: "${text.slice(0, 60)}" → [${response.intent}] (${response.dataSources.join(', ')})`
    )
  } catch (err: any) {
    console.error(`[BMO] Error processing message: ${err.message}`)
    try {
      await message.reply("Oops! BMO had a little glitch. Try asking again? 🔧")
    } catch {}
  }
})

// ─── Ready Handler ──────────────────────────────────────────────────────────

client.on('ready', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║                                          ║
  ║    🎮  BMO is online!                    ║
  ║                                          ║
  ║    Logged in as: ${(client.user?.tag || 'unknown').padEnd(21)}║
  ║    Guilds: ${String(client.guilds.cache.size).padEnd(29)}║
  ║    Channels visible: ${String(client.channels.cache.size).padEnd(19)}║
  ║                                          ║
  ║    Ready to help the Cutillo family! 💚  ║
  ║                                          ║
  ╚══════════════════════════════════════════╝
  `)

  // Build channel name cache
  for (const [, guild] of client.guilds.cache) {
    console.log(`  Guild: ${guild.name} (${guild.memberCount} members)`)
    const textChannels = guild.channels.cache.filter(
      c => c.type === ChannelType.GuildText
    )
    for (const [, channel] of textChannels) {
      console.log(`    #${channel.name}`)
      channelNameCache.set(channel.id, channel.name)
    }
  }

  // Start the scheduler (automated data feeds)
  startScheduler(client, channelNameCache)
})

// ─── Error Handling ─────────────────────────────────────────────────────────

client.on('error', (error) => {
  console.error(`[BMO] Client error: ${error.message}`)
})

process.on('unhandledRejection', (reason) => {
  console.error(`[BMO] Unhandled rejection:`, reason)
})

process.on('SIGINT', () => {
  console.log('\n[BMO] Shutting down gracefully... Bye bye! 💚')
  client.destroy()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n[BMO] Shutting down gracefully... Bye bye! 💚')
  client.destroy()
  process.exit(0)
})

// ─── Connect! ───────────────────────────────────────────────────────────────

console.log('[BMO] Starting up...')
client.login(TOKEN).catch((err) => {
  console.error(`❌ Failed to login: ${err.message}`)
  console.error('')
  console.error('Common fixes:')
  console.error('  1. Check DISCORD_BOT_TOKEN in .env.local')
  console.error('  2. Enable MESSAGE CONTENT INTENT in Discord Developer Portal:')
  console.error('     → Your App → Bot → Privileged Gateway Intents → Message Content Intent')
  console.error('  3. Make sure the bot is invited to your server with proper permissions')
  process.exit(1)
})
