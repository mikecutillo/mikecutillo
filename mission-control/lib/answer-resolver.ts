/**
 * answer-resolver — renders a BankEntry into the actual string the
 * worker (or extension) should type into a form field.
 *
 * This is the Phase 4g indirection that lets one bank entry handle
 * salary ranges, single-choice EEOC fields, mustache templates,
 * Claude-generated qualitative answers, and date formulas — all
 * without the worker or content script knowing the difference.
 *
 * Used by:
 *   - app/api/answer-bank/match/route.ts (extension + worker)
 *   - lib/apply-worker/index.ts (Phase 2 worker)
 *
 * Contract:
 *   resolveAnswer(entry, ctx) → { value, valueMin?, valueMax? }
 *   - `value` is the canonical string to type
 *   - `valueMin` / `valueMax` are present for range types so a form
 *      with split min/max inputs can use both directly
 */

import type {
  BankEntry,
  RangePayload,
} from './apply-worker/answer-bank-client'

export interface JobContext {
  company?: string
  role?: string
  description?: string
  jobId?: string
}

export interface ResolvedAnswer {
  /** Canonical string to type into a single-input field. */
  value: string
  /** For range types: the low end (split min/max forms). */
  valueMin?: string
  /** For range types: the high end (split min/max forms). */
  valueMax?: string
  /** Resolution metadata for the audit trail. */
  meta?: {
    type: string
    fallback?: string
    aiGenerated?: boolean
    cached?: boolean
  }
}

function pickFromRange(r: RangePayload): number {
  switch (r.fallback) {
    case 'min':
      return r.min
    case 'max':
      return r.max
    case 'preferred':
      return r.preferred ?? Math.round((r.min + r.max) / 2)
    case 'mid':
    default:
      return Math.round((r.min + r.max) / 2)
  }
}

function formatMoney(n: number): string {
  // No currency symbol — most forms have a separate $ field or accept
  // the bare number. Caller can wrap as needed.
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function renderTemplate(template: string, ctx: JobContext): string {
  const today = new Date().toISOString().slice(0, 10)
  return template
    .replace(/\{\{\s*company\s*\}\}/gi, ctx.company || '')
    .replace(/\{\{\s*role\s*\}\}/gi, ctx.role || '')
    .replace(/\{\{\s*today\s*\}\}/gi, today)
    .replace(/\{\{\s*description\s*\}\}/gi, ctx.description || '')
}

function evalFormula(expr: string): string {
  // Supported forms:
  //   today + N days
  //   today + N weeks
  //   today + N months
  //   today
  const trimmed = expr.trim().toLowerCase()
  if (trimmed === 'today') {
    return new Date().toISOString().slice(0, 10)
  }
  const m = trimmed.match(/^today\s*\+\s*(\d+)\s*(day|days|week|weeks|month|months)$/)
  if (m) {
    const n = parseInt(m[1], 10)
    const unit = m[2]
    const d = new Date()
    if (unit.startsWith('day')) d.setDate(d.getDate() + n)
    else if (unit.startsWith('week')) d.setDate(d.getDate() + n * 7)
    else if (unit.startsWith('month')) d.setMonth(d.getMonth() + n)
    return d.toISOString().slice(0, 10)
  }
  // Unknown — return the raw expr so the caller sees something
  return expr
}

/**
 * Resolve a bank entry to its concrete fill value(s).
 *
 * For aiPrompt entries, this function does NOT call Claude itself —
 * it returns the raw prompt as a hint. The caller (worker or extension)
 * should call `/api/answer-bank/suggest` separately when it wants the
 * generated answer; that endpoint owns Claude + caching.
 */
export function resolveAnswer(
  entry: BankEntry,
  ctx: JobContext = {},
): ResolvedAnswer {
  const type = entry.type ?? 'text'

  switch (type) {
    case 'text': {
      const value = entry.text?.value ?? entry.answer ?? ''
      return { value, meta: { type: 'text' } }
    }

    case 'range': {
      const r = entry.range
      if (!r) return { value: entry.answer || '', meta: { type: 'range' } }
      const single = pickFromRange(r)
      return {
        value: formatMoney(single),
        valueMin: formatMoney(r.min),
        valueMax: formatMoney(r.max),
        meta: { type: 'range', fallback: r.fallback },
      }
    }

    case 'singleChoice': {
      const sc = entry.singleChoice
      if (!sc) return { value: entry.answer || '', meta: { type: 'singleChoice' } }
      return { value: sc.selected, meta: { type: 'singleChoice' } }
    }

    case 'template': {
      const tpl = entry.template?.template ?? entry.answer ?? ''
      return { value: renderTemplate(tpl, ctx), meta: { type: 'template' } }
    }

    case 'aiPrompt': {
      // The resolver returns the legacy answer (if any was cached) so
      // the worker has a fallback. The /api/answer-bank/suggest call
      // is the path for fresh generation.
      return {
        value: entry.answer ?? '',
        meta: { type: 'aiPrompt', aiGenerated: !!entry.answer },
      }
    }

    case 'formula': {
      const expr = entry.formula?.expr ?? ''
      return { value: evalFormula(expr), meta: { type: 'formula' } }
    }

    default:
      return { value: entry.answer ?? '', meta: { type: 'text' } }
  }
}

/**
 * Build a human-readable preview string for the management UI's row
 * display. Range entries become "$180k–$220k (mid)", singleChoice
 * become "Male", template entries quote the template, etc.
 */
export function previewAnswer(entry: BankEntry): string {
  const type = entry.type ?? 'text'
  switch (type) {
    case 'text':
      return entry.text?.value ?? entry.answer ?? ''
    case 'range': {
      const r = entry.range
      if (!r) return entry.answer || ''
      const fmt = (n: number) =>
        n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`
      return `${fmt(r.min)}–${fmt(r.max)} (${r.fallback})`
    }
    case 'singleChoice':
      return entry.singleChoice?.selected ?? entry.answer ?? ''
    case 'template':
      return entry.template?.template ?? entry.answer ?? ''
    case 'aiPrompt':
      return entry.answer
        ? `[AI cached] ${entry.answer.slice(0, 60)}…`
        : `[AI on-demand] ${entry.aiPrompt?.prompt?.slice(0, 60) ?? ''}…`
    case 'formula':
      return `= ${entry.formula?.expr ?? ''}`
    default:
      return entry.answer ?? ''
  }
}
