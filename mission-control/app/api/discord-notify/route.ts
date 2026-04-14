import { NextRequest, NextResponse } from 'next/server'
import { postToDiscord, postToMultiple, type DiscordEmbed } from '../../../lib/discord-dispatch'

/**
 * POST /api/discord-notify
 *
 * Internal endpoint for sending Discord notifications from any part of the system.
 * Body: { channel: string | string[], embed: DiscordEmbed, content?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { channel, channels, embed, content } = body as {
      channel?: string
      channels?: string[]
      embed: DiscordEmbed
      content?: string
    }

    if (!embed || (!channel && !channels)) {
      return NextResponse.json(
        { error: 'Missing required fields: channel (or channels) and embed' },
        { status: 400 }
      )
    }

    if (channels && Array.isArray(channels)) {
      const results = await postToMultiple(channels, embed, content)
      return NextResponse.json({ ok: true, results })
    }

    if (channel) {
      const sent = await postToDiscord(channel, embed, content)
      return NextResponse.json({ ok: true, sent, channel })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * GET /api/discord-notify
 *
 * Returns the list of configured channels and their webhook status.
 */
export async function GET() {
  const channelEnvMap: Record<string, string> = {
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
  }

  const status = Object.entries(channelEnvMap).map(([channel, envKey]) => ({
    channel,
    envKey,
    configured: !!process.env[envKey],
  }))

  const configured = status.filter(s => s.configured).length
  return NextResponse.json({ channels: status, configured, total: status.length })
}
