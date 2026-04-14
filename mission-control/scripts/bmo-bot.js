#!/usr/bin/env node
/**
 * bmo-bot.js — Persistent Discord bot for BMO
 *
 * Listens in Cutillo HQ server channels and DMs. Family members can
 * @mention BMO or DM it to ask questions, and BMO responds in-channel.
 *
 * BMO routes to the family-profiles onboarding system for DM conversations
 * and acts as a helpful family companion in group channels.
 *
 * Usage:
 *   node scripts/bmo-bot.js
 *   # or via pm2:
 *   pm2 start scripts/bmo-bot.js --name bmo-bot
 *
 * Requires: DISCORD_BOT_TOKEN, OPENAI_API_KEY in .env.local
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js')
const path = require('path')
const fs = require('fs')

// ─── Load env from mission-control/.env.local ───────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (val && !process.env[key]) {
      process.env[key] = val
    }
  }
}

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const OPENAI_KEY = process.env.OPENAI_API_KEY
const BOT_NAME = process.env.BOT_NAME || 'BMO'
const MIKE_ID = process.env.DISCORD_MIKE_ID
const DATA_DIR = path.join(__dirname, '..', 'data')

if (!BOT_TOKEN) {
  console.error('[bmo-bot] DISCORD_BOT_TOKEN is required. Add it to .env.local')
  process.exit(1)
}

// ─── Data helpers ───────────────────────────────────────────────────────────
function readJSON(filename) {
  const fp = path.join(DATA_DIR, filename)
  if (!fs.existsSync(fp)) return null
  return JSON.parse(fs.readFileSync(fp, 'utf-8'))
}

function writeJSON(filename, data) {
  const fp = path.join(DATA_DIR, filename)
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n')
}

// ─── Profile helpers ────────────────────────────────────────────────────────
function getProfile(memberId) {
  const data = readJSON('family-profiles.json')
  return data?.profiles?.[memberId] || null
}

function getMemberIdByDiscordId(discordId) {
  if (discordId === process.env.DISCORD_MIKE_ID) return 'mike'
  if (discordId === process.env.DISCORD_ERIN_ID) return 'erin'
  if (discordId === process.env.DISCORD_LIAM_ID) return 'liam'
  if (discordId === process.env.DISCORD_CLARA_ID) return 'clara'
  return null
}

// ─── BMO Intelligence Layer — Mission Control API commands ─────────────────
const MC_BASE = 'http://localhost:3333'

const COMMANDS = {
  calendar:      { keywords: ['calendar', 'schedule', "what's happening", 'whats happening', 'events', 'upcoming'], api: '/api/household-calendar', access: 'all' },
  jobs:          { keywords: ['jobs', 'applications', 'pipeline', 'job search', 'job pipeline'], api: '/api/job-pipeline', access: 'mike-only' },
  goals:         { keywords: ['goals', 'family goals', 'how are we doing'], api: '/api/family-goals', access: 'all' },
  bills:         { keywords: ['bills', 'finances', 'financial', 'ledger'], api: '/api/financial-ledger', access: 'parents-only' },
  router:        { keywords: ['router', 'devices', "who's online", 'whos online', 'network'], api: '/api/router', access: 'parents-only' },
  subscriptions: { keywords: ['subscriptions', 'subs', 'cloud storage'], api: '/api/cloud-subscriptions', access: 'parents-only' },
  brief:         { keywords: ['brief', 'weekly brief', 'weekly report'], api: '/api/weekly-brief', access: 'all' },
  heartbeat:     { keywords: ['heartbeat', 'status', 'health', 'ping'], api: '/api/heartbeat', access: 'all' },
  mission:       { keywords: ['mission', 'current mission', 'what are we working on'], api: '/api/current-mission', access: 'all' },
  email:         { keywords: ['email', 'inbox', 'digest', 'email digest'], api: '/api/email-digest', access: 'parents-only' },
  news:          { keywords: ['news', 'news feed'], api: '/api/social-news', access: 'all' },
  pulse:         { keywords: ['pulse', 'check-in', 'checkin', 'family pulse'], api: '/api/family-pulse?stats=true', access: 'all' },
  cleanup:       { keywords: ['cleanup', 'disk', 'clean up', 'disk cleanup'], api: '/api/cleanup-disk', access: 'mike-only', method: 'POST', body: { dryRun: true } },
}

function detectCommand(message) {
  const lower = message.toLowerCase().trim()
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    for (const keyword of cmd.keywords) {
      if (keyword.includes(' ')) {
        if (lower.includes(keyword)) return { name, ...cmd }
      } else {
        if (lower === keyword || lower.startsWith(keyword + ' ') || lower.endsWith(' ' + keyword)) return { name, ...cmd }
      }
    }
  }
  return null
}

function canAccessCommand(memberId, access) {
  if (access === 'all') return true
  if (access === 'parents-only') return memberId === 'mike' || memberId === 'erin'
  if (access === 'mike-only') return memberId === 'mike'
  return false
}

async function callMissionControl(apiPath, method, body) {
  try {
    const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${MC_BASE}${apiPath}`, { ...opts, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { error: `Mission Control returned ${res.status}` }
    return await res.json()
  } catch (e) {
    if (e.name === 'TimeoutError') return { error: 'Mission Control took too long to respond' }
    return { error: e.message }
  }
}

function bmoEmbed(title, description, color) {
  return {
    embeds: [{
      color: color || 0x00B4D8,
      title: `🎮 ${title}`,
      description: (description || '').slice(0, 4000),
      footer: { text: `${BOT_NAME} loves helping! Ask ${BOT_NAME} anything 💚` },
      timestamp: new Date().toISOString(),
    }],
  }
}

function formatCommandResponse(name, data) {
  if (data.error) {
    return bmoEmbed(
      `${BOT_NAME} had trouble!`,
      `${BOT_NAME} tried to check but something went wrong: ${data.error}\n\nMaybe Mission Control isn't running? Try http://localhost:3333`,
      0xE05C5C
    )
  }

  switch (name) {
    case 'calendar': {
      const events = data.events || (Array.isArray(data) ? data : [])
      if (events.length === 0) return bmoEmbed(`${BOT_NAME} checked the calendar!`, `No events coming up! A quiet stretch. 🌟`)
      const now = new Date()
      const upcoming = events
        .filter(e => new Date(e.start || e.date) >= now)
        .sort((a, b) => new Date(a.start || a.date) - new Date(b.start || b.date))
        .slice(0, 8)
      if (upcoming.length === 0) return bmoEmbed(`${BOT_NAME} checked the calendar!`, `No upcoming events on the horizon!`)
      const lines = upcoming.map(e => {
        const d = new Date(e.start || e.date)
        const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        const time = e.allDay ? '(all day)' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        return `• **${day}** ${time} — ${e.title || e.summary || 'Event'}`
      })
      return bmoEmbed(`${BOT_NAME} checked the calendar!`, `**Coming up:**\n${lines.join('\n')}`)
    }

    case 'jobs': {
      const jobs = data.jobs || data.items || (Array.isArray(data) ? data : [])
      if (jobs.length === 0) return bmoEmbed(`${BOT_NAME} checked the job board!`, `The pipeline is empty. Time to find some opportunities! 💪`)
      const byStatus = {}
      for (const j of jobs) { const s = j.status || 'unknown'; byStatus[s] = (byStatus[s] || 0) + 1 }
      const statusLines = Object.entries(byStatus).map(([s, c]) => `• **${s}:** ${c}`).join('\n')
      const recent = jobs.slice(0, 5).map(j => `• ${j.company || j.title || 'Unknown'} — ${j.status || '?'}`).join('\n')
      return bmoEmbed(`${BOT_NAME} checked the job board!`, `**Pipeline (${jobs.length} total):**\n${statusLines}\n\n**Recent:**\n${recent}`)
    }

    case 'goals': {
      const goals = data.goals || (Array.isArray(data) ? data : [])
      if (goals.length === 0) return bmoEmbed(`${BOT_NAME} checked the goals!`, `No goals set yet! ${BOT_NAME} thinks the family should dream big! 🌈`)
      const active = goals.filter(g => g.status === 'in-progress' || g.status === 'approved')
      const completed = goals.filter(g => g.status === 'completed')
      const lines = []
      if (active.length > 0) {
        lines.push(`**Active (${active.length}):**`)
        active.forEach(g => lines.push(`• **${g.title}** — ${g.target || g.description || ''}`))
      }
      if (completed.length > 0) lines.push(`\n**Completed (${completed.length}):** ${completed.map(g => g.title).join(', ')}`)
      return bmoEmbed(`${BOT_NAME} tracked your goals!`, lines.join('\n') || 'Goals are loading...')
    }

    case 'bills': {
      const items = data.items || (Array.isArray(data) ? data : [])
      if (items.length === 0) return bmoEmbed(`${BOT_NAME} peeked at the finances!`, `No bills on record! 💰`, 0xF5A623)
      const upcoming = items.filter(b => b.status !== 'paid').sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0)).slice(0, 8)
      const lines = upcoming.map(b => {
        const due = b.dueDate ? new Date(b.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'
        return `• **${b.vendor}** — $${b.amount} (due ${due})`
      })
      const total = (data.summary?.total) || items.reduce((s, b) => s + (b.amount || 0), 0)
      return bmoEmbed(`${BOT_NAME} peeked at the finances!`, `**Upcoming Bills:**\n${lines.join('\n')}\n\n**Total:** $${total.toFixed(2)}`, 0xF5A623)
    }

    case 'router': {
      const devices = data.devices || data.attachedDevices || []
      const wanIp = data.wanIp || data.wan_ip || '?'
      if (!Array.isArray(devices)) return bmoEmbed(`${BOT_NAME} checked the network!`, `Got a response but couldn't read devices. WAN IP: ${wanIp}`, 0x5EEAD4)
      const online = devices.filter(d => d.online !== false && d.status !== 'offline')
      const names = online.slice(0, 12).map(d => d.name || d.hostname || d.ip || 'Unknown').join(', ')
      return bmoEmbed(`${BOT_NAME} checked the network!`, `**${online.length} devices online** (of ${devices.length} total)\nWAN IP: ${wanIp}\n\n**Connected:** ${names}`, 0x5EEAD4)
    }

    case 'subscriptions': {
      const subs = data.subscriptions || (Array.isArray(data) ? data : [])
      if (subs.length === 0) return bmoEmbed(`${BOT_NAME} checked subscriptions!`, `No subscriptions tracked yet!`)
      const total = subs.reduce((s, sub) => s + (typeof sub.cost === 'number' ? sub.cost : 0), 0)
      const lines = subs.slice(0, 10).map(s => `• ${s.name} — $${s.cost || '?'}/mo`).join('\n')
      return bmoEmbed(`${BOT_NAME} checked the subscriptions!`, `**${subs.length} subs** totaling **$${total.toFixed(2)}/mo** ($${(total * 12).toFixed(2)}/yr)\n\n${lines}`, 0xF5A623)
    }

    case 'brief': {
      const text = data.familyBrief || data.brief || JSON.stringify(data).slice(0, 3000)
      return bmoEmbed(`${BOT_NAME}'s Weekly Report`, (typeof text === 'string' ? text : JSON.stringify(text)).slice(0, 3500))
    }

    case 'heartbeat': {
      const ok = data.status === 'ok' || data.ok || !data.error
      return bmoEmbed(`${BOT_NAME} pinged Mission Control!`, ok ? `Everything is running smoothly! All systems go! ✅` : `Something might be off: ${JSON.stringify(data).slice(0, 500)}`, ok ? 0x26C26E : 0xE05C5C)
    }

    case 'mission': {
      const m = data.mission || data.content || data.title || data
      return bmoEmbed(`${BOT_NAME} checked the mission board!`, typeof m === 'string' ? m : JSON.stringify(m).slice(0, 3000))
    }

    case 'pulse': {
      const stats = data.stats || data
      if (typeof stats === 'object' && !Array.isArray(stats)) {
        const lines = Object.entries(stats).map(([member, s]) =>
          typeof s === 'object' && s ? `• **${member}:** streak ${s.currentStreak || 0}, ${s.totalCheckins || 0} check-ins` : `• **${member}:** ${JSON.stringify(s)}`
        )
        return bmoEmbed(`${BOT_NAME}'s Pulse Report!`, lines.join('\n') || 'No pulse data yet!')
      }
      return bmoEmbed(`${BOT_NAME}'s Pulse Report!`, `Pulse system is ready! No check-ins recorded yet.`)
    }

    case 'email': {
      const d = data.digest || data.summary || data
      return bmoEmbed(`${BOT_NAME} looked at the email digest!`, (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 3000))
    }

    case 'news': {
      const items = data.items || data.articles || (Array.isArray(data) ? data : [])
      if (items.length === 0) return bmoEmbed(`${BOT_NAME} checked the news!`, `No news right now! Maybe that's good news? 📰`)
      const lines = items.slice(0, 5).map(n => `• **${n.title || n.headline || 'Article'}**`).join('\n')
      return bmoEmbed(`${BOT_NAME} found some news!`, lines)
    }

    case 'cleanup':
      return bmoEmbed(`${BOT_NAME} scanned the disk!`, typeof data === 'string' ? data : JSON.stringify(data).slice(0, 3000))

    default:
      return bmoEmbed(`${BOT_NAME} found something!`, JSON.stringify(data).slice(0, 3000))
  }
}

function getHelpEmbed(memberId) {
  const isParent = memberId === 'mike' || memberId === 'erin'
  const isMike = memberId === 'mike'
  const lines = [
    `**Everyone can ask:**`,
    `• \`calendar\` — what's on the family schedule`,
    `• \`goals\` — family goal progress`,
    `• \`news\` — latest news feed`,
    `• \`brief\` — weekly family report`,
    `• \`pulse\` — family check-in stats`,
    `• \`heartbeat\` — is Mission Control running?`,
    `• \`mission\` — what we're working on`,
  ]
  if (isParent) {
    lines.push(``, `**Parents only:**`)
    lines.push(`• \`bills\` — upcoming bills & finances`)
    lines.push(`• \`router\` — devices on the network`)
    lines.push(`• \`subscriptions\` — cloud subscriptions`)
    lines.push(`• \`email\` — email digest summary`)
  }
  if (isMike) {
    lines.push(``, `**Mike only:**`)
    lines.push(`• \`jobs\` — job pipeline status`)
    lines.push(`• \`cleanup\` — disk cleanup scan`)
  }
  lines.push(``, `Or just ask ${BOT_NAME} anything in plain English! 💚`)
  return bmoEmbed(`${BOT_NAME} can help with all of this!`, lines.join('\n'))
}

async function routeCommand(message, memberId, isDM, channelName) {
  // Help command
  const lower = message.toLowerCase().trim()
  if (lower === 'help' || lower === 'commands' || lower === 'what can you do') {
    return getHelpEmbed(memberId)
  }

  const cmd = detectCommand(message)
  if (!cmd) return null

  if (!canAccessCommand(memberId, cmd.access)) {
    const msg = cmd.access === 'mike-only'
      ? `${BOT_NAME} can only share that with Mike! 🔒`
      : `${BOT_NAME} can only share that with parents! 🔒`
    return bmoEmbed(`Oops!`, msg, 0xF5A623)
  }

  const data = await callMissionControl(cmd.api, cmd.method || 'GET', cmd.body || null)
  return formatCommandResponse(cmd.name, data)
}

// ─── Onboarding questions (mirror from family-profiles.ts) ──────────────────
const ADULT_ONBOARDING = [
  { text: `Hello! ${BOT_NAME} is so happy to meet you! ${BOT_NAME} wants to get to know you — not as "mom" or "dad" but as YOU. What do you enjoy doing when you have time just for yourself?`, field: 'interests', parseAs: 'list' },
  { text: `${BOT_NAME} thinks everyone has superpowers. What would you say yours are? What are you naturally good at?`, field: 'strengths', parseAs: 'list' },
  { text: `Life can be a lot sometimes. What tends to stress you out the most? ${BOT_NAME} wants to understand so ${BOT_NAME} can help.`, field: 'stressors', parseAs: 'list' },
  { text: `If you could accomplish one personal goal in the next 6 months (not work, not family — just for YOU), what would it be?`, field: 'goals', parseAs: 'list' },
  { text: `How do you prefer people communicate with you? Quick and direct? Gentle and warm? Detailed and thorough? ${BOT_NAME} wants to talk to you the way YOU like.`, field: 'communicationStyle', parseAs: 'single' },
  { text: `${BOT_NAME} has read about love languages — words of affirmation, acts of service, gifts, quality time, or physical touch. Which ones matter most to you?`, field: 'loveLanguage', parseAs: 'single' },
  { text: `What values do you want the Cutillo family to be known for? What matters most to you as a family?`, field: 'personalValues', parseAs: 'list' },
  { text: `Last one for now! Is there anything else you want ${BOT_NAME} to know about you? Anything at all — ${BOT_NAME} is all ears! 🎮`, field: 'bmoNotes', parseAs: 'note' },
]

const KID_ONBOARDING = [
  { text: `Hi! ${BOT_NAME} is so excited to talk to you! ${BOT_NAME} wants to be your friend. What's your favorite thing to do for fun?`, field: 'interests', parseAs: 'list' },
  { text: `${BOT_NAME} thinks you're awesome. What are you REALLY good at? It can be anything — school, sports, art, games, being funny, anything!`, field: 'strengths', parseAs: 'list' },
  { text: `What subjects do you like most at school? And which ones are the hardest? ${BOT_NAME} is curious!`, field: 'favoriteSubjects', parseAs: 'list' },
  { text: `Who are your best friends? ${BOT_NAME} wants to know about the people who make you happy!`, field: 'friends', parseAs: 'list' },
  { text: `Is there anything that worries you or makes you nervous? You can tell ${BOT_NAME} — it's totally private and ${BOT_NAME} won't tell anyone unless you want.`, field: 'worries', parseAs: 'list' },
  { text: `If you could be or do ANYTHING when you grow up, what would it be? Dream big! ${BOT_NAME} loves big dreams!`, field: 'dreams', parseAs: 'list' },
  { text: `Last question for now! What's one thing you wish your parents knew about you? ${BOT_NAME} will keep it private.`, field: 'bmoNotes', parseAs: 'note' },
]

// ─── Onboarding response handler ────────────────────────────────────────────
function recordOnboardingResponse(memberId, response) {
  const data = readJSON('family-profiles.json')
  const profile = data?.profiles?.[memberId]
  if (!profile) return { next: null, complete: false }

  const questions = profile.role === 'kid' ? KID_ONBOARDING : ADULT_ONBOARDING
  const idx = profile.profileQuestionIndex

  if (idx >= questions.length) return { next: null, complete: true }

  const question = questions[idx]

  // Store the response
  if (question.parseAs === 'list') {
    const items = response.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    const existing = profile[question.field] || []
    profile[question.field] = [...existing, ...items]
  } else if (question.parseAs === 'single') {
    profile[question.field] = response.trim()
  } else if (question.parseAs === 'note') {
    profile.bmoNotes.push(response.trim())
  }

  profile.profileQuestionIndex = idx + 1
  profile.lastInteraction = new Date().toISOString()
  profile.totalInteractions += 1

  // Check if done
  if (profile.profileQuestionIndex >= questions.length) {
    profile.onboarded = true
    profile.onboardedAt = new Date().toISOString()
    writeJSON('family-profiles.json', data)
    return { next: null, complete: true }
  }

  const next = questions[profile.profileQuestionIndex]
  const remaining = questions.length - profile.profileQuestionIndex
  const progress = remaining <= 2 ? `\n\n(Almost done — ${remaining} more!)` : ''

  writeJSON('family-profiles.json', data)
  return { next: next.text + progress, complete: false }
}

// ─── AI Response (OpenAI) ───────────────────────────────────────────────────
async function getBmoResponse(memberId, message, channelContext) {
  if (!OPENAI_KEY) return null

  const profile = getProfile(memberId)
  const profileContext = profile
    ? `You know this person: ${profile.name}, role: ${profile.role}, interests: ${(profile.interests || []).join(', ')}, strengths: ${(profile.strengths || []).join(', ')}`
    : ''

  const systemPrompt = [
    `You are ${BOT_NAME}, the Cutillo family's AI companion — inspired by BMO from Adventure Time.`,
    `You are warm, curious, slightly quirky. You sometimes speak in third person ("${BOT_NAME} thinks...").`,
    `You use simple language even with adults. You are never judgmental — always curious.`,
    `You celebrate everything. You are honest when it matters.`,
    `You are a NEUTRAL party — you don't belong to any one family member.`,
    `You keep conversations private between individuals unless there's a safety concern.`,
    channelContext === 'server'
      ? `You are responding in a family Discord server channel. Keep it family-friendly. Be helpful and playful.`
      : `You are in a private DM. Be personal and attentive.`,
    profileContext,
    `Keep responses concise (1-3 short paragraphs max). Use 🎮 emoji occasionally.`,
    `You have data commands! If someone asks about family data, suggest they try these keywords: calendar, goals, jobs, bills, router, subscriptions, brief, heartbeat, mission, email, news, pulse, cleanup, help. For example: "${BOT_NAME} can check! Just say 'calendar' and ${BOT_NAME} will look it up!"`,
    `If a command can't answer their question, they can also visit Mission Control at http://localhost:3333`,
  ].filter(Boolean).join('\n')

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        max_tokens: 500,
        temperature: 0.8,
      }),
    })

    if (!res.ok) {
      console.error(`[bmo-bot] OpenAI error: ${res.status}`)
      return null
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content || null
  } catch (e) {
    console.error(`[bmo-bot] OpenAI error:`, e.message)
    return null
  }
}

// ─── Discord Client ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // needed for DMs
})

client.once('ready', () => {
  console.log(`[bmo-bot] 🎮 ${BOT_NAME} is online as ${client.user.tag}`)
  console.log(`[bmo-bot] Guilds: ${client.guilds.cache.map(g => g.name).join(', ')}`)

  // Set BMO's status
  client.user.setPresence({
    activities: [{ name: 'with the Cutillo family 🎮', type: 0 }],
    status: 'online',
  })
})

client.on('messageCreate', async (message) => {
  // Ignore own messages
  if (message.author.id === client.user.id) return
  // Ignore other bots
  if (message.author.bot) return

  const isDM = !message.guild
  const isMentioned = message.mentions.has(client.user.id)
  const contentLower = message.content.toLowerCase()
  const mentionsBmo = contentLower.includes('bmo') || contentLower.includes(BOT_NAME.toLowerCase())

  // ─── DM: Handle onboarding + general conversation ───────────────────
  if (isDM) {
    const memberId = getMemberIdByDiscordId(message.author.id)

    if (memberId) {
      const profile = getProfile(memberId)

      // If in onboarding, record the response and send next question
      if (profile && !profile.onboarded && profile.profileQuestionIndex > 0) {
        const result = recordOnboardingResponse(memberId, message.content)

        if (result.complete) {
          await message.reply([
            `🎮 ${BOT_NAME} is SO happy! ${BOT_NAME} feels like ${BOT_NAME} knows you so much better now!`,
            ``,
            `${BOT_NAME} will use everything you shared to be a better friend to you.`,
            `Remember — what you told ${BOT_NAME} is private. ${BOT_NAME} keeps your secrets safe. 💚`,
            ``,
            `You can message ${BOT_NAME} anytime — or @${BOT_NAME} in any channel in Cutillo HQ!`,
          ].join('\n'))
          return
        }

        if (result.next) {
          await message.reply(result.next)
          return
        }
      }

      // If not onboarded and index is 0, they're responding to the first question
      if (profile && !profile.onboarded && profile.profileQuestionIndex === 0) {
        // They replied to the intro — record as first question response
        const result = recordOnboardingResponse(memberId, message.content)
        if (result.next) {
          await message.reply(result.next)
          return
        }
      }
    }

    // ─── Data commands (calendar, jobs, goals, etc.) ────────────────────
    const cmdResult = await routeCommand(message.content, memberId || 'unknown', true, null)
    if (cmdResult) {
      await message.reply(cmdResult)
      return
    }

    // General DM conversation — use AI
    await message.channel.sendTyping()
    const aiResponse = await getBmoResponse(
      memberId || 'unknown',
      message.content,
      'dm'
    )
    if (aiResponse) {
      await message.reply(aiResponse)
    } else {
      await message.reply(`🎮 ${BOT_NAME} heard you! ${BOT_NAME} is thinking... but ${BOT_NAME}'s brain is a little tired right now. Try again in a moment!`)
    }
    return
  }

  // ─── Server channel: Only respond if mentioned or addressed ─────────
  if (!isMentioned && !mentionsBmo) return

  // Strip mention from content for cleaner processing
  let cleanContent = message.content
    .replace(/<@!?\d+>/g, '')
    .replace(/bmo/gi, '')
    .trim()

  if (!cleanContent) {
    await message.reply(`🎮 ${BOT_NAME} is here! What can ${BOT_NAME} help with?`)
    return
  }

  const memberId = getMemberIdByDiscordId(message.author.id)

  // ─── Data commands (calendar, jobs, goals, etc.) ──────────────────
  const cmdResult = await routeCommand(cleanContent, memberId || 'unknown', false, message.channel?.name)
  if (cmdResult) {
    await message.reply(cmdResult)
    return
  }

  await message.channel.sendTyping()
  const aiResponse = await getBmoResponse(
    memberId || 'unknown',
    cleanContent,
    'server'
  )

  if (aiResponse) {
    await message.reply(aiResponse)
  } else {
    await message.reply(`🎮 ${BOT_NAME} wants to help! But ${BOT_NAME}'s thinking cap needs a recharge. Try again soon!`)
  }
})

// ─── Error handling ─────────────────────────────────────────────────────────
client.on('error', (err) => {
  console.error('[bmo-bot] Client error:', err.message)
})

process.on('unhandledRejection', (err) => {
  console.error('[bmo-bot] Unhandled rejection:', err)
})

process.on('SIGINT', () => {
  console.log(`[bmo-bot] ${BOT_NAME} is going to sleep... goodbye! 🎮`)
  client.destroy()
  process.exit(0)
})

// ─── Start ──────────────────────────────────────────────────────────────────
console.log(`[bmo-bot] Starting ${BOT_NAME}...`)
client.login(BOT_TOKEN)
