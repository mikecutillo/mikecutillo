/**
 * unknowns-log — append-only log of questions the worker could not
 * match against the answer bank.
 *
 * Written by:
 *   - lib/apply-worker/answer-bank-client.ts when similarity < threshold
 *   - Phase 3 Chrome extension autofill (via /api/apply-unknowns)
 *
 * Read by:
 *   - Settings view to surface "questions Mike should answer once"
 *   - Aggregate analysis — which sites ask the most novel questions
 *
 * Each unresolved entry becomes a permanent answer-bank entry the
 * first time Mike answers it. Over time the unresolved count → 0.
 */

import fs from 'fs/promises'
import path from 'path'

const UNKNOWNS_PATH = path.join(
  '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data',
  'apply-unknowns.json',
)

export interface UnknownEntry {
  id: string
  question: string
  fieldLabel?: string
  fieldType?: string
  site?: string
  jobId?: string
  jobTitle?: string
  company?: string
  source: 'worker' | 'extension'
  createdAt: string
  resolved: boolean
  resolvedAt?: string
  /** When resolved, the bank entry id that captured the answer. */
  resolvedBankEntryId?: string
}

interface UnknownsFile {
  _note?: string
  entries: UnknownEntry[]
}

async function readLog(): Promise<UnknownsFile> {
  try {
    const raw = await fs.readFile(UNKNOWNS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as UnknownsFile
    if (!Array.isArray(parsed.entries)) return { entries: [] }
    return parsed
  } catch {
    return { entries: [] }
  }
}

async function writeLog(file: UnknownsFile): Promise<void> {
  await fs.mkdir(path.dirname(UNKNOWNS_PATH), { recursive: true })
  await fs.writeFile(UNKNOWNS_PATH, JSON.stringify(file, null, 2), 'utf-8')
}

function makeId(): string {
  return `unk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Append an unknown-question entry. Returns the generated id so the
 * worker can reference it in the ApprovalItem audit trail.
 */
export async function logUnknown(entry: Omit<UnknownEntry, 'id' | 'createdAt' | 'resolved'>): Promise<string> {
  const file = await readLog()
  const id = makeId()
  file.entries.push({
    ...entry,
    id,
    createdAt: new Date().toISOString(),
    resolved: false,
  })
  await writeLog(file)
  return id
}

/**
 * Mark a previously-logged unknown as resolved. Called after Mike
 * answers the question and the answer-bank CRUD has persisted the
 * new entry.
 */
export async function markResolved(unknownId: string, bankEntryId: string): Promise<void> {
  const file = await readLog()
  const entry = file.entries.find((e) => e.id === unknownId)
  if (!entry) return
  entry.resolved = true
  entry.resolvedAt = new Date().toISOString()
  entry.resolvedBankEntryId = bankEntryId
  await writeLog(file)
}

export async function listUnresolved(): Promise<UnknownEntry[]> {
  const file = await readLog()
  return file.entries.filter((e) => !e.resolved)
}

export async function listAll(): Promise<UnknownEntry[]> {
  const file = await readLog()
  return file.entries
}
