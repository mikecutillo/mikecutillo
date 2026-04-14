import { NextRequest, NextResponse } from 'next/server'
import { generateWithFallback } from '@/lib/model-router'
import { missionControlExecutor } from '@/lib/ai-executor'

const SYSTEM_PROMPT = `You are an expert HTML/CSS developer. The user will provide current HTML and a requested change. You must return ONLY the updated, raw HTML code. Do not include markdown formatting, backticks, code fences, or any conversational text like "Here is the code". Return pure HTML starting with <!DOCTYPE html> or the opening tag. Nothing else.`

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { html, prompt } = body as { html: string; prompt: string }

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.MOONSHOT_API_KEY) {
    return NextResponse.json({ error: 'No AI provider keys configured' }, { status: 500 })
  }

  const userMessage = `Current HTML:\n\`\`\`html\n${html || '<!-- empty -->'}\n\`\`\`\n\nRequested change: ${prompt}`

  try {
    const result = await generateWithFallback(userMessage, SYSTEM_PROMPT, missionControlExecutor, 'sandbox/copilot')

    if (!result.ok) {
      return NextResponse.json({ error: result.content }, { status: 503 })
    }

    let html_out = result.content ?? ''

    // Strip any accidental markdown fences
    html_out = html_out
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    return NextResponse.json({ html: html_out })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
