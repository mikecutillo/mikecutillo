'use client'

/**
 * MatchTesterPanel — debugger for "why didn't this question match?"
 *
 * Calls /api/answer-bank/rank with the user's free-text question and
 * shows the top 5 candidates with similarity scores. Useful for:
 *   - "I added an alias, did the threshold accept it?"
 *   - "This question keeps landing in unknowns even though I have an
 *      entry for it — what's the closest match?"
 *
 * Sensitive entries appear with `[sensitive]` instead of the answer
 * (the rank route masks them server-side).
 */

import { useState } from 'react'
import { Search } from 'lucide-react'
import type { BankEntry } from '@/lib/apply-worker/answer-bank-client'
import type { PanelProps } from './types'
import { TOKENS } from './types'

const FUZZY_THRESHOLD = 0.55 // matches default in answer-bank-client

interface Candidate {
  similarity: number
  matchedOn: string
  entry: BankEntry
}

export default function MatchTesterPanel({}: PanelProps) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onTest = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/answer-bank/rank?q=${encodeURIComponent(query.trim())}&limit=5`,
      )
      const json = (await res.json()) as { candidates?: Candidate[]; error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setCandidates(json.candidates ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

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
        <Search size={18} color={TOKENS.gold} />
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: TOKENS.text,
            margin: 0,
            letterSpacing: '-0.2px',
          }}
        >
          Match Tester
        </h2>
        <span style={{ fontSize: 11, color: TOKENS.textVeryDim }}>
          fuzzy threshold {FUZZY_THRESHOLD.toFixed(2)}
        </span>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onTest()
          }}
          placeholder="Try a question Mike's bank should know…"
          style={{
            flex: 1,
            background: TOKENS.inputBg,
            border: `1px solid ${TOKENS.inputBorder}`,
            borderRadius: 7,
            padding: '9px 12px',
            fontSize: 13,
            color: TOKENS.text,
            outline: 'none',
          }}
        />
        <button
          onClick={onTest}
          disabled={loading || !query.trim()}
          style={{
            padding: '9px 14px',
            background: TOKENS.accentSoft,
            border: `1px solid ${TOKENS.accentBorder}`,
            borderRadius: 7,
            color: TOKENS.accent,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'Searching…' : 'Test'}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            background: '#3A1414',
            border: '1px solid #6A2020',
            borderRadius: 7,
            color: '#FFB0B0',
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {candidates.map((c, idx) => {
            const accepted = c.similarity >= FUZZY_THRESHOLD
            const color = accepted ? TOKENS.green : TOKENS.gold
            return (
              <div
                key={c.entry.id + idx}
                style={{
                  padding: 10,
                  background: TOKENS.inputBg,
                  border: `1px solid ${TOKENS.inputBorder}`,
                  borderRadius: 7,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color,
                      background: `${color}20`,
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontFamily: 'monospace',
                    }}
                  >
                    {c.similarity.toFixed(3)}
                  </span>
                  <span style={{ fontSize: 13, color: TOKENS.text, flex: 1 }}>
                    {c.entry.question}
                  </span>
                  {accepted && idx === 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: TOKENS.green,
                        textTransform: 'uppercase',
                      }}
                    >
                      ✓ would match
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: TOKENS.textDim }}>
                  → {c.entry.answer || '(empty)'}
                </div>
                {c.matchedOn !== c.entry.question && (
                  <div style={{ fontSize: 10, color: TOKENS.textVeryDim, fontStyle: 'italic' }}>
                    matched on alias: {c.matchedOn}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
