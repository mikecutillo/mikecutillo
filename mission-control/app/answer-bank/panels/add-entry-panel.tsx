'use client'

/**
 * AddEntryPanel — interactive form to add a new bank entry.
 *
 * Two ways to use it:
 *   1. Mike types a question + answer + category and clicks Save —
 *      pure manual curation, used for known gaps he wants to seed
 *      proactively.
 *   2. UnknownsQueuePanel calls onPrefillEditor with a question +
 *      _unknownId — the form prefills, the page scrolls into view,
 *      Mike fills the answer, and on save we BOTH create the bank
 *      entry AND mark the unknown resolved.
 *
 * Smart types: V1 supports text + singleChoice + range from this
 * panel. The richer types (template, aiPrompt, formula) come through
 * the Profile Seed wizard. Mike can still hand-edit those via
 * EntriesPanel inline edit later.
 *
 * AI Suggest: the "Suggest with AI ✨" button calls
 * /api/answer-bank/suggest and populates the answer field with the
 * draft + reasoning. Mike must still click Save — the endpoint never
 * auto-persists.
 */

import { useEffect, useState } from 'react'
import { Plus, Sparkles, Save, X } from 'lucide-react'
import type { AnswerCategory, AnswerType } from '@/lib/apply-worker/answer-bank-client'
import type { PanelProps, EditorDraft } from './types'
import { TOKENS } from './types'

const CATEGORIES: AnswerCategory[] = [
  'contact',
  'auth',
  'comp',
  'preference',
  'qualitative',
  'sensitive',
]

interface Props extends PanelProps {
  draft: EditorDraft | null
  onClearDraft: () => void
}

export default function AddEntryPanel({ draft, onClearDraft, onRefresh }: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [aliases, setAliases] = useState('')
  const [category, setCategory] = useState<AnswerCategory>('qualitative')
  const [type, setType] = useState<AnswerType>('text')
  const [sensitive, setSensitive] = useState(false)
  const [unknownId, setUnknownId] = useState<string | undefined>()
  const [suggesting, setSuggesting] = useState(false)
  const [reasoning, setReasoning] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pull in any prefill from UnknownsQueuePanel
  useEffect(() => {
    if (!draft) return
    if (draft.question != null) setQuestion(draft.question)
    if (draft.answer != null) setAnswer(draft.answer)
    if (draft.category) setCategory(draft.category)
    if (draft.type) setType(draft.type)
    if (draft.sensitive != null) setSensitive(draft.sensitive)
    if (draft._unknownId) setUnknownId(draft._unknownId)
    setReasoning(null)
    setError(null)
  }, [draft])

  const reset = () => {
    setQuestion('')
    setAnswer('')
    setAliases('')
    setCategory('qualitative')
    setType('text')
    setSensitive(false)
    setUnknownId(undefined)
    setReasoning(null)
    setError(null)
    onClearDraft()
  }

  const onSuggest = async () => {
    if (!question.trim()) {
      setError('Type a question first')
      return
    }
    setSuggesting(true)
    setError(null)
    try {
      const res = await fetch('/api/answer-bank/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      })
      const json = (await res.json()) as {
        answer?: string
        reasoning?: string
        error?: string
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      if (json.answer) setAnswer(json.answer)
      setReasoning(json.reasoning ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSuggesting(false)
    }
  }

  const onSave = async () => {
    if (!question.trim() || !answer.trim()) {
      setError('question and answer required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const aliasList = aliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const res = await fetch('/api/answer-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          answer: answer.trim(),
          aliases: aliasList,
          category,
          type,
          sensitive,
        }),
      })
      const json = (await res.json()) as { entry?: { id: string }; error?: string }
      if (!res.ok || !json.entry) throw new Error(json.error || `HTTP ${res.status}`)

      // If this came from an unknown, mark it resolved
      if (unknownId) {
        await fetch('/api/apply-unknowns', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: unknownId, resolvedBankEntryId: json.entry.id }),
        })
      }

      reset()
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      style={{
        background: TOKENS.panelBg,
        border: `1px solid ${unknownId ? TOKENS.accentBorder : TOKENS.panelBorder}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Plus size={18} color={TOKENS.accent} />
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: TOKENS.text,
              margin: 0,
              letterSpacing: '-0.2px',
            }}
          >
            {unknownId ? 'Resolve Unknown' : 'Add Entry'}
          </h2>
          {unknownId && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: TOKENS.accent,
                background: TOKENS.accentSoft,
                padding: '2px 8px',
                borderRadius: 999,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
              }}
            >
              From queue
            </span>
          )}
        </div>
        {(question || answer) && (
          <button
            onClick={reset}
            style={{
              background: 'transparent',
              border: 'none',
              color: TOKENS.textVeryDim,
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
            title="Clear form"
          >
            <X size={14} />
          </button>
        )}
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Question">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What is your desired salary range?"
            style={inputStyle}
          />
        </Field>

        <Field label="Answer">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="…"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          {reasoning && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: TOKENS.textDim,
                fontStyle: 'italic',
              }}
            >
              ✨ {reasoning}
            </div>
          )}
        </Field>

        <Field label="Aliases (comma-separated)">
          <input
            type="text"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="salary expectation, target salary, …"
            style={inputStyle}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AnswerCategory)}
              style={inputStyle}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AnswerType)}
              style={inputStyle}
            >
              <option value="text">text</option>
              <option value="singleChoice">singleChoice</option>
              <option value="range">range</option>
              <option value="template">template</option>
              <option value="aiPrompt">aiPrompt</option>
              <option value="formula">formula</option>
            </select>
          </Field>

          <Field label="Sensitive">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: TOKENS.text,
                padding: '9px 12px',
                background: TOKENS.inputBg,
                border: `1px solid ${TOKENS.inputBorder}`,
                borderRadius: 7,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
              />
              Mask in UI
            </label>
          </Field>
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
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              ...buttonStyle,
              background: TOKENS.greenSoft,
              border: `1px solid ${TOKENS.green}40`,
              color: TOKENS.green,
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Save size={12} /> {saving ? 'Saving…' : 'Save Entry'}
          </button>
          <button
            onClick={onSuggest}
            disabled={suggesting}
            style={{
              ...buttonStyle,
              background: TOKENS.accentSoft,
              border: `1px solid ${TOKENS.accentBorder}`,
              color: TOKENS.accent,
              opacity: suggesting ? 0.5 : 1,
            }}
          >
            <Sparkles size={12} /> {suggesting ? 'Thinking…' : 'Suggest with AI'}
          </button>
        </div>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: TOKENS.textVeryDim,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: TOKENS.inputBg,
  border: `1px solid ${TOKENS.inputBorder}`,
  borderRadius: 7,
  padding: '9px 12px',
  fontSize: 13,
  color: TOKENS.text,
  outline: 'none',
  width: '100%',
}

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 14px',
  borderRadius: 7,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
}
