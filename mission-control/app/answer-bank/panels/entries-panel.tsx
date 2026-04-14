'use client'

/**
 * EntriesPanel — category-grouped table of every bank entry.
 *
 * - Per-row dirty state + per-row PATCH (no global save-all)
 * - Sensitive entries are masked by default with a per-row reveal toggle
 * - Category sections are derived from the data, so a typo creates a
 *   visible "⚠ Uncategorized" bucket instead of a silent drop
 * - Inline edit beats modals for a dense table view
 */

import { useMemo, useState } from 'react'
import { Database, Eye, EyeOff, Trash2, Save } from 'lucide-react'
import type { BankEntry } from '@/lib/apply-worker/answer-bank-client'
import type { PanelProps } from './types'
import { TOKENS } from './types'
import { previewAnswer } from '@/lib/answer-resolver'

const KNOWN_CATEGORIES = new Set([
  'contact',
  'auth',
  'comp',
  'preference',
  'qualitative',
  'sensitive',
])

export default function EntriesPanel({ entries, onRefresh }: PanelProps) {
  const grouped = useMemo(() => {
    const buckets: Record<string, BankEntry[]> = {}
    for (const e of entries) {
      const key = KNOWN_CATEGORIES.has(e.category) ? e.category : '⚠ Uncategorized'
      if (!buckets[key]) buckets[key] = []
      buckets[key].push(e)
    }
    return buckets
  }, [entries])

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
        <Database size={18} color={TOKENS.accent} />
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: TOKENS.text,
            margin: 0,
            letterSpacing: '-0.2px',
          }}
        >
          All Entries
        </h2>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: TOKENS.textVeryDim,
          }}
        >
          {entries.length}
        </span>
      </header>

      {entries.length === 0 ? (
        <p style={{ fontSize: 12, color: TOKENS.textDim, margin: 0 }}>
          The bank is empty. Run the Profile Seed Pack to bootstrap, or add entries manually above.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {Object.entries(grouped).map(([cat, rows]) => (
            <CategoryGroup key={cat} category={cat} rows={rows} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </section>
  )
}

function CategoryGroup({
  category,
  rows,
  onRefresh,
}: {
  category: string
  rows: BankEntry[]
  onRefresh: () => Promise<void>
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: TOKENS.textVeryDim,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          marginBottom: 6,
        }}
      >
        {category} · {rows.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((row) => (
          <EntryRow key={row.id} entry={row} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  )
}

function EntryRow({
  entry,
  onRefresh,
}: {
  entry: BankEntry
  onRefresh: () => Promise<void>
}) {
  const [draft, setDraft] = useState<BankEntry>(entry)
  const [revealed, setRevealed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    draft.question !== entry.question ||
    draft.answer !== entry.answer ||
    JSON.stringify(draft.aliases) !== JSON.stringify(entry.aliases)

  const display = previewAnswer(entry)
  const showMasked = entry.sensitive && !revealed

  const onSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/answer-bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: entry.id,
          patch: {
            question: draft.question,
            answer: draft.answer,
            aliases: draft.aliases,
          },
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!confirm(`Delete "${entry.question}"?`)) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/answer-bank?id=${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <div
      style={{
        background: TOKENS.inputBg,
        border: `1px solid ${dirty ? TOKENS.accentBorder : TOKENS.inputBorder}`,
        borderRadius: 7,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={draft.question}
          onChange={(e) => setDraft({ ...draft, question: e.target.value })}
          style={{ ...rowInputStyle, flex: 1 }}
        />
        <span
          style={{
            fontSize: 10,
            color: TOKENS.textVeryDim,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.type ?? 'text'} · used {entry.useCount}×
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={showMasked ? '••••••••' : draft.answer}
          onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
          disabled={showMasked}
          placeholder={display}
          style={{ ...rowInputStyle, flex: 1, color: showMasked ? TOKENS.textVeryDim : TOKENS.text }}
        />
        {entry.sensitive && (
          <button
            onClick={() => setRevealed((v) => !v)}
            style={iconButtonStyle}
            title={revealed ? 'Hide' : 'Reveal'}
          >
            {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
        {dirty && (
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              ...iconButtonStyle,
              color: TOKENS.green,
              borderColor: `${TOKENS.green}40`,
            }}
            title="Save"
          >
            <Save size={12} />
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={deleting}
          style={{
            ...iconButtonStyle,
            color: TOKENS.red,
            borderColor: `${TOKENS.red}40`,
          }}
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {entry.aliases.length > 0 && (
        <input
          type="text"
          value={draft.aliases.join(', ')}
          onChange={(e) =>
            setDraft({
              ...draft,
              aliases: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          style={{
            ...rowInputStyle,
            fontSize: 11,
            color: TOKENS.textDim,
          }}
        />
      )}

      {error && (
        <div style={{ fontSize: 11, color: '#FFB0B0' }}>{error}</div>
      )}
    </div>
  )
}

const rowInputStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontSize: 12,
  color: TOKENS.text,
  padding: 2,
  fontFamily: 'inherit',
}

const iconButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  background: 'transparent',
  border: `1px solid ${TOKENS.inputBorder}`,
  borderRadius: 5,
  color: TOKENS.textDim,
  cursor: 'pointer',
  flexShrink: 0,
}
