import fs from 'fs'
import path from 'path'

const DATA_PATH = path.join(process.cwd(), 'data', 'family-devices.json')

export interface FamilyDevice {
  mac: string
  name: string
  type: 'computer' | 'ipad' | 'iphone' | 'tv' | 'router' | 'nas' | 'hub' | 'speaker' | 'other'
  ip?: string
  vendor?: string
  hostname?: string
  randomizedMac?: boolean
}

export interface FamilyProfile {
  id: string
  name: string
  emoji: string
  color: string
  devices: FamilyDevice[]
  curfew: { weekday: string; weekend: string }
  weekendOverride: boolean
  bonusMinutes: number
  paused: boolean
  pausedAt: string | null
  homeworkMode: boolean
  sneakyMode: boolean
  blockedApps: string[]
  safeSearch: boolean
  youtubeRestricted: boolean
  homeworkWhitelist: string[]
}

export interface FamilyData {
  profiles: FamilyProfile[]
  dinnerMode: boolean
  dinnerModeStartedAt: string | null
  screenFreeNight: { enabled: boolean; dayOfWeek: number; startTime: string }
}

export function readFamilyData(): FamilyData {
  const raw = fs.readFileSync(DATA_PATH, 'utf8')
  return JSON.parse(raw)
}

export function writeFamilyData(data: FamilyData): void {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2))
}

export function getProfile(data: FamilyData, profileId: string): FamilyProfile | undefined {
  return data.profiles.find(p => p.id === profileId)
}
