/**
 * Shared panel contract for the Answer Bank UI (Phase 4).
 *
 * Every panel in app/answer-bank/panels/ implements `PanelProps`.
 * The page (page.tsx) owns shared state and passes the same data
 * snapshot to every panel. Panels call `onRefresh` after any write
 * to re-fetch from the server.
 *
 * The `onPrefillEditor` channel is how UnknownsQueuePanel hands a
 * draft off to AddEntryPanel — see comments on EditorDraft below.
 *
 * Adding a new panel later is mechanical: implement `PanelProps`,
 * import in page.tsx, drop in the stack. Zero coupling between panels.
 */

import type { BankEntry } from '@/lib/apply-worker/answer-bank-client'
import type { UnknownEntry } from '@/lib/apply-worker/unknowns-log'

export interface EditorDraft extends Partial<BankEntry> {
  /**
   * When the draft was prefilled from an unknown question, this id
   * lets the AddEntryPanel mark the unknown resolved on successful
   * save (PATCH /api/apply-unknowns).
   */
  _unknownId?: string
}

export interface PanelProps {
  entries: BankEntry[]
  unknowns: UnknownEntry[]
  onRefresh: () => Promise<void>
  onPrefillEditor: (draft: EditorDraft) => void
  isRefreshing?: boolean
}

// ---- Shared design tokens (dark Mission Control palette) ---------------

export const TOKENS = {
  panelBg: '#111117',
  panelBorder: '#1E1E2A',
  inputBg: '#0D0D14',
  inputBorder: '#1E1E2A',
  text: '#E0E0F0',
  textDim: '#777790',
  textVeryDim: '#555570',
  accent: '#4F8EF7',
  accentSoft: '#4F8EF720',
  accentBorder: '#4F8EF740',
  green: '#2ECC71',
  greenSoft: '#2ECC7120',
  gold: '#F5A623',
  goldSoft: '#F5A62320',
  red: '#E8453C',
  redSoft: '#E8453C20',
} as const
