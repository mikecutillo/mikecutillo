import { NextRequest, NextResponse } from 'next/server'
import { generateWeeklyBrief, generateDailyDigest } from '@/lib/weekly-brief'
import { postToDiscord, DISCORD_COLORS } from '@/lib/discord-dispatch'
import { requestFeedback } from '@/lib/discord-feedback'
import { sendParentsReport } from '@/lib/family-messenger'

const BOT_NAME = process.env.BOT_NAME || 'BMO'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'weekly'

  if (type === 'daily') {
    const digest = await generateDailyDigest()
    return NextResponse.json(digest)
  }

  const brief = await generateWeeklyBrief()
  return NextResponse.json(brief)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'publish-weekly') {
    const brief = await generateWeeklyBrief()
    const reportId = `weekly-${new Date().toISOString().split('T')[0]}`

    // Post family version to #announcements (all family sees this)
    const familyPosted = await postToDiscord('announcements', {
      title: `${BOT_NAME}'s Weekly Report for the Cutillo Family`,
      description: brief.familyBrief.slice(0, 4000),
      color: DISCORD_COLORS.family,
    })

    // Send parents edition JOINTLY to Mike + Erin (both receive it)
    const parentsDelivered = await sendParentsReport(
      `${BOT_NAME}'s Weekly Report — Parents Edition`,
      brief.parentsBrief
    )

    // Request feedback from all family members on the announcement
    await requestFeedback(
      'announcements',
      reportId,
      `${BOT_NAME}'s Weekly Report`
    )

    // Post a learning moment if available
    if (brief.learningMoments.length > 0) {
      const moment = brief.learningMoments[0]
      await postToDiscord('announcements', {
        title: `${BOT_NAME}'s Did You Know? — ${moment.title}`,
        description: moment.content,
        color: DISCORD_COLORS.family,
        footer: { text: `Category: ${moment.category}` },
      })
    }

    return NextResponse.json({
      published: familyPosted,
      parentsDelivered,
      reportId,
      learningMoments: brief.learningMoments.length,
    })
  }

  if (action === 'publish-daily') {
    const digest = await generateDailyDigest()
    const results: Record<string, boolean> = {}

    for (const [channel, content] of Object.entries(digest)) {
      results[channel] = await postToDiscord(channel, {
        title: 'Daily Update',
        description: content,
        color: DISCORD_COLORS.bot,
      })
    }

    return NextResponse.json({ channels: results })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
