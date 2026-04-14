import { readJSON, writeJSON } from '@/lib/data'
import type { ModelRegistryEntry, VaultApiEntry } from '@/lib/types'
import { logAiUsage, estimateCost } from '@/lib/ai-usage-logger'

const REGISTRY_FILE = 'model-registry.json'
const FALLBACK_MESSAGE = 'All AI providers are currently busy. Please try again in a minute.'

const DEFAULT_REGISTRY: ModelRegistryEntry[] = [
  {
    id: 'openai-gpt-5-4',
    provider: 'openai',
    modelName: 'gpt-5.4',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    isActive: true,
    isPrimary: true,
    fallbackPriority: 1,
    currentLane: 'current',
    status: 'connected',
    displayName: 'OpenAI GPT-5.4',
    vendorLabel: 'OpenAI',
    badge: 'Primary runtime',
    tagline: 'Current default model actually driving turbodot.',
    websiteUrl: 'https://openai.com/',
    signupUrl: 'https://platform.openai.com/',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    pricingNote: 'Configured as the default OpenClaw primary model.',
    bestFor: ['chat', 'coding', 'general work'],
    notes: 'This matches the live OpenClaw default model configuration: openai/gpt-5.4.',
    detectedVia: ['config:agents.defaults.model.primary', 'env:OPENAI_API_KEY'],
    configured: true,
    hasKey: true,
  },
  {
    id: 'anthropic-claude-sonnet-4-6',
    provider: 'anthropic',
    modelName: 'claude-sonnet-4-6',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    isActive: true,
    isPrimary: false,
    fallbackPriority: 2,
    currentLane: 'premium',
    status: 'connected',
    displayName: 'Claude Sonnet 4.6',
    vendorLabel: 'Anthropic',
    badge: 'Configured alternate',
    tagline: 'Available as a configured alternate model, not the current default.',
    websiteUrl: 'https://www.anthropic.com/',
    signupUrl: 'https://console.anthropic.com/',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    pricingNote: 'Configured in OpenClaw model aliases.',
    bestFor: ['analysis', 'writing', 'alternate lane'],
    notes: 'Mapped from the configured alias `sonnet` in OpenClaw. This is available, but not the active primary runtime model.',
    detectedVia: ['config:agents.defaults.models'],
    configured: true,
    hasKey: true,
  },
  {
    id: 'google-gemini-3-pro-image-preview',
    provider: 'google',
    modelName: 'gemini-3-pro-image-preview',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    isActive: true,
    isPrimary: false,
    fallbackPriority: 3,
    currentLane: 'fallback',
    status: 'connected',
    displayName: 'Gemini 3 Pro Image Preview',
    vendorLabel: 'Google',
    badge: 'Image generation',
    tagline: 'Configured image-generation provider in OpenClaw.',
    websiteUrl: 'https://ai.google.dev/',
    signupUrl: 'https://aistudio.google.com/',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    pricingNote: 'Used for image generation, not your default chat runtime.',
    bestFor: ['image generation', 'multimodal', 'creative assets'],
    notes: 'This reflects the configured OpenClaw imageGenerationModel.primary value.',
    detectedVia: ['config:agents.defaults.imageGenerationModel.primary', 'config:models.providers.google'],
    configured: true,
    hasKey: true,
  },
  {
    id: 'ollama-gemma4-e4b',
    provider: 'ollama',
    modelName: 'gemma4:e4b',
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    isActive: true,
    isPrimary: false,
    fallbackPriority: 4,
    currentLane: 'fallback',
    status: 'connected',
    displayName: 'Gemma 4 (4B — Local)',
    vendorLabel: 'Ollama',
    badge: 'Local backbone',
    tagline: 'Always-on local AI backbone — no API key, no quota, no outage.',
    websiteUrl: 'http://localhost:11434',
    signupUrl: '',
    apiKeyUrl: '',
    pricingNote: 'Free — runs locally via Ollama.',
    bestFor: ['offline fallback', 'zero-cost inference', 'always-available assistant'],
    notes: 'Gemma 4 running locally via Ollama. No API key required. Used as the final fallback when all cloud providers are unavailable.',
    detectedVia: ['ollama:gemma4:e4b'],
    configured: true,
    hasKey: true,
  },
  {
    id: 'ollama-gemma4-e2b',
    provider: 'ollama',
    modelName: 'gemma4:e2b',
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    isActive: true,
    isPrimary: false,
    fallbackPriority: 5,
    currentLane: 'fallback',
    status: 'connected',
    displayName: 'Gemma 4 (2B — Local)',
    vendorLabel: 'Ollama',
    badge: 'Local backstop',
    tagline: 'Lightest local fallback — fast, always-on, zero cost.',
    websiteUrl: 'http://localhost:11434',
    signupUrl: '',
    apiKeyUrl: '',
    pricingNote: 'Free — runs locally via Ollama.',
    bestFor: ['ultra-fast local inference', 'last-resort fallback'],
    notes: 'Gemma 4 2B running locally via Ollama. Smallest and fastest local option — the final backstop in the waterfall.',
    detectedVia: ['ollama:gemma4:e2b'],
    configured: true,
    hasKey: true,
  },
]

function maskKey(raw: string) {
  if (!raw) return 'Masked / not entered yet'
  if (raw.length <= 8) return '•'.repeat(raw.length)
  return `${raw.slice(0, 4)}••••${raw.slice(-4)}`
}

export async function readModelRegistry(): Promise<ModelRegistryEntry[]> {
  const registry = await readJSON<ModelRegistryEntry[]>(REGISTRY_FILE, DEFAULT_REGISTRY)
  return normalizeRegistry(registry)
}

export async function writeModelRegistry(registry: ModelRegistryEntry[]): Promise<void> {
  await writeJSON(REGISTRY_FILE, normalizeRegistry(registry))
}

