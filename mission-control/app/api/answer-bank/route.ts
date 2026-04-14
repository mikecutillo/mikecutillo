/**
 * answer-bank — CRUD endpoints for the fuzzy-matched answer bank.
 *
 * Used by:
 *   - Mission Control Answer Bank UI (Phase 4) — full manage surface
 *   - Phase 2 needs-answer inline form (POST new answer)
 *   - Phase 3 Chrome extension popup (inline-resolve, profile seed wizard)
 *
 * Shape matches `lib/apply-worker/answer-bank-client.ts`. That module
 * owns the file read/write — this route is a thin HTTP surface.
 *
 *   GET                    → { entries: BankEntry[] }
 *   POST { question, answer, aliases?, category?, sourceJobId?,
 *          type?, sensitive?, text?, range?, singleChoice?,
 *          template?, aiPrompt?, formula? }
 *                          → { entry: BankEntry }
 *   PATCH { id, patch: Partial<BankEntry> }
 *                          → { entry: BankEntry }
 *   DELETE ?id=…           → { ok: boolean }
 *
 * Phase 4 smart-type expansion: POST now accepts the full discriminated
 * union (text/range/singleChoice/template/aiPrompt/formula). The legacy
 * { question, answer } shape still works — entries created without a
 * `type` default to 'text'. The bank client's read-time migration
 * guarantees existing entries get tagged on first load.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  listEntries,
  addEntry,
  updateEntry,
  deleteEntry,
  BankEntry,
  AnswerCategory,
  AnswerType,
  RangePayload,
  SingleChoicePayload,
  TemplatePayload,
  AiPromptPayload,
  FormulaPayload,
} from '@/lib/apply-worker/answer-bank-client'
import { previewAnswer } from '@/lib/answer-resolver'

const ALLOWED_CATEGORIES: AnswerCategory[] = [
  'contact',
  'auth',
  'comp',
  'preference',
  'qualitative',
  'sensitive',
]

const ALLOWED_TYPES: AnswerType[] = [
  'text',
  'range',
  'singleChoice',
  'template',
  'aiPrompt',
  'formula',
]

export async function GET() {
  const entries = await listEntries()
  return NextResponse.json({ entries })
}

interface PostBody {
  question?: string
  answer?: string
  aliases?: string[]
  category?: string
  sourceJobId?: string | null
  type?: string
  sensitive?: boolean
  text?: { value: string }
  range?: RangePayload
  singleChoice?: SingleChoicePayload
  template?: TemplatePayload
  aiPrompt?: AiPromptPayload
  formula?: FormulaPayload
}

export async function POST(req: NextRequest) {
  let body: PostBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.question || typeof body.question !== 'string') {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }

  const type: AnswerType =
    body.type && (ALLOWED_TYPES as string[]).includes(body.type)
      ? (body.type as AnswerType)
      : 'text'

  // For text type, the legacy `answer` field is still required so
  // the bank stays usable for callers that don't know about smart
  // types yet (the worker, the existing CRUD pattern).
  // For smart types, `answer` is auto-derived from the payload as a
  // human-readable preview so the management UI can render rows
  // without resolving the payload.
  let answer = (body.answer || '').trim()
  if (type === 'text' && !answer) {
    // Allow `text.value` to satisfy `answer` for the new smart-type shape
    answer = (body.text?.value || '').trim()
    if (!answer) {
      return NextResponse.json(
        { error: 'answer (or text.value) required for text entries' },
        { status: 400 },
      )
    }
  }

  // Validate type-specific payloads
  if (type === 'range') {
    if (!body.range || typeof body.range.min !== 'number' || typeof body.range.max !== 'number') {
      return NextResponse.json(
        { error: 'range.min and range.max required for range entries' },
        { status: 400 },
      )
    }
    if (!['min', 'mid', 'max', 'preferred'].includes(body.range.fallback)) {
      body.range.fallback = 'mid'
    }
  }
  if (type === 'singleChoice') {
    if (
      !body.singleChoice ||
      !Array.isArray(body.singleChoice.options) ||
      !body.singleChoice.selected
    ) {
      return NextResponse.json(
        { error: 'singleChoice.options[] and singleChoice.selected required' },
        { status: 400 },
      )
    }
  }
  if (type === 'template' && !body.template?.template) {
    return NextResponse.json(
      { error: 'template.template required for template entries' },
      { status: 400 },
    )
  }
  if (type === 'aiPrompt' && !body.aiPrompt?.prompt) {
    return NextResponse.json(
      { error: 'aiPrompt.prompt required for aiPrompt entries' },
      { status: 400 },
    )
  }
  if (type === 'formula' && !body.formula?.expr) {
    return NextResponse.json(
      { error: 'formula.expr required for formula entries' },
      { status: 400 },
    )
  }

  const category =
    body.category && (ALLOWED_CATEGORIES as string[]).includes(body.category)
      ? (body.category as AnswerCategory)
      : 'qualitative'

  // Auto-derive a preview string for non-text types so list views
  // have something to render without going through resolveAnswer.
  let displayAnswer = answer
  if (type !== 'text') {
    const stub: BankEntry = {
      id: 'preview',
      question: body.question,
      aliases: [],
      answer: '',
      category,
      confidence: 0.85,
      useCount: 0,
      lastUsedAt: null,
      sourceJobId: null,
      type,
      sensitive: body.sensitive ?? category === 'sensitive',
      text: type === 'text' ? { value: answer } : undefined,
      range: body.range,
      singleChoice: body.singleChoice,
      template: body.template,
      aiPrompt: body.aiPrompt,
      formula: body.formula,
    }
    displayAnswer = previewAnswer(stub) || answer
  }

  const entry = await addEntry({
    question: body.question.trim(),
    answer: displayAnswer,
    aliases: Array.isArray(body.aliases) ? body.aliases : [],
    category,
    sourceJobId: body.sourceJobId ?? null,
    type,
    sensitive: body.sensitive ?? category === 'sensitive',
    text: type === 'text' ? { value: answer } : body.text,
    range: body.range,
    singleChoice: body.singleChoice,
    template: body.template,
    aiPrompt: body.aiPrompt,
    formula: body.formula,
  })
  return NextResponse.json({ entry }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; patch?: Partial<BankEntry> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!body.patch || typeof body.patch !== 'object') {
    return NextResponse.json({ error: 'patch required' }, { status: 400 })
  }

  // Strip fields that must not be mutated via PATCH
  const safe: Partial<Omit<BankEntry, 'id'>> = { ...body.patch }
  delete (safe as { id?: unknown }).id

  const updated = await updateEntry(body.id, safe)
  if (!updated) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
  }
  return NextResponse.json({ entry: updated })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const ok = await deleteEntry(id)
  if (!ok) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
