import { NextRequest, NextResponse } from 'next/server'
import { generateWithFallback } from '@/lib/model-router'
import { missionControlExecutor } from '@/lib/ai-executor'
import { DEFAULT_PERSONA } from '../personas/shared'
import { buildPersonaPromptContext, readPersonas, resolveActivePersona } from '../personas/shared'
import type { Persona } from '../personas/types'

interface SlotDefinition {
  source: 'user' | 'ai' | 'locked'
  label?: string
  hint?: string
  instruction?: string
  value?: string
  separate?: boolean
}

interface TemplateWithSlots {
  name: string
  description: string
  hasImage?: boolean | null
  imageTip?: string | null
  scaffold?: string | null
  slots?: Record<string, SlotDefinition> | null
}

interface VariationRequest {
  original?: string
  prompt?: string
  freedomLevel?: number
  desiredLength?: 'punchy' | 'balanced' | 'detailed' | null
  personaId?: string | null
  selectedVoiceId?: string | null
  selectedTopic?: string | null
  selectedSource?: string | null
  mode?: 'rewrite' | 'create'
  template?: TemplateWithSlots | null
  slotValues?: Record<string, string> | null
  videoSummary?: string | null
}

interface VariationResponse {
  variation: string
  personaId?: string
}

type DesiredLength = 'punchy' | 'balanced' | 'detailed'

function normalizeDesiredLength(value?: string | null): DesiredLength {
  if (value === 'balanced' || value === 'detailed') return value
  return 'punchy'
}

function getLengthInstruction(length: DesiredLength): string {
  if (length === 'detailed') {
    return 'Length target: detailed. You may expand the idea, but keep it readable and tighter than a typical long post. Aim for roughly 750 to 1150 characters, with short paragraphs, no filler, and only the strongest supporting points.'
  }
  if (length === 'balanced') {
    return 'Length target: balanced. Keep it crisp and useful. Aim for roughly 420 to 700 characters, with tight paragraphs and only the strongest supporting points.'
  }
  return 'Length target: punchy. Keep it short, sharp, and skimmable. Aim for roughly 220 to 420 characters, and prefer the low end when possible. Use a strong hook, 1 to 2 concise supporting beats, and a clean ending. Keep it to about 4 to 6 short lines total. Do not ramble, do not stack long bullet lists, and do not over-explain.'
}

function getFreedomInstruction(level: number): string {
  if (level === 0) return 'Keep the writing conservative. Stay close to the stated facts and avoid flashy phrasing. Optimize clarity, credibility, and professionalism.'
  if (level === 2) return 'Take bold creative freedom. You may sharply improve the hook, restructure the piece, and make it more memorable and shareable while preserving truth and trust.'
  return 'Use a balanced style. Improve hook, readability, flow, and CTA without drifting away from the core message.'
}

function getEmojiInstruction(emojiUsage: number): string {
  if (emojiUsage <= 0) return 'Do not use emojis.'
  if (emojiUsage === 1) return 'Use emojis sparingly, only if they genuinely improve readability.'
  return 'Emojis are allowed and can be used more visibly, but do not overdo it.'
}

function getVariablePreservationInstruction(options: { hasTemplate: boolean, hasSlotValues: boolean }): string {
  const lines = [
    'The requested length changes compression only. It does not override the selected persona, topic, voice inspiration, source angle, compliance rules, or CTA style.',
    'When shortening, compress phrasing and remove filler before you change the core angle or message.',
  ]

  if (options.hasTemplate) {
    lines.push('If a template or scaffold is provided, keep its structure intact even when the post is short.')
  }

  if (options.hasSlotValues) {
    lines.push('Any user-provided slot values are authoritative. Preserve them and compress around them instead of dropping them.')
  }

  return lines.join(' ')
}

