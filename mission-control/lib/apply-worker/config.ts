/**
 * config — single loader for auto-apply settings.
 *
 * Reads `mission-control/data/auto-apply-config.json` and returns a
 * typed object. If the file is missing or malformed, returns sensible
 * defaults so the worker never crashes on a bad edit.
 */

import fs from 'fs/promises'
import path from 'path'

export interface ApplyConfig {
  autoSubmit: boolean
  defaultHeadless: boolean
  maxApplicationsPerDay: number
  cooldownMinutes: number
  minFitScore: number
  pdfCacheDir: string
  persistentProfileDir: string
  sensitiveKeywordsPause: string[]
  notifyOn: Array<'success' | 'unknown-question' | 'failure'>
  fuzzyMatchThreshold: number
  jitterMinMs: number
  jitterMaxMs: number
}

const DEFAULT: ApplyConfig = {
  autoSubmit: true,
  defaultHeadless: false,
  maxApplicationsPerDay: 25,
  cooldownMinutes: 6,
  minFitScore: 0,
  pdfCacheDir: 'resumes/generated-pdf',
  persistentProfileDir: '.playwright-profile',
  sensitiveKeywordsPause: [
    'salary expectation',
    'compensation',
    'desired salary',
    'sponsorship',
    'visa',
    'relocate',
    'relocation',
    'start date',
    'notice period',
    'earliest start',
  ],
  notifyOn: ['success', 'unknown-question', 'failure'],
  fuzzyMatchThreshold: 0.55,
  jitterMinMs: 800,
  jitterMaxMs: 2400,
}

const CONFIG_PATH = path.join(
  '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data',
  'auto-apply-config.json',
)

let cached: ApplyConfig | null = null
let cachedAt = 0

/**
 * 10-second TTL cache — config is rarely touched and the worker reads
 * it on every apply, so caching saves a few ms without introducing
 * stale-config risk.
 */
export async function loadConfig(): Promise<ApplyConfig> {
  const now = Date.now()
  if (cached && now - cachedAt < 10_000) return cached
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ApplyConfig>
    cached = { ...DEFAULT, ...parsed }
  } catch {
    cached = DEFAULT
  }
  cachedAt = now
  return cached
}

export function clearConfigCache(): void {
  cached = null
  cachedAt = 0
}
