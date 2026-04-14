/**
 * imessage-bridge.ts — iMessage send/receive via macOS Messages.app + chat.db
 *
 * Uses AppleScript to send iMessages and reads replies from the local
 * SQLite database at ~/Library/Messages/chat.db.
 *
 * Requires:
 * - Messages.app signed into iCloud on this Mac
 * - Full Disk Access for the Node process (to read chat.db)
 * - IMESSAGE_ERIN and IMESSAGE_CLARA env vars set to phone numbers or Apple IDs
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { readJSON, writeJSON } from './data'

const execFileAsync = promisify(execFile)

const CHAT_DB = path.join(
  process.env.HOME || '/Users/mikecutillo',
  'Library/Messages/chat.db'
)

// Member → iMessage address mapping (phone number or Apple ID)
const IMESSAGE_CONTACTS: Record<string, string> = {
  erin: process.env.IMESSAGE_ERIN || '',
  clara: process.env.IMESSAGE_CLARA || '',
}

// Track what we've already read so we don't double-process
interface MessageState {
  lastReadRowId: Record<string, number> // per contact handle
}

const STATE_FILE = 'imessage-state.json'

async function getState(): Promise<MessageState> {
  return readJSON<MessageState>(STATE_FILE, { lastReadRowId: {} })
}

async function saveState(state: MessageState): Promise<void> {
  await writeJSON(STATE_FILE, state)
}

/**
 * Send an iMessage to a family member via AppleScript.
 *
 * @param memberId - 'erin' or 'clara'
 * @param message - Text content to send
 * @returns true if sent successfully
 */
export async function sendiMessage(memberId: string, message: string): Promise<boolean> {
  const recipient = IMESSAGE_CONTACTS[memberId]
  if (!recipient) {
    console.error(`[imessage] No contact configured for ${memberId}`)
    return false
  }

  // Escape single quotes for AppleScript
  const escapedMessage = message.replace(/'/g, "'\\''")
  const escapedRecipient = recipient.replace(/'/g, "'\\''")

  // AppleScript to send via Messages.app
  const script = `
    tell application "Messages"
      set targetBuddy to "${escapedRecipient}"
      set targetService to 1st account whose service type = iMessage
      set theBuddy to participant targetBuddy of account id (id of targetService)
      send "${escapedMessage}" to theBuddy
    end tell
  `

  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 15000 })
    return true
  } catch (err: any) {
    console.error(`[imessage] Send failed for ${memberId}: ${err.message}`)

    // Fallback: try the simpler "send to buddy" syntax
    const fallbackScript = `
      tell application "Messages"
        send "${escapedMessage}" to buddy "${escapedRecipient}" of (1st account whose service type = iMessage)
      end tell
    `
    try {
      await execFileAsync('osascript', ['-e', fallbackScript], { timeout: 15000 })
      return true
    } catch (err2: any) {
      console.error(`[imessage] Fallback send also failed: ${err2.message}`)
      return false
    }
  }
}

/**
 * Read new incoming iMessages from a specific contact since we last checked.
 * Queries ~/Library/Messages/chat.db directly.
 *
 * @param memberId - 'erin' or 'clara'
 * @returns Array of new message texts (from them, not from us)
 */
export async function readNewMessages(memberId: string): Promise<string[]> {
  const contact = IMESSAGE_CONTACTS[memberId]
  if (!contact) return []

  const state = await getState()
  const lastRowId = state.lastReadRowId[contact] || 0

  // Query chat.db for messages from this contact that are newer than lastRowId
  // is_from_me = 0 means they sent it to us
  const query = `
    SELECT m.ROWID, m.text
    FROM message m
    JOIN handle h ON m.handle_id = h.ROWID
    WHERE h.id = '${contact}'
      AND m.is_from_me = 0
      AND m.text IS NOT NULL
      AND m.ROWID > ${lastRowId}
    ORDER BY m.ROWID ASC;
  `

  try {
    const { stdout } = await execFileAsync('sqlite3', [CHAT_DB, query], { timeout: 10000 })
    const lines = stdout.trim().split('\n').filter(Boolean)
    const messages: string[] = []
    let maxRowId = lastRowId

    for (const line of lines) {
      const pipeIdx = line.indexOf('|')
      if (pipeIdx === -1) continue
      const rowId = parseInt(line.slice(0, pipeIdx), 10)
      const text = line.slice(pipeIdx + 1)
      messages.push(text)
      if (rowId > maxRowId) maxRowId = rowId
    }

    // Update state
    if (maxRowId > lastRowId) {
      state.lastReadRowId[contact] = maxRowId
      await saveState(state)
    }

    return messages
  } catch (err: any) {
    console.error(`[imessage] Read failed for ${memberId}: ${err.message}`)
    return []
  }
}

/**
 * Read ALL recent messages from a contact (for initial context).
 *
 * @param memberId - 'erin' or 'clara'
 * @param limit - How many recent messages to fetch
 */
export async function getRecentMessages(
  memberId: string,
  limit = 20
): Promise<Array<{ text: string; fromMe: boolean; rowId: number }>> {
  const contact = IMESSAGE_CONTACTS[memberId]
  if (!contact) return []

  const query = `
    SELECT m.ROWID, m.text, m.is_from_me
    FROM message m
    JOIN handle h ON m.handle_id = h.ROWID
    WHERE h.id = '${contact}'
      AND m.text IS NOT NULL
    ORDER BY m.ROWID DESC
    LIMIT ${limit};
  `

  try {
    const { stdout } = await execFileAsync('sqlite3', [CHAT_DB, query], { timeout: 10000 })
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('|')
      return {
        rowId: parseInt(parts[0], 10),
        text: parts.slice(2).join('|'), // text may contain pipes
        fromMe: parts[1] === '1',
      }
    }).reverse()
  } catch (err: any) {
    console.error(`[imessage] getRecent failed for ${memberId}: ${err.message}`)
    return []
  }
}

/**
 * Check if iMessage is available for a member.
 */
export function isIMemberConfigured(memberId: string): boolean {
  return !!IMESSAGE_CONTACTS[memberId]
}

/**
 * Get all configured iMessage members.
 */
export function getIMemberIds(): string[] {
  return Object.keys(IMESSAGE_CONTACTS).filter(id => !!IMESSAGE_CONTACTS[id])
}
