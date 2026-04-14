import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs/promises'
import path from 'path'
import { logAiUsage, estimateCost } from '@/lib/ai-usage-logger'
import {
  RESUMES_DIR,
  LANE_LABELS,
  Lane,
  normalizeLane,
  readLaneResume,
} from '@/lib/tailor-core'

/**
 * Cross-lane custom resume generator.
 *
 * Reads all 4 lane files + MASTER_RESUME.md, hands them to Claude with an
 * explicit "no hallucination" constraint, then runs a server-side
 * substring guard over every bullet Claude returns. Any bullet that
 * can't be grounded in the stated source lane OR in MASTER is dropped
 * with a note in `provenanceNotes` — the happy path of the Phase 2
 * worker auto-submits, so this guard is load-bearing, not advisory.
 *
 * Output:
 *   - `markdown`        cleaned markdown ready for md-to-pdf in Phase 2
 *   - `bullets[]`       per-bullet objects with sourceLane for UI pills
 *   - `fitScore`        Claude's fit estimate for the merged resume
 *   - `provenanceNotes` any warnings (dropped bullets, partial grounding)
 *
 * Also writes to `resumes/generated/{jobId}.md` + `{jobId}.meta.json`
 * so Phase 2's resume-exporter can hash and cache by content.
 */

const GENERATED_DIR = path.join(RESUMES_DIR, 'generated')

interface Bullet {
  text: string
  sourceLane: Lane | 'MASTER'
  section?: string
}

interface CustomResumeResponse {
  markdown: string
  bullets: Bullet[]
  fitScore: number
  provenanceNotes: string[]
  recommendedLane: Lane
  droppedCount: number
}

// ── Hallucination guard ───────────────────────────────────────────────────────

// Common English stopwords we strip before substring matching — keeps the
// check focused on meaningful nouns/verbs rather than filler.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'them', 'his', 'her', 'their', 'our',
  'my', 'your', 'its', 'who', 'what', 'when', 'where', 'why', 'how',
])

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function significantWords(text: string): string[] {
  return normalize(text).split(' ').filter((w) => w.length >= 3 && !STOPWORDS.has(w))
}

/**
 * Returns true if at least `minMatches` of the bullet's significant words
 * appear in `source` (either the source lane file or MASTER). A simple
 * substring check is too permissive (common phrases match anywhere),
 * while requiring a full phrase match is too strict (Claude rephrases).
 * Word-overlap at a reasonable threshold is the middle ground.
 */
