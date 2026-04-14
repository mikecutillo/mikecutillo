/**
 * tailor-core — shared Claude helper for single-lane tailoring.
 *
 * Used by:
 *   - app/api/job-pipeline/tailor/route.ts           (single-lane UI action)
 *   - app/api/job-pipeline/analyze-fit/route.ts      (4-lane parallel comparison)
 *
 * Isolating the Claude call here keeps both routes thin and guarantees
 * that score/summary behavior can't drift between the two surfaces.
 */

import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs/promises'
import path from 'path'

export const RESUMES_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/resumes'

export type Lane = 'A' | 'B' | 'C' | 'D'

export const LANE_FILES: Record<Lane, string> = {
  A: 'RESUME_A_IMPLEMENTATION.md',
  B: 'RESUME_B_SOLUTIONS.md',
  C: 'RESUME_C_AI_CUSTOMER_FACING.md',
  D: 'RESUME_D_STRATEGY.md',
}

export const LANE_LABELS: Record<Lane, string> = {
  A: 'Implementation / PS',
  B: 'Solutions / Presales',
  C: 'AI Customer-Facing',
  D: 'Strategy / Architecture',
}

export interface TailorSuggestion {
  section: string
  original: string
  suggested: string
}

export interface TailorResult {
  lane: Lane
  matchedKeywords: string[]
  gaps: string[]
  suggestions: TailorSuggestion[]
  fitScore: number
  fitSummary: string
}

export interface TailorInput {
  lane: Lane | string
  jobTitle?: string
  company?: string
  description: string
}

/** Accepts 'A', 'a', 'lane-a', 'lane-A' → 'A'. Falls back to 'A'. */
export function normalizeLane(input: string | undefined | null): Lane {
  if (!input) return 'A'
  const cleaned = String(input).replace(/^lane-/i, '').toUpperCase()
  if (cleaned === 'A' || cleaned === 'B' || cleaned === 'C' || cleaned === 'D') {
    return cleaned
  }
  return 'A'
}

export async function readLaneResume(lane: Lane): Promise<string> {
  const file = LANE_FILES[lane]
  try {
    return await fs.readFile(path.join(RESUMES_DIR, file), 'utf-8')
  } catch {
    return ''
  }
}

/**
 * Run the Claude tailor prompt for a single lane. Returns a well-typed
 * result with the `lane` baked in so multi-lane callers can label rows.
 *
 * Throws on Claude errors or malformed JSON — callers decide whether
 * to fail the whole request or continue with a partial.
 */
export async function tailorLane(input: TailorInput): Promise<TailorResult> {
  const lane = normalizeLane(input.lane)
  const resumeContent = await readLaneResume(lane)

  const client = new Anthropic()
  const msg = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `You are a resume tailoring expert. Analyze the fit between the candidate's resume and the job description, then return a structured JSON response.

CANDIDATE RESUME (Lane ${lane} — ${LANE_LABELS[lane]}):
${resumeContent}

JOB:
Title: ${input.jobTitle ?? 'Unknown'}
Company: ${input.company ?? 'Unknown'}
Description:
${input.description}

Return ONLY valid JSON (no markdown, no explanation) in exactly this shape:
{
  "matchedKeywords": ["keyword1", "keyword2"],
  "gaps": ["gap1", "gap2"],
  "suggestions": [
    { "section": "iCIMS bullet", "original": "original bullet text", "suggested": "improved bullet text" }
  ],
  "fitScore": 75,
  "fitSummary": "2–3 sentence summary of fit strengths and weaknesses"
}

Rules:
- matchedKeywords: up to 10 keywords/phrases from the job description that appear strongly in the resume
- gaps: up to 8 keywords/phrases in the job description that are weak or missing in the resume
- suggestions: 3–5 specific bullet rewrites targeting the job's language (1:1 swap, not new content)
- fitScore: integer 0–100
- fitSummary: honest 2–3 sentence assessment`,
      },
    ],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`Lane ${lane}: invalid AI response (no JSON block)`)
  }

  const parsed = JSON.parse(jsonMatch[0]) as Omit<TailorResult, 'lane'>
  return { lane, ...parsed }
}