function buildSlotStructure(template: TemplateWithSlots, selectedTopic?: string | null): string {
  const slots = template.slots
  if (!slots || !template.scaffold) return ''

  const entries = Object.entries(slots)
  const userSlots = entries.filter(([, s]) => s.source === 'user')
  const aiSlots = entries.filter(([, s]) => s.source === 'ai' && !s.separate)
  const separateSlots = entries.filter(([, s]) => s.source === 'ai' && s.separate)
  const lockedSlots = entries.filter(([, s]) => s.source === 'locked')

  let scaffold = template.scaffold
  for (const [name, slot] of lockedSlots) {
    scaffold = scaffold.replaceAll(`{{${name}}}`, slot.value ?? '')
  }

  const lines: string[] = [
    '\nPOST STRUCTURE:',
    `Format: ${template.name}`,
    'Scaffold — fill the slots in the exact order shown:',
    scaffold,
    '',
  ]

  if (userSlots.length > 0) {
    const topicLine = selectedTopic ? ` The topic is: ${selectedTopic}.` : ''
    lines.push(`Slots to fill — generate professional financial planning content for each. Values must sound like a credible wealth management advisor wrote them. No slang, no casual language, no off-brand terms.${topicLine}`)
    for (const [name, slot] of userSlots) {
      lines.push(`  {{${name}}}: ${slot.hint ?? 'generate appropriate financial planning content'}`)
    }
    lines.push('')
  }

  if (aiSlots.length > 0) {
    lines.push('AI-generated slots (you write these):')
    for (const [name, slot] of aiSlots) {
      lines.push(`  {{${name}}}: ${slot.instruction ?? ''}`)
    }
    lines.push('')
  }

  if (separateSlots.length > 0) {
    lines.push('After the post, output each of the following as a labeled section:')
    for (const [name, slot] of separateSlots) {
      lines.push(`  [${name.toUpperCase()}]: ${slot.instruction ?? ''}`)
    }
    lines.push('')
  }

  lines.push('Output the filled post in scaffold order. Do not output slot names or brackets.')
  return lines.join('\n')
}

