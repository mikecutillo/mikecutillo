/**
 * answer-bank-client — fuzzy lookup + write for job-answer-bank.json.
 *
 * Used by:
 *   - lib/apply-worker/index.ts (worker path)
 *   - app/api/answer-bank/match (Phase 3 extension + worker)
 *   - app/api/answer-bank/route.ts (CRUD)
 *
 * Fuzzy matching strategy:
 *   1. Normalize both the incoming question and all stored
 *      `question`+`aliases` strings (lowercase, strip punct, collapse ws).
 *   2. Score each candidate with `string-similarity` (Dice coefficient).
 *      Take the best score across the canonical question AND every
 *      alias — aliases exist specifically so a new phrasing lands on
 *      the same answer.
 *   3. If best score ≥ `fuzzyMatchThreshold` (0.55 default, overridable
 *      via auto-apply-config), return a match. Otherwise return null
 *      and let the worker log an unknown.
 *
 * Sensitive categories: the `category` field lets the orchestrator
 * force a pause even on a match, by checking against the
 * `sensitiveKeywordsPause` list from config.
 */

import fs from 'fs/promises'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stringSimilarity = require('string-similarity') as {
  compareTwoStrings: (a: string, b: string) => number
}
import { loadConfig } from './config'

const BANK_PATH =
  '/Users/mikecutillo/.openclaw/workspace-shared/control-center/data/job-answer-bank.json'

export type AnswerCategory =
  | 'contact'
  | 'auth'
  | 'comp'
  | 'preference'
  | 'qualitative'
  | 'sensitive'

/**
 * Answer types — discriminator for smart bank entries (Phase 4g).
 *
 *  - text          plain string (legacy default; uses entry.answer)
 *  - range         numeric range, fallback picks min/mid/max/preferred
 *  - singleChoice  pick from a fixed enum (gender, EEOC self-id, yes/no)
 *  - template      mustache-lite render with {{company}}/{{role}}/{{today}}
 *  - aiPrompt      Claude generates per-job, optionally cached per-company
 *  - formula       simple expression (today + N days)
 */
export type AnswerType =
  | 'text'
  | 'range'
  | 'singleChoice'
  | 'template'
  | 'aiPrompt'
  | 'formula'

export interface RangePayload {
  min: number
  max: number
  fallback: 'min' | 'mid' | 'max' | 'preferred'
  preferred?: number
}

export interface SingleChoicePayload {
  options: string[]
  selected: string
}

export interface TemplatePayload {
  template: string
}

export interface AiPromptPayload {
  prompt: string
  cachePerCompany: boolean
}

export interface FormulaPayload {
  expr: string
}

export interface BankEntry {
  id: string
  category: AnswerCategory
  question: string
  aliases: string[]
  /**
   * Legacy plain-text answer. Always present so existing entries keep
   * working without migration. For non-text smart types this holds a
   * human-readable preview (e.g. "$180k–$220k (mid)") so the management
   * UI can render rows without resolving the payload first.
   */
  answer: string
  confidence: number
  useCount: number
  lastUsedAt: string | null
  sourceJobId: string | null
  /** Smart-type discriminator. Existing entries default to 'text'. */
  type?: AnswerType
  /** Render-flag for masked display in the UI. Not a worker pause gate. */
  sensitive?: boolean
  text?: { value: string }
  range?: RangePayload
  singleChoice?: SingleChoicePayload
  template?: TemplatePayload
  aiPrompt?: AiPromptPayload
  formula?: FormulaPayload
}

interface BankFile {
  savedAt: string
  schemaVersion?: number
  notes?: string
  questions: BankEntry[]
}

