import { NextRequest, NextResponse } from 'next/server'
import { tailorLane, TailorResult, Lane } from '@/lib/tailor-core'

/**
 * Multi-lane analyze-fit endpoint — runs the single-lane tailor against
 * all 4 resume lanes in parallel and returns a comparative fit summary.
 *
 * The `recommendedLane` is the highest-scoring lane (ties broken by the
 * order A > B > C > D). `canMerge` is true when the top two lanes are
 * both ≥70 and within 10 points of each other — that's the gate for the
 * "Generate Custom Resume" action, since merging lanes only makes sense
 * when two angles are both strong enough to contribute real content.
 */

const LANES: Lane[] = ['A', 'B', 'C', 'D']

interface AnalyzeFitResponse {
  lanes: TailorResult[]
  recommendedLane: Lane
  canMerge: boolean
  mergeCandidates?: [Lane, Lane]
  errors: { lane: Lane; error: string }[]
}

export async function POST(req: NextRequest) {
  try {
    const { jobTitle, company, description } = await req.json()
    if (!description) {
      return NextResponse.json({ error: 'description required' }, { status: 400 })
    }

    // Fan out to all 4 lanes in parallel — any lane that blows up is
    // captured as a partial error so one bad Claude response doesn't
    // kill the whole analysis.
    const settled = await Promise.allSettled(
      LANES.map((lane) => tailorLane({ lane, jobTitle, company, description })),
    )

    const results: TailorResult[] = []
    const errors: { lane: Lane; error: string }[] = []
    settled.forEach((r, i) => {
      const lane = LANES[i]
      if (r.status === 'fulfilled') {
        results.push(r.value)
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        errors.push({ lane, error: msg })
      }
    })

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'All lanes failed', details: errors },
        { status: 500 },
      )
    }

    // Sort by fitScore desc, then by lane order as tiebreaker.
    const sorted = [...results].sort((a, b) => {
      if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore
      return LANES.indexOf(a.lane) - LANES.indexOf(b.lane)
    })

    const recommendedLane = sorted[0].lane
    let canMerge = false
    let mergeCandidates: [Lane, Lane] | undefined
    if (sorted.length >= 2) {
      const [top, second] = sorted
      if (top.fitScore >= 70 && second.fitScore >= 70 && top.fitScore - second.fitScore <= 10) {
        canMerge = true
        mergeCandidates = [top.lane, second.lane]
      }
    }

    const response: AnalyzeFitResponse = {
      lanes: results,
      recommendedLane,
      canMerge,
      mergeCandidates,
      errors,
    }
    return NextResponse.json(response)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
