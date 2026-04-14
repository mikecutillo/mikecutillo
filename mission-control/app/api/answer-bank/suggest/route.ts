/**
 * answer-bank suggest — Claude-powered draft answer generator (Phase 4j).
 *
 * Used by:
 *   - Mission Control AddEntryPanel "Suggest with AI ✨" button
 *   - Chrome extension popup inline-resolve "Suggest with AI ✨" button
 *
 * Input:
 *   POST {
 *     question: string,
 *     jobContext?: { company, title, description }
 *     fieldType?: 'text' | 'textarea' | 'select'
 *   }
 *
 * Output:
 *   { answer: string, confidence: number, reasoning: string, cached: boolean }
 *
 * Profile context: the route loads bank entries with category in
 * ['contact', 'auth', 'comp', 'preference'] and includes them as the
 * "who is Mike" facts so Claude doesn't have to guess his real
 * name / location / salary range.
 *
 * Caching: in-process LRU keyed by (question_hash, company) with a
 * 7-day TTL. Tokens cost money — refreshing the popup or rerunning the
 * same job should not double-bill.
 *
 * IMPORTANT: this endpoint NEVER auto-saves to the bank. The save click
 * always belongs to the user. The popup/AddEntryPanel calls POST
 * /api/answer-bank separately if Mike approves the draft.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
import { listEntries } from '@/lib/apply-worker/answer-bank-client'
import { logAiUsage, estimateCost } from '@/lib/ai-usage-logger'

interface SuggestRequest {
  question?: string
  jobContext?: {
    company?: string
    title?: string
    description?: string
  }
  fieldType?: string
}

interface SuggestResponse {
  answer: string
  confidence: number
  reasoning: string
  cached: boolean
}

// ---- LRU cache ---------------------------------------------------------

const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_ENTRIES = 200

interface CacheRow {
  value: SuggestResponse
  expiresAt: number
}

const cache = new Map<string, CacheRow>()

function cacheKey(question: string, company: string | undefined): string {
  const h = crypto.createHash('sha1')
  h.update(question.trim().toLowerCase())
  h.update('|')
  h.update((company || '').trim().toLowerCase())
  return h.digest('hex')
}

function cacheGet(key: string): SuggestResponse | null {
  const row = cache.get(key)
  if (!row) return null
  if (row.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  return row.value
}

function cachePut(key: string, value: SuggestResponse): void {
  if (cache.size >= MAX_ENTRIES) {
    // Drop the oldest entry — Map iteration is insertion order
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
}

// ---- profile assembly --------------------------------------------------

interface ProfileFact {
  question: string
  answer: string
  category: string
}

async function loadProfile(): Promise<ProfileFact[]> {
  const entries = await listEntries()
  const PROFILE_CATEGORIES = new Set(['contact', 'auth', 'comp', 'preference'])
  const facts: ProfileFact[] = []
  for (const e of entries) {
    if (!PROFILE_CATEGORIES.has(e.category)) continue
    // Skip empty values — they'd just confuse Claude
    const value = (e.text?.value ?? e.answer ?? '').trim()
    if (!value) continue
    facts.push({ question: e.question, answer: value, category: e.category })
  }
  return facts
}

// ---- handler -----------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: SuggestRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const question = (body.question || '').trim()
  if (!question) {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }

  const ctx = body.jobContext || {}
  const key = cacheKey(question, ctx.company)
  const hit = cacheGet(key)
  if (hit) {
    return NextResponse.json({ ...hit, cached: true })
  }

  const profile = await loadProfile()
  const profileSection = profile.length
    ? profile
        .map((p) => `- ${p.question}: ${p.answer}`)
        .join('\n')
    : '(no profile facts yet — answer cautiously and tell Mike to set up the Profile Seed Pack)'

  const jobSection = [
    ctx.company ? `Company: ${ctx.company}` : null,
    ctx.title ? `Role: ${ctx.title}` : null,
    ctx.description
      ? `Description:\n${ctx.description.slice(0, 2000)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `You are filling out a job application for Mike Cutillo. Here are facts from Mike's profile:

PROFILE:
${profileSection}

${jobSection ? `JOB:\n${jobSection}\n` : ''}
The form asks: "${question}"

Provide a single answer Mike can use, in his voice. Be concise — 1-3 sentences for free-text questions, a single value for short fields. If the question is qualitative ("why this company?"), use the job description for specifics — name a real product/value/initiative when possible. If you don't have enough info from Mike's profile to answer factually, return an empty answer string with confidence 0 and explain in reasoning.

Return ONLY valid JSON (no markdown, no explanation) in exactly this shape:
{
  "answer": "the answer text",
  "confidence": 0.85,
  "reasoning": "1 sentence: which profile facts or job details you used"
}`

  const aiStart = Date.now()
  try {
    const client = new Anthropic()
    const msg = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const durationMs = Date.now() - aiStart
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)

    logAiUsage({
      route: 'answer-bank/suggest',
      modelId: 'anthropic-claude-opus-4-6', provider: 'anthropic', modelName: 'claude-opus-4-6',
      status: jsonMatch ? 'success' : 'failed', durationMs,
      inputHint: question.slice(0, 80),
      fallbacksUsed: 0, attempts: [{ modelId: 'anthropic-claude-opus-4-6', status: jsonMatch ? 'success' : 'failed' }],
      costEstimate: estimateCost('claude-opus-4-6', 'anthropic', prompt.length),
    }).catch(() => {})

    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'AI response was not valid JSON', raw },
        { status: 502 },
      )
    }

    const parsed = JSON.parse(jsonMatch[0]) as Omit<SuggestResponse, 'cached'>
    const response: SuggestResponse = {
      answer: String(parsed.answer ?? ''),
      confidence: Number(parsed.confidence ?? 0),
      reasoning: String(parsed.reasoning ?? ''),
      cached: false,
    }

    if (response.answer) cachePut(key, response)
    return NextResponse.json(response)
  } catch (err) {
    logAiUsage({
      route: 'answer-bank/suggest',
      modelId: 'anthropic-claude-opus-4-6', provider: 'anthropic', modelName: 'claude-opus-4-6',
      status: 'failed', durationMs: Date.now() - aiStart,
      fallbacksUsed: 0, attempts: [{ modelId: 'anthropic-claude-opus-4-6', status: 'failed', reason: err instanceof Error ? err.message : 'unknown' }],
    }).catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
