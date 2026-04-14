'use client'

/**
 * Answer Bank — Mission Control management UI (Phase 4).
 *
 * This page is a thin shell that owns shared state and renders a stack
 * of independent panel components. Every panel implements the same
 * `PanelProps` contract from ./panels/types.ts, so adding a new panel
 * is one file plus one import here.
 *
 * Why prop-drill instead of Context: this page only has 5 panels and
 * one data owner. Context buys us nothing here and adds rerender
 * weirdness when smart-typed BankEntry shapes evolve.
 *
 * Cross-panel communication is the `onPrefillEditor` channel — when
 * UnknownsQueuePanel says "Resolve this", it calls
 * `onPrefillEditor({ question, _unknownId })` and AddEntryPanel picks
 * it up via prop. The `_unknownId` travels with the draft so a
 * successful save can fire `PATCH /api/apply-unknowns` to mark the
 * unknown resolved — no ambiguity.
 */

import { useState, useEffect, useCallback } from 'react'
import TopNav from '@/components/top-nav'
import type { BankEntry } from '@/lib/apply-worker/answer-bank-client'
import type { UnknownEntry } from '@/lib/apply-worker/unknowns-log'
import type { EditorDraft } from './panels/types'
import UnknownsQueuePanel from './panels/unknowns-queue-panel'
import AddEntryPanel from './panels/add-entry-panel'
import EntriesPanel from './panels/entries-panel'
import MatchTesterPanel from './panels/match-tester-panel'
import ProfileSeedPanel from './panels/profile-seed-panel'

const PAGE_BG = '#08080F'
const SECTION_GAP = 20

export default function AnswerBankPage() {
  const [entries, setEntries] = useState<BankEntry[]>([])
  const [unknowns, setUnknowns] = useState<UnknownEntry[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [editorDraft, setEditorDraft] = useState<EditorDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)
    try {
      const [entriesRes, unknownsRes] = await Promise.all([
        fetch('/api/answer-bank'),
        fetch('/api/apply-unknowns?unresolved=true'),
      ])
      if (!entriesRes.ok) throw new Error(`bank fetch failed: ${entriesRes.status}`)
      if (!unknownsRes.ok) throw new Error(`unknowns fetch failed: ${unknownsRes.status}`)
      const entriesJson = (await entriesRes.json()) as { entries: BankEntry[] }
      const unknownsJson = (await unknownsRes.json()) as { entries: UnknownEntry[] }
      setEntries(entriesJson.entries ?? [])
      setUnknowns(unknownsJson.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onPrefillEditor = useCallback((draft: EditorDraft) => {
    setEditorDraft(draft)
    // Scroll the AddEntryPanel into view so Mike sees the prefill happen
    requestAnimationFrame(() => {
      const el = document.getElementById('answer-bank-add-panel')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [])

  const clearDraft = useCallback(() => setEditorDraft(null), [])

  const panelProps = {
    entries,
    unknowns,
    onRefresh: refresh,
    onPrefillEditor,
    isRefreshing,
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        background: PAGE_BG,
      }}
    >
      <TopNav
        crumbs={[
          { label: 'Mission Control', href: '/' },
          { label: 'Unemployment' },
          { label: 'Answer Bank', active: true },
        ]}
      />
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 32px 80px',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <header style={{ marginBottom: 24 }}>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: '#E0E0F0',
                margin: 0,
                letterSpacing: '-0.3px',
              }}
            >
              Answer Bank
            </h1>
            <p
              style={{
                fontSize: 13,
                color: '#777790',
                margin: '6px 0 0',
                maxWidth: 720,
              }}
            >
              The single source of truth for every job application question. Curate
              proactively here, resolve unknowns inline from the extension popup,
              and the apply worker stops asking forever.
            </p>
            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  background: '#3A1414',
                  border: '1px solid #6A2020',
                  borderRadius: 7,
                  color: '#FFB0B0',
                  fontSize: 12,
                }}
              >
                {error}
              </div>
            )}
          </header>

          <div style={{ display: 'flex', flexDirection: 'column', gap: SECTION_GAP }}>
            <UnknownsQueuePanel {...panelProps} />
            <div id="answer-bank-add-panel">
              <AddEntryPanel
                {...panelProps}
                draft={editorDraft}
                onClearDraft={clearDraft}
              />
            </div>
            <ProfileSeedPanel {...panelProps} />
            <EntriesPanel {...panelProps} />
            <MatchTesterPanel {...panelProps} />
          </div>
        </div>
      </div>
    </div>
  )
}
