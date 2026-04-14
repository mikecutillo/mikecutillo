import { readJSON, writeJSON } from './data'

// ─── Heartbeat payload from the PowerShell agent ─────────────────────────────
export interface PcHeartbeat {
  hostname: string
  timestamp: string                // ISO 8601
  windowsUser: string
  foreground: {
    processName: string
    windowTitle: string
  } | null
  idleSeconds: number
  uptime: number                   // system uptime in seconds
  processes: PcProcess[]
  connections: PcConnection[]
  browserHistory: PcBrowserEntry[]
  loginEvents: PcLoginEvent[]
}

export interface PcProcess {
  name: string
  pid: number
  cpu: number                      // seconds of CPU time
  memMb: number                    // working set in MB
}

export interface PcConnection {
  localPort: number
  remoteAddress: string
  remotePort: number
  owningProcess: string
}

export interface PcBrowserEntry {
  url: string
  title: string
  visitTime: string                // ISO 8601
  browser: 'chrome' | 'edge'
}

export interface PcLoginEvent {
  type: 'logon' | 'logoff'
  user: string
  time: string                     // ISO 8601
}

// ─── Stored data ─────────────────────────────────────────────────────────────
export interface PcDeviceEntry {
  profileId: string | null         // null = shared / unassigned
  displayName: string
  lastSeen: string                 // ISO 8601
  lastUser: string
  lastForeground: string
  idleSeconds: number
}

export type PcDeviceRegistry = Record<string, PcDeviceEntry>

export interface PcActivityData {
  devices: PcDeviceRegistry
  reports: PcHeartbeat[]
  customCategories?: Record<string, string>   // process name -> category override
}

// ─── Dashboard types ─────────────────────────────────────────────────────────
export type AppCategory = 'gaming' | 'video' | 'social' | 'browsing' | 'productivity' | 'other'

export interface PcWeeklySummary {
  hostname: string
  profileId: string | null
  displayName: string
  totalMinutes: number
  byCategory: Record<AppCategory, number>     // category -> minutes
  topApps: { name: string; minutes: number }[]
  topDomains: { domain: string; visits: number }[]
  avgDailyMinutes: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const FILE = 'pc-activity.json'
const EMPTY: PcActivityData = { devices: {}, reports: [] }
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export async function readPcActivity(): Promise<PcActivityData> {
  return readJSON<PcActivityData>(FILE, EMPTY)
}

export async function writePcActivity(data: PcActivityData): Promise<void> {
  return writeJSON(FILE, data)
}

export function trimOldReports(reports: PcHeartbeat[]): PcHeartbeat[] {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString()
  return reports.filter(r => r.timestamp >= cutoff)
}

export function isDeviceOnline(lastSeen: string, thresholdMs = 10 * 60 * 1000): boolean {
  return Date.now() - new Date(lastSeen).getTime() < thresholdMs
}

export function isDeviceIdle(idleSeconds: number, thresholdSec = 300): boolean {
  return idleSeconds >= thresholdSec
}