function buildSystemPrompt(persona: Persona, context: ReturnType<typeof buildPersonaPromptContext>, mode: 'rewrite' | 'create', desiredLength: DesiredLength, template?: TemplateWithSlots | null, videoSummary?: string | null, selectedSource?: string | null, hasSlotValues = false): string {
  const li = context.channels?.linkedin
  const hasTemplate = Boolean(template)

  return [
    `You are a LinkedIn ghostwriter writing in the voice of ${context.personaName}.`,
    `Industry / niche: ${context.niche || 'General professional content'}.`,
    `Target audience: ${context.targetAudience || 'Professionals in the relevant market'}.`,
    `Tone of voice: ${context.toneOfVoice || 'Clear, credible, human, and useful'}.`,
    `Language: ${context.language || 'English (US)'}.`,
    context.topics.length ? `Relevant topics: ${context.topics.join(', ')}.` : '',
    context.selectedTopic ? `Bias the writing toward this selected topic: ${context.selectedTopic}.` : '',
    context.selectedVoice ? `Voice inspiration: ${context.selectedVoice.name}. Why this voice matters: ${context.selectedVoice.why}. Capture the stylistic influence without imitating or mentioning them.` : '',

    // Channel strategy — LinkedIn
    li?.objective ? `\nChannel objective: ${li.objective}` : '',
    li?.audienceNotes ? `Audience context: ${li.audienceNotes}` : '',
    li?.contentPillars ? `Content pillars to draw from:\n${li.contentPillars}` : '',
    li?.writingDos ? `Writing guidelines (DO): ${li.writingDos}` : '',
    li?.writingDonts ? `Writing guidelines (DO NOT): ${li.writingDonts}` : '',
    li?.hookPatterns ? `Hook approach: ${li.hookPatterns}` : '',
    li?.ctaRules ? `CTA rules: ${li.ctaRules}` : '',
    li?.formattingRules ? `Formatting rules: ${li.formattingRules}` : '',
    li?.complianceRules ? `Compliance rules: ${li.complianceRules}` : '',

    // Approved / disallowed phrases
    context.approvedPhrases.length ? `Preferred phrases to use when appropriate: ${context.approvedPhrases.join(', ')}.` : '',
    context.disallowedPhrases.length ? `Phrases that must never appear: ${context.disallowedPhrases.join(', ')}.` : '',
    context.forbiddenWords.length ? `Never use these words or phrases: ${context.forbiddenWords.join(', ')}.` : '',

    // Compliance / workflow notes
    context.complianceNotes ? `Additional compliance guidance: ${context.complianceNotes}` : '',

    // Formatting controls
    getEmojiInstruction(context.emojiUsage),
    `Use approximately ${Math.max(0, context.hashtagCount)} hashtags if hashtags fit naturally; otherwise skip them.`,
    context.defaultCta ? `Preferred CTA style: ${context.defaultCta}.` : 'Use a CTA only if it fits naturally.',
    getLengthInstruction(desiredLength),
    getVariablePreservationInstruction({ hasTemplate, hasSlotValues }),

    // Signature — append as-is if present
    li?.signatureTemplate ? `If this post calls for a signature block, append exactly this signature:\n${li.signatureTemplate}` : '',

    template
      ? (template.slots ? buildSlotStructure(template, context.selectedTopic) : `\nPOST STRUCTURE:\nFormat: ${template.name}\nInstruction: ${template.description}\nFollow this structure precisely — it defines how the post should be shaped and what it should accomplish.`)
      : '',
    template?.hasImage && !template.slots
      ? `\nIMAGE CONTEXT:\nThis post will be published with an image. The image carries part of the message — write copy that complements it, not one that re-describes it.${template.imageTip ? ` Image style: ${template.imageTip}` : ''}`
      : template && template.hasImage === false && !template.slots
        ? '\nIMAGE CONTEXT:\nThis is a text-only post with no image. The copy must stand entirely on its own.'
        : '',
    selectedSource === 'youtube'
      ? '\nSOURCE TONE:\nThis post is inspired by YouTube content. Write as a commentary or reaction — conversational, with a trace of spoken energy.'
      : selectedSource === 'news'
        ? '\nSOURCE TONE:\nThis post reacts to a news article. Angle it as a reaction piece — grounded, credible, useful for an audience that needs context.'
        : selectedSource === 'x'
          ? '\nSOURCE TONE:\nThis post is inspired by X / Twitter. Keep it direct and punchy — a hot take or sharp observation designed to invite a response.'
          : '',
    videoSummary ? `\nVIDEO SOURCE MATERIAL:\n${videoSummary}\n\nBase the post on this content. Translate the insights into the persona's own voice and perspective.` : '',

    getFreedomInstruction(context.freedomLevel),
    'The final output must feel native to this persona\'s industry and audience, not generic.',
    mode === 'create'
      ? 'Write a complete original LinkedIn post from the provided brief. Use a strong hook, helpful body, and a natural ending.'
      : 'Rewrite the provided LinkedIn post while preserving the core idea and truth of the original.',
    'Return only the final LinkedIn post text, with no explanation or commentary.'
  ].filter(Boolean).join('\n')
}

function buildMockCreateResponse(prompt: string, context: ReturnType<typeof buildPersonaPromptContext>): string {
  const topic = context.selectedTopic || context.topics[0] || context.niche || 'the work that matters most to your audience'
  const voiceLine = context.selectedVoice ? `I kept thinking about how ${context.selectedVoice.name} tends to make ideas feel immediate and practical.` : 'I wanted this to feel practical, grounded, and useful.'
  const cta = context.defaultCta || 'What are you seeing on your side?'
  return [
    `Most people talk about ${topic.toLowerCase()} like it's a tactic.` ,
    '',
    `But for ${context.targetAudience || 'serious professionals'}, it's really a decision-making system.`,
    '',
    voiceLine,
    '',
    `If you want stronger results, start here:`,
    `1. Get clear on the real problem behind the topic.`,
    `2. Strip out the busywork that makes the message feel generic.`,
    `3. Say something your audience can actually use today.`,
    '',
    `That's usually where traction starts.`,
    '',
    prompt.trim() ? `Brief I used: ${prompt.trim()}` : '',
    '',
    cta,
  ].filter(Boolean).join('\n')
}

