// ─── Family Intel — Unified Cross-Platform Event Timeline ────────────────────
// Sources: Microsoft Graph webhooks, Google Calendar/Drive push notifications,
//          Pi-hole v6 DNS query log polling

import { readJSON, writeJSON, generateId } from './data'

// ─── Core Types ───────────────────────────────────────────────────────────────

export type EventSource = 'microsoft' | 'google' | 'pihole' | 'manual'

export type EventSourceDetail =
  | 'graph-signin'      // Azure AD sign-in audit log
  | 'graph-calendar'    // MS Outlook calendar event change
  | 'graph-onedrive'    // OneDrive file created/modified/deleted
  | 'graph-teams'       // Teams message or activity
  | 'graph-security'    // MS Defender / security alert
  | 'google-calendar'   // Google Calendar event change
  | 'google-drive'      // Google Drive file change
  | 'gmail'             // Gmail message activity
  | 'dns-query'         // Pi-hole DNS query (allowed)
  | 'dns-blocked'       // Pi-hole DNS query (blocked by list)
  | 'manual'            // Manually posted event

export type EventCategory =
  | 'signin'            // Account authentication events
  | 'calendar'          // Calendar event create/update/delete
  | 'file'              // File upload/download/share/delete
  | 'email'             // Email sent/received
  | 'network'           // DNS/network activity from Pi-hole
  | 'security'          // Security alerts, suspicious activity
  | 'communication'     // Messages, Teams, Discord, chat

export type EventSeverity = 'info' | 'warning' | 'alert'

export type FamilyPerson = 'mike' | 'erin' | 'liam' | 'clara' | 'shared' | 'unknown'

export interface FamilyIntelEvent {
  id: string
  timestamp: string                   // ISO 8601
  source: EventSource
  sourceDetail: EventSourceDetail
  person: FamilyPerson
  device?: string                     // Device name or IP
  category: EventCategory
  severity: EventSeverity
  title: string
  description: string
  domain?: string                     // For DNS events — primary domain queried
  metadata: Record<string, unknown>   // Source-specific raw data
  correlatedWith?: string[]           // IDs of related events (for cross-source correlation)
}

export interface FamilyIntelSubscription {
  id: string                          // Provider-assigned subscription ID
  source: 'microsoft' | 'google'
  resource: string                    // e.g. "/users/{id}/events"
  person: FamilyPerson
  label: string                       // Human label e.g. "Mike - Outlook Calendar"
  expiresAt: string                   // ISO 8601
  renewedAt: string
  channelId?: string                  // Google: channel ID for stop()
  resourceId?: string                 // Google: resource ID for stop()
}

export interface DeviceEntry {
  identifier: string                  // IP address or hostname
  person: FamilyPerson
  deviceName: string
  deviceType: 'phone' | 'tablet' | 'laptop' | 'desktop' | 'tv' | 'game' | 'other'
}

// ─── Domain Intelligence ──────────────────────────────────────────────────────

export type DomainFlag = 'gaming' | 'streaming' | 'social' | 'educational' | 'communication' | 'shopping' | 'adult'

export interface DomainProfile {
  label: string
  flag?: DomainFlag
  severity?: EventSeverity
}

