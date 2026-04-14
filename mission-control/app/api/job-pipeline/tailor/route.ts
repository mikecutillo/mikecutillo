import { NextRequest, NextResponse } from 'next/server'
import { tailorLane } from '@/lib/tailor-core'

/**
 * Single-lane tailor endpoint — used by the existing "Run Tailor Agent"
 * UI button. The heavy lifting lives in lib/tailor-core so this route
 * and app/api/job-pipeline/analyze-fit share exactly one Claude call path.
 */
export async function POST(req: NextRequest) {
  try {
    const { jobTitle, company, description, lane } = await req.json()
    if (!description) {
      return NextResponse.json({ error: 'description required' }, { status: 400 })
    }

    const result = await tailorLane({ lane, jobTitle, company, description })
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