export function normalizeRegistry(registry: ModelRegistryEntry[]): ModelRegistryEntry[] {
  const rows = [...registry]
  rows.sort((a, b) => a.fallbackPriority - b.fallbackPriority)

  const activePrimary = rows.find(r => r.isPrimary && r.isActive)
  return rows.map((row, index) => ({
    ...row,
    fallbackPriority: index + 1,
    isPrimary: activePrimary ? row.id === activePrimary.id : index === 0,
  }))
}

export async function syncRegistryWithVault(vaultApis: VaultApiEntry[]): Promise<ModelRegistryEntry[]> {
  const registry = await readModelRegistry()
  const merged: ModelRegistryEntry[] = registry.map(model => {
    const match = vaultApis.find(api => api.envVar === model.apiKeyEnvVar || api.service.toLowerCase() === model.provider)
    const hasVaultKey = !!match && match.status === 'connected'
    const status: ModelRegistryEntry['status'] = hasVaultKey
      ? 'connected'
      : model.status === 'detected'
        ? 'detected'
        : model.status

    return {
      ...model,
      hasKey: hasVaultKey || !!model.hasKey,
      configured: hasVaultKey || !!model.configured,
      apiKeyMasked: match?.keyMasked ?? model.apiKeyMasked,
      status,
    }
  })
  await writeModelRegistry(merged)
  return merged
}

export type GenerateAttempt = {
  modelId: string
  provider: string
  modelName: string
  status: 'success' | 'failed'
  reason?: string
}

export type GenerateResult = {
  ok: boolean
  content: string
  modelId?: string
  provider?: string
  attempts: GenerateAttempt[]
  error?: string
}

export type ModelExecutor = (entry: ModelRegistryEntry, payload: { prompt: string; systemContext?: string }) => Promise<string>

function shouldFallback(_status?: number) {
  return true // always try next provider — a bad model name, quota, or transient error on one should not block the rest
}

export async function generateWithFallback(
  prompt: string,
  systemContext: string,
  executor?: ModelExecutor,
  route?: string,
): Promise<GenerateResult> {
  const startTime = Date.now()
  const registry = (await readModelRegistry())
    .filter(model => model.isActive)
    .sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1
      if (b.isPrimary && !a.isPrimary) return 1
      return a.fallbackPriority - b.fallbackPriority
    })

  const attempts: GenerateAttempt[] = []
  if (!registry.length) {
    const result: GenerateResult = { ok: false, content: FALLBACK_MESSAGE, attempts, error: 'no-active-models' }
    logAiUsage({
      route: route || 'model-router',
      modelId: 'none', provider: 'none', modelName: 'none',
      status: 'failed', durationMs: Date.now() - startTime,
      fallbacksUsed: 0, attempts,
    }).catch(() => {})
    return result
  }

  for (const model of registry) {
    try {
      const content = executor
        ? await executor(model, { prompt, systemContext })
        : `[stub:${model.modelName}] ${prompt}`
      attempts.push({ modelId: model.id, provider: model.provider, modelName: model.modelName, status: 'success' })
      const result: GenerateResult = { ok: true, content, modelId: model.id, provider: model.provider, attempts }
      logAiUsage({
        route: route || 'model-router',
        modelId: model.id, provider: model.provider, modelName: model.modelName,
        status: 'success', durationMs: Date.now() - startTime,
        inputHint: prompt.slice(0, 80),
        fallbacksUsed: attempts.filter(a => a.status === 'failed').length,
        attempts,
        costEstimate: estimateCost(model.modelName, model.provider, prompt.length + (systemContext?.length || 0)),
      }).catch(() => {})
      return result
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : undefined
      const reason = status ? `http-${status}` : error instanceof Error ? error.message : 'unknown-error'
      attempts.push({ modelId: model.id, provider: model.provider, modelName: model.modelName, status: 'failed', reason })
      console.warn(`[model-router] ${model.modelName} failed`, reason)
      if (!shouldFallback(status)) {
        const result: GenerateResult = { ok: false, content: FALLBACK_MESSAGE, attempts, error: reason }
        logAiUsage({
          route: route || 'model-router',
          modelId: model.id, provider: model.provider, modelName: model.modelName,
          status: 'failed', durationMs: Date.now() - startTime,
          fallbacksUsed: attempts.filter(a => a.status === 'failed').length,
          attempts,
        }).catch(() => {})
        return result
      }
    }
  }

  const result: GenerateResult = { ok: false, content: FALLBACK_MESSAGE, attempts, error: 'all-fallbacks-exhausted' }
  logAiUsage({
    route: route || 'model-router',
    modelId: 'none', provider: 'none', modelName: 'none',
    status: 'failed', durationMs: Date.now() - startTime,
    fallbacksUsed: attempts.length,
    attempts,
  }).catch(() => {})
  return result
}

export async function upsertVaultApiForModel(input: {
  service: string
  provider: string
  envVar: string
  apiKey: string
  loginUrl?: string
  notes?: string
}) {
  const apis = await readJSON<VaultApiEntry[]>('vault-apis.json', [])
  const existing = apis.find(api => api.envVar === input.envVar)
  const entry: VaultApiEntry = {
    id: existing?.id ?? `${input.provider}-${input.service}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
    service: input.service,
    provider: input.provider,
    envVar: input.envVar,
    keyMasked: maskKey(input.apiKey),
    source: 'mission-control',
    usedBy: ['model-router'],
    status: 'connected',
    notes: input.notes,
    createdBy: 'turbodot',
    loginUrl: input.loginUrl,
  }
  const next = existing ? apis.map(api => (api.id === existing.id ? entry : api)) : [...apis, entry]
  await writeJSON('vault-apis.json', next)
  return entry
}
