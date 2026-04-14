/**
 * answer-bank rank — debug endpoint that returns the top-N candidate
 * matches for a free-text question, even when none clear the fuzzy
 * threshold.
 *
 * Used by Mission Control's MatchTesterPanel (Phase 4) so Mike can
 * triage drift: "why didn't this question match?", "would adding this
 * alias help?", etc. Wraps `rankCandidates` from the bank client so
 * the same scoring logic the worker uses is what the UI sees.
 *
 *   GET ?q=…&limit=5 → { candidates: MatchResult[] }
 *
 * Sensitive entries: the answer text is masked in the response so
 * screenshots of the debugger don't leak salary/visa/etc. The UI
 * already knows the entry is sensitive via `entry.sensitive`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { rankCandidates } from '@/lib/apply-worker/answer-bank-client'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || '5', 10) || 5, 1),
    20,
  )

  if (!q) {
    return NextResponse.json({ error: 'q required' }, { status: 400 })
  }

  const candidates = await rankCandidates(q, limit)

  // Mask sensitive answers — the entry shape is preserved so the UI
  // can still render the question, category, similarity, etc. Only
  // the answer string is replaced.
  const masked = candidates.map((c) => ({
    similarity: c.similarity,
    matchedOn: c.matchedOn,
    entry: {
      ...c.entry,
      answer: c.entry.sensitive ? '[sensitive]' : c.entry.answer,
      text: c.entry.sensitive ? undefined : c.entry.text,
      range: c.entry.sensitive ? undefined : c.entry.range,
      singleChoice: c.entry.sensitive ? undefined : c.entry.singleChoice,
    },
  }))

  return NextResponse.json({ candidates: masked, query: q, limit })
}