export interface MatchResult {
  entry: BankEntry
  similarity: number
  matchedOn: string
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function readBank(): Promise<BankFile> {
  try {
    const raw = await fs.readFile(BANK_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as BankFile
    if (!Array.isArray(parsed.questions)) return { savedAt: new Date().toISOString(), questions: [] }
    // Read-time migration: tag legacy entries as `type: 'text'` so the
    // resolver and management UI never see an undefined type. Idempotent
    // — runs on every read but only mutates entries that need it.
    for (const e of parsed.questions) {
      if (!e.type) e.type = 'text'
      if (e.sensitive == null) e.sensitive = e.category === 'sensitive'
    }
    return parsed
  } catch {
    return { savedAt: new Date().toISOString(), questions: [] }
  }
}

async function writeBank(file: BankFile): Promise<void> {
  file.savedAt = new Date().toISOString()
  await fs.mkdir(path.dirname(BANK_PATH), { recursive: true })
  await fs.writeFile(BANK_PATH, JSON.stringify(file, null, 2), 'utf-8')
}

/**
 * Best-match lookup. Returns null if no candidate scores above the
 * configured threshold. Caller (worker) is expected to either log an
 * unknown + pause, or accept the match + optionally pause for sensitive
 * categories.
 */
export async function findBestMatch(question: string): Promise<MatchResult | null> {
  const cfg = await loadConfig()
  const file = await readBank()
  const q = normalize(question)
  let best: MatchResult | null = null
  for (const entry of file.questions) {
    const candidates = [entry.question, ...(entry.aliases ?? [])]
    for (const c of candidates) {
      const score = stringSimilarity.compareTwoStrings(q, normalize(c))
      if (!best || score > best.similarity) {
        best = { entry, similarity: score, matchedOn: c }
      }
    }
  }
  if (!best) return null
  if (best.similarity < cfg.fuzzyMatchThreshold) return null
  return best
}

/**
 * Same shape as `findBestMatch` but returns the top-n candidates even
 * when below threshold — used by the Settings view so Mike can see
 * near-misses and promote aliases manually.
 */
export async function rankCandidates(question: string, limit = 5): Promise<MatchResult[]> {
  const file = await readBank()
  const q = normalize(question)
  const scored: MatchResult[] = []
  for (const entry of file.questions) {
    const candidates = [entry.question, ...(entry.aliases ?? [])]
    let entryBest: MatchResult | null = null
    for (const c of candidates) {
      const score = stringSimilarity.compareTwoStrings(q, normalize(c))
      if (!entryBest || score > entryBest.similarity) {
        entryBest = { entry, similarity: score, matchedOn: c }
      }
    }
    if (entryBest) scored.push(entryBest)
  }
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, limit)
}

/**
 * Mark a match as used — increments useCount + updates lastUsedAt.
 * Non-critical: swallow write failures so the worker keeps moving.
 */
export async function touchEntry(entryId: string): Promise<void> {
  try {
    const file = await readBank()
    const entry = file.questions.find((e) => e.id === entryId)
    if (!entry) return
    entry.useCount = (entry.useCount ?? 0) + 1
    entry.lastUsedAt = new Date().toISOString()
    await writeBank(file)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[answer-bank] touchEntry failed:', err)
  }
}

/** Create a new bank entry. Returns the created entry. */
export async function addEntry(input: {
  question: string
  answer: string
  aliases?: string[]
  category?: AnswerCategory
  sourceJobId?: string | null
  type?: AnswerType
  sensitive?: boolean
  text?: { value: string }
  range?: RangePayload
  singleChoice?: SingleChoicePayload
  template?: TemplatePayload
  aiPrompt?: AiPromptPayload
  formula?: FormulaPayload
}): Promise<BankEntry> {
  const file = await readBank()
  const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const entry: BankEntry = {
    id,
    question: input.question,
    aliases: input.aliases ?? [],
    answer: input.answer,
    category: input.category ?? 'qualitative',
    confidence: 0.85,
    useCount: 0,
    lastUsedAt: null,
    sourceJobId: input.sourceJobId ?? null,
    type: input.type ?? 'text',
    sensitive: input.sensitive ?? (input.category === 'sensitive'),
  }
  if (input.text) entry.text = input.text
  if (input.range) entry.range = input.range
  if (input.singleChoice) entry.singleChoice = input.singleChoice
  if (input.template) entry.template = input.template
  if (input.aiPrompt) entry.aiPrompt = input.aiPrompt
  if (input.formula) entry.formula = input.formula
  file.questions.push(entry)
  await writeBank(file)
  return entry
}

/** Update fields on an existing bank entry (merged partial). */
export async function updateEntry(id: string, patch: Partial<Omit<BankEntry, 'id'>>): Promise<BankEntry | null> {
  const file = await readBank()
  const entry = file.questions.find((e) => e.id === id)
  if (!entry) return null
  Object.assign(entry, patch)
  await writeBank(file)
  return entry
}

export async function deleteEntry(id: string): Promise<boolean> {
  const file = await readBank()
  const before = file.questions.length
  file.questions = file.questions.filter((e) => e.id !== id)
  if (file.questions.length === before) return false
  await writeBank(file)
  return true
}

export async function listEntries(): Promise<BankEntry[]> {
  const file = await readBank()
  return file.questions
}

/**
 * Is this question sensitive enough to force a pause even when the
 * fuzzy match is confident? Checks the question + category against
 * the configured sensitive keyword list.
 */
export async function isSensitive(question: string, category?: AnswerCategory): Promise<boolean> {
  if (category === 'sensitive') return true
  const cfg = await loadConfig()
  const q = question.toLowerCase()
  for (const kw of cfg.sensitiveKeywordsPause) {
    if (q.includes(kw.toLowerCase())) return true
  }
  return false
}
