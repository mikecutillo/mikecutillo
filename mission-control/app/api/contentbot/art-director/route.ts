import { NextRequest, NextResponse } from 'next/server'
import { generateWithFallback } from '@/lib/model-router'
import { missionControlExecutor } from '@/lib/ai-executor'

interface ArtDirectorRequest {
  postContent: string
  postId?: string
}

interface ArtDirectorResponse {
  mediaUrl: string | null
  chartJson: object | null
  reasoning: string
}

// Detect if a post is data/chart-worthy
function isChartWorthy(text: string): boolean {
  const signals = [
    /\d+%/, // percentages
    /\$[\d,]+/, // dollar amounts
    /compared to/i,
    /vs\.?/i,
    /grew by|grew from|dropped|increased|decreased/i,
    /compound(ing)?/i,
    /rate of return/i,
    /inflation/i,
    /tax rate/i,
    /over \d+ years?/i,
    /average.*return/i,
    /historically/i,
    /market.*trend/i,
    /portfolio/i,
    /allocation/i,
    /\d+x/,
    /million|billion/i,
  ]
  return signals.some(re => re.test(text))
}

// Generate a Chart.js config based on post content using simple heuristics
// Falls back to a smart default if OpenAI is unavailable
function generateChartConfig(postContent: string): object {
  // Extract percentages for a simple bar chart
  const percentMatches = postContent.match(/(\d+(?:\.\d+)?)\s*%/g) ?? []
  const dollarMatches = postContent.match(/\$[\d,]+(?:\.\d+)?[KMB]?/g) ?? []

  // Try to find labeled numbers (e.g. "stocks: 60%", "bonds: 30%")
  const labeledPcts: { label: string; value: number }[] = []
  const labeledPctRe = /([A-Za-z][A-Za-z\s]{2,20}):\s*(\d+(?:\.\d+)?)\s*%/g
  let m: RegExpExecArray | null
  while ((m = labeledPctRe.exec(postContent)) !== null) {
    labeledPcts.push({ label: m[1].trim(), value: parseFloat(m[2]) })
  }

  if (labeledPcts.length >= 2) {
    return {
      type: 'bar',
      data: {
        labels: labeledPcts.map(p => p.label),
        datasets: [{
          label: 'Percentage',
          data: labeledPcts.map(p => p.value),
          backgroundColor: ['#4F8EF7', '#2ECC71', '#F5A623', '#E8453C', '#9B59B6', '#1ABC9C'],
        }],
      },
      options: {
        plugins: { legend: { display: false }, title: { display: false } },
        scales: { y: { ticks: { callback: 'function(v){ return v + "%" }' } } },
      },
    }
  }

  // Compounding growth chart (years vs value)
  if (/compound|grow|years?/i.test(postContent) && percentMatches.length >= 1) {
    const rate = parseFloat(percentMatches[0] ?? '0') / 100
    const years = [1, 5, 10, 15, 20, 25, 30]
    const values = years.map(y => Math.round(10000 * Math.pow(1 + rate, y)))
    return {
      type: 'line',
      data: {
        labels: years.map(y => `Yr ${y}`),
        datasets: [{
          label: `$10k at ${(rate * 100).toFixed(1)}%`,
          data: values,
          borderColor: '#2ECC71',
          backgroundColor: 'rgba(46,204,113,0.15)',
          fill: true,
          tension: 0.4,
        }],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: { y: { ticks: { callback: 'function(v){ return "$" + v.toLocaleString() }' } } },
      },
    }
  }

  // Generic percentage bar
  if (percentMatches.length >= 2) {
    const values = percentMatches.map(p => parseFloat(p))
    return {
      type: 'bar',
      data: {
        labels: values.map((_, i) => `Scenario ${i + 1}`),
        datasets: [{
          label: 'Value',
          data: values,
          backgroundColor: '#4F8EF7',
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: 'function(v){ return v + "%" }' } } },
      },
    }
  }

  // Dollar bar chart
  if (dollarMatches.length >= 2) {
    const parseAmt = (s: string) => {
      const n = parseFloat(s.replace(/[$,]/g, ''))
      if (/K/i.test(s)) return n * 1000
      if (/M/i.test(s)) return n * 1000000
      if (/B/i.test(s)) return n * 1000000000
      return n
    }
    const values = dollarMatches.map(parseAmt)
    return {
      type: 'bar',
      data: {
        labels: values.map((_, i) => `Option ${i + 1}`),
        datasets: [{
          label: 'Amount',
          data: values,
          backgroundColor: ['#4F8EF7', '#2ECC71', '#F5A623', '#E8453C'],
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: 'function(v){ return "$" + v.toLocaleString() }' } } },
      },
    }
  }

  return {}
}

// Use the shared model router to generate a better Chart.js config if a provider key is available
async function generateChartWithAI(postContent: string): Promise<object | null> {
  try {
    const result = await generateWithFallback(
      `Generate a Chart.js JSON config for this LinkedIn post:\n\n${postContent.slice(0, 1000)}`,
      `You are The Art Director — an agent that generates Chart.js v3 configs for LinkedIn posts.
Given a post, produce a compact Chart.js JSON config that visualizes the key data point or concept.
Use vibrant colors: #4F8EF7 (blue), #2ECC71 (green), #F5A623 (gold), #E8453C (red).
IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no code fences.
If the post has no meaningful data, return the string null.`,
      missionControlExecutor,
      'contentbot/art-director',
    )
    if (!result.ok) return null
    const raw = result.content?.trim() ?? ''
    if (raw === 'null' || !raw) return null
    return JSON.parse(raw) as object
  } catch {
    return null
  }
}

function buildQuickChartUrl(chartConfig: object): string {
  const encoded = encodeURIComponent(JSON.stringify(chartConfig))
  return `https://quickchart.io/chart?c=${encoded}&w=600&h=300&bkg=white`
}

export async function POST(req: NextRequest): Promise<NextResponse<ArtDirectorResponse | { error: string }>> {
  try {
    const body = (await req.json()) as ArtDirectorRequest
    const { postContent } = body

    if (!postContent || typeof postContent !== 'string') {
      return NextResponse.json({ error: 'Missing postContent' }, { status: 400 })
    }

    // Check if post warrants a chart
    if (!isChartWorthy(postContent)) {
      return NextResponse.json({
        mediaUrl: null,
        chartJson: null,
        reasoning: 'Post does not contain chart-worthy data (no percentages, dollar amounts, comparisons, or trends detected).',
      })
    }

    const hasAnyAiKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.MOONSHOT_API_KEY)
    let chartJson: object | null = null

    if (hasAnyAiKey) {
      chartJson = await generateChartWithAI(postContent)
    }

    // Fallback to heuristic chart
    if (!chartJson) {
      chartJson = generateChartConfig(postContent)
    }

    // If chart is empty object, no chart
    if (!chartJson || Object.keys(chartJson).length === 0) {
      return NextResponse.json({
        mediaUrl: null,
        chartJson: null,
        reasoning: 'Chart-worthy signals detected but could not generate a meaningful chart config.',
      })
    }

    const mediaUrl = buildQuickChartUrl(chartJson)

    return NextResponse.json({
      mediaUrl,
      chartJson,
      reasoning: 'Chart generated from post data.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
