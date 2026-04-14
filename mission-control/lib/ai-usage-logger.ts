/**
 * ai-usage-logger.ts — Append-only AI usage ledger.
 *
 * Every LLM call across Mission Control logs here. The log caps at
 * MAX_ENTRIES (~6 months at current usage) and writes to a single
 * JSON file via readJSON/writeJSON.
 *
 * All logging is fire-and-forget — callers should .catch(() => {})
 * so a write failure never blocks the API response.
 */

import { readJSON, writeJSON } from './data'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AiUsageEntry {
  id: string
  timestamp: string
  route: string
  modelId: string
  provider: string
  modelName: string
  status: 'success' | 'failed'
  durationMs: number
  inputHint?: string
  fallbacksUsed: number
  attempts: { modelId: string; status: string; reason?: string }[]
  costEstimate?: number
}

export type AiUsageInput = Omit<AiUsageEntry, 'id' | 'timestamp'>

// ── Cost estimation ──────────────────────────────────────────────────────────

// Per-1K-token pricing (approximate — good enough for visibility, not billing)
const TOKEN_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-5.4':                   { input: 0.0025,  output: 0.01 },
  'claude-sonnet-4-6':         { input: 0.003,   output: 0.015 },
  'claude-opus-4-6':           { input: 0.015,   output: 0.075 },
  'claude-haiku-4-5-20251001': { input: 0.0008,  output: 0.004 },
  'claude-haiku-4-5':          { input: 0.0008,  output: 0.004 },
  'gemini-3-pro-image-preview':{ input: 0.00125, output: 0.005 },
}

// Fixed per-call costs (image generation, etc.)
const FIXED_COSTS: Record<string, number> = {
  'gpt-image-1': 0.08, // $0.08 per 1024x1024 high-quality image
}

/**
 * Rough cost estimate based on prompt length.
 * Returns 0 for local/ollama models.
 */
export function estimateCost(
  modelName: string,
  provider: string,
  promptLength: number,
): number {
  if (provider === 'ollama') return 0

  const fixed = FIXED_COSTS[modelName]
  if (fixed !== undefined) return fixed

  const rates = TOKEN_COSTS[modelName]
  if (!rates) return 0

  // ~4 chars per token, assume output is ~25% of input length
  const inputTokens = promptLength / 4
  const outputTokens = inputTokens * 0.25
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output
}

// ── Logger ───────────────────────────────────────────────────────────────────

const FILE = 'ai-usage-log.json'
const MAX_ENTRIES = 2000

export async function logAiUsage(entry: AiUsageInput): Promise<void> {
  const log = await readJSON<AiUsageEntry[]>(FILE, [])
  log.unshift({
    ...entry,
    id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  })
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES
  await writeJSON(FILE, log)
}