export const DOMAIN_MAP: Record<string, DomainProfile> = {
  // Communication
  'discord.com':        { label: 'Discord',          flag: 'communication' },
  'discordapp.com':     { label: 'Discord CDN',       flag: 'communication' },
  'discord.gg':         { label: 'Discord',           flag: 'communication' },
  // Gaming
  'minecraft.net':      { label: 'Minecraft',         flag: 'gaming' },
  'mojang.com':         { label: 'Minecraft/Mojang',  flag: 'gaming' },
  'roblox.com':         { label: 'Roblox',            flag: 'gaming' },
  'rbxcdn.com':         { label: 'Roblox CDN',        flag: 'gaming' },
  'xbox.com':           { label: 'Xbox',              flag: 'gaming' },
  'xboxlive.com':       { label: 'Xbox Live',         flag: 'gaming' },
  'playstation.com':    { label: 'PlayStation',       flag: 'gaming' },
  'steampowered.com':   { label: 'Steam',             flag: 'gaming' },
  'epicgames.com':      { label: 'Epic Games',        flag: 'gaming' },
  'fortnite.com':       { label: 'Fortnite',          flag: 'gaming' },
  'ea.com':             { label: 'EA Games',          flag: 'gaming' },
  // Social media
  'tiktok.com':         { label: 'TikTok',            flag: 'social', severity: 'warning' },
  'tiktokcdn.com':      { label: 'TikTok CDN',        flag: 'social', severity: 'warning' },
  'musical.ly':         { label: 'TikTok (old)',      flag: 'social', severity: 'warning' },
  'instagram.com':      { label: 'Instagram',         flag: 'social' },
  'cdninstagram.com':   { label: 'Instagram CDN',     flag: 'social' },
  'snapchat.com':       { label: 'Snapchat',          flag: 'social', severity: 'warning' },
  'sc-cdn.net':         { label: 'Snapchat CDN',      flag: 'social' },
  'twitter.com':        { label: 'Twitter/X',         flag: 'social' },
  'x.com':              { label: 'X (Twitter)',       flag: 'social' },
  'facebook.com':       { label: 'Facebook',          flag: 'social' },
  // Streaming
  'twitch.tv':          { label: 'Twitch',            flag: 'streaming' },
  'twitchsvc.net':      { label: 'Twitch CDN',        flag: 'streaming' },
  'netflix.com':        { label: 'Netflix',           flag: 'streaming' },
  'nflxvideo.net':      { label: 'Netflix CDN',       flag: 'streaming' },
  'youtube.com':        { label: 'YouTube',           flag: 'streaming' },
  'googlevideo.com':    { label: 'YouTube CDN',       flag: 'streaming' },
  'youtu.be':           { label: 'YouTube',           flag: 'streaming' },
  'hulu.com':           { label: 'Hulu',              flag: 'streaming' },
  'disneyplus.com':     { label: 'Disney+',           flag: 'streaming' },
  'disneystreaming.com':{ label: 'Disney+ CDN',       flag: 'streaming' },
  'primevideo.com':     { label: 'Prime Video',       flag: 'streaming' },
  'aiv-cdn.net':        { label: 'Prime Video CDN',   flag: 'streaming' },
  // Educational
  'khanacademy.org':    { label: 'Khan Academy',      flag: 'educational' },
  'duolingo.com':       { label: 'Duolingo',          flag: 'educational' },
  'classroom.google.com': { label: 'Google Classroom', flag: 'educational' },
  'quizlet.com':        { label: 'Quizlet',           flag: 'educational' },
  'brainpop.com':       { label: 'BrainPOP',          flag: 'educational' },
}

export function lookupDomain(domain: string): DomainProfile | null {
  if (DOMAIN_MAP[domain]) return DOMAIN_MAP[domain]
  for (const [key, val] of Object.entries(DOMAIN_MAP)) {
    if (domain === key || domain.endsWith('.' + key)) return val
  }
  return null
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const EVENTS_FILE      = 'family-intel-events.json'
const DEVICES_FILE     = 'family-intel-devices.json'
const SUBS_FILE        = 'family-intel-subscriptions.json'
const CURSOR_FILE      = 'family-intel-pihole-cursor.json'
const MAX_EVENTS       = 10_000

export async function loadEvents(): Promise<FamilyIntelEvent[]> {
  return readJSON<FamilyIntelEvent[]>(EVENTS_FILE, [])
}

export async function saveEvents(events: FamilyIntelEvent[]): Promise<void> {
  const trimmed = events.length > MAX_EVENTS
    ? events.slice(events.length - MAX_EVENTS)
    : events
  await writeJSON(EVENTS_FILE, trimmed)
}

export async function appendEvents(incoming: FamilyIntelEvent[]): Promise<number> {
  if (!incoming.length) return 0
  const existing = await loadEvents()
  await saveEvents([...existing, ...incoming])
  return incoming.length
}

export async function loadDevices(): Promise<DeviceEntry[]> {
  return readJSON<DeviceEntry[]>(DEVICES_FILE, DEFAULT_DEVICES)
}

export async function loadSubscriptions(): Promise<FamilyIntelSubscription[]> {
  return readJSON<FamilyIntelSubscription[]>(SUBS_FILE, [])
}

export async function saveSubscriptions(subs: FamilyIntelSubscription[]): Promise<void> {
  await writeJSON(SUBS_FILE, subs)
}

export async function loadPiholeCursor(): Promise<number> {
  const d = await readJSON<{ lastTs: number }>(CURSOR_FILE, { lastTs: 0 })
  return d.lastTs
}

export async function savePiholeCursor(ts: number): Promise<void> {
  await writeJSON(CURSOR_FILE, { lastTs: ts })
}

// ─── Event Factory ────────────────────────────────────────────────────────────

export function makeEvent(partial: Omit<FamilyIntelEvent, 'id'>): FamilyIntelEvent {
  return { id: generateId(), ...partial }
}

// ─── Device Helpers ───────────────────────────────────────────────────────────

export function lookupDevice(identifier: string, devices: DeviceEntry[]): DeviceEntry | null {
  const needle = identifier.toLowerCase()
  return devices.find(d =>
    d.identifier.toLowerCase() === needle ||
    needle.endsWith('.' + d.identifier.toLowerCase())
  ) ?? null
}

export function personFromDevice(identifier: string, devices: DeviceEntry[]): FamilyPerson {
  return lookupDevice(identifier, devices)?.person ?? 'unknown'
}

export const DEFAULT_DEVICES: DeviceEntry[] = [
  { identifier: '192.168.1.1',   person: 'shared',  deviceName: 'Orbi Router',      deviceType: 'other' },
  { identifier: '192.168.1.46',  person: 'shared',  deviceName: 'Pi-hole Server',   deviceType: 'other' },
]

// ─── Microsoft Graph OAuth (client credentials) ───────────────────────────────

export async function getMsAccessToken(): Promise<string | null> {
  const { MS_TENANT_ID: tid, MS_CLIENT_ID: cid, MS_CLIENT_SECRET: cs } = process.env
  if (!tid || !cid || !cs) return null
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: cid,
          client_secret: cs,
          scope: 'https://graph.microsoft.com/.default',
        }),
      }
    )
    const data = await res.json()
    return (data.access_token as string) ?? null
  } catch {
    return null
  }
}

