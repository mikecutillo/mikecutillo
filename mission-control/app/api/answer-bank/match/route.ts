/**
 * answer-bank match — batch field-match endpoint.
 *
 * Used by:
 *   - Chrome extension `content-autofill-generic.ts` to fill forms
 *     against the shared answer bank
 *   - (Future) same-process worker calls if the orchestrator ever
 *     switches to a batch lookup — today it hits `findBestMatch` per
 *     field, which is equivalent
 *
 * Input:
 *   POST {
 *     fields: [{ label, type? }, ...],
 *     jobContext?: { company, role, description, jobId }
 *   }
 *
 * Output:
 *   {
 *     results: [{
 *       label, answer?, entryId?, similarity?, matchedOn?,
 *       sensitive?, answerType?, valueMin?, valueMax?
 *     }, ...]
 *   }
 *
 * A result with no `answer` is an unknown — the caller is expected to
 * either log it to `/api/apply-unknowns` or surface it in a "questions
 * I don't know" UI for one-time answering.
 *
 * Smart-type resolution: every match runs through `resolveAnswer()`
 * (Phase 4g), so range entries arrive with valueMin/valueMax for split
 * forms, single-choice entries return their selected enum, etc. The
 * `sensitive` flag is now a render hint only — it does NOT block fills.
 */

import { NextRequest, NextResponse } from 'next/server'
import { findBestMatch } from '@/lib/apply-worker/answer-bank-client'
import { resolveAnswer, type JobContext } from '@/lib/answer-resolver'

interface FieldInput {
  label: string
  type?: string
}

interface FieldResult {
  label: string
  type?: string
  answer?: string
  entryId?: string
  similarity?: number
  matchedOn?: string
  sensitive?: boolean
  answerType?: string
  valueMin?: string
  valueMax?: string
}

export async function POST(req: NextRequest) {
  let body: { fields?: FieldInput[]; jobContext?: JobContext }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.fields)) {
    return NextResponse.json({ error: 'fields[] required' }, { status: 400 })
  }

  const ctx: JobContext = body.jobContext || {}

  const results: FieldResult[] = []
  for (const field of body.fields) {
    if (!field?.label || typeof field.label !== 'string') {
      results.push({ label: String(field?.label ?? ''), type: field?.type })
      continue
    }
    try {
      const match = await findBestMatch(field.label)
      if (match) {
        const resolved = resolveAnswer(match.entry, ctx)
        results.push({
          label: field.label,
          type: field.type,
          answer: resolved.value,
          entryId: match.entry.id,
          similarity: match.similarity,
          matchedOn: match.matchedOn,
          sensitive: !!match.entry.sensitive,
          answerType: match.entry.type ?? 'text',
          valueMin: resolved.valueMin,
          valueMax: resolved.valueMax,
        })
      } else {
        results.push({ label: field.label, type: field.type })
      }
    } catch {
      results.push({ label: field.label, type: field.type })
    }
  }

  return NextResponse.json({ results })
}
