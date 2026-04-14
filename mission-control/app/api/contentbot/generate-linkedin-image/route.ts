import { NextRequest, NextResponse } from 'next/server'
import { logAiUsage } from '@/lib/ai-usage-logger'

interface ImageRequest {
  text: string
  personaName?: string
  templateCategory?: string
  topic?: string
}

function extractQuote(text: string) {
  const normalized = text.trim()
  const quoteMatch = normalized.match(/["\"]([\s\S]{20,500}?)["\"]\s*(?:\n|\s)*[—-]\s*([^\n]+)$/)
  if (quoteMatch) {
    return {
      quote: quoteMatch[1].trim(),
      author: quoteMatch[2].trim(),
    }
  }
  return null
}

function getCategoryVisualBrief(category: string | undefined, topic: string | undefined): string {
  const topicHint = topic ? ` Topic: ${topic}.` : ''
  switch ((category ?? '').toLowerCase()) {
    case 'quote':
      return 'Black background. White quote text. Minimalist, premium layout. No stock-photo feel. Editorial, clean, elegant.'
    case 'tip':
    case 'how-to':
      return `Clean educational graphic. Abstract concept related to the topic.${topicHint} No text overlay. Structured, credible, modern financial professional aesthetic. Light or dark neutral palette.`
    case 'opinion':
      return `Bold, high-contrast composition. A single strong concept that feels decisive.${topicHint} Dark background. Thought-provoking, no clichés. Premium editorial feel.`
    case 'story':
      return `Human, warm documentary aesthetic. Subtle and credible.${topicHint} Professional financial advisor context. Natural lighting feel. Not staged.`
    case 'question':
    case 'poll':
      return `Visual that suggests an open question or decision moment.${topicHint} Abstract fork-in-the-road or duality concept. Modern, clean, thought-provoking.`
    case 'list':
    case 'document':
      return `Structured, organized visual.${topicHint} Clean hierarchy. Grid or structured layout aesthetic. Credible, educational.`
    case 'video':
      return `Cinematic frame. Dark background with a spotlight-on-subject feel.${topicHint} Video thumbnail aesthetic. Premium, not promotional.`
    case 'link':
      return `Editorial, journalistic aesthetic.${topicHint} Clean newspaper-style composition. Credible and informative. No hype.`
    default:
      return `Minimalist, premium, credible, and modern.${topicHint} Dark neutral palette with subtle contrast. Editorial design language. No cheesy stock-photo feel.`
  }
}

function buildPrompt(text: string, personaName: string, templateCategory?: string, topic?: string) {
  const parsedQuote = extractQuote(text)
  if (parsedQuote) {
    return [
      'Create a polished square LinkedIn quote graphic, 1:1 aspect ratio.',
      'Black background. White quote text. Minimalist premium layout.',
      `Include a tasteful black-and-white portrait of ${parsedQuote.author}.`,
      'No stock-photo feel. Editorial, clean, elegant, modern.',
      'The quote must be readable and contained in the image design.',
      `Quote text: ${parsedQuote.quote}`,
      `Author text: ${parsedQuote.author}`,
      `This is for ${personaName}, a financial advisor posting on LinkedIn.`,
    ].join(' ')
  }

  const visualBrief = getCategoryVisualBrief(templateCategory, topic)
  return [
    'Create a polished square LinkedIn image for a financial advisor post, 1:1 aspect ratio.',
    visualBrief,
    `Visual concept inspired by this post content: ${text.slice(0, 400)}`,
    `This is for ${personaName}, a financial advisor posting on LinkedIn.`,
  ].join(' ')
}

async function uploadToCatbox(bytes: Buffer) {
  const form = new FormData()
  form.set('reqtype', 'fileupload')
  form.set('fileToUpload', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'linkedin-image.png')

  const uploadRes = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  })

  const url = (await uploadRes.text()).trim()
  if (!uploadRes.ok || !url.startsWith('https://')) {
    throw new Error('Generated image upload failed')
  }
  return url
}

export async function POST(req: NextRequest) {
  const aiStart = Date.now()
  try {
    const body = (await req.json()) as ImageRequest
    const text = body.text?.trim()
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 500 })
    }

    const prompt = buildPrompt(text, body.personaName?.trim() || 'Charlie Sacco', body.templateCategory, body.topic)
    const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1024x1024',
        quality: 'high',
      }),
      signal: AbortSignal.timeout(180000),
    })

    const payload = await imageRes.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } }
    const b64 = payload.data?.[0]?.b64_json
    const aiDuration = Date.now() - aiStart

    logAiUsage({
      route: 'contentbot/generate-linkedin-image',
      modelId: 'openai-gpt-image-1', provider: 'openai', modelName: 'gpt-image-1',
      status: (imageRes.ok && b64) ? 'success' : 'failed', durationMs: aiDuration,
      inputHint: text.slice(0, 80),
      fallbacksUsed: 0, attempts: [{ modelId: 'openai-gpt-image-1', status: (imageRes.ok && b64) ? 'success' : 'failed' }],
      costEstimate: 0.08, // fixed per-image cost
    }).catch(() => {})

    if (!imageRes.ok || !b64) {
      return NextResponse.json({ error: payload.error?.message || 'Image generation failed' }, { status: 502 })
    }

    const bytes = Buffer.from(b64, 'base64')
    const mediaUrl = await uploadToCatbox(bytes)
    return NextResponse.json({
      success: true,
      mediaUrl,
      mediaName: extractQuote(text)?.author ? `Quote graphic · ${extractQuote(text)?.author}` : 'LinkedIn image',
      prompt,
    })
  } catch (error) {
    logAiUsage({
      route: 'contentbot/generate-linkedin-image',
      modelId: 'openai-gpt-image-1', provider: 'openai', modelName: 'gpt-image-1',
      status: 'failed', durationMs: Date.now() - aiStart,
      fallbacksUsed: 0, attempts: [{ modelId: 'openai-gpt-image-1', status: 'failed', reason: error instanceof Error ? error.message : 'unknown' }],
      costEstimate: 0,
    }).catch(() => {})
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Image generation failed' }, { status: 500 })
  }
}
