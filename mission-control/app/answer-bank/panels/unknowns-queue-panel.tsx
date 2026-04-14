'use client'

/**
 * UnknownsQueuePanel — surfaces unresolved questions the worker or
 * extension couldn't match. The killer feature of the Answer Bank UI:
 * the queue is the visible to-do list of "what's missing in my bank,"
 * and each row resolves to a permanent answer in two clicks.
 *
 * Flow:
 *   1. Click Resolve on a row → calls onPrefillEditor with the question
 *      text + the unknown id
 *   2. Page scrolls to AddEntryPanel which is now prefilled
 *   3. Mike fills the answer + saves → AddEntryPanel POSTs to
 *      /api/answer-bank, then PATCHes /api/apply-unknowns to mark this
 *      unknown resolved
 *   4. Refresh → row disappears from this panel, appears in EntriesPanel
 *
 * Visible cap: 20 rows by default with a "show all" toggle, so a
 * runaway extension scan doesn't bury the panel.
 */

import { useState } from 'react'
import { Inbox, ArrowUpRight } from 'lucide-react'
import type { PanelProps } from './types'
import { TOKENS } from './types'

const VISIBLE_CAP = 20

export default function UnknownsQueuePanel({ unknowns, onPrefillEditor }: PanelProps) {
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? unknowns : unknowns.slice(0, VISIBLE_CAP)
  const hiddenCount = unknowns.length - visible.length

  return (
    <section
      style={{
        background: TOKENS.panelBg,
        border: `1px solid ${TOKENS.panelBorder}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Inbox size={18} color={TOKENS.gold} />
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: TOKENS.text,
            margin: 0,
            letterSpacing: '-0.2px',
          }}
        >
          Unknown Questions
        </h2>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: unknowns.length > 0 ? TOKENS.gold : TOKENS.textVeryDim,
            background: unknowns.length > 0 ? TOKENS.goldSoft : 'transparent',
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          {unknowns.length}
        </span>
      </header>

      {unknowns.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: TOKENS.textDim,
            margin: 0,
          }}
        >
          The queue is clean. Every question seen so far has a permanent answer.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map((u) => (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                background: TOKENS.inputBg,
                border: `1px solid ${TOKENS.inputBorder}`,
                borderRadius: 7,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: TOKENS.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.question}
                </div>
                <div style={{ fontSize: 11, color: TOKENS.textVeryDim, marginTop: 2 }}>
                  {u.source} · {u.site || u.company || 'unknown source'}
                  {u.jobTitle ? ` · ${u.jobTitle}` : ''}
                </div>
              </div>
              <button
                onClick={() =>
                  onPrefillEditor({
                    question: u.question,
                    category: 'qualitative',
                    type: 'text',
                    _unknownId: u.id,
                  })
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 10px',
                  background: TOKENS.accentSoft,
                  border: `1px solid ${TOKENS.accentBorder}`,
                  borderRadius: 6,
                  color: TOKENS.accent,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Resolve <ArrowUpRight size={12} />
              </button>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              style={{
                marginTop: 4,
                padding: '6px 10px',
                background: 'transparent',
                border: `1px dashed ${TOKENS.inputBorder}`,
                borderRadius: 6,
                color: TOKENS.textDim,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
    </section>
  )
}
