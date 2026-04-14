import { NextRequest, NextResponse } from 'next/server'
import { YoutubeTranscript } from 'youtube-transcript'
import { generateWithFallback } from '@/lib/model-router'
import { missionControlExecutor } from '@/lib/ai-executor'

interface VideoSummaryResponse {
  title?: string
  keyPoints?: string[]
  summary: string
}

export async function POST(req: NextRequest): Promise<NextResponse<VideoSummaryResponse | { error: string }>> {
  try {
    const { youtubeUrl } = (await req.json()) as { youtubeUrl?: string }

    if (!youtubeUrl || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
      return NextResponse.json({ error: 'A valid YouTube URL is required' }, { status: 400 })
    }

    let transcript: string
    try {
      const segments = await YoutubeTranscript.fetchTranscript(youtubeUrl)
      transcript = segments.map(s => s.text).join(' ').slice(0, 12000)
    } catch {
      return NextResponse.json(
        { error: 'Could not fetch transcript. The video may not have captions enabled.' },
        { status: 422 }
      )
    }

    if (!transcript.trim()) {
      return NextResponse.json({ error: 'Transcript is empty — video may not have captions.' }, { status: 422 })
    }

    const systemPrompt = `You analyze YouTube video transcripts and return a JSON breakdown for creating LinkedIn posts. Return only valid JSON with no other text.`

    const userPrompt = `Analyze this YouTube video transcript and return a JSON object with exactly these fields:
- "title": a clear descriptive title for the video (infer from content)
- "keyPoints": an array of 3–5 specific actionable insights (each under 30 words)
- "summary": a 2–3 sentence synthesis of why this video is worth knowing about

Focus on insights valuable to a financial advisor's LinkedIn audience. Be specific and concrete.

TRANSCRIPT:
${transcript}`

    const result = await generateWithFallback(userPrompt, systemPrompt, missionControlExecutor, 'contentbot/video-summary')

    if (!result.ok) {
      return NextResponse.json({ error: result.content }, { status: 503 })
    }

    try {
      const text = result.content.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(jsonMatch?.[0] ?? text) as VideoSummaryResponse
      return NextResponse.json(parsed)
    } catch {
      return NextResponse.json({ summary: result.content })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
