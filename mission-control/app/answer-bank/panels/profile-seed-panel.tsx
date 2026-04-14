'use client'

/**
 * ProfileSeedPanel — one-time wizard that pre-populates the bank with
 * the standard fields every job application asks (Phase 4h).
 *
 * Each row from seed-schema.ts is rendered as a form input with the
 * appropriate widget for its type. On Save, the row POSTs to
 * /api/answer-bank with full type-specific payload + generous
 * pre-populated aliases. Already-completed rows show with a green
 * checkmark; Mike can edit any time, and partial completion is
 * preserved across page reloads (state lives in the bank).
 *
 * "Already completed" detection: a seed row is considered done if any
 * existing bank entry matches its question (lowercase compare) OR any
 * of its aliases.
 */

import { useMemo, useState } from 'react'
import { Sparkles, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { BankEntry } from '@/lib/apply-worker/answer-bank-client'
import type { PanelProps } from './types'
import { TOKENS } from './types'
import { SEED_SECTIONS, type SeedRow, type SeedSection } from '../seed-schema'

export default function ProfileSeedPanel({ entries, onRefresh }: PanelProps) {
  const [open, setOpen] = useState(false)

  const seenQuestions = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) {
      set.add(e.question.toLowerCase().trim())
      for (const a of e.aliases ?? []) set.add(a.toLowerCase().trim())
    }
    return set
  }, [entries])

  const totalRows = SEED_SECTIONS.reduce((n, s) => n + s.rows.length, 0)
  const doneCount = SEED_SECTIONS.reduce(
    (n, s) =>
      n +
      s.rows.filter((r) => isRowComplete(r, seenQuestions)).length,
    0,
  )

  return (
    <section
      style={{
        background: TOKENS.panelBg,
        border: `1px solid ${TOKENS.panelBorder}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      <header
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          marginBottom: open ? 14 : 0,
        }}
      >
        <Sparkles size={18} color={TOKENS.gold} />
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: TOKENS.text,
            margin: 0,
            letterSpacing: '-0.2px',
          }}
        >
          Profile Seed Pack
        </h2>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: doneCount === totalRows ? TOKENS.green : TOKENS.gold,
            background: doneCount === totalRows ? TOKENS.greenSoft : TOKENS.goldSoft,
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          {doneCount} / {totalRows}
        </span>
        <span style={{ flex: 1 }} />
        {open ? (
          <ChevronUp size={16} color={TOKENS.textDim} />
        ) : (
          <ChevronDown size={16} color={TOKENS.textDim} />
        )}
      </header>

      {!open && (
        <p style={{ fontSize: 12, color: TOKENS.textDim, margin: 0 }}>
          One-time wizard. Five minutes here turns 80% of future application
          unknowns into knowns. Click to expand.
        </p>
      )}

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {SEED_SECTIONS.map((section) => (
            <SeedSectionView
              key={section.id}
              section={section}
              seenQuestions={seenQuestions}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function isRowComplete(row: SeedRow, seen: Set<string>): boolean {
  if (seen.has(row.question.toLowerCase().trim())) return true
  for (const a of row.aliases) {
    if (seen.has(a.toLowerCase().trim())) return true
  }
  return false
}

function SeedSectionView({
  section,
  seenQuestions,
  onRefresh,
}: {
  section: SeedSection
  seenQuestions: Set<string>
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
          marginBottom: 4,
        }}
      >
        {section.title}
      </div>
      <div style={{ fontSize: 11, color: TOKENS.textDim, marginBottom: 8 }}>
        {section.description}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {section.rows.map((row) => (
          <SeedRowView
            key={row.key}
            row={row}
            done={isRowComplete(row, seenQuestions)}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  )
}

function SeedRowView({
  row,
  done,
  onRefresh,
}: {
  row: SeedRow
  done: boolean
  onRefresh: () => Promise<void>
}) {
  const [textVal, setTextVal] = useState(
    row.defaultValue ??
      row.defaultRange?.min?.toString() ??
      row.defaultFormula?.expr ??
      '',
  )
  const [rangeMin, setRangeMin] = useState(row.defaultRange?.min ?? 100000)
  const [rangeMax, setRangeMax] = useState(row.defaultRange?.max ?? 200000)
  const [selected, setSelected] = useState(
    row.defaultSingleChoice?.selected ?? row.defaultSingleChoice?.options?.[0] ?? '',
  )
  const [saving, setSaving] = useState(false)
  const [savedNow, setSavedNow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // Build POST body keyed by row.type
      const body: Record<string, unknown> = {
        question: row.question,
        aliases: row.aliases,
        category: row.category,
        type: row.type,
        sensitive: row.sensitive ?? row.category === 'sensitive',
      }

      switch (row.type) {
        case 'text':
          if (!textVal.trim()) throw new Error('value required')
          body.answer = textVal.trim()
          body.text = { value: textVal.trim() }
          break
        case 'range':
          if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) {
            throw new Error('numeric range required')
          }
          body.range = {
            min: rangeMin,
            max: rangeMax,
            fallback: row.defaultRange?.fallback ?? 'mid',
          }
          // answer auto-derived server-side from previewAnswer
          body.answer = `$${rangeMin}-$${rangeMax}`
          break
        case 'singleChoice':
          if (!selected) throw new Error('selection required')
          body.singleChoice = {
            options: row.defaultSingleChoice?.options ?? [selected],
            selected,
          }
          body.answer = selected
          break
        case 'template':
          body.template = row.defaultTemplate ?? { template: textVal }
          body.answer = (row.defaultTemplate?.template ?? textVal).slice(0, 80)
          break
        case 'aiPrompt':
          body.aiPrompt = row.defaultAiPrompt ?? {
            prompt: textVal,
            cachePerCompany: false,
          }
          body.answer = `[AI on-demand] ${(row.defaultAiPrompt?.prompt ?? textVal).slice(0, 60)}…`
          break
        case 'formula':
          if (!textVal.trim()) throw new Error('formula required')
          body.formula = { expr: textVal.trim() }
          body.answer = `= ${textVal.trim()}`
          break
      }

      const res = await fetch('/api/answer-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { entry?: BankEntry; error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)

      setSavedNow(true)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const isDone = done || savedNow

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 10,
        background: TOKENS.inputBg,
        border: `1px solid ${isDone ? `${TOKENS.green}40` : TOKENS.inputBorder}`,
        borderRadius: 7,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isDone && <Check size={14} color={TOKENS.green} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: TOKENS.text, flex: 1 }}>
          {row.label}
        </span>
        <span style={{ fontSize: 10, color: TOKENS.textVeryDim, fontFamily: 'monospace' }}>
          {row.type}
        </span>
      </div>
      {row.hint && (
        <div style={{ fontSize: 10, color: TOKENS.textVeryDim, fontStyle: 'italic' }}>
          {row.hint}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
        <RowInput
          row={row}
          textVal={textVal}
          setTextVal={setTextVal}
          rangeMin={rangeMin}
          setRangeMin={setRangeMin}
          rangeMax={rangeMax}
          setRangeMax={setRangeMax}
          selected={selected}
          setSelected={setSelected}
        />
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: '6px 10px',
            background: isDone ? TOKENS.greenSoft : TOKENS.accentSoft,
            border: `1px solid ${isDone ? `${TOKENS.green}40` : TOKENS.accentBorder}`,
            borderRadius: 6,
            color: isDone ? TOKENS.green : TOKENS.accent,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {saving ? '…' : isDone ? 'Update' : 'Save'}
        </button>
      </div>

      {error && <div style={{ fontSize: 11, color: '#FFB0B0' }}>{error}</div>}
    </div>
  )
}

function RowInput({
  row,
  textVal,
  setTextVal,
  rangeMin,
  setRangeMin,
  rangeMax,
  setRangeMax,
  selected,
  setSelected,
}: {
  row: SeedRow
  textVal: string
  setTextVal: (v: string) => void
  rangeMin: number
  setRangeMin: (v: number) => void
  rangeMax: number
  setRangeMax: (v: number) => void
  selected: string
  setSelected: (v: string) => void
}) {
  const baseStyle: React.CSSProperties = {
    flex: 1,
    background: 'transparent',
    border: `1px solid ${TOKENS.inputBorder}`,
    borderRadius: 5,
    padding: '6px 10px',
    fontSize: 12,
    color: TOKENS.text,
    outline: 'none',
    fontFamily: 'inherit',
  }

  if (row.type === 'range') {
    return (
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        <input
          type="number"
          value={rangeMin}
          onChange={(e) => setRangeMin(Number(e.target.value))}
          placeholder="min"
          style={baseStyle}
        />
        <input
          type="number"
          value={rangeMax}
          onChange={(e) => setRangeMax(Number(e.target.value))}
          placeholder="max"
          style={baseStyle}
        />
      </div>
    )
  }

  if (row.type === 'singleChoice') {
    const options = row.defaultSingleChoice?.options ?? []
    return (
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={baseStyle}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }

  if (row.type === 'aiPrompt' || row.type === 'template') {
    return (
      <input
        type="text"
        value={textVal}
        onChange={(e) => setTextVal(e.target.value)}
        placeholder={
          row.type === 'aiPrompt'
            ? row.defaultAiPrompt?.prompt
            : row.defaultTemplate?.template
        }
        style={baseStyle}
      />
    )
  }

  // text + formula
  return (
    <input
      type="text"
      value={textVal}
      onChange={(e) => setTextVal(e.target.value)}
      placeholder={row.placeholder}
      style={baseStyle}
    />
  )
}