// ─── Google OAuth (refresh token → access token) ──────────────────────────────

export async function getGoogleAccessToken(refreshToken: string): Promise<string | null> {
  const { GOOGLE_CLIENT_ID: cid, GOOGLE_CLIENT_SECRET: cs } = process.env
  if (!cid || !cs || !refreshToken) return null
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: cid,
        client_secret: cs,
      }),
    })
    const data = await res.json()
    return (data.access_token as string) ?? null
  } catch {
    return null
  }
}

// ─── Configuration Status ─────────────────────────────────────────────────────

export interface IntelSourceStatus {
  name: string
  configured: boolean
  missingVars: string[]
  capabilities: string[]
}

export function getMicrosoftStatus(): IntelSourceStatus {
  const missing: string[] = []
  if (!process.env.MS_TENANT_ID)     missing.push('MS_TENANT_ID')
  if (!process.env.MS_CLIENT_ID)     missing.push('MS_CLIENT_ID')
  if (!process.env.MS_CLIENT_SECRET) missing.push('MS_CLIENT_SECRET')
  if (!process.env.WEBHOOK_BASE_URL) missing.push('WEBHOOK_BASE_URL')

  return {
    name: 'Microsoft Graph',
    configured: missing.length === 0,
    missingVars: missing,
    capabilities: [
      'Outlook Calendar — event create/update/delete',
      'OneDrive — file create/update/delete',
      'Azure AD Sign-ins — who logged in, from where',
      'Microsoft Defender security alerts',
    ],
  }
}

export function getGoogleStatus(): IntelSourceStatus {
  const missing: string[] = []
  if (!process.env.GOOGLE_CLIENT_ID)            missing.push('GOOGLE_CLIENT_ID')
  if (!process.env.GOOGLE_CLIENT_SECRET)        missing.push('GOOGLE_CLIENT_SECRET')
  if (!process.env.GOOGLE_MIKE_REFRESH_TOKEN)   missing.push('GOOGLE_MIKE_REFRESH_TOKEN')
  if (!process.env.WEBHOOK_BASE_URL)            missing.push('WEBHOOK_BASE_URL')

  return {
    name: 'Google',
    configured: missing.length === 0,
    missingVars: missing,
    capabilities: [
      'Google Calendar — event create/update/delete for all accounts',
      'Google Drive — file changes (create/update/delete)',
      'Gmail — new message notifications (label/thread changes)',
    ],
  }
}

export function getPiholeStatus(): IntelSourceStatus {
  const missing: string[] = []
  if (!process.env.PIHOLE_HOST) missing.push('PIHOLE_HOST')
  if (!process.env.PIHOLE_PASS) missing.push('PIHOLE_PASS')

  return {
    name: 'Pi-hole DNS',
    configured: missing.length === 0,
    missingVars: missing,
    capabilities: [
      'Per-device DNS query log (all network traffic)',
      'Blocked domain detection (policy violations)',
      'Domain category intelligence (gaming/streaming/social/educational)',
      'Device-to-person attribution via IP mapping',
    ],
  }
}