function isGroundedIn(bullet: string, source: string, minMatches = 4): boolean {
  const bulletWords = new Set(significantWords(bullet))
  const sourceNorm = normalize(source)
  let hits = 0
  for (const w of bulletWords) {
    // Word boundary check — prevents "lead" matching "leadership" unless
    // it's a whole word in source, which is what we want.
    const re = new RegExp(`\\b${w}\\b`)
    if (re.test(sourceNorm)) {
      hits++
      if (hits >= minMatches) return true
    }
  }
  return false
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const aiStart = Date.now()
  try {
    const body = await req.json()
    const { jobTitle, company, description, recommendedLane, jobId } = body
    if (!description) {
      return NextResponse.json({ error: 'description required' }, { status: 400 })
    }

    const recLane = normalizeLane(recommendedLane)

    // Load all 4 lanes + MASTER in parallel.
    const [laneA, laneB, laneC, laneD, master] = await Promise.all([
      readLaneResume('A'),
      readLaneResume('B'),
      readLaneResume('C'),
      readLaneResume('D'),
      fs.readFile(path.join(RESUMES_DIR, 'MASTER_RESUME.md'), 'utf-8').catch(() => ''),
    ])

    if (!master) {
      return NextResponse.json(
        { error: 'MASTER_RESUME.md missing — cannot generate a grounded custom resume' },
        { status: 500 },
      )
    }

    const laneContent: Record<Lane, string> = { A: laneA, B: laneB, C: laneC, D: laneD }

    const client = new Anthropic()
    const msg = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `You are generating a custom resume for a specific job, cherry-picking bullets from 4 existing lane-specific resumes. You MUST NOT fabricate content.

GROUND TRUTH — MASTER_RESUME.md (authoritative fact base, do not contradict):
${master}

LANE A — ${LANE_LABELS.A}:
${laneA}

LANE B — ${LANE_LABELS.B}:
${laneB}

LANE C — ${LANE_LABELS.C}:
${laneC}

LANE D — ${LANE_LABELS.D}:
${laneD}

JOB:
Title: ${jobTitle ?? 'Unknown'}
Company: ${company ?? 'Unknown'}
Recommended primary lane: ${recLane} — ${LANE_LABELS[recLane]}
Description:
${description}

RULES:
1. Every bullet MUST come from one of the 4 lane files. If a bullet isn't in any lane file, do not include it.
2. You MAY rephrase lightly for the job's language, but the underlying claim must be traceable to MASTER_RESUME.md.
3. Emphasize bullets that match the job's keywords.
4. Prefer bullets from lane ${recLane} for the top of each section; blend in 2-4 bullets from other lanes where they strengthen the fit.
5. Keep every bullet concise (1-2 lines, quantified where the source has numbers).
6. Total target: 12-18 bullets across Experience, plus a Professional Summary and Core Competencies block.
7. Preserve company names, titles, and years exactly as they appear in MASTER_RESUME.md.

Return ONLY valid JSON (no markdown wrapping) in this exact shape:
{
  "markdown": "# Michael Cutillo\\n\\n...full markdown resume...",
  "bullets": [
    { "text": "exact bullet text as used in markdown", "sourceLane": "A", "section": "iCIMS · Senior Implementation Consultant" }
  ],
  "fitScore": 82,
  "provenanceNotes": "optional notes about how lanes were merged"
}`,
        },
      ],
    })

    const aiDuration = Date.now() - aiStart
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)

    logAiUsage({
      route: 'job-pipeline/custom-resume',
      modelId: 'anthropic-claude-opus-4-6', provider: 'anthropic', modelName: 'claude-opus-4-6',
      status: jsonMatch ? 'success' : 'failed', durationMs: aiDuration,
      inputHint: `${company || 'unknown'} - ${jobTitle || 'unknown'}`.slice(0, 80),
      fallbacksUsed: 0, attempts: [{ modelId: 'anthropic-claude-opus-4-6', status: jsonMatch ? 'success' : 'failed' }],
      costEstimate: estimateCost('claude-opus-4-6', 'anthropic', description.length + master.length),
    }).catch(() => {})

    if (!jsonMatch) {
      return NextResponse.json({ error: 'Invalid AI response (no JSON block)' }, { status: 500 })
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      markdown: string
      bullets: Bullet[]
      fitScore: number
      provenanceNotes?: string
    }

    // ── Hallucination guard ─────────────────────────────────────────────
    const provenanceNotes: string[] = []
    if (parsed.provenanceNotes) provenanceNotes.push(parsed.provenanceNotes)

    const keptBullets: Bullet[] = []
    let droppedCount = 0

    for (const bullet of parsed.bullets ?? []) {
      const sourceLane = bullet.sourceLane
      const laneText = sourceLane in laneContent ? laneContent[sourceLane as Lane] : ''
      const groundedInLane = laneText && isGroundedIn(bullet.text, laneText)
      const groundedInMaster = isGroundedIn(bullet.text, master, 3)

      if (groundedInLane || groundedInMaster) {
        keptBullets.push(bullet)
      } else {
        droppedCount++
        provenanceNotes.push(
          `Dropped (ungrounded): "${bullet.text.slice(0, 100)}${bullet.text.length > 100 ? '…' : ''}"`,
        )
      }
    }

    // If the guard drops bullets, strip them from the markdown as well so
    // we don't auto-submit text we couldn't verify. Line-level removal is
    // imperfect but it's the safe default given Phase 2 auto-submits.
    let cleanedMarkdown = parsed.markdown ?? ''
    for (const note of provenanceNotes) {
      const match = note.match(/^Dropped \(ungrounded\): "([^"]+)/)
      if (match) {
        const snippet = match[1]
        cleanedMarkdown = cleanedMarkdown
          .split('\n')
          .filter((line) => !line.includes(snippet.slice(0, 40)))
          .join('\n')
      }
    }

    // ── Persist to disk for Phase 2 resume-exporter ─────────────────────
    if (jobId) {
      await fs.mkdir(GENERATED_DIR, { recursive: true })
      const mdPath = path.join(GENERATED_DIR, `${jobId}.md`)
      const metaPath = path.join(GENERATED_DIR, `${jobId}.meta.json`)
      await fs.writeFile(mdPath, cleanedMarkdown, 'utf-8')
      await fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            jobId,
            jobTitle,
            company,
            recommendedLane: recLane,
            fitScore: parsed.fitScore,
            bullets: keptBullets,
            droppedCount,
            provenanceNotes,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf-8',
      )
    }

    const response: CustomResumeResponse = {
      markdown: cleanedMarkdown,
      bullets: keptBullets,
      fitScore: typeof parsed.fitScore === 'number' ? parsed.fitScore : 0,
      provenanceNotes,
      recommendedLane: recLane,
      droppedCount,
    }
    return NextResponse.json(response)
  } catch (err: unknown) {
    logAiUsage({
      route: 'job-pipeline/custom-resume',
      modelId: 'anthropic-claude-opus-4-6', provider: 'anthropic', modelName: 'claude-opus-4-6',
      status: 'failed', durationMs: Date.now() - aiStart,
      fallbacksUsed: 0, attempts: [{ modelId: 'anthropic-claude-opus-4-6', status: 'failed', reason: err instanceof Error ? err.message : 'unknown' }],
    }).catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