export async function POST(req: NextRequest): Promise<NextResponse<VariationResponse | { error: string }>> {
  try {
    const body = (await req.json()) as VariationRequest
    const mode = body.mode === 'create' ? 'create' : 'rewrite'
    const { original, prompt, freedomLevel, desiredLength, personaId, selectedVoiceId, selectedTopic, selectedSource, template, slotValues, videoSummary } = body
    const sourceText = mode === 'create' ? (prompt ?? original ?? '') : (original ?? '')
    const normalizedDesiredLength = normalizeDesiredLength(desiredLength)

    if (!sourceText || typeof sourceText !== 'string') {
      return NextResponse.json({ error: mode === 'create' ? 'Missing creation prompt' : 'Missing original post text' }, { status: 400 })
    }

    const personas = await readPersonas([DEFAULT_PERSONA])
    const persona = (personaId ? personas.find(p => p.id === personaId) : null) ?? (await resolveActivePersona(personas)) ?? DEFAULT_PERSONA
    const context = buildPersonaPromptContext(persona, { selectedVoiceId, selectedTopic, freedomLevel })
    const hasSlotValues = Boolean(slotValues && Object.keys(slotValues).length > 0)
    const systemPrompt = buildSystemPrompt(persona, context, mode, normalizedDesiredLength, template, videoSummary, selectedSource, hasSlotValues)

    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.MOONSHOT_API_KEY) {
      if (mode === 'create') {
        return NextResponse.json({ variation: buildMockCreateResponse(sourceText, context), personaId: persona.id })
      }
      const mockHeader = `[${context.personaName} · ${context.niche || 'General'} · ${['Conservative', 'Balanced', 'Wild'][context.freedomLevel]} rewrite]`
      const mockVoice = context.selectedVoice ? `\nVoice influence: ${context.selectedVoice.name}` : ''
      const mockTopic = context.selectedTopic ? `\nTopic focus: ${context.selectedTopic}` : ''
      return NextResponse.json({ variation: `${mockHeader}${mockVoice}${mockTopic}\n\n${sourceText}`, personaId: persona.id })
    }

    const slotValuesBlock = hasSlotValues && slotValues
      ? `Slot values provided by user:\n${Object.entries(slotValues).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
      : ''

    const userPrompt = mode === 'create'
      ? [
          `Create a LinkedIn post for ${context.personaName}.`,
          template ? `Post format: ${template.name}` : '',
          `Length preference: ${normalizedDesiredLength}.`,
          getVariablePreservationInstruction({ hasTemplate: Boolean(template), hasSlotValues }),
          context.selectedTopic ? `Selected topic to emphasize: ${context.selectedTopic}` : '',
          context.selectedVoice ? `Selected voice inspiration: ${context.selectedVoice.name}` : '',
          '',
          slotValuesBlock,
          sourceText ? `Brief: ${sourceText}` : '',
        ].filter(Boolean).join('\n')
      : [
          `Rewrite this LinkedIn post for ${context.personaName}.`,
          template ? `Post format: ${template.name}` : '',
          `Length preference: ${normalizedDesiredLength}.`,
          getVariablePreservationInstruction({ hasTemplate: Boolean(template), hasSlotValues }),
          context.selectedTopic ? `Selected topic to emphasize: ${context.selectedTopic}` : '',
          context.selectedVoice ? `Selected voice inspiration: ${context.selectedVoice.name}` : '',
          '',
          slotValuesBlock,
          sourceText,
        ].filter(Boolean).join('\n')

    const result = await generateWithFallback(userPrompt, systemPrompt, missionControlExecutor, 'contentbot/variation')

    if (!result.ok) {
      return NextResponse.json({ error: result.content }, { status: 503 })
    }

    return NextResponse.json({ variation: result.content.trim(), personaId: persona.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
